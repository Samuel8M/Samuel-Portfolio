"use strict";

/**
 * Flappy Bird — vanilla JS canvas clone.
 *
 * Everything is drawn with canvas primitives (no image assets) and every
 * sound is synthesized at runtime with the Web Audio API (no audio files).
 *
 * File map:
 *   - Sound      synthesized sfx (flap / score / hit)
 *   - Particle / ParticleSystem   collision burst
 *   - ParallaxLayer               scrolling background layers
 *   - Bird                        physics + rendering for the player
 *   - PipePair                    one obstacle (top + bottom pipe) + gap logic
 *   - Game                        state machine, input, main loop
 */

// ---------------------------------------------------------------------------
// Logical game resolution. The canvas is scaled to fit the viewport (see
// Game#resize) but all gameplay math happens in these fixed units, so
// behaviour is identical on every screen size / pixel density.
// ---------------------------------------------------------------------------
const WORLD_W = 360;
const WORLD_H = 640;

const GROUND_H = 88;

const GRAVITY = 1500; // px/s^2
const FLAP_VELOCITY = -430; // px/s (negative = up)
const MAX_FALL_SPEED = 620; // px/s (terminal velocity)
const MAX_RISE_SPEED = -430;

const BIRD_X = WORLD_W * 0.3;
const BIRD_RADIUS = 14;

const PIPE_W = 56;
const PIPE_SPEED_BASE = 150; // px/s
const PIPE_SPEED_MAX = 230;
const PIPE_INTERVAL = 1.45; // seconds between pipe spawns at the current speed
const GAP_START = 190; // px, gap height at score 0
const GAP_MIN = 128; // px, gap height floor at high score
const GAP_DIFFICULTY_SCORE = 20; // score at which gap reaches GAP_MIN

const HIGH_SCORE_KEY = "flappybird.highscore";

// Small helpers ---------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// =============================================================================
// Sound — tiny synth built on the Web Audio API. No <audio> elements, no files.
// =============================================================================
class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // AudioContext must be created/resumed from a user gesture on most browsers,
  // so it is lazily constructed on the first flap/tap rather than at load time.
  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  /** Play a short envelope-shaped tone. */
  tone({ freq, duration = 0.12, type = "sine", gain = 0.2, sweep = null, delay = 0 }) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), t0 + duration);
    }

    // Quick attack, exponential-ish decay to avoid clicks at the tail.
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Short filtered noise burst, used for the collision thud. */
  noiseBurst({ duration = 0.25, gain = 0.35, delay = 0 } = {}) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t0 = ctx.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // White noise with a linear decay envelope baked in.
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1200, t0);
    filter.frequency.exponentialRampToValueAtTime(120, t0 + duration);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t0);
  }

  flap() {
    this.tone({ freq: 480, sweep: 700, duration: 0.09, type: "square", gain: 0.12 });
  }

  score() {
    // Two quick ascending notes read as a pleasant "ding".
    this.tone({ freq: 880, duration: 0.09, type: "sine", gain: 0.18 });
    this.tone({ freq: 1320, duration: 0.14, type: "sine", gain: 0.16, delay: 0.06 });
  }

  hit() {
    this.tone({ freq: 160, sweep: 60, duration: 0.35, type: "sawtooth", gain: 0.2 });
    this.noiseBurst({ duration: 0.3, gain: 0.3 });
  }
}

// =============================================================================
// Particles — a small, self-contained burst effect used on collision.
// =============================================================================
class Particle {
  constructor(x, y, vx, vy, radius, color, life) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = radius;
    this.color = color;
    this.life = life;
    this.maxLife = life;
  }

  update(dt) {
    this.vy += GRAVITY * 0.6 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
  }

  get alive() {
    return this.life > 0;
  }

  draw(ctx) {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * t, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  burst(x, y, colors, count = 22) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(60, 260);
      this.particles.push(
        new Particle(
          x,
          y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed - 80,
          rand(2, 5),
          colors[(Math.random() * colors.length) | 0],
          rand(0.4, 0.9)
        )
      );
    }
  }

  update(dt) {
    for (const p of this.particles) p.update(dt);
    if (this.particles.length) this.particles = this.particles.filter((p) => p.alive);
  }

  draw(ctx) {
    for (const p of this.particles) p.draw(ctx);
  }

  clear() {
    this.particles.length = 0;
  }
}

