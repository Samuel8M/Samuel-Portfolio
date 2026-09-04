// Pure Pomodoro timer state machine, ported 1:1 from the extension's
// src/background/timer.js. No chrome.* calls here (there were none in the
// original either) — background.js in the real extension calls these plain
// functions to decide what the new state should be, and this demo's main.js
// does the same thing on a setInterval instead of chrome.alarms.

const DEFAULT_DURATIONS_SEC = Object.freeze({
  focus: 25 * 60,
  break: 5 * 60,
});

// Creates a fresh, paused timer sitting at the start of a focus session.
function createInitialTimerState(durations = DEFAULT_DURATIONS_SEC) {
  return {
    phase: 'focus', // 'focus' | 'break'
    isRunning: false,
    endsAt: null, // epoch ms the current run finishes at; null while paused/idle
    remainingSeconds: durations.focus,
    durations: { ...durations },
  };
}

function startTimer(state, now = Date.now()) {
  if (state.isRunning) return state;
  return {
    ...state,
    isRunning: true,
    endsAt: now + state.remainingSeconds * 1000,
  };
}

function pauseTimer(state, now = Date.now()) {
  if (!state.isRunning) return state;
  return {
    ...state,
    isRunning: false,
    remainingSeconds: getRemainingSeconds(state, now),
    endsAt: null,
  };
}

// Resets back to the beginning of a focus session, keeping any custom durations.
function resetTimer(state) {
  return createInitialTimerState(state.durations);
}

function getRemainingSeconds(state, now = Date.now()) {
  if (!state.isRunning || state.endsAt == null) return state.remainingSeconds;
  return Math.max(0, Math.round((state.endsAt - now) / 1000));
}

function isPhaseComplete(state, now = Date.now()) {
  return state.isRunning && getRemainingSeconds(state, now) <= 0;
}

// Moves focus -> break or break -> focus and immediately starts the next phase.
function advancePhase(state, now = Date.now()) {
  const nextPhase = state.phase === 'focus' ? 'break' : 'focus';
  const duration = state.durations[nextPhase];
  return {
    ...state,
    phase: nextPhase,
    isRunning: true,
    remainingSeconds: duration,
    endsAt: now + duration * 1000,
  };
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

window.FGTimer = {
  DEFAULT_DURATIONS_SEC,
  createInitialTimerState,
  startTimer,
  pauseTimer,
  resetTimer,
  getRemainingSeconds,
  isPhaseComplete,
  advancePhase,
  formatClock,
};
