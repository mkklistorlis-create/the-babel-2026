/** Figma 134:11, three hollow, tilted orbits around the tracked chest.
 * The visual families describe an artistic mapping of facial movements, not
 * a psychological diagnosis. No extra camera, speech or inference pipeline. */
import * as THREE from './vendor/three.module.js';
import {AFFECT_FAMILIES,AFFECT_REFERENCE,createAffectVisualState,sampleAffectStyle} from './affect-visual-state.js';

const TAU=Math.PI*2,DEG=Math.PI/180;
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number(v)||0));
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const rotate=(p,angle)=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
const ellipse=(rx,ry,t)=>({x:rx*Math.cos(t),y:ry*Math.sin(t)});
const paletteCache=new Map(),arcCache=new Map();

/** Numerical inverse arc-length lookup: chevrons are equally spaced along an
 * ellipse, rather than bunched at its narrow ends by equal-angle sampling. */
export function ellipseArcSites(rx,ry,count=64){
 const key=`${rx}:${ry}:${count}`;if(arcCache.has(key))return arcCache.get(key);
 const divisions=4096,lengths=new Float64Array(divisions+1);let previous=ellipse(rx,ry,0);
 for(let i=1;i<=divisions;i++){const p=ellipse(rx,ry,i/divisions*TAU);lengths[i]=lengths[i-1]+Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;}
 const total=lengths[divisions],sites=[];let cursor=1;
 for(let i=0;i<count;i++){
  const target=i/count*total;while(cursor<divisions&&lengths[cursor]<target)cursor++;
  const fraction=(target-lengths[cursor-1])/(lengths[cursor]-lengths[cursor-1]||1),angle=(cursor-1+fraction)/divisions*TAU;
  const p=ellipse(rx,ry,angle),dx=-rx*Math.sin(angle),dy=ry*Math.cos(angle),length=Math.hypot(dx,dy);
  sites.push({point:p,tangent:{x:dx/length,y:dy/length},angle,distance:target});
 }
 const result={sites,total};arcCache.set(key,result);return result;
}

/** Return only stroke centre-lines. Even surprise has three continuous hollow
 * loops: its spikes belong to the orbit edge, with no central disk or fill. */
export function buildAffectPaths(family,intensity,{phase=0,reducedMotion=false}={}){
 const style=sampleAffectStyle(family,intensity),g=style.geometry,paths=[];
 const breathing=!reducedMotion&&(family==='calm'||family==='joy')?1+Math.sin(phase*.72)*.012:1;
 const rx=g.radiusX*g.scale*breathing,ry=g.radiusY*g.scale*breathing,offset=g.offsetY||0;
 for(let ring=0;ring<g.angles.length;ring++){
  const angle=g.angles[ring]*DEG,depthRadius=Math.sqrt(Math.abs(rx*rx-ry*ry));
  // Lift the reference ellipse into an inclined orbital plane. Its near half
  // is drawn in front of the torso; its far half is occluded by the torso.
  const transform=p=>{const q=rotate(p,angle);return {x:q.x,y:q.y+offset,
   z:(rx>=ry?p.y/ry:p.x/rx)*depthRadius,orbitX:p.x/rx,orbitY:p.y/ry};};
  if(g.kind==='chevrons'){
   const half=g.chevronLeg/Math.SQRT2,arc=ellipseArcSites(rx,ry,g.chevronCount);
   for(const site of arc.sites){
    const c=site.point,t=site.tangent,n={x:t.y,y:-t.x};
    // The open arrow follows the orbit tangent. A radial V would span 16 px
    // along a roughly 14 px arc gap and merge into an unintended toothed ring.
    const points=[{x:c.x-t.x*half+n.x*half,y:c.y-t.y*half+n.y*half},c,{x:c.x-t.x*half-n.x*half,y:c.y-t.y*half-n.y*half}].map(transform);
    paths.push({points,closed:false,ring,family,kind:g.kind,arcDistance:site.distance,...style});
   }
  }else if(g.kind==='spiked'){
   const points=[],period=TAU/g.spikeCount,shoulder=.044;
   for(let i=0;i<g.spikeCount;i++){
    const start=i*period,peak=start+period/2;
    for(let j=i?1:0;j<6;j++)points.push(transform(ellipse(rx,ry,start+(period/2-shoulder)*j/6)));
    points.push(transform(ellipse(rx,ry,peak-shoulder)));
    const p=ellipse(rx,ry,peak),nx=Math.cos(peak)/rx,ny=Math.sin(peak)/ry,length=Math.hypot(nx,ny);
    points.push({...transform({x:p.x+nx/length*g.spikeHeight,y:p.y+ny/length*g.spikeHeight}),spike:true});
    points.push(transform(ellipse(rx,ry,peak+shoulder)));
    for(let j=1;j<=6;j++)points.push(transform(ellipse(rx,ry,peak+shoulder+(period/2-shoulder)*j/6)));
   }
   // The closing point duplicates the first; remove it for a clean ribbon join.
   points.pop();paths.push({points,closed:true,ring,family,kind:g.kind,...style});
  }else{
   const points=[];
   for(let i=0;i<192;i++)points.push(transform(ellipse(rx,ry,i/192*TAU)));
   paths.push({points,closed:true,ring,family,kind:g.kind,...style});
  }
 }
 return paths;
}

