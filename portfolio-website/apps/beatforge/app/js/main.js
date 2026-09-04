// main.js
//
// Application state, UI rendering, and event wiring. Audio synthesis lives in
// synths.js; the timing engine lives in sequencer.js. This module glues them
// to the DOM.

import { createNoiseBuffer, VOICES } from './synths.js';
import { StepSequencer } from './sequencer.js';

const STEP_COUNT = 16;
const STORAGE_KEY = 'beatforge:pattern:v1';

const TRACKS = [
  { id: 'kick', name: 'Kick', color: '#e74c3c', defaultVolume: 0.9, randomChance: 0.25 },
  { id: 'snare', name: 'Snare', color: '#f39c12', defaultVolume: 0.8, randomChance: 0.18 },
  { id: 'closedHat', name: 'Closed Hat', color: '#2ecc71', defaultVolume: 0.6, randomChance: 0.45 },
  { id: 'openHat', name: 'Open Hat', color: '#3498db', defaultVolume: 0.6, randomChance: 0.12 },
  { id: 'clap', name: 'Clap', color: '#9b59b6', defaultVolume: 0.8, randomChance: 0.12 },
];

/** @type {{ bpm: number, pattern: Record<string, boolean[]>, volumes: Record<string, number> }} */
const state = {
  bpm: 120,
  pattern: {},
  volumes: {},
};

for (const track of TRACKS) {
  state.pattern[track.id] = new Array(STEP_COUNT).fill(false);
  state.volumes[track.id] = track.defaultVolume;
}

// --- Audio graph (created lazily on first Play, per browser autoplay rules) ---

/** @type {AudioContext | null} */
let audioContext = null;
/** @type {AudioBuffer | null} */
let noiseBuffer = null;
/** @type {GainNode | null} */
let masterGain = null;
/** @type {Record<string, GainNode>} */
let trackGains = {};
/** @type {StepSequencer | null} */
let sequencer = null;

function ensureAudioGraph() {
  if (audioContext) return;

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  noiseBuffer = createNoiseBuffer(audioContext);

  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioContext.destination);

  trackGains = {};
  for (const track of TRACKS) {
    const gainNode = audioContext.createGain();
    gainNode.gain.value = state.volumes[track.id];
    gainNode.connect(masterGain);
    trackGains[track.id] = gainNode;
  }

  sequencer = new StepSequencer(
    audioContext,
    STEP_COUNT,
    scheduleStep, // fires ahead of playback, on the audio clock
    advancePlayhead // fires at the same moments, drives the UI
  );
  sequencer.setBpm(state.bpm);
}

/**
 * Called by the scheduler for every step, ahead of when it will actually
 * sound. `time` is an AudioContext timestamp -- we hand it straight to the
 * synth functions, which use it as the exact start time for their oscillator
 * / buffer-source nodes. We never play anything "now": everything is
 * scheduled against this future timestamp.
 */
function scheduleStep(step, time) {
  for (const track of TRACKS) {
    if (state.pattern[track.id][step]) {
      const voice = VOICES[track.id];
      voice(audioContext, trackGains[track.id], time, 1, noiseBuffer);
    }
  }
}

// --- Playhead visualization ---
//
// The scheduler tells us *when* (in AudioContext time) each step will sound,
// but we still shouldn't paint the UI with setTimeout(callback, delayMs) --
// that reintroduces the same drift/jitter problem for visuals. Instead we
// queue the upcoming {step, time} pairs and poll them against
// audioContext.currentTime inside a requestAnimationFrame loop, which is the
// browser's own paint-synced clock. A step is highlighted only once its
// scheduled time has actually arrived.

/** @type {{ step: number, time: number }[]} */
const playheadQueue = [];
let lastHighlightedStep = -1;
let rafId = null;

function advancePlayhead(step, time) {
  playheadQueue.push({ step, time });
}

function playheadLoop() {
  if (audioContext) {
    const now = audioContext.currentTime;
    let next;
    while (playheadQueue.length && playheadQueue[0].time <= now) {
      next = playheadQueue.shift();
    }
    if (next && next.step !== lastHighlightedStep) {
      highlightStep(next.step);
      lastHighlightedStep = next.step;
    }
  }
  rafId = requestAnimationFrame(playheadLoop);
}

function highlightStep(step) {
  document.querySelectorAll('.step.playing').forEach((el) => el.classList.remove('playing'));
  document.querySelectorAll(`.step[data-step="${step}"]`).forEach((el) => el.classList.add('playing'));
}

function clearPlayhead() {
  playheadQueue.length = 0;
  lastHighlightedStep = -1;
  document.querySelectorAll('.step.playing').forEach((el) => el.classList.remove('playing'));
}

// --- UI rendering ---

const sequencerEl = document.getElementById('sequencer');
const playBtn = document.getElementById('playBtn');
const clearBtn = document.getElementById('clearBtn');
const randomBtn = document.getElementById('randomBtn');
const bpmRange = document.getElementById('bpmRange');
const bpmInput = document.getElementById('bpmInput');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const saveStatus = document.getElementById('saveStatus');

