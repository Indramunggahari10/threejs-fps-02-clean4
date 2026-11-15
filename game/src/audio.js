// Audio: every sound is synthesized with WebAudio — no audio files, no network.
// Short filtered-noise bursts for shots, a low sine thump for the explosion, and
// small blips for UI, hits and the charge beeps. The context is created lazily on
// the first user gesture; headless runs stay silent without errors.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = null) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    shot(kind) {
      if (kind === 'marksman') { noiseBurst(0.22, 900, 0.5); tone(140, 0.16, 0.25, 'sine', 55); }
      else if (kind === 'rifle') noiseBurst(0.11, 1800, 0.4);
      else if (kind === 'smg') noiseBurst(0.07, 2400, 0.3);
      else noiseBurst(0.09, 1500, 0.35);
    },
    enemyShot() { noiseBurst(0.09, 1200, 0.16); },
    dryFire() { tone(1800, 0.04, 0.12, 'square'); },
    reload() { tone(900, 0.05, 0.12, 'square'); tone(650, 0.05, 0.12, 'square'); },
    hit() { tone(2400, 0.05, 0.16, 'sine'); },
    kill() { tone(880, 0.09, 0.2, 'sine'); tone(1320, 0.12, 0.18, 'sine'); },
    hurt() { tone(220, 0.12, 0.22, 'sawtooth', 110); },
    plantBeep() { tone(1200, 0.08, 0.18, 'square'); },
    defuseBeep() { tone(980, 0.08, 0.18, 'square'); },
    planted() { tone(660, 0.15, 0.22, 'square'); tone(990, 0.2, 0.22, 'square'); },
    explosion() {
      noiseBurst(0.9, 300, 0.7);
      tone(90, 0.8, 0.5, 'sine', 32);
    },
    roundWin() { tone(523, 0.14, 0.2, 'sine'); tone(659, 0.14, 0.2, 'sine'); tone(784, 0.22, 0.22, 'sine'); },
    roundLose() { tone(392, 0.16, 0.2, 'sine'); tone(330, 0.16, 0.2, 'sine'); tone(262, 0.26, 0.22, 'sine'); },
    buy() { tone(1040, 0.06, 0.16, 'square'); },
    denied() { tone(200, 0.12, 0.16, 'square'); },
    flash() { tone(3200, 0.3, 0.1, 'sine', 2400); },
  };
}
