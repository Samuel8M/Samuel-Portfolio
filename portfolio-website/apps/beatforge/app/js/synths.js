// synths.js
//
// Procedural drum synthesis. Every voice is built from oscillators and/or a
// shared white-noise buffer, shaped with gain envelopes and filters. Nothing
// here loads an audio file.
//
// Each `play*` function schedules its own nodes to start/stop at an explicit
// `time` (an AudioContext timestamp, in seconds) rather than "now" -- this is
// what lets the scheduler in sequencer.js queue notes ahead of time with
// sample-accurate timing. Every node created here is short-lived: it starts,
// plays its envelope, and is disconnected/garbage-collected after it stops.

/**
 * Build a short buffer of white noise, reused by every noise-based voice
 * (hi-hats, snare body, clap) instead of generating a new buffer per hit.
 */
export function createNoiseBuffer(audioContext, durationSeconds = 2) {
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, durationSeconds * sampleRate, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Kick drum: a sine oscillator with a fast pitch drop (150Hz -> 45Hz) and an
 * exponential amplitude decay. The pitch envelope is what gives it the
 * characteristic "thump" rather than a flat tone.
 */
export function playKick(audioContext, destination, time, gain = 1) {
  const osc = audioContext.createOscillator();
  const ampGain = audioContext.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);

  ampGain.gain.setValueAtTime(gain, time);
  ampGain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

  osc.connect(ampGain);
  ampGain.connect(destination);

  osc.start(time);
  osc.stop(time + 0.4);
}

/**
 * Snare: a triangle "body" tone around 180Hz layered with a burst of
 * highpass-filtered noise for the characteristic "snap". Both layers share
 * the same short exponential decay.
 */
export function playSnare(audioContext, destination, time, gain = 1, noiseBuffer) {
  // Tonal body.
  const osc = audioContext.createOscillator();
  const oscGain = audioContext.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, time);
  oscGain.gain.setValueAtTime(gain * 0.6, time);
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  osc.connect(oscGain);
  oscGain.connect(destination);
  osc.start(time);
  osc.stop(time + 0.15);

  // Noise snap.
  const noise = audioContext.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseFilter = audioContext.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1000;
  const noiseGain = audioContext.createGain();
  noiseGain.gain.setValueAtTime(gain * 0.8, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(destination);
  noise.start(time);
  noise.stop(time + 0.2);
}

/**
 * Closed hi-hat: highpass-filtered noise with a very short decay (~40ms).
 */
export function playClosedHat(audioContext, destination, time, gain = 1, noiseBuffer) {
  const noise = audioContext.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = audioContext.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;

  const ampGain = audioContext.createGain();
  ampGain.gain.setValueAtTime(gain * 0.6, time);
  ampGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

  noise.connect(filter);
  filter.connect(ampGain);
  ampGain.connect(destination);

  noise.start(time);
  noise.stop(time + 0.06);
}

/**
 * Open hi-hat: the same highpass-filtered noise as the closed hat, but with
 * a much longer decay (~300ms) so it rings out.
 */
export function playOpenHat(audioContext, destination, time, gain = 1, noiseBuffer) {
  const noise = audioContext.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = audioContext.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 6000;

  const ampGain = audioContext.createGain();
  ampGain.gain.setValueAtTime(gain * 0.5, time);
  ampGain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

  noise.connect(filter);
  filter.connect(ampGain);
  ampGain.connect(destination);

  noise.start(time);
  noise.stop(time + 0.32);
}

/**
 * Clap: three quick, slightly-offset bursts of bandpass-filtered noise. The
 * tiny time offsets between bursts emulate the "flam" of multiple hands.
 */
export function playClap(audioContext, destination, time, gain = 1, noiseBuffer) {
  const burstOffsets = [0, 0.01, 0.02];

  burstOffsets.forEach((offset, i) => {
    const startTime = time + offset;
    const noise = audioContext.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 1.5;

    const ampGain = audioContext.createGain();
    const peak = i === burstOffsets.length - 1 ? gain * 0.7 : gain * 0.45;
    ampGain.gain.setValueAtTime(peak, startTime);
    ampGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

    noise.connect(filter);
    filter.connect(ampGain);
    ampGain.connect(destination);

    noise.start(startTime);
    noise.stop(startTime + 0.09);
  });
}

// Maps a track id to its synth function so main.js can dispatch generically.
export const VOICES = {
  kick: playKick,
  snare: playSnare,
  closedHat: playClosedHat,
  openHat: playOpenHat,
  clap: playClap,
};
