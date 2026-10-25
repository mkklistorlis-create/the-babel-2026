/** Figma 134:11, three hollow orbits behind the tracked person.
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
  const angle=g.angles[ring]*DEG,transform=p=>{const q=rotate(p,angle);return {x:q.x,y:q.y+offset};};
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

/** The measured upper chest, with viewport-only scale and a bounded cover crop.
 * Face tracking supplies the anchor; its changing box size cannot pump rings. */
export function affectRingPlacement(person,projection,viewport,bounds){
 if(!finite(person?.faceCenter)||!person.faceBBox||!projection||!bounds)return null;
 const width=viewport.width,height=viewport.height;if(!(width>0&&height>0))return null;
 const head=projection.box(person.faceBBox),face=projection.point(person.faceCenter.x,person.faceCenter.y),padding=Math.min(16,width*.03,height*.03);
 // The reference frame has generous side margins. A narrow duet pane keeps
 // the camera's vertical cover scale, then fits the actual strokes, rather
 // than shrinking those margins along with the artwork into the person's face.
 let scale=Math.min(height/AFFECT_REFERENCE.height,2.25);
 scale=Math.min(scale,(width-padding*2)/Math.max(1,bounds.width),(height-padding*2)/Math.max(1,bounds.height));
 if(!(scale>0))return null;
 const minX=padding-bounds.minX*scale,maxX=width-padding-bounds.maxX*scale,minY=padding-bounds.minY*scale,maxY=height-padding-bounds.maxY*scale;
 return {x:clamp(face.x,minX,maxX),y:clamp(head.y+head.height*1.35,minY,maxY),scale,minX,maxX,minY,maxY};
}

