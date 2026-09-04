// sequencer.js
//
// The "lookahead scheduler" pattern for sample-accurate timing in the Web
// Audio API (as described in Chris Wilson's "A Tale of Two Clocks":
// https://web.dev/articles/audio-scheduling).
//
// THE PROBLEM: `setInterval`/`setTimeout` are driven by the browser's event
// loop, which is not guaranteed to fire on time -- it can be delayed by
// garbage collection, other tabs, layout/paint work, throttled background
// tabs, etc. If you schedule each drum hit with its own `setTimeout(playStep,
// stepDurationMs)`, those small delays accumulate step after step and the
// beat audibly drifts and jitters, especially over a long play session.
//
// THE FIX: never use `setTimeout` to *trigger* a sound. Instead:
//   1. Compute note start times against `audioContext.currentTime`, which is
//      the audio hardware's own sample-accurate clock.
//   2. Run a coarse `setInterval` "scheduler" loop (every `lookaheadMs`) that
//      does NOT play anything itself. Each tick, it looks at a short window
//      of time ahead (`scheduleAheadTimeSec`) and, for every step that falls
//      inside that window, calls `audioContext.createOscillator().start(t)`
//      (etc.) with the exact future timestamp `t`. The Web Audio API's own
//      internal clock -- not the JS timer -- fires the sound at `t`.
//   3. Because "when do I schedule" (imprecise, JS timer) and "when does it
//      play" (precise, audio clock) are decoupled, jitter in the JS timer
//      only affects *when we notice* it's time to schedule ahead -- it can
//      never shift the sound's actual playback time. As long as the interval
//      fires at least once within every `scheduleAheadTimeSec` window, timing
//      stays sample-accurate with zero drift.
//
// The `scheduleAheadTimeSec` window (100ms) is comfortably larger than the
// `lookaheadMs` interval (25ms), which gives the JS timer generous slack to
// be late without ever missing a step.

const LOOKAHEAD_MS = 25; // How often the scheduler loop runs.
const SCHEDULE_AHEAD_SEC = 0.1; // How far ahead (in audio-clock seconds) to schedule notes.

export class StepSequencer {
  /**
   * @param {AudioContext} audioContext
   * @param {number} stepCount total steps per pattern loop (16)
   * @param {(step: number, time: number) => void} onScheduleStep called once
   *   per step, ahead of playback, with the exact AudioContext time it should
   *   sound at. The caller is responsible for creating/starting audio nodes
   *   at that time.
   * @param {(step: number, time: number) => void} [onStepAdvance] optional
   *   hook fired at the same moments, used by the UI to drive the playhead
   *   without polling on its own timer.
   */
  constructor(audioContext, stepCount, onScheduleStep, onStepAdvance) {
    this.audioContext = audioContext;
    this.stepCount = stepCount;
    this.onScheduleStep = onScheduleStep;
    this.onStepAdvance = onStepAdvance;

    this.bpm = 120;
    this.currentStep = 0;
    this.nextNoteTime = 0; // AudioContext time (seconds) the next step is due.
    this.timerId = null;
    this.isRunning = false;
  }

  setBpm(bpm) {
    this.bpm = bpm;
  }

  /** Seconds per 16th-note step at the current tempo. */
  get secondsPerStep() {
    // 60 / bpm = seconds per quarter note; a 16-step pattern over one bar of
    // 4/4 means each step is a 16th note, i.e. a quarter note / 4.
    return 60 / this.bpm / 4;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentStep = 0;
    this.nextNoteTime = this.audioContext.currentTime + 0.05;
    this.timerId = setInterval(() => this._scheduler(), LOOKAHEAD_MS);
  }

  stop() {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  _scheduler() {
    // Schedule every step whose time falls within the lookahead window, not
    // just one -- if the JS timer is briefly delayed, this catches up by
    // scheduling multiple steps in a single tick, all still with correct
    // (past-relative-to-now-but-future-relative-to-currentTime) timestamps.
    while (this.nextNoteTime < this.audioContext.currentTime + SCHEDULE_AHEAD_SEC) {
      this.onScheduleStep(this.currentStep, this.nextNoteTime);
      if (this.onStepAdvance) {
        this.onStepAdvance(this.currentStep, this.nextNoteTime);
      }
      this._advanceStep();
    }
  }

  _advanceStep() {
    this.nextNoteTime += this.secondsPerStep;
    this.currentStep = (this.currentStep + 1) % this.stepCount;
  }
}
