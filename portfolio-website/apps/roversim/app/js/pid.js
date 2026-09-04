/*
 * A small, general-purpose PID controller.
 *
 * Ported from roversim/pid.py. Used in the demo to steer heading toward a
 * target waypoint bearing. Wrapping the error is optional and used only
 * when controlling an angular quantity (headings wrap at +/- pi, so the
 * naive difference between two headings can be wrong by a full turn).
 */
(function (global) {
  'use strict';

  var wrapAngle = global.RoverSim.Kinematics.wrapAngle;

  // opts: { kp, ki, kd, outputLimits: [lo, hi] | null, integralLimits: [lo, hi] | null, angular: bool }
  function PIDController(opts) {
    opts = opts || {};
    this.kp = opts.kp || 0;
    this.ki = opts.ki || 0;
    this.kd = opts.kd || 0;
    this.outputLimits = opts.outputLimits || null;
    this.integralLimits = opts.integralLimits || null;
    this.angular = !!opts.angular;

    this._integral = 0.0;
    this._prevError = null;
  }

  PIDController.prototype.reset = function () {
    this._integral = 0.0;
    this._prevError = null;
  };

  PIDController.prototype.step = function (setpoint, measurement, dt) {
    var error = setpoint - measurement;
    if (this.angular) error = wrapAngle(error);

    this._integral += error * dt;
    if (this.integralLimits) {
      var iLo = this.integralLimits[0], iHi = this.integralLimits[1];
      this._integral = Math.max(iLo, Math.min(iHi, this._integral));
    }

    var derivative = (this._prevError === null || dt <= 0) ? 0.0 : (error - this._prevError) / dt;
    this._prevError = error;

    var output = this.kp * error + this.ki * this._integral + this.kd * derivative;

    if (this.outputLimits) {
      var oLo = this.outputLimits[0], oHi = this.outputLimits[1];
      output = Math.max(oLo, Math.min(oHi, output));
    }

    return output;
  };

  global.RoverSim = global.RoverSim || {};
  global.RoverSim.PID = { PIDController: PIDController };
})(window);
