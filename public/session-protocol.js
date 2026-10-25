import {normalizeSessionSummary} from './session-stats.js';

export const SESSION_ID=/^[a-f0-9]{32}$/;
const actions=new Set(['start','ready','begin','summary','stop','final','ack']);

/** Only bounded, anonymous expression summaries cross the room connection. */
export function normalizeSessionMessage(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!actions.has(input.action)||
    typeof input.sessionId!=='string'||!SESSION_ID.test(input.sessionId)||!['A','B'].includes(input.role))return null;
 const out={action:input.action,sessionId:input.sessionId,role:input.role};
 if(['start','begin'].includes(input.action)&&input.role!=='A')return null;
 if(input.action==='ready'&&input.role!=='B')return null;
 if(input.action==='summary'||input.action==='final'){
  const summary=normalizeSessionSummary(input.summary);
  if(!summary||summary.sessionId!==out.sessionId||summary.role!==out.role)return null;
  out.summary=summary;
 }
 if(input.action==='ack'){
  if(!Number.isSafeInteger(input.revision)||input.revision<0)return null;
  out.revision=input.revision;
 }
 return out;
}
