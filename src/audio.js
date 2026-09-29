// Sound, synthesised with Web Audio (no files): wind that gusts and grows with altitude and
// flying speed, running water near the river and streams, footsteps on dry ground, a thud
// on landing and the discovery chime.
// Starts on the first click / tap (browsers require a gesture); M or the menu mutes it.
const KEY = "bamyan.sound.v1";

function noiseBuffer(ctx, seconds, brown = false) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(KEY) === "off";
    } catch { /* no storage */ }
    this.gust = 0;
    this.gustTarget = 0.5;
    this.gustTimer = 0;
  }

  // call from a user gesture
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // wind: brown noise through a moving band-pass, plus a hiss layer
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 6, true);
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer(ctx, 3);
    hiss.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = "highpass";
    this.hissFilter.frequency.value = 2500;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(this.hissFilter).connect(this.hissGain).connect(this.master);
    hiss.start();

    // running water: bubbling band of noise, amplitude-modulated
    const water = ctx.createBufferSource();
    water.buffer = noiseBuffer(ctx, 4);
    water.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 1300;
    wf.Q.value = 0.7;
    const wlow = ctx.createBiquadFilter();
    wlow.type = "lowpass";
    wlow.frequency.value = 3200;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(wf.frequency);
    lfo.start();
    water.connect(wf).connect(wlow).connect(this.waterGain).connect(this.master);
    water.start();

    this.white = noiseBuffer(ctx, 1);
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(KEY, m ? "off" : "on");
    } catch { /* no storage */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }

  // altitude above ground (m), speed (m/s), is the player flying, nearby water 0..1
  update(dt, altitude, speed, flying, active, water = 0) {
    if (!this.ctx) return;
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTarget = 0.25 + Math.random() * 0.75;
      this.gustTimer = 2 + Math.random() * 5;
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.6);
    const high = Math.min(1, Math.max(0, altitude) / 400);
    const rush = flying ? Math.min(1, speed / 180) : 0;
    const level = active ? (0.05 + 0.09 * this.gust + 0.12 * high + 0.3 * rush) : 0.02;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(level, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(260 + 380 * this.gust + 700 * rush, t, 0.4);
    this.hissGain.gain.setTargetAtTime(active ? 0.006 + 0.02 * this.gust * high + 0.05 * rush : 0, t, 0.3);
    this.waterGain.gain.setTargetAtTime(active ? water * 0.09 : 0, t, 0.4);
  }

  // one footstep: a short crunch of filtered noise
  step(speed) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900 + Math.random() * 900;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    const v = Math.min(0.2, 0.07 + speed * 0.01) * (0.8 + Math.random() * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13 + Math.random() * 0.05);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.8, 0.2);
  }

  land(impact) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.min(0.35, impact * 0.025), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, 0, 0.3);
  }

  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, dt] of [[660, 0], [990, 0.12], [1320, 0.26]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.1, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.1);
      o.connect(g).connect(this.master);
      o.start(t + dt);
      o.stop(t + dt + 1.2);
    }
  }
}