// =============================================================================
// ParallaxLayer — a horizontally-tiling scenery strip. Two copies of the same
// shape are drawn side by side and wrapped, which gives an infinite scroll
// with no gaps for any layer speed.
// =============================================================================
class ParallaxLayer {
  constructor({ speed, draw }) {
    this.speed = speed;
    this.draw = draw; // (ctx, xOffset) => void, draws one tile at xOffset
    this.x = 0;
  }

  update(dt, speedScale = 1) {
    this.x -= this.speed * speedScale * dt;
    if (this.x <= -WORLD_W) this.x += WORLD_W;
  }

  render(ctx) {
    this.draw(ctx, this.x);
    this.draw(ctx, this.x + WORLD_W);
  }
}

// =============================================================================
// Bird — physics + rendering. Drawn entirely with canvas paths/gradients.
// =============================================================================
class Bird {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = BIRD_X;
    this.y = WORLD_H / 2;
    this.vy = 0;
    this.rotation = 0;
    this.flapTimer = 0; // drives the wing-flap animation
    this.wingPhase = 0;
    this.grounded = false; // true once the bird has settled on the ground post-death
  }

  flap() {
    this.vy = FLAP_VELOCITY;
    this.flapTimer = 0.22; // seconds the "wing up" pose is held
  }

  update(dt) {
    this.vy = clamp(this.vy + GRAVITY * dt, MAX_RISE_SPEED, MAX_FALL_SPEED);
    this.y += this.vy * dt;

    // Rotation follows vertical speed: nose up while rising, diving down
    // while falling, clamped to a believable range.
    const targetRotation = clamp(this.vy / MAX_FALL_SPEED, -0.5, 1) * 0.95;
    this.rotation = lerp(this.rotation, targetRotation, clamp(dt * 10, 0, 1));

    if (this.flapTimer > 0) this.flapTimer -= dt;
    this.wingPhase += dt * (this.flapTimer > 0 ? 22 : 10);
  }

  get top() {
    return this.y - BIRD_RADIUS;
  }
  get bottom() {
    return this.y + BIRD_RADIUS;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    // Wing: a simple animated ellipse behind the body, angle driven by phase.
    const wingAngle = this.flapTimer > 0 ? -0.6 : Math.sin(this.wingPhase) * 0.35;
    ctx.save();
    ctx.translate(-2, 2);
    ctx.rotate(wingAngle);
    const wingGrad = ctx.createLinearGradient(-8, -6, 8, 6);
    wingGrad.addColorStop(0, "#e0a52c");
    wingGrad.addColorStop(1, "#c8891a");
    ctx.fillStyle = wingGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Body: gradient-shaded circle for a soft, rounded look.
    const bodyGrad = ctx.createRadialGradient(-5, -6, 2, 0, 0, BIRD_RADIUS + 4);
    bodyGrad.addColorStop(0, "#fff3c4");
    bodyGrad.addColorStop(0.55, "#ffd23f");
    bodyGrad.addColorStop(1, "#f2a30f");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, BIRD_RADIUS, BIRD_RADIUS * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly highlight.
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-2, 4, BIRD_RADIUS * 0.55, BIRD_RADIUS * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail feather.
    ctx.fillStyle = "#e0871f";
    ctx.beginPath();
    ctx.moveTo(-BIRD_RADIUS + 1, -2);
    ctx.lineTo(-BIRD_RADIUS - 8, -6);
    ctx.lineTo(-BIRD_RADIUS - 8, 2);
    ctx.closePath();
    ctx.fill();

    // Eye.
    ctx.fillStyle = "#2b2116";
    ctx.beginPath();
    ctx.arc(6, -5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(7, -6, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // Beak.
    ctx.fillStyle = "#ff7a1a";
    ctx.beginPath();
    ctx.moveTo(BIRD_RADIUS - 3, -1);
    ctx.lineTo(BIRD_RADIUS + 9, 1.5);
    ctx.lineTo(BIRD_RADIUS - 3, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

// =============================================================================
// PipePair — one obstacle: a top pipe + bottom pipe with a gap between them.
// =============================================================================
class PipePair {
  constructor(x, gapY, gapHeight) {
    this.x = x;
    this.gapY = gapY; // center of the gap
    this.gapHeight = gapHeight;
    this.width = PIPE_W;
    this.passed = false;
  }

  get topHeight() {
    return this.gapY - this.gapHeight / 2;
  }
  get bottomY() {
    return this.gapY + this.gapHeight / 2;
  }

  update(dt, speed) {
    this.x -= speed * dt;
  }

  get offscreen() {
    return this.x + this.width < 0;
  }

  /** Circle-vs-rounded-rect collision against both the top and bottom pipe. */
  collides(bird) {
    const bx = bird.x;
    const by = bird.y;
    const r = BIRD_RADIUS - 2; // slightly forgiving hitbox for good game-feel

    const hitsRect = (rx, ry, rw, rh) => {
      const closestX = clamp(bx, rx, rx + rw);
      const closestY = clamp(by, ry, ry + rh);
      const dx = bx - closestX;
      const dy = by - closestY;
      return dx * dx + dy * dy < r * r;
    };

    return (
      hitsRect(this.x, -10, this.width, this.topHeight + 10) ||
      hitsRect(this.x, this.bottomY, this.width, WORLD_H - this.bottomY)
    );
  }

  draw(ctx) {
    this.#drawPipe(ctx, this.x, 0, this.width, this.topHeight, true);
    this.#drawPipe(ctx, this.x, this.bottomY, this.width, WORLD_H - this.bottomY, false);
  }

  #drawPipe(ctx, x, y, w, h, isTop) {
    if (h <= 0) return;
    const capH = 22;
    const capOverhang = 4;

    const bodyGrad = ctx.createLinearGradient(x, 0, x + w, 0);
    bodyGrad.addColorStop(0, "#3fae4a");
    bodyGrad.addColorStop(0.15, "#69d874");
    bodyGrad.addColorStop(0.5, "#4bc25a");
    bodyGrad.addColorStop(0.85, "#2f8f3c");
    bodyGrad.addColorStop(1, "#256e2f");

    ctx.fillStyle = bodyGrad;
    ctx.fillRect(x, y, w, h);

    // Subtle edge highlight/shadow for a rounded, extruded look.
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x + 4, y, 4, h);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x + w - 6, y, 6, h);

    const capY = isTop ? y + h - capH : y;
    const capGrad = ctx.createLinearGradient(x - capOverhang, 0, x + w + capOverhang, 0);
    capGrad.addColorStop(0, "#2f8f3c");
    capGrad.addColorStop(0.15, "#7fe08a");
    capGrad.addColorStop(0.5, "#57cc66");
    capGrad.addColorStop(0.85, "#2f8f3c");
    capGrad.addColorStop(1, "#1f6628");
    ctx.fillStyle = capGrad;
    ctx.fillRect(x - capOverhang, capY, w + capOverhang * 2, capH);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - capOverhang + 0.5, capY + 0.5, w + capOverhang * 2 - 1, capH - 1);
  }
}

