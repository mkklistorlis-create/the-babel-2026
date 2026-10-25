import test from 'node:test';
import assert from 'node:assert/strict';
import {MaskStabilizer} from '../public/mask-stability.js';

const W=80,H=64;
const makeMask=fn=>({width:W,height:H,data:Float32Array.from({length:W*H},(_,i)=>fn(i%W,Math.floor(i/W))),complete:true,source:'selfie-segmentation'});
const rectangle=(x,y,dx=0)=>x>=20+dx&&x<45+dx&&y>=10&&y<55;
const difference=(a,b)=>a.reduce((sum,p,i)=>sum+Math.abs(p-b[i])/255,0);
const centroid=data=>{
 let area=0,x=0,y=0;for(let i=0;i<data.length;i++)if(data[i]>=128){area++;x+=i%W;y+=Math.floor(i/W);}
 return {x:x/area,y:y/area,area};
};

test('static uncertain-edge noise has materially lower visible alpha churn while a real arm gap remains open',()=>{
 const filter=new MaskStabilizer();let previous=null,rawPrevious=null,churn=0,rawChurn=0;
 for(let frame=0;frame<24;frame++){
  const m=makeMask((x,y)=>{
   if(x>=20&&x<45&&y>=15&&y<55&&!(x>=28&&x<=35&&y<37))return .95;
   if(x===19&&y>=16&&y<54)return frame%2?.27:.07;
   return .01;
  });
  const options={timestamp:1000+frame*66,anchor:{x:.4,y:.25},occupancy:'single'};
  const current=filter.update(m,options),unfiltered=new MaskStabilizer().update(m,options);
  if(frame>4){churn+=difference(current.data,previous);rawChurn+=difference(unfiltered.data,rawPrevious);}
  previous=current.data;rawPrevious=unfiltered.data;
  assert.equal(current.data[25*W+31],0,'concavity remains open instead of filling a hull');
  assert.equal(current.data[40*W+25],255,'foreground interior stays completely opaque');
 }
 assert.ok(churn<rawChurn*.65,`visible edge churn ${churn.toFixed(1)} versus ${rawChurn.toFixed(1)}`);
});

test('small measured translation follows the person without temporal centroid lag or trailing pixels',()=>{
 const filter=new MaskStabilizer();
 for(let frame=0;frame<10;frame++){
  const dx=frame*2,m=makeMask((x,y)=>rectangle(x,y,dx)?.95:.01);
  const result=filter.update(m,{timestamp:1000+frame*66,anchor:{x:(32+dx)/W,y:.25},occupancy:'single'});
  const center=centroid(result.data);
  assert.ok(Math.abs(center.x-(32+dx))<.6,`frame ${frame} centroid ${center.x}`);
  if(frame)assert.equal(result.stability.shiftX,2);
  assert.equal(result.data[30*W+Math.max(0,17+dx)],0,'no history trail outside current coverage');
 }
});

test('local hand movement updates immediately even when the face and torso stay stationary',()=>{
 const filter=new MaskStabilizer();
 const hand=(x,y,dx)=>x>=48+dx&&x<54+dx&&y>=28&&y<34;
 for(let frame=0;frame<8;frame++)filter.update(makeMask((x,y)=>rectangle(x,y)||hand(x,y,0)?.95:.01),{timestamp:1000+frame*66,anchor:{x:.4,y:.25},occupancy:'single'});
 const moved=filter.update(makeMask((x,y)=>rectangle(x,y)||hand(x,y,10)?.95:.01),{timestamp:1600,anchor:{x:.4,y:.25},occupancy:'single'});
 assert.equal(moved.data[30*W+50],0,'old hand position clears');
 assert.equal(moved.data[30*W+60],255,'new hand position is opaque immediately');
 assert.equal(moved.data[40*W+30],255,'stationary torso is retained');
});

test('large jump, elapsed-time gap, and exit/reentry reset history without ghost silhouettes',()=>{
 for(const kind of ['jump','gap','occupancy']){
  const filter=new MaskStabilizer();
  filter.update(makeMask((x,y)=>rectangle(x,y)?.95:.01),{timestamp:1000,anchor:{x:.4,y:.25},occupancy:'single'});
  const shifted=filter.update(makeMask((x,y)=>rectangle(x,y,25)?.95:.01),{timestamp:kind==='gap'?2000:1066,anchor:{x:kind==='jump'?.75:.4,y:.25},occupancy:kind==='occupancy'?'multiple':'single'});
  assert.ok(shifted.stability.resetReason);
  assert.equal(shifted.data[30*W+25],0,`${kind} must not retain the old body`);
  assert.equal(shifted.data[30*W+60],255);
  const empty=filter.update(makeMask(()=>.01),{timestamp:2066,anchor:null,occupancy:'empty'});
  assert.equal(empty.data.reduce((a,b)=>a+b,0),0,'complete exit clears all pixels');
  const reentry=filter.update(makeMask((x,y)=>rectangle(x,y)?.95:.01),{timestamp:2132,anchor:{x:.4,y:.25},occupancy:'single'});
  assert.equal(reentry.data[30*W+60],0,'reentry does not inherit previous occupant bounds');
 }
});

test('incorrect motion anchors are rejected by image evidence; invalid values never wrap or poison mask data',()=>{
 const filter=new MaskStabilizer(),m=makeMask((x,y)=>rectangle(x,y)?.95:.01);
 filter.update(m,{timestamp:1000,anchor:{x:.4,y:.25},occupancy:'single'});
 const wrong=filter.update(m,{timestamp:1066,anchor:{x:.37,y:.25},occupancy:'single'});
 assert.equal(wrong.stability.shiftX,0,'stationary image overrides a spurious head movement');
 m.data[0]=NaN;m.data[1]=Infinity;
 const noAnchor=filter.update(m,{timestamp:1132,anchor:{x:NaN,y:Infinity},occupancy:'single'});
 assert.ok(noAnchor.data.every(p=>Number.isFinite(p)&&p>=0&&p<=255));
 assert.equal(noAnchor.data[0],0);assert.equal(noAnchor.data[W-1],0);
});

test('current probable foreground is opaque and output ownership cannot detach future history',()=>{
 const filter=new MaskStabilizer(),m=makeMask((x,y)=>rectangle(x,y)?.4:.01);
 const first=filter.update(m,{timestamp:1000,anchor:{x:.4,y:.25},occupancy:'single'});
 assert.equal(first.encoding,'alpha8');assert.equal(first.authoritative,true);assert.equal(first.complete,true);
 assert.equal(first.data[30*W+30],255);
 structuredClone(first.data,{transfer:[first.data.buffer]});
 const second=filter.update(m,{timestamp:1066,anchor:{x:.4,y:.25},occupancy:'single'});
 assert.equal(second.data[30*W+30],255,'internal float history is not the transferred alpha buffer');
});
