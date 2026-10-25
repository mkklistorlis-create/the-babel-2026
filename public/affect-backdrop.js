/** Animated screenprint collage. Dark concept-art masses are camera windows.
 * Existing facial configurations drive artistic controls, not diagnoses. */
import * as THREE from './vendor/three.module.js';
import {AFFECT_FAMILIES,createAffectVisualState} from './affect-visual-state.js';
const TAU=Math.PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));
const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
function noise(t,seed){const i=Math.floor(t),u=t-i,f=u*u*(3-2*u);return (hash(i+seed)*(1-f)+hash(i+seed+1)*f)*2-1;}
function seedOf(value){let n=2166136261;for(const c of String(value??'solo'))n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0)%10000;}
// The three light inks of the approved concepts. Deep ink masses are omitted,
// including the former sadness dark fill. Coral receives its cream paper ink.
const inks={calm:['#A8C5B0','#F2EBDD','#C7E3DD'],joy:['#FFAA57','#FFD32F','#FFF0BA'],surprise:['#9566F2','#F19AE8','#FFF0FA'],tension:['#F06464','#FF9A83','#FFF0D8'],sadness:['#8D9FB5','#777A98','#BBC9DC']};
const palette=Object.fromEntries(AFFECT_FAMILIES.map(f=>[f,inks[f].map(c=>new THREE.Color(c))]));
const profiles={calm:{speed:.17},joy:{speed:.38},surprise:{speed:.47},tension:{speed:.35},sadness:{speed:.11}};
const mixParameter=(state,key)=>AFFECT_FAMILIES.reduce((sum,f)=>sum+(state.weights[f]||0)*profiles[f][key],0);
function colorFor(state,index){const color={r:0,g:0,b:0};for(const f of AFFECT_FAMILIES){const c=palette[f][index%3],w=state.weights[f]||0;for(const k of ['r','g','b'])color[k]+=c[k]*w;}return color;}
// All families share an outward-pointing composition. Expression changes
// reshape the same petals, avoiding wholesale horizontal/vertical rotations.
const bloomProfiles={
 calm:{spread:.87,curve:.055,reach:1.12},joy:{spread:1.12,curve:.09,reach:1.20},
 surprise:{spread:1.02,curve:.018,reach:1.31},tension:{spread:.72,curve:.008,reach:1.19},
 sadness:{spread:.83,curve:.04,reach:1.06},
};
const bloomValue=(state,key)=>AFFECT_FAMILIES.reduce((s,f)=>s+(state.weights[f]||0)*bloomProfiles[f][key],0);
export function composeBackdrop(state,phase=0,seed=1,width=1440,height=900,origin={x:.5,y:.52}){
 if(!state?.visible||!(width>0&&height>0))return [];
 const strength=clamp(AFFECT_FAMILIES.reduce((s,f)=>s+(state.weights[f]||0)*(state.strengths[f]||0),0));
 const commands=[],cx=origin.x*width,cy=origin.y*height,small=Math.min(width,height);
 const spread=bloomValue(state,'spread'),curve=bloomValue(state,'curve'),reach=bloomValue(state,'reach');
 const edgeDistance=(dx,dy)=>Math.min(dx>0?(width-cx)/dx:dx<0?-cx/dx:Infinity,dy>0?(height-cy)/dy:dy<0?-cy/dy:Infinity);
 const petals=24;
 for(let i=0;i<petals;i++){
  const key=seed+i*23,angle=i/petals*TAU-.16+(hash(key)-.5)*.065+noise(phase*.22,key)*.014;
  const dx=Math.cos(angle),dy=Math.sin(angle),nx=-dy,ny=dx;
  const distance=edgeDistance(dx,dy),start=small*(.035+hash(key+9)*.045);
  const length=distance*(i%5===1?.89:reach+.25+hash(key+3)*.28);
  const pulse=1+Math.sin(phase*1.2+i*.62)*(.02+.045*strength);
  const breadth=distance*Math.tan(Math.PI/petals)*(.84+.28*hash(key+2))*spread*pulse;
  const top=[],bottom=[],underTop=[],underBottom=[];
  for(let j=0;j<=72;j++){
   const u=j/72,tip=u<.77?u/.77:(1-u)/.23;
   const radius=start+(length-start)*u;
   const bow=Math.sin(u*Math.PI)*curve*distance*Math.sin(phase*.65+i*.79);
   const descend=(state.weights.sadness||0)*Math.sin(u*Math.PI)*small*.025;
   const x=cx+dx*radius+nx*bow,y=cy+dy*radius+ny*bow+descend;
   const half=Math.max(0,breadth*tip),tear=(noise(u*23,key+3)*.07+noise(u*69,key+13)*.035)*half;
   const tear2=(noise(u*19,key+83)*.08+noise(u*73,key+24)*.04)*half;
   const offset=(3+small*.005)*tip;
   top.push({edge:0,x:x+nx*(half+tear),y:y+ny*(half+tear)});
   bottom.push({edge:1,x:x-nx*(half+tear2),y:y-ny*(half+tear2)});
   underTop.push({edge:0,x:x+nx*(half+tear+offset),y:y+ny*(half+tear+offset)});
   underBottom.push({edge:1,x:x-nx*(half+tear2+offset),y:y-ny*(half+tear2+offset)});
  }
  if(i%4===0)commands.push({type:'strip',points:underTop,other:underBottom,color:colorFor(state,2),alpha:1,pattern:0});
  commands.push({type:'strip',points:top,other:bottom,color:colorFor(state,i),alpha:1,pattern:i%4===0?1:i%4===2?2:0});
 }
 // Slender spear-shaped accents also grow radially; no rectangular panels.
 for(let i=0;i<16;i++){
  const key=seed+800+i*31,angle=(i+.45)/16*TAU+noise(phase*.19,key)*.025,dx=Math.cos(angle),dy=Math.sin(angle),nx=-dy,ny=dx;
  const edge=edgeDistance(dx,dy),start=edge*(.22+hash(key)*.35),end=edge*(.88+hash(key+2)*.46),wide=small*(.006+hash(key+3)*.014);
  const points=[{x:cx+dx*start,y:cy+dy*start},{x:cx+dx*end+nx*wide,y:cy+dy*end+ny*wide},{x:cx+dx*(end*.76)-nx*wide*.3,y:cy+dy*(end*.76)-ny*wide*.3}];
  commands.push({type:'fill',points,color:colorFor(state,i%4?2:i),alpha:1,pattern:0});
 }
 for(let bundle=0;bundle<3;bundle++)for(let line=0;line<4;line++){
  const angle=bundle*TAU/3-.8+line*.016+Math.sin(phase*.35+bundle)*.018,dx=Math.cos(angle),dy=Math.sin(angle),edge=edgeDistance(dx,dy);
  commands.push({type:'line',points:[{x:cx+dx*edge*.48,y:cy+dy*edge*.48},{x:cx+dx*edge*1.1,y:cy+dy*edge*1.1}],color:colorFor(state,2),alpha:1,width:1.5*small/900,pattern:0});
 }
 return commands;
}

