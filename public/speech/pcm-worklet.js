import { PCMEncoder } from './pcm-core.js';

class SemanticPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.encoder = new PCMEncoder(sampleRate, 16000, 40);
    this.running = true;
    this.port.onmessage = ({ data }) => { if (data === 'stop') this.running = false; };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!this.running) return false;
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    for (const frame of this.encoder.push(mono)) this.port.postMessage(frame, [frame]);
    return true;
  }
}
registerProcessor('semantic-pcm', SemanticPCMProcessor);
