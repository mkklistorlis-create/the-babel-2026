import test from 'node:test';
import assert from 'node:assert/strict';
import { PCMEncoder } from '../public/speech/pcm-core.js';

const join = frames => Buffer.concat(frames.map(frame => Buffer.from(frame)));
const wave = (rate, seconds, frequency) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, n) => 0.7 * Math.sin(2 * Math.PI * frequency * n / rate));
function rms(bytes) {
  let sum = 0;
  const count = bytes.length / 2;
  for (let i = 200; i < count; i++) sum += (bytes.readInt16LE(i * 2) / 32768) ** 2;
  return Math.sqrt(sum / (count - 200));
}

test('48k and 44.1k deliver 40ms PCM16 frames with correct one-second duration', () => {
  for (const rate of [48000, 44100, 16000]) {
    const frames = new PCMEncoder(rate).push(wave(rate, 1, 1000));
    assert.equal(frames.length, 25);
    assert.ok(frames.every(frame => frame.byteLength === 1280));
  }
});

test('resampling is independent of AudioWorklet block boundaries', () => {
  const input = wave(44100, 2, 1337);
  const whole = join(new PCMEncoder(44100).push(input));
  const encoder = new PCMEncoder(44100);
  const fragments = [];
  for (let offset = 0; offset < input.length; offset += 128) fragments.push(...encoder.push(input.subarray(offset, offset + 128)));
  assert.deepEqual(join(fragments), whole);
});

test('anti-alias filter suppresses above-Nyquist input while preserving speech band', () => {
  const low = rms(join(new PCMEncoder(48000).push(wave(48000, 1, 2000))));
  const high = rms(join(new PCMEncoder(48000).push(wave(48000, 1, 12000))));
  assert.ok(low > 0.4, `speech band RMS ${low}`);
  assert.ok(high < low / 100, `alias RMS ${high}, speech RMS ${low}`);
});

test('PCM is signed little-endian, clipped, and finite for invalid samples', () => {
  const encoder = new PCMEncoder(16000);
  const values = new Float32Array(640).fill(1);
  values[0] = -2; values[1] = 2; values[2] = NaN; values[3] = Infinity;
  const [frame] = encoder.push(values);
  const result = new DataView(frame);
  assert.equal(result.getInt16(0, true), -32768);
  assert.equal(result.getInt16(2, true), 32767);
  assert.equal(result.getInt16(4, true), 0);
  assert.equal(result.getInt16(6, true), 0);
});

test('encoder retains bounded history and at most one incomplete frame', () => {
  const encoder = new PCMEncoder(48000);
  const block = new Float32Array(128);
  for (let n = 0; n < 5000; n++) encoder.push(block);
  assert.equal(encoder.history.length, 63);
  assert.equal(encoder.frame.byteLength, 1280);
  assert.ok(encoder.frameIndex < 640);
});
