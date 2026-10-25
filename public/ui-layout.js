// Keep subtitles, recording controls and navigation in one measured dock.
// This changes DOM layout only; camera projection and tracking stay independent.
const dock=document.getElementById('ui-dock');
const debug=document.getElementById('debug');
const room=document.getElementById('room-panel');
const panels=[debug,room];
function closeOthers(active){
 for(const panel of panels){
  if(panel===active)continue;
  panel.hidden=true;
 }
}
const resize=new ResizeObserver(()=>{
 document.documentElement.style.setProperty('--ui-dock-height',`${Math.ceil(dock.getBoundingClientRect().height)}px`);
});
resize.observe(dock);
const visibility=new MutationObserver(records=>{
 const opened=records.map(record=>record.target).find(panel=>!panel.hidden);
 if(opened)closeOthers(opened);
});
for(const panel of [debug,room])visibility.observe(panel,{attributes:true,attributeFilter:['hidden']});
// Native buttons keep Space/Enter; these keys should not pause the artwork.
dock.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
window.addEventListener('pagehide',()=>{resize.disconnect();visibility.disconnect();},{once:true});
