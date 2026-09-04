/*
 * Canvas rendering, UI wiring, and the requestAnimationFrame loop.
 *
 * The simulation itself (kinematics.js, pid.js, sensors.js, world.js,
 * sim.js) knows nothing about the DOM or canvas -- this file just drives
 * RoverSim.Sim.Simulation forward with a fixed timestep and draws it.
 */
(function () {
  'use strict';

  var Sim = window.RoverSim.Sim;

  // ---- fixed-timestep simulation clock -----------------------------------
  // simulate.py steps at dt=0.05s per loop iteration. Real-time playback at
  // that rate would take ~14s to clear the default route, which is slow for
  // a portfolio demo, so we run the same fixed-step physics at a multiple
  // of wall-clock time rather than changing dt itself (dt stays physically
  // meaningful; we just play more of it per second).
  var TIME_SCALE = 3.0;
  var MAX_STEPS_PER_FRAME = 12;

  var sim = new Sim.Simulation();
  var running = true;
  var accumulator = 0;
  var lastFrameTime = null;

  // ---- canvas + coordinate transform --------------------------------------
  var canvas = document.getElementById('sim-canvas');
  var ctx = canvas.getContext('2d');
  var view = { scale: 1, offsetX: 0, offsetY: 0 };

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue('--bg').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      line: cs.getPropertyValue('--line').trim(),
      text: cs.getPropertyValue('--text').trim(),
      textMuted: cs.getPropertyValue('--text-muted').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      accent2: cs.getPropertyValue('--accent-2').trim(),
      danger: cs.getPropertyValue('--danger').trim(),
    };
  }

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var displayWidth = canvas.clientWidth;
    var displayHeight = canvas.clientHeight;
    if (displayWidth === 0 || displayHeight === 0) return;

    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var world = sim.world;
    var scale = Math.min(displayWidth / world.width, displayHeight / world.height);
    view.scale = scale;
    view.offsetX = (displayWidth - world.width * scale) / 2;
    view.offsetY = (displayHeight - world.height * scale) / 2;
    view.displayWidth = displayWidth;
    view.displayHeight = displayHeight;
  }

  // World (meters, y-up) -> canvas (CSS px, y-down).
  function toCanvas(x, y) {
    return [
      view.offsetX + x * view.scale,
      view.offsetY + (sim.world.height - y) * view.scale,
    ];
  }

  // Canvas (CSS px) -> world (meters, y-up).
  function toWorld(px, py) {
    return [
      (px - view.offsetX) / view.scale,
      sim.world.height - (py - view.offsetY) / view.scale,
    ];
  }

  // ---- drawing -------------------------------------------------------------
  function draw() {
    var c = readColors();
    var w = view.displayWidth, h = view.displayHeight;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    // Arena bounds
    var topLeft = toCanvas(0, sim.world.height);
    ctx.fillStyle = c.bg;
    ctx.fillRect(topLeft[0], topLeft[1], sim.world.width * view.scale, sim.world.height * view.scale);
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft[0] + 0.5, topLeft[1] + 0.5, sim.world.width * view.scale, sim.world.height * view.scale);

    // Meter grid (every 1m), faint
    ctx.strokeStyle = c.line;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = 1; gx < sim.world.width; gx++) {
      var a = toCanvas(gx, 0), b = toCanvas(gx, sim.world.height);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    for (var gy = 1; gy < sim.world.height; gy++) {
      var a2 = toCanvas(0, gy), b2 = toCanvas(sim.world.width, gy);
      ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Obstacles
    ctx.fillStyle = c.textMuted;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1.5;
    sim.world.obstacles.forEach(function (obs) {
      ctx.beginPath();
      if (obs instanceof window.RoverSim.World.Circle) {
        var center = toCanvas(obs.cx, obs.cy);
        ctx.arc(center[0], center[1], obs.radius * view.scale, 0, Math.PI * 2);
      } else {
        var corner = toCanvas(obs.x, obs.y + obs.height);
        ctx.rect(corner[0], corner[1], obs.width * view.scale, obs.height * view.scale);
      }
      ctx.fill();
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Trail
    if (sim.trail.length > 1) {
      ctx.strokeStyle = c.accent2;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      sim.trail.forEach(function (p, i) {
        var pt = toCanvas(p.x, p.y);
        if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Waypoints + route
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = c.textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    var startPt = toCanvas(sim.robot.pose.x, sim.robot.pose.y);
    ctx.moveTo(startPt[0], startPt[1]);
    sim.waypoints.slice(sim.targetIdx).forEach(function (wp) {
      var pt = toCanvas(wp[0], wp[1]);
      ctx.lineTo(pt[0], pt[1]);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    sim.waypoints.forEach(function (wp, i) {
      var pt = toCanvas(wp[0], wp[1]);
      var isCurrent = i === sim.targetIdx;
      var isDone = i < sim.targetIdx;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], isCurrent ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isDone ? c.line : c.accent;
      ctx.globalAlpha = isCurrent ? 1 : (isDone ? 0.7 : 0.85);
      ctx.fill();
      if (isCurrent) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.accent;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    // Sensor rays (real ray-cast hit points, from the ported sensors.js model)
    var offsets = sim.sensorArray.offsets;
    var readings = sim.lastReadings;
    var origin = toCanvas(sim.robot.pose.x, sim.robot.pose.y);
    ctx.lineWidth = 1.5;
    for (var i2 = 0; i2 < offsets.length; i2++) {
      var heading = sim.robot.pose.theta + offsets[i2];
      var dist = readings[i2];
      var hitX = sim.robot.pose.x + Math.cos(heading) * dist;
      var hitY = sim.robot.pose.y + Math.sin(heading) * dist;
      var hitPt = toCanvas(hitX, hitY);
      var hitSomething = dist < sim.sensorArray.maxRange - 1e-6;

      ctx.strokeStyle = c.accent2;
      ctx.globalAlpha = hitSomething ? 0.9 : 0.25;
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(hitPt[0], hitPt[1]);
      ctx.stroke();

      if (hitSomething) {
        ctx.fillStyle = c.accent2;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(hitPt[0], hitPt[1], 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Robot body + heading indicator
    var bodyRadius = 0.25 * view.scale;
    ctx.beginPath();
    ctx.arc(origin[0], origin[1], bodyRadius, 0, Math.PI * 2);
    ctx.fillStyle = c.accent;
    ctx.fill();
    ctx.strokeStyle = c.surface;
    ctx.lineWidth = 2;
    ctx.stroke();

    var noseX = sim.robot.pose.x + Math.cos(sim.robot.pose.theta) * 0.4;
    var noseY = sim.robot.pose.y + Math.sin(sim.robot.pose.theta) * 0.4;
    var nosePt = toCanvas(noseX, noseY);
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1]);
    ctx.lineTo(nosePt[0], nosePt[1]);
    ctx.stroke();
  }

  // ---- telemetry panel -------------------------------------------------
  var sensorListEl = document.getElementById('sensor-list');
  var sensorLabels = ['-90°', '-45°', '0°', '+45°', '+90°'];
  var sensorRowEls = [];

  function buildSensorRows() {
    sensorListEl.innerHTML = '';
    sensorRowEls = sim.sensorArray.offsets.map(function (_, i) {
      var row = document.createElement('div');
      row.className = 'sensor-row';

      var label = document.createElement('span');
      label.textContent = sensorLabels[i] || (i + '');

      var track = document.createElement('span');
      track.className = 'sensor-bar-track';
      var fill = document.createElement('span');
      fill.className = 'sensor-bar-fill';
      track.appendChild(fill);

      var value = document.createElement('span');
      value.textContent = '--';

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      sensorListEl.appendChild(row);

      return { row: row, fill: fill, value: value };
    });
  }

  var tmX = document.getElementById('tm-x');
  var tmY = document.getElementById('tm-y');
  var tmTheta = document.getElementById('tm-theta');
  var tmT = document.getElementById('tm-t');
  var tmV = document.getElementById('tm-v');
  var tmOmega = document.getElementById('tm-omega');
  var tmWaypoint = document.getElementById('tm-waypoint');
  var warningBanner = document.getElementById('warning-banner');
  var statusNote = document.getElementById('status-note');

  function updateTelemetry() {
    tmX.textContent = sim.robot.pose.x.toFixed(2);
    tmY.textContent = sim.robot.pose.y.toFixed(2);
    tmTheta.textContent = (sim.robot.pose.theta * 180 / Math.PI).toFixed(0) + '°';
    tmT.textContent = sim.t.toFixed(2) + 's';
    tmV.textContent = sim.lastV.toFixed(2) + ' m/s';
    tmOmega.textContent = sim.lastOmega.toFixed(2) + ' rad/s';
    tmWaypoint.textContent = Math.min(sim.targetIdx + 1, sim.waypoints.length) + ' / ' + sim.waypoints.length;

    var readings = sim.lastReadings;
    var maxR = sim.sensorArray.maxRange;
    for (var i = 0; i < sensorRowEls.length; i++) {
      var d = readings[i];
      var pct = Math.max(0, Math.min(1, d / maxR));
      var near = d < Sim.WARNING_DISTANCE;
      sensorRowEls[i].fill.style.width = (pct * 100).toFixed(0) + '%';
      sensorRowEls[i].value.textContent = d.toFixed(2) + 'm';
      sensorRowEls[i].row.classList.toggle('near', near);
    }

    warningBanner.classList.toggle('active', sim.warning);

    if (sim.finished) {
      statusNote.textContent = 'route complete — click the arena or restart';
      statusNote.classList.add('idle');
    } else if (!running) {
      statusNote.textContent = 'paused';
      statusNote.classList.add('idle');
    } else {
      statusNote.textContent = 'driving to waypoint ' + (sim.targetIdx + 1);
      statusNote.classList.remove('idle');
    }
  }

  // ---- animation loop ----------------------------------------------------
  function frame(now) {
    if (lastFrameTime === null) lastFrameTime = now;
    var realDt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    realDt = Math.min(realDt, 0.25); // clamp huge gaps (tab backgrounded, etc.)

    if (running && !sim.finished) {
      accumulator += realDt * TIME_SCALE;
      var steps = 0;
      while (accumulator >= Sim.DT && steps < MAX_STEPS_PER_FRAME) {
        sim.step(Sim.DT);
        accumulator -= Sim.DT;
        steps++;
      }
    }

    draw();
    updateTelemetry();
    requestAnimationFrame(frame);
  }

  // ---- UI wiring -----------------------------------------------------------
  var pauseBtn = document.getElementById('pause-btn');
  var restartBtn = document.getElementById('restart-btn');

  pauseBtn.addEventListener('click', function () {
    running = !running;
    pauseBtn.textContent = running ? 'Pause' : 'Resume';
  });

  restartBtn.addEventListener('click', function () {
    sim.reset();
    accumulator = 0;
    running = true;
    pauseBtn.textContent = 'Pause';
  });

  canvas.addEventListener('click', function (evt) {
    var rect = canvas.getBoundingClientRect();
    var px = evt.clientX - rect.left;
    var py = evt.clientY - rect.top;
    var wp = toWorld(px, py);
    var x = Math.max(0.2, Math.min(sim.world.width - 0.2, wp[0]));
    var y = Math.max(0.2, Math.min(sim.world.height - 0.2, wp[1]));

    if (sim.world.collides(x, y, 0.15)) {
      statusNote.textContent = 'cannot place a waypoint inside an obstacle';
      statusNote.classList.remove('idle');
      return;
    }

    sim.addWaypoint(x, y);
    running = true;
    pauseBtn.textContent = 'Pause';
  });

  window.addEventListener('resize', resizeCanvas);

  // ---- boot -----------------------------------------------------------------
  buildSensorRows();
  resizeCanvas();
  // Re-measure once layout has settled (fonts/box sizing can shift on first paint).
  requestAnimationFrame(function () { resizeCanvas(); requestAnimationFrame(frame); });
})();
