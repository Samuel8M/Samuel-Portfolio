/*
 * Simulated range sensors via 2D ray-casting against the obstacle map.
 *
 * Ported from roversim/sensors.py. Models a small array of fixed-bearing
 * range sensors (like an ultrasonic or IR ring around a rover) rigidly
 * mounted on the robot. Each sensor casts a ray from the robot's position,
 * at the robot's heading plus the sensor's mounting offset angle, and
 * reports the distance to the nearest obstacle along that ray (or
 * maxRange if nothing is hit).
 */
(function (global) {
  'use strict';

  // Cast a single ray from `origin` at `heading` radians. Returns the
  // distance to the nearest obstacle, or maxRange if the ray reaches
  // maxRange without hitting anything.
  function castRay(origin, heading, world, maxRange) {
    var direction = [Math.cos(heading), Math.sin(heading)];
    var best = maxRange;
    for (var i = 0; i < world.obstacles.length; i++) {
      var hit = world.obstacles[i].intersectRay(origin, direction, maxRange);
      if (hit !== null && hit < best) best = hit;
    }
    return best;
  }

  // A ring of range sensors at fixed offsets (radians) from robot heading.
  function RangeSensorArray(opts) {
    opts = opts || {};
    this.offsets = opts.offsets || [-Math.PI / 2, -Math.PI / 4, 0.0, Math.PI / 4, Math.PI / 2];
    this.maxRange = opts.maxRange !== undefined ? opts.maxRange : 5.0;
  }

  // Return the distance reading (m) for each sensor, in `offsets` order.
  RangeSensorArray.prototype.sense = function (x, y, heading, world) {
    var origin = [x, y];
    var readings = new Array(this.offsets.length);
    for (var i = 0; i < this.offsets.length; i++) {
      readings[i] = castRay(origin, heading + this.offsets[i], world, this.maxRange);
    }
    return readings;
  };

  global.RoverSim = global.RoverSim || {};
  global.RoverSim.Sensors = { castRay: castRay, RangeSensorArray: RangeSensorArray };
})(window);
