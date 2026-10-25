/** Expression-driven graphic collage, composited between camera and body.
 * These are artistic mappings of observed facial configurations, not diagnoses.
 * One bounded Three.js mesh; no new model, microphone or camera processing. */
import * as THREE from './vendor/three.module.js';
import {AFFECT_FAMILIES,AFFECT_VISUAL_PROFILES,createAffectVisualState} from './affect-visual-state.js';

const TAU=Math.PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));
const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
function noise(t,seed){const i=Math.floor(t),u=t-i,f=u*u*(3-2*u);return (hash(i+seed)*(1-f)+hash(i+seed+1)*f)*2-1;}
function seedOf(value){let n=2166136261;for(const c of String(value??'solo'))n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0)%10000;}
const profiles={
 calm:{speed:.22,bend:.10,angle:.10,stretchX:1.1,stretchY:.8,spacing:8},
 joy:{speed:.48,bend:.24,angle:.28,stretchX:1.05,stretchY:1,spacing:12},
 surprise:{speed:.67,bend:.31,angle:.56,stretchX:1.12,stretchY:1.05,spacing:16},
 tension:{speed:.58,bend:.06,angle:-.48,stretchX:1.28,stretchY:.62,spacing:5},
 sadness:{speed:.12,bend:.07,angle:1.35,stretchX:.44,stretchY:1.6,spacing:7},
};
const palette=Object.fromEntries(AFFECT_FAMILIES.map(f=>[f,AFFECT_VISUAL_PROFILES[f].palette.map(c=>new THREE.Color(c))]));
const mixParameter=(state,key)=>AFFECT_FAMILIES.reduce((sum,f)=>sum+(state.weights[f]||0)*profiles[f][key],0);
function colorFor(state,index){const color={r:0,g:0,b:0};for(const f of AFFECT_FAMILIES){const c=palette[f][index%3],w=state.weights[f]||0;for(const k of ['r','g','b'])color[k]+=c[k]*w;}return color;}
function edgeShape(f,t){
 const c=Math.cos(t),s=Math.sin(t);
 if(f==='joy')return {x:c,y:s};
 if(f==='surprise'){const r=(Math.round(t/TAU*16)%2)? .52:1;return {x:c*r,y:s*r};}
 if(f==='tension'){
  const corners=[[-1,-.8],[1,-.2],[.55,1],[-.8,.5]],at=t/TAU*4,i=Math.floor(at)%4,u=at-Math.floor(at),a=corners[i],b=corners[(i+1)%4];return {x:a[0]*(1-u)+b[0]*u,y:a[1]*(1-u)+b[1]*u};
 }
 const power=f==='sadness'?.2:.55;return {x:Math.sign(c)*Math.abs(c)**power,y:Math.sign(s)*Math.abs(s)**power};
}
const templates=Object.fromEntries(AFFECT_FAMILIES.map(f=>[f,Array.from({length:16},(_,i)=>edgeShape(f,i/16*TAU))]));

/** Background coordinates deliberately do not depend on face position.
 * Seeded motion changes composition continuously, without per-frame rerolls. */
