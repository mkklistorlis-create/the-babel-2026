/** Cobalt print treatment for existing index-fingertip trails only.
 * HandTrailTracker owns input identity, gaps and source freshness. This layer
 * styles its measured strokes without changing camera/body/emoji rendering. */
import * as THREE from './vendor/three.module.js';
import {InkLayer,PALETTE,clamp,parallelPath,smoothPath} from './cobalt-geometry.js';

const valid=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&Number.isFinite(p?.t)
 &&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;

export class FingertipInk {
 constructor(parent,{lifetimeMs=950,maxStrokes=12,maxPoints=96,order=20}={}){
  this.lifetimeMs=Math.max(100,lifetimeMs);this.maxStrokes=Math.max(1,Math.min(12,maxStrokes));
  this.maxPoints=Math.max(2,Math.min(96,maxPoints));this.styles=new Map();
  this.group=new THREE.Group();this.group.name='Fingertip ink';parent.add(this.group);
  const options={adaptive:false,maxVertices:65520};
  this.light=new InkLayer(this.group,{...options,color:PALETTE.ivory,order});
  this.blue=new InkLayer(this.group,{...options,color:PALETTE.cobalt,order:order+1});
  this.detail=new InkLayer(this.group,{...options,color:PALETTE.ivory,order:order+2});
  this.layers=[this.light,this.blue,this.detail];this.stats={strokeCount:0,vertices:0,handIds:[]};
 }
 clear(){
  for(const layer of this.layers){layer.begin(1,1);layer.end();}
  this.styles.clear();this.stats={strokeCount:0,vertices:0,handIds:[]};
 }
 update(strokes,projection,now,{enabled=true,paused=false,viewport={width:1,height:1}}={}){
  if(!enabled||!Number.isFinite(now)||typeof projection?.point!=='function'){this.clear();return this.stats;}
  if(paused)return this.stats;
  for(const layer of this.layers)layer.begin(viewport.width||1,viewport.height||1);
  let count=0;const ids=new Set();
  for(const stroke of (Array.isArray(strokes)?strokes:[]).slice(-this.maxStrokes)){
   if(typeof stroke?.handId!=='string'||!Array.isArray(stroke.points))continue;
   const samples=stroke.points.slice(-this.maxPoints);
   // An invalid point cannot silently bridge two otherwise valid sections.
   if(samples.some(p=>!valid(p)||p.t>now+50))continue;
   const fresh=samples.filter(p=>now-p.t<this.lifetimeMs);if(fresh.length<2)continue;
   const points=fresh.map((p,i)=>{
    const previous=fresh[Math.max(0,i-1)],dt=p.t-previous.t;
    const speed=dt>0?clamp(Math.hypot(p.x-previous.x,p.y-previous.y)*1000/dt,0,1.3):0;
    return {...projection.point(p.x,p.y),t:p.t,speed,opacity:clamp(1-(now-p.t)/this.lifetimeMs)**1.35};
   });
   if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))continue;
   const path=smoothPath(points,2);let length=0;
   for(let i=1;i<path.length;i++)length+=Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y);
   if(length<1.5)continue;
   let style=this.styles.get(stroke.handId);
   if(!style){style=stroke.handedness==='Right'?'B':stroke.handedness==='Left'?'A':this.styles.size%2?'B':'A';this.styles.set(stroke.handId,style);}
   ids.add(stroke.handId);count++;
   if(style==='A')this.drawFine(path);else this.drawRibbon(path);
  }
  for(const id of this.styles.keys())if(!ids.has(id))this.styles.delete(id);
  for(const layer of this.layers)layer.end();
  this.stats={strokeCount:count,vertices:this.layers.reduce((sum,layer)=>sum+layer.count,0),handIds:[...ids]};
  return this.stats;
 }
 drawFine(path){
  const speed=path.reduce((sum,p)=>sum+p.speed,0)/path.length,spread=2.2+clamp(speed)*3.4;
  // A quiet ivory keyline keeps blue pen strokes readable over the unchanged
  // photographic background without introducing any new background panel.
  this.light.path(path,{width:2.7,alpha:(_,p)=>p.opacity*.62});
  this.blue.path(path,{width:1.15,alpha:(_,p)=>p.opacity*.98});
  for(const side of[-2,-1,1,2])this.blue.path(parallelPath(path,side*spread),{
   width:Math.abs(side)===1?.7:.55,alpha:(_,p)=>p.opacity*(Math.abs(side)===1?.72:.5),dash:Math.abs(side)===2?5:0,
  });
  if(speed>.025)for(let i=6;i<path.length;i+=12){
   const p=path[i],a=path[i-1],b=path[Math.min(path.length-1,i+1)],distance=Math.hypot(b.x-a.x,b.y-a.y)||1;
   const nx=-(b.y-a.y)/distance,ny=(b.x-a.x)/distance;
   this.blue.segment({x:p.x-nx*spread*1.5,y:p.y-ny*spread*1.5},{x:p.x+nx*spread*1.5,y:p.y+ny*spread*1.5},.55,p.opacity*.55);
  }
 }
 drawRibbon(path){
  const width=(t,p)=>(4+clamp(p.speed)*7)*(Math.sin(Math.PI*t)*.3+.7);
  this.light.path(path,{width:(t,p)=>width(t,p)+2.3,alpha:(_,p)=>p.opacity*.8});
  this.blue.path(path,{width,alpha:(_,p)=>p.opacity*.96});
  this.detail.path(parallelPath(path,-1.2),{width:.8,alpha:(_,p)=>p.opacity*.9});
  this.detail.path(parallelPath(path,1.4),{width:.6,alpha:(_,p)=>p.opacity*.62,dash:3.5});
 }
 dispose(){for(const layer of this.layers)layer.dispose();this.group.removeFromParent();this.styles.clear();}
}
