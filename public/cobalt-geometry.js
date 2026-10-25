/** Screen-space print geometry. A single reusable triangle buffer per ink layer
 * gives fine strokes predictable thickness without platform GL line-width limits. */
import * as THREE from './vendor/three.module.js';
export const PALETTE={cobalt:'#1645DB',navy:'#071B57',electric:'#315DFF',ivory:'#F6F3E8',lavender:'#B8A5E5'};
export const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number(v)||0));
const vertex=`attribute float aAlpha;varying float vAlpha;varying vec2 vScreen;
void main(){vAlpha=aAlpha;vScreen=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment=`uniform vec3 uInk,uLight;uniform vec4 uBlock;uniform float uAdaptive;varying float vAlpha;varying vec2 vScreen;
void main(){float inside=step(uBlock.x,vScreen.x)*step(vScreen.x,uBlock.z)*step(uBlock.y,vScreen.y)*step(vScreen.y,uBlock.w);vec3 ink=mix(uInk,uLight,inside*uAdaptive);gl_FragColor=vec4(ink,vAlpha);
#include <colorspace_fragment>
}`;
export class InkLayer{
 constructor(parent,{color=PALETTE.cobalt,light=PALETTE.ivory,adaptive=true,order=10,maxVertices=180000}={}){
  this.geometry=new THREE.BufferGeometry();this.maxVertices=Math.max(3,Math.floor(maxVertices/3)*3);this.capacity=Math.min(4096,this.maxVertices);
  this.geometry.setDrawRange(0,0);
  this.positions=new Float32Array(this.capacity*3);this.alphas=new Float32Array(this.capacity);this.count=0;
  this.material=new THREE.ShaderMaterial({uniforms:{uInk:{value:new THREE.Color(color)},uLight:{value:new THREE.Color(light)},uAdaptive:{value:Number(adaptive)},uBlock:{value:new THREE.Vector4()}},vertexShader:vertex,fragmentShader:fragment,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.renderOrder=order;this.mesh.frustumCulled=false;this.mesh.visible=false;parent.add(this.mesh);this._bind();
 }
 _bind(){this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));this.geometry.setAttribute('aAlpha',new THREE.BufferAttribute(this.alphas,1).setUsage(THREE.DynamicDrawUsage));}
 begin(width,height){this.count=0;this.material.uniforms.uBlock.value.set(width*.68,height*.17,width*.965,height*.91);}
 vertex(x,y,alpha=1){
  if(this.count>=this.maxVertices)return;
  if(this.count>=this.capacity){this.capacity=Math.min(this.maxVertices,this.capacity*2);const p=new Float32Array(this.capacity*3),a=new Float32Array(this.capacity);p.set(this.positions);a.set(this.alphas);this.positions=p;this.alphas=a;this._bind();}
  const i=this.count++;this.positions[i*3]=x;this.positions[i*3+1]=y;this.positions[i*3+2]=0;this.alphas[i]=clamp(alpha);
 }
 triangle(a,b,c,alpha=1){if(this.count+3>this.maxVertices)return;this.vertex(a.x,a.y,alpha);this.vertex(b.x,b.y,alpha);this.vertex(c.x,c.y,alpha);}
 segment(a,b,width=1,alpha=1){
  const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(l<.001||alpha<=0)return;
  const nx=-dy/l*width*.5,ny=dx/l*width*.5;
  const p={x:a.x+nx,y:a.y+ny},q={x:a.x-nx,y:a.y-ny},r={x:b.x+nx,y:b.y+ny},s={x:b.x-nx,y:b.y-ny};
  this.triangle(p,q,r,alpha);this.triangle(r,q,s,alpha);
 }
 path(points,{width=1,alpha=1,closed=false,dash=0}={}){
  if(points.length<2||(typeof alpha!=='function'&&alpha<=.001))return;
  const length=points.length+(closed?1:0);let travelled=0;
  for(let i=1;i<length;i++){
   const a=points[i-1],b=points[i%points.length],d=Math.hypot(b.x-a.x,b.y-a.y);if(d<.001)continue;
   const w=typeof width==='function'?width(i/(length-1),b):width;
   const opacity=typeof alpha==='function'?alpha(i/(length-1),b):alpha;
   if(!dash)this.segment(a,b,w,opacity);
   else{
    let offset=0;
    while(offset<d){const cycle=(travelled+offset)%(dash*2),run=Math.min(d-offset,dash-(cycle%dash));if(cycle<dash){const t=offset/d,u=(offset+run)/d;this.segment({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u},w,opacity);}offset+=Math.max(.01,run);}
   }
   travelled+=d;
  }
 }
 circle(x,y,r,{width=1,alpha=1,segments=48,start=0,end=Math.PI*2}={}){const points=[];for(let i=0;i<=segments;i++){const a=start+(end-start)*i/segments;points.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r});}this.path(points,{width,alpha});}
 dot(x,y,r,alpha=1){const count=8;for(let i=0;i<count;i++){const a=i/count*Math.PI*2,b=(i+1)/count*Math.PI*2;this.triangle({x,y},{x:x+Math.cos(a)*r,y:y+Math.sin(a)*r},{x:x+Math.cos(b)*r,y:y+Math.sin(b)*r},alpha);}}
 end(){this.geometry.getAttribute('position').needsUpdate=true;this.geometry.getAttribute('aAlpha').needsUpdate=true;this.geometry.setDrawRange(0,this.count);this.mesh.visible=this.count>0;}
 dispose(){this.geometry.dispose();this.material.dispose();this.mesh.removeFromParent();}
}
export function parallelPath(points,offset){
 return points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,len=Math.max(.001,Math.hypot(dx,dy));return {...p,x:p.x-dy/len*offset,y:p.y+dx/len*offset};});
}
/** Subdivide measured control points into a smooth path without inventing input. */
export function smoothPath(points,subdivisions=3){
 if(points.length<3)return points;
 const out=[];
 for(let i=0;i<points.length-1;i++){
  const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
  for(let j=0;j<subdivisions;j++){const t=j/subdivisions,t2=t*t,t3=t2*t;
   const value=k=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3);
   out.push({...p1,x:value('x'),y:value('y'),speed:(p1.speed||0)+((p2.speed||0)-(p1.speed||0))*t,opacity:(p1.opacity??1)+((p2.opacity??1)-(p1.opacity??1))*t});
  }
 }
 out.push(points.at(-1));return out;
}