export function composeBackdrop(state,phase=0,seed=1,width=1440,height=900){
 if(!state?.visible||!(width>0&&height>0))return [];
 const strength=clamp(AFFECT_FAMILIES.reduce((s,f)=>s+(state.weights[f]||0)*(state.strengths[f]||0),0));
 const time=phase;
 const bend=mixParameter(state,'bend'),tilt=mixParameter(state,'angle'),sx=mixParameter(state,'stretchX'),sy=mixParameter(state,'stretchY');
 const commands=[],small=Math.min(width,height),anchors=[[.04,.08],[.91,.17],[.10,.47],[.97,.58],[.02,.86],[.85,1.02],[.48,-.13],[.5,1.12]];
 for(let i=0;i<20;i++){
  const large=i<anchors.length,key=seed+i*23;
  const anchor=large?anchors[i]:[i%2?.82+hash(key)*.2:-.04+hash(key)*.25,hash(key+4)];
  const x=(anchor[0]+noise(time*.42,key)*.045)*width,y=(anchor[1]+noise(time*.38,key+9)*.055)*height;
  const pulse=(.8+.4*strength)*(1+Math.sin(time*1.8+i)*(.015+.045*strength));
  const rw=(large?width*(.17+hash(key+3)*.08):small*(.022+hash(key)*.035))*sx*pulse;
  const rh=(large?height*(.14+hash(key+5)*.08):rw)*sy*pulse;
  const angle=tilt-(state.weights.sadness||0)*1.35+(hash(key+6)-.5)*.8+noise(time*.3,key+18)*(.06+.22*strength),ca=Math.cos(angle),sa=Math.sin(angle);
  const points=[];
  for(let j=0;j<16;j++){
   let px=0,py=0;for(const f of AFFECT_FAMILIES){const w=state.weights[f]||0;px+=templates[f][j].x*w;py+=templates[f][j].y*w;}
   points.push({x:x+px*rw*ca-py*rh*sa,y:y+px*rw*sa+py*rh*ca});
  }
  commands.push({type:'fill',points,color:colorFor(state,i),alpha:large?.82+.16*strength:.95*(.25+.75*clamp((strength-(i-8)*.05)*4)),pattern:large&&i%3===0?1:large&&i%3===1?2:0});
 }
 // Four bundles of open paths cross the background with visible negative space.
 // The body mask occludes them; none circles or follows the head.
 for(let bundle=0;bundle<4;bundle++){
  const key=seed+bundle*37+800,spacing=mixParameter(state,'spacing')*(small/900);
  const angle=tilt+(bundle%2?-.27:.24),ca=Math.cos(angle),sa=Math.sin(angle);
  const cy=height*(.12+bundle*.26)+noise(time*.4,key)*height*.04,cx=width*(bundle%2?.58:.42);
  for(let line=0;line<5;line++){
   const points=[];
   for(let j=0;j<=32;j++){
    const u=j/32,px=(u-.5)*width*1.5;
    const smooth=Math.sin(u*TAU*1.1+time*.65+bundle)*bend*height*.4;
    const zig=(2/Math.PI)*Math.asin(Math.sin(u*TAU*3+time*.45))*height*.045;
    const angular=(state.weights.tension||0)+(state.weights.surprise||0)*.55;
    const py=smooth*(1-angular)+zig*angular+(line-2)*spacing;
    points.push({x:cx+px*ca-py*sa,y:cy+px*sa+py*ca});
   }
   commands.push({type:'line',points,color:colorFor(state,bundle),alpha:(.62+.3*strength)*(line<2?1:.25+.75*strength),width:(line===0?5+7*strength:1.4+2*strength)*small/900,pattern:0});
  }
 }
 return commands;
}