export function affectBounds(paths){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const path of paths)for(const p of path.points){const margin=path.width*(path.kind==='spiked'?1.25:.75);minX=Math.min(minX,p.x-margin);minY=Math.min(minY,p.y-margin);maxX=Math.max(maxX,p.x+margin);maxY=Math.max(maxY,p.y+margin);}
 return Number.isFinite(minX)?{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY}:null;
}

const posePoint=p=>finite(p)&&Number.isFinite(p.visibility)&&p.visibility>=.55&&(!Number.isFinite(p.presence)||p.presence>=.55);
/** Reuse the already measured torso. Missing hips do not turn the accessory
 * back into a head halo; the shoulder axis still supplies a chest estimate. */
export function affectChestAnchor(person,projection,now){
 if(!person||!projection)return null;
 const points=person.landmarks||[],left=points[11],right=points[12];
 const observed=person.poseObservedAt??person.faceObservedAt;
 const fresh=!Number.isFinite(now)||!Number.isFinite(observed)||(now>=observed&&now-observed<800);
 if(fresh&&person.rawSource!=='face-landmarks'&&posePoint(left)&&posePoint(right)){
  const a=projection.point(left.x,left.y),b=projection.point(right.x,right.y),sx=(a.x+b.x)/2,sy=(a.y+b.y)/2;
  const dx=b.x-a.x,dy=b.y-a.y,span=Math.hypot(dx,dy);
  if(span>=8){
   if(posePoint(points[23])&&posePoint(points[24])){
    const h=projection.point((points[23].x+points[24].x)/2,(points[23].y+points[24].y)/2);
    if(h.y-sy>span*.18&&Math.hypot(h.x-sx,h.y-sy)<projection.height*1.8)
     return {x:sx+(h.x-sx)*.28,y:sy+(h.y-sy)*.28,kind:'torso',shoulderSpan:span};
   }
   let nx=-dy/span,ny=dx/span;if(ny<0){nx=-nx;ny=-ny;}
   return {x:sx+nx*span*.38,y:sy+ny*span*.38,kind:'shoulders',shoulderSpan:span};
  }
 }
 if(!finite(person.faceCenter)||!person.faceBBox)return null;
 const face=projection.point(person.faceCenter.x,person.faceCenter.y),head=projection.box(person.faceBBox);
 return {x:face.x,y:head.y+head.height*1.75,kind:'face-estimate',shoulderSpan:null};
}

/** Preserve the anatomical centre even near a crop edge. Fitting the whole
 * drawing by moving its centre upward produced the old behind-head halo. */
