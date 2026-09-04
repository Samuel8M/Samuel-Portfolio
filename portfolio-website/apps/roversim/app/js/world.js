/*
 * Obstacle primitives used by the world map and the ray-casting sensors.
 *
 * Ported from roversim/world.py. Both shapes expose intersectRay(origin,
 * direction, maxRange) which returns the distance from `origin` to the
 * nearest intersection with the shape along `direction` (a unit vector),
 * or null if the ray (within maxRange) misses the shape entirely.
 */
(function (global) {
  'use strict';

  function Circle(cx, cy, radius) {
    this.cx = cx;
    this.cy = cy;
    this.radius = radius;
  }

  Circle.prototype.intersectRay = function (origin, direction, maxRange) {
    var ox = origin[0], oy = origin[1];
    var dx = direction[0], dy = direction[1];
    // Ray: P(t) = origin + t*direction, solve |P(t) - center|^2 = r^2
    var fx = ox - this.cx, fy = oy - this.cy;
    var a = dx * dx + dy * dy;
    var b = 2 * (fx * dx + fy * dy);
    var c = fx * fx + fy * fy - this.radius * this.radius;

    var discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;

    var sqrtDisc = Math.sqrt(discriminant);
    var t1 = (-b - sqrtDisc) / (2 * a);
    var t2 = (-b + sqrtDisc) / (2 * a);

    var candidates = [t1, t2].filter(function (t) { return t >= 0; });
    if (candidates.length === 0) return null;
    var t = Math.min.apply(Math, candidates);
    if (t > maxRange) return null;
    return t;
  };

  Circle.prototype.contains = function (x, y) {
    return Math.pow(x - this.cx, 2) + Math.pow(y - this.cy, 2) <= this.radius * this.radius;
  };

  // An axis-aligned rectangle given by its lower-left corner and size.
  function Rectangle(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  Rectangle.prototype.intersectRay = function (origin, direction, maxRange) {
    var ox = origin[0], oy = origin[1];
    var dx = direction[0], dy = direction[1];
    var xMin = this.x, xMax = this.x + this.width;
    var yMin = this.y, yMax = this.y + this.height;

    var tNear = 0.0, tFar = maxRange;
    var axes = [
      [ox, dx, xMin, xMax],
      [oy, dy, yMin, yMax],
    ];

    for (var i = 0; i < axes.length; i++) {
      var o = axes[i][0], d = axes[i][1], lo = axes[i][2], hi = axes[i][3];
      if (Math.abs(d) < 1e-12) {
        if (o < lo || o > hi) return null;
        continue;
      }
      var t1 = (lo - o) / d;
      var t2 = (hi - o) / d;
      if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
      tNear = Math.max(tNear, t1);
      tFar = Math.min(tFar, t2);
      if (tNear > tFar) return null;
    }

    if (tNear < 0) {
      if (tFar < 0) return null;
      tNear = tFar; // origin is inside the box; report exit distance
    }
    if (tNear > maxRange) return null;
    return tNear;
  };

  Rectangle.prototype.contains = function (x, y) {
    return this.x <= x && x <= this.x + this.width && this.y <= y && y <= this.y + this.height;
  };

  // A rectangular arena containing a handful of static obstacles.
  function World(width, height, obstacles) {
    this.width = width;
    this.height = height;
    this.obstacles = obstacles || [];
  }

  // Whether a point (optionally inflated by `clearance`) hits any obstacle.
  World.prototype.collides = function (x, y, clearance) {
    clearance = clearance || 0.0;
    for (var i = 0; i < this.obstacles.length; i++) {
      var obs = this.obstacles[i];
      if (obs instanceof Circle) {
        var r = obs.radius + clearance;
        if (Math.pow(x - obs.cx, 2) + Math.pow(y - obs.cy, 2) <= r * r) return true;
      } else if (obs instanceof Rectangle) {
        if (
          obs.x - clearance <= x && x <= obs.x + obs.width + clearance &&
          obs.y - clearance <= y && y <= obs.y + obs.height + clearance
        ) return true;
      }
    }
    return false;
  };

  global.RoverSim = global.RoverSim || {};
  global.RoverSim.World = { Circle: Circle, Rectangle: Rectangle, World: World };
})(window);