// =============================================================================
// Game — state machine, input handling, update/render loop.
// =============================================================================
const STATE = { START: "start", PLAYING: "playing", GAMEOVER: "gameover" };

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sound = new Sound();
    this.particles = new ParticleSystem();

    this.bird = new Bird();
    this.pipes = [];
    this.score = 0;
    this.highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
    this.isNewHighScore = false;

    this.state = STATE.START;
    this.spawnTimer = 0;
    this.groundOffset = 0;
    this.flashTimer = 0; // brief white flash on collision
    this.startAnimTime = 0;
    this.allowRestartAt = 0;

    this.#buildBackground();
    this.#bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // --- setup -----------------------------------------------------------

  #buildBackground() {
    // Sun / glow, drawn once per frame directly (static, not a scroll layer).

    // Far hills (slow).
    this.hills = new ParallaxLayer({
      speed: 18,
      draw: (ctx, xOff) => {
        ctx.fillStyle = "#5b8f6b";
        ctx.beginPath();
        ctx.moveTo(xOff, WORLD_H - GROUND_H);
        for (let i = 0; i <= 6; i++) {
          const hx = xOff + (i / 6) * WORLD_W;
          const hy = WORLD_H - GROUND_H - (i % 2 === 0 ? 46 : 20);
          ctx.lineTo(hx, hy);
        }
        ctx.lineTo(xOff + WORLD_W, WORLD_H - GROUND_H);
        ctx.closePath();
        ctx.fill();
      },
    });

    // Clouds (medium).
    this.clouds = new ParallaxLayer({
      speed: 32,
      draw: (ctx, xOff) => {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        const puffs = [
          [40, 70], [110, 50], [190, 90], [260, 60], [330, 100],
        ];
        for (const [px, py] of puffs) {
          this.#drawCloud(ctx, xOff + px, py);
        }
      },
    });

    // Near buildings/bushes (fast-ish, just above ground).
    this.bushes = new ParallaxLayer({
      speed: 90,
      draw: (ctx, xOff) => {
        ctx.fillStyle = "#3f7a4a";
        for (let i = 0; i < 5; i++) {
          const bx = xOff + i * 76 + 20;
          const by = WORLD_H - GROUND_H;
          ctx.beginPath();
          ctx.ellipse(bx, by, 30, 16, 0, Math.PI, 0);
          ctx.fill();
        }
      },
    });

    this.bgLayers = [this.hills, this.clouds, this.bushes];
  }

  #drawCloud(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.arc(x + 14, y - 6, 14, 0, Math.PI * 2);
    ctx.arc(x + 28, y, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  #bindInput() {
    const onFlap = (e) => {
      // Avoid double-firing for touch devices that also emit a click event.
      if (e.type === "touchstart") e.preventDefault();
      this.handleInput();
    };
    this.canvas.addEventListener("mousedown", onFlap);
    this.canvas.addEventListener("touchstart", onFlap, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        this.handleInput();
      }
    });
  }

  handleInput() {
    // Any interaction is also what unlocks the AudioContext.
    this.sound.ensureContext();

    if (this.state === STATE.START) {
      this.state = STATE.PLAYING;
      this.bird.flap();
      this.sound.flap();
    } else if (this.state === STATE.PLAYING) {
      this.bird.flap();
      this.sound.flap();
    } else if (this.state === STATE.GAMEOVER) {
      // Small delay guard is implicit: gameover screen ignores input for a
      // moment via `flashTimer`/`allowRestartAt` so an in-flight death tap
      // can't instantly restart the game.
      if (performance.now() >= this.allowRestartAt) {
        this.reset();
      }
    }
  }

  reset() {
    this.bird.reset();
    this.pipes = [];
    this.score = 0;
    this.isNewHighScore = false;
    this.spawnTimer = 0;
    this.state = STATE.START;
    this.particles.clear();
  }

  // --- sizing ------------------------------------------------------------

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const availW = window.innerWidth;
    const availH = window.innerHeight - 40; // leave room for the hint text
    const scale = Math.min(availW / WORLD_W, availH / WORLD_H);
    const cssW = WORLD_W * scale;
    const cssH = WORLD_H * scale;

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    // Size the physical pixel buffer to match the actual on-screen size
    // (CSS size * device pixel ratio), not just the world resolution, so
    // the game stays crisp on large/high-DPI screens instead of being
    // upscaled/blurred by the browser.
    const pixelScale = scale * dpr;
    this.canvas.width = Math.round(WORLD_W * pixelScale);
    this.canvas.height = Math.round(WORLD_H * pixelScale);

    // All drawing code below works in world units; this transform maps
    // world units -> physical pixels once per resize.
    this.ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  }

  // --- difficulty ----------------------------------------------------

  currentGapHeight() {
    const t = clamp(this.score / GAP_DIFFICULTY_SCORE, 0, 1);
    return lerp(GAP_START, GAP_MIN, t);
  }

  currentPipeSpeed() {
    const t = clamp(this.score / GAP_DIFFICULTY_SCORE, 0, 1);
    return lerp(PIPE_SPEED_BASE, PIPE_SPEED_MAX, t);
  }

  spawnPipe() {
    const gapHeight = this.currentGapHeight();
    const margin = 60; // keep the gap away from the very top / ground
    const minCenter = margin + gapHeight / 2;
    const maxCenter = WORLD_H - GROUND_H - margin - gapHeight / 2;
    const gapY = rand(minCenter, Math.max(minCenter, maxCenter));
    this.pipes.push(new PipePair(WORLD_W + 20, gapY, gapHeight));
  }

  // --- main loop -----------------------------------------------------

  loop(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 1 / 30); // clamp for tab-switch pauses
    this.lastTime = now;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    // Ground/background keep drifting gently on the start screen for a
    // "living" title screen, freeze while the game-over panel is up, and
    // scroll at full (difficulty-scaled) speed while playing.
    const groundSpeed =
      this.state === STATE.PLAYING ? this.currentPipeSpeed() : this.state === STATE.START ? 70 : 0;
    this.groundOffset = (this.groundOffset - groundSpeed * dt) % 24;

    const speedScale = this.state === STATE.GAMEOVER ? 0 : this.state === STATE.START ? 0.4 : 1;
    for (const layer of this.bgLayers) layer.update(dt, speedScale);

    this.particles.update(dt);
    if (this.flashTimer > 0) this.flashTimer -= dt;

    if (this.state === STATE.START) {
      this.startAnimTime += dt;
      // Gentle idle bob so the start screen doesn't feel static.
      this.bird.y = WORLD_H / 2 + Math.sin(this.startAnimTime * 2.4) * 10;
      this.bird.rotation = Math.sin(this.startAnimTime * 2.4) * 0.08;
      this.bird.wingPhase += dt * 6;
      return;
    }

    if (this.state === STATE.GAMEOVER) {
      // Let the bird keep falling under gravity after a mid-air death
      // (pipe/ceiling hit) until it settles on the ground, like the
      // original game, instead of freezing mid-air.
      if (!this.bird.grounded) {
        this.bird.update(dt);
        if (this.bird.bottom >= WORLD_H - GROUND_H) {
          this.bird.y = WORLD_H - GROUND_H - BIRD_RADIUS;
          this.bird.vy = 0;
          this.bird.grounded = true;
        }
      }
      return;
    }

    // --- STATE.PLAYING ---
    this.bird.update(dt);

    const speed = this.currentPipeSpeed();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnPipe();
      this.spawnTimer = PIPE_INTERVAL;
    }

    for (const pipe of this.pipes) {
      pipe.update(dt, speed);
      if (!pipe.passed && pipe.x + pipe.width < this.bird.x) {
        pipe.passed = true;
        this.score++;
        this.sound.score();
      }
    }
    this.pipes = this.pipes.filter((p) => !p.offscreen);

    // Collisions: ground, ceiling, pipes.
    const hitGround = this.bird.bottom >= WORLD_H - GROUND_H;
    const hitCeiling = this.bird.top <= 0;
    const hitPipe = this.pipes.some((p) => p.collides(this.bird));

    if (hitGround || hitCeiling || hitPipe) {
      this.die(hitGround);
    }
  }

  die(landed) {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.GAMEOVER;
    if (landed) {
      this.bird.y = WORLD_H - GROUND_H - BIRD_RADIUS;
      this.bird.vy = 0;
      this.bird.grounded = true;
    }

    this.sound.hit();
    this.particles.burst(this.bird.x, this.bird.y, ["#ffd23f", "#ff7a1a", "#fff3c4", "#f2a30f"]);
    this.flashTimer = 0.15;
    this.allowRestartAt = performance.now() + 500;

    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.isNewHighScore = true;
      localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
    }
  }

  // --- rendering -------------------------------------------------------

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);

    this.#drawSky(ctx);
    ctx.save();
    this.hills.render(ctx);
    this.clouds.render(ctx);
    this.bushes.render(ctx);
    ctx.restore();

    for (const pipe of this.pipes) pipe.draw(ctx);

    this.#drawGround(ctx);
    this.bird.draw(ctx);
    this.particles.draw(ctx);

    this.#drawHud(ctx);

    if (this.flashTimer > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(this.flashTimer / 0.15) * 0.55})`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    if (this.state === STATE.START) this.#drawStartScreen(ctx);
    if (this.state === STATE.GAMEOVER) this.#drawGameOverScreen(ctx);
  }

  #drawSky(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    grad.addColorStop(0, "#6ec6f2");
    grad.addColorStop(0.65, "#bfe8f7");
    grad.addColorStop(1, "#eaf7e8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Sun glow.
    const sunGrad = ctx.createRadialGradient(WORLD_W - 70, 90, 4, WORLD_W - 70, 90, 60);
    sunGrad.addColorStop(0, "rgba(255,247,214,0.95)");
    sunGrad.addColorStop(1, "rgba(255,247,214,0)");
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  #drawGround(ctx) {
    const y = WORLD_H - GROUND_H;
    const grad = ctx.createLinearGradient(0, y, 0, WORLD_H);
    grad.addColorStop(0, "#dfc383");
    grad.addColorStop(0.12, "#d8b76e");
    grad.addColorStop(1, "#b8925a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, WORLD_W, GROUND_H);

    // Grass edge.
    ctx.fillStyle = "#4caf5f";
    ctx.fillRect(0, y, WORLD_W, 8);
    ctx.fillStyle = "#3d9450";
    ctx.fillRect(0, y + 6, WORLD_W, 4);

    // Scrolling dashed texture on the dirt to sell the motion.
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    for (let x = this.groundOffset - 24; x < WORLD_W; x += 24) {
      ctx.fillRect(x, y + 18, 14, 4);
      ctx.fillRect(x + 8, y + 40, 14, 4);
      ctx.fillRect(x - 4, y + 62, 14, 4);
    }
  }

  #drawHud(ctx) {
    if (this.state === STATE.START) return;

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 40px 'Segoe UI', system-ui, sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.fillStyle = "#ffffff";
    ctx.strokeText(String(this.score), WORLD_W / 2, 70);
    ctx.fillText(String(this.score), WORLD_W / 2, 70);
    ctx.restore();
  }

  #panel(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(20, 30, 45, 0.72)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  #drawStartScreen(ctx) {
    ctx.save();
    ctx.textAlign = "center";

    const panelW = 260;
    const panelH = 200;
    const px = (WORLD_W - panelW) / 2;
    const py = 120;
    this.#panel(ctx, px, py, panelW, panelH);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Flappy Bird", WORLD_W / 2, py + 52);

    ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#d7e3f4";
    ctx.fillText("Space / Click / Tap to flap", WORLD_W / 2, py + 90);

    ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#a9bbd8";
    ctx.fillText(`High Score: ${this.highScore}`, WORLD_W / 2, py + 118);

    // Pulsing "tap to start" prompt.
    const pulse = 0.6 + Math.sin(this.startAnimTime * 4) * 0.4;
    ctx.globalAlpha = clamp(pulse, 0.2, 1);
    ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#ffd23f";
    ctx.fillText("Tap to Start", WORLD_W / 2, py + 160);

    ctx.restore();
  }

  #drawGameOverScreen(ctx) {
    ctx.save();
    ctx.textAlign = "center";

    const panelW = 260;
    const panelH = 220;
    const px = (WORLD_W - panelW) / 2;
    const py = 110;
    this.#panel(ctx, px, py, panelW, panelH);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Game Over", WORLD_W / 2, py + 46);

    ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#d7e3f4";
    ctx.fillText(`Score: ${this.score}`, WORLD_W / 2, py + 82);

    ctx.fillStyle = this.isNewHighScore ? "#ffd23f" : "#a9bbd8";
    ctx.fillText(
      this.isNewHighScore ? `New High Score: ${this.highScore}!` : `High Score: ${this.highScore}`,
      WORLD_W / 2,
      py + 108
    );

    // Restart button.
    const btnW = 160;
    const btnH = 42;
    const bx = WORLD_W / 2 - btnW / 2;
    const by = py + 138;
    const ready = performance.now() >= this.allowRestartAt;

    ctx.globalAlpha = ready ? 1 : 0.5;
    const btnGrad = ctx.createLinearGradient(bx, by, bx, by + btnH);
    btnGrad.addColorStop(0, "#69d874");
    btnGrad.addColorStop(1, "#3fae4a");
    ctx.fillStyle = btnGrad;
    ctx.beginPath();
    ctx.moveTo(bx + 10, by);
    ctx.arcTo(bx + btnW, by, bx + btnW, by + btnH, 10);
    ctx.arcTo(bx + btnW, by + btnH, bx, by + btnH, 10);
    ctx.arcTo(bx, by + btnH, bx, by, 10);
    ctx.arcTo(bx, by, bx + btnW, by, 10);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Restart", WORLD_W / 2, by + 27);

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game");
  new Game(canvas);
});
