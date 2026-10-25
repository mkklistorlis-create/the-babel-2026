// Adapted from the user's echo-of-motion/dist/particle-motion.js (2026-10-24).
// Persistent, spring-driven square particles. All color comes from the source.
// Camera frames remain on-device; a small image supplies color and optical flow.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const TAU = Math.PI * 2;
const FLOW_STEP = 10;
const SPACING = 9.5;
const SIZE_MIN = 10, SIZE_RANGE = 18;
const MOTION_GAIN = 4.2, MOTION_LIMIT = 60;
const SEARCH = [-4, -2, 0, 2, 4];

export class ParticleMotion {
  constructor() {
    this.sample = document.createElement('canvas');
    this.context = this.sample.getContext('2d', { willReadFrequently: true });
    this.width = this.height = 1;
    this.count = 0;
    this._stats = { activeCount: 0, movingCount: 0, averageDisplacement: 0, maxDisplacement: 0 };
    this._mask = null;
    this._lastSample = -Infinity;
    this._lastTime = null;
    this._artTime = 0;
    this._lastSource = null;
    this._image = null;
    this._previous = null;
    this._flowX = this._flowY = null;
    this._particles = [];
    this._output = new Float32Array(0);
  }

  get stats() { return { ...this._stats }; }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    let seed = 73;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    this._particles = [];
    for (let y = SPACING / 2; y < this.height; y += SPACING) {
      for (let x = SPACING / 2; x < this.width; x += SPACING) {
        const homeX = x + (random() - 0.5) * SPACING * .82;
        const homeY = y + (random() - 0.5) * SPACING * .82;
        this._particles.push({
          homeX, homeY, x: homeX, y: homeY, vx: 0, vy: 0,
          size: SIZE_MIN + random() * SIZE_RANGE, phase: random() * TAU,
          response: 0.75 + random() * 0.5,
          r: 0, g: 0, b: 0, alpha: 0,
        });
      }
    }
    this._output = new Float32Array(this._particles.length * 7);
    this.count = 0;
    this._lastTime = null;
    this._artTime = 0;
    this._lastSource = null;
  }

  setMask(mask) {
    // The tracker passes an owned byte array, with 255=person, 0=background.
    this._mask = mask?.data && mask.width > 0 && mask.height > 0 ? mask : null;
  }

  reset() {
    this._mask = null;
    this._image = null;
    this._previous = null;
    this._flowX = this._flowY = null;
    this._lastSample = -Infinity;
    this._lastTime = null;
    this._lastSource = null;
    this._artTime = 0;
    this.count = 0;
    this._output.fill(0);
    this._stats = { activeCount: 0, movingCount: 0, averageDisplacement: 0, maxDisplacement: 0 };
    for (const p of this._particles) {
      p.x = p.homeX; p.y = p.homeY; p.vx = p.vy = p.alpha = 0;
      p.r = p.g = p.b = 0;
    }
  }

  _readFrame(source, now, sourceWidth, sourceHeight) {
    if (now - this._lastSample < 50) return false;
    // A matched ImageBitmap changes only on a new inference frame. Reading it
    // repeatedly would fabricate zero flow between actual camera observations.
    if (source === this._lastSource && source.currentTime === undefined) return false;
    const width = Math.max(1, Math.min(192, Math.round(256 * sourceWidth / sourceHeight)));
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    if (this.sample.width !== width || this.sample.height !== height) {
      this.sample.width = width; this.sample.height = height;
      this._previous = null;
      this._flowX = this._flowY = null;
    }
    this.context.drawImage(source, 0, 0, width, height);
    const image = this.context.getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = image[i * 4] * 0.2126 + image[i * 4 + 1] * 0.7152 + image[i * 4 + 2] * 0.0722;
    }
    const columns = this._flowColumns = Math.ceil(width / FLOW_STEP);
    const rows = this._flowRows = Math.ceil(height / FLOW_STEP);
    const flowX = new Float32Array(columns * rows);
    const flowY = new Float32Array(columns * rows);
    const previous = this._previous;
    if (previous) {
      // Small block matching: current patch (x,y) versus prior (x-dx,y-dy).
      // The positive candidate therefore describes the image's actual motion.
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const cx = Math.min(width - 7, Math.max(6, col * FLOW_STEP + 5));
          const cy = Math.min(height - 7, Math.max(6, row * FLOW_STEP + 5));
          if (width < 14 || height < 14) continue;
          let zeroError = 0;
          for (let sy = -2; sy <= 2; sy += 2) for (let sx = -2; sx <= 2; sx += 2) {
            const at = (cy + sy) * width + cx + sx;
            zeroError += Math.abs(gray[at] - previous[at]);
          }
          let bestError = zeroError, bestX = 0, bestY = 0;
          if (zeroError > 27) {
            for (const dy of SEARCH) for (const dx of SEARCH) {
              if (!dx && !dy) continue;
              let error = (Math.abs(dx) + Math.abs(dy)) * 1.5;
              for (let sy = -2; sy <= 2; sy += 2) for (let sx = -2; sx <= 2; sx += 2) {
                error += Math.abs(gray[(cy + sy) * width + cx + sx] - previous[(cy + sy - dy) * width + cx + sx - dx]);
              }
              if (error < bestError) { bestError = error; bestX = dx; bestY = dy; }
            }
          }
          const at = row * columns + col;
          const confidence = clamp((zeroError - bestError) / Math.max(zeroError, 1) * 2, 0, 1);
          // Decaying flow keeps motion coherent between 20 Hz image samples.
          flowX[at] = (this._flowX?.[at] || 0) * 0.45 + bestX * confidence * 0.55;
          flowY[at] = (this._flowY?.[at] || 0) * 0.45 + bestY * confidence * 0.55;
        }
      }
    }
    this._flowX = flowX; this._flowY = flowY;
    this._image = image; this._previous = gray;
    this._lastSample = now;
    this._lastSource = source;
    return true;
  }

  update(source, now, {animate = true} = {}) {
    const sourceWidth = source?.videoWidth || source?.width || 0;
    const sourceHeight = source?.videoHeight || source?.height || 0;
    const ready = sourceWidth > 0 && sourceHeight > 0 && (source.readyState === undefined || source.readyState >= 2);
    if (!ready) {
      this.count = 0;
      this._lastTime = null;
      return this._output.subarray(0, 0);
    }
    const dt = this._lastTime === null ? 1 / 60 : clamp((now - this._lastTime) / 1000, 0, 0.04);
    this._lastTime = now;
    if (animate) this._artTime += dt;
    const sampled = this._readFrame(source, now, sourceWidth, sourceHeight);
    const image = this._image;
    if (!image) { this.count = 0; return this._output.subarray(0, 0); }
    const sw = this.sample.width, sh = this.sample.height;
    const aspect = this.width / this.height, imageAspect = sourceWidth / sourceHeight;
    const cropX = Math.min(aspect / imageAspect, 1), cropY = Math.min(imageAspect / aspect, 1);
    const sourceToScreenX = this.width / (sw * cropX), sourceToScreenY = this.height / (sh * cropY);
    const mask = this._mask;
    const time = this._artTime;
    let count = 0, activeCount = 0, movingCount = 0, totalDisplacement = 0, maxDisplacement = 0;
    for (const p of this._particles) {
      const u = 1 - ((p.homeX / this.width - 0.5) * cropX + 0.5);
      const v = (p.homeY / this.height - 0.5) * cropY + 0.5;
      const ix = clamp(Math.floor(u * sw), 0, sw - 1), iy = clamp(Math.floor(v * sh), 0, sh - 1);
      const foreground = !!mask && mask.data[clamp(Math.floor(v * mask.height), 0, mask.height - 1) * mask.width + clamp(Math.floor(u * mask.width), 0, mask.width - 1)] > 127;
      if (foreground) {
        activeCount++;
        if (sampled || p.alpha === 0) {
          const at = (iy * sw + ix) * 4;
          p.r = image[at] / 255; p.g = image[at + 1] / 255; p.b = image[at + 2] / 255;
        }
        p.alpha += (1 - p.alpha) * (1 - Math.exp(-dt * 14));
      } else {
        // Keep each departed particle's sampled RGB while it drifts and fades.
        p.alpha *= Math.exp(-dt * 5.5);
        if (p.alpha < 0.025) {
          p.alpha = 0; p.x = p.homeX; p.y = p.homeY; p.vx = p.vy = 0;
          continue;
        }
      }
      const flowIndex = Math.min(this._flowRows - 1, Math.floor(iy / FLOW_STEP)) * this._flowColumns + Math.min(this._flowColumns - 1, Math.floor(ix / FLOW_STEP));
      // Horizontal flow reverses with the selfie preview's horizontal mirror.
      const motionX = foreground ? clamp(-this._flowX[flowIndex] * sourceToScreenX * MOTION_GAIN, -MOTION_LIMIT, MOTION_LIMIT) : 0;
      const motionY = foreground ? clamp(this._flowY[flowIndex] * sourceToScreenY * MOTION_GAIN, -MOTION_LIMIT, MOTION_LIMIT) : 0;
      const idleX = Math.sin(time * 1.1 + p.phase) * 6.5 + Math.sin(time * 0.47 + p.homeY * 0.018) * 2.5 + Math.sin(time * 2.1 + p.phase * 1.7) * 1.1;
      const idleY = Math.cos(time * 0.9 + p.phase) * 6.5 + Math.sin(time * 0.53 + p.homeX * 0.016) * 2.5 + Math.cos(time * 1.8 + p.phase * 1.3) * 1.1;
      const targetX = p.homeX + idleX + motionX * p.response;
      const targetY = p.homeY + idleY + motionY * p.response;
      const spring = foreground ? 45 : 7;
      const damping = foreground ? 7.8 : 3;
      const motionDt = animate ? dt : 0;
      p.vx += ((targetX - p.x) * spring - p.vx * damping) * motionDt;
      p.vy += ((targetY - p.y) * spring - p.vy * damping) * motionDt;
      p.vx = clamp(p.vx, -340, 340); p.vy = clamp(p.vy, -340, 340);
      p.x += p.vx * motionDt; p.y += p.vy * motionDt;
      const displacement = Math.hypot(p.x - p.homeX, p.y - p.homeY);
      totalDisplacement += displacement; maxDisplacement = Math.max(maxDisplacement, displacement);
      if (Math.hypot(p.vx, p.vy) > 2) movingCount++;
      const at = count++ * 7;
      this._output[at] = p.x / this.width;
      this._output[at + 1] = p.y / this.height;
      this._output[at + 2] = p.size * (1 + Math.sin(time * 1.3 + p.phase) * .025);
      this._output[at + 3] = p.r;
      this._output[at + 4] = p.g;
      this._output[at + 5] = p.b;
      this._output[at + 6] = p.alpha;
    }
    this.count = count;
    this._stats = { activeCount, movingCount, averageDisplacement: count ? totalDisplacement / count : 0, maxDisplacement };
    return this._output.subarray(0, count * 7);
  }
}
