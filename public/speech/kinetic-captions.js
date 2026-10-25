// Fit the current utterance to a stable box. Use actual font metrics, including
// CJK line breaking, rather than a character-count approximation.
export function mountKineticCaptions(document,platform=globalThis){
 const nodes=['speech-source','speech-remote-meaning'].map(id=>document.getElementById(id)).filter(Boolean);
 let frame=0,disposed=false;
 function fit(node){
  if(!node.clientWidth||!node.clientHeight||!node.textContent.trim())return;
  let low=12,high=Math.min(220,node.clientHeight/.98),best=low;
  for(let i=0;i<10;i++){
   const size=(low+high)/2;node.style.fontSize=`${size}px`;
   if(node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1){best=size;low=size;}else high=size;
  }
  node.style.fontSize=`${Math.floor(best*10)/10}px`;
  node.scrollTop=node.scrollHeight>node.clientHeight?node.scrollHeight:0;
 }
 function schedule(){if(!disposed&&!frame)frame=platform.requestAnimationFrame(()=>{frame=0;nodes.forEach(fit);});}
 const mutation=new platform.MutationObserver(schedule),resize=new platform.ResizeObserver(schedule);
 for(const node of nodes){mutation.observe(node,{childList:true,characterData:true,subtree:true});resize.observe(node);}
 document.fonts?.ready.then(schedule);document.fonts?.addEventListener('loadingdone',schedule);
 schedule();
 return()=>{disposed=true;platform.cancelAnimationFrame(frame);mutation.disconnect();resize.disconnect();document.fonts?.removeEventListener('loadingdone',schedule);};
}
if(typeof document!=='undefined'){
 const dispose=mountKineticCaptions(document);
 window.addEventListener('pagehide',dispose,{once:true});
}
