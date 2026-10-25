/** R07 camera artwork: sampled square particles, two hand trails, head-attached emoji.
 * Three.js / WebGL2 renders every visible layer. Canvas2D only samples camera RGB
 * for the existing particle motion algorithm and rasterizes emoji textures.
 */
import * as THREE from './vendor/three.module.js';
import {ParticleMotion} from './particle-motion.js';
import {HandTrailTracker} from './hand-trails.js';
import {FingertipInk} from './fingertip-ink.js';
import {SixSevenOverlay} from './six-seven-overlay.js';
import {AffectBackdrop} from './affect-backdrop.js';
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number(v)||0));
const mix=(a,b,t)=>a+(b-a)*t;
const FINITE=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const EMOJI_SCALE=2; // Twice the R07.2 radius and diameter, following the same head anchor.

/** Shared camera-cover projection: all model coordinates are mirrored once. */
export function cameraProjection(width,height,videoWidth,videoHeight){
 const scale=Math.max(width/Math.max(1,videoWidth),height/Math.max(1,videoHeight));
 const drawnWidth=videoWidth*scale,drawnHeight=videoHeight*scale;
 const x=(width-drawnWidth)/2,y=(height-drawnHeight)/2;
 return {x,y,width:drawnWidth,height:drawnHeight,
  point(px,py){return {x:x+(1-px)*drawnWidth,y:y+py*drawnHeight};},
  box(b){return {x:x+(1-b.x-b.width)*drawnWidth,y:y+b.y*drawnHeight,width:b.width*drawnWidth,height:b.height*drawnHeight};},
 };
}

/** A hairclip follows the measured temple; it is not pinned to a screen corner. */
export function hairclipPlacement(person,projection){
 const box=person?.faceBBox;
 if(!box||!FINITE(person?.faceCenter))return null;
 const head=projection.box(box);
 const anchor=FINITE(person.faceAnchor)?projection.point(person.faceAnchor.x,person.faceAnchor.y)
  :{x:head.x+head.width*.9,y:head.y+head.height*.12};
 return {x:anchor.x,y:anchor.y,size:clamp(Math.min(head.width,head.height)*.52,34,126)*EMOJI_SCALE,
  yaw:clamp(person.headPose?.yaw,-1.15,1.15),pitch:clamp(person.headPose?.pitch,-.8,.8),roll:clamp(person.headPose?.roll,-.9,.9)};
}

const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// The whole alpha mask is a coarse RGB mosaic, covering all photographic body
// pixels even when loose particles float apart. Background pixels are untouched.
export const mosaicFragmentShader=`
varying vec2 vUv;
uniform sampler2D uCamera,uMask;
uniform vec2 uGrid;
void main(){
 vec2 p=vec2(vUv.x,1.-vUv.y);
 float alpha=texture2D(uMask,p).r;
 if(alpha<.001)discard;
 vec2 sampleUv=(floor(p*uGrid)+.5)/uGrid;
 vec3 color=texture2D(uCamera,sampleUv).rgb;
 gl_FragColor=vec4(color,alpha);
 #include <colorspace_fragment>
}`;
const particleVertex=`
attribute float aSize,aAlpha;
attribute vec3 aColor;
uniform float uDpr;
varying vec4 vColor;
void main(){
 vColor=vec4(aColor,aAlpha);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
 gl_PointSize=aSize*uDpr;
}`;
const particleFragment=`varying vec4 vColor;void main(){gl_FragColor=vColor;}`;
const layered=options=>({transparent:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false,...options});

