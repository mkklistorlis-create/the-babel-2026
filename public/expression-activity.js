export const FACIAL_ACTIVITY_METRIC='facial-activity-v1';
export const FACIAL_ACTIVITY_DESCRIPTION='面部活动指数（0–100）：由可见的嘴部、眉部、眼部动作幅度与变化速度生成；表情切换带来小幅短暂提升。它不表示情绪、心率或声音强度。曲线初始每 250 毫秒取窗口峰值，长会话自动合并窗口；窗口含缺失时留空。模拟画面使用预设表情强度。';

const clamp=value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
const round=value=>Math.round(Math.max(0,Math.min(100,value))*10)/10;
const gazeKeys=['eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight'];
const actionKeys=['smile','jawOpen','mouthPucker','mouthFrown','browRaise','browRaiseLeft','browRaiseRight','browLower','eyeWide','eyeWideLeft','eyeWideRight','eyeSquint','eyeSquintLeft','eyeSquintRight','eyeBlinkLeft','eyeBlinkRight',...gazeKeys];
const weights=[.36,.26,.27,.07,.04];
// Explicit, deterministic demo fallback. These values are artistic presets,
// not values inferred from a face, feelings or the movement-match `score`.
const demoLevels=Object.freeze({neutral:0,smile:.42,'open-mouth':.82,wink:.32,'eyes-closed':.12,pucker:.4,'brow-furrow':.68,
 'squint-smile':.58,'open-smile':.72,'closed-laugh':.86,'one-brow':.5,'mouth-frown':.4,'raised-eyes':.7,
 'closed-pucker':.42,'eyes-narrow':.3,'one-eye-squint':.35,'gaze-side':.22,'gaze-up':.28});

function readGroups(actions){
 if(!actions||typeof actions!=='object'||Array.isArray(actions)||!actionKeys.some(key=>Number.isFinite(actions[key])))return null;
 const max=keys=>Math.max(...keys.map(key=>clamp(actions[key])));
 return [max(['smile','jawOpen','mouthPucker','mouthFrown']),max(['browRaise','browRaiseLeft','browRaiseRight','browLower']),
  max(['eyeWide','eyeWideLeft','eyeWideRight','eyeSquint','eyeSquintLeft','eyeSquintRight']),max(gazeKeys),
  Math.min(clamp(actions.eyeBlinkLeft),clamp(actions.eyeBlinkRight))];
}

/**
 * Input is the existing smoothed facial-action signal, not a new classifier.
 * Level = .65 * max(mouth,brows,eyes) + .35 * weighted group amplitude.
 * Speed = clamped weighted change / (2 * elapsed seconds); blink has no speed term.
 * Target = 100 * (.70 * level + .23 * speed + .07 * transition pulse).
 * Pulse decays over 450ms; output uses a 180ms time-based low-pass filter.
 * First/reacquired observations have zero speed and zero transition pulse.
 */
export function createFacialActivityTracker({mode='live',maxGapMs=500}={}){
 let lastAt=null,previous=null,previousId=null,pulse=0,filtered=null,value=null;
 function clear(){previous=null;previousId=null;pulse=0;filtered=null;value=null;}
 return {
  update(input,at){
   if(!Number.isFinite(at)||at<0||(lastAt!==null&&at<lastAt))return value;
   const dt=lastAt===null?0:at-lastAt;
   const groups=readGroups(input?.actions);
   const synthetic=mode==='demo'&&!groups&&Object.hasOwn(demoLevels,input?.expressionId);
   if(input?.valid!==true||(!groups&&!synthetic)){lastAt=at;clear();return null;}
   if(dt>maxGapMs)clear();
   const amplitudes=groups||[demoLevels[input.expressionId],0,0,0,0];
   const weighted=amplitudes.reduce((sum,v,i)=>sum+v*weights[i],0);
   const level=synthetic?demoLevels[input.expressionId]:.65*Math.max(...amplitudes.slice(0,3))+.35*weighted;
   let speed=0;
   if(previous&&dt>0){
    speed=clamp(amplitudes.slice(0,4).reduce((sum,v,i)=>sum+Math.abs(v-previous[i])*weights[i],0)/(2*Math.max(.04,dt/1000)));
    pulse*=Math.exp(-dt/450);
    if(input.expressionId!==previousId)pulse=1;
   }
   const target=100*(.70*level+.23*speed+.07*pulse);
   const alpha=1-Math.exp(-Math.min(250,Math.max(0,dt))/180);
   filtered=filtered===null?target:filtered+(target-filtered)*alpha;
   previous=amplitudes;previousId=input.expressionId;lastAt=at;value=round(filtered);
   return value;
  },
  reset(){lastAt=null;clear();},
 };
}
