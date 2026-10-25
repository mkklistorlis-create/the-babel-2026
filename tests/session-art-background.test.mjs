import test from 'node:test';
import assert from 'node:assert/strict';
import {ART_FAMILIES,ART_PALETTE,createArtBackground,paintArtBackground,shapeArea,shapeContains} from '../public/session-art-background.js';

const profiles=(shares=[.6,.2,.08,.04,.08],strength=.5,variation=.4)=>ART_FAMILIES.map((family,index)=>({family,share:shares[index],meanStrength:strength,variation}));
const foreground=[{x:560,y:500,r:155},{x:1090,y:465,r:120},{x:410,y:710,r:65},{x:735,y:305,r:75}];
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);

test('same session and statistics reproduce identical geometry; another session varies positions',()=>{
 const input=profiles(),options={seed:'a-session',foreground};
 const a=createArtBackground(input,options),b=createArtBackground(input,options),c=createArtBackground(input,{...options,seed:'b-session'});
 assert.deepEqual(a,b);assert.notDeepEqual(a.shapes.map(s=>[s.x,s.y]),c.shapes.map(s=>[s.x,s.y]));
 assert.deepEqual(createArtBackground([...input].reverse(),options),a,'family input order is irrelevant');
});

test('five Figma middle colours and precise primitive proportions remain intact',()=>{
 assert.deepEqual(ART_FAMILIES.map(f=>ART_PALETTE[f].middle),['#a8c5b0','#ffd65a','#9566f2','#f06464','#8d9fb5']);
 const art=createArtBackground(profiles([.2,.2,.2,.2,.2]),{seed:'geometry'});
 for(const shape of art.shapes){
  assert.equal(shape.fill,ART_PALETTE[shape.family].middle);
  const ratio={capsule:5/3,circle:1,star:1,wedge:1.5,rectangle:1/2.6}[shape.type];close(shape.width/shape.height,ratio);
  close(shape.area,shapeArea(shape),1e-5);
 }
 assert.equal(new Set(art.shapes.map(s=>s.type)).size,5);
});

test('geometry hit tests distinguish solid interiors, wedge cutaways and star notches',()=>{
 const base={x:0,y:0,width:100,height:100,rotation:0};
 assert.ok(shapeContains({...base,type:'circle'},0,0));assert.ok(!shapeContains({...base,type:'circle'},49,49));
 assert.ok(shapeContains({...base,type:'rectangle'},49,49));
 assert.ok(shapeContains({...base,type:'star'},45,0));assert.ok(!shapeContains({...base,type:'star'},23,10));
 assert.ok(shapeContains({...base,type:'wedge'},0,30));assert.ok(!shapeContains({...base,type:'wedge'},-45,-40));
 const capsule={...base,type:'capsule',width:150,height:60};assert.ok(shapeContains(capsule,40,0));assert.ok(!shapeContains(capsule,74,29));
});

test('category area targets follow recorded shares, with bounded estimated coverage and overlaps',()=>{
 const cases=[[[.6,.2,.08,.04,.08],.35,.18],[[.15,.55,.2,.05,.05],.6,.62],[[.1,.25,.5,.1,.05],.8,.88],[[.15,.08,.12,.45,.2],.7,.72]];
 for(const [shares,strength,variation] of cases){
  const art=createArtBackground(profiles(shares,strength,variation),{seed:'r11-preview',foreground}),area=art.width*art.height;
  assert.ok(art.coverage.target>=.45&&art.coverage.target<=.60);
  assert.ok(Math.abs(art.coverage.estimated-art.coverage.target)<.015);
  assert.equal(art.coverage.method,'deterministic-grid');
  assert.ok(art.shapes.length<=110);
  close(Object.values(art.targetAreaByFamily).reduce((a,b)=>a+b,0)/area,art.coverage.target);
  close(Object.values(art.areaByFamily).reduce((a,b)=>a+b,0)/area,art.coverage.estimated);
  for(let i=0;i<ART_FAMILIES.length;i++){
   const f=ART_FAMILIES[i];close(art.targetAreaByFamily[f]/area,art.coverage.target*shares[i]);
   assert.ok(Math.abs(art.areaByFamily[f]/area-art.targetAreaByFamily[f]/area)<.015);
  }
 }
});