function emojiTexture(text){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1024,1024);
 ctx.font='776px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,556);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
 return texture;
}
function newClip(){
 const group=new THREE.Group();group.renderOrder=20;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial(layered()));
 // World y increases downward; flip only the texture plane so emoji reads upright.
 mesh.scale.y=-1;mesh.renderOrder=21;group.add(mesh);group.visible=false;
 return {group,mesh,key:'',anchor:null};
}
function disposeMesh(mesh){mesh?.geometry?.dispose();mesh?.material?.map?.dispose();mesh?.material?.dispose();}
/** Simulated input is isolated from live camera input and explicitly labelled by UI. */
export function getDemoPeople(time=0){
 const sway=Math.sin(time*.5)*.035,cx=.5+sway,cy=.29;
 const faceBBox={x:cx-.077,y:cy-.13,width:.154,height:.24};
 const landmarks=Array.from({length:33},()=>({x:cx,y:.5,z:0,visibility:0}));
 for(const[index,x,y]of[[11,cx-.14,.55],[12,cx+.14,.55],[23,cx-.12,.96],[24,cx+.12,.96]])landmarks[index]={x,y,z:0,visibility:1};
 const hands=[-1,1].map((side,i)=>{
  const x=cx+side*(.24+Math.sin(time*.85+i)*.05),y=.53+Math.sin(time*1.2+i*2)*.14;
  const tip={x,y,z:0},palm={x:x-side*.015,y:y+.035,z:0};
  return {id:`demo-hand-${i}`,handedness:i?'Right':'Left',score:1,tip,palm,wrist:{x:palm.x,y:palm.y+.045,z:0},timestamp:time*1000,landmarks:[]};
 });
 return [{id:'demo-0',slot:0,bbox:{x:cx-.27,y:.15,width:.54,height:.83},faceBBox,
  faceCenter:{x:cx,y:cy},faceAnchor:{x:faceBBox.x+.012,y:faceBBox.y+.024},
  faceSeen:true,stale:false,faceConfidence:1,hands,landmarks,
  headPose:{yaw:Math.sin(time*.63)*.45,pitch:Math.sin(time*.47)*.2,roll:Math.sin(time*.8)*.12},
  facialActions:{smile:.65,jawOpen:.2},color:'#12D7EA'}];
}

