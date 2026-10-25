/** Camera-space fingertip strokes. Projection/mirroring belongs to the renderer.
 * An ID identifies one tracked hand, never its left/right screen position.
 * Source timestamps govern continuity; acceptance time governs visible fading.
 * This preserves ink for CPU detections that arrive a few hundred ms late.
 * Duplicate source timestamps never extend a trail on repeated display frames.
 */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validPoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.y)
  && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export class HandTrailTracker {
  constructor({lifetimeMs=950,staleAfterMs=800,maxGapMs=550,maxJump=.28,maxPoints=96,maxStrokes=12}={}) {
    this.lifetimeMs=Math.max(100,lifetimeMs);
    this.staleAfterMs=Math.max(16,staleAfterMs);
    this.maxGapMs=Math.max(16,maxGapMs);
    this.maxJump=Math.max(.01,maxJump);
    this.maxPoints=Math.max(2,Math.floor(maxPoints));
    this.maxStrokes=Math.max(2,Math.floor(maxStrokes));
    this.reset();
  }

  get strokes() { return this._strokes; }

  reset() {
    this._strokes=[];
    this._active=new Map();
    this._seen=new Map();
    this._owner=undefined;
    this._sequence=0;
    this._time=-Infinity;
  }

  update(hands, now, {enabled=true,owner=null}={}) {
    if(!Number.isFinite(now))return this._strokes;
    if(!enabled) {this.reset();return this._strokes;}
    if(this._owner!==owner || now<this._time) this.reset();
    this._owner=owner;
    this._time=now;
    this._prune(now);
    const present=new Set();
    // The detector supports exactly two hands. A malformed payload must not
    // allocate an unbounded number of independent trails or history keys.
    for(const hand of (Array.isArray(hands)?hands:[]).slice(0,2)) {
      if(typeof hand?.id!=='string' || !hand.id || !validPoint(hand.tip))continue;
      const timestamp=hand.timestamp;
      if(!Number.isFinite(timestamp)||timestamp>now+50||now-timestamp>this.staleAfterMs)continue;
      const id=hand.id;
      present.add(id);
      const seen=this._seen.get(id);
      // A repeated render frame is not a fresh hand observation. In particular,
      // a first-frame breakTrail flag can remain true for several display ticks.
      if(seen!==undefined && timestamp<=seen)continue;
      this._seen.set(id,timestamp);
      let active=this._active.get(id);
      const distance=active?Math.hypot(hand.tip.x-active.raw.x,hand.tip.y-active.raw.y):0;
      if(!active||hand.breakTrail||timestamp-active.timestamp>this.maxGapMs||distance>this.maxJump) {
        const stroke={id:`${id}:${++this._sequence}`,handId:id,
          handedness:['Left','Right'].includes(hand.handedness)?hand.handedness:'Unknown',
          points:[{x:hand.tip.x,y:hand.tip.y,t:now}]};
        this._strokes.push(stroke);
        active={stroke,raw:{x:hand.tip.x,y:hand.tip.y},timestamp};
        this._active.set(id,active);
      }else {
        const points=active.stroke.points,last=points.at(-1);
        const dt=timestamp-active.timestamp;
        const amount=clamp(1-Math.exp(-dt/35),.25,.92);
        const x=last.x+(hand.tip.x-last.x)*amount;
        const y=last.y+(hand.tip.y-last.y)*amount;
        // Suppress subpixel noise while preserving freshness at the stroke tip.
        // A stationary hand leaves one stable endpoint rather than a scribble.
        if(Math.hypot(x-last.x,y-last.y)<.0012) last.t=now;
        else points.push({x,y,t:now});
        if(points.length>this.maxPoints)points.splice(0,points.length-this.maxPoints);
        active.raw={x:hand.tip.x,y:hand.tip.y};
        active.timestamp=timestamp;
      }
    }
    // Missing hands retain fading ink, but lose continuity immediately.
    for(const id of this._active.keys())if(!present.has(id))this._active.delete(id);
    this._prune(now);
    return this._strokes;
  }

  _prune(now) {
    const cutoff=now-this.lifetimeMs;
    for(const stroke of this._strokes) {
      let expired=0;
      while(expired<stroke.points.length&&stroke.points[expired].t<cutoff)expired++;
      if(expired)stroke.points.splice(0,expired);
    }
    this._strokes=this._strokes.filter(stroke=>stroke.points.length);
    if(this._strokes.length>this.maxStrokes)this._strokes.splice(0,this._strokes.length-this.maxStrokes);
    const retained=new Set(this._strokes);
    for(const [id,active] of this._active)if(!retained.has(active.stroke))this._active.delete(id);
    const seenCutoff=now-Math.max(this.lifetimeMs,this.staleAfterMs);
    for(const [id,time] of this._seen)if(time<seenCutoff)this._seen.delete(id);
  }
}
