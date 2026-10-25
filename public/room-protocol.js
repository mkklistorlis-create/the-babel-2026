import {normalizeSessionMessage} from './session-protocol.js';
import {normalizeMeaningMessage,meaningMessageFits} from './meaning-protocol.js';

/** Compact, versioned messages for the two-person room. No images or landmarks. */
export const ROOM_PROTOCOL=1;
export const ROOM_ID=/^babel-[a-f0-9]{32}$/;
export const MAX_MESSAGE_LENGTH=8192;
export const ACTION_KEYS=Object.freeze(['smile','browRaise','browRaiseLeft','browRaiseRight','browLower','jawOpen','eyeWide','mouthPucker','eyeBlinkLeft','eyeBlinkRight','eyeSquint','mouthFrown','eyeWideLeft','eyeWideRight','eyeSquintLeft','eyeSquintRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight']);
const clamp=value=>Math.max(0,Math.min(1,value));
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:clamp(p.x),y:clamp(p.y)}:null;

export function randomRoomId(random=globalThis.crypto){
 if(!random?.getRandomValues)throw new Error('Secure random values are unavailable.');
 const bytes=random.getRandomValues(new Uint8Array(16));
 return 'babel-'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}

export function normalizeSnapshot(input){
 if(!input||typeof input!=='object'||!['live','demo'].includes(input.mode)||typeof input.present!=='boolean')return null;
 const hands=input.present&&Array.isArray(input.hands)?input.hands.slice(0,2).flatMap((hand,i)=>{
  const tip=point(hand?.tip);if(!tip)return [];
  const out={id:typeof hand.id==='string'?hand.id.slice(0,40):String(i),tip};
  const palm=point(hand.palm);if(palm)out.palm=palm;return [out];
 }):[];
 const raw=input.expression;let expression=null;
 if(input.present&&raw&&typeof raw.id==='string'&&/^[a-z-]{1,32}$/.test(raw.id)&&Number.isFinite(raw.score)){
  const actions={};for(const key of ACTION_KEYS)if(Number.isFinite(raw.actions?.[key]))actions[key]=clamp(raw.actions[key]);
  expression={id:raw.id,score:clamp(raw.score),actions};
 }
 return {mode:input.mode,present:input.present,hands,expression,aspect:Number.isFinite(input.aspect)&&input.aspect>0?Math.max(.2,Math.min(5,input.aspect)):16/9};
}

export function readMessage(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.v!==ROOM_PROTOCOL||typeof data.type!=='string')return null;
 try{if(JSON.stringify(data).length>MAX_MESSAGE_LENGTH)return null;}catch{return null;}
 switch(data.type){
  case 'hello':return ROOM_ID.test(data.roomId)?{v:1,type:'hello',roomId:data.roomId}:null;
  case 'welcome':return data.role==='B'&&ROOM_ID.test(data.roomId)?{v:1,type:'welcome',role:'B',roomId:data.roomId}:null;
  case 'reject':return ['room-full','invalid-room','protocol-error'].includes(data.reason)?{v:1,type:'reject',reason:data.reason}:null;
  case 'leave':return {v:1,type:'leave'};
  case 'ping':case 'pong':return Number.isFinite(data.at)&&data.at>=0?{v:1,type:data.type,at:data.at}:null;
  case 'session':{
   const body=normalizeSessionMessage(data.body);return body?{v:1,type:'session',body}:null;
  }
  case 'meaning':{
   if(!Number.isSafeInteger(data.seq)||data.seq<0||!meaningMessageFits(data))return null;
   const body=normalizeMeaningMessage(data.body);return body?{v:1,type:'meaning',seq:data.seq,body}:null;
  }
  case 'state':{
   if(!Number.isSafeInteger(data.seq)||data.seq<0||!Number.isFinite(data.at)||data.at<0)return null;
   const body=normalizeSnapshot(data.body);return body?{v:1,type:'state',seq:data.seq,at:data.at,body}:null;
  }
  default:return null;
 }
}
