import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSize,containRect,createArtworkCapture} from '../public/room-capture.js';

test('outgoing artwork remains within 720p with even dimensions for portrait and landscape',()=>{
 for(const [w,h] of [[2880,1800],[960,1080],[3840,2160],[390,844]]){
  const size=captureSize(w,h);
  assert.ok(size.width<=1280&&size.height<=720);
  assert.equal(size.width%2,0);assert.equal(size.height%2,0);
  assert.ok(Math.abs(size.width/size.height-w/h)<.01);
 }
 assert.throws(()=>captureSize(0,720));assert.throws(()=>captureSize(NaN,720));
});

test('a window resize fits the entire local artwork into the fixed outgoing frame',()=>{
 assert.deepEqual(containRect(720,720,1280,720),{x:280,y:0,width:720,height:720});
 assert.deepEqual(containRect(1280,720,720,720),{x:0,y:157.5,width:720,height:405});
});

test('capture draws only its supplied local canvas and releases its own stream',()=>{
 const saved={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 let loop,clears=0,stops=0,requestedFps,drawn=[];
 const source={width:1440,height:900,getBoundingClientRect:()=>({width:720,height:900})};
 const stream={getTracks:()=>[{kind:'video',readyState:'live',stop(){stops++;}}]};
 globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(...args){drawn.push(args);}}),captureStream(fps){requestedFps=fps;return stream;}})};
 globalThis.setInterval=cb=>{loop=cb;return 19;};globalThis.clearInterval=id=>{assert.equal(id,19);clears++;};
 try{
  const capture=createArtworkCapture(source,{fps:60});
  assert.equal(capture.stream,stream);assert.equal(requestedFps,20);
  assert.equal(capture.diagnostics.width,576);assert.equal(capture.diagnostics.height,720);
  loop();assert.equal(drawn.length,2);assert.ok(drawn.every(call=>call[0]===source));
  capture.stop();capture.stop();loop();
  assert.equal(drawn.length,2);assert.equal(stops,1);assert.equal(clears,1);assert.equal(capture.diagnostics.active,false);
 }finally{Object.assign(globalThis,saved);}
});
