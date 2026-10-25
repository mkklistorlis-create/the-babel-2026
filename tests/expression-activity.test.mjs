import test from 'node:test';
import assert from 'node:assert/strict';
import {createFacialActivityTracker,FACIAL_ACTIVITY_METRIC,FACIAL_ACTIVITY_DESCRIPTION} from '../public/expression-activity.js';

const face=(actions,expressionId='neutral')=>({valid:true,expressionId,actions,score:.9});

test('valid neutral is a low numeric value; missing is null',()=>{
 const t=createFacialActivityTracker();
 assert.equal(t.update(face({smile:0,jawOpen:0,browRaise:0,eyeWide:0}),0),0);
 assert.equal(t.update(face({smile:.015,jawOpen:.01}),200)<2,true);
 assert.equal(t.update({valid:false,actions:{smile:1},expressionId:'smile'},300),null);
 assert.equal(FACIAL_ACTIVITY_METRIC,'facial-activity-v1');assert.match(FACIAL_ACTIVITY_DESCRIPTION,/不表示情绪/);
});

for(const [label,actions] of [['mouth',{smile:.95}],['brow',{browRaiseLeft:.95}],['eyes',{eyeWideLeft:.95,eyeWideRight:.95}]]){
 test(`strong ${label} actions create a visible bounded response without an emotion label`,()=>{
  const t=createFacialActivityTracker();t.update(face({smile:0}),0);
  const outputs=[];
  for(let at=100;at<=1000;at+=100)outputs.push(t.update(face(actions),at));
  assert.ok(outputs[0]>15);assert.ok(outputs.at(-1)>45);
  assert.ok(outputs.every(v=>Number.isFinite(v)&&v>=0&&v<=100&&Math.abs(v*10-Math.round(v*10))<1e-8));
 });
}

test('rapid action change raises activity above the same held configuration',()=>{
 const changing=createFacialActivityTracker(),steady=createFacialActivityTracker();
 changing.update(face({smile:0}),0);steady.update(face({smile:.8}),0);
 let burst;
 for(let at=100;at<=500;at+=100){burst=changing.update(face({smile:at%200===0?0:.8}),at);}
 const still=steady.update(face({smile:.8}),500);
 assert.ok(burst>still);assert.ok(still>30);
 // An isolated blink is excluded from the speed term, even on a short sample.
 const blink=createFacialActivityTracker();blink.update(face({eyeBlinkLeft:0,eyeBlinkRight:0}),0);
 assert.ok(blink.update(face({eyeBlinkLeft:1,eyeBlinkRight:1}),40)<2);
 assert.ok(blink.update(face({eyeBlinkLeft:0,eyeBlinkRight:0}),80)<2);
});

test('category change contributes only a small, decaying pulse',()=>{
 const t=createFacialActivityTracker();t.update(face({smile:.2},'smile'),0);
 const baseline=t.update(face({smile:.2},'smile'),100);
 const changed=t.update(face({smile:.2},'wink'),200);
 assert.ok(changed>baseline);assert.ok(changed-baseline<7);
 let final;
 for(let at=300;at<=3000;at+=100)final=t.update(face({smile:.2},'wink'),at);
 assert.ok(Math.abs(final-baseline)<.3);
});

test('missing and stale intervals reset velocity and pulse before reacquisition',()=>{
 const t=createFacialActivityTracker(),fresh=createFacialActivityTracker();
 t.update(face({smile:0},'neutral'),0);t.update({valid:false},100);
 assert.equal(t.update(face({smile:1},'smile'),200),fresh.update(face({smile:1},'smile'),200));
 const expired=createFacialActivityTracker();expired.update(face({smile:0},'neutral'),0);
 assert.equal(expired.update(face({smile:1},'smile'),1000),fresh.update(face({smile:1},'smile'),1000));
});

test('live missing actions remain missing; demo fallback is explicit and deterministic',()=>{
 const live=createFacialActivityTracker(),a=createFacialActivityTracker({mode:'demo'}),b=createFacialActivityTracker({mode:'demo'});
 const input={valid:true,expressionId:'open-smile',actions:null,score:1};
 assert.equal(live.update(input,0),null);
 assert.equal(a.update(input,0),b.update(input,0));assert.ok(a.update(input,100)>40);
 assert.equal(a.update({valid:true,expressionId:'untrusted',actions:null},200),null);
 // The movement-match score is not a calibrated activity or emotion score.
 assert.equal(createFacialActivityTracker().update(face({smile:.5}),0),createFacialActivityTracker().update({...face({smile:.5}),score:0},0));
});

test('rollback and invalid timestamps do not modify activity history',()=>{
 const t=createFacialActivityTracker();const value=t.update(face({smile:.8}),100);
 assert.equal(t.update(face({smile:0}),50),value);assert.equal(t.update({valid:false},NaN),value);
 assert.equal(t.update(face({smile:.8}),200),value);
});

test('hostile coefficients are bounded and invalid action objects do not become valid data',()=>{
 const t=createFacialActivityTracker();
 assert.equal(t.update(face({smile:Infinity}),0),null);
 assert.equal(t.update(face([]),0),null);
 const n=t.update(face({smile:1e100,jawOpen:-10,eyeWide:NaN}),100);
 assert.ok(n>=0&&n<=100);
});
