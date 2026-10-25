/** Bounded video capture of the LOCAL artwork only. Never capture the duet UI. */
export function captureSize(width,height,maxWidth=1280,maxHeight=720){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('画面尺寸无效');
 const scale=Math.min(1,maxWidth/width,maxHeight/height);
 return {width:Math.max(2,Math.floor(width*scale/2)*2),height:Math.max(2,Math.floor(height*scale/2)*2)};
}
export function containRect(sourceWidth,sourceHeight,width,height){
 const scale=Math.min(width/sourceWidth,height/sourceHeight);
 const w=sourceWidth*scale,h=sourceHeight*scale;
 return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
export function createArtworkCapture(source,{fps=20,onError=()=>{}}={}){
 const bounds=source.getBoundingClientRect();
 const size=captureSize(bounds.width,bounds.height);
 const canvas=document.createElement('canvas');
 Object.assign(canvas,size);
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx||typeof canvas.captureStream!=='function')throw new Error('此浏览器暂不支持画面联机，请使用 Chrome');
 let stream=null,timer=null,stopped=false,frames=0,error='';
 function draw(){
  if(stopped||source.width<1||source.height<1)return;
  try{
   const rect=containRect(source.width,source.height,size.width,size.height);
   ctx.fillStyle='#f3f3eb';ctx.fillRect(0,0,size.width,size.height);
   ctx.drawImage(source,rect.x,rect.y,rect.width,rect.height);frames++;
  }catch(cause){error=cause.message||'画面无法传输';stop();onError(error);}
 }
 function stop(){
  if(stopped)return;stopped=true;clearInterval(timer);
  for(const track of stream?.getTracks()||[])track.stop();
 }
 draw();
 if(error)throw new Error(error);
 try{stream=canvas.captureStream(Math.max(1,Math.min(20,fps)));}
 catch(cause){stop();throw cause;}
 timer=setInterval(draw,1000/Math.max(1,Math.min(20,fps)));
 return {stream,stop,get diagnostics(){return {...size,fps:Math.max(1,Math.min(20,fps)),frames,active:!stopped,error,tracks:stream?.getTracks().map(t=>({kind:t.kind,readyState:t.readyState}))||[]};}};
}
