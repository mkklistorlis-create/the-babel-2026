import {ContourFilter,smoothBBox,RobustPointFilter,SinglePersonGate,InputOwnershipGate,smoothFacialActions,HeadPoseFilter,HandTrackFilter} from './tracking-math.js';
const noop = () => {};
const COLOR = '#12D7EA';
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const center = p => p.faceCenter || p.landmarks?.[0] || ({ x: p.bbox.x + p.bbox.width / 2, y: p.bbox.y + p.bbox.height * .2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Camera pixels stay in this tab. Contours are mirrored and bbox-local [0,1].
 * status = {kind:'tracking',state:'loading'|'ready'|'off'|'error',message}.
 * One local participant only. A short detection miss holds geometry for 500 ms
 * without fresh visual speech evidence. A healthy count guard preserves local
 * utterance ownership for <900 ms; a second person revokes it immediately.
 */
export function createTracker({ video, onFrame = noop, onStatus = noop } = {}) {
  if (!video) throw new TypeError('createTracker requires a video element');
  let stream = null, worker = null, generation = 0, timer = 0, busy = false;
  let cancelReady = null, startupTimer = 0, frameTimeout = 0;
  let recoveryCount = 0, recovering = false, lastWarning = '';
  let track = null, nextId = 0, lastVideoTime = -1;
  const occupancyGate=new SinglePersonGate();
  const ownershipGate=new InputOwnershipGate();
  const status = (state, message, diagnostics) => onStatus({ kind: 'tracking', state, message, diagnostics });
  video.muted = true; video.playsInline = true;

  function stop(announce = true) {
    generation++; clearTimeout(timer); clearTimeout(startupTimer); clearTimeout(frameTimeout);
    cancelReady?.(); cancelReady = null;
    worker?.terminate(); worker = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null;
    track = null; busy = false; recovering = false; recoveryCount = 0; lastWarning = ''; occupancyGate.reset(); lastVideoTime = -1;
    onFrame({ people: [], count: 0, observedCount: 0, observedPeopleCount:0, occupancy:'empty', speechEligible:false, countGuardHealthy:false, countGuardAgeMs:Infinity, ...ownershipGate.invalidate(), video, latencyMs: 0 });
    if (announce) status('off', '摄像头已停止');
  }

  function consume(data) {
    const now=performance.now(),observed=Array.isArray(data.people)?data.people:[];
    const observedPeopleCount=clamp(Math.max(Number(data.observedPeopleCount)||0,Number(data.faceCount)||0,observed.length),0,2);
    const countGuardHealthy=data.countGuardHealthy===true;
    const rawOccupancy=data.occupancy||'uncertain';
    const occupancy=occupancyGate.update(rawOccupancy,observedPeopleCount,now);
    let fresh=false;
    if(occupancy==='multiple')track=null;
    else if(observed.length===1&&rawOccupancy!=='empty'){
      let p=observed[0];
      const rawPoints=p.points,rawBBox={...p.bbox},rawSource=p.source;
      if(!track||now-track.seen>2000)track={id:`person-${++nextId}`,seen:now,previous:null,motion:0,filter:new ContourFilter(),faceFilter:new RobustPointFilter(),attachmentFilter:new RobustPointFilter(),headPoseFilter:new HeadPoseFilter(),handFilter:new HandTrackFilter(),mouthActivity:0,mouthOpen:0};
      const dt=Math.max(.04,(now-track.seen)/1000);
      const rawMouth=p.faceSeen?p.mouthOpen:0;
      let facialActions=null;
      if(p.faceSeen&&p.facialActions){
        if(!track.facialSeen||now-track.facialSeen>600)track.facialActions=null;
        facialActions=smoothFacialActions(track.facialActions,p.facialActions,dt);
        track.facialActions=facialActions;track.facialSeen=now;
      }
      const mouthChange=track.faceSeen&&p.faceSeen?Math.abs(rawMouth-track.rawMouth):0;
      track.mouthActivity=track.mouthActivity*.55+clamp(mouthChange/dt*.6)*.45;
      track.mouthOpen=track.mouthOpen*.4+rawMouth*.6;
      track.faceSeen=p.faceSeen;track.rawMouth=rawMouth;
      // Missing one pose mask must not instantly replace an upper body with a
      // small face oval. The hold expires rather than inventing a lasting torso.
      if(p.source==='face-landmarks'&&track.bodyData&&now-track.bodySeen<600){
        p={...track.bodyData,faceCenter:p.faceCenter,faceBBox:p.faceBBox,faceAnchor:p.faceAnchor,headPose:p.headPose,hands:p.hands||[],mouthOpen:p.mouthOpen,facialActions:p.facialActions,faceSeen:true};
      }else if(p.source!=='face-landmarks'){track.bodyData=p;track.bodySeen=now;}
      const landmarks=p.landmarks||[];
      const moving=[0,15,16].filter(i=>landmarks[i]?.visibility>.5&&track.previous?.[i]?.visibility>.5);
      const raw=moving.length?moving.reduce((sum,i)=>sum+distance(landmarks[i],track.previous[i]),0)/moving.length/Math.max(.15,p.bbox.height)/dt:0;
      track.motion=track.motion*.7+clamp(raw/1.5)*.3;
      const isFace=p.source==='face-landmarks';
      if(track.isFace!==undefined&&track.isFace!==isFace){track.filter.reset();track.bbox=null;}
      track.isFace=isFace;
      track.bbox=smoothBBox(track.bbox,p.bbox,dt);
      const points=track.filter.update(p.points,dt);
      // During a head turn the current pose nose still anchors the silhouette;
      // do not freeze it at the last successfully measured frontal face.
      track.faceCenter=track.faceFilter.update(p.faceCenter||landmarks[0],dt);
      if(p.faceBBox&&track.faceFilter.accepted)track.faceBBox=smoothBBox(track.faceBBox,p.faceBBox,dt);
      const left=landmarks[2],right=landmarks[5];
      let angle=left&&right?Math.atan2((left.y-right.y)*data.videoHeight,(left.x-right.x)*data.videoWidth)*180/Math.PI:0;
      if(angle>90)angle-=180;if(angle< -90)angle+=180;
      track.headTilt=(track.headTilt||0)*.75+angle*.25;
      const b=track.bbox,face=track.faceCenter;
      const faceLocal=face?{x:clamp(1-(face.x-b.x)/b.width),y:clamp((face.y-b.y)/b.height)}:null;
      const faceObservedAt=p.faceSeen?(Number.isFinite(data.timestamp)?data.timestamp:now):null;
      const headPose=track.headPoseFilter.update(p.faceSeen?p.headPose:null,dt);
      if(!p.faceSeen)track.attachmentFilter.reset();
      const faceAnchor=p.faceSeen?track.attachmentFilter.update(p.faceAnchor,dt):null;
      const hands=track.handFilter.update(occupancy==='single'&&countGuardHealthy?p.hands:[],Number.isFinite(data.timestamp)?data.timestamp:now);
      track.data={...p,points,bbox:b,rawPoints,rawBBox,rawSource,id:track.id,slot:0,color:COLOR,motion:track.motion,headTilt:track.headTilt,headPose,faceAnchor,faceObservedAt,hands,faceCenter:face,faceBBox:track.faceBBox,faceLocal,facialActions,mouthOpen:track.mouthOpen,mouthActivity:track.mouthActivity,aspectRatio:b.width*data.videoWidth/(b.height*data.videoHeight),stale:false};
      track.center=center(p);track.previous=landmarks;track.seen=now;fresh=true;
    }
    if(!fresh&&track){track.handFilter.update([],Number.isFinite(data.timestamp)?data.timestamp:now);track.headPoseFilter.reset();track.attachmentFilter.reset();}
    const people=track?.data&&now-track.seen<=500?[{...track.data,stale:!fresh,faceSeen:fresh&&Boolean(track.data.faceSeen),faceObservedAt:fresh?track.data.faceObservedAt:null,headPose:fresh?track.data.headPose:null,faceAnchor:fresh?track.data.faceAnchor:null,hands:fresh?track.data.hands:[],mouthActivity:fresh?track.data.mouthActivity:0,facialActions:fresh?track.data.facialActions:null}]:[];
    const observedAt=Number.isFinite(data.timestamp)?Math.min(now,data.timestamp):now;
    const speechEligible=occupancy==='single'&&countGuardHealthy&&fresh&&people.length===1&&now-observedAt<900;
    const ownership=ownershipGate.update({occupancy,observedPeopleCount,countGuardHealthy,fresh: speechEligible,now,observedAt});
    onFrame({people,count:people.length,observedCount:observed.length,observedPeopleCount,occupancy,speechEligible,...ownership,countGuardHealthy,countGuardAgeMs:data.countGuardAgeMs,foregroundMask:data.foregroundMask,matchedFrame:data.matchedFrame,frameTimestamp:data.timestamp,foregroundWarning:data.foregroundWarning,trackingWarnings:data.warnings||[],faceCount:data.faceCount,poseCount:data.poseCount,video,latencyMs:data.latencyMs});
  }

  async function loadWorker(current) {
    const active = new Worker(new URL('./tracking-worker.js', import.meta.url));
    worker = active;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true; clearTimeout(startupTimer); cancelReady = null;
        error ? reject(error) : resolve();
      };
      cancelReady = () => finish(new DOMException('Tracking stopped', 'AbortError'));
      startupTimer = setTimeout(() => finish(new Error('轮廓模型加载超时，请重新开始')), 60000);
      active.onerror = () => finish(new Error('轮廓处理进程无法启动，请使用支持 WebGL2 的 Chrome'));
      active.onmessage = ({ data }) => {
        if (current !== generation || worker !== active) { data.matchedFrame?.close(); return; }
        if (data.type === 'ready') finish();
        if (data.type === 'error') finish(new Error(data.message));
      };
      active.postMessage({ type: 'init' });
    });
    if (current !== generation || worker !== active) return;
    active.onerror = () => { if (current === generation && worker === active) void recoverWorker(current, '轮廓处理进程异常退出'); };
    active.onmessage = ({ data }) => {
      if (current !== generation || worker !== active) { data.matchedFrame?.close(); return; }
      if (data.type !== 'result' && data.type !== 'error') return;
      clearTimeout(frameTimeout); busy = false;
      if (data.type === 'error') { void recoverWorker(current, data.message, data.diagnostics || {warnings:data.warnings||[],stages:data.stages,faceCount:data.faceCount,poseCount:data.poseCount}); return; }
      const warning = (data.warnings || []).map(w => w.message || String(w)).join('；');
      if (warning !== lastWarning) {
        lastWarning = warning;
        status(warning ? 'warning' : 'ready', warning || '单人轮廓、双手与面部动作追踪已开启', data.warnings || []);
      }
      consume(data);
    };
  }

  // A task-level failure is contained inside the worker. Rebuild only for a
  // fatal/unresponsive worker, once per start; never loop on a broken runtime.
  async function recoverWorker(current, message, diagnostics) {
    if (current !== generation || recovering) return;
    if (recoveryCount >= 1) {
      stop(false); status('error', `轮廓识别恢复失败：${message}。请刷新后重试。`, diagnostics); return;
    }
    recoveryCount++; recovering = true; busy = true;
    clearTimeout(frameTimeout); worker?.terminate(); worker = null;
    track=null;
    onFrame({people:[],count:0,observedCount:0,observedPeopleCount:0,occupancy:'uncertain',speechEligible:false,...ownershipGate.invalidate(),countGuardHealthy:false,countGuardAgeMs:Infinity,video,latencyMs:0});
    status('recovering', '轮廓引擎正在恢复，摄像头保持开启…', { message, details: diagnostics });
    try {
      await loadWorker(current);
      if (current !== generation) return;
      recovering = false; busy = false; lastVideoTime = -1; lastWarning = '';
      status('ready', '轮廓引擎已恢复，请保持镜头内只有一人');
    } catch (error) {
      if (current !== generation) return;
      stop(false); status('error', `轮廓引擎无法恢复：${error.message}`, diagnostics);
    }
  }

  async function start() {
    stop(false); const current = generation;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('请使用 localhost 或 HTTPS 打开摄像头');
    status('loading', '正在申请摄像头权限…');
    try {
      const pending = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user', frameRate: { ideal: 24, max: 30 } }, audio: false });
      if (current !== generation) { pending.getTracks().forEach(t => t.stop()); return; }
      stream = pending; video.srcObject = stream;
      for (const track of stream.getVideoTracks()) track.onended = () => { if (current === generation) { stop(false); status('error', '摄像头连接已断开，请重新开始'); } };
      await video.play(); if (current !== generation) return;
      status('loading', '正在加载本地轮廓模型…');
      await loadWorker(current);
      if (current !== generation) return;
      status('ready', '单人轮廓、双手与面部动作追踪已开启');
      const tick = async () => {
        if (current !== generation) return;
        timer = setTimeout(tick, 80);
        if (busy || recovering || !worker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
        busy = true; lastVideoTime = video.currentTime;
        const active = worker;
        try {
          const bitmap = await createImageBitmap(video, { resizeWidth: 640, resizeHeight: Math.max(1, Math.round(640 * video.videoHeight / video.videoWidth)) });
          if (current !== generation || worker !== active) { bitmap.close(); return; }
          try { active.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]); }
          catch (error) { bitmap.close(); throw error; }
          frameTimeout = setTimeout(() => { if (current === generation && worker === active) void recoverWorker(current, '轮廓推理超时'); }, 10000);
        } catch (error) { if (current === generation && worker === active) void recoverWorker(current, `摄像头帧无法处理：${error.message}`); }
      };
      void tick();
    } catch (error) {
      if (current !== generation) return;
      stop(false);
      const message = error.name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器中允许后重试' : error.name === 'NotFoundError' ? '没有找到摄像头' : error.message;
      status('error', message); throw new Error(message);
    }
  }
  return { start, stop };
}
