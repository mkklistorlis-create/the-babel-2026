import {createHmac} from 'node:crypto';

export function rtcConfig(env=process.env,now=Date.now()){
 const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
 const urls=(env.TURN_URLS||'').split(',').map(s=>s.trim()).filter(s=>/^turns?:[^\s]+$/.test(s));
 if(urls.length&&env.TURN_SHARED_SECRET){
  const username=`${Math.floor(now/1000)+3600}:babel`;
  const credential=createHmac('sha1',env.TURN_SHARED_SECRET).update(username).digest('base64');
  iceServers.push({urls,username,credential});
 }
 return {iceServers,turnConfigured:iceServers.length>1,signaling:'peerjs-cloud',revision:'R07.9'};
}

export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');return res.end(JSON.stringify({error:'Use GET.'}));}
 if(req.headers['sec-fetch-site']==='cross-site'){res.statusCode=403;return res.end(JSON.stringify({error:'Same-origin request required.'}));}
 res.statusCode=200;res.end(JSON.stringify(rtcConfig()));
}
