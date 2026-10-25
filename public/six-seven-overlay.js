/** A two-texture hand accessory. Existing camera, particles and ink are untouched. */
import * as THREE from './vendor/three.module.js';
import {SixSevenGestureTracker} from './six-seven-gesture.js';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
// Original condensed, chunky title numerals: no remote font or font download.
const GLYPHS={
 '6':'M 80 8 L 88 38 Q 60 30 49 48 L 45 58 Q 69 49 82 63 Q 101 83 87 121 Q 76 145 45 145 Q 12 142 12 107 Q 13 76 25 43 Q 40 3 80 8 Z M 48 83 Q 34 89 36 108 Q 38 120 49 118 Q 62 115 63 98 Q 63 84 48 83 Z',
 '7':'M 13 8 L 95 8 L 92 39 L 53 145 L 18 145 L 57 41 L 8 41 Z',
};

function numeralTexture(digit){
 const canvas=document.createElement('canvas');canvas.width=384;canvas.height=512;
 const ctx=canvas.getContext('2d'),path=new Path2D(GLYPHS[digit]);
 ctx.scale(2.65,2.65);ctx.translate(27,17);ctx.transform(1,0,-.085,1,7,0);
 ctx.lineJoin='round';
 // Crisp offset extrusion, then an ivory face with a navy contour.
 ctx.save();ctx.translate(6,7);ctx.strokeStyle='#141b42';ctx.fillStyle='#7766e9';ctx.lineWidth=10;
 ctx.stroke(path);ctx.fill(path,'evenodd');ctx.restore();
 ctx.strokeStyle='#141b42';ctx.lineWidth=8;ctx.stroke(path);
 ctx.fillStyle='#fffdf0';ctx.fill(path,'evenodd');
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.minFilter=texture.magFilter=THREE.LinearFilter;
 return texture;
}

export class SixSevenOverlay{
 constructor(scene){
  this.scene=scene;this.tracker=new SixSevenGestureTracker();
  this.geometry=new THREE.PlaneGeometry(.75,1);
  this.meshes=new Map(['6','7'].map(digit=>{
   const mesh=new THREE.Mesh(this.geometry,new THREE.MeshBasicMaterial({
    map:numeralTexture(digit),transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
   }));
   mesh.renderOrder=16;mesh.visible=false;scene.add(mesh);return [digit,mesh];
  }));
  this.clear();
 }
 update(hands,projection,now,{enabled=true,owner=null,dt=0,reducedMotion=false}={}){
  const result=this.tracker.update(hands,now,{enabled:enabled&&Boolean(projection),owner});
  const entering=result.latched&&!this.latched;
  if(entering)this.startedAt=now;
  this.active=result.active;this.latched=result.latched;this.stats={...result.diagnostics,active:result.active,latched:result.latched,hands:result.hands.map(h=>({id:h.id,digit:h.digit}))};
  for(const mesh of this.meshes.values())mesh.visible=false;
  if(!result.active){if(!result.latched)this.anchors.clear();return;}
  const follow=1-Math.exp(-Math.max(0,dt)*22);
  for(const hand of result.hands){
   const mesh=this.meshes.get(hand.digit);if(!mesh)continue;
   const palm=projection.point(hand.palm.x,hand.palm.y);
   // Use the highest observed fingertip/palm for the bottom of the held glyph.
   const points=[hand.palm,hand.tip,...[4,8,12,16,20].map(i=>hand.landmarks?.[i])]
    .filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
   const top=Math.min(...points.map(p=>projection.point(p.x,p.y).y));
   const size=clamp(Math.min(projection.width,projection.height)*.24,90,190);
   // Texture margins leave the glyph baseline at 85% of its plane height.
   const target={x:palm.x,y:top-size*.35-8};
   // Gesture slots survive the ink tracker's short-lived hand IDs. Two anchors
   // stay bounded and continue interpolating through a valid reacquisition.
   let anchor=this.anchors.get(hand.digit);
   if(!anchor){anchor={...target};this.anchors.set(hand.digit,anchor);}
   else{anchor.x+=(target.x-anchor.x)*follow;anchor.y+=(target.y-anchor.y)*follow;}
   const enter=clamp((now-this.startedAt)/180,0,1);
   const pop=reducedMotion?1:.86+.14*(1-(1-enter)**3);
   mesh.position.set(anchor.x,anchor.y,16);mesh.scale.set(size*pop,-size*pop,1);
   mesh.rotation.z=hand.digit==='6'?-.09:.07;
   mesh.material.opacity=result.opacity;mesh.visible=true;
  }
 }
 clear(){
  this.tracker.reset();this.active=false;this.latched=false;this.startedAt=0;this.anchors=new Map();this.stats={active:false,latched:false,hands:[],status:'waiting-hands',crossings:0,trackedHands:0,fistHands:0,sourceAgeMs:null,sampleIntervalMs:null};
  for(const mesh of this.meshes.values())mesh.visible=false;
 }
 reproject(){this.anchors.clear();}
 dispose(){
  this.clear();for(const mesh of this.meshes.values()){
   this.scene.remove(mesh);mesh.material.map.dispose();mesh.material.dispose();
  }
  this.geometry.dispose();this.meshes.clear();
 }
}
