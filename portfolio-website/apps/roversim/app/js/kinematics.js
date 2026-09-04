/*
 * Differential-drive kinematics.
 *
 * Ported from roversim/kinematics.py. A differential-drive robot (two
 * independently driven wheels sharing an axle) is steered entirely by the
 * difference between its left and right wheel speeds. This converts wheel
 * velocities into body-frame linear/angular velocity and integrates the
 * resulting pose (x, y, theta) forward in time using the exact closed-form
 * solution for constant velocity over a timestep (the robot follows a true
 * circular arc during each step, not a straight-line approximation), so
 * simulated motion doesn't accumulate discretization error from Euler
 * integration.
 */
(function (global) {
  'use strict';

  // Wrap an angle to (-pi, pi], matching Python's `(a + pi) % (2*pi) - pi`
  // (Python's % always returns a result with the sign of the divisor; JS's
  // does not, so we correct for that explicitly).
  function wrapAngle(angle) {
    var twoPi = 2 * Math.PI;
    var wrapped = (angle + Math.PI) % twoPi;
    if (wrapped < 0) wrapped += twoPi;
    return wrapped - Math.PI;
  }

  // Convert left/right wheel linear speeds (m/s) to body-frame (v, omega).
  // wheelBase is the distance between the two wheels (m).
  function wheelSpeedsToBodyVelocity(vLeft, vRight, wheelBase) {
    var v = (vLeft + vRight) / 2.0;
    var omega = (vRight - vLeft) / wheelBase;
    return { v: v, omega: omega };
  }

  // Advance `pose` by one timestep under constant (v, omega), exactly, via
  // the closed-form circular-arc solution:
  //   x' = x + (v/omega) * (sin(theta + omega*dt) - sin(theta))
  //   y' = y - (v/omega) * (cos(theta + omega*dt) - cos(theta))
  //   theta' = theta + omega*dt
  // which reduces to straight-line motion when omega == 0.
  function integratePose(pose, v, omega, dt) {
    var theta = pose.theta;
    var newX, newY, newTheta;

    if (Math.abs(omega) < 1e-9) {
      newX = pose.x + v * Math.cos(theta) * dt;
      newY = pose.y + v * Math.sin(theta) * dt;
      newTheta = theta;
    } else {
      newTheta = theta + omega * dt;
      var radius = v / omega;
      newX = pose.x + radius * (Math.sin(newTheta) - Math.sin(theta));
      newY = pose.y - radius * (Math.cos(newTheta) - Math.cos(theta));
    }

    return { x: newX, y: newY, theta: wrapAngle(newTheta) };
  }

  // Stateful differential-drive robot: tracks its own pose over time.
  function DifferentialDriveRobot(wheelBase, pose) {
    this.wheelBase = wheelBase;
    this.pose = pose || { x: 0.0, y: 0.0, theta: 0.0 };
  }

  DifferentialDriveRobot.prototype.stepWheelSpeeds = function (vLeft, vRight, dt) {
    var bv = wheelSpeedsToBodyVelocity(vLeft, vRight, this.wheelBase);
    this.pose = integratePose(this.pose, bv.v, bv.omega, dt);
    return this.pose;
  };

  DifferentialDriveRobot.prototype.stepBodyVelocity = function (v, omega, dt) {
    this.pose = integratePose(this.pose, v, omega, dt);
    return this.pose;
  };

  global.RoverSim = global.RoverSim || {};
  global.RoverSim.Kinematics = {
    wrapAngle: wrapAngle,
    wheelSpeedsToBodyVelocity: wheelSpeedsToBodyVelocity,
    integratePose: integratePose,
    DifferentialDriveRobot: DifferentialDriveRobot,
  };
})(window);
