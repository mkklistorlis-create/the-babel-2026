// Keep subtitles, recording controls and navigation in one measured dock.
// This changes DOM layout only; camera projection and tracking stay independent.
const dock=document.getElementById('ui-dock');
const speech=document.getElementById('speech-panel');
const debug=document.getElementById('debug');
const room=document.getElementById('room-panel');
const panels=[speech,debug,room];
function closeOthers(active){
 for(const panel of panels){
  if(panel===active)continue;
  if(panel===speech)panel.open=false;else panel.hidden=true;
 }
}
const resize=new ResizeObserver(()=>{
 document.documentElement.style.setProperty('--ui-dock-height',`${Math.ceil(dock.getBoundingClientRect().height)}px`);
});
resize.observe(dock);
speech.addEventListener('toggle',()=>{if(speech.open)closeOthers(speech);});
const visibility=new MutationObserver(records=>{
 const opened=records.map(record=>record.target).find(panel=>!panel.hidden);
 if(opened)closeOthers(opened);
});
for(const panel of [debug,room])visibility.observe(panel,{attributes:true,attributeFilter:['hidden']});
document.getElementById('speech-close').onclick=()=>{speech.open=false;speech.querySelector('summary').focus();};
// Native buttons keep Space/Enter; these keys should not pause the artwork.
dock.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
speech.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
window.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&speech.open){
  event.preventDefault();event.stopPropagation();speech.open=false;speech.querySelector('summary').focus();
 }
},true);
window.addEventListener('pagehide',()=>{resize.disconnect();visibility.disconnect();},{once:true});