const vertex=`attribute vec3 aColor;attribute float aAlpha;varying vec3 vColor;varying float vAlpha;
void main(){vColor=aColor;vAlpha=aAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment=`varying vec3 vColor;varying float vAlpha;void main(){gl_FragColor=vec4(vColor,vAlpha);
#include <colorspace_fragment>
}`;

function gradient(palette,stops,t){
 const key=palette.join(':');let colors=paletteCache.get(key);if(!colors){colors=palette.map(hex=>new THREE.Color(hex));paletteCache.set(key,colors);}
 const value=clamp(t);let at=1;while(at<stops.length-1&&value>stops[at])at++;
 const a=colors[at-1],b=colors[at],u=clamp((value-stops[at-1])/(stops[at]-stops[at-1]||1));
 return {r:a.r+(b.r-a.r)*u,g:a.g+(b.g-a.g)*u,b:a.b+(b.b-a.b)*u};
}

export class AffectRings{
 constructor(parent,{order=-30,maxVertices=24576}={}){
  this.capacity=Math.max(3,Math.floor(maxVertices/3)*3);this.positions=new Float32Array(this.capacity*3);this.colors=new Float32Array(this.capacity*3);this.alphas=new Float32Array(this.capacity);
  this.geometry=new THREE.BufferGeometry();this.geometry.setDrawRange(0,0);
  for(const[name,array,size]of[['position',this.positions,3],['aColor',this.colors,3],['aAlpha',this.alphas,1]])this.geometry.setAttribute(name,new THREE.BufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
  this.material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false});
  this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name='Figma · three affect rings';this.mesh.renderOrder=order;this.mesh.frustumCulled=false;this.mesh.visible=false;parent.add(this.mesh);
  this.filter=createAffectVisualState();this.phase=0;this.lastTime=null;this.anchor=null;this.owner=undefined;this.count=0;this.stats={visible:false,vertices:0,pathCount:0};
 }
 clear(){this.filter.reset();this.anchor=null;this.lastTime=null;this.phase=0;this.count=0;this.geometry.setDrawRange(0,0);this.mesh.visible=false;this.stats={visible:false,vertices:0,pathCount:0};}
 reproject(){this.anchor=null;}
 _vertex(p,color,alpha,placement){const i=this.count++,j=i*3;this.positions[j]=placement.x+p.x*placement.scale;this.positions[j+1]=placement.y+p.y*placement.scale;this.positions[j+2]=0;this.colors[j]=color.r;this.colors[j+1]=color.g;this.colors[j+2]=color.b;this.alphas[i]=alpha;}
 _ribbon(path,placement,weight){
  const points=path.points,n=points.length,half=path.width/2,edges=[];if(n<2)return;
  for(let i=0;i<n;i++){
   const p=points[i],previous=points[i===0?(path.closed?n-1:0):i-1],next=points[i===n-1?(path.closed?0:n-1):i+1];
   const ax=p.x-previous.x,ay=p.y-previous.y,bx=next.x-p.x,by=next.y-p.y,al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
   const n1=al>.0001?{x:-ay/al,y:ax/al}:{x:-by/(bl||1),y:bx/(bl||1)},n2=bl>.0001?{x:-by/bl,y:bx/bl}:n1;
   let nx=n1.x+n2.x,ny=n1.y+n2.y,length=Math.hypot(nx,ny);if(length<.001){nx=n2.x;ny=n2.y;length=1;}nx/=length;ny/=length;
   const extension=Math.min(half*2.5,half/Math.max(.4,Math.abs(nx*n2.x+ny*n2.y))),color=gradient(path.palette,path.gradientStops,(p.x+220)/440);
   edges.push({left:{x:p.x+nx*extension,y:p.y+ny*extension},right:{x:p.x-nx*extension,y:p.y-ny*extension},color});
  }
  const segments=path.closed?n:n-1,alpha=clamp(path.opacity*weight);
  for(let i=0;i<segments;i++){
   if(this.count+6>this.capacity)break;const a=edges[i],b=edges[(i+1)%n];
   this._vertex(a.left,a.color,alpha,placement);this._vertex(a.right,a.color,alpha,placement);this._vertex(b.left,b.color,alpha,placement);
   this._vertex(b.left,b.color,alpha,placement);this._vertex(a.right,a.color,alpha,placement);this._vertex(b.right,b.color,alpha,placement);
  }
 }
 update(person,projection,now,{expression,enabled=true,owner=null,paused=false,reducedMotion=false,viewport={width:900,height:430}}={}){
  const fresh=!Number.isFinite(person?.faceObservedAt)||now-person.faceObservedAt<800;
  const eligible=Boolean(enabled&&projection&&person?.faceSeen&&!person.stale&&fresh&&finite(person.faceCenter));
  if(owner!==this.owner){this.anchor=null;this.phase=0;this.lastTime=null;this.owner=owner;}
  const state=this.filter.update(expression,now,{eligible,owner,paused});this.visualState=state;
  const dt=this.lastTime===null?0:clamp((now-this.lastTime)/1000,0,.1);this.lastTime=now;
  if(!state.visible){this.anchor=null;this.count=0;this.geometry.setDrawRange(0,0);this.mesh.visible=false;this.stats={visible:false,vertices:0,pathCount:0};return this.stats;}
  if(!paused&&!reducedMotion)this.phase+=dt;
  const paths=[],weights=[];
  for(const family of AFFECT_FAMILIES){const weight=state.weights[family]||0;if(weight<.001)continue;for(const path of buildAffectPaths(family,state.strengths[family],{phase:reducedMotion?0:this.phase,reducedMotion})){paths.push(path);weights.push(weight);}}
  const bounds=affectBounds(paths),placement=affectRingPlacement(person,projection,viewport,bounds);
  if(!placement){this.mesh.visible=false;this.geometry.setDrawRange(0,0);this.stats={visible:false,vertices:0,pathCount:0};return this.stats;}
  if(!this.anchor)this.anchor={...placement};else{
   const follow=1-Math.exp(-dt*10);for(const key of['x','y','scale'])this.anchor[key]+=(placement[key]-this.anchor[key])*follow;
   // Smoothing may not leave an old, larger drawing outside the current crop.
   this.anchor.scale=Math.min(this.anchor.scale,placement.scale);const padding=Math.min(16,viewport.width*.03,viewport.height*.03);
   this.anchor.x=clamp(this.anchor.x,padding-bounds.minX*this.anchor.scale,viewport.width-padding-bounds.maxX*this.anchor.scale);
   this.anchor.y=clamp(this.anchor.y,padding-bounds.minY*this.anchor.scale,viewport.height-padding-bounds.maxY*this.anchor.scale);
  }
  this.count=0;for(let i=0;i<paths.length;i++)this._ribbon(paths[i],this.anchor,weights[i]);
  // Upload only live vertices; the fixed capacity remains available for a
  // five-family crossfade without transferring empty buffer tails every frame.
  for(const name of['position','aColor','aAlpha']){const attribute=this.geometry.getAttribute(name);attribute.clearUpdateRanges();attribute.addUpdateRange(0,this.count*attribute.itemSize);attribute.needsUpdate=true;}
  this.geometry.setDrawRange(0,this.count);this.mesh.visible=this.count>0;
  this.stats={visible:this.mesh.visible,family:state.family,intensity:state.intensity,vertices:this.count,pathCount:paths.length,scale:this.anchor.scale,activeFamilies:AFFECT_FAMILIES.filter(key=>state.weights[key]>.001)};
  return this.stats;
 }
 dispose(){this.clear();this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
}