function renderSequencer() {
  sequencerEl.innerHTML = '';

  for (const track of TRACKS) {
    const row = document.createElement('div');
    row.className = 'track-row';

    const label = document.createElement('div');
    label.className = 'track-label';
    const swatch = document.createElement('span');
    swatch.className = 'track-swatch';
    swatch.style.background = track.color;
    label.appendChild(swatch);
    label.appendChild(document.createTextNode(track.name));
    row.appendChild(label);

    for (let step = 0; step < STEP_COUNT; step++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'step';
      btn.dataset.step = String(step);
      btn.dataset.track = track.id;
      btn.setAttribute('aria-label', `${track.name} step ${step + 1}`);
      btn.setAttribute('aria-pressed', 'false');
      if (step % 4 === 0) btn.classList.add('beat-marker');
      btn.addEventListener('click', () => toggleStep(track.id, step));
      row.appendChild(btn);
    }
    sequencerEl.appendChild(row);

    const controls = document.createElement('div');
    controls.className = 'track-controls';
    const volLabel = document.createElement('label');
    volLabel.textContent = `${track.name} volume`;
    volLabel.setAttribute('for', `vol-${track.id}`);
    const volInput = document.createElement('input');
    volInput.type = 'range';
    volInput.id = `vol-${track.id}`;
    volInput.min = '0';
    volInput.max = '1';
    volInput.step = '0.01';
    volInput.value = String(state.volumes[track.id]);
    volInput.addEventListener('input', () => setVolume(track.id, Number(volInput.value)));
    controls.appendChild(volLabel);
    controls.appendChild(volInput);
    sequencerEl.appendChild(controls);
  }

  syncStepButtonsFromState();
}

function syncStepButtonsFromState() {
  for (const track of TRACKS) {
    for (let step = 0; step < STEP_COUNT; step++) {
      const btn = sequencerEl.querySelector(`.step[data-track="${track.id}"][data-step="${step}"]`);
      if (!btn) continue;
      const on = state.pattern[track.id][step];
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    const volInput = document.getElementById(`vol-${track.id}`);
    if (volInput) volInput.value = String(state.volumes[track.id]);
  }
  bpmRange.value = String(state.bpm);
  bpmInput.value = String(state.bpm);
}

function toggleStep(trackId, step) {
  state.pattern[trackId][step] = !state.pattern[trackId][step];
  const btn = sequencerEl.querySelector(`.step[data-track="${trackId}"][data-step="${step}"]`);
  const on = state.pattern[trackId][step];
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

function setVolume(trackId, value) {
  state.volumes[trackId] = value;
  if (trackGains[trackId]) {
    // Ramp briefly instead of snapping to avoid an audible click.
    const t = audioContext.currentTime;
    trackGains[trackId].gain.cancelScheduledValues(t);
    trackGains[trackId].gain.setTargetAtTime(value, t, 0.01);
  }
}

// --- Transport ---

let isPlaying = false;

function togglePlay() {
  ensureAudioGraph();

  // Resume the context if it's suspended (autoplay policy / after a stop).
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  if (isPlaying) {
    sequencer.stop();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    clearPlayhead();
    isPlaying = false;
  } else {
    sequencer.start();
    rafId = requestAnimationFrame(playheadLoop);
    isPlaying = true;
  }

  playBtn.textContent = isPlaying ? 'Stop' : 'Play';
  playBtn.setAttribute('aria-pressed', String(isPlaying));
}

function clearAll() {
  for (const track of TRACKS) {
    state.pattern[track.id].fill(false);
  }
  syncStepButtonsFromState();
}

function randomizePattern() {
  for (const track of TRACKS) {
    for (let step = 0; step < STEP_COUNT; step++) {
      state.pattern[track.id][step] = Math.random() < track.randomChance;
    }
  }
  syncStepButtonsFromState();
}

function setBpm(value) {
  const clamped = Math.min(220, Math.max(40, Math.round(value)));
  state.bpm = clamped;
  bpmRange.value = String(clamped);
  bpmInput.value = String(clamped);
  if (sequencer) sequencer.setBpm(clamped);
}

// --- Save / load (localStorage) ---

function savePattern() {
  const payload = {
    bpm: state.bpm,
    pattern: state.pattern,
    volumes: state.volumes,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  flashStatus('Saved!');
}

function loadPattern({ silent = false } = {}) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    if (!silent) flashStatus('No saved pattern.');
    return;
  }
  try {
    const data = JSON.parse(raw);
    if (data.bpm) setBpm(data.bpm);
    if (data.pattern) {
      for (const track of TRACKS) {
        if (Array.isArray(data.pattern[track.id])) {
          state.pattern[track.id] = data.pattern[track.id].slice(0, STEP_COUNT);
          while (state.pattern[track.id].length < STEP_COUNT) state.pattern[track.id].push(false);
        }
      }
    }
    if (data.volumes) {
      for (const track of TRACKS) {
        if (typeof data.volumes[track.id] === 'number') {
          state.volumes[track.id] = data.volumes[track.id];
          if (trackGains[track.id]) trackGains[track.id].gain.value = data.volumes[track.id];
        }
      }
    }
    syncStepButtonsFromState();
    if (!silent) flashStatus('Loaded!');
  } catch (err) {
    console.error('Failed to load saved pattern', err);
    if (!silent) flashStatus('Load failed.');
  }
}

let statusTimeoutId = null;
function flashStatus(message) {
  saveStatus.textContent = message;
  if (statusTimeoutId) clearTimeout(statusTimeoutId);
  statusTimeoutId = setTimeout(() => {
    saveStatus.textContent = '';
  }, 2000);
}

// --- Wire up events ---

playBtn.addEventListener('click', togglePlay);
clearBtn.addEventListener('click', clearAll);
randomBtn.addEventListener('click', randomizePattern);
saveBtn.addEventListener('click', savePattern);
loadBtn.addEventListener('click', () => loadPattern());

bpmRange.addEventListener('input', () => setBpm(Number(bpmRange.value)));
bpmInput.addEventListener('change', () => setBpm(Number(bpmInput.value)));

renderSequencer();
loadPattern({ silent: true }); // restore last session's pattern, if any, without a status message