test('a stronger stable expression makes broader shapes while rotation stays tied to measured variation',()=>{
 const low=createArtBackground([{family:'joy',share:1,meanStrength:0,variation:0}],{seed:'strength'});
 const high=createArtBackground([{family:'joy',share:1,meanStrength:1,variation:1}],{seed:'strength'});
 assert.ok(high.shapes[0].nominalArea>low.shapes[0].nominalArea*3);
 assert.ok(high.shapes[0].area>low.shapes[0].area*3);
 assert.ok(low.shapes.every(s=>Math.abs(s.rotation-s.baseRotation)<=6));
 assert.ok(high.shapes.every(s=>Math.abs(s.rotation-s.baseRotation)<=81));
 assert.ok(high.shapes.some(s=>Math.abs(s.rotation-s.baseRotation)>6));
 assert.ok(high.shapes.some(s=>s.edge&&s.width>high.width*.2),'broad edge forms remain visible');
});

test('foreground receives a real geometric exclusion margin, with smaller nearby shapes',()=>{
 const art=createArtBackground(profiles(),{seed:'foreground-safe',foreground});
 const margin=Math.min(art.width,art.height)*.012;
 for(const shape of art.shapes){
  const radius=['rectangle','wedge'].includes(shape.type)?Math.hypot(shape.width,shape.height)/2:Math.max(shape.width,shape.height)/2;
  for(const c of foreground)assert.ok(Math.hypot(shape.x-c.x,shape.y-c.y)>=c.r+radius+margin-1e-6);
 }
 assert.ok(art.shapes.some(s=>s.area<s.nominalArea*.7),'foreground or quota fitting shrinks some shapes');
 assert.deepEqual(createArtBackground(profiles(),{seed:'foreground-safe',foreground:foreground.map(c=>[c.x,c.y,c.r])}),art);
});

test('missing and zero-share families create no invented background categories',()=>{
 const empty=createArtBackground([{family:'calm',share:0},{family:'unknown',share:1}],{seed:'empty'});
 assert.deepEqual(empty.shapes,[]);assert.equal(empty.coverage.estimated,0);assert.equal(empty.coverage.target,0);
 const solo=createArtBackground([{family:'sadness',share:1,meanStrength:.4,variation:.2},{family:'joy',share:0}],{seed:'one'});
 assert.ok(solo.shapes.length>0);assert.ok(solo.shapes.every(s=>s.family==='sadness'));
 const rare=createArtBackground([{family:'joy',share:.999999,meanStrength:.5,variation:.4},{family:'surprise',share:.000001,meanStrength:1,variation:1}],{seed:'rare'});
 assert.ok(rare.coverage.estimated>.45,'tiny categories cannot stall the finite layout budget');
});

test('window bands select opaque light, middle and deep colours without adding alpha or gradients',()=>{
 const art=createArtBackground([{family:'calm',share:1,meanStrength:.5,variation:.5,bands:[{share:1,meanStrength:.1,variation:.1},{share:1,meanStrength:.5,variation:.5},{share:1,meanStrength:.9,variation:.9}]}],{seed:'bands'});
 const fills=new Set(art.shapes.map(s=>s.fill));assert.equal(fills.size,3);
 for(const fill of fills)assert.match(fill,/^#[0-9a-f]{6}$/);
 assert.ok(fills.has(ART_PALETTE.calm.middle));assert.ok(fills.has(ART_PALETTE.calm.light));assert.ok(fills.has(ART_PALETTE.calm.deep));
});

test('painter keeps existing foreground/UI out of the opaque artwork-only pass',()=>{
 const art=createArtBackground(profiles(),{seed:'paint'}),fills=[],ctx={globalAlpha:.2,globalCompositeOperation:'multiply',shadowBlur:10,shadowOffsetX:5,shadowOffsetY:6,
  save(){},restore(){},beginPath(){},rect(){},clip(){},translate(){},rotate(){},ellipse(){},arc(){},moveTo(){},lineTo(){},closePath(){},
  fillRect(){fills.push({color:this.fillStyle,alpha:this.globalAlpha});},fill(){fills.push({color:this.fillStyle,alpha:this.globalAlpha});},
  fillText(){assert.fail('background painter must not paint emoji or UI text');},createLinearGradient(){assert.fail('solid fills only');}
 };
 paintArtBackground(ctx,art);assert.equal(fills.length,art.shapes.length+1);assert.ok(fills.every(f=>f.alpha===1&&/^#[0-9a-f]{6}$/.test(f.color)));
 assert.equal(ctx.shadowBlur,0);assert.equal(ctx.shadowOffsetX,0);assert.equal(ctx.shadowOffsetY,0);
});
