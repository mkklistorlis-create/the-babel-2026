/**
 * R11 conversation-art background. Figma board 158:11 supplies the five
 * middle colours, solid geometry, 2 s statistics, seeded placement and
 * A / rotation rules. Deep/light colours and the bounded layout constants
 * below are implementation parameters, not additional model outputs.
 * This module consumes statistics only; it never samples a camera or audio.
 */
export const ART_FAMILIES=Object.freeze(['calm','joy','surprise','tension','sadness']);
const MID={calm:'#a8c5b0',joy:'#ffd65a',surprise:'#9566f2',tension:'#f06464',sadness:'#8d9fb5'};
const PAPERS={calm:'#edede2',joy:'#f7ebcb',surprise:'#e8dff5',tension:'#e8ded7',sadness:'#e4e8ed'};
const TYPES={calm:'capsule',joy:'circle',surprise:'star',tension:'wedge',sadness:'rectangle'};
const BASE_ANGLES={calm:-12,joy:0,surprise:0,tension:-18,sadness:12};
const STAR_INNER=11/30,TAU=Math.PI*2,MAX_SHAPES=110,MAX_ATTEMPTS=520;
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:min));
const positive=value=>Number.isFinite(value)?Math.max(0,value):0;
const mix=(hex,other,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*(1-t)+parseInt(other.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
/** Light/middle/deep are opaque colours. Middle exactly matches Figma. */
export const ART_PALETTE=Object.freeze(Object.fromEntries(ART_FAMILIES.map(family=>[family,Object.freeze({
 light:mix(MID[family],'#f2ebdd',.30),middle:MID[family],deep:mix(MID[family],'#292933',.20),paper:PAPERS[family]
})])));

function hashSeed(value){let hash=2166136261;for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}
function randomGenerator(seed){let state=hashSeed(seed);return ()=>{state+=0x6d2b79f5;let t=Math.imul(state^(state>>>15),1|state);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
function weightedPick(items,weight,random){const total=items.reduce((sum,item)=>sum+positive(weight(item)),0);if(total<=0)return null;let choice=random()*total;for(const item of items){choice-=positive(weight(item));if(choice<=0)return item;}return items.at(-1);}

function normalizeProfiles(input){
 const merged=new Map();
 for(const item of Array.isArray(input)?input:[]){
  if(!item||!ART_FAMILIES.includes(item.family)||positive(item.share)===0)continue;
  const share=positive(item.share),strength=clamp(item.meanStrength),variation=clamp(item.variation);
  const bands=(Array.isArray(item.bands)?item.bands:[]).filter(b=>b&&positive(b.share)>0).map(b=>({share:positive(b.share),meanStrength:clamp(b.meanStrength),variation:clamp(b.variation)}));
  const bandTotal=bands.reduce((sum,b)=>sum+b.share,0);
  const normalizedBands=bandTotal?bands.map(b=>({...b,share:b.share/bandTotal*share})):[{share,meanStrength:strength,variation}];
  const existing=merged.get(item.family)||{family:item.family,share:0,strengthSum:0,variationSum:0,bands:[]};
  existing.share+=share;existing.strengthSum+=strength*share;existing.variationSum+=variation*share;existing.bands.push(...normalizedBands);merged.set(item.family,existing);
 }
 const total=[...merged.values()].reduce((sum,item)=>sum+item.share,0);
 if(!total)return [];
 return ART_FAMILIES.filter(family=>merged.has(family)).map(family=>{
  const item=merged.get(family);
  return {family,share:item.share/total,meanStrength:item.strengthSum/item.share,variation:item.variationSum/item.share,
   bands:item.bands.map(b=>({...b,share:b.share/item.share}))};
 });
}

function dimensions(type,area){
 if(type==='circle'||type==='star'){
  const r=Math.sqrt(area/(type==='circle'?Math.PI:8*STAR_INNER*Math.sin(Math.PI/8)));return {width:2*r,height:2*r};
 }
 if(type==='capsule'){const height=Math.sqrt(area/(2/3+Math.PI/4));return {width:height*5/3,height};}
 if(type==='wedge'){const height=Math.sqrt(area*4/3);return {width:height*1.5,height};}
 const width=Math.sqrt(area/2.6);return {width,height:width*2.6};
}

/** Unclipped geometric area; separate from estimated visible union coverage. */
export function shapeArea(shape){
 const w=positive(shape?.width),h=positive(shape?.height);
 switch(shape?.type){
  case 'circle':return Math.PI*w*h/4;
  case 'capsule':return Math.max(0,w-h)*h+Math.PI*h*h/4;
  case 'star':return 8*STAR_INNER*Math.sin(Math.PI/8)*w*h/4;
  case 'wedge':return w*h/2;
  case 'rectangle':return w*h;
  default:return 0;
 }
}

function shapeRadius(shape){return shape.type==='rectangle'||shape.type==='wedge'?Math.hypot(shape.width,shape.height)/2:Math.max(shape.width,shape.height)/2;}
function polygon(type,w,h){
 if(type==='wedge')return [[-w/2,h/2],[w/2,h/2],[w/4,-h/2]];
 return Array.from({length:16},(_,i)=>{const angle=i*Math.PI/8,r=i%2?STAR_INNER:1;return [Math.cos(angle)*w/2*r,Math.sin(angle)*h/2*r];});
}
function polygonContains(vertices,x,y){let inside=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
 const [xi,yi]=vertices[i],[xj,yj]=vertices[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
}return inside;}

/** Pure geometric hit-test used by the bounded coverage estimator and tests. */
export function shapeContains(shape,x,y){
 const angle=-shape.rotation*Math.PI/180,dx=x-shape.x,dy=y-shape.y;
 const px=dx*Math.cos(angle)-dy*Math.sin(angle),py=dx*Math.sin(angle)+dy*Math.cos(angle),w=shape.width,h=shape.height;
 if(Math.abs(px)>w/2||Math.abs(py)>h/2)return false;
 if(shape.type==='circle')return (px/(w/2))**2+(py/(h/2))**2<=1;
 if(shape.type==='rectangle')return true;
 if(shape.type==='capsule'){const straight=(w-h)/2;return Math.abs(px)<=straight||((Math.abs(px)-straight)**2+py*py)<=(h/2)**2;}
 return polygonContains(polygon(shape.type,w,h),px,py);
}

function foregroundCircles(input){return (Array.isArray(input)?input:[]).slice(0,100).map(c=>Array.isArray(c)?{x:c[0],y:c[1],r:c[2]}:c).filter(c=>c&&[c.x,c.y,c.r].every(Number.isFinite)&&c.r>0).map(c=>({x:c.x,y:c.y,r:c.r}));}
function shrink(shape,factor){shape.width*=factor;shape.height*=factor;shape.area=shapeArea(shape);return shape;}
function protectForeground(shape,foreground,margin){
 const radius=shapeRadius(shape);let available=Infinity;
 for(const c of foreground)available=Math.min(available,Math.hypot(shape.x-c.x,shape.y-c.y)-c.r-margin);
 if(available<=0)return false;
 if(available<radius)shrink(shape,available/radius);
 return Math.min(shape.width,shape.height)>=4;
}
function layoutSlots(random){
 const edge=[];
 for(let i=0;i<6;i++){edge.push({x:(i+.25)/5.5,y:.015,edge:true});edge.push({x:(i+.6)/6,y:.985,edge:true});}
 for(let i=0;i<3;i++){edge.push({x:.01,y:(i+.5)/3,edge:true});edge.push({x:.99,y:(i+.5)/3,edge:true});}
 const interior=[];for(let row=0;row<7;row++)for(let column=0;column<10;column++)interior.push({x:(column+.5)/10,y:(row+.5)/7,edge:false});
 for(let i=interior.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[interior[i],interior[j]]=[interior[j],interior[i]];}
 return [...edge,...interior];
}

/**
 * Deterministic artwork from valid-window profiles. No random source other
 * than the supplied seed is used. 96×aspect grid measures clipped union
 * coverage; it is an estimate, not an exact area claim.
 * Shape area uses two fixed size ranges (edge/interior); within each range
 * A = Amin + (Amax - Amin) * a. Only clipping/foreground protection/quota
 * fitting may subsequently reduce that area.
 */
export function createArtBackground(input,{seed='the-babel',foreground=[],width=1600,height=1000}={}){
 const w=clamp(width,1,8192),h=clamp(height,1,8192),profiles=normalizeProfiles(input),random=randomGenerator(seed),safe=foregroundCircles(foreground),surface=w*h;
 const primary=[...profiles].sort((a,b)=>b.share-a.share||ART_FAMILIES.indexOf(a.family)-ART_FAMILIES.indexOf(b.family))[0];
 const mean=profiles.reduce((sum,item)=>sum+item.share*item.meanStrength,0),target=profiles.length?.45+.15*mean:0;
 const columns=96,rows=Math.max(24,Math.min(96,Math.round(columns*h/w))),cellW=w/columns,cellH=h/rows,totalCells=columns*rows;
 const occupied=new Uint8Array(totalCells),familyCells=Object.fromEntries(ART_FAMILIES.map(f=>[f,0]));let used=0;
 const targetCells=Object.fromEntries(profiles.map(p=>[p.family,target*totalCells*p.share]));
 const targetAreaByFamily=Object.fromEntries(profiles.map(p=>[p.family,target*surface*p.share]));
 const slots=layoutSlots(random),shapes=[],margin=Math.min(w,h)*.012,triedFamilies=new Set();
 function raster(shape){
  const r=shapeRadius(shape),left=Math.max(0,Math.floor((shape.x-r)/cellW)),right=Math.min(columns-1,Math.ceil((shape.x+r)/cellW)),top=Math.max(0,Math.floor((shape.y-r)/cellH)),bottom=Math.min(rows-1,Math.ceil((shape.y+r)/cellH));
  const cells=[];let overlap=0;
  for(let row=top;row<=bottom;row++)for(let column=left;column<=right;column++){
   const x=(column+.5)*cellW,y=(row+.5)*cellH;if(!shapeContains(shape,x,y))continue;
   const index=row*columns+column;cells.push(index);if(occupied[index])overlap++;
  }
  return {cells,overlap};
 }
 for(let attempt=0;profiles.length&&attempt<MAX_ATTEMPTS&&shapes.length<MAX_SHAPES&&used<target*totalCells;attempt++){
  const remaining=p=>Math.max(0,targetCells[p.family]-familyCells[p.family]);
  const unseen=profiles.filter(p=>!triedFamilies.has(p.family));
  const profile=unseen.length?[...unseen].sort((a,b)=>b.share-a.share)[0]:weightedPick(profiles,remaining,random);
  if(!profile)break;
  triedFamilies.add(profile.family);
  const slot=slots[attempt%slots.length],band=weightedPick(profile.bands,b=>b.share,random)||profile,a=band.meanStrength,v=band.variation;
  const type=TYPES[profile.family],edge=slot.edge&&attempt<slots.length;
  // Stronger windows make broader shapes, not merely more dots.
  const minimum=surface*(edge?.011:.0013),maximum=surface*(edge?.060:.015);
  const nominalArea=minimum+(maximum-minimum)*a;
  const shape={id:shapes.length,family:profile.family,type,x:(slot.x+(random()-.5)*(edge?.08:.075))*w,y:(slot.y+(random()-.5)*(edge?.07:.10))*h,
   ...dimensions(type,nominalArea),rotation:BASE_ANGLES[profile.family]+(random()*2-1)*(6+75*v),baseRotation:BASE_ANGLES[profile.family],
   strength:a,variation:v,fill:ART_PALETTE[profile.family][a<1/3?'light':a>2/3?'deep':'middle'],edge,nominalArea,area:nominalArea};
  const maxRadius=Math.min(w,h)*.34;if(shapeRadius(shape)>maxRadius)shrink(shape,maxRadius/shapeRadius(shape));
  if(!protectForeground(shape,safe,margin))continue;
  let footprint=raster(shape);
  const room=remaining(profile);
  if(footprint.cells.length>Math.max(1,room*1.10)){
   shrink(shape,Math.sqrt(Math.max(1,room)/footprint.cells.length));footprint=raster(shape);
  }
  if(!footprint.cells.length||footprint.overlap>footprint.cells.length*.32||Math.min(shape.width,shape.height)<3)continue;
  if(footprint.cells.length-footprint.overlap<1)continue;
  const familyIndex=ART_FAMILIES.indexOf(profile.family)+1;
  for(const index of footprint.cells){const previous=occupied[index];if(previous)familyCells[ART_FAMILIES[previous-1]]--;else used++;occupied[index]=familyIndex;familyCells[profile.family]++;}
  shape.area=shapeArea(shape);shapes.push(shape);
 }
 const areaByFamily=Object.fromEntries(profiles.map(p=>[p.family,familyCells[p.family]/totalCells*surface]));
 return {width:w,height:h,paper:primary?PAPERS[primary.family]:'#edede2',seed:String(seed),profiles,shapes,targetAreaByFamily,areaByFamily,
  coverage:{target,estimated:used/totalCells,method:'deterministic-grid',columns,rows},foreground:safe};
}

/** Paint only artwork; never UI, metadata, gradients, shadows or transparency. */
export function paintArtBackground(ctx,layout){
 if(!ctx||!layout)return;
 ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;ctx.shadowColor='transparent';ctx.fillStyle=layout.paper;ctx.fillRect(0,0,layout.width,layout.height);
 ctx.beginPath();ctx.rect(0,0,layout.width,layout.height);ctx.clip();
 for(const shape of layout.shapes){
  ctx.save();ctx.translate(shape.x,shape.y);ctx.rotate(shape.rotation*Math.PI/180);ctx.fillStyle=shape.fill;ctx.beginPath();
  const w=shape.width,h=shape.height;
  if(shape.type==='circle')ctx.ellipse(0,0,w/2,h/2,0,0,TAU);
  else if(shape.type==='rectangle')ctx.rect(-w/2,-h/2,w,h);
  else if(shape.type==='capsule'){const x=(w-h)/2;ctx.moveTo(-x,-h/2);ctx.lineTo(x,-h/2);ctx.arc(x,0,h/2,-Math.PI/2,Math.PI/2);ctx.lineTo(-x,h/2);ctx.arc(-x,0,h/2,Math.PI/2,Math.PI*1.5);}
  else{const vertices=polygon(shape.type,w,h);ctx.moveTo(...vertices[0]);for(const point of vertices.slice(1))ctx.lineTo(...point);}
  ctx.closePath();ctx.fill();ctx.restore();
 }
 ctx.restore();
}