export class DuetCanvas{
 constructor(canvas){
  this.canvas=canvas;
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
  this.renderer.setClearColor('#f3f3eb',1);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.rendererType=`Three.js r${THREE.REVISION} · WebGL2`;
  this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(0,1,0,1,-1000,1000);this.camera.position.z=500;
  this.state={mode:'idle',people:[],count:0,occupancy:'empty',interactionsEnabled:false,paused:false,expression:null};
  this.elapsed=0;this.last=performance.now();this.fps=60;this.pointer={x:.5,y:.5};
  this.particleMotion=new ParticleMotion();this.handTrails=new HandTrailTracker();
  this.clip=newClip();this.scene.add(this.clip.group);
  this.particleGeometry=new THREE.BufferGeometry();this.particleGeometry.setDrawRange(0,0);
  this.particles=new THREE.Points(this.particleGeometry,new THREE.ShaderMaterial(layered({
   uniforms:{uDpr:{value:1}},vertexShader:particleVertex,fragmentShader:particleFragment,
  })));this.particles.frustumCulled=false;this.particles.renderOrder=3;this.scene.add(this.particles);
  this.fingertipInk=new FingertipInk(this.scene,{lifetimeMs:this.handTrails.lifetimeMs,order:10});
  this.sixSeven=new SixSevenOverlay(this.scene);
  this.affectBackdrop=new AffectBackdrop(this.scene,{order:-30});
  this.motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');this.reducedMotion=this.motionQuery.matches;
  this.motionChanged=e=>{this.reducedMotion=e.matches;};this.motionQuery.addEventListener('change',this.motionChanged);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
  this.contextLost=e=>{e.preventDefault();this.contextStatus='lost';};this.contextRestored=()=>{this.contextStatus='ready';};
  canvas.addEventListener('webglcontextlost',this.contextLost);canvas.addEventListener('webglcontextrestored',this.contextRestored);
  this.tick=now=>{if(this.destroyed)return;const dt=Math.min((now-this.last)/1000,.08);this.last=now;if(dt>0)this.fps=mix(this.fps,1/dt,.04);
   if(!this.state.paused)this.elapsed+=dt;this.draw(now,dt);this.animation=requestAnimationFrame(this.tick);};
  this.animation=requestAnimationFrame(this.tick);
 }
 setState(next){
  const previous=this.state.matchedFrame,oldOwner=this.state.ownershipEpoch??this.state.owner;
  const oldGestureOwner=this.state.gestureOwner??oldOwner;
  this.state={...this.state,...next};
  if(next.mode==='demo'||next.mode==='idle'){this.state.matchedFrame=null;this.state.foregroundMask=null;}
  if(previous&&previous!==this.state.matchedFrame)previous.close?.();
  const owner=this.state.ownershipEpoch??this.state.owner;
  if(owner!==oldOwner||this.state.interactionsEnabled===false||this.state.occupancy==='multiple'){
   this.affectBackdrop?.clear();
   this.handTrails?.reset();this.fingertipInk?.clear();if(this.clip){this.clip.group.visible=false;this.clip.anchor=null;}
  }
  const gestureOwner=this.state.gestureOwner??owner;
  if(gestureOwner!==oldGestureOwner||(this.state.gestureEnabled??this.state.interactionsEnabled)===false||this.state.occupancy==='multiple'||next.mode==='idle')this.sixSeven?.clear();
  if(next.mode==='idle'){this.affectBackdrop?.clear();this.particleMotion?.reset();this.particles&&(this.particles.visible=false);}
 }
 setPointer(x,y){this.pointer={x:clamp(x),y:clamp(y)};}
 resize(){
  const bounds=this.canvas.getBoundingClientRect();this.width=Math.max(1,bounds.width);this.height=Math.max(1,bounds.height);
  this.dpr=Math.min(window.devicePixelRatio||1,2);this.renderer.setPixelRatio(this.dpr);this.renderer.setSize(this.width,this.height,false);
  Object.assign(this.camera,{left:0,right:this.width,top:0,bottom:this.height});this.camera.updateProjectionMatrix();
  this.particleMotion.resize(this.width,this.height);this.handTrails.reset();this.fingertipInk.clear();this.sixSeven.reproject();this.clip.anchor=null;
  this.affectBackdrop.reproject();
  this.particles.material.uniforms.uDpr.value=this.dpr;
 }
 updateCameraLayer(frame,mask){
  const valid=frame?.width>0&&frame?.height>0&&mask?.complete===true&&mask.data?.length===mask.width*mask.height;
  if(!valid){if(this.cameraImage)this.cameraImage.visible=false;if(this.cameraMask)this.cameraMask.visible=false;this.particles.visible=false;return null;}
  if(!this.cameraImage){
   this.cameraTexture=new THREE.Texture(frame);this.cameraTexture.colorSpace=THREE.SRGBColorSpace;this.cameraTexture.flipY=false;
   this.cameraTexture.minFilter=this.cameraTexture.magFilter=THREE.LinearFilter;
   // ImageBitmap ignores flipY: explicit map transform matches top-left mask rows.
   this.cameraTexture.repeat.set(1,-1);this.cameraTexture.offset.set(0,1);
   this.cameraImage=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial(layered({map:this.cameraTexture})));
   this.cameraImage.renderOrder=-100;this.scene.add(this.cameraImage);
   this.cameraMask=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial(layered({
    uniforms:{uCamera:{value:this.cameraTexture},uMask:{value:null},uGrid:{value:new THREE.Vector2()}},vertexShader:vertex,fragmentShader:mosaicFragmentShader,
   })));this.cameraMask.renderOrder=0;this.scene.add(this.cameraMask);
  }
  if(this.cameraFrameSource!==frame||frame===this.demoCanvas){this.cameraTexture.image=frame;this.cameraTexture.needsUpdate=true;this.cameraFrameSource=frame;}
  if(this.maskSource!==mask){
   const pixels=new Uint8Array(mask.data.length);
   for(let i=0;i<pixels.length;i++)pixels[i]=mask.encoding==='alpha8'?mask.data[i]:(mask.data[i]?255:0);
   if(!this.maskTexture||this.maskTexture.image.width!==mask.width||this.maskTexture.image.height!==mask.height){
    this.maskTexture?.dispose();this.maskTexture=new THREE.DataTexture(pixels,mask.width,mask.height,THREE.RedFormat,THREE.UnsignedByteType);
    this.maskTexture.minFilter=this.maskTexture.magFilter=THREE.LinearFilter;this.maskTexture.flipY=false;
   }else this.maskTexture.image.data.set(pixels);
   this.maskTexture.needsUpdate=true;this.maskSource=mask;this.cameraMask.material.uniforms.uMask.value=this.maskTexture;
  }
  // Rebind even when the exact same mask object is reused after a reset.
  this.particleMotion.setMask({width:mask.width,height:mask.height,data:this.maskTexture.image.data});
  const projection=cameraProjection(this.width,this.height,frame.width,frame.height);
  // Square cells use a screen-pixel grid, irrespective of portrait/landscape crop.
  this.cameraMask.material.uniforms.uGrid.value.set(projection.width/24,projection.height/24);
  for(const mesh of[this.cameraImage,this.cameraMask]){mesh.visible=true;mesh.position.set(this.width/2,this.height/2,0);mesh.scale.set(-projection.width,-projection.height,1);}
  return projection;
 }
 updateParticles(frame,now){
  const data=this.particleMotion.update(frame,now,{animate:!this.state.paused&&!this.reducedMotion});
  const count=data.length/7;
  if(!this.particleBuffers||this.particleBuffers.size.length<count){
   const capacity=Math.max(count,this.particleMotion._particles.length);
   this.particleBuffers={position:new Float32Array(capacity*3),size:new Float32Array(capacity),color:new Float32Array(capacity*3),alpha:new Float32Array(capacity)};
   for(const[name,key,n]of[['position','position',3],['aSize','size',1],['aColor','color',3],['aAlpha','alpha',1]])this.particleGeometry.setAttribute(name,new THREE.BufferAttribute(this.particleBuffers[key],n).setUsage(THREE.DynamicDrawUsage));
  }
  const {position,size,color,alpha}=this.particleBuffers;
  for(let i=0;i<count;i++){const j=i*7,k=i*3;position[k]=data[j]*this.width;position[k+1]=data[j+1]*this.height;size[i]=data[j+2];color[k]=data[j+3];color[k+1]=data[j+4];color[k+2]=data[j+5];alpha[i]=data[j+6];}
  for(const name of['position','aSize','aColor','aAlpha'])this.particleGeometry.getAttribute(name).needsUpdate=true;
  this.particleGeometry.setDrawRange(0,count);this.particles.visible=count>0;
  this.particleStats=this.particleMotion.stats;
 }
 updateTrails(person,projection,now,enabled){
  const strokes=this.handTrails.update(person?.hands||[],now,{enabled,owner:this.state.ownershipEpoch??this.state.owner??person?.id});
  this.fingertipInk.update(strokes,projection,now,{enabled,paused:this.state.paused,viewport:{width:this.width,height:this.height}});
  this.trailCount=strokes.length;
 }
 updateClip(person,projection,dt,enabled,now=performance.now()){
  const expression=this.state.expression,placement=person&&projection?hairclipPlacement(person,projection):null;
  const fresh=!Number.isFinite(person?.faceObservedAt)||now-person.faceObservedAt<800;
  const visible=enabled&&person.faceSeen!==false&&!person.stale&&fresh&&placement&&expression?.visible&&expression?.emoji;
  this.clip.group.visible=Boolean(visible);if(!visible){this.clip.anchor=null;return;}
  if(this.clip.key!==expression.emoji){this.clip.mesh.material.map?.dispose();this.clip.mesh.material.map=emojiTexture(expression.emoji);this.clip.mesh.material.needsUpdate=true;this.clip.key=expression.emoji;}
  if(!this.clip.anchor)this.clip.anchor={...placement};
  const target=this.clip.anchor,follow=1-Math.exp(-Math.max(0,dt)*15);
  for(const k of ['x','y','size','yaw','pitch','roll'])target[k]=mix(target[k],placement[k],follow);
  this.clip.group.position.set(target.x,target.y,20);this.clip.group.scale.setScalar(target.size);
  // A true plane in the head's local 3D orientation; no Sprite billboarding.
  this.clip.group.rotation.set(target.pitch,target.yaw,target.roll,'XYZ');
 }
 demoFrame(person,now){
  if(!this.demoCanvas){this.demoCanvas=document.createElement('canvas');this.demoCanvas.width=640;this.demoCanvas.height=400;this.demoContext=this.demoCanvas.getContext('2d');this.demoMaskCanvas=document.createElement('canvas');this.demoMaskCanvas.width=160;this.demoMaskCanvas.height=100;this.demoMaskContext=this.demoMaskCanvas.getContext('2d',{willReadFrequently:true});}
  const c=this.demoContext,w=640,h=400;c.fillStyle='#dddcd4';c.fillRect(0,0,w,h);c.fillStyle='#f5f4ee';c.fillRect(22,18,220,340);c.fillStyle='#a8aaa0';c.fillRect(526,54,70,278);
  const drawBody=(ctx,scale)=>{ctx.save();ctx.scale(scale,scale);const x=person.faceCenter.x*w;
   ctx.beginPath();ctx.moveTo(x-115,400);ctx.lineTo(x-106,245);ctx.quadraticCurveTo(x-80,207,x-33,204);ctx.lineTo(x-28,184);ctx.lineTo(x+28,184);ctx.lineTo(x+33,204);ctx.quadraticCurveTo(x+80,207,x+106,245);ctx.lineTo(x+115,400);ctx.closePath();ctx.fill();
   for(const hand of person.hands){ctx.lineWidth=34;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x+(hand.handedness==='Left'?-75:75),241);ctx.lineTo(hand.palm.x*w,hand.palm.y*h);ctx.stroke();ctx.beginPath();ctx.ellipse(hand.tip.x*w,hand.tip.y*h+9,16,25,0,0,Math.PI*2);ctx.fill();}
   ctx.beginPath();ctx.ellipse(x,person.faceCenter.y*h+6,49,61,person.headPose.roll,0,Math.PI*2);ctx.fill();ctx.restore();};
  c.fillStyle='#8754ff';c.strokeStyle='#8754ff';drawBody(c,1);
  c.save();c.beginPath();c.ellipse(person.faceCenter.x*w,person.faceCenter.y*h+6,49,61,person.headPose.roll,0,Math.PI*2);c.clip();c.fillStyle='#dab191';c.fillRect(0,0,w,h);c.fillStyle='#332d38';c.fillRect(person.faceCenter.x*w-55,45,110,48);c.restore();
  const m=this.demoMaskContext;m.clearRect(0,0,160,100);m.fillStyle=m.strokeStyle='#fff';drawBody(m,.25);const raw=m.getImageData(0,0,160,100).data,data=new Uint8Array(16000);for(let i=0;i<data.length;i++)data[i]=raw[i*4+3];
  // Canvas is mutable; an explicit revision allows the motion sampler to read it.
  this.demoCanvas.currentTime=now/1000;
  return {frame:this.demoCanvas,mask:{width:160,height:100,data,encoding:'alpha8',complete:true}};
 }
 draw(now,dt){
  if(this.contextStatus==='lost')return;
  const s=this.state,person=s.people?.length===1&&s.count===1?s.people[0]:null;
  const enabled=Boolean(person&&s.interactionsEnabled!==false&&s.occupancy!=='multiple'&&!person.stale);
  let frame=s.matchedFrame,mask=s.foregroundMask;
  if(s.mode==='demo'&&person)({frame,mask}=this.demoFrame(person,now));
  if(s.mode==='idle'){frame=null;mask=null;}
  const projection=this.updateCameraLayer(frame,mask);
  this.affectBackdrop?.update(person,projection,now,{expression:s.expression,enabled,owner:s.ownershipEpoch??s.owner??person?.id,
   paused:s.paused,reducedMotion:this.reducedMotion,viewport:{width:this.width,height:this.height}});
  if(projection)this.updateParticles(frame,now);
  else this.particleMotion.reset();
  this.updateTrails(person,projection||cameraProjection(this.width,this.height,640,400),now,enabled&&Boolean(projection));
  const gestureEnabled=Boolean(person&&(s.gestureEnabled??s.interactionsEnabled)!==false&&s.occupancy==='single'&&!person.stale);
  this.sixSeven.update(person?.hands||[],projection,now,{enabled:gestureEnabled,dt,reducedMotion:this.reducedMotion,
   owner:s.gestureOwner??s.ownershipEpoch??s.owner??person?.id});
  this.updateClip(person,projection,dt,enabled,now);
  this.renderer.render(this.scene,this.camera);
 }
 destroy(){
  this.destroyed=true;cancelAnimationFrame(this.animation);this.resizeObserver.disconnect();this.motionQuery.removeEventListener('change',this.motionChanged);
  this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.canvas.removeEventListener('webglcontextrestored',this.contextRestored);
  for(const mesh of[this.cameraImage,this.cameraMask,this.particles,this.clip.mesh])disposeMesh(mesh);
  this.cameraTexture?.dispose();this.maskTexture?.dispose();this.state.matchedFrame?.close?.();this.state.matchedFrame=null;
  this.affectBackdrop.dispose();this.sixSeven.dispose();this.fingertipInk.dispose();this.handTrails.reset();this.particleMotion.reset();this.renderer.dispose();this.renderer.forceContextLoss();
 }
}
