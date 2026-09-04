// automata.js
//
// Pure, framework-free stepping logic for every automaton CellPlay supports.
// Every function here is a pure function: given a grid (and any per-automaton
// state), it returns a *new* grid/state without mutating its inputs and
// without touching the DOM or canvas. That separation is what makes this
// file testable with plain `node` (see test/gol.test.js) even though the
// rendering code in main.js is not practically unit-testable.
//
// Works both as a browser <script> (attaches to `window.CellPlayAutomata`)
// and as a CommonJS module for Node (`require('./automata.js')`).

(function (root) {
  'use strict';

  // ======================================================================
  // Life-like outer-totalistic automata (B/S rule strings)
  //
  // Covers Conway's Game of Life (B3/S23) and variants such as HighLife
  // (B36/S23), Seeds (B2/S), and Day & Night (B3678/S34678).
  // ======================================================================

  /**
   * Parse a rule string like "B3/S23" into birth/survive Sets of neighbor
   * counts. Throws on malformed input.
   */
  function parseRule(ruleString) {
    const match = /^B([0-8]*)\/S([0-8]*)$/i.exec(String(ruleString).trim());
    if (!match) {
      throw new Error(`Invalid rule string: "${ruleString}". Expected a format like "B3/S23".`);
    }
    const birth = new Set(match[1].split('').map(Number));
    const survive = new Set(match[2].split('').map(Number));
    return { birth, survive };
  }

  /** Count live neighbors of (x,y) on a toroidal (wrap-around) grid. */
  function countLifeNeighbors(grid, width, height, x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = (x + dx + width) % width;
        const ny = (y + dy + height) % height;
        count += grid[ny * width + nx] ? 1 : 0;
      }
    }
    return count;
  }

  /**
   * Advance a life-like grid by one generation.
   *
   * @param {Uint8Array|number[]} grid  flat array, length width*height, 1 = alive
   * @param {number} width
   * @param {number} height
   * @param {{birth: Set<number>, survive: Set<number>}} rule
   * @returns {Uint8Array} a new grid; the input is not mutated
   */
  function stepLifeLike(grid, width, height, rule) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const n = countLifeNeighbors(grid, width, height, x, y);
        const alive = grid[idx] !== 0;
        next[idx] = alive ? (rule.survive.has(n) ? 1 : 0) : (rule.birth.has(n) ? 1 : 0);
      }
    }
    return next;
  }

  // ======================================================================
  // Langton's Ant
  // ======================================================================

  // Direction order matters: turning "right" means advancing this index,
  // turning "left" means retreating it.
  const ANT_DIRECTIONS = [
    { dx: 0, dy: -1 }, // 0: up
    { dx: 1, dy: 0 },  // 1: right
    { dx: 0, dy: 1 },  // 2: down
    { dx: -1, dy: 0 }  // 3: left
  ];

  /**
   * Advance Langton's Ant by one step, using the classic rule:
   * on a white square, turn right, flip the square to black, move forward;
   * on a black square, turn left, flip the square to white, move forward.
   * The grid wraps toroidally so the ant never runs off the board.
   *
   * @param {Uint8Array|number[]} grid  flat array, 1 = black
   * @param {number} width
   * @param {number} height
   * @param {{x: number, y: number, dir: number}} ant  dir indexes ANT_DIRECTIONS
   * @returns {{grid: Uint8Array, ant: {x:number,y:number,dir:number}}}
   */
  function stepLangtonsAnt(grid, width, height, ant) {
    const next = Uint8Array.from(grid);
    const idx = ant.y * width + ant.x;
    const onBlack = next[idx] !== 0;

    const dir = onBlack ? (ant.dir + 3) % 4 : (ant.dir + 1) % 4; // left : right
    next[idx] = onBlack ? 0 : 1; // flip current cell

    const { dx, dy } = ANT_DIRECTIONS[dir];
    const x = (ant.x + dx + width) % width;
    const y = (ant.y + dy + height) % height;

    return { grid: next, ant: { x, y, dir } };
  }

  // ======================================================================
  // Wireworld
  // ======================================================================

  const WIRE_EMPTY = 0;
  const WIRE_HEAD = 1;
  const WIRE_TAIL = 2;
  const WIRE_CONDUCTOR = 3;

  /** Count electron-head neighbors of (x,y). Edges are NOT wrapped. */
  function countElectronHeadNeighbors(grid, width, height, x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (grid[ny * width + nx] === WIRE_HEAD) count++;
      }
    }
    return count;
  }

  /**
   * Advance a Wireworld grid by one step, using the classic four-state rule:
   * empty stays empty; electron head becomes electron tail; electron tail
   * becomes conductor; conductor becomes an electron head iff exactly one
   * or two of its neighbors are electron heads, otherwise stays conductor.
   *
   * @param {Uint8Array|number[]} grid  flat array of WIRE_* states
   */
  function stepWireworld(grid, width, height) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const state = grid[idx];
        if (state === WIRE_EMPTY) {
          next[idx] = WIRE_EMPTY;
        } else if (state === WIRE_HEAD) {
          next[idx] = WIRE_TAIL;
        } else if (state === WIRE_TAIL) {
          next[idx] = WIRE_CONDUCTOR;
        } else {
          const heads = countElectronHeadNeighbors(grid, width, height, x, y);
          next[idx] = (heads === 1 || heads === 2) ? WIRE_HEAD : WIRE_CONDUCTOR;
        }
      }
    }
    return next;
  }

  const api = {
    // life-like
    parseRule,
    countLifeNeighbors,
    stepLifeLike,
    // langton's ant
    ANT_DIRECTIONS,
    stepLangtonsAnt,
    // wireworld
    WIRE_EMPTY,
    WIRE_HEAD,
    WIRE_TAIL,
    WIRE_CONDUCTOR,
    countElectronHeadNeighbors,
    stepWireworld
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CellPlayAutomata = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
