// Use the speech controller's existing language selection and persistence.
const select=document.getElementById('speech-language');
const buttons=[...document.querySelectorAll('#intro [data-language]')];
function sync(){
 for(const button of buttons){
  button.setAttribute('aria-pressed',String(button.dataset.language===select.value));
  button.disabled=select.disabled;
 }
}
for(const button of buttons)button.addEventListener('click',()=>{
 if(select.disabled)return;
 select.value=button.dataset.language;
 select.dispatchEvent(new Event('change',{bubbles:true}));
 sync();
});
select.addEventListener('change',sync);
const state=new MutationObserver(sync);
state.observe(select,{attributes:true,attributeFilter:['disabled']});
window.addEventListener('pagehide',()=>state.disconnect(),{once:true});
sync();
