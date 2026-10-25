import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrototypeServer} from '../prototype-server.mjs';

// Invoke actual request handlers without binding TCP in restricted environments.
function request(server,path,{method='GET',headers={}}={}) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Request handler did not end')),2000);
    const response={headers:{},statusCode:200,headersSent:false,
      setHeader(k,v){this.headers[k.toLowerCase()]=v;},
      writeHead(status,values={}){this.statusCode=status;this.headersSent=true;for(const [k,v] of Object.entries(values))this.setHeader(k,v);},
      end(body){clearTimeout(timer);resolve({status:this.statusCode,headers:this.headers,body:body?.toString()||''});}
    };
    server.emit('request',{url:path,method,headers:{host:'127.0.0.1:4173',...headers}},response);
  });
}

test('site mounts speech availability and preserves opt-in provider startup',async()=>{
  const server=createPrototypeServer({env:{}});
  try {
    const config=await request(server,'/api/semantic-config');
    assert.equal(config.status,200);assert.equal(JSON.parse(config.body).enabled,false);
    assert.equal((await request(server,'/api/semantic-config',{method:'POST'})).status,405);
    assert.equal((await request(server,'/api/semantic-stream')).status,426);
    const capabilities=JSON.parse((await request(server,'/api/capabilities')).body);
    assert.equal(capabilities.camera,true);assert.equal(capabilities.semantics,false);
    const html=await request(server,'/');
    assert.equal(html.status,200);assert.equal(html.headers['permissions-policy'],'camera=(self), microphone=(self)');
    assert.match(html.body,/id="camera"/);
  }finally{server.close();}
});

test('configured site exposes flags without keys or demo access code',async()=>{
  const env={DEEPGRAM_API_KEY:'private-deepgram-fixture',OPENAI_API_KEY:'private-openai-fixture',BABEL_SPEECH_ACCESS_CODE:'private-demo-fixture'};
  const server=createPrototypeServer({env});
  try {
    const config=await request(server,'/api/semantic-config');
    assert.equal(JSON.parse(config.body).enabled,true);
    for(const secret of Object.values(env))assert.equal(config.body.includes(secret),false);
    assert.equal((await request(server,'/.env')).status,404);
    assert.equal((await request(server,'/lib/speech/gateway.mjs')).status,404);
    assert.equal((await request(server,'/api/transcribe',{method:'POST',headers:{origin:'http://127.0.0.1:4173'}})).status,410);
    assert.equal((await request(server,'/',{headers:{host:'foreign.example'}})).status,403);
  }finally{server.close();}
});
