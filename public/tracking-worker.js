/* Inference runs off the drawing thread. Images are never sent to a server. */
const VISION = new URL('./vendor/mediapipe', self.location.href).href;
const MODEL = `${VISION}/pose_landmarker_lite.task`;
let detector, faceDetector, countDetector, handDetector, backgroundSegmenter, maskStabilizer;
let countDetectorMode='detector',guardCount=0,lastGuardTimestamp=-Infinity;
const COUNT_INTERVAL_MS=300,COUNT_MAX_AGE_MS=650;
let backgroundWarning = null;
const failedStages = new Map();
const STAGE_LABELS={face:'单人面部动作',hands:'双手关键点',count:'人数检查',pose:'单人人体分割',foreground:'全画面人物遮罩'};
let nativeMessages=[];
const originalConsoleError=console.error.bind(console);
console.error=(...args)=>{
 originalConsoleError(...args);
 // Retain bounded native diagnostic strings only, never images, arrays or
 // object payloads. RET_CHECK usually precedes the generic WASM Aborted error.
 const message=args.filter(value=>typeof value==='string').join(' ');
 if(/RET_CHECK|Aborted|abort\(|calculator|graph.*failed|wasm|Error|ERROR/i.test(message)){
  for(const line of message.split('\n').filter(Boolean))nativeMessages.push(line.slice(0,500));
  nativeMessages=nativeMessages.slice(-4);
 }
};
function beginStage(){nativeMessages=[];}

function recordFailure(stage,error){
 const previous=failedStages.get(stage);
 failedStages.set(stage,{stage,label:STAGE_LABELS[stage]||stage,count:(previous?.count||0)+1,message:`${STAGE_LABELS[stage]||stage}已停用：${String(error?.message||error||'unknown failure').slice(0,220)}`,nativeMessages:nativeMessages.slice()});
}
function taskStates(){return {face:Boolean(faceDetector),hands:Boolean(handDetector),count:Boolean(countDetector),pose:Boolean(detector),foreground:Boolean(backgroundSegmenter)};}

// Largest connected foreground component, followed along its pixel boundary.
// Unlike a convex hull, this preserves the space between arms and torso.
function traceMask(mask, seed = {x:.5,y:.5}) {
  if(!mask||!Number.isFinite(mask.width)||!Number.isFinite(mask.height)||mask.width<1||mask.height<1)return null;
  if(!Number.isFinite(seed?.x)||!Number.isFinite(seed?.y))seed={x:.5,y:.5};
  const values = mask.getAsFloat32Array();
  const sw = mask.width, sh = mask.height;
  const width = Math.min(320, sw), height = Math.max(1, Math.round(sh * width / sw));
  const binary = new Uint8Array(width * height), seen = new Uint8Array(binary.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    binary[y * width + x] = values[Math.min(sh - 1, Math.floor((y + .5) * sh / height)) * sw + Math.min(sw - 1, Math.floor((x + .5) * sw / width))] >= .55 ? 1 : 0;
  }
  let largest = [], bestScore = -Infinity;
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || seen[start]) continue;
    const component = [start]; seen[start] = 1;
    for (let i = 0; i < component.length; i++) {
      const at = component[i], x = at % width, y = Math.floor(at / width);
      for (const next of [x ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y ? at - width : -1, y < height - 1 ? at + width : -1]) {
        if (next >= 0 && binary[next] && !seen[next]) { seen[next] = 1; component.push(next); }
      }
    }
    const sx=Math.round(seed.x*width), sy=Math.round(seed.y*height);
    let nearest=Infinity;
    for(const at of component) nearest=Math.min(nearest,Math.hypot(at%width-sx,Math.floor(at/width)-sy));
    const score=Math.log(Math.max(1,component.length))-nearest*.15;
    if (component.length>=30 && score>bestScore) {largest=component;bestScore=score;}
  }
  if (largest.length < 30) return null;
  const component = new Uint8Array(binary.length);
  for (const at of largest) component[at] = 1;
  const edges = new Map(), stride = width + 1;
  const add = (ax, ay, bx, by) => {
    const a = ay * stride + ax, b = by * stride + bx;
    if (!edges.has(a)) edges.set(a, []);
    edges.get(a).push(b);
  };
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const at of largest) {
    const x = at % width, y = Math.floor(at / width);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1);
    if (!y || !component[at - width]) add(x, y, x + 1, y);
    if (x === width - 1 || !component[at + 1]) add(x + 1, y, x + 1, y + 1);
    if (y === height - 1 || !component[at + width]) add(x + 1, y + 1, x, y + 1);
    if (!x || !component[at - 1]) add(x, y + 1, x, y);
  }
  let best = [];
  while (edges.size) {
    const start = edges.keys().next().value;
    let at = start, path = [], remaining = binary.length * 4;
    do {
      path.push({ x: at % stride, y: Math.floor(at / stride) });
      const ends = edges.get(at);
      if (!ends?.length) break;
      const next = ends.pop(); if (!ends.length) edges.delete(at);
      at = next;
    } while (at !== start && --remaining > 0);
    if (path.length > best.length) best = path;
  }
  if (best.length < 8) return null;
  const n = 320, points = [];
  // Unit pixel boundary edges make uniform index resampling arc-length uniform.
  for (let i = 0; i < n; i++) {
    const p = best[Math.floor(i * best.length / n)];
    points.push({ x: 1 - (p.x - minX) / (maxX - minX), y: (p.y - minY) / (maxY - minY) });
  }
  return { points, bbox: { x: minX / width, y: minY / height, width: (maxX - minX) / width, height: (maxY - minY) / height } };
}

