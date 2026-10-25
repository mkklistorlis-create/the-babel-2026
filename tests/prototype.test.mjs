import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPrototypeServer} from '../prototype-server.mjs';

async function serve(options={}) {
 const server=createPrototypeServer({env:{},...options});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,base:`http://127.0.0.1:${server.address().port}`,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
function rawRequest(base,path,headers={}) {
 return new Promise((resolve,reject)=>{
  const request=http.get(base+path,{headers},response=>{
   const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString()}));
  });request.on('error',reject);
 });
}

test('camera assets allow opt-in microphone and report speech unavailable without keys',async()=>{
 const fixture=await serve();
 try {
  const response=await fetch(fixture.base+'/api/capabilities'),capabilities=await response.json();
  assert.equal(capabilities.revision,'R12.3');assert.equal(capabilities.mode,'camera-with-optional-speech');
  assert.equal(capabilities.camera,true);assert.equal(capabilities.hands,true);assert.equal(capabilities.facialExpressions,true);
  assert.equal(capabilities.microphone,false);assert.equal(capabilities.transcription,false);assert.equal(capabilities.semantics,false);assert.equal(capabilities.provider,null);
  for(const path of ['/','/app.js','/duet-canvas.js','/vendor/three.module.js','/tracking-worker.js','/vendor/mediapipe/vision_bundle.mjs','/vendor/mediapipe/hand_landmarker.task']){
   const result=await fetch(fixture.base+path);assert.equal(result.status,200,path);
   assert.equal(result.headers.get('permissions-policy'),'camera=(self), microphone=(self)');
   assert.ok((await result.arrayBuffer()).byteLength>50);
  }
  const head=await fetch(fixture.base+'/app.js',{method:'HEAD'});
  assert.equal(head.status,200);assert.ok(Number(head.headers.get('content-length'))>50);assert.equal(await head.text(),'');
  assert.equal((await fetch(fixture.base+'/missing.js')).status,404);
  assert.equal((await fetch(fixture.base+'/api/capabilities',{method:'POST'})).status,405);
 }finally{await fixture.close();}
});

test('suspended speech and semantic endpoints cannot instantiate or invoke old providers',async()=>{
 const options={publicRoot:undefined};
 for(const field of ['apiKey','fetchImpl','runtimePath','inference'])Object.defineProperty(options,field,{get(){throw Error(`R07 must not inspect ${field}`);}});
 const fixture=await serve(options);
 try {
  for(const route of ['/api/transcribe?language=es','/api/interpret']){
   const result=await fetch(fixture.base+route,{method:'POST',headers:{'content-type':'application/json',origin:fixture.base},body:JSON.stringify({text:'a past version request',language:'es'})});
   assert.equal(result.status,410);const body=await result.json();assert.equal(body.suspended,true);assert.equal(body.revision,'R12.3');assert.match(body.error,/Legacy speech endpoints/);
  }
  assert.equal((await fetch(fixture.base+'/api/interpret',{method:'POST',headers:{origin:'https://example.org'},body:'{}'})).status,403);
  assert.equal((await fetch(fixture.base+'/api/unknown')).status,404);
  for(const path of ['/semantics.js','/duet-audio.js','/mapping.js','/media.js','/vendor/vad/bundle.min.js'])assert.equal((await fetch(fixture.base+path)).status,404,path);
 }finally{await fixture.close();}
});

test('camera server confines files to its public root and rejects foreign Host headers',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'between-us-r07-server-')),publicRoot=join(directory,'public');
 await mkdir(publicRoot);await writeFile(join(publicRoot,'index.html'),'<main>camera</main>');await writeFile(join(directory,'private.txt'),'never served');
 await symlink(join(directory,'private.txt'),join(publicRoot,'escape.txt'));
 const fixture=await serve({publicRoot});
 try {
  assert.equal((await rawRequest(fixture.base,'/',{host:'foreign.example'})).status,403);
  assert.equal((await rawRequest(fixture.base,'/%2e%2e%2fprivate.txt')).status,403);
  assert.equal((await rawRequest(fixture.base,'/%E0%A4%A')).status,400);
  assert.equal((await fetch(fixture.base+'/escape.txt')).status,404);
  assert.equal((await fetch(fixture.base+'/legacy/r06/server/inference.mjs')).status,404);
  assert.equal((await fetch(fixture.base+'/',{method:'POST'})).status,405);
 }finally{await fixture.close();await rm(directory,{recursive:true,force:true});}
});
