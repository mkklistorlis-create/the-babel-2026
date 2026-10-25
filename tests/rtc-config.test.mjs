import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import handler,{rtcConfig} from '../api/rtc-config.js';

test('default room configuration explicitly reports no relay',()=>{
 const config=rtcConfig({});
 assert.equal(config.turnConfigured,false);
 assert.equal(config.iceServers.length,1);
 assert.ok(config.iceServers[0].urls.every(url=>url.startsWith('stun:')));
});
test('configured TURN emits expiring credentials without revealing the shared secret',()=>{
 const config=rtcConfig({TURN_URLS:'turn:relay.example:3478,invalid,turns:relay.example:443',TURN_SHARED_SECRET:'test-secret'},1000000);
 assert.equal(config.turnConfigured,true);
 const relay=config.iceServers[1];
 assert.equal(relay.username,'4600:babel');
 assert.equal(relay.credential,createHmac('sha1','test-secret').update(relay.username).digest('base64'));
 assert.equal(relay.urls.length,2);
 assert.ok(!JSON.stringify(config).includes('test-secret'));
 assert.equal(rtcConfig({TURN_URLS:'turn:relay.example:3478'}).turnConfigured,false);
});
test('room configuration rejects writes/cross-site fetches and is never cached',()=>{
 for(const [request,status] of [[{method:'POST',headers:{}},405],[{method:'GET',headers:{'sec-fetch-site':'cross-site'}},403],[{method:'GET',headers:{}},200]]){
  const headers={};let body;
  const res={setHeader:(k,v)=>headers[k]=v,end:v=>body=v};
  handler(request,res);
  assert.equal(res.statusCode,status);assert.equal(headers['Cache-Control'],'no-store');
  assert.doesNotThrow(()=>JSON.parse(body));
 }
});
