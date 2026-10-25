/* Float probabilities stay in the worker. The returned alpha is the single
 * authoritative silhouette for the camera shader and contour extraction. */
const clamp01=value=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
const smoothstep=(a,b,value)=>{const t=clamp01((value-a)/(b-a));return t*t*(3-2*t);};
const validAnchor=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);

function sample(data,width,height,x,y){
 if(x<0||y<0||x>width-1||y>height-1)return 0;
 const xx=Math.floor(x),yy=Math.floor(y),fx=x-xx,fy=y-yy;
 const right=Math.min(width-1,xx+1),bottom=Math.min(height-1,yy+1);
 return data[yy*width+xx]*(1-fx)*(1-fy)+data[yy*width+right]*fx*(1-fy)+data[bottom*width+xx]*(1-fx)*fy+data[bottom*width+right]*fx*fy;
}
function spatialProbabilities(data,width,height){
 const result=new Float32Array(data.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,center=clamp01(data[i]);
  // Strong thin fingertips remain strong; only uncertain boundaries are softened.
  const neighbors=(clamp01(data[y*width+Math.max(0,x-1)])+clamp01(data[y*width+Math.min(width-1,x+1)])+clamp01(data[Math.max(0,y-1)*width+x])+clamp01(data[Math.min(height-1,y+1)*width+x]))*.25;
  result[i]=center>.8||center<.04?center:center*.75+neighbors*.25;
 }
 return result;
}

export class MaskStabilizer {
 constructor(){this.reset();}
 reset(){this.previous=null;this.raw=null;this.anchor=null;this.timestamp=null;this.occupancy=null;this.source=null;this.width=0;this.height=0;}

 update(mask,{timestamp,anchor=null,occupancy='single'}={}){
  const {width,height}=mask;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||mask.data?.length!==width*height)throw new Error('Invalid probability mask dimensions');
  const current=spatialProbabilities(mask.data,width,height),dt=timestamp-this.timestamp;
  const dx=validAnchor(anchor)&&validAnchor(this.anchor)?(anchor.x-this.anchor.x)*width:0;
  const dy=validAnchor(anchor)&&validAnchor(this.anchor)?(anchor.y-this.anchor.y)*height:0;
  let strongArea=0;for(const p of current)if(p>=.35)strongArea++;
  let resetReason=!this.previous?'entry':this.width!==width||this.height!==height?'size':mask.source!==this.source?'source':!Number.isFinite(dt)||dt<=0||dt>450?'gap':occupancy!==this.occupancy||occupancy!=='single'?'occupancy':Math.hypot(dx/width,dy/height)>.075?'motion':strongArea<4?'empty':null;
  let shiftX=0,shiftY=0,meanDifference=0;
  if(!resetReason){
   // A landmark shift is only accepted when current mask evidence supports it.
   // This prevents a turning head from dragging a stationary torso sideways.
   const alignmentError=(sx,sy)=>{
    let error=0,n=0;
    for(let y=1;y<height;y+=3)for(let x=1;x<width;x+=3){
     const p=current[y*width+x],old=sample(this.raw,width,height,x-sx,y-sy);
     if(Math.max(p,old)>.06){error+=Math.abs(p-old);n++;}
    }
    return error/Math.max(1,n);
   };
   const zeroError=alignmentError(0,0);let bestError=zeroError;
   if(Math.hypot(dx,dy)>.45&&Math.abs(dx)<=8&&Math.abs(dy)<=8){
    // Prefer the measured displacement when coarse image samples tie. Otherwise
    // a featureless torso can make a 1px and 2px translation equally plausible.
    const measuredError=alignmentError(Math.round(dx),Math.round(dy));
    if(measuredError<bestError*.9){bestError=measuredError;shiftX=Math.round(dx);shiftY=Math.round(dy);}
    for(let sy=Math.round(dy)-1;sy<=Math.round(dy)+1;sy++)for(let sx=Math.round(dx)-1;sx<=Math.round(dx)+1;sx++){
     if(Math.abs(sx)>8||Math.abs(sy)>8)continue;
     const error=alignmentError(sx,sy);
     if(error<bestError*.9){bestError=error;shiftX=sx;shiftY=sy;}
    }
   }
   meanDifference=bestError;
   if(bestError>.36){resetReason='scene-change';shiftX=0;shiftY=0;}
  }
  const stable=new Float32Array(current.length);
  const quietAlpha=1-Math.exp(-Math.max(1,Number.isFinite(dt)?dt:66)/280);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*width+x,p=current[i];
   if(resetReason){stable[i]=p;continue;}
   const old=sample(this.previous,width,height,x-shiftX,y-shiftY),delta=Math.abs(p-old);
   // Decisive current evidence takes effect immediately, including local hand
   // motion with a stationary face. Do not keep yesterday's foreground pixels.
   if((p<.06&&old>.14)||(p>.8&&old<.65)){stable[i]=p;continue;}
   const alpha=delta>.32?.82:Math.hypot(shiftX,shiftY)>.5?Math.max(.42,quietAlpha):quietAlpha;
   stable[i]=old+(p-old)*alpha;
  }
  const coverage=new Float32Array(current.length);
  for(let i=0;i<coverage.length;i++){
   // Current probable foreground is always opaque, even while history catches
   // up. Soft alpha exists only outside that conservative foreground support.
   coverage[i]=current[i]>=.35?1:smoothstep(.10,.30,Math.max(stable[i],current[i]*.75));
  }
  const data=new Uint8Array(current.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let alpha=0;
   // One low-resolution pixel of coverage protects uncertain hair/hand edges.
   for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++)alpha=Math.max(alpha,coverage[yy*width+xx]);
   data[y*width+x]=Math.round(alpha*255);
  }
  this.previous=stable;this.raw=current;this.width=width;this.height=height;this.anchor=validAnchor(anchor)?{...anchor}:null;this.timestamp=timestamp;this.occupancy=occupancy;this.source=mask.source;
  return {width,height,data,encoding:'alpha8',authoritative:true,complete:mask.complete===true,source:mask.source,
   stability:{resetReason,shiftX,shiftY,meanDifference}};
 }
}