// Continuous, unmirrored foreground probabilities. Keep these tied
// to the captured frame; pairing a live video frame with an older mask leaks
// photo texture around moving limbs.
function copyConfidenceMask(mask){
 if(!mask||!Number.isInteger(mask.width)||!Number.isInteger(mask.height)||mask.width<1||mask.height<1)return null;
 // The pinned Selfie model has ONE foreground probability channel. Its category
 // output is 0 foreground / 255 background, not the two-class 0/1 convention.
 // Reading confidenceMasks[0] avoids the category-label ambiguity completely.
 const raw=mask.getAsFloat32Array();
 if(raw.length!==mask.width*mask.height)throw new Error('人物置信度遮罩尺寸不匹配');
 const data=Float32Array.from(raw,value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0);
 return {width:mask.width,height:mask.height,data,encoding:'probability32',complete:true,source:'selfie-segmentation'};
}
function unionPoseMasks(masks,width=256,height=144){
 const data=new Uint8Array(width*height);
 for(const mask of masks||[]){
  const values=mask.getAsFloat32Array();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const mx=Math.min(mask.width-1,Math.floor((x+.5)*mask.width/width));
   const my=Math.min(mask.height-1,Math.floor((y+.5)*mask.height/height));
   if(values[my*mask.width+mx]>=.35)data[y*width+x]=1;
  }
 }
 return {width,height,data,complete:false,source:'pose-union'};
}
const FACE_OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const anchor=p=>p.faceCenter || p.landmarks?.[0] || {x:p.bbox.x+p.bbox.width/2,y:p.bbox.y+p.bbox.height*.2};
const EYE_ACTION_KEYS=['eyeWideLeft','eyeWideRight','eyeSquintLeft','eyeSquintRight',
 'eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight',
 'eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight'];