const vertex=`attribute vec3 aColor;attribute float aAlpha;attribute float aPattern;
varying vec3 vColor;varying float vAlpha;varying float vPattern;
void main(){vColor=aColor;vAlpha=aAlpha;vPattern=aPattern;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment=`varying vec3 vColor;varying float vAlpha;varying float vPattern;
void main(){
 vec3 color=vColor;
 if(vPattern>.5&&vPattern<1.5){vec2 p=mod(gl_FragCoord.xy,10.)-5.;float dots=1.-smoothstep(1.5,2.5,length(p));color=mix(color,color*.38,dots*.66);}
 if(vPattern>1.5){float stripe=1.-smoothstep(1.,2.,mod(gl_FragCoord.x+gl_FragCoord.y,12.));color=mix(color,color*.52,stripe*.45);}
 gl_FragColor=vec4(color,vAlpha);
 #include <colorspace_fragment>
}`;

export class AffectBackdrop{
 constructor(parent,{order=-30,maxVertices=12000}={}){
  this.capacity=Math.floor(maxVertices/3)*3;this.geometry=new THREE.BufferGeometry();this.buffers={position:new Float32Array(this.capacity*3),aColor:new Float32Array(this.capacity*3),aAlpha:new Float32Array(this.capacity),aPattern:new Float32Array(this.capacity)};
  for(const [name,array] of Object.entries(this.buffers))this.geometry.setAttribute(name,new THREE.BufferAttribute(array,name==='position'||name==='aColor'?3:1).setUsage(THREE.DynamicDrawUsage));
  this.material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name='Expression background collage';this.mesh.renderOrder=order;this.mesh.frustumCulled=false;parent.add(this.mesh);
  this.filter=createAffectVisualState({transitionMs:900,intensityTimeConstantMs:260});this.clear();
 }
 clear(){this.filter.reset();this.phase=0;this.lastTime=null;this.owner=undefined;this.seed=1;this.hide();}
 hide(){this.geometry.setDrawRange(0,0);this.mesh.visible=false;this.stats={visible:false,vertices:0,kind:'background-collage'};}
 reproject(){} // Screen-relative composition is rebuilt for the new viewport.
 triangle(a,b,c,command){
  if(this.count+3>this.capacity)return;
  for(const p of [a,b,c]){const i=this.count++,j=i*3;this.buffers.position.set([p.x,p.y,0],j);this.buffers.aColor.set([command.color.r,command.color.g,command.color.b],j);this.buffers.aAlpha[i]=command.alpha;this.buffers.aPattern[i]=command.pattern;}
 }
 update(person,projection,now,{expression,enabled=true,owner=null,paused=false,reducedMotion=false,viewport={width:1440,height:900}}={}){
  if(owner!==this.owner){this.clear();this.owner=owner;this.seed=seedOf(owner);}
  const fresh=!Number.isFinite(person?.faceObservedAt)||now-person.faceObservedAt<800;
  const eligible=Boolean(enabled&&projection&&person?.faceSeen&&!person.stale&&fresh);
  const state=this.filter.update(expression,now,{eligible,owner,paused});this.visualState=state;
  const dt=this.lastTime===null?0:clamp((now-this.lastTime)/1000,0,.1);this.lastTime=now;
  if(!state.visible){this.hide();return this.stats;}
  if(!paused&&!reducedMotion){const strength=AFFECT_FAMILIES.reduce((v,f)=>v+(state.weights[f]||0)*(state.strengths[f]||0),0);this.phase+=dt*mixParameter(state,'speed')*(.7+strength);}
  const commands=composeBackdrop(state,this.phase,this.seed,viewport.width,viewport.height);this.count=0;
  for(const command of commands){
   const points=command.points;
   if(command.type==='fill'){
    const center=points.reduce((p,q)=>({x:p.x+q.x/points.length,y:p.y+q.y/points.length}),{x:0,y:0});
    for(let i=0;i<points.length;i++)this.triangle(center,points[i],points[(i+1)%points.length],command);
   }else for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.y-a.y)||1,nx=-(b.y-a.y)/length*command.width/2,ny=(b.x-a.x)/length*command.width/2;
    const p={x:a.x+nx,y:a.y+ny},q={x:a.x-nx,y:a.y-ny},r={x:b.x+nx,y:b.y+ny},s={x:b.x-nx,y:b.y-ny};this.triangle(p,q,r,command);this.triangle(r,q,s,command);
   }
  }
  for(const attribute of Object.values(this.geometry.attributes)){attribute.clearUpdateRanges();attribute.addUpdateRange(0,this.count*attribute.itemSize);attribute.needsUpdate=true;}
  this.geometry.setDrawRange(0,this.count);this.mesh.visible=true;
  this.stats={visible:true,kind:'background-collage',family:state.family,intensity:state.intensity,vertices:this.count,blocks:20,lineBundles:4,phase:this.phase,weights:{...state.weights}};return this.stats;
 }
 dispose(){this.clear();this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
}