export function affectRingPlacement(person,projection,viewport,bounds,now){
 if(!finite(person?.faceCenter)||!person.faceBBox||!projection||!bounds)return null;
 const width=viewport.width,height=viewport.height;if(!(width>0&&height>0))return null;
 const chest=affectChestAnchor(person,projection,now);if(!chest)return null;
 const padding=Math.min(16,width*.03,height*.03);
 // The reference frame has generous side margins. A narrow duet pane keeps
 // the camera's vertical cover scale, then fits the actual strokes, rather
 // than shrinking those margins along with the artwork into the person's face.
 let scale=Math.min(height/AFFECT_REFERENCE.height,2.25);
 scale=Math.min(scale,(width-padding*2)/Math.max(1,bounds.width),(height-padding*2)/Math.max(1,bounds.height));
 if(!(scale>0))return null;
 return {...chest,scale};
}

/** Decorative light uses time only; it never feeds expression statistics. */
export function affectLightPhase(phase=0){
 const t=Number.isFinite(phase)?phase:0;
 return {breath:.86+.14*Math.sin(t*TAU/5.6),travel:t*.55};
}
const vertex=`attribute vec3 aColor;attribute float aAlpha;attribute vec2 aOrbit;attribute float aEdge;
varying vec3 vColor;varying float vAlpha;varying vec2 vOrbit;varying float vEdge;
void main(){vColor=aColor;vAlpha=aAlpha;vOrbit=aOrbit;vEdge=aEdge;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment=`varying vec3 vColor;varying float vAlpha;varying vec2 vOrbit;varying float vEdge;
uniform float uBreath,uTravel;
void main(){
 float edge=1.-smoothstep(.72,1.,abs(vEdge));
 float wave=.5+.5*dot(normalize(vOrbit),vec2(cos(uTravel),sin(uTravel)));
 float sheen=pow(clamp(wave,0.,1.),10.);
 vec3 lit=mix(vColor,vec3(1.),.025+.10*sheen);
 gl_FragColor=vec4(lit,vAlpha*uBreath*(.90+.10*sheen)*edge);
#include <colorspace_fragment>
}`;

function gradient(palette,stops,t){
 const key=palette.join(':');let colors=paletteCache.get(key);if(!colors){colors=palette.map(hex=>new THREE.Color(hex));paletteCache.set(key,colors);}
 const value=clamp(t);let at=1;while(at<stops.length-1&&value>stops[at])at++;
 const a=colors[at-1],b=colors[at],u=clamp((value-stops[at-1])/(stops[at]-stops[at-1]||1));
 return {r:a.r+(b.r-a.r)*u,g:a.g+(b.g-a.g)*u,b:a.b+(b.b-a.b)*u};
}

export class AffectRings{
 constructor(parent,{order=-30,frontOrder=5,maxVertices=24576}={}){
  this.capacity=Math.max(3,Math.floor(maxVertices/3)*3);this.positions=new Float32Array(this.capacity*3);this.colors=new Float32Array(this.capacity*3);this.alphas=new Float32Array(this.capacity);this.orbits=new Float32Array(this.capacity*2);this.edges=new Float32Array(this.capacity);
  this.geometry=new THREE.BufferGeometry();this.frontGeometry=new THREE.BufferGeometry();this.geometry.setDrawRange(0,0);this.frontGeometry.setDrawRange(this.capacity,0);
  // Both draw calls share one fixed vertex budget. Back segments grow from
  // the start; front segments grow from the end. No full-buffer copies.
  for(const[name,array,size]of[['position',this.positions,3],['aColor',this.colors,3],['aAlpha',this.alphas,1],['aOrbit',this.orbits,2],['aEdge',this.edges,1]]){
   const attribute=new THREE.BufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage);
   this.geometry.setAttribute(name,attribute);this.frontGeometry.setAttribute(name,attribute);
  }
  this.material=new THREE.ShaderMaterial({uniforms:{uBreath:{value:.86},uTravel:{value:0}},vertexShader:vertex,fragmentShader:fragment,transparent:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false});
  this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name='Chest orbits · far side';this.mesh.renderOrder=order;this.mesh.frustumCulled=false;this.mesh.visible=false;parent.add(this.mesh);
  this.frontMesh=new THREE.Mesh(this.frontGeometry,this.material);this.frontMesh.name='Chest orbits · near side';this.frontMesh.renderOrder=frontOrder;this.frontMesh.frustumCulled=false;this.frontMesh.visible=false;parent.add(this.frontMesh);
  this.filter=createAffectVisualState();this.phase=0;this.lastTime=null;this.anchor=null;this.owner=undefined;this.count=0;this.backCount=0;this.frontCount=0;this.stats={visible:false,vertices:0,pathCount:0};
 }
 _hide(){this.count=0;this.backCount=0;this.frontCount=0;this.geometry.setDrawRange(0,0);this.frontGeometry.setDrawRange(this.capacity,0);this.mesh.visible=false;this.frontMesh.visible=false;this.stats={visible:false,vertices:0,pathCount:0};}
 clear(){this.filter.reset();this.anchor=null;this.lastTime=null;this.phase=0;this._hide();}
 reproject(){this.anchor=null;}
 _vertex(i,p,edge,alpha,placement,side){
  const j=i*3;this.positions[j]=placement.x+p.x*placement.scale;this.positions[j+1]=placement.y+p.y*placement.scale;this.positions[j+2]=edge.z*placement.scale;
  this.colors[j]=edge.color.r;this.colors[j+1]=edge.color.g;this.colors[j+2]=edge.color.b;this.alphas[i]=alpha;
  this.orbits[i*2]=edge.orbitX;this.orbits[i*2+1]=edge.orbitY;this.edges[i]=side;
 }
 _quad(a,b,alpha,placement){
  if(this.count+6>this.capacity)return;
  const front=a.z+b.z>=0,index=front?this.capacity-this.frontCount-6:this.backCount;
  this._vertex(index,a.left,a,alpha,placement,-1);this._vertex(index+1,a.right,a,alpha,placement,1);this._vertex(index+2,b.left,b,alpha,placement,-1);
  this._vertex(index+3,b.left,b,alpha,placement,-1);this._vertex(index+4,a.right,a,alpha,placement,1);this._vertex(index+5,b.right,b,alpha,placement,1);
  this.count+=6;if(front)this.frontCount+=6;else this.backCount+=6;
 }
 _ribbon(path,placement,weight){
  const points=path.points,n=points.length,half=path.width/2,edges=[];if(n<2)return;
  for(let i=0;i<n;i++){
   const p=points[i],previous=points[i===0?(path.closed?n-1:0):i-1],next=points[i===n-1?(path.closed?0:n-1):i+1];
   const ax=p.x-previous.x,ay=p.y-previous.y,bx=next.x-p.x,by=next.y-p.y,al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
   const n1=al>.0001?{x:-ay/al,y:ax/al}:{x:-by/(bl||1),y:bx/(bl||1)},n2=bl>.0001?{x:-by/bl,y:bx/bl}:n1;
   let nx=n1.x+n2.x,ny=n1.y+n2.y,length=Math.hypot(nx,ny);if(length<.001){nx=n2.x;ny=n2.y;length=1;}nx/=length;ny/=length;
   const extension=Math.min(half*2.5,half/Math.max(.4,Math.abs(nx*n2.x+ny*n2.y))),color=gradient(path.palette,path.gradientStops,(p.x+220)/440);
   const orbit=rotate({x:p.orbitX,y:p.orbitY},path.ring*.8);
   edges.push({left:{x:p.x+nx*extension,y:p.y+ny*extension},right:{x:p.x-nx*extension,y:p.y-ny*extension},z:p.z,orbitX:orbit.x,orbitY:orbit.y,color});
  }
  const segments=path.closed?n:n-1,alpha=clamp(path.opacity*weight);
  for(let i=0;i<segments;i++){
   if(this.count+6>this.capacity)break;const a=edges[i],b=edges[(i+1)%n];
   if(a.z*b.z<0){
    const t=-a.z/(b.z-a.z),lerp=(x,y)=>x+(y-x)*t;
    const mid={left:{x:lerp(a.left.x,b.left.x),y:lerp(a.left.y,b.left.y)},right:{x:lerp(a.right.x,b.right.x),y:lerp(a.right.y,b.right.y)},z:0,
     orbitX:lerp(a.orbitX,b.orbitX),orbitY:lerp(a.orbitY,b.orbitY),color:{r:lerp(a.color.r,b.color.r),g:lerp(a.color.g,b.color.g),b:lerp(a.color.b,b.color.b)}};
    this._quad(a,mid,alpha,placement);this._quad(mid,b,alpha,placement);
   }else this._quad(a,b,alpha,placement);
  }
 }
 update(person,projection,now,{expression,enabled=true,owner=null,paused=false,reducedMotion=false,viewport={width:900,height:430}}={}){
  const fresh=!Number.isFinite(person?.faceObservedAt)||now-person.faceObservedAt<800;
  const eligible=Boolean(enabled&&projection&&person?.faceSeen&&!person.stale&&fresh&&finite(person.faceCenter));
  if(owner!==this.owner){this.anchor=null;this.phase=0;this.lastTime=null;this.owner=owner;}
  const state=this.filter.update(expression,now,{eligible,owner,paused});this.visualState=state;
  const dt=this.lastTime===null?0:clamp((now-this.lastTime)/1000,0,.1);this.lastTime=now;
  if(!state.visible){this.anchor=null;this._hide();return this.stats;}
  if(!paused&&!reducedMotion)this.phase+=dt;
  const paths=[],weights=[];
  for(const family of AFFECT_FAMILIES){const weight=state.weights[family]||0;if(weight<.001)continue;for(const path of buildAffectPaths(family,state.strengths[family],{phase:reducedMotion?0:this.phase,reducedMotion})){paths.push(path);weights.push(weight);}}
  const bounds=affectBounds(paths),placement=affectRingPlacement(person,projection,viewport,bounds,now);
  if(!placement){this._hide();return this.stats;}
  if(!this.anchor)this.anchor={...placement};else{
   const follow=1-Math.exp(-dt*10);for(const key of['x','y','scale'])this.anchor[key]+=(placement[key]-this.anchor[key])*follow;
   this.anchor.scale=Math.min(this.anchor.scale,placement.scale);this.anchor.kind=placement.kind;
  }
  this.count=0;this.backCount=0;this.frontCount=0;for(let i=0;i<paths.length;i++)this._ribbon(paths[i],this.anchor,weights[i]);
  // Upload only live vertices; the fixed capacity remains available for a
  // five-family crossfade without transferring empty buffer tails every frame.
  for(const name of['position','aColor','aAlpha','aOrbit','aEdge']){
   const attribute=this.geometry.getAttribute(name);attribute.clearUpdateRanges();
   if(this.backCount)attribute.addUpdateRange(0,this.backCount*attribute.itemSize);
   if(this.frontCount)attribute.addUpdateRange((this.capacity-this.frontCount)*attribute.itemSize,this.frontCount*attribute.itemSize);
   attribute.needsUpdate=true;
  }
  const light=affectLightPhase(this.phase);this.material.uniforms.uBreath.value=light.breath;this.material.uniforms.uTravel.value=light.travel;
  this.geometry.setDrawRange(0,this.backCount);this.frontGeometry.setDrawRange(this.capacity-this.frontCount,this.frontCount);this.mesh.visible=this.backCount>0;this.frontMesh.visible=this.frontCount>0;
  this.stats={visible:this.count>0,family:state.family,intensity:state.intensity,vertices:this.count,backVertices:this.backCount,frontVertices:this.frontCount,pathCount:paths.length,scale:this.anchor.scale,
   anchor:{x:this.anchor.x,y:this.anchor.y,kind:this.anchor.kind},breath:light.breath,activeFamilies:AFFECT_FAMILIES.filter(key=>state.weights[key]>.001)};
  return this.stats;
 }
 dispose(){this.clear();this.mesh.removeFromParent();this.frontMesh.removeFromParent();this.geometry.dispose();this.frontGeometry.dispose();this.material.dispose();}
}
