// All language controls use one controller; preferences stay local to this device.
const select=document.getElementById('speech-language');
const buttons=[...document.querySelectorAll('#intro [data-language]')];
const selects=[...document.querySelectorAll('[data-language-select]')];
const peerNames={zh:'Chinese',en:'English',ja:'Japanese',es:'Spanish'};
function sync(){
 for(const button of buttons){button.setAttribute('aria-pressed',String(button.dataset.language===select.value));button.disabled=select.disabled;}
 for(const control of selects){control.value=select.value;control.disabled=select.disabled;}
}
function choose(value){
 if(select.disabled){sync();return;}
 select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();
}
for(const button of buttons)button.addEventListener('click',()=>choose(button.dataset.language));
for(const control of selects)control.addEventListener('change',()=>choose(control.value));
function languageState({detail}){
 sync();
 for(const label of document.querySelectorAll('[data-peer-language]')){
  label.hidden=!detail.connected;
  label.textContent=detail.remoteLanguage?`Partner: ${peerNames[detail.remoteLanguage]||'…'}`:'Waiting for partner’s language…';
 }
}
select.addEventListener('change',sync);
window.addEventListener('between-us:language-state',languageState);
const state=new MutationObserver(sync);state.observe(select,{attributes:true,attributeFilter:['disabled']});
window.addEventListener('pagehide',()=>{state.disconnect();window.removeEventListener('between-us:language-state',languageState);},{once:true});
sync();
