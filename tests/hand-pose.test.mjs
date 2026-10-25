import test from 'node:test';
import assert from 'node:assert/strict';
import {isClosedFist} from '../public/hand-pose.js';

const bases=[{x:.39,y:.60,z:-.02},{x:.47,y:.55,z:-.03},{x:.55,y:.57,z:-.02},{x:.62,y:.63,z:0}];
function pose(closed=[true,true,true,true]){
 const landmarks=[{x:.5,y:.86,z:0},{x:.39,y:.78,z:0},{x:.31,y:.70,z:-.01},{x:.28,y:.62,z:-.02},{x:.25,y:.57,z:-.02}];
 for(let i=0;i<4;i++){
  const b=bases[i],s=i===3?.72:i===0?.88:1;
  landmarks.push({...b});
  for(const [dy,dz]of closed[i]?[[-.13,-.08],[-.07,-.16],[.07,-.09]]:[[-.17,0],[-.27,-.005],[-.36,-.01]]){
   landmarks.push({x:b.x,y:b.y+dy*s,z:b.z+dz*s});
  }
 }
 return {landmarks};
}

test('a closed fist qualifies while an extended palm, pointing index and V sign do not',()=>{
 assert.equal(isClosedFist(pose()),true);
 assert.equal(isClosedFist(pose([false,false,false,false])),false);
 assert.equal(isClosedFist(pose([false,false,true,true])),false);
 assert.equal(isClosedFist(pose([false,true,true,true])),false,'a pointing index must keep fingertip drawing active');
 const partial=pose();partial.landmarks[6]={x:.39,y:.47,z:-.02};
 partial.landmarks[7]={x:.44,y:.47,z:-.02};partial.landmarks[8]={x:.52,y:.47,z:-.02};
 assert.equal(isClosedFist(partial),true,'three curled fingers tolerate one partly folded finger');
});

test('classification survives mirrored, scaled, and 3D-rotated observations',()=>{
 for(const scale of [.1,.5,2])for(const angle of [0,Math.PI/2,Math.PI*.8])for(const mirror of [-1,1]){
  const transform=hand=>({landmarks:hand.landmarks.map(p=>{
   const x=(p.x-.5)*mirror,y=p.y-.5,z=p.z;
   const rx=x*Math.cos(angle)-y*Math.sin(angle),ry=x*Math.sin(angle)+y*Math.cos(angle);
   return {x:.5+scale*rx,y:.5+scale*(ry*Math.cos(.8)-z*Math.sin(.8)),z:scale*(ry*Math.sin(.8)+z*Math.cos(.8))};
  })});
  assert.equal(isClosedFist(transform(pose())),true);
  assert.equal(isClosedFist(transform(pose([false,false,false,false]))),false);
  assert.equal(isClosedFist(transform(pose([false,true,true,true]))),false);
 }
});

test('2D observations can qualify, and thumb position does not control the cue',()=>{
 const closed=pose();closed.landmarks=closed.landmarks.map(({x,y})=>({x,y}));
 assert.equal(isClosedFist(closed),true);
 for(let i=1;i<=4;i++)closed.landmarks[i]={x:.9,y:.2};
 assert.equal(isClosedFist(closed),true);
 const open=pose([false,false,false,false]);open.landmarks=open.landmarks.map(({x,y})=>({x,y}));
 assert.equal(isClosedFist(open),false);
});

test('missing, nonfinite and collapsed landmarks never count as fists',()=>{
 for(const hand of [null,{}, {landmarks:[]},{landmarks:pose().landmarks.slice(0,20)},
  {landmarks:Array.from({length:21},()=>({x:.5,y:.5,z:0}))}])assert.equal(isClosedFist(hand),false);
 for(const value of [NaN,Infinity,null]){
  const hand=pose();hand.landmarks[8].z=value;assert.equal(isClosedFist(hand),false);
 }
 const broken=pose();for(const i of [6,7,8,10,11,12])broken.landmarks[i]={...broken.landmarks[i<9?5:9]};
 assert.equal(isClosedFist(broken),false);
});