function facialActions(categories){
 if(!categories?.length)return null;
 const scores=new Map(categories.map(c=>[c.categoryName,clamp(Number.isFinite(c.score)?c.score:0)]));
 const score=name=>scores.get(name)||0;
 const pair=name=>(score(`${name}Left`)+score(`${name}Right`))/2;
 // Observable movement coefficients, not an inference about someone's feelings.
 // Keep the subject's left/right eye channels independent. In/out are relative
 // to each eye; display mirroring and coarse gaze matching belong downstream.
 const eyes=Object.fromEntries(EYE_ACTION_KEYS.map(key=>[key,score(key)]));
 return {smile:pair('mouthSmile'),browRaise:Math.max(score('browInnerUp'),pair('browOuterUp')),browRaiseLeft:Math.max(score('browInnerUp'),score('browOuterUpLeft')),browRaiseRight:Math.max(score('browInnerUp'),score('browOuterUpRight')),browLower:pair('browDown'),jawOpen:score('jawOpen'),eyeWide:pair('eyeWide'),mouthPucker:score('mouthPucker'),eyeBlinkLeft:score('eyeBlinkLeft'),eyeBlinkRight:score('eyeBlinkRight'),eyeSquint:pair('eyeSquint'),mouthFrown:pair('mouthFrown'),...eyes};
}
// MediaPipe face geometry uses a flat column-major 4x4 matrix. Remove scale,
// extract Three.js XYZ Euler angles, then change the metric Y-up basis to the
// scene's Y-down selfie basis with D R D, D=diag(-1,-1,1). This negates pitch
// and yaw while preserving roll. Return scene-ready radians; the renderer must
// not mirror again. A missing matrix carries no invented 3D pose.
function headPoseFromMatrix(matrix){
 const m=matrix?.data;
 if(!m||m.length!==16||!Array.from(m).every(Number.isFinite))return null;
 const sx=Math.hypot(m[0],m[1],m[2]),sy=Math.hypot(m[4],m[5],m[6]),sz=Math.hypot(m[8],m[9],m[10]);
 if(Math.min(sx,sy,sz)<1e-5)return null;
 const m11=m[0]/sx,m12=m[4]/sy,m13=m[8]/sz,m22=m[5]/sy,m23=m[9]/sz,m32=m[6]/sy,m33=m[10]/sz;
 const yaw=Math.asin(clamp(m13,-1,1));
 const pitch=Math.abs(m13)<.99999?Math.atan2(-m23,m33):Math.atan2(m32,m22);
 const roll=Math.abs(m13)<.99999?Math.atan2(-m12,m11):0;
 return {pitch:clamp(-pitch,-1.15,1.15),yaw:clamp(-yaw,-1.35,1.35),roll:clamp(roll,-1.5,1.5)};
}
function getHands(result,timestamp){
 return (result.landmarks||[]).slice(0,2).flatMap((points,index)=>{
  if(points.length!==21||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)))return [];
  const category=result.handedness?.[index]?.[0]||result.handednesses?.[index]?.[0];
  // Preserve finite model geometry: clipping fingers to the image boundary
  // distorts the bone angles used by the fist cue. Ink handles its own bounds.
  const landmarks=points.map(p=>({x:p.x,y:p.y,z:p.z}));
  const palm={x:0,y:0,z:0};for(const i of [0,5,9,13,17])for(const key of ['x','y','z'])palm[key]+=landmarks[i][key]/5;
  // A hand whose palm leaves is missing; it must not invalidate the other hand
  // or appear as an artificial palm pinned to the edge of the camera.
  if(palm.x<0||palm.x>1||palm.y<0||palm.y>1)return [];
  return [{handedness:['Left','Right'].includes(category?.categoryName)?category.categoryName:'Unknown',score:clamp(category?.score||0),landmarks,palm,tip:{...landmarks[8]},wrist:{...landmarks[0]},timestamp}];
 });
}
function getFaces(result,width,height){
 return (result.faceLandmarks||[]).map((points,index)=>{
  const oval=FACE_OVAL.map(i=>points[i]);
  const minX=Math.min(...oval.map(p=>p.x)),minY=Math.min(...oval.map(p=>p.y));
  const maxX=Math.max(...oval.map(p=>p.x)),maxY=Math.max(...oval.map(p=>p.y));
  const bbox={x:clamp(minX),y:clamp(minY),width:Math.max(.001,maxX-minX),height:Math.max(.001,maxY-minY)};
  const lipGap=Math.hypot((points[13].x-points[14].x)*width,(points[13].y-points[14].y)*height);
  const lipWidth=Math.hypot((points[61].x-points[291].x)*width,(points[61].y-points[291].y)*height);
  const actions=facialActions(result.faceBlendshapes?.[index]?.categories);
  // Landmark 54 is on the camera-left upper temple. Its measured position
  // follows the face plane and becomes the upper-right hairclip after mirror.
  const temple=points[54],forehead=points[10],chin=points[152];
  const faceAnchor={x:clamp(temple.x+(forehead.x-chin.x)*.04),y:clamp(temple.y+(forehead.y-chin.y)*.04)};
  return {bbox,oval,faceCenter:{x:(minX+maxX)/2,y:(minY+maxY)/2},faceAnchor,headPose:headPoseFromMatrix(result.facialTransformationMatrixes?.[index]),mouthOpen:clamp(lipGap/Math.max(1,lipWidth),0,1),...(actions?{facialActions:actions}:{})};
 }).filter(f=>f.bbox.width>.025&&f.bbox.height>.025).slice(0,1);
}
function countFaces(result,width,height){
 if(countDetectorMode==='landmarker')return Math.min(2,(result.faceLandmarks||[]).length);
 return Math.min(2,(result.detections||[]).filter(d=>{
  const b=d.boundingBox;return b&&Number.isFinite(b.originX)&&Number.isFinite(b.originY)&&b.width>width*.025&&b.height>height*.025;
 }).length);
}
function posePeople(result){
 const people=[];
 for(let i=0;i<(result.landmarks||[]).length;i++){
  const local=result.landmarks[i];
  const seed=local[11]&&local[12]?{x:(local[11].x+local[12].x)/2,y:(local[11].y+local[12].y)/2}:local[0];
  const mask=result.segmentationMasks?.[i];const contour=mask&&traceMask(mask,seed);
  if(contour)people.push({...contour,landmarks:local.map(p=>({...p})),source:'segmentation'});
 }
 return people;
}
function attachFaces(people,faces){
 const free=new Set(faces);
 for(const p of people){
  let best=null,bestDistance=.23;
  for(const face of free){const d=dist(anchor(p),face.faceCenter);if(d<bestDistance){bestDistance=d;best=face;}}
  if(best){p.faceCenter=best.faceCenter;p.faceBBox=best.bbox;p.faceAnchor=best.faceAnchor;p.headPose=best.headPose;p.mouthOpen=best.mouthOpen;p.faceSeen=true;if(best.facialActions)p.facialActions=best.facialActions;free.delete(best);}
 }
 return free;
}
function faceOnly(face){
 const b=face.bbox;
 return {bbox:b,points:face.oval.map(p=>({x:1-(p.x-b.x)/b.width,y:(p.y-b.y)/b.height})),landmarks:[],faceCenter:face.faceCenter,faceBBox:b,faceAnchor:face.faceAnchor,headPose:face.headPose,mouthOpen:face.mouthOpen,faceSeen:true,...(face.facialActions?{facialActions:face.facialActions}:{}),source:'face-landmarks'};
}
// When the single-pose model misses a close-up participant, recover only
// measured foreground connected to that participant's face. No synthetic body.
function foregroundPerson(mask,reference){
 if(!mask?.complete)return null;
 const target=anchor(reference);
 if(!Number.isFinite(target.x)||!Number.isFinite(target.y))return null;
 const values=Float32Array.from(mask.data,value=>mask.encoding==='alpha8'?value/255:value?1:0);
 const contour=traceMask({width:mask.width,height:mask.height,getAsFloat32Array:()=>values},target);
 if(!contour)return null;
 return {...contour,landmarks:reference.landmarks||[],source:'foreground-segmentation',
  ...(reference.faceCenter?{faceCenter:reference.faceCenter,faceBBox:reference.faceBBox||reference.bbox,faceAnchor:reference.faceAnchor,headPose:reference.headPose,mouthOpen:reference.mouthOpen||0,faceSeen:true}:{}),...(reference.facialActions?{facialActions:reference.facialActions}:{})};
}
async function processFrame(data){
 const started=performance.now(),bitmap=data.bitmap;
 const W=Number(bitmap?.width),H=Number(bitmap?.height);
 if(!Number.isFinite(W)||!Number.isFinite(H)||W<2||H<2||!Number.isFinite(data.timestamp)){
  bitmap?.close();data.bitmap=null;
  self.postMessage({type:'result',people:[],occupancy:'uncertain',observedPeopleCount:0,countGuardHealthy:false,countGuardAgeMs:null,foregroundMask:null,matchedFrame:null,faceCount:0,poseCount:0,timestamp:data.timestamp,latencyMs:0,videoWidth:W,videoHeight:H,warnings:[{stage:'input',count:1,message:'摄像头帧尺寸或时间戳无效，已跳过此帧'}],stages:taskStates()});return;
 }
 let faces=[],people=[],globalMask=null,poseCount=0;
 let poseMask=unionPoseMasks([],256,Math.max(1,Math.round(256*H/W)));
 // The single-face landmarker enables MediaPipe's native landmark smoothing.
 // A separate light detector checks room occupancy at bounded low frequency.
 if(faceDetector){
  try{beginStage();faces=getFaces(faceDetector.detectForVideo(bitmap,data.timestamp),W,H);}
  catch(error){recordFailure('face',error);faceDetector=null;}
 }
 if(countDetector&&(data.timestamp-lastGuardTimestamp>=COUNT_INTERVAL_MS||!Number.isFinite(lastGuardTimestamp)||data.timestamp<lastGuardTimestamp)){
  try{beginStage();guardCount=countFaces(countDetector.detectForVideo(bitmap,data.timestamp),W,H);lastGuardTimestamp=data.timestamp;}
  catch(error){recordFailure('count',error);countDetector=null;guardCount=0;}
 }
 const countGuardAgeMs=Number.isFinite(lastGuardTimestamp)?Math.max(0,data.timestamp-lastGuardTimestamp):null;
 const countGuardHealthy=Boolean(countDetector&&countGuardAgeMs!==null&&countGuardAgeMs<=COUNT_MAX_AGE_MS);
 // A confirmed second person requires no person-specific pose inference.
 if(detector&&guardCount<2){
  try{beginStage();detector.detectForVideo(bitmap,data.timestamp,result=>{poseCount=(result.landmarks||[]).length;people=posePeople(result);poseMask=unionPoseMasks(result.segmentationMasks,256,Math.max(1,Math.round(256*H/W)));});}
  catch(error){recordFailure('pose',error);detector=null;people=[];poseCount=0;}
 }
 if(backgroundSegmenter){
  try{beginStage();backgroundSegmenter.segmentForVideo(bitmap,data.timestamp,result=>{globalMask=copyConfidenceMask(result.confidenceMasks?.[0]);});if(!globalMask)throw new Error('未返回人物置信度遮罩');}
  catch(error){recordFailure('foreground',error);backgroundSegmenter=null;globalMask=null;}
 }
 const probabilityMask=globalMask||poseMask;
 const hasForeground=Boolean(probabilityMask.data.some(p=>p>=.35));
 if(faces.length&&probabilityMask.complete&&!hasForeground)probabilityMask.complete=false;
 let occupancy=!countGuardHealthy?'uncertain':guardCount>=2||poseCount>=2?'multiple':faces.length===1||poseCount===1?'single':hasForeground?'uncertain':'empty';
 const observedPeopleCount=Math.min(2,Math.max(guardCount,faces.length,poseCount));
 const referenceAnchor=faces[0]?.faceCenter||(people[0]?anchor(people[0]):null);
 const foregroundMask=maskStabilizer.update(probabilityMask,{timestamp:data.timestamp,anchor:referenceAnchor,occupancy});
 if(occupancy==='single'){
  attachFaces(people,faces);
  if(people.length&&faces.length===1&&!people[0].faceSeen){
   // A distant unmatched body and face may belong to different people.
   occupancy='uncertain';people=[];
  }else{
   // Prefer one consistent silhouette source while global segmentation works.
   // Pose landmarks still supply movement/anchors, but do not perturb its edge.
   const reference=people[0]||faces[0];
   const measured=reference&&foregroundPerson(foregroundMask,reference);
   if(measured)people=[measured];
   else if(!people.length&&faces.length===1)people=[faceOnly(faces[0])];
  }
 }else people=[];
 // Attribute hands only after single-person occupancy has been established.
 // A hand-task failure remains isolated from face and silhouette processing.
 if(handDetector&&occupancy==='single'&&people.length===1){
  try{beginStage();people[0].hands=getHands(handDetector.detectForVideo(bitmap,data.timestamp),data.timestamp);}
  catch(error){recordFailure('hands',error);handDetector=null;people[0].hands=[];}
 }else for(const person of people)person.hands=[];
 const warnings=Array.from(failedStages.values());
 if(occupancy==='multiple')warnings.push({stage:'occupancy',count:observedPeopleCount,message:'当前镜头检测到多个人，请每台电脑只保留一人；表情与手部追踪已暂停。'});
 if(occupancy==='uncertain')warnings.push({stage:'occupancy',count:observedPeopleCount,message:countGuardHealthy?'当前人数或人物归属尚未确认，等待清晰的单人画面。':'人数检查不可用，已暂停表情与手部追踪；请重新启动。'});
 if(!countDetector||(!faceDetector&&!detector)){
  // Occupancy is required in single-participant mode. A surviving single-pose
  // task cannot verify the absence of a second person, so request bounded
  // recovery instead of leaving the session permanently uncertain.
  self.postMessage({type:'error',fatal:true,message:!countDetector?'人数检查任务已停用，需要恢复单人追踪。':'面部与人体追踪任务已停用，需要恢复单人追踪。',warnings,stages:taskStates(),occupancy:'uncertain',observedPeopleCount:0,countGuardHealthy:false,countGuardAgeMs,faceCount:faces.length,poseCount});return;
 }
 backgroundWarning=failedStages.has('foreground')?'全画面遮罩已停用，保留可用的人体／面部追踪。':null;
 const result={type:'result',people:people.slice(0,1),occupancy,observedPeopleCount,countGuardHealthy,countGuardAgeMs,foregroundMask,matchedFrame:bitmap,foregroundWarning:backgroundWarning,warnings,stages:taskStates(),faceCount:faces.length,poseCount,timestamp:data.timestamp,latencyMs:performance.now()-started,videoWidth:W,videoHeight:H};
 self.postMessage(result,[bitmap,foregroundMask.data.buffer]);
 data.bitmap=null;
}
self.onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   const [{FilesetResolver,PoseLandmarker,FaceLandmarker,FaceDetector,HandLandmarker,ImageSegmenter},{MaskStabilizer}]=await Promise.all([import(`${VISION}/vision_bundle.mjs`),import(new URL('./mask-stability.js',self.location.href).href)]);
   maskStabilizer=new MaskStabilizer();
   const fileset=await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
   const base={baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},numPoses:1,outputSegmentationMasks:true,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45};
   try{beginStage();detector=await PoseLandmarker.createFromOptions(fileset,{...base,runningMode:'VIDEO'});}catch(error){recordFailure('pose',error);detector=null;}
   try{beginStage();faceDetector=await FaceLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetPath:`${VISION}/face_landmarker.task`,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,minTrackingConfidence:.5,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true});}catch(error){recordFailure('face',error);faceDetector=null;}
   try{beginStage();handDetector=await HandLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetPath:`${VISION}/hand_landmarker.task`,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.5});}catch(error){recordFailure('hands',error);handDetector=null;}
   try{beginStage();countDetector=await FaceDetector.createFromOptions(fileset,{baseOptions:{modelAssetPath:`${VISION}/blaze_face_short_range.tflite`,delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.5,minSuppressionThreshold:.3});}
   catch(error){
    // Independent fallback, never reuse a WASM task whose creation aborted.
    try{beginStage();countDetector=await FaceLandmarker.createFromOptions(fileset,{baseOptions:{modelAssetPath:`${VISION}/face_landmarker.task`,delegate:'CPU'},runningMode:'VIDEO',numFaces:2,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,minTrackingConfidence:.5,outputFaceBlendshapes:false});countDetectorMode='landmarker';}
    catch(fallbackError){recordFailure('count',fallbackError);countDetector=null;}
   }
   try{beginStage();backgroundSegmenter=await ImageSegmenter.createFromOptions(fileset,{baseOptions:{modelAssetPath:`${VISION}/selfie_segmenter_landscape.tflite`,delegate:'CPU'},runningMode:'VIDEO',outputCategoryMask:false,outputConfidenceMasks:true});}catch(error){recordFailure('foreground',error);backgroundSegmenter=null;}
   self.postMessage({type:'ready',foregroundAvailable:Boolean(backgroundSegmenter),warnings:Array.from(failedStages.values()),stages:taskStates()});
  }catch(error){self.postMessage({type:'error',message:`视觉运行环境加载失败：${error.message||'请重试'}`});}
 }
 if(data.type==='frame'){
  try{await processFrame(data);}
  catch(error){
   // Unexpected JavaScript/data failures are visible and skip a frame; do not
   // turn an isolated task failure into a stop-camera command.
   const bitmap=data.bitmap;
   self.postMessage({type:'result',people:[],occupancy:'uncertain',observedPeopleCount:0,countGuardHealthy:false,countGuardAgeMs:null,foregroundMask:null,matchedFrame:null,faceCount:0,poseCount:0,timestamp:data.timestamp,latencyMs:0,videoWidth:bitmap?.width||0,videoHeight:bitmap?.height||0,warnings:[...failedStages.values(),{stage:'frame',count:1,message:String(error?.message||error).slice(0,220)}],stages:taskStates()});
  }finally{data.bitmap?.close();data.bitmap=null;}
 }
};
