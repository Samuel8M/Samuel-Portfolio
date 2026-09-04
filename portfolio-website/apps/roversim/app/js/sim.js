/*
 * Demo scenario + waypoint-following stepper.
 *
 * Ported from roversim/simulate.py (build_demo_world, default_waypoints,
 * run_simulation). The Python version runs the whole thing headlessly in a
 * single loop and logs a time series; here the same per-iteration logic is
 * exposed as `Simulation.step(dt)` so a requestAnimationFrame loop can
 * drive it forward one fixed timestep at a time and render live.
 */
(function (global) {
  'use strict';

  var K = global.RoverSim.Kinematics;
  var P = global.RoverSim.PID;
  var S = global.RoverSim.Sensors;
  var W = global.RoverSim.World;

  // A 12x10 m arena with three obstacles the robot must thread between.
  function buildDemoWorld() {
    var obstacles = [
      new W.Circle(4.0, 5.5, 0.8),
      new W.Rectangle(7.0, 1.0, 1.2, 3.0),
      new W.Circle(9.0, 7.5, 1.0),
    ];
    return new W.World(12.0, 10.0, obstacles);
  }

  function defaultWaypoints() {
    return [[2.0, 1.5], [5.5, 2.5], [6.0, 6.0], [9.0, 4.5], [11.0, 8.5]];
  }

  var DT = 0.05;
  var CRUISE_SPEED = 1.2;
  var WAYPOINT_TOLERANCE = 0.3;
  var WARNING_DISTANCE = 0.6;
  var WHEEL_BASE = 0.4;
  var TRAIL_MAX = 6000;

  function Simulation(world) {
    this.world = world || buildDemoWorld();
    this.reset();
  }

  Simulation.prototype.reset = function (waypoints) {
    this.waypoints = (waypoints || defaultWaypoints()).map(function (wp) { return wp.slice(); });
    this.robot = new K.DifferentialDriveRobot(WHEEL_BASE, { x: 0.5, y: 0.5, theta: 0.0 });
    this.headingPid = new P.PIDController({
      kp: 2.5, ki: 0.05, kd: 0.4,
      outputLimits: [-3.0, 3.0], integralLimits: [-1.0, 1.0],
      angular: true,
    });
    this.sensorArray = new S.RangeSensorArray({ maxRange: 4.0 });

    this.targetIdx = 0;
    this.t = 0.0;
    this.trail = [{ x: this.robot.pose.x, y: this.robot.pose.y }];
    this.lastReadings = this.sensorArray.sense(this.robot.pose.x, this.robot.pose.y, this.robot.pose.theta, this.world);
    this.lastV = 0.0;
    this.lastOmega = 0.0;
    this.warning = false;
    this.finished = false;
  };

  // Redirect the robot: insert a new immediate target waypoint, keeping
  // whatever default waypoints remained queued up after it.
  Simulation.prototype.addWaypoint = function (x, y) {
    this.waypoints.splice(this.targetIdx, 0, [x, y]);
    this.finished = false;
  };

  // Advance the simulation by exactly one fixed timestep (mirrors one
  // iteration of the `for step in range(max_steps)` loop in simulate.py).
  Simulation.prototype.step = function (dt) {
    dt = dt || DT;

    if (this.targetIdx >= this.waypoints.length) {
      this.finished = true;
      return;
    }

    var target = this.waypoints[this.targetIdx];
    var tx = target[0], ty = target[1];
    var dx = tx - this.robot.pose.x, dy = ty - this.robot.pose.y;
    var distance = Math.hypot(dx, dy);

    if (distance < WAYPOINT_TOLERANCE) {
      this.targetIdx += 1;
      return;
    }

    var bearing = Math.atan2(dy, dx);
    var omega = this.headingPid.step(bearing, this.robot.pose.theta, dt);

    // Slow down while turning sharply, and while braking into the final waypoint.
    var headingError = Math.abs(K.wrapAngle(bearing - this.robot.pose.theta));
    var turnFactor = Math.max(0.15, 1.0 - headingError / Math.PI);
    var v = distance < 1.0
      ? Math.min(CRUISE_SPEED * turnFactor, distance / dt)
      : CRUISE_SPEED * turnFactor;

    this.robot.stepBodyVelocity(v, omega, dt);

    var readings = this.sensorArray.sense(this.robot.pose.x, this.robot.pose.y, this.robot.pose.theta, this.world);
    this.lastReadings = readings;
    this.lastV = v;
    this.lastOmega = omega;
    this.warning = Math.min.apply(Math, readings) < WARNING_DISTANCE;

    this.trail.push({ x: this.robot.pose.x, y: this.robot.pose.y });
    if (this.trail.length > TRAIL_MAX) this.trail.shift();

    this.t += dt;
  };

  global.RoverSim = global.RoverSim || {};
  global.RoverSim.Sim = {
    Simulation: Simulation,
    buildDemoWorld: buildDemoWorld,
    defaultWaypoints: defaultWaypoints,
    DT: DT,
    CRUISE_SPEED: CRUISE_SPEED,
    WAYPOINT_TOLERANCE: WAYPOINT_TOLERANCE,
    WARNING_DISTANCE: WARNING_DISTANCE,
    WHEEL_BASE: WHEEL_BASE,
  };
})(window);
