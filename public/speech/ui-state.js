/** Tracks the current utterance without letting a late final move the live view backwards. */
export class TurnView {
  constructor() { this.reset(); }
  reset() { this.current = null; this.seen = new Set(); }
  observe(utteranceId) {
    if (typeof utteranceId !== 'string') return { current: false, changed: false };
    let changed = false;
    if (!this.seen.has(utteranceId)) {
      this.seen.add(utteranceId);
      this.current = utteranceId;
      changed = true;
      if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    }
    return { current: this.current === utteranceId, changed };
  }
  isCurrent(utteranceId) { return this.current === utteranceId; }
}
