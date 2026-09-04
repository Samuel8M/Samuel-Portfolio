// main.js
//
// All canvas rendering, DOM wiring, and simulation-loop timing lives here.
// The actual cellular-automaton rules live in automata.js as pure functions;
// this file's job is only to hold UI state, call those functions, and draw
// the result. Keeping that boundary is what let the rules be unit tested
// with plain `node` even though canvas drawing itself isn't (see README).

(function () {
  'use strict';

  const A = window.CellPlayAutomata;

  // ------------------------------------------------------------------
  // DOM references
  // ------------------------------------------------------------------

  const canvas = document.getElementById('grid-canvas');
  const ctx = canvas.getContext('2d');

  const automatonSelect = document.getElementById('automaton-select');
  const ruleGroup = document.getElementById('rule-group');
  const rulePreset = document.getElementById('rule-preset');
  const ruleInput = document.getElementById('rule-input');
  const ruleError = document.getElementById('rule-error');
  const sizeInput = document.getElementById('size-input');
  const sizeValue = document.getElementById('size-value');
  const sizeValue2 = document.getElementById('size-value-2');
  const speedInput = document.getElementById('speed-input');
  const speedValue = document.getElementById('speed-value');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const stepBtn = document.getElementById('step-btn');
  const randomizeBtn = document.getElementById('randomize-btn');
  const clearBtn = document.getElementById('clear-btn');
  const exampleBtn = document.getElementById('example-btn');
  const statusNote = document.getElementById('status-note');
  const canvasHint = document.getElementById('canvas-hint');
  const legend = document.getElementById('legend');

  // ------------------------------------------------------------------
  // Color palettes (kept separate from automata.js: purely presentational)
  // ------------------------------------------------------------------

  const LIFELIKE_COLORS = { dead: '#0c0d12', alive: '#5ec0ff' };
  const LANGTON_COLORS = { white: '#0c0d12', black: '#ff9f45', ant: '#fff35c' };
  const WIRE_COLORS = {
    [A.WIRE_EMPTY]: '#0c0d12',
    [A.WIRE_CONDUCTOR]: '#caa23c',
    [A.WIRE_HEAD]: '#7fe8ff',
    [A.WIRE_TAIL]: '#3d6fd6'
  };

  const LEGENDS = {
    lifelike: [
      { color: LIFELIKE_COLORS.alive, label: 'Alive' },
      { color: LIFELIKE_COLORS.dead, label: 'Dead' }
    ],
    langton: [
      { color: LANGTON_COLORS.ant, label: 'Ant' },
      { color: LANGTON_COLORS.black, label: 'Black square' },
      { color: LANGTON_COLORS.white, label: 'White square' }
    ],
    wireworld: [
      { color: WIRE_COLORS[A.WIRE_HEAD], label: 'Electron head' },
      { color: WIRE_COLORS[A.WIRE_TAIL], label: 'Electron tail' },
      { color: WIRE_COLORS[A.WIRE_CONDUCTOR], label: 'Conductor' },
      { color: WIRE_COLORS[A.WIRE_EMPTY], label: 'Empty' }
    ]
  };

  const HINTS = {
    lifelike: 'Click a cell to toggle it alive/dead.',
    langton: 'Click a cell to flip it black/white. The ant always starts centered.',
    wireworld: 'Click a cell to cycle empty → conductor → head → tail.'
  };

  // ------------------------------------------------------------------
  // Simulation state
  // ------------------------------------------------------------------

  const state = {
    automaton: 'lifelike',
    cols: 60,
    rows: 60,
    grid: new Uint8Array(60 * 60),
    rule: A.parseRule('B3/S23'),
    ant: { x: 30, y: 30, dir: 0 },
    running: false,
    stepsPerSecond: 10,
    generation: 0
  };

  function createEmptyGrid() {
    return new Uint8Array(state.cols * state.rows);
  }

  function centerAnt() {
    state.ant = { x: Math.floor(state.cols / 2), y: Math.floor(state.rows / 2), dir: 0 };
  }

  function resetGrid() {
    state.grid = createEmptyGrid();
    state.generation = 0;
    if (state.automaton === 'langton') centerAnt();
    updateStatus();
    draw();
  }

  // ------------------------------------------------------------------
  // Stepping (delegates to the pure functions in automata.js)
  // ------------------------------------------------------------------

  function stepOnce() {
    if (state.automaton === 'lifelike') {
      state.grid = A.stepLifeLike(state.grid, state.cols, state.rows, state.rule);
    } else if (state.automaton === 'langton') {
      const result = A.stepLangtonsAnt(state.grid, state.cols, state.rows, state.ant);
      state.grid = result.grid;
      state.ant = result.ant;
    } else if (state.automaton === 'wireworld') {
      state.grid = A.stepWireworld(state.grid, state.cols, state.rows);
    }
    state.generation++;
    updateStatus();
  }

  // ------------------------------------------------------------------
  // Randomize / clear / example patterns
  // ------------------------------------------------------------------

  function randomize() {
    const grid = createEmptyGrid();
    if (state.automaton === 'lifelike') {
      for (let i = 0; i < grid.length; i++) grid[i] = Math.random() < 0.25 ? 1 : 0;
    } else if (state.automaton === 'langton') {
      for (let i = 0; i < grid.length; i++) grid[i] = Math.random() < 0.5 ? 1 : 0;
      centerAnt();
    } else if (state.automaton === 'wireworld') {
      for (let i = 0; i < grid.length; i++) {
        grid[i] = Math.random() < 0.35 ? A.WIRE_CONDUCTOR : A.WIRE_EMPTY;
      }
    }
    state.grid = grid;
    state.generation = 0;
    updateStatus();
    draw();
  }

  // Gosper Glider Gun: classic Game of Life pattern that continuously emits
  // gliders. Coordinates are relative to its 36x9 bounding box.
  const GOSPER_GLIDER_GUN = [
    [24, 0],
    [22, 1], [24, 1],
    [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
    [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
    [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
    [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
    [10, 6], [16, 6], [24, 6],
    [11, 7], [15, 7],
    [12, 8], [13, 8]
  ];

  const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

  function stampCells(cells, offsetX, offsetY) {
    cells.forEach(([x, y]) => {
      const gx = x + offsetX;
      const gy = y + offsetY;
      if (gx >= 0 && gx < state.cols && gy >= 0 && gy < state.rows) {
        state.grid[gy * state.cols + gx] = 1;
      }
    });
  }

  function loadLifelikeExample() {
    if (state.cols >= 40 && state.rows >= 12) {
      stampCells(GOSPER_GLIDER_GUN, 2, 2);
    } else {
      stampCells(GLIDER, Math.max(0, Math.floor(state.cols / 2) - 1), Math.max(0, Math.floor(state.rows / 2) - 1));
    }
  }

  // Wireworld demo: an electron travels down a wire and fans out at a
  // T-junction into two branches (a real, verified Wireworld behavior --
  // see the "propagates down a straight wire" test in test/gol.test.js for
  // the underlying rule this relies on).
  function loadWireworldExample() {
    const g = state.grid;
    const cols = state.cols;
    const rows = state.rows;
    const margin = Math.max(1, Math.min(4, Math.floor(cols * 0.08)));
    const y0 = Math.floor(rows / 2);
    const startX = margin;
    const endX = cols - 1 - margin;
    if (endX - startX < 3) {
      // Grid too small for the full demo: just a short wire with a head.
      for (let x = 0; x < cols; x++) g[y0 * cols + x] = A.WIRE_CONDUCTOR;
      g[y0 * cols + 0] = A.WIRE_HEAD;
      return;
    }
    for (let x = startX; x <= endX; x++) g[y0 * cols + x] = A.WIRE_CONDUCTOR;

    const branchX = startX + Math.floor((endX - startX) * 0.55);
    const branchEndY = Math.min(rows - 1, y0 + Math.floor(rows * 0.3));
    if (branchEndY > y0) {
      for (let y = y0; y <= branchEndY; y++) g[y * cols + branchX] = A.WIRE_CONDUCTOR;
    }
    g[y0 * cols + startX] = A.WIRE_HEAD;
  }

  function loadExample() {
    resetGrid();
    if (state.automaton === 'lifelike') {
      loadLifelikeExample();
    } else if (state.automaton === 'wireworld') {
      loadWireworldExample();
    }
    // Langton's Ant needs no seed pattern -- its "highway" emerges from a
    // blank grid, which is the interesting part to watch.
    draw();
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function draw() {
    const cols = state.cols;
    const rows = state.rows;
    const cw = canvas.width / cols;
    const ch = canvas.height / rows;

    ctx.fillStyle = state.automaton === 'langton' ? LANGTON_COLORS.white : '#0c0d12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const value = state.grid[y * cols + x];
        const color = colorForCell(value);
        if (color === null) continue; // skip drawing background-colored cells
        const px = Math.round(x * cw);
        const py = Math.round(y * ch);
        const pw = Math.round((x + 1) * cw) - px;
        const ph = Math.round((y + 1) * ch) - py;
        ctx.fillStyle = color;
        ctx.fillRect(px, py, pw, ph);
      }
    }

    if (state.automaton === 'langton') {
      const px = Math.round(state.ant.x * cw);
      const py = Math.round(state.ant.y * ch);
      const pw = Math.round((state.ant.x + 1) * cw) - px;
      const ph = Math.round((state.ant.y + 1) * ch) - py;
      ctx.fillStyle = LANGTON_COLORS.ant;
      ctx.fillRect(px, py, pw, ph);
    }
  }

  function colorForCell(value) {
    if (state.automaton === 'lifelike') {
      return value ? LIFELIKE_COLORS.alive : null;
    }
    if (state.automaton === 'langton') {
      return value ? LANGTON_COLORS.black : null;
    }
    if (state.automaton === 'wireworld') {
      return value === A.WIRE_EMPTY ? null : WIRE_COLORS[value];
    }
    return null;
  }

  function renderLegend() {
    const items = LEGENDS[state.automaton] || [];
    legend.innerHTML = items.map((item) =>
      `<div class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span>${item.label}</div>`
    ).join('');
  }

  function updateStatus() {
    statusNote.textContent = `Generation: ${state.generation}`;
  }

  // ------------------------------------------------------------------
  // Simulation loop (requestAnimationFrame with a time accumulator so the
  // step rate is decoupled from the display refresh rate)
  // ------------------------------------------------------------------

  let rafId = null;
  let accumulatorMs = 0;
  let lastTimestamp = 0;

  function loop(timestamp) {
    if (!state.running) return;
    if (lastTimestamp === 0) lastTimestamp = timestamp;
    const deltaMs = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    const stepIntervalMs = 1000 / state.stepsPerSecond;
    accumulatorMs += deltaMs;

    // Cap catch-up so a stalled tab doesn't try to replay hundreds of steps.
    let stepsThisFrame = 0;
    while (accumulatorMs >= stepIntervalMs && stepsThisFrame < 10) {
      stepOnce();
      accumulatorMs -= stepIntervalMs;
      stepsThisFrame++;
    }
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function play() {
    if (state.running) return;
    state.running = true;
    lastTimestamp = 0;
    accumulatorMs = 0;
    playPauseBtn.textContent = 'Pause';
    playPauseBtn.classList.add('running');
    rafId = requestAnimationFrame(loop);
  }

  function pause() {
    state.running = false;
    playPauseBtn.textContent = 'Play';
    playPauseBtn.classList.remove('running');
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------

  function applyRuleFromInput() {
    try {
      state.rule = A.parseRule(ruleInput.value);
      ruleError.textContent = '';
      ruleError.classList.remove('error');
    } catch (err) {
      ruleError.textContent = err.message;
      ruleError.classList.add('error');
    }
  }

  automatonSelect.addEventListener('change', () => {
    pause();
    state.automaton = automatonSelect.value;
    ruleGroup.style.display = state.automaton === 'lifelike' ? 'flex' : 'none';
    canvasHint.textContent = HINTS[state.automaton];
    renderLegend();
    resetGrid();
  });

  rulePreset.addEventListener('change', () => {
    if (rulePreset.value === 'custom') return;
    ruleInput.value = rulePreset.value;
    applyRuleFromInput();
  });

  ruleInput.addEventListener('input', () => {
    rulePreset.value = 'custom';
    applyRuleFromInput();
  });

  sizeInput.addEventListener('change', () => {
    pause();
    const size = Number(sizeInput.value);
    state.cols = size;
    state.rows = size;
    sizeValue.textContent = String(size);
    sizeValue2.textContent = String(size);
    resetGrid();
  });
  sizeInput.addEventListener('input', () => {
    sizeValue.textContent = sizeInput.value;
    sizeValue2.textContent = sizeInput.value;
  });

  speedInput.addEventListener('input', () => {
    state.stepsPerSecond = Number(speedInput.value);
    speedValue.textContent = speedInput.value;
  });

  playPauseBtn.addEventListener('click', () => {
    if (state.running) pause(); else play();
  });

  stepBtn.addEventListener('click', () => {
    pause();
    stepOnce();
    draw();
  });

  randomizeBtn.addEventListener('click', () => {
    pause();
    randomize();
  });

  clearBtn.addEventListener('click', () => {
    pause();
    resetGrid();
  });

  exampleBtn.addEventListener('click', () => {
    pause();
    loadExample();
  });

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    const cellX = Math.floor(canvasX / (canvas.width / state.cols));
    const cellY = Math.floor(canvasY / (canvas.height / state.rows));
    if (cellX < 0 || cellX >= state.cols || cellY < 0 || cellY >= state.rows) return;

    const idx = cellY * state.cols + cellX;
    if (state.automaton === 'wireworld') {
      const cycle = [A.WIRE_EMPTY, A.WIRE_CONDUCTOR, A.WIRE_HEAD, A.WIRE_TAIL];
      const current = cycle.indexOf(state.grid[idx]);
      state.grid[idx] = cycle[(current + 1) % cycle.length];
    } else {
      state.grid[idx] = state.grid[idx] ? 0 : 1;
    }
    draw();
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  function init() {
    canvasHint.textContent = HINTS[state.automaton];
    ruleGroup.style.display = state.automaton === 'lifelike' ? 'flex' : 'none';
    renderLegend();
    updateStatus();
    draw();
  }

  init();
})();
