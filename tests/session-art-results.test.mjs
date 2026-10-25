import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpressionRecorder} from '../public/session-stats.js';
import {sessionArtProfiles,sessionExportData,createArtworkLayout} from '../public/session-results.js';

const sessionId='1234567890abcdef1234567890abcdef';
function record(role,expressionId,actions,duration=6000){
 const recorder=createExpressionRecorder({sessionId,role,mode:'live',now:()=>0});
 for(let at=0;at<=duration;at+=200)recorder.sample({valid:true,expressionId,actions,score:.9},at);
 return recorder.finish(duration);
}
const duet=(a,b)=>({sessionId,kind:'duet',role:'A',local:a,remote:b,phase:'complete',complete:true});

test('both peers derive identical backgrounds from their synchronized summaries',()=>{
 const a=record('A','smile',{smile:.8}),b=record('B','brow-furrow',{browLower:.7});
 const host=duet(a,b),guest={...host,role:'B',local:b,remote:a};
 assert.deepEqual(sessionArtProfiles(host),sessionArtProfiles(guest));
 assert.deepEqual(sessionExportData(host).artDefinition,sessionExportData(guest).artDefinition);
 const data=sessionArtProfiles(host);
 assert.deepEqual(data.contributors,['A','B']);assert.equal(data.evidenceMs,12000);
 assert.equal(data.profiles.find(item=>item.family==='joy').share,.5);
 assert.equal(data.profiles.find(item=>item.family==='tension').share,.5);
 for(const profile of data.profiles)assert.ok(Math.abs(profile.bands.reduce((sum,item)=>sum+item.share,0)-1)<1e-6);
});

test('solo artwork only uses its participant; legacy summaries keep emoji areas without inventing art signals',()=>{
 const a=record('A','smile',{smile:.8}),b=record('B','brow-furrow',{browLower:.7});
 const single={...duet(a,b),kind:'solo'};
 assert.deepEqual(sessionArtProfiles(single).profiles.map(item=>item.family),['joy']);
 const {art,...legacy}=a;
 const old={...single,local:legacy};
 assert.equal(sessionArtProfiles(old).evidenceMs,0);
 assert.deepEqual(sessionArtProfiles(old).profiles,[]);
 assert.equal(createArtworkLayout(old,'count').length,1);
 assert.equal(sessionExportData(old).participants.A.art,undefined);
});

test('partial duet art uses received evidence without fabricating the absent participant',()=>{
 const a=record('A','smile',{smile:.8}),data=sessionArtProfiles(duet(a,null));
 assert.deepEqual(data.contributors,['A']);assert.deepEqual(data.missingRoles,['B']);
 assert.equal(data.profiles.length,1);assert.equal(data.profiles[0].share,1);
});

test('exports retain art evidence and foreground metric changes never alter background measurements',()=>{
 const a=record('A','smile',{smile:.8}),s={...duet(a,null),kind:'solo'};
 const counts=sessionExportData(s,'count'),duration=sessionExportData(s,'duration');
 assert.deepEqual(counts.artDefinition,duration.artDefinition);
 assert.deepEqual(counts.participants.A.art,a.art);
 counts.participants.A.art.families[0].durationMs=12345;
 assert.notEqual(a.art.families[0].durationMs,12345,'exports cannot mutate recorder state');
 assert.equal(counts.artDefinition.seed,sessionId);
 assert.equal(counts.artDefinition.design,'Figma 158:11');
});
