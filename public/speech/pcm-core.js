/** Stateful mono resampler: FIR anti-alias filter, interpolation, PCM16LE framing. */
export class PCMEncoder {
  constructor(inputRate, outputRate = 16000, frameMs = 40) {
    if (!Number.isFinite(inputRate) || inputRate < outputRate || inputRate > 192000) throw new RangeError('Unsupported input sample rate.');
    if (!Number.isInteger(outputRate) || outputRate < 8000 || outputRate > 48000) throw new RangeError('Invalid output sample rate.');
    if (!Number.isFinite(frameMs) || frameMs < 20 || frameMs > 60) throw new RangeError('Frame duration must be 20–60 ms.');
    this.ratio = inputRate / outputRate;
    this.frameSize = Math.round(outputRate * frameMs / 1000);
    this.frame = new ArrayBuffer(this.frameSize * 2);
    this.view = new DataView(this.frame);
    this.frameIndex = 0;
    this.inputIndex = 0;
    this.nextOutput = 0;
    this.previous = 0;
    this.taps = inputRate === outputRate ? new Float64Array([1]) : lowPass(inputRate, outputRate);
    this.history = new Float64Array(this.taps.length);
    this.historyIndex = 0;
  }
  push(samples) {
    const frames = [];
    for (let n = 0; n < samples.length; n++) {
      this.history[this.historyIndex] = Number.isFinite(samples[n]) ? samples[n] : 0;
      let filtered = 0;
      for (let k = 0; k < this.taps.length; k++) filtered += this.history[(this.historyIndex - k + this.history.length) % this.history.length] * this.taps[k];
      this.historyIndex = (this.historyIndex + 1) % this.history.length;
      if (this.inputIndex >= this.nextOutput) {
        const fraction = this.nextOutput - (this.inputIndex - 1);
        const value = this.inputIndex === 0 ? filtered : this.previous + (filtered - this.previous) * fraction;
        const sample = Math.max(-1, Math.min(1, value));
        this.view.setInt16(this.frameIndex++ * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
        if (this.frameIndex === this.frameSize) {
          frames.push(this.frame);
          this.frame = new ArrayBuffer(this.frameSize * 2);
          this.view = new DataView(this.frame);
          this.frameIndex = 0;
        }
        this.nextOutput += this.ratio;
      }
      this.previous = filtered;
      this.inputIndex++;
    }
    return frames;
  }
}

function lowPass(inputRate, outputRate) {
  const count = 63;
  const cutoff = 0.43 * outputRate / inputRate;
  const taps = new Float64Array(count);
  let sum = 0;
  for (let n = 0; n < count; n++) {
    const x = n - (count - 1) / 2;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / (count - 1)) + 0.08 * Math.cos(4 * Math.PI * n / (count - 1));
    taps[n] = sinc * window;
    sum += taps[n];
  }
  for (let n = 0; n < count; n++) taps[n] /= sum;
  return taps;
}
