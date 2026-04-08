/** @module layout/coords2d/geom2d */

const TWO_PI = 2 * Math.PI;

/** @typedef {{ x: number, y: number }} Vec2 */

/**
 * @param {Vec2} x - First vector.
 * @param {Vec2} y - Second vector.
 * @returns {Vec2} The resulting 2D vector.
 */
export function vec2(x, y) {
  return { x, y };
}

/**
 * @param {Vec2} a - First point.
 * @param {Vec2} b - Second point.
 * @returns {number} Angle in radians from a to b.
 */
export function angleTo(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * @param {Vec2} origin - Origin point.
 * @param {number} ang - Angle in radians.
 * @param {number} length - Length value.
 * @returns {Vec2} Point at `length` along `ang` (radians) from `origin`.
 */
export function project(origin, ang, length) {
  return vec2(origin.x + length * Math.cos(ang), origin.y + length * Math.sin(ang));
}

/**
 * Shortest distance from point `p` to line segment `ab`.
 * @param {Vec2} p - The point.
 * @param {Vec2} a - First point.
 * @param {Vec2} b - Second point.
 * @returns {number} The shortest distance.
 */
export function pointToSegmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-12) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const px = a.x + t * abx;
  const py = a.y + t * aby;
  return Math.hypot(p.x - px, p.y - py);
}

/**
 * Rotates a point around an origin by the given angle.
 * @param {Vec2} point - The 2D point.
 * @param {Vec2} origin - Origin point.
 * @param {number} angle - Rotation angle in radians.
 * @returns {Vec2} The rotated point.
 */
export function rotateAround(point, origin, angle) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return vec2(origin.x + dx * cosA - dy * sinA, origin.y + dx * sinA + dy * cosA);
}

/**
 *
 * @param {Map.<string, Vec2>} coords - 2D coordinate map.
 * @param {Vec2} origin - Origin point.
 * @param {number} angle - Rotation angle in radians.
 */
export function rotateCoords(coords, origin, angle) {
  if (Math.abs(angle) < 1e-9) {
    return;
  }
  const entries = [...coords.entries()];
  for (const [id, pos] of entries) {
    coords.set(id, rotateAround(pos, origin, angle));
  }
}

/**
 * Turn sign between three consecutive points (cross-product sign).
 * @param {Vec2} a - First point.
 * @param {Vec2} b - Second point.
 * @param {Vec2} c - Third point.
 * @returns {0|1|-1} 1 for left turn, -1 for right turn, 0 for collinear.
 */
export function turnSignFromPoints(a, b, c) {
  if (!a || !b || !c) {
    return 0;
  }
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const cross = ux * vy - uy * vx;
  if (Math.abs(cross) < 1e-6) {
    return 0;
  }
  return cross > 0 ? 1 : -1;
}

/**
 * Circumradius of a regular n-gon with side length s. R = s / (2·sin(π/n)).
 * @param {number} n - Count or dimension.
 * @param {number} s - Side length.
 * @returns {number} The circumradius.
 */
export function circumradius(n, s) {
  return s / (2 * Math.sin(Math.PI / n));
}

/**
 * Reflects point `p` across the line through `a` and `b`.
 * @param {Vec2} p - The point to reflect.
 * @param {Vec2} a - First point on the line.
 * @param {Vec2} b - Second point on the line.
 * @returns {Vec2} The reflected point.
 */
export function _reflectPoint(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  return vec2(2 * (a.x + t * dx) - p.x, 2 * (a.y + t * dy) - p.y);
}

/**
 * Centroid of a set of atom IDs from a coords map.
 * @param {string[]} atomIds - Array of atom IDs.
 * @param {Map<string, Vec2>} coords - 2D coordinate map (atom ID → {x, y}).
 * @returns {Vec2} The centroid vector.
 */
export function centroid(atomIds, coords) {
  let sx = 0,
    sy = 0,
    n = 0;
  for (const id of atomIds) {
    const c = coords.get(id);
    if (c) {
      sx += c.x;
      sy += c.y;
      n++;
    }
  }
  return n === 0 ? vec2(0, 0) : vec2(sx / n, sy / n);
}

/**
 * Normalize angle to [−π, π].
 * @param {number} a - Angle in radians.
 * @returns {number} The normalized angle.
 */
export function normalizeAngle(a) {
  while (a > Math.PI) {
    a -= TWO_PI;
  }
  while (a < -Math.PI) {
    a += TWO_PI;
  }
  return a;
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if point p is strictly inside the polygon defined by vertices.
 * @param {{x:number,y:number}} p - Parameter value.
 * @param {{x:number,y:number}[]} polygon  Vertices in any order (will be sorted by angle)
 * @returns {boolean} `true` if the condition holds, `false` otherwise.
 */
export function pointInPolygon(p, polygon) {
  const n = polygon.length;
  if (n < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
