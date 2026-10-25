/** Bounded partial/final semantic messages. No audio, provider configuration or roles. */
export const MAX_MEANING_BYTES=8192;
const encoder=new TextEncoder();
const languages=new Set(['zh','en','ja','es','auto','mixed','und']);
const intents=new Set(['statement','question','request','evaluate','agree','disagree','greeting','other']);
const degrees=new Set(['none','mild','moderate','strong','unknown']);
const polarities=new Set(['positive','negative','neutral','mixed','unknown']);
const string=(value,max,{empty=false}={})=>typeof value==='string'&&value.length<=max&&(empty||Boolean(value.trim()));

export function meaningMessageFits(value){
 try{const serialized=JSON.stringify(value);return typeof serialized==='string'&&encoder.encode(serialized).byteLength<=MAX_MEANING_BYTES;}catch{return false;}
}

/** External sendMeaning accepts a partial/final plugin detail or {type:'reset'}. */
export function normalizeMeaningMessage(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!meaningMessageFits(input))return null;
 if(input.type==='reset')return {type:'reset'};
 if((input.type!==undefined&&input.type!=='meaning')||!['final','partial'].includes(input.stage)||
    !string(input.utteranceId,128)||!Number.isSafeInteger(input.revision)||input.revision<0||
    !languages.has(input.language)||!string(input.text,2000)||!string(input.meaning,600)||
    !string(input.target,200,{empty:true})||!intents.has(input.intent)||!degrees.has(input.degree)||
    !polarities.has(input.polarity)||typeof input.uncertain!=='boolean'||
    !Number.isFinite(input.latencyMs)||input.latencyMs<0||input.latencyMs>3600000)return null;
 if(!Array.isArray(input.attributes)||input.attributes.length>12||input.attributes.some(value=>!string(value,80)))return null;
 if(!Array.isArray(input.evidence)||input.evidence.length<1||input.evidence.length>8||
    input.evidence.some(value=>!string(value,160)||!input.text.includes(value)))return null;
 if(input.targetLanguage!==undefined&&(!['zh','en','ja','es'].includes(input.targetLanguage)||!string(input.translation,2000)))return null;
 if(input.turnOrder!==undefined&&(!Number.isSafeInteger(input.turnOrder)||input.turnOrder<0))return null;
 return {type:'meaning',stage:input.stage,utteranceId:input.utteranceId,revision:input.revision,
  ...(input.turnOrder!==undefined?{turnOrder:input.turnOrder}:{}),
  language:input.language,...(input.targetLanguage?{targetLanguage:input.targetLanguage,translation:input.translation}:{}),text:input.text,meaning:input.meaning,intent:input.intent,target:input.target,
  attributes:[...input.attributes],degree:input.degree,polarity:input.polarity,uncertain:input.uncertain,
  evidence:[...input.evidence],latencyMs:input.latencyMs};
}
