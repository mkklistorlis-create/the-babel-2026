/** Conservative geometric cue for the existing 21-point hand observations.
 * Uses relative bone angles/distances, so a sideways open palm is still open.
 * This is a curl heuristic, not a new gesture model; occluded/uncertain fingers
 * may not qualify. The caller decides how long both fists must be observed.
 */
const length=v=>Math.hypot(v.x,v.y,v.z);
const vector=(a,b)=>({x:b.x-a.x,y:b.y-a.y,z:b.z-a.z});
const distance=(a,b)=>length(vector(a,b));
const cosine=(a,b)=>(a.x*b.x+a.y*b.y+a.z*b.z)/(length(a)*length(b));
const fingers=[[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];

export function isClosedFist(hand){
 const source=hand?.landmarks;
 if(!Array.isArray(source)||source.length!==21||source.some(p=>!Number.isFinite(p?.x)
  ||!Number.isFinite(p?.y)||(p.z!==undefined&&!Number.isFinite(p.z))))return false;
 const points=source.map(p=>({x:p.x,y:p.y,z:p.z??0}));
 const wrist=points[0],palmSize=distance(wrist,points[9]);
 if(palmSize<1e-5||distance(points[5],points[17])<palmSize*.05)return false;
 let curled=0;
 for(const indices of fingers){
  const [mcp,pip,dip,tip]=indices.map(i=>points[i]);
  const bones=[distance(mcp,pip),distance(pip,dip),distance(dip,tip)];
  if(bones.some(n=>n<palmSize*.025))continue;
  const pipBend=cosine(vector(pip,mcp),vector(pip,dip));
  const dipBend=cosine(vector(dip,pip),vector(dip,tip));
  const chain=bones.reduce((a,b)=>a+b,0),reach=distance(mcp,tip);
  // Pointing is already used for fingertip drawing. A clearly extended long
  // finger vetoes the fist cue even when the other three fingers are folded.
  if(pipBend<-.65&&dipBend<-.65&&reach>chain*.88)return false;
  const folded=pipBend>-.45||dipBend>-.45;
  const compact=reach<chain*.68;
  const returned=distance(wrist,tip)<distance(wrist,pip)*1.1
   ||distance(mcp,tip)<bones[0]*1.05;
  if(folded&&compact&&returned)curled++;
 }
 // Thumb placement varies; tolerate one partly folded/uncertain long finger.
 return curled>=3;
}