// A second-order low-pass keeps render velocity continuous when the existing
// expression classifier retargets midway through a transition. Detection and
// statistics are unaffected; this filter belongs to the decorative layer only.
export function smoothBackdropWeights(memory,target,dt){
 if(!memory)return {lead:{...target},value:{...target}};
 const a=1-Math.exp(-clamp(dt,0,.1)/.20);
 for(const f of AFFECT_FAMILIES){memory.lead[f]+=(target[f]-memory.lead[f])*a;memory.value[f]+=(memory.lead[f]-memory.value[f])*a;}
 return memory;
}
function bloomOrigin(person,projection,viewport){
 if(typeof projection?.point==='function'&&Number.isFinite(person?.faceCenter?.x)&&Number.isFinite(person?.faceCenter?.y)){
  const face=projection.point(person.faceCenter.x,person.faceCenter.y);
  const head=person.faceBBox&&typeof projection.box==='function'?projection.box(person.faceBBox):null;
  return {x:clamp(face.x/viewport.width,.18,.82),y:clamp((head?head.y+head.height*1.25:face.y+viewport.height*.18)/viewport.height,.25,.78)};
 }
 return {x:.5,y:.52};
}
const vertex=`attribute vec3 aColor;attribute float aAlpha;attribute float aPattern;attribute float aEdge;
varying vec3 vColor;varying float vAlpha;varying float vPattern;varying vec2 vPosition;varying float vEdge;
void main(){vEdge=aEdge;vColor=aColor;vAlpha=aAlpha;vPattern=aPattern;vPosition=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment=`uniform vec2 uViewport;uniform vec2 uOrigin;uniform float uPhase;
varying vec3 vColor;varying float vAlpha;varying float vPattern;varying vec2 vPosition;varying float vEdge;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cross2(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}
bool triangle(vec2 p,vec2 a,vec2 b,vec2 c){float x=cross2(b-a,p-a),y=cross2(c-b,p-b),z=cross2(a-c,p-c);return (x>=0.&&y>=0.&&z>=0.)||(x<=0.&&y<=0.&&z<=0.);}
void main(){
 vec2 q=vPosition/uViewport;
 // Negative-space seams radiate from the same slowly tracked origin.
 // Discard every ink layer in these seams to expose the original camera.
 vec2 center=uOrigin*uViewport,delta=vPosition-center;
 float theta=atan(delta.y,delta.x),radius=length(delta);
 for(int i=0;i<8;i++){
  float f=float(i),angle=f*6.28318530718/8.+.15+sin(uPhase*.22+f)*.012;
  float gap=abs(atan(sin(theta-angle),cos(theta-angle)));
  if(radius>min(uViewport.x,uViewport.y)*(.08+mod(f*.019,.06))&&gap<(.018+mod(f*.007,.018)))discard;
 }
 float edgeTear=hash(floor(vPosition*.65))*.024;
 if(min(vEdge,1.-vEdge)<edgeTear)discard;
 vec3 color=vColor;
 // Screenprint dots and distressed paper, not a glow/blur postprocess.
 vec2 paper=vPosition;
 float grain=hash(floor(paper*1.25));
 if(vPattern>.5&&vPattern<1.5){
  vec2 rot=vec2(paper.x*.94-paper.y*.342,paper.x*.342+paper.y*.94);
  float dots=1.-smoothstep(2.15,2.95,length(mod(rot,11.)-5.5));
  color=mix(color,color*.10,dots*.94);
 }
 if(vPattern>1.5){
  float speck=step(.79,hash(floor(paper*.7)));
  color=mix(color,vec3(.96),speck*.36);
 }
 color*=.94+.06*grain;
 gl_FragColor=vec4(color,vAlpha);
 #include <colorspace_fragment>
}`;

export class AffectBackdrop{
 constructor(parent,{order=-30,maxVertices=18000}={}){
  this.capacity=Math.floor(maxVertices/3)*3;this.geometry=new THREE.BufferGeometry();this.buffers={position:new Float32Array(this.capacity*3),aColor:new Float32Array(this.capacity*3),aAlpha:new Float32Array(this.capacity),aPattern:new Float32Array(this.capacity),aEdge:new Float32Array(this.capacity)};
  for(const [name,array] of Object.entries(this.buffers))this.geometry.setAttribute(name,new THREE.BufferAttribute(array,name==='position'||name==='aColor'?3:1).setUsage(THREE.DynamicDrawUsage));
  this.material=new THREE.ShaderMaterial({uniforms:{uViewport:{value:new THREE.Vector2(1440,900)},uOrigin:{value:new THREE.Vector2(.5,.52)},uPhase:{value:0}},vertexShader:vertex,fragmentShader:fragment,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name='Expression background collage';this.mesh.renderOrder=order;this.mesh.frustumCulled=false;parent.add(this.mesh);
  this.filter=createAffectVisualState({transitionMs:1500,intensityTimeConstantMs:420});this.clear();
 }
 clear(){this.filter.reset();this.phase=0;this.lastTime=null;this.weightMemory=null;this.origin=null;this.owner=undefined;this.seed=1;this.hide();}
 hide(){this.geometry.setDrawRange(0,0);this.mesh.visible=false;this.stats={visible:false,vertices:0,kind:'background-collage'};}
 reproject(){} // The tracked origin is normalized, so resize preserves its position.
 triangle(a,b,c,command){
  if(this.count+3>this.capacity)return;
  for(let k=0;k<3;k++){const p=k===0?a:k===1?b:c,i=this.count++,j=i*3;this.buffers.position[j]=p.x;this.buffers.position[j+1]=p.y;this.buffers.position[j+2]=0;this.buffers.aColor[j]=command.color.r;this.buffers.aColor[j+1]=command.color.g;this.buffers.aColor[j+2]=command.color.b;this.buffers.aAlpha[i]=command.alpha;this.buffers.aPattern[i]=command.pattern;this.buffers.aEdge[i]=p.edge??.5;}
 }
 update(person,projection,now,{expression,enabled=true,owner=null,paused=false,reducedMotion=false,viewport={width:1440,height:900}}={}){
  if(owner!==this.owner){this.clear();this.owner=owner;this.seed=seedOf(owner);}
  const fresh=!Number.isFinite(person?.faceObservedAt)||now-person.faceObservedAt<800;
  const eligible=Boolean(enabled&&projection&&person?.faceSeen&&!person.stale&&fresh);
  const filtered=this.filter.update(expression,now,{eligible,owner,paused});
  const dt=this.lastTime===null?0:clamp((now-this.lastTime)/1000,0,.1);this.lastTime=now;
  if(!filtered.visible){this.weightMemory=null;this.origin=null;this.hide();return this.stats;}
  this.weightMemory=smoothBackdropWeights(this.weightMemory,filtered.weights,paused?0:dt);
  const state={...filtered,weights:{...this.weightMemory.value}};this.visualState=state;
  const targetOrigin=bloomOrigin(person,projection,viewport);
  if(!this.origin)this.origin={...targetOrigin};
  else if(!paused){const a=1-Math.exp(-dt/.55);this.origin.x+=(targetOrigin.x-this.origin.x)*a;this.origin.y+=(targetOrigin.y-this.origin.y)*a;}
  if(!paused&&!reducedMotion){const strength=AFFECT_FAMILIES.reduce((v,f)=>v+(state.weights[f]||0)*(state.strengths[f]||0),0);this.phase+=dt*mixParameter(state,'speed')*(.7+strength);}
  this.material.uniforms.uViewport.value.set(viewport.width,viewport.height);this.material.uniforms.uPhase.value=this.phase;this.material.uniforms.uOrigin.value.set(this.origin.x,this.origin.y);
  const commands=composeBackdrop(state,this.phase,this.seed,viewport.width,viewport.height,this.origin);this.count=0;
  for(const command of commands){
   const points=command.points;
   if(command.type==='strip'){
    for(let i=1;i<points.length;i++){this.triangle(points[i-1],command.other[i-1],points[i],command);this.triangle(points[i],command.other[i-1],command.other[i],command);}
   }else if(command.type==='fill'){
    const center=points.reduce((p,q)=>({x:p.x+q.x/points.length,y:p.y+q.y/points.length}),{x:0,y:0});
    for(let i=0;i<points.length;i++)this.triangle(center,points[i],points[(i+1)%points.length],command);
   }else for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.y-a.y)||1,nx=-(b.y-a.y)/length*command.width/2,ny=(b.x-a.x)/length*command.width/2;
    const p={x:a.x+nx,y:a.y+ny},q={x:a.x-nx,y:a.y-ny},r={x:b.x+nx,y:b.y+ny},s={x:b.x-nx,y:b.y-ny};this.triangle(p,q,r,command);this.triangle(r,q,s,command);
   }
  }
  for(const attribute of Object.values(this.geometry.attributes)){attribute.clearUpdateRanges();attribute.addUpdateRange(0,this.count*attribute.itemSize);attribute.needsUpdate=true;}
  this.geometry.setDrawRange(0,this.count);this.mesh.visible=true;
  this.stats={visible:true,kind:'background-collage',family:state.family,intensity:state.intensity,vertices:this.count,petals:24,shards:16,lineBundles:3,cameraWindows:8,layout:'radial-bloom',origin:{...this.origin},transitionMs:1500,negativeSpace:'transparent',phase:this.phase,weights:{...state.weights}};return this.stats;
 }
 dispose(){this.clear();this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
}
