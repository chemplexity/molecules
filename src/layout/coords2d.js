/** @module layout/coords2d */

import { morganRanks } from '../algorithms/morgan.js';
import { assignCIPRanks } from '../core/Molecule.js';

const DEFAULT_BOND_LENGTH = 1.5;
const TWO_PI = 2 * Math.PI;
const DEG60 = Math.PI / 3;   // 60°
const DEG120 = 2 * Math.PI / 3;
const _layoutNeighborCache = new WeakMap();
const _layoutRankCache = new WeakMap();

function _layoutCompareAtomIds(molecule, aId, bId) {
  const ranks = _layoutRankCache.get(molecule);
  const a = molecule.atoms.get(aId);
  const b = molecule.atoms.get(bId);
  const aIsH = a?.name === 'H' ? 1 : 0;
  const bIsH = b?.name === 'H' ? 1 : 0;
  if (aIsH !== bIsH) {
    return aIsH - bIsH;
  }

  const aRank = ranks?.get(aId);
  const bRank = ranks?.get(bId);
  if (aRank != null && bRank != null && aRank !== bRank) {
    return aRank - bRank;
  }
  if (aRank != null && bRank == null) {
    return -1;
  }
  if (aRank == null && bRank != null) {
    return 1;
  }

  const aAtomic = a?.properties.protons ?? 0;
  const bAtomic = b?.properties.protons ?? 0;
  if (aAtomic !== bAtomic) {
    return aAtomic - bAtomic;
  }

  const aCharge = a?.getCharge() ?? 0;
  const bCharge = b?.getCharge() ?? 0;
  if (aCharge !== bCharge) {
    return aCharge - bCharge;
  }

  return aId.localeCompare(bId);
}

function _buildLayoutNeighborCache(molecule) {
  const ranks = morganRanks(molecule);
  _layoutRankCache.set(molecule, ranks);

  const neighborMap = new Map();
  for (const atomId of molecule.atoms.keys()) {
    const ordered = molecule.getNeighbors(atomId).slice().sort((aId, bId) => _layoutCompareAtomIds(molecule, aId, bId));
    neighborMap.set(atomId, ordered);
  }
  _layoutNeighborCache.set(molecule, neighborMap);
  return neighborMap;
}

function _layoutNeighbors(molecule, atomId) {
  return _layoutNeighborCache.get(molecule)?.get(atomId) ?? molecule.getNeighbors(atomId);
}

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/** @typedef {{ x: number, y: number }} Vec2 */

/** @returns {Vec2} */
function vec2(x, y) {
  return { x, y };
}

/** @returns {number} Angle in radians from a to b. */
function angleTo(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** @returns {Vec2} Point at `length` along `ang` (radians) from `origin`. */
function project(origin, ang, length) {
  return vec2(origin.x + length * Math.cos(ang), origin.y + length * Math.sin(ang));
}

/** Shortest distance from point `p` to line segment `ab`. */
function pointToSegmentDistance(p, a, b) {
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

function rotateAround(point, origin, angle) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return vec2(
    origin.x + dx * cosA - dy * sinA,
    origin.y + dx * sinA + dy * cosA
  );
}

function rotateCoords(coords, origin, angle) {
  if (Math.abs(angle) < 1e-9) {
    return;
  }
  const entries = [...coords.entries()];
  for (const [id, pos] of entries) {
    coords.set(id, rotateAround(pos, origin, angle));
  }
}

function turnSignFromPoints(a, b, c) {
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

/** Circumradius of a regular n-gon with side length s. R = s / (2·sin(π/n)). */
function circumradius(n, s) {
  return s / (2 * Math.sin(Math.PI / n));
}

/**
 * Reflects point `p` across the line through `a` and `b`.
 * @param {Vec2} p @param {Vec2} a @param {Vec2} b @returns {Vec2}
 */
function _reflectPoint(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t  = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  return vec2(2 * (a.x + t * dx) - p.x, 2 * (a.y + t * dy) - p.y);
}

/**
 * Centroid of a set of atom IDs from a coords map.
 * @param {string[]} atomIds @param {Map<string, Vec2>} coords @returns {Vec2}
 */
function centroid(atomIds, coords) {
  let sx = 0, sy = 0, n = 0;
  for (const id of atomIds) {
    const c = coords.get(id);
    if (c) {
      sx += c.x; sy += c.y; n++;
    }
  }
  return n === 0 ? vec2(0, 0) : vec2(sx / n, sy / n);
}

/**
 * Normalize angle to [−π, π].
 * @param {number} a @returns {number}
 */
function normalizeAngle(a) {
  while (a >  Math.PI) {
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
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}[]} polygon  Vertices in any order (will be sorted by angle)
 * @returns {boolean}
 */
function pointInPolygon(p, polygon) {
  const n = polygon.length;
  if (n < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Spatial hash grid — O(1) nearest-neighbour lookup for clash detection
// ---------------------------------------------------------------------------

/**
 * Lightweight grid that maps 2D cell coordinates to sets of atom IDs.
 * Cell size equals `bondLength` so a 3×3 neighbourhood covers all atoms
 * within one bond length of any query point.
 *
 * @param {number} cellSize
 */
class SpatialGrid {
  constructor(cellSize) {
    this.cs   = cellSize;
    this.data = new Map(); // "${cx},${cy}" → Set<string>
  }
  _key(x, y) {
    return `${Math.floor(x / this.cs)},${Math.floor(y / this.cs)}`;
  }
  add(id, x, y) {
    const k = this._key(x, y);
    if (!this.data.has(k)) {
      this.data.set(k, new Set());
    }
    this.data.get(k).add(id);
  }
  remove(id, x, y) {
    const k = this._key(x, y);
    const s = this.data.get(k);
    if (s) {
      s.delete(id);
    }
  }
  /** Returns true if any atom (other than those in `exclude`) is within `thresh` of (x,y). */
  hasNear(x, y, thresh, exclude, coords) {
    const cx0 = Math.floor(x / this.cs) - 1;
    const cy0 = Math.floor(y / this.cs) - 1;
    for (let dx = 0; dx <= 2; dx++) {
      for (let dy = 0; dy <= 2; dy++) {
        const ids = this.data.get(`${cx0 + dx},${cy0 + dy}`);
        if (!ids) {
          continue;
        }
        for (const id of ids) {
          if (exclude && exclude.has(id)) {
            continue;
          }
          const c = coords.get(id);
          if (c && Math.hypot(c.x - x, c.y - y) < thresh) {
            return true;
          }
        }
      }
    }
    return false;
  }
  /** Build from an existing coords map (all entries). */
  static fromCoords(coords, cellSize = DEFAULT_BOND_LENGTH) {
    const g = new SpatialGrid(cellSize);
    for (const [id, { x, y }] of coords) {
      g.add(id, x, y);
    }
    return g;
  }
}

// ---------------------------------------------------------------------------
// Ring system detection
// ---------------------------------------------------------------------------

/**
 * Groups the output of `molecule.getRings()` into ring systems.
 * Two rings belong to the same system if they share at least one atom.
 *
 * @param {string[][]} rings
 * @returns {{ atomIds: string[], ringIds: number[] }[]}
 */
function detectRingSystems(rings) {
  if (rings.length === 0) {
    return [];
  }

  // Union-Find
  const parent = rings.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; i = parent[i];
    } return i;
  }
  function union(i, j) {
    parent[find(i)] = find(j);
  }

  // Build atomId → [ringIdx, …] map
  const atomToRings = new Map();
  for (let ri = 0; ri < rings.length; ri++) {
    for (const atomId of rings[ri]) {
      if (!atomToRings.has(atomId)) {
        atomToRings.set(atomId, []);
      }
      atomToRings.get(atomId).push(ri);
    }
  }

  // Union rings that share an atom
  for (const ringIndices of atomToRings.values()) {
    for (let k = 1; k < ringIndices.length; k++) {
      union(ringIndices[0], ringIndices[k]);
    }
  }

  // Collect into systems
  const systemMap = new Map();
  for (let ri = 0; ri < rings.length; ri++) {
    const root = find(ri);
    if (!systemMap.has(root)) {
      systemMap.set(root, { atomIds: new Set(), ringIds: [] });
    }
    const sys = systemMap.get(root);
    sys.ringIds.push(ri);
    for (const atomId of rings[ri]) {
      sys.atomIds.add(atomId);
    }
  }

  return [...systemMap.values()].map(s => ({ atomIds: [...s.atomIds], ringIds: s.ringIds }));
}

/**
 * Returns atom IDs shared between two rings (as arrays).
 * @param {string[]} ringA @param {string[]} ringB @returns {string[]}
 */
function findSharedAtoms(ringA, ringB) {
  const setA = new Set(ringA);
  return ringB.filter(id => setA.has(id));
}

// ---------------------------------------------------------------------------
// Ring placement
// ---------------------------------------------------------------------------

/**
 * Places atoms of a single ring.
 * Small rings (≤ 8 atoms): regular polygon.
 * Large rings (> 8 atoms): rectangular perimeter walk — atoms are placed at
 * exact `bondLength` intervals along the four edges of a rectangle, keeping
 * all ring bonds at the correct length.  The rectangle aspect ratio is chosen
 * to approximate the golden ratio.
 *
 * @param {string[]} ringAtomIds - Ordered atom IDs around the ring.
 * @param {number} cx @param {number} cy - Ring center.
 * @param {number} bondLength
 * @param {number} startAngle - Radians, angle from center to first atom.
 * @param {Map<string, Vec2>} coords - Mutated in-place.
 */
function placeRing(ringAtomIds, cx, cy, bondLength, startAngle, coords) {
  const n = ringAtomIds.length;

  // Large macrocycles (n > 12): place on a 2:1 ellipse with equal arc-length
  // spacing so all initial bond lengths equal bondLength.  This produces a more
  // professional-looking layout (chains on the long sides point up/down; chains
  // on the short sides point left/right) compared to a perfect circle where all
  // chains radiate in a "sea-urchin" pattern.
  if (n > 12) {
    const RATIO = 2.0; // a = RATIO * b  (horizontal major axis)

    // Step 1: find b such that ellipse perimeter = n * bondLength.
    // Integrate ds/dtheta = sqrt(a²sin²t + b²cos²t) over [0, 2π].
    // For a = RATIO*b, the full perimeter = 4b * I where
    //   I = integral_0^{pi/2} sqrt(RATIO²sin²t + cos²t) dt.
    const M_INT = 200;
    let integralVal = 0;
    for (let k = 0; k < M_INT; k++) {
      const t0 = (k / M_INT) * (Math.PI / 2);
      const t1 = ((k + 1) / M_INT) * (Math.PI / 2);
      const tm = (t0 + t1) / 2;
      const dt = t1 - t0;
      integralVal += dt / 6 * (
        Math.sqrt(RATIO * RATIO * Math.sin(t0) ** 2 + Math.cos(t0) ** 2) +
        4 * Math.sqrt(RATIO * RATIO * Math.sin(tm) ** 2 + Math.cos(tm) ** 2) +
        Math.sqrt(RATIO * RATIO * Math.sin(t1) ** 2 + Math.cos(t1) ** 2)
      );
    }
    const b = (n * bondLength) / (4 * integralVal);
    const a = RATIO * b;

    // Step 2: build cumulative arc-length table around the full ellipse.
    const M = 600;
    const dtheta = TWO_PI / M;
    const cumulArc = new Float64Array(M + 1);
    for (let k = 1; k <= M; k++) {
      const t = (k - 0.5) * dtheta;
      const ds = Math.sqrt(a * a * Math.sin(t) ** 2 + b * b * Math.cos(t) ** 2);
      cumulArc[k] = cumulArc[k - 1] + ds * dtheta;
    }
    const totalArc = cumulArc[M];

    // Step 3: place atoms at equal arc-length intervals starting from startAngle.
    const arcStep = totalArc / n;
    const startArc = ((startAngle / TWO_PI) * totalArc % totalArc + totalArc) % totalArc;
    for (let i = 0; i < n; i++) {
      if (coords.has(ringAtomIds[i])) {
        continue;
      }
      const targetArc = (startArc + i * arcStep) % totalArc;
      // Binary search in cumulArc for the sample interval containing targetArc.
      let lo = 0, hi = M;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cumulArc[mid] <= targetArc) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      const frac = (targetArc - cumulArc[lo]) / (cumulArc[hi] - cumulArc[lo] + 1e-12);
      const theta = (lo + frac) * dtheta;
      coords.set(ringAtomIds[i], vec2(cx + a * Math.cos(theta), cy + b * Math.sin(theta)));
    }
    return;
  }

  // Small/medium rings: regular polygon (circle).
  const R    = circumradius(n, bondLength);
  const step = TWO_PI / n;
  for (let i = 0; i < n; i++) {
    if (!coords.has(ringAtomIds[i])) {
      coords.set(ringAtomIds[i], project(vec2(cx, cy), startAngle - i * step, R));
    }
  }
}

/**
 * Places a ring system (one or more fused/spiro rings).
 * Modifies `coords` in-place. All placed atom IDs are added to `placed`.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {{ atomIds: string[], ringIds: number[] }} system
 * @param {string[][]} rings - Full array from molecule.getRings()
 * @param {number} bondLength
 * @param {Vec2} origin - Where the first ring center goes.
 * @param {Map<string, Vec2>} coords
 */
function placeRingSystem(molecule, system, rings, bondLength, origin, coords) {
  const { ringIds } = system;

  if (ringIds.length === 1) {
    // Isolated ring — simple regular polygon.
    // Orient so the most-substituted ring atom is at 0° (rightmost, flat-top hexagon,
    // ChemDraw convention) so substituent bonds leave the ring horizontally.
    const ring = rings[ringIds[0]];
    const n = ring.length;
    const ringSet = new Set(ring);
    // Find ring atom with the most external (non-ring) neighbors.
    let bestIdx = 0, bestCount = -1;
    for (let i = 0; i < n; i++) {
      const count = _layoutNeighbors(molecule, ring[i]).filter(id => !ringSet.has(id)).length;
      if (count > bestCount || (count === bestCount && _layoutCompareAtomIds(molecule, ring[i], ring[bestIdx]) < 0)) {
        bestCount = count;
        bestIdx = i;
      }
    }
    // Place ring[bestIdx] at 0°: startAngle - bestIdx*step = 0  =>  startAngle = bestIdx*step
    const startAngle = bestIdx * (TWO_PI / n);
    placeRing(ring, origin.x, origin.y, bondLength, startAngle, coords);
    return;
  }

  // Build ring adjacency within this system
  const ringAdj = new Map(ringIds.map(ri => [ri, []]));
  for (let a = 0; a < ringIds.length; a++) {
    for (let b = a + 1; b < ringIds.length; b++) {
      const ri = ringIds[a], rj = ringIds[b];
      if (findSharedAtoms(rings[ri], rings[rj]).length >= 1) {
        ringAdj.get(ri).push(rj);
        ringAdj.get(rj).push(ri);
      }
    }
  }

  // BFS over rings; place each ring relative to the already-placed atoms
  // of the ring it was reached from.
  // Start from the LARGEST ring in the system so that large-ring (macrocycle)
  // placement takes priority and smaller fused rings are arc-fitted to it.
  const startRingId = ringIds.reduce((best, ri) => {
    if (rings[ri].length !== rings[best].length) {
      return rings[ri].length > rings[best].length ? ri : best;
    }
    const bestMin = [...rings[best]].sort((a, b) => _layoutCompareAtomIds(molecule, a, b))[0];
    const curMin = [...rings[ri]].sort((a, b) => _layoutCompareAtomIds(molecule, a, b))[0];
    return _layoutCompareAtomIds(molecule, curMin, bestMin) < 0 ? ri : best;
  }, ringIds[0]);
  const visitedRings = new Set();
  const queue        = [startRingId];
  visitedRings.add(startRingId);

  // Place the first ring as a regular polygon (or ellipse) at origin.
  // startAngle = 0 → flat-top hexagon (ChemDraw convention: vertices at sides, not top/bottom).
  const firstRing = rings[startRingId];
  placeRing(firstRing, origin.x, origin.y, bondLength, 0, coords);

  while (queue.length > 0) {
    const curRingIdx = queue.shift();
    const curCenter  = centroid(rings[curRingIdx], coords);

    for (const nextRingIdx of ringAdj.get(curRingIdx)) {
      if (visitedRings.has(nextRingIdx)) {
        continue;
      }
      visitedRings.add(nextRingIdx);
      queue.push(nextRingIdx);

      const nextRing   = rings[nextRingIdx];
      const n2         = nextRing.length;
      const shared     = findSharedAtoms(rings[curRingIdx], nextRing);

      if (shared.length >= 2) {
        // Fused: shared edge. Find two adjacent shared atoms in nextRing order.
        // Determine which pair of shared atoms are adjacent in nextRing.
        let sA = shared[0], sB = shared[1];
        // Check if sA and sB are adjacent in nextRing
        const iA = nextRing.indexOf(sA);
        const iB = nextRing.indexOf(sB);
        const adjacent = Math.abs(iA - iB) === 1 || Math.abs(iA - iB) === n2 - 1;
        if (!adjacent && shared.length > 2) {
          // Try other pairs — find an adjacent pair
          outer: for (let p = 0; p < shared.length; p++) {
            for (let q = p + 1; q < shared.length; q++) {
              const ia = nextRing.indexOf(shared[p]);
              const ib = nextRing.indexOf(shared[q]);
              if (Math.abs(ia - ib) === 1 || Math.abs(ia - ib) === n2 - 1) {
                sA = shared[p]; sB = shared[q];
                break outer;
              }
            }
          }
        }

        const cA = coords.get(sA);
        const cB = coords.get(sB);

        // New center: place the new ring at its own inradius from the shared edge,
        // on the opposite side from the current ring center.
        // Using reflection would only be correct when both rings are the same size;
        // for differently-sized fused rings (e.g. a hexagon fused to a pentagon)
        // the new center must be at inradius(n2), not inradius(n1).
        const midx  = (cA.x + cB.x) / 2,  midy  = (cA.y + cB.y) / 2;
        const edx   = cB.x - cA.x,         edy   = cB.y - cA.y;
        const elen  = Math.hypot(edx, edy) || 1;
        const px    = -edy / elen,          py    = edx / elen; // left-perp (CCW)
        const toCur = (curCenter.x - midx) * px + (curCenter.y - midy) * py;
        const side  = toCur > 0 ? -1 : 1;  // opposite side from curCenter
        const inrad = bondLength / (2 * Math.tan(Math.PI / n2));
        const newCenter = vec2(midx + side * px * inrad, midy + side * py * inrad);

        // Over-constrained check: if the ring has ≥3 already-placed atoms
        // (i.e. it is bordered by more than just the sA-sB edge, meaning
        // a prior ring placed some of the "free" atoms at positions inconsistent
        // with a regular polygon centred at newCenter), use circular arc fitting
        // for the free atom chain instead of the regular polygon loop.
        const prePlacedIds = nextRing.filter(id => coords.has(id));
        let arcFitted = false;
        if (prePlacedIds.length >= 2) {
          // Find the contiguous free arc and its two boundary (placed) atoms.
          const prePlacedSet = new Set(prePlacedIds);
          let fi = -1;
          for (let k = 0; k < n2; k++) {
            if (!prePlacedSet.has(nextRing[k])) {
              fi = k; break;
            }
          }
          if (fi >= 0) {
            // backward walk to find the placed atom just before the free arc
            let b1 = (fi - 1 + n2) % n2;
            while (!prePlacedSet.has(nextRing[b1])) {
              b1 = (b1 - 1 + n2) % n2;
            }
            // forward walk to find the placed atom just after the free arc
            let b2 = fi;
            while (!prePlacedSet.has(nextRing[(b2 + 1) % n2])) {
              b2 = (b2 + 1) % n2;
            }
            b2 = (b2 + 1) % n2;

            let nFree = 0;
            for (let k = (b1 + 1) % n2; k !== b2; k = (k + 1) % n2) {
              nFree++;
            }

            const pStart = coords.get(nextRing[b1]);
            const pEnd   = coords.get(nextRing[b2]);
            const chord  = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);
            const nBonds = nFree + 1;

            if (nFree > 0 && chord > 1e-9 && chord < nBonds * bondLength - 1e-9) {
              // Binary-search for circle radius R such that nBonds equal-length
              // chords of bondLength span exactly the given chord P_start→P_end.
              let rLo = bondLength / 2 + 1e-9, rHi = nBonds * bondLength;
              for (let iter = 0; iter < 64; iter++) {
                const rMid = (rLo + rHi) / 2;
                const sinArg = bondLength / (2 * rMid);
                const arcChord = sinArg <= 1
                  ? 2 * rMid * Math.sin(nBonds * Math.asin(sinArg)) : 0;
                if (arcChord < chord) {
                  rLo = rMid;
                } else {
                  rHi = rMid;
                }
              }
              const R = (rLo + rHi) / 2;

              // Arc center: on the same side of chord P_start→P_end as the
              // centroid of the already-placed atoms (concave side of the arc,
              // so free atoms bow toward the ring exterior).
              const mx   = (pStart.x + pEnd.x) / 2, my = (pStart.y + pEnd.y) / 2;
              const cdx  = pEnd.x - pStart.x,        cdy = pEnd.y - pStart.y;
              const cpx  = -cdy / chord,              cpy = cdx / chord; // left-perp
              let acx = 0, acy = 0;
              for (const id of prePlacedIds) {
                const p = coords.get(id); acx += p.x; acy += p.y;
              }
              acx /= prePlacedIds.length; acy /= prePlacedIds.length;
              // Use curCenter (centre of the ring already placed) as the primary
              // signal: free atoms must bow to the OPPOSITE side from curCenter.
              // Using the pre-placed-atom centroid is unreliable when the shared
              // bridge has ≥3 atoms: the bridge centroid can fall on the SAME
              // side as the desired free arc, inverting arcSide and collapsing the
              // new ring on top of the existing one.
              let dotPre = (curCenter.x - mx) * cpx + (curCenter.y - my) * cpy;
              if (Math.abs(dotPre) < 1e-6) {
                // Fallback when curCenter lies exactly on the chord midline.
                dotPre = (acx - mx) * cpx + (acy - my) * cpy;
              }
              // Major arc (> π): midpoint is on the SAME side as the centre.
              // Free atoms bow AWAY from the pre-placed arc, so the centre must
              // be OPPOSITE to the pre-placed centroid.
              const arcSide = dotPre >= 0 ? -1 : 1;
              const h       = Math.sqrt(Math.max(0, R * R - (chord / 2) ** 2));
              const arcCx   = mx + arcSide * cpx * h;
              const arcCy   = my + arcSide * cpy * h;

              // Determine arc direction (CW vs CCW) by matching the arc-step
              // angle α = 2·arcsin(BL/(2R)) with nBonds·α = total arc angle.
              const angleS  = Math.atan2(pStart.y - arcCy, pStart.x - arcCx);
              const angleE  = Math.atan2(pEnd.y   - arcCy, pEnd.x   - arcCx);
              const alpha   = 2 * Math.asin(bondLength / (2 * R));
              let   cwDelta = angleS - angleE;
              while (cwDelta < 0) {
                cwDelta += TWO_PI;
              }
              const totalArc  = nBonds * alpha;
              const arcDirMul = Math.abs(cwDelta - totalArc) <= Math.abs(TWO_PI - cwDelta - totalArc) ? -1 : 1;

              let k2 = (b1 + 1) % n2, step2 = 1;
              while (k2 !== b2) {
                coords.set(nextRing[k2],
                  vec2(arcCx + R * Math.cos(angleS + step2 * arcDirMul * alpha),
                    arcCy + R * Math.sin(angleS + step2 * arcDirMul * alpha)));
                k2 = (k2 + 1) % n2;
                step2++;
              }

              // Bridge-clash resolution for bridged bicyclics (e.g. bicyclo[3.1.1]):
              // when a ring shares 3+ atoms with the parent ring, arc-fitting can
              // place the free "bridge" atom directly on top of an already-placed atom
              // (the arc retraces the parent ring's own circumscribed circle).
              // Re-place the bridge atom on the perpendicular bisector of its two
              // ring neighbours, on the side opposite curCenter.  This keeps the
              // two incident bond lengths equal and avoids ejecting the bridge atom
              // far outside the bicyclic core when the exact regular-polygon height
              // is impossible because the neighbours are already too far apart.
              for (let kc = (b1 + 1) % n2; kc !== b2; kc = (kc + 1) % n2) {
                const freeId  = nextRing[kc];
                const freePos = coords.get(freeId);
                if (!freePos) {
                  continue;
                }
                let bridgeClash = false;
                for (const [otherId, otherPos] of coords) {
                  if (otherId === freeId) {
                    continue;
                  }
                  if (Math.hypot(freePos.x - otherPos.x, freePos.y - otherPos.y) < bondLength * 0.4) {
                    bridgeClash = true; break;
                  }
                }
                if (!bridgeClash) {
                  continue;
                }
                // Re-place at midpoint of ring-neighbours + outward direction × (3h).
                const ki  = nextRing.indexOf(freeId);
                const nbA = coords.get(nextRing[(ki - 1 + n2) % n2]);
                const nbB = coords.get(nextRing[(ki + 1) % n2]);
                if (!nbA || !nbB) {
                  continue;
                }
                const nbMx   = (nbA.x + nbB.x) / 2, nbMy = (nbA.y + nbB.y) / 2;
                const chordDx = nbB.x - nbA.x, chordDy = nbB.y - nbA.y;
                const chordLen = Math.hypot(chordDx, chordDy) || 1;
                const halfCh = chordLen / 2;
                const perpX = -chordDy / chordLen, perpY = chordDx / chordLen;
                const preferredSideDot = (curCenter.x - nbMx) * perpX + (curCenter.y - nbMy) * perpY;
                const preferredSide = preferredSideDot >= 0 ? -1 : 1;
                const exactLegH = halfCh < bondLength
                  ? Math.sqrt(bondLength * bondLength - halfCh * halfCh)
                  : 0;
                const otherPlaced = [...coords.entries()].filter(([otherId]) =>
                  otherId !== freeId && otherId !== nextRing[(ki - 1 + n2) % n2] && otherId !== nextRing[(ki + 1) % n2]
                );
                const candidateScore = candidate => {
                  let minDist = Infinity;
                  for (const [, otherPos] of otherPlaced) {
                    minDist = Math.min(minDist, Math.hypot(candidate.x - otherPos.x, candidate.y - otherPos.y));
                  }
                  return minDist;
                };
                const heightCandidates = exactLegH > 1e-6
                  ? [0.35, 0.6, 0.85, 1].map(scale => exactLegH * scale)
                  : [0.2, 0.35, 0.5, 0.65].map(scale => bondLength * scale);
                let bestCandidate = null;
                let bestScore = -Infinity;
                let bestMaxBond = Infinity;
                for (const height of heightCandidates) {
                  for (const side of [preferredSide, -preferredSide]) {
                    const candidate = vec2(
                      nbMx + side * perpX * height,
                      nbMy + side * perpY * height
                    );
                    const score = candidateScore(candidate);
                    const maxBond = Math.max(
                      Math.hypot(candidate.x - nbA.x, candidate.y - nbA.y),
                      Math.hypot(candidate.x - nbB.x, candidate.y - nbB.y)
                    );
                    if (score > bestScore + 1e-6 ||
                        (Math.abs(score - bestScore) <= 1e-6 && maxBond < bestMaxBond - 1e-6)) {
                      bestCandidate = candidate;
                      bestScore = score;
                      bestMaxBond = maxBond;
                    }
                  }
                }
                coords.set(freeId, bestCandidate ?? vec2(nbMx, nbMy));
              }

              arcFitted = true;
            }
          }
        }

        if (!arcFitted) {
        // Place un-placed atoms of nextRing around newCenter.
        // Determine order: find sA in nextRing and step around in the direction
        // that gives the correct bond lengths (away from curCenter).
          const startIdx = nextRing.indexOf(sA);
          const step     = TWO_PI / n2;
          const baseAngle = angleTo(newCenter, cA);
          // arrayDir: which direction in the ring array steps from sA to sB.
          const nextIdxCW  = (startIdx + 1) % n2;
          const arrayDir   = nextRing[nextIdxCW] === sB ? 1 : -1;
          // angularDir: geometric direction (CCW=+1, CW=−1) from sA to sB around newCenter.
          // Decoupled from arrayDir because BFS ring ordering can be CW or CCW.
          const dAng       = normalizeAngle(angleTo(newCenter, cB) - angleTo(newCenter, cA));
          const angularDir = dAng > 0 ? 1 : -1;

          for (let i = 0; i < n2; i++) {
            const idx    = ((startIdx + i * arrayDir) % n2 + n2) % n2;
            const atomId = nextRing[idx];
            if (!coords.has(atomId)) {
              coords.set(atomId, project(newCenter, baseAngle + i * step * angularDir, circumradius(n2, bondLength)));
            }
          }
        } // end !arcFitted
      } else if (shared.length === 1) {
        // Spiro: one shared atom.
        const spiroId    = shared[0];
        const spiroCoord = coords.get(spiroId);
        // Point new ring away from curCenter.
        const awayAngle  = angleTo(curCenter, spiroCoord);
        const R2         = circumradius(n2, bondLength);
        const newCenter  = project(spiroCoord, awayAngle, R2);
        // Place spiro atom at angle pointing back toward spiroCoord.
        const backAngle  = awayAngle + Math.PI;
        const startIdx   = nextRing.indexOf(spiroId);
        const step       = TWO_PI / n2;
        for (let i = 0; i < n2; i++) {
          const idx    = (startIdx + i) % n2;
          const atomId = nextRing[idx];
          if (!coords.has(atomId)) {
            coords.set(atomId, project(newCenter, backAngle - i * step, R2));
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chain layout
// ---------------------------------------------------------------------------

/**
 * Computes outgoing angles for `n` child atoms from a parent atom.
 *
 * @param {number} n - Number of children.
 * @param {number} outAngle - Preferred continuation direction (radians).
 * @param {boolean} fromRing - Whether the parent is a ring atom.
 * @param {number} incomingAngle - Direction arriving at parent from its own parent.
 * @param {boolean} isLinear - Whether the parent is sp-hybridised (triple bond); use 180° geometry.
 * @returns {number[]} Angles for each child.
 */
function computeChildAngles(n, outAngle, fromRing, incomingAngle, isLinear = false) {
  if (n === 1) {
    if (fromRing) {
      return [outAngle];
    }
    // sp atom — continue straight through, no zigzag.
    if (isLinear) {
      return [outAngle];
    }
    // sp3 zigzag: turn ±60° from the continuation direction to produce 120° bond angles.
    // The cross-product sign of (outAngle vs incomingAngle) determines which side.
    const cross = Math.sin(normalizeAngle(outAngle - incomingAngle));
    return [outAngle + (cross >= 0 ? -DEG60 : DEG60)];
  }
  if (n === 2) {
    // sp atom — place both children 180° apart (linear geometry).
    if (isLinear) {
      return [outAngle, normalizeAngle(outAngle + Math.PI)];
    }
    return [outAngle + DEG60, outAngle - DEG60];
  }
  if (n === 3) {
    return [outAngle, outAngle + DEG120, outAngle - DEG120];
  }
  if (n === 4) {
    // Tetrahedral 2D projection: two bonds forward (±60°), two slightly back (±120°).
    // Spreads all four across 240°, giving the classic rhombus/diamond appearance.
    return [outAngle + DEG60, outAngle - DEG60,
      outAngle + DEG120, outAngle - DEG120];
  }
  // 5+ children: fan evenly across 240° (same spread as the n=3 case, scaled).
  const spread = Math.PI * 4 / 3;
  const step   = spread / (n - 1);
  return Array.from({ length: n }, (_, i) => outAngle - spread / 2 + i * step);
}

/**
 * Returns the number of proposed child positions that are too close to any
 * already-placed atom.  Uses a SpatialGrid for O(1) lookup when provided,
 * otherwise falls back to a linear scan.
 *
 * @param {number[]} angles
 * @param {Vec2} origin
 * @param {Map<string, Vec2>} coords
 * @param {number} bondLength
 * @param {SpatialGrid|null} [grid]
 * @returns {number}
 */
function countClashes(angles, origin, coords, bondLength, grid = null) {
  const thresh = bondLength * 0.5;
  let n = 0;
  for (const ang of angles) {
    const p = project(origin, ang, bondLength);
    if (grid) {
      if (grid.hasNear(p.x, p.y, thresh, null, coords)) {
        n++;
      }
    } else {
      for (const c of coords.values()) {
        if (Math.hypot(c.x - p.x, c.y - p.y) < thresh) {
          n++; break;
        }
      }
    }
  }
  return n;
}

/**
 * Depth-first chain layout from `startAtomId`.
 * The atom at `startAtomId` must already have coordinates.
 * Uses an explicit stack (iterative) to avoid call-stack overflows on large
 * molecules, and a SpatialGrid for O(1) clash detection.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {string} startAtomId
 * @param {number} incomingAngle - Radians from which we arrived at startAtomId.
 * @param {Set<string>} placed - Atoms already placed; mutated.
 * @param {number} bondLength
 * @param {Map<string, Vec2>} coords - Mutated.
 * @param {boolean} fromRing - Whether startAtomId is a ring atom.
 * @param {SpatialGrid|null} [grid] - Optional spatial grid; if null, one is built lazily.
 */
function layoutChain(molecule, startAtomId, incomingAngle, placed, bondLength, coords, fromRing, grid = null) {
  // Build a spatial grid if one wasn't provided (first call in a layout pass).
  if (grid === null) {
    grid = SpatialGrid.fromCoords(coords, bondLength);
  }

  // Explicit stack: each entry is { atomId, incomingAngle, fromRing }
  const stack = [{ atomId: startAtomId, incomingAngle, fromRing }];

  while (stack.length > 0) {
    const { atomId, incomingAngle: incoming, fromRing: fRing } = stack.pop();
    const origin    = coords.get(atomId);
    if (!origin) {
      continue;
    }
    // Exclude H atoms from chain traversal — their positions are set by
    // placeHydrogens after heavy-atom layout so they never inflate the child
    // count in computeChildAngles or the gap strategy (which would produce
    // wrong bond angles, e.g. 90° instead of 120°, for ring-attachment CHs).
    const neighbors = _layoutNeighbors(molecule, atomId)
      .filter(id => !placed.has(id) && molecule.atoms.get(id)?.name !== 'H');
    if (neighbors.length === 0) {
      continue;
    }

    const outAngle = normalizeAngle(incoming + Math.PI);

    const isLinear = (() => {
      const _a = molecule.atoms.get(atomId);
      if (!_a) {
        return false;
      }
      if (_a.bonds.some(bId => (molecule.bonds.get(bId)?.properties.order ?? 1) === 3)) {
        return true;
      }
      // Allene center: two cumulated double bonds → sp, linear geometry
      return _a.bonds.filter(bId => (molecule.bonds.get(bId)?.properties.order ?? 1) === 2).length >= 2;
    })();

    // For non-ring atoms with ≥2 unplaced children and at least one already-placed
    // heavy neighbor (i.e. the parent in the BFS tree), use the "largest angular gap"
    // strategy: place children evenly inside the gap between the placed neighbors.
    // This is the same principle refineCoords uses for ring substituents, but applied
    // directly during the initial chain traversal.  It prevents a successive chain of
    // quaternary carbons from folding children back toward earlier atoms.
    //
    // Exception: atoms that carry a double (or higher) bond AND have only one placed
    // neighbor use computeChildAngles instead.  For such atoms (e.g. phosphorus with
    // four bonds where one is P=O) the gap strategy distributes three children at 90°
    // intervals (360°/4) which produces an ugly cross layout.  computeChildAngles
    // gives the correct 120° "Y" arrangement because these atoms have no fold-back
    // risk — the double bond prevents linear chain stacking.
    //
    // The n=1 case is excluded deliberately — single children use the zig-zag logic in
    // computeChildAngles to produce 120° chain angles.
    const isH = id => molecule.atoms.get(id)?.name === 'H';
    const placedNbs = _layoutNeighbors(molecule, atomId)
      .filter(id => placed.has(id) && !isH(id));
    const parentId = placedNbs.length === 0
      ? null
      : placedNbs.reduce((bestId, id) => {
        const pos = coords.get(id);
        if (!pos) {
          return bestId;
        }
        if (!bestId) {
          return id;
        }
        const bestPos = coords.get(bestId);
        const diff = Math.abs(normalizeAngle(angleTo(origin, pos) - incoming));
        const bestDiff = Math.abs(normalizeAngle(angleTo(origin, bestPos) - incoming));
        return diff < bestDiff ? id : bestId;
      }, null);
    const grandParentCandidates = parentId
      ? _layoutNeighbors(molecule, parentId)
        .filter(id => id !== atomId && placed.has(id) && !isH(id))
      : [];
    const grandParentId = grandParentCandidates.length === 1 ? grandParentCandidates[0] : null;
    const heavyDegree = id => _layoutNeighbors(molecule, id).filter(nb => !isH(nb)).length;
    const hasNonAromaticMultipleBond = id => molecule.atoms.get(id)?.bonds.some(bId => {
      const b = molecule.bonds.get(bId);
      return b && !b.properties.aromatic && (b.properties.order ?? 1) >= 2;
    }) ?? false;

    // Detect a multiple bond on this atom (order ≥ 2, excluding aromatic 1.5).
    const hasMultipleBond = molecule.atoms.get(atomId)?.bonds.some(bId => {
      const b = molecule.bonds.get(bId);
      return b && (b.properties.order ?? 1) >= 2 && !b.properties.aromatic;
    }) ?? false;

    let angles;
    if (!fRing && !isLinear && neighbors.length >= 2 && placedNbs.length > 0
        && (placedNbs.length >= 2 || !hasMultipleBond || neighbors.length <= 2)) {
      // Compute existing angular constraints from placed neighbours.
      const fixedAngles = placedNbs
        .map(id => angleTo(origin, coords.get(id)))
        .sort((a, b) => a - b);

      // Find the largest CCW gap between consecutive fixed angles.
      let gapStart = fixedAngles[fixedAngles.length - 1];
      let gapSize  = fixedAngles[0] - fixedAngles[fixedAngles.length - 1] + TWO_PI;
      for (let k = 0; k < fixedAngles.length - 1; k++) {
        const g = fixedAngles[k + 1] - fixedAngles[k];
        if (g > gapSize) {
          gapSize = g; gapStart = fixedAngles[k];
        }
      }

      // Spread children evenly inside the gap.
      const step = gapSize / (neighbors.length + 1);
      angles = neighbors.map((_, k) => normalizeAngle(gapStart + step * (k + 1)));
    } else {
      angles = computeChildAngles(neighbors.length, outAngle, fRing, incoming, isLinear);
    }

    // Steric clash avoidance using the spatial grid.
    // Score function: clash count + heavy penalty for near-linear placement
    // (angle between incoming direction and first child ≈ 180°).  A linear
    // C-N-C geometry starts at the force-field singularity (sinT ≈ 0) and
    // can collapse bonds during refinement.
    // Ring atoms are exempt: their `incoming` is the artificial ring-centre
    // direction (exactly opposite the correct outward bisector), so the
    // diff is always π and the penalty would wrongly fire, rotating the
    // substituent away from the analytically correct gap-bisector position.
    // sp atoms (isLinear) are also exempt: they deliberately use straight-through
    // 180° geometry (C≡N, C≡C, etc.) and must not be rotated away from it.
    const linearPenalty = (cand) => {
      if (fRing) {
        return 0;
      }
      if (isLinear) {
        return 0;
      }
      if (hasMultipleBond) {
        return 0;
      }
      if (placedNbs.length === 0) {
        return 0;
      }
      // Only penalise single-child atoms. For multi-child atoms, computeChildAngles
      // legitimately places cand[0] = outAngle (straight through), which would
      // always trigger the penalty and cause incorrect rotation (e.g. P=O groups).
      if (neighbors.length !== 1) {
        return 0;
      }
      // Angle between the direction FROM this atom TO its placed parent and
      // the direction TO the first candidate child.
      // incoming = angle of arrival at this atom (from parent → this atom direction).
      // The direction back to parent = incoming itself (reversed from child perspective).
      const toParent = normalizeAngle(incoming);
      const firstChild = cand[0];
      const diff = Math.abs(normalizeAngle(firstChild - toParent));
      // diff near π → linear (child placed straight through, 180° from parent)
      return diff > Math.PI * 5 / 6 ? 50 : 0;  // ≥ 150° → penalise
    };
    const inSpreadContext = () => {
      if (fRing || isLinear || hasMultipleBond || neighbors.length !== 1 || !parentId || !grandParentId) {
        return false;
      }
      let spreadContext = false;
      let ancestorId = grandParentId;
      let childId = parentId;
      for (let depth = 0; ancestorId && depth < 6; depth++) {
        if (heavyDegree(ancestorId) > 2 || hasNonAromaticMultipleBond(ancestorId)) {
          spreadContext = true;
          break;
        }
        const nextCandidates = _layoutNeighbors(molecule, ancestorId)
          .filter(id => id !== childId && placed.has(id) && !isH(id));
        childId = ancestorId;
        ancestorId = nextCandidates.length === 1 ? nextCandidates[0] : null;
      }
      if (!spreadContext &&
          heavyDegree(parentId) <= 2 &&
          !hasNonAromaticMultipleBond(parentId)) {
        return false;
      }
      return true;
    };
    const zigZagRepeatPenalty = (cand) => {
      if (!inSpreadContext()) {
        return 0;
      }
      const prevSign = backboneTurnSign(coords, grandParentId, parentId, atomId);
      if (prevSign === 0) {
        return 0;
      }
      const childPos = project(origin, cand[0], bondLength);
      const nextSign = turnSignFromPoints(coords.get(parentId), origin, childPos);
      return nextSign === prevSign ? 1 : 0;
    };
    let lockSingleChildZigZag = false;
    if (inSpreadContext()) {
      const mirrored = [normalizeAngle(2 * outAngle - angles[0])];
      const currentScore = countClashes(angles, origin, coords, bondLength, grid) * 10 + zigZagRepeatPenalty(angles);
      const mirroredScore = countClashes(mirrored, origin, coords, bondLength, grid) * 10 + zigZagRepeatPenalty(mirrored);
      if (mirroredScore < currentScore) {
        angles = mirrored;
      }
      lockSingleChildZigZag = true;
    }
    const scoreAngles = (cand) =>
      countClashes(cand, origin, coords, bondLength, grid) +
      linearPenalty(cand) +
      zigZagRepeatPenalty(cand);
    if (!lockSingleChildZigZag && scoreAngles(angles) > 0) {
      const INC = Math.PI / 6;
      const steps = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
      let best = angles;
      let bestScore = scoreAngles(angles);
      for (const k of steps) {
        const delta = k * INC;
        const candidate = !fRing && !isLinear && neighbors.length >= 2 && placedNbs.length > 0
          ? angles.map(a => normalizeAngle(a + delta))
          : computeChildAngles(neighbors.length, outAngle + delta, false, incoming + delta, isLinear);
        const score = scoreAngles(candidate);
        if (score < bestScore) {
          best = candidate; bestScore = score;
        }
        if (bestScore === 0) {
          break;
        }
      }
      angles = best;
    }

    // Place children and push onto stack in REVERSE order so left-most child
    // is processed first (matches the original DFS order).
    for (let i = neighbors.length - 1; i >= 0; i--) {
      const childId  = neighbors[i];
      const childAng = angles[i];
      const childPos = project(origin, childAng, bondLength);
      coords.set(childId, childPos);
      grid.add(childId, childPos.x, childPos.y);
      placed.add(childId);
      stack.push({ atomId: childId, incomingAngle: normalizeAngle(childAng + Math.PI), fromRing: false });
    }
  }
}

// ---------------------------------------------------------------------------
// Hydrogen placement
// ---------------------------------------------------------------------------

/**
 * Places explicit pendant H atoms (degree 1, element 'H') near their heavy-atom parent.
 * H atoms are placed radially away from the parent's other neighbors.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Map<string, Vec2>} coords
 * @param {number} bondLength
 */
function placeHydrogens(molecule, coords, bondLength) {
  const hLen = bondLength * 0.75;

  for (const [atomId, atom] of molecule.atoms) {
    if (atom.name !== 'H') {
      continue;
    }
    if (coords.has(atomId)) {
      continue;
    } // already placed

    const neighbors = _layoutNeighbors(molecule, atomId);
    if (neighbors.length !== 1) {
      continue;
    }

    const parentId    = neighbors[0];
    const parentCoord = coords.get(parentId);
    if (!parentCoord) {
      continue;
    }

    // Compute the average direction of all OTHER neighbors of parent.
    const parentNeighbors = _layoutNeighbors(molecule, parentId).filter(id => id !== atomId);
    let awayAngle;

    if (parentNeighbors.length === 0) {
      awayAngle = 0; // Isolated parent — place H to the right
    } else {
      // Sum vectors from parent toward each existing neighbor.
      let sumX = 0, sumY = 0;
      for (const nbId of parentNeighbors) {
        const c = coords.get(nbId);
        if (c) {
          sumX += c.x - parentCoord.x; sumY += c.y - parentCoord.y;
        }
      }
      // Point away from the average neighbor direction.
      awayAngle = Math.atan2(-sumY, -sumX);
    }

    coords.set(atomId, project(parentCoord, awayAngle, hLen));
  }
}

// ---------------------------------------------------------------------------
// Multi-component layout
// ---------------------------------------------------------------------------

/**
 * Lays out each connected component separately and tiles them horizontally.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {object} options
 * @returns {Map<string, Vec2>}
 */
function layoutComponents(molecule, options) {
  const components = molecule.getComponents();
  const allCoords  = new Map();
  let   offsetX    = 0;

  for (const component of components) {
    const cCoords  = generateCoords(component, options);
    // Find bounding box of this component.
    let minX = Infinity, maxX = -Infinity;
    for (const c of cCoords.values()) {
      if (c.x < minX) {
        minX = c.x;
      } if (c.x > maxX) {
        maxX = c.x;
      }
    }

    // Shift all coords by offsetX - minX
    const shift = offsetX - minX;
    for (const [atomId, c] of cCoords) {
      const shifted = vec2(c.x + shift, c.y);
      allCoords.set(atomId, shifted);
      // Write back to original molecule's atom
      const atom = molecule.atoms.get(atomId);
      if (atom) {
        atom.x = shifted.x; atom.y = shifted.y;
      }
    }

    const bondLength = options.bondLength ?? DEFAULT_BOND_LENGTH;
    offsetX += (maxX - minX) + bondLength * 3;
  }

  return allCoords;
}

// ---------------------------------------------------------------------------
// Geometry refinement
// ---------------------------------------------------------------------------

/**
 * Returns the ideal interior bond angle (radians) for an atom based on its
 * degree and bond orders (sp / sp2 / sp3 hybridisation).
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {string} atomId
 * @returns {number}
 */
function _idealAngle(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return DEG120;
  }
  const degree = atom.bonds.length;
  // sp: triple bond or two cumulated double bonds → 180°
  const hasTriple = atom.bonds.some(bId =>
    (molecule.bonds.get(bId)?.properties.order ?? 1) === 3
  );
  if (hasTriple) {
    return Math.PI;
  }
  const twoDoubles = atom.bonds.filter(bId =>
    (molecule.bonds.get(bId)?.properties.order ?? 1) === 2
  ).length >= 2;
  if (twoDoubles) {
    return Math.PI;
  }
  // sp2: degree ≤ 3, any double bond or aromatic
  const hasDouble = atom.bonds.some(bId => {
    const b = molecule.bonds.get(bId);
    return b && ((b.properties.order ?? 1) === 2 || b.properties.aromatic);
  });
  if (hasDouble || degree <= 3) {
    return DEG120;
  }
  // sp3
  return Math.acos(-1 / 3); // ≈ 109.47°
}

/**
 * Analytic geometry refinement pass.
 *
 * For every ring attachment atom (in `frozen` with ≥1 non-ring substituent),
 * recomputes substituent positions analytically:
 *   1. Gather the exact angles to its ring-neighbour(s) from `coords`.
 *   2. Find the largest angular gap around the ring atom.
 *   3. Distribute the substituents evenly within that gap.
 *   4. Re-run layoutChain on each substituent's subtree from the new position.
 *
 * Ring atoms (in `frozen`) are never moved.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Map<string, Vec2>} coords
 * @param {Set<string>} frozen  - Atom IDs that must not move (ring atoms).
 * @param {number} bondLength
 */
function refineCoords(molecule, coords, frozen, bondLength) {
  // Helper: is an atom a hydrogen?
  const isH = id => molecule.atoms.get(id)?.name === 'H';

  const allAtomIds = new Set([...coords.keys()].filter(id => molecule.atoms.has(id)));

  // Helper: count the size of the non-frozen substituent subtree reachable from
  // `startId` without crossing ring atoms.  Used to order ring atoms so that
  // the ring atom with the largest/deepest substituent chain is processed first,
  // giving it natural (unforced) angular placement.
  function subtreeSize(startId) {
    const visited = new Set();
    const q = [startId];
    while (q.length > 0) {
      const cur = q.shift();
      if (visited.has(cur)) {
        continue;
      }
      visited.add(cur);
      for (const nb of _layoutNeighbors(molecule, cur)) {
        if (!frozen.has(nb) && !visited.has(nb) && allAtomIds.has(nb)) {
          q.push(nb);
        }
      }
    }
    return visited.size;
  }

  // Process ring atoms in descending order of their largest substituent subtree.
  // This ensures the most complex chain is placed first (at natural angles),
  // and subsequent chains use clash avoidance only where necessary.
  const frozenList = [...frozen].sort((a, b) => {
    const subA = _layoutNeighbors(molecule, a).filter(id => !frozen.has(id) && !isH(id) && allAtomIds.has(id));
    const subB = _layoutNeighbors(molecule, b).filter(id => !frozen.has(id) && !isH(id) && allAtomIds.has(id));
    const sizeA = subA.reduce((s, id) => s + subtreeSize(id), 0);
    const sizeB = subB.reduce((s, id) => s + subtreeSize(id), 0);
    return sizeB - sizeA; // descending: largest first
  });

  for (const atomId of frozenList) {
    const origin = coords.get(atomId);
    if (!origin) {
      continue;
    }
    const allNeighbors  = _layoutNeighbors(molecule, atomId).filter(id => allAtomIds.has(id));
    const ringNeighbors = allNeighbors.filter(id => frozen.has(id));
    // Only re-place heavy-atom substituents — H atoms in rings don't need correction.
    const subNeighbors  = allNeighbors.filter(id => !frozen.has(id) && !isH(id));
    if (subNeighbors.length === 0) {
      continue;
    }

    // Angles toward each ring neighbour.
    const ringAngles = ringNeighbors.map(id => angleTo(origin, coords.get(id)));
    ringAngles.sort((a, b) => a - b);

    // Find the largest angular gap between consecutive ring bonds.
    // Each gap is the CCW arc from ringAngles[i] to ringAngles[i+1],
    // always positive in (0, 2π].  The wrap-around gap closes from the
    // last angle back to the first (adding 2π so the difference is positive).
    let bestGapStart = ringAngles[ringAngles.length - 1];
    let bestGapSize  = ringAngles[0] - ringAngles[ringAngles.length - 1] + TWO_PI;
    for (let i = 0; i < ringAngles.length - 1; i++) {
      const gap = ringAngles[i + 1] - ringAngles[i]; // positive: sorted
      if (gap > bestGapSize) {
        bestGapSize = gap; bestGapStart = ringAngles[i];
      }
    }

    // Place substituents within the gap.
    // For exactly 2 substituents, centre them symmetrically around the gap
    // midpoint at ±60°, giving a 120° separation.  This matches the expected
    // tetrahedral projection for a quaternary ring atom and prevents the two
    // groups from appearing uncomfortably close (the naive even-division formula
    // gives only 80° separation on a 6-membered ring's 240° exterior gap).
    // For all other counts, divide the gap evenly.
    const nSub = subNeighbors.length;
    let proposedAngles;
    if (nSub === 2) {
      const midAngle = bestGapStart + bestGapSize / 2;
      proposedAngles = [
        normalizeAngle(midAngle - DEG60),
        normalizeAngle(midAngle + DEG60)
      ];
    } else {
      const step = bestGapSize / (nSub + 1);
      proposedAngles = Array.from({ length: nSub }, (_, i) =>
        normalizeAngle(bestGapStart + step * (i + 1))
      );
    }

    // Build ring polygon so the rotation loop can penalise ring-interior positions.
    // Without this, the loop can rotate substituents 180° into the ring interior
    // when there are few atom-atom clash constraints (e.g. after stripHydrogens).
    let ringPolyForLoop = null;
    if (frozen.size >= 3) {
      const pts = [...frozen].map(id => coords.get(id)).filter(Boolean);
      if (pts.length >= 3) {
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
        ringPolyForLoop = pts;
      }
    }

    // Apply clash avoidance: rotate all proposed positions in 30° increments
    // until the least-clashing rotation is chosen.
    const INC = Math.PI / 6;
    const rotSteps = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
    let finalAngles = proposedAngles;
    let bestClashes = Infinity;
    for (const k of rotSteps) {
      const candidate = proposedAngles.map(a => normalizeAngle(a + k * INC));
      let clashes = 0;
      for (const ang of candidate) {
        const p = project(origin, ang, bondLength);
        // Heavy penalty if the proposed position falls inside the ring polygon.
        if (ringPolyForLoop && pointInPolygon(p, ringPolyForLoop)) {
          clashes += 100;
        }
        for (const id of allAtomIds) {
          if (subNeighbors.includes(id)) {
            continue;
          }
          const c = coords.get(id);
          if (c && Math.hypot(c.x - p.x, c.y - p.y) < bondLength * 0.45) {
            clashes++; break;
          }
        }
      }
      if (clashes < bestClashes) {
        bestClashes = clashes; finalAngles = candidate;
      }
      if (bestClashes === 0) {
        break;
      }
    }

    // Re-place each substituent and re-layout its chain.
    for (let i = 0; i < subNeighbors.length; i++) {
      const subId  = subNeighbors[i];
      let   subAng = finalAngles[i];

      // Collect the subtree rooted at subId (no frozen atoms).
      const subtree = new Set();
      const q = [subId];
      while (q.length > 0) {
        const cur = q.shift();
        if (subtree.has(cur)) {
          continue;
        }
        subtree.add(cur);
        for (const nb of _layoutNeighbors(molecule, cur)) {
          if (!frozen.has(nb) && !subtree.has(nb) && allAtomIds.has(nb)) {
            q.push(nb);
          }
        }
      }

      // If subId is already anchored to a second ring atom at approximately the
      // correct bond length, it bridges two ring systems; re-placing it from
      // this ring's geometry would break the inter-ring chain, so skip.
      const subPos = coords.get(subId);
      if (subPos) {
        let anchored = false;
        for (const nb of _layoutNeighbors(molecule, subId)) {
          if (nb === atomId) {
            continue;
          }
          if (!frozen.has(nb)) {
            continue;
          } // only ring atoms can create an anchoring constraint
          const nbPos = coords.get(nb);
          if (nbPos) {
            const d = Math.hypot(subPos.x - nbPos.x, subPos.y - nbPos.y);
            if (d < bondLength * 1.3) {
              anchored = true; break;
            }
          }
        }
        if (anchored) {
          // For anchored inter-ring substituents, only re-place if there's a
          // hard clash (< 0.65 × BL) between an atom in the subtree and a
          // non-subtree atom.
          let hasSubtreeClash = false;
          for (const stId of subtree) {
            const stPos = coords.get(stId);
            if (!stPos) {
              continue;
            }
            for (const otherId of allAtomIds) {
              if (subtree.has(otherId) || otherId === atomId) {
                continue;
              }
              const otherPos = coords.get(otherId);
              if (otherPos && Math.hypot(stPos.x - otherPos.x, stPos.y - otherPos.y) < bondLength * 0.65) {
                hasSubtreeClash = true; break;
              }
            }
            if (hasSubtreeClash) {
              break;
            }
          }
          if (!hasSubtreeClash) {
            continue;
          }
        }
      }

      // Deep-clash check: scan all atoms in the already-placed (non-subtree)
      // portion of the molecule to see if any subtree atom sits within
      // 0.65 × BL of a non-subtree atom.  This catches clashes that appear
      // deeper than one bond from the ring (e.g. the ester carbonyl O of
      // aspirin overlapping with the carboxyl O of the adjacent substituent).
      {
        let hasSubtreeClash = false;
        for (const stId of subtree) {
          const stPos = coords.get(stId);
          if (!stPos) {
            continue;
          }
          for (const otherId of allAtomIds) {
            if (subtree.has(otherId) || otherId === atomId) {
              continue;
            }
            if (isH(otherId)) {
              continue;
            } // H positions don't trigger deep-clash
            const otherPos = coords.get(otherId);
            if (otherPos && Math.hypot(stPos.x - otherPos.x, stPos.y - otherPos.y) < bondLength * 0.65) {
              hasSubtreeClash = true; break;
            }
          }
          if (hasSubtreeClash) {
            break;
          }
        }

        if (hasSubtreeClash) {
          // Build the ring polygon (frozen atoms sorted by angle around centroid)
          // so we can penalise any trial position landing inside the ring.
          const ringPolyPts = [...frozen]
            .map(id => coords.get(id))
            .filter(Boolean);
          const ringCx = ringPolyPts.reduce((s, p) => s + p.x, 0) / (ringPolyPts.length || 1);
          const ringCy = ringPolyPts.reduce((s, p) => s + p.y, 0) / (ringPolyPts.length || 1);
          ringPolyPts.sort((a, b) =>
            Math.atan2(a.y - ringCy, a.x - ringCx) - Math.atan2(b.y - ringCy, b.x - ringCx));

          // Full-subtree simulation sweep: trial-layout the entire subtree for
          // each rotation candidate and select the angle that minimises the
          // number of subtree↔non-subtree hard clashes.
          const SIM_INC = Math.PI / 6;
          const simSteps = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, 6];
          const baseAng  = proposedAngles[i];
          let bestSimK = 0, bestSimClashes = Infinity;
          for (const k of simSteps) {
            const trialAng = normalizeAngle(baseAng + k * SIM_INC);
            const trialCoords = new Map();
            for (const [id, c] of coords) {
              if (!subtree.has(id)) {
                trialCoords.set(id, c);
              }
            }
            const trialPlaced = new Set(allAtomIds);
            for (const stId of subtree) {
              trialPlaced.delete(stId);
            }
            trialPlaced.add(atomId);
            layoutChain(molecule, atomId, normalizeAngle(trialAng + Math.PI),
              trialPlaced, bondLength, trialCoords, true);
            let clashCount = 0;
            for (const stId of subtree) {
              const stPos = trialCoords.get(stId);
              if (!stPos) {
                continue;
              }
              // Large penalty for any subtree atom placed inside the ring polygon.
              if (pointInPolygon(stPos, ringPolyPts)) {
                clashCount += 100; continue;
              }
              for (const otherId of allAtomIds) {
                if (subtree.has(otherId) || otherId === atomId) {
                  continue;
                }
                // Count only heavy-atom clashes — H positions are flexible
                // and must not block the correct exo-ring direction.  Without
                // this guard, H atoms of adjacent substituents near the ideal
                // outward direction cause false clashes, making the simulation
                // choose the ring-interior direction instead.
                if (isH(otherId)) {
                  continue;
                }
                const otherPos = trialCoords.get(otherId);
                if (otherPos && Math.hypot(stPos.x - otherPos.x, stPos.y - otherPos.y) < bondLength * 0.65) {
                  clashCount++;
                }
              }
            }
            if (clashCount < bestSimClashes) {
              bestSimClashes = clashCount; bestSimK = k;
            }
            if (bestSimClashes === 0) {
              break;
            }
          }
          subAng = normalizeAngle(baseAng + bestSimK * SIM_INC);
        }
      }

      coords.set(subId, project(origin, subAng, bondLength));

      // Build a placed set: everything except the subtree (but including atomId).
      const chainPlaced = new Set(allAtomIds);
      for (const id of subtree) {
        chainPlaced.delete(id);
      }
      chainPlaced.add(atomId);

      // Remove old subtree coords so steric-clash checks in layoutChain
      // don't see stale positions from the previous layout pass.
      for (const id of subtree) {
        coords.delete(id);
      }

      // Re-layout from atomId outward through subId.
      layoutChain(
        molecule, atomId,
        normalizeAngle(subAng + Math.PI),
        chainPlaced, bondLength, coords, true
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Force-field relaxation (Phase G)
// ---------------------------------------------------------------------------

/**
 * 2D molecular-mechanics force-field relaxation, inspired by ChemDraw's
 * "Clean Up Structure" algorithm.
 *
 * Three pairwise potentials are applied in each gradient-descent step:
 *
 *  1. **Bond-length springs**    – harmonic spring along every bond,
 *     restoring to `bondLength`.
 *  2. **Bond-angle bending**    – for every atom with ≥2 neighbours, a
 *     harmonic spring on each bond-angle pair, restoring to the ideal angle
 *     (180° for sp, 120° everywhere else in a 2D depiction).
 *  3. **Non-bonded repulsion**  – soft-wall (1/r³) repulsion between every
 *     pair of heavy atoms that are not bonded (1-2) or angle-neighbours (1-3),
 *     acting inside a distance cut-off of 2.2 × bondLength.
 *
 * Ring atoms (`frozen`) are held fixed throughout.  The integrator runs up to
 * `MAX_ITER` damped gradient-descent steps; it exits early once the maximum
 * per-atom displacement drops below `CONVERGE`.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Map<string, Vec2>} coords   – mutated in-place
 * @param {Set<string>} frozen         – atom IDs that must not move (ring atoms)
 * @param {number} bondLength
 */
function forceFieldRefine(molecule, coords, frozen, bondLength, allRingAtoms = new Set()) {
  const K_BOND   = 8.0;                  // bond-length spring constant
  const K_ANGLE  = 2.5;                  // angle-bending constant
  const K_REP    = 2.0;                  // non-bonded repulsion scale
  // Cutoff of 2.0×BL catches 1-4 pairs in compressed geometry while
  // remaining below the 1-4 distance at ideal 120° angles (~2.6×BL).
  // 1-3 pairs are always excluded via ex13, so their distance (~1.73×BL)
  // does not interfere.  A wider cutoff is essential for large macrocycles
  // where many side chains start in close proximity.
  const REP_CUT  = bondLength * 2.0;     // repulsion interaction cutoff (Å)
  const MAX_STEP = bondLength * 0.25;    // per-atom displacement clamp per step
  const CONVERGE = bondLength * 5e-3;    // convergence threshold
  const K_POS = 1.5;                     // position spring for large-ring atoms (prevents collapse)
  const isLargeRingAtom = id => allRingAtoms.has(id) && !frozen.has(id);

  const isH = id => molecule.atoms.get(id)?.name === 'H';

  // Identify movable atoms: in coords, not frozen, not hydrogen.
  const movArr = [...coords.keys()].filter(
    id => molecule.atoms.has(id) && !frozen.has(id) && !isH(id)
  );
  if (movArr.length === 0) {
    return;
  }

  // Capture initial positions and backbone angles for large-ring atoms.
  // initPos feeds the position springs; initAngles feeds the angle springs
  // (we spring toward the ring's own initial geometry rather than 120°,
  // which would contract a large ring whose interior angle is ~170°+).
  const initPos = new Map();
  for (const id of movArr) {
    if (isLargeRingAtom(id)) {
      const c = coords.get(id);
      if (c) {
        initPos.set(id, { x: c.x, y: c.y });
      }
    }
  }

  // Index map for fast force-array access.
  const idxOf = new Map(movArr.map((id, i) => [id, i]));

  // All non-hydrogen heavy atoms (used as repulsion targets, includes frozen).
  // (Declared early so initAngles can use nb12 built below.)
  // Note: heavyArr and nb12/nb13 are also declared later; this block is pre-pass.
  {
    // Temporary nb12 for initAngles computation only.
    const _nb12tmp = new Map();
    for (const id of [...coords.keys()].filter(i => molecule.atoms.has(i) && molecule.atoms.get(i).name !== 'H')) {
      _nb12tmp.set(id, new Set());
    }
    for (const bond of molecule.bonds.values()) {
      const a = bond.atoms[0], b = bond.atoms[1];
      _nb12tmp.get(a)?.add(b);
      _nb12tmp.get(b)?.add(a);
    }
    // Pre-compute initial backbone angles for large ring atoms.
    // Key: `${cId},${bId},${dId}` → angle (radians).
    forceFieldRefine._initAngles = new Map();
    for (const id of movArr) {
      if (!isLargeRingAtom(id)) {
        continue;
      }
      const p0c = initPos.get(id); if (!p0c) {
        continue;
      }
      const nbs = [...(_nb12tmp.get(id) ?? [])].filter(n => isLargeRingAtom(n));
      for (let ii = 0; ii < nbs.length; ii++) {
        for (let jj = ii + 1; jj < nbs.length; jj++) {
          const bId = nbs[ii], dId = nbs[jj];
          const p0b = initPos.get(bId), p0d = initPos.get(dId);
          if (!p0b || !p0d) {
            continue;
          }
          const ubx = p0b.x - p0c.x, uby = p0b.y - p0c.y;
          const udx = p0d.x - p0c.x, udy = p0d.y - p0c.y;
          const rb = Math.hypot(ubx, uby) || 1e-9;
          const rd = Math.hypot(udx, udy) || 1e-9;
          const cosT0 = Math.max(-1, Math.min(1, (ubx * udx + uby * udy) / (rb * rd)));
          const ang = Math.acos(cosT0);
          forceFieldRefine._initAngles.set(`${id},${bId},${dId}`, ang);
          forceFieldRefine._initAngles.set(`${id},${dId},${bId}`, ang);
        }
      }
    }
  }
  const initAngles = forceFieldRefine._initAngles;

  // All non-hydrogen heavy atoms (used as repulsion targets, includes frozen).
  const heavyArr = [...coords.keys()].filter(id => molecule.atoms.has(id) && !isH(id));

  // Build 1-2 (direct bond) and 1-3 (angle) neighbour sets.
  // 1-3 pairs are excluded from non-bonded repulsion to avoid fighting the
  // angle spring at ideal geometry.
  const nb12 = new Map();
  for (const id of heavyArr) {
    nb12.set(id, new Set());
  }
  for (const bond of molecule.bonds.values()) {
    const a = bond.atoms[0], b = bond.atoms[1];
    nb12.get(a)?.add(b);
    nb12.get(b)?.add(a);
  }
  const nb13 = new Map();
  for (const id of heavyArr) {
    const s = new Set();
    for (const nb of (nb12.get(id) ?? [])) {
      for (const nb2 of (nb12.get(nb) ?? [])) {
        if (nb2 !== id) {
          s.add(nb2);
        }
      }
    }
    nb13.set(id, s);
  }

  // Ideal interior bond angle for a given central atom.
  // 180° for sp (triple bond or two cumulated double bonds), 120° otherwise.
  function idealBondAngle(atomId) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      return DEG120;
    }
    if (atom.bonds.some(bId => (molecule.bonds.get(bId)?.properties.order ?? 1) === 3)) {
      return Math.PI;
    }
    // Allene center: two cumulated double bonds → sp, 180°
    if (atom.bonds.filter(bId => (molecule.bonds.get(bId)?.properties.order ?? 1) === 2).length >= 2) {
      return Math.PI;
    }
    return DEG120;
  }

  // Scale iteration count with molecule size so large macropeptides converge.
  const MAX_ITER = Math.max(200, movArr.length * 5);

  // Typed arrays for force accumulation — avoids Map overhead per iteration.
  const fx = new Float64Array(movArr.length);
  const fy = new Float64Array(movArr.length);

  let dt = 0.35; // step damping factor

  for (let iter = 0; iter < MAX_ITER; iter++) {
    fx.fill(0);
    fy.fill(0);

    // ------------------------------------------------------------------ //
    // 1. Bond-length springs (heavy atoms only — skip C-H bonds)           //
    // ------------------------------------------------------------------ //
    for (const bond of molecule.bonds.values()) {
      const aId = bond.atoms[0], bId = bond.atoms[1];
      if (isH(aId) || isH(bId)) {
        continue;
      }  // ignore H bonds
      const ca  = coords.get(aId), cb = coords.get(bId);
      if (!ca || !cb) {
        continue;
      }
      const movA = idxOf.has(aId), movB = idxOf.has(bId);
      if (!movA && !movB) {
        continue;
      }

      const dx = cb.x - ca.x, dy = cb.y - ca.y;
      const d  = Math.hypot(dx, dy) || 1e-9;
      // Asymmetric spring: stiffer under compression (d < BL) so angle-spring
      // forces can never collapse a bond.  Above BL behaves as a linear spring.
      const compress = d < bondLength ? bondLength / d : 1.0;
      const s  = K_BOND * compress * (d - bondLength) / d;
      const Fx = s * dx, Fy = s * dy;

      if (movA) {
        const i = idxOf.get(aId); fx[i] += Fx; fy[i] += Fy;
      }
      if (movB) {
        const i = idxOf.get(bId); fx[i] -= Fx; fy[i] -= Fy;
      }
    }

    // ------------------------------------------------------------------ //
    // 2. Bond-angle bending (heavy-atom angles only)                       //
    // ------------------------------------------------------------------ //
    // Iterate every heavy atom as a potential angle-centre; ring atoms can
    // be centres even though they don't move — they pull their movable
    // substituents to the correct angle.
    for (const cId of heavyArr) {
      const center = coords.get(cId);
      if (!center) {
        continue;
      }
      // Only include heavy-atom neighbours — excludes H from angle terms,
      // preventing spurious forces from C-H vs C-H angle optimisation.
      const nbs   = [...(nb12.get(cId) ?? [])].filter(n => coords.has(n) && !isH(n));
      if (nbs.length < 2) {
        continue;
      }

      const ideal  = idealBondAngle(cId);

      for (let i = 0; i < nbs.length - 1; i++) {
        for (let j = i + 1; j < nbs.length; j++) {
          const bId = nbs[i], dId = nbs[j];
          const cb  = coords.get(bId), cd = coords.get(dId);

          // Unit vectors from centre to each neighbour.
          let ubx = cb.x - center.x, uby = cb.y - center.y;
          let udx = cd.x - center.x, udy = cd.y - center.y;
          const rb = Math.hypot(ubx, uby) || 1e-9;
          const rd = Math.hypot(udx, udy) || 1e-9;
          ubx /= rb; uby /= rb;
          udx /= rd; udy /= rd;

          const cosT  = Math.max(-1, Math.min(1, ubx * udx + uby * udy));
          const theta = Math.acos(cosT);
          // For backbone triples entirely within a large ring, spring toward the
          // ring's own initial geometry (not 120°).  A 53-atom ring has interior
          // angles ~173°; forcing 120° would severely contract the backbone.
          const backboneInitAng = (isLargeRingAtom(cId) && isLargeRingAtom(bId) && isLargeRingAtom(dId))
            ? (initAngles.get(`${cId},${bId},${dId}`) ?? null) : null;
          const delta = theta - (backboneInitAng !== null ? backboneInitAng : ideal);
          if (Math.abs(delta) < 1e-8) {
            continue;
          }

          const sinT = Math.sin(theta);
          // Skip near-linear angles (theta ≈ 0° or 180°) where sinT ≈ 0
          // would make K blow up.  These degenerate triplets arise when the
          // initial chain placement is perfectly straight (e.g., C26-N27-C28
          // at 180°).  Skipping lets numerical drift move them away from the
          // singularity in subsequent iterations, after which forces are
          // correctly computed.
          if (Math.abs(sinT) < 0.05) {
            continue;
          }
          const K    = K_ANGLE * delta / sinT;

          // Analytical gradient: F_b = K * (ud - cosT*ub) / rb
          const Fbx = K * (udx - cosT * ubx) / rb;
          const Fby = K * (udy - cosT * uby) / rb;
          // F_d = K * (ub - cosT*ud) / rd
          const Fdx = K * (ubx - cosT * udx) / rd;
          const Fdy = K * (uby - cosT * udy) / rd;

          if (idxOf.has(bId)) {
            const ii = idxOf.get(bId); fx[ii] += Fbx; fy[ii] += Fby;
          }
          if (idxOf.has(dId)) {
            const ii = idxOf.get(dId); fx[ii] += Fdx; fy[ii] += Fdy;
          }
          // Note: we deliberately do NOT apply Newton's 3rd to the centre
          // atom.  The angle-spring forces on b and d are purely tangential
          // (perpendicular to the respective bonds), so they correctly rotate
          // the endpoints around the centre without compressing the bonds.
          // Applying the reaction force to a movable centre would push it
          // toward one endpoint, collapsing the bond — observed for the
          // guanidinium (C28) and similar trifurcated atoms.
        }
      }
    }

    // ------------------------------------------------------------------ //
    // 3. Non-bonded repulsion                                              //
    // ------------------------------------------------------------------ //
    for (let i = 0; i < movArr.length; i++) {
      const aId  = movArr[i];
      const ca   = coords.get(aId);
      const ex12 = nb12.get(aId);
      const ex13 = nb13.get(aId);

      for (const bId of heavyArr) {
        if (bId === aId || ex12?.has(bId) || ex13?.has(bId)) {
          continue;
        }
        const cb = coords.get(bId);
        const dx = ca.x - cb.x, dy = ca.y - cb.y;
        const d  = Math.hypot(dx, dy) || 1e-9;
        if (d >= REP_CUT) {
          continue;
        }

        // Soft-wall: F = K_REP * (BL/d)³ / d (points away from b).
        const r = bondLength / d;
        const F = K_REP * r * r * r / d;
        fx[i] += F * dx;
        fy[i] += F * dy;
      }
    }

    // ------------------------------------------------------------------ //
    // 4. Position springs for large-ring atoms (prevent collapse while     //
    //    allowing the macrocycle to reshape around dense side chains).     //
    // ------------------------------------------------------------------ //
    for (let i = 0; i < movArr.length; i++) {
      const p0 = initPos.get(movArr[i]);
      if (!p0) {
        continue;
      }
      const c = coords.get(movArr[i]);
      fx[i] += K_POS * (p0.x - c.x);
      fy[i] += K_POS * (p0.y - c.y);
    }

    // ------------------------------------------------------------------ //
    // 5. Integrate (damped gradient descent with per-atom displacement cap)//
    // ------------------------------------------------------------------ //
    let maxDisp = 0;
    for (let i = 0; i < movArr.length; i++) {
      let dx = dt * fx[i], dy = dt * fy[i];
      const disp = Math.hypot(dx, dy);
      if (disp > MAX_STEP) {
        const s = MAX_STEP / disp; dx *= s; dy *= s;
      }
      const c = coords.get(movArr[i]);
      coords.set(movArr[i], { x: c.x + dx, y: c.y + dy });
      const actual = Math.min(disp, MAX_STEP);
      if (actual > maxDisp) {
        maxDisp = actual;
      }
    }

    if (maxDisp < CONVERGE) {
      break;
    }
    // Gentle step-size decay after the initial transient.
    // Decay starts at iter=50; floor of 0.10 keeps the integrator active
    // long enough to resolve clashes in large macrocycles.
    if (iter >= 50) {
      dt = Math.max(0.10, dt * 0.998);
    }
  }

}

// ---------------------------------------------------------------------------
// Canonical orientation — rotate so principal axis is horizontal
// ---------------------------------------------------------------------------

/**
 * Rotates all atoms in `coords` so the principal axis (direction of maximum
 * spatial spread, computed via the 2D inertia tensor) is horizontal.
 *
 * Only applied when there are ≥2 heavy atoms with distinct positions.
 * Acyclic chains already have a natural horizontal layout from the DFS
 * zigzag and must NOT be rotated (their bond-length exactness depends on
 * the fixed geometry).  So the caller is responsible for only invoking this
 * when appropriate (currently: ring-containing molecules only).
 *
 * @param {Map<string, Vec2>} coords  – mutated in-place
 * @param {import('../core/Molecule.js').Molecule} molecule
 */
function normalizeOrientation(coords, molecule) {
  if (coords.size < 2) {
    return;
  }

  const preferredBackbone = findPreferredBackbonePath(molecule);
  if (preferredBackbone &&
      preferredBackbone.ringCount === 0 &&
      preferredBackbone.path.length >= 8) {
    const start = coords.get(preferredBackbone.path[0]);
    const end = coords.get(preferredBackbone.path[preferredBackbone.path.length - 1]);
    if (start && end) {
      const ang = Math.atan2(end.y - start.y, end.x - start.x);
      if (Math.abs(ang) >= 1e-6) {
        const heavyIds = [...coords.keys()].filter(
          id => molecule.atoms.has(id) && molecule.atoms.get(id).name !== 'H'
        );
        let sx = 0;
        let sy = 0;
        for (const id of heavyIds) {
          const p = coords.get(id);
          sx += p.x;
          sy += p.y;
        }
        rotateCoords(coords, vec2(sx / heavyIds.length, sy / heavyIds.length), -ang);
      }
      return;
    }
  }

  // Only include heavy (non-H) atoms in the inertia calculation so that
  // explicit hydrogens — placed radially, often asymmetrically — do not
  // distort the principal axis of the heavy-atom skeleton.
  const heavyIds = [...coords.keys()].filter(
    id => molecule.atoms.has(id) && molecule.atoms.get(id).name !== 'H'
  );
  if (heavyIds.length < 2) {
    return;
  }

  // Centroid of heavy atoms.
  let sx = 0, sy = 0;
  for (const id of heavyIds) {
    const p = coords.get(id); sx += p.x; sy += p.y;
  }
  const cx = sx / heavyIds.length, cy = sy / heavyIds.length;

  // 2D inertia tensor (relative to centroid).
  // Ixx = Σ dy², Iyy = Σ dx², Ixy = -Σ dx·dy
  let Ixx = 0, Iyy = 0, Ixy = 0;
  for (const id of heavyIds) {
    const p  = coords.get(id);
    const dx = p.x - cx, dy = p.y - cy;
    Ixx += dy * dy;
    Iyy += dx * dx;
    Ixy -= dx * dy;
  }

  // The formula `angle0 = 0.5·atan2(2·Ixy, Ixx−Iyy)` gives a critical point of
  // I(θ) = Ixx·cos²θ + Iyy·sin²θ + Ixy·sin2θ (inertia about axis at θ).
  // That critical point may be either the minimum or maximum; we evaluate
  // both candidates and select the one with smaller I (elongation axis).
  // The elongation axis is then normalised to (−π/2, π/2] to minimise the
  // rotation magnitude, and all atoms are rotated to align it with X.
  const angle0 = 0.5 * Math.atan2(2 * Ixy, Ixx - Iyy);
  const I0 = Ixx * Math.cos(angle0) ** 2 + Iyy * Math.sin(angle0) ** 2
             + Ixy * Math.sin(2 * angle0); // correct sign: I(θ) = Ixx·c² + Iyy·s² + Ixy·sin2θ
  const I1 = Ixx + Iyy - I0; // trace is invariant
  // Pick the candidate with smaller inertia = elongation direction.
  let elon = I0 <= I1 ? angle0 : angle0 + Math.PI / 2;
  // Normalise to (−π/2, π/2]: axes at θ and θ+π are identical, so prefer |θ| ≤ π/2.
  if (elon >  Math.PI / 2) {
    elon -= Math.PI;
  }
  if (elon <= -Math.PI / 2) {
    elon += Math.PI;
  }

  if (Math.abs(elon) > 1e-6) {
    // Rotate ALL atoms (including H) about the heavy-atom centroid so the
    // elongation axis becomes horizontal.
    const cosA = Math.cos(-elon), sinA = Math.sin(-elon);
    // Collect all entries first so Map mutation doesn't affect the traversal.
    const entries = [...coords.entries()];
    for (const [id, pos] of entries) {
      const dx = pos.x - cx, dy = pos.y - cy;
      coords.set(id, vec2(cx + dx * cosA - dy * sinA,
        cy + dx * sinA + dy * cosA));
    }
  }

  // Portrait-to-landscape guard: the inertia tensor guarantees the principal
  // axis is aligned with X, but for nearly isotropic ring systems (I0 ≈ I1)
  // it can pick the wrong candidate and leave the molecule taller than wide.
  // Explicitly rotate 90° whenever the heavy-atom bounding box is portrait.
  {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of heavyIds) {
      const p = coords.get(id);
      if (!p) {
        continue;
      }
      if (p.x < minX) {
        minX = p.x;
      }
      if (p.x > maxX) {
        maxX = p.x;
      }
      if (p.y < minY) {
        minY = p.y;
      }
      if (p.y > maxY) {
        maxY = p.y;
      }
    }
    if (maxY - minY > maxX - minX) {
      rotateCoords(coords, vec2(cx, cy), Math.PI / 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Bond-angle leveling — snap to each bond's natural angular grid
// ---------------------------------------------------------------------------

/**
 * Applies a corrective rotation so that bond directions align as closely as
 * possible to the natural angular grid of each bond's ring system.
 *
 * Each bond carries its own grid increment:
 *   - Ring bond in a ring of size n  →  π / n  (e.g. 30° for 6-ring, 36° for 5-ring)
 *   - Bond shared by multiple rings  →  minimum of the containing rings' grids
 *     (the most restrictive constraint wins)
 *   - Chain bond (no ring)           →  π / 6 (30°, standard zigzag)
 *
 * The optimal rotation is found by evaluating every candidate that would snap
 * at least one bond exactly onto its grid, then selecting the one that minimises
 * the total squared deviation across all bonds.  This is exact and works for
 * any ring size or mixture of ring sizes without special-casing.
 *
 * @param {Map<string,{x:number,y:number}>} coords
 * @param {import('../core/Molecule.js').Molecule} molecule
 */
function levelCoords(coords, molecule) {
  const heavyIds = [...coords.keys()].filter(
    id => molecule.atoms.has(id) && molecule.atoms.get(id)?.name !== 'H'
  );
  if (heavyIds.length < 2) {
    return;
  }

  // Assign each ring bond its natural grid increment (π / ring_size).
  // For bonds shared by multiple rings use the smallest increment (tightest fit).
  const bondGrid = new Map(); // bondId → grid increment (radians)
  for (const ring of molecule.getRings()) {
    const inc = Math.PI / ring.length;
    for (let i = 0; i < ring.length; i++) {
      const bond = molecule.getBond(ring[i], ring[(i + 1) % ring.length]);
      if (!bond) {
        continue;
      }
      const existing = bondGrid.get(bond.id);
      if (existing === undefined || inc < existing) {
        bondGrid.set(bond.id, inc);
      }
    }
  }

  // Collect each heavy-atom bond's direction and natural grid.
  const bondData = []; // { angle, inc }
  const seenBonds = new Set();
  for (const id of heavyIds) {
    const a = coords.get(id);
    if (!a) {
      continue;
    }
    const atom = molecule.atoms.get(id);
    if (!atom) {
      continue;
    }
    for (const bondId of atom.bonds) {
      if (seenBonds.has(bondId)) {
        continue;
      }
      seenBonds.add(bondId);
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherId = bond.getOtherAtom(id);
      if (!otherId || molecule.atoms.get(otherId)?.name === 'H') {
        continue;
      }
      const b = coords.get(otherId);
      if (!b) {
        continue;
      }
      // Direction in [0, π) — bonds are undirected.
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle < 0) {
        angle += Math.PI;
      }
      if (angle >= Math.PI) {
        angle -= Math.PI;
      }
      bondData.push({ angle, inc: bondGrid.get(bondId) ?? (Math.PI / 6) });
    }
  }

  if (bondData.length === 0) {
    return;
  }

  // Score a candidate rotation: sum of squared deviations of (angle + rotation)
  // from the nearest multiple of each bond's grid increment, plus a small
  // regularization term proportional to r².  The regularization breaks ties
  // in favour of smaller corrections — without it, a 90° rotation of a steroid
  // scores identically to 0° (bonds at 0°/60°/120° and 90°/150°/30° are both
  // on the 30° grid) and can be chosen over no rotation, undoing the horizontal
  // alignment that normalizeOrientation established.
  const TILT_PENALTY = 1e-4;
  function score(r) {
    let total = 0;
    for (const { angle, inc } of bondData) {
      let a = ((angle + r) % inc + inc) % inc; // map into [0, inc)
      if (a > inc / 2) {
        a -= inc; // signed offset in (−inc/2, inc/2]
      }
      total += a * a;
    }
    return total + TILT_PENALTY * r * r;
  }

  // Candidate rotations: for each bond, the rotation(s) that would snap it
  // exactly to a grid multiple (nearest neighbour ± 1 to avoid edge-case misses).
  const candidates = new Set([0]);
  for (const { angle, inc } of bondData) {
    const k = Math.round(angle / inc);
    for (let dk = -1; dk <= 1; dk++) {
      // Normalise to (−π/2, π/2]: rotating by r is identical to r+π for
      // undirected bonds, so always prefer the smaller-magnitude rotation.
      let r = (k + dk) * inc - angle;
      r = r - Math.PI * Math.round(r / Math.PI);
      candidates.add(r);
    }
  }

  let bestRotation = 0;
  let bestScore = score(0);
  for (const r of candidates) {
    const s = score(r);
    if (s < bestScore - 1e-10) {
      bestScore = s;
      bestRotation = r;
    }
  }

  if (Math.abs(bestRotation) < 0.5 * Math.PI / 180) {
    return; // < 0.5° — not worth touching
  }

  // Rotate all atoms about the heavy-atom centroid.
  let sx = 0, sy = 0;
  for (const id of heavyIds) {
    const p = coords.get(id);
    sx += p.x;
    sy += p.y;
  }
  rotateCoords(coords, vec2(sx / heavyIds.length, sy / heavyIds.length), bestRotation);
}

function findPreferredBackbonePath(molecule) {
  const heavyIds = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H');
  if (heavyIds.length < 2) {
    return null;
  }

  const ringAtoms = new Set(molecule.getRings().flat());
  let best = null;

  for (const startId of heavyIds) {
    const prev = new Map([[startId, null]]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const nb of _layoutNeighbors(molecule, cur)) {
        if (molecule.atoms.get(nb)?.name === 'H' || prev.has(nb)) {
          continue;
        }
        prev.set(nb, cur);
        queue.push(nb);
      }
    }

    for (const endId of heavyIds) {
      if (endId === startId || !prev.has(endId)) {
        continue;
      }
      const path = [];
      for (let cur = endId; cur != null; cur = prev.get(cur)) {
        path.push(cur);
      }
      path.reverse();

      const ringCount = path.filter(id => ringAtoms.has(id)).length;
      const score = path.length - ringCount * 0.6;
      if (!best ||
          score > best.score ||
          (score === best.score && ringCount < best.ringCount) ||
          (score === best.score && ringCount === best.ringCount && path.length > best.path.length)) {
        best = { path, ringCount, score };
      }
    }
  }

  return best;
}

function backboneTurnSign(coords, aId, bId, cId) {
  return turnSignFromPoints(coords.get(aId), coords.get(bId), coords.get(cId));
}

function straightenPreferredBackbone(molecule, coords, pathInfo) {
  if (!pathInfo) {
    return false;
  }

  const heavyCount = [...molecule.atoms.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H').length;
  if (pathInfo.ringCount !== 0 || pathInfo.path.length < 8 || pathInfo.path.length < Math.ceil(heavyCount * 0.45)) {
    return false;
  }

  let previousSign = null;
  for (let i = 1; i < pathInfo.path.length - 1; i++) {
    const centerId = pathInfo.path[i];
    if (molecule.atoms.get(centerId)?.name === 'H') {
      continue;
    }

    let sign = backboneTurnSign(coords, pathInfo.path[i - 1], centerId, pathInfo.path[i + 1]);
    if (sign === 0) {
      continue;
    }
    if (previousSign == null) {
      previousSign = sign;
      continue;
    }

    const desiredSign = -previousSign;
    if (sign !== desiredSign) {
      const fixedA = coords.get(pathInfo.path[i - 1]);
      const fixedB = coords.get(centerId);
      if (fixedA && fixedB) {
        const suffixAtoms = collectSideAtoms(molecule, centerId, pathInfo.path[i - 1]);
        for (const atomId of suffixAtoms) {
          const pos = coords.get(atomId);
          if (pos) {
            coords.set(atomId, _reflectPoint(pos, fixedA, fixedB));
          }
        }
      }
      sign = backboneTurnSign(coords, pathInfo.path[i - 1], centerId, pathInfo.path[i + 1]);
    }
    previousSign = sign === 0 ? desiredSign : sign;
  }

  return true;
}

function collectSideAtoms(molecule, startId, blockedId) {
  const side = new Set();
  const queue = [startId];
  const seen = new Set([blockedId]);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (seen.has(cur)) {
      continue;
    }
    seen.add(cur);
    side.add(cur);
    for (const nb of _layoutNeighbors(molecule, cur)) {
      if (!seen.has(nb)) {
        queue.push(nb);
      }
    }
  }
  return side;
}

function highestPriorityAlkeneSubstituentId(molecule, sp2Id, otherSp2Id) {
  const neighborIds = _layoutNeighbors(molecule, sp2Id).filter(id => id !== otherSp2Id);
  if (neighborIds.length === 0) {
    return null;
  }

  const ranks = assignCIPRanks(sp2Id, neighborIds, molecule);
  let bestId = null;
  let bestRank = -Infinity;
  let bestCount = 0;

  for (let i = 0; i < neighborIds.length; i++) {
    const rank = ranks[i] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      bestId = neighborIds[i];
      bestCount = 1;
    } else if (rank === bestRank) {
      bestCount++;
    }
  }

  return bestCount === 1 ? bestId : null;
}

function actualAlkeneStereoFromCoords(molecule, coords, bond) {
  const [aId, bId] = bond.atoms;
  const aPos = coords.get(aId);
  const bPos = coords.get(bId);
  if (!aPos || !bPos) {
    return null;
  }

  const aSubId = highestPriorityAlkeneSubstituentId(molecule, aId, bId);
  const bSubId = highestPriorityAlkeneSubstituentId(molecule, bId, aId);
  if (!aSubId || !bSubId) {
    return null;
  }

  const aSubPos = coords.get(aSubId);
  const bSubPos = coords.get(bSubId);
  if (!aSubPos || !bSubPos) {
    return null;
  }

  const dx = bPos.x - aPos.x;
  const dy = bPos.y - aPos.y;
  const crossA = dx * (aSubPos.y - aPos.y) - dy * (aSubPos.x - aPos.x);
  const crossB = dx * (bSubPos.y - bPos.y) - dy * (bSubPos.x - bPos.x);
  if (Math.abs(crossA) < 1e-6 || Math.abs(crossB) < 1e-6) {
    return null;
  }

  return Math.sign(crossA) === Math.sign(crossB) ? 'Z' : 'E';
}

function enforceAcyclicEZStereo(molecule, coords) {
  const ringAtomIds = new Set(molecule.getRings().flat());

  for (const bond of molecule.bonds.values()) {
    if (bond.properties.aromatic || (bond.properties.order ?? 1) !== 2) {
      continue;
    }

    const targetStereo = molecule.getEZStereo(bond.id);
    if (targetStereo == null) {
      continue;
    }

    const [aId, bId] = bond.atoms;
    if (ringAtomIds.has(aId) || ringAtomIds.has(bId)) {
      continue;
    }

    const actualStereo = actualAlkeneStereoFromCoords(molecule, coords, bond);
    if (actualStereo == null || actualStereo === targetStereo) {
      continue;
    }

    const sideA = collectSideAtoms(molecule, aId, bId);
    const sideB = collectSideAtoms(molecule, bId, aId);
    const primarySide = countHeavyAtoms(molecule, sideA) <= countHeavyAtoms(molecule, sideB) ? sideA : sideB;
    const fallbackSide = primarySide === sideA ? sideB : sideA;

    for (const side of [primarySide, fallbackSide]) {
      const reflected = reflectSubtreeCoords(coords, side, aId, bId);
      for (const [atomId, pos] of reflected) {
        coords.set(atomId, pos);
      }
      if (actualAlkeneStereoFromCoords(molecule, coords, bond) === targetStereo) {
        break;
      }
    }
  }
}

function optimizeAcyclicMultipleBondSubtrees(molecule, coords, bondLength) {
  const isH = id => molecule.atoms.get(id)?.name === 'H';
  const heavyDegree = id => _layoutNeighbors(molecule, id).filter(nb => !isH(nb)).length;
  const deltas = [0, -Math.PI / 3, -Math.PI / 6, Math.PI / 6, Math.PI / 3];

  const scoreRotation = (pivotId, movingId, sideAtoms, rotatedCoords, delta) => {
    let score = Math.abs(delta) * 0.25;
    const pivotPos = coords.get(pivotId);
    const movingPos = rotatedCoords.get(movingId);
    if (!pivotPos || !movingPos) {
      return Infinity;
    }

    const bondedToPivot = new Set(_layoutNeighbors(molecule, pivotId));
    const bondedToMoving = new Set(_layoutNeighbors(molecule, movingId));
    const nearThresh = bondLength * 0.90;
    const clashThresh = bondLength * 0.65;

    for (const [movedId, movedPos] of rotatedCoords) {
      const movedAtom = molecule.atoms.get(movedId);
      if (!movedAtom || movedAtom.name === 'H') {
        continue;
      }
      for (const [otherId, otherPos] of coords) {
        if (sideAtoms.has(otherId) || !otherPos) {
          continue;
        }
        const otherAtom = molecule.atoms.get(otherId);
        if (!otherAtom || otherAtom.name === 'H') {
          continue;
        }
        if (movedId === movingId && otherId === pivotId) {
          continue;
        }

        const dist = Math.hypot(movedPos.x - otherPos.x, movedPos.y - otherPos.y);
        if (dist < clashThresh) {
          score += 200 + (clashThresh - dist) * 200;
        } else if (dist < nearThresh) {
          score += (nearThresh - dist) * 12;
        }
      }
    }

    for (const [otherId, otherPos] of coords) {
      if (!otherPos || sideAtoms.has(otherId) || otherId === pivotId || otherId === movingId) {
        continue;
      }
      if (bondedToPivot.has(otherId) || bondedToMoving.has(otherId)) {
        continue;
      }
      const otherAtom = molecule.atoms.get(otherId);
      if (!otherAtom || otherAtom.name === 'H') {
        continue;
      }
      const thresh = otherAtom.name === 'C' ? bondLength * 0.30 : bondLength * 0.50;
      const dist = pointToSegmentDistance(otherPos, pivotPos, movingPos);
      if (dist < thresh) {
        score += otherAtom.name === 'C' ? 4 : 20;
        score += (thresh - dist) * (otherAtom.name === 'C' ? 8 : 40);
      }
    }

    return score;
  };

  for (const [, bond] of molecule.bonds) {
    const order = bond.properties.order ?? 1;
    if (bond.properties.aromatic || order < 2) {
      continue;
    }

    const [aId, bId] = bond.atoms;
    const aSide = collectSideAtoms(molecule, aId, bId);
    const bSide = collectSideAtoms(molecule, bId, aId);
    const candidates = [
      { pivotId: aId, movingId: bId, sideAtoms: bSide },
      { pivotId: bId, movingId: aId, sideAtoms: aSide }
    ].filter(({ pivotId, movingId, sideAtoms }) =>
      coords.has(pivotId) &&
      coords.has(movingId) &&
      sideAtoms.size > 1 &&
      sideAtoms.size <= molecule.atomCount - sideAtoms.size &&
      heavyDegree(movingId) > 1
    );

    for (const { pivotId, movingId, sideAtoms } of candidates) {
      const pivotPos = coords.get(pivotId);
      if (!pivotPos) {
        continue;
      }

      let bestDelta = 0;
      let bestCoords = new Map(
        [...sideAtoms]
          .map(id => [id, coords.get(id)])
          .filter(([, pos]) => Boolean(pos))
      );
      let bestScore = scoreRotation(pivotId, movingId, sideAtoms, bestCoords, 0);

      for (const delta of deltas.slice(1)) {
        const rotated = new Map();
        for (const id of sideAtoms) {
          const pos = coords.get(id);
          if (pos) {
            rotated.set(id, rotateAround(pos, pivotPos, delta));
          }
        }
        const score = scoreRotation(pivotId, movingId, sideAtoms, rotated, delta);
        if (score + 1e-6 < bestScore) {
          bestScore = score;
          bestDelta = delta;
          bestCoords = rotated;
        }
      }

      if (bestDelta !== 0) {
        for (const [id, pos] of bestCoords) {
          coords.set(id, pos);
        }
      }
    }
  }
}

function readExistingCoords(molecule) {
  const coords = new Map();
  for (const [atomId, atom] of molecule.atoms) {
    if (Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
      coords.set(atomId, vec2(atom.x, atom.y));
    }
  }
  return coords;
}

function collectRefinementSubtree(molecule, startId, blockedId, frozenAtoms) {
  if (frozenAtoms.has(startId)) {
    return null;
  }

  const subtree = new Set();
  const queue = [startId];
  const seen = new Set([blockedId]);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (seen.has(cur)) {
      continue;
    }
    if (frozenAtoms.has(cur)) {
      return null;
    }
    seen.add(cur);
    subtree.add(cur);
    for (const nb of _layoutNeighbors(molecule, cur)) {
      if (!seen.has(nb)) {
        queue.push(nb);
      }
    }
  }
  return subtree;
}

function countHeavyAtoms(molecule, atomIds) {
  let count = 0;
  for (const atomId of atomIds) {
    if (molecule.atoms.get(atomId)?.name !== 'H') {
      count++;
    }
  }
  return count;
}

function collectCycleData(molecule) {
  const ringBondIds = new Set();
  const ringAtomIds = new Set();

  const hasAlternatePath = (startId, endId, excludedBondId) => {
    const queue = [startId];
    const seen = new Set();
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === endId) {
        return true;
      }
      if (seen.has(cur)) {
        continue;
      }
      seen.add(cur);
      const atom = molecule.atoms.get(cur);
      if (!atom) {
        continue;
      }
      for (const bondId of atom.bonds) {
        if (bondId === excludedBondId) {
          continue;
        }
        const bond = molecule.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const nextId = bond.getOtherAtom(cur);
        if (!seen.has(nextId)) {
          queue.push(nextId);
        }
      }
    }
    return false;
  };

  for (const [, bond] of molecule.bonds) {
    const [aId, bId] = bond.atoms;
    const atomA = molecule.atoms.get(aId);
    const atomB = molecule.atoms.get(bId);
    if (!atomA || !atomB || atomA.name === 'H' || atomB.name === 'H') {
      continue;
    }
    if (hasAlternatePath(aId, bId, bond.id)) {
      ringBondIds.add(bond.id);
      ringAtomIds.add(aId);
      ringAtomIds.add(bId);
    }
  }

  return { ringBondIds, ringAtomIds };
}

function collectRingSystemCandidates(molecule, bondLength, cycleData) {
  const ringAtomSet = cycleData.ringAtomIds;
  const systems = [];
  const seen = new Set();

  for (const atomId of ringAtomSet) {
    if (seen.has(atomId)) {
      continue;
    }
    const atomIds = new Set();
    const queue = [atomId];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (seen.has(cur) || !ringAtomSet.has(cur)) {
        continue;
      }
      seen.add(cur);
      atomIds.add(cur);
      for (const nb of _layoutNeighbors(molecule, cur)) {
        if (!seen.has(nb) && ringAtomSet.has(nb)) {
          queue.push(nb);
        }
      }
    }
    if (atomIds.size < 3) {
      continue;
    }

    const ringSubgraph = molecule.getSubgraph([...atomIds]);
    generateCoords(ringSubgraph, { suppressH: true, bondLength });
    const templateCoords = new Map();
    for (const [ringAtomId, atom] of ringSubgraph.atoms) {
      if (Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
        templateCoords.set(ringAtomId, vec2(atom.x, atom.y));
      }
    }
    if (templateCoords.size >= 3) {
      systems.push({ atomIds, templateCoords });
    }
  }

  return systems;
}

function alignTemplateCoords(templateCoords, targetCoords, atomIds) {
  const ids = [...atomIds].filter(atomId => templateCoords.has(atomId) && targetCoords.has(atomId));
  if (ids.length < 2) {
    return null;
  }

  let srcCx = 0, srcCy = 0, dstCx = 0, dstCy = 0;
  for (const atomId of ids) {
    const src = templateCoords.get(atomId);
    const dst = targetCoords.get(atomId);
    srcCx += src.x;
    srcCy += src.y;
    dstCx += dst.x;
    dstCy += dst.y;
  }
  srcCx /= ids.length;
  srcCy /= ids.length;
  dstCx /= ids.length;
  dstCy /= ids.length;

  const buildAligned = (reflectY) => {
    let cross = 0;
    let dot = 0;
    for (const atomId of ids) {
      const src = templateCoords.get(atomId);
      const dst = targetCoords.get(atomId);
      const sx = src.x - srcCx;
      const sy = reflectY ? -(src.y - srcCy) : (src.y - srcCy);
      const dx = dst.x - dstCx;
      const dy = dst.y - dstCy;
      cross += sx * dy - sy * dx;
      dot += sx * dx + sy * dy;
    }

    const angle = Math.atan2(cross, dot);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const aligned = new Map();
    let error = 0;

    for (const atomId of ids) {
      const src = templateCoords.get(atomId);
      const sx = src.x - srcCx;
      const sy = reflectY ? -(src.y - srcCy) : (src.y - srcCy);
      const x = dstCx + sx * cosA - sy * sinA;
      const y = dstCy + sx * sinA + sy * cosA;
      aligned.set(atomId, vec2(x, y));

      const dst = targetCoords.get(atomId);
      error += (x - dst.x) ** 2 + (y - dst.y) ** 2;
    }

    return { aligned, error };
  };

  const direct = buildAligned(false);
  const mirrored = buildAligned(true);
  return mirrored.error + 1e-9 < direct.error ? mirrored.aligned : direct.aligned;
}

function measureRingSystemDeviation(baseCoords, ringSystem) {
  const aligned = alignTemplateCoords(ringSystem.templateCoords, baseCoords, ringSystem.atomIds);
  if (!aligned) {
    return null;
  }

  let maxDisp = 0;
  let sumDispSq = 0;
  let count = 0;
  for (const atomId of ringSystem.atomIds) {
    const cur = baseCoords.get(atomId);
    const ideal = aligned.get(atomId);
    if (!cur || !ideal) {
      continue;
    }
    const disp = Math.hypot(cur.x - ideal.x, cur.y - ideal.y);
    if (disp > maxDisp) {
      maxDisp = disp;
    }
    sumDispSq += disp * disp;
    count++;
  }
  if (count === 0) {
    return null;
  }

  return {
    aligned,
    maxDisp,
    rmsDisp: Math.sqrt(sumDispSq / count)
  };
}

function buildRefinementContext(molecule, coords, {
  bondLength = DEFAULT_BOND_LENGTH,
  freezeRings = true,
  freezeChiralCenters = false,
  includeRingSystemCandidates = true
} = {}) {
  _buildLayoutNeighborCache(molecule);

  const heavyIds = [...coords.keys()].filter(id => molecule.atoms.get(id)?.name !== 'H');
  const cycleData = collectCycleData(molecule);
  const frozenAtoms = new Set();
  if (freezeRings) {
    for (const atomId of cycleData.ringAtomIds) {
      frozenAtoms.add(atomId);
    }
  }
  if (freezeChiralCenters) {
    for (const atomId of molecule.getChiralCenters()) {
      frozenAtoms.add(atomId);
    }
  }

  const bondedPairs = new Set();
  const heavyBonds = [];
  for (const [, bond] of molecule.bonds) {
    const [aId, bId] = bond.atoms;
    bondedPairs.add(`${aId}\0${bId}`);
    bondedPairs.add(`${bId}\0${aId}`);
    if (coords.has(aId) && coords.has(bId) &&
        molecule.atoms.get(aId)?.name !== 'H' &&
        molecule.atoms.get(bId)?.name !== 'H') {
      heavyBonds.push(bond);
    }
  }

  const rotatableCandidates = [];
  const multipleBondCandidates = [];
  for (const [, bond] of molecule.bonds) {
    const [aId, bId] = bond.atoms;
    const atomA = molecule.atoms.get(aId);
    const atomB = molecule.atoms.get(bId);
    if (!atomA || !atomB) {
      continue;
    }
    if (atomA.name === 'H' || atomB.name === 'H' || cycleData.ringBondIds.has(bond.id)) {
      continue;
    }
    if (!coords.has(aId) || !coords.has(bId)) {
      continue;
    }

    const order = bond.properties.order ?? 1;
    const sideA = collectRefinementSubtree(molecule, aId, bId, frozenAtoms);
    const sideB = collectRefinementSubtree(molecule, bId, aId, frozenAtoms);

    if (order === 1 && !bond.properties.aromatic) {
      const choices = [];
      if (sideA && sideA.size > 0) {
        choices.push({
          kind: 'rotatable',
          bondId: bond.id,
          pivotId: bId,
          movingId: aId,
          atomIds: sideA,
          heavyCount: countHeavyAtoms(molecule, sideA)
        });
      }
      if (sideB && sideB.size > 0) {
        choices.push({
          kind: 'rotatable',
          bondId: bond.id,
          pivotId: aId,
          movingId: bId,
          atomIds: sideB,
          heavyCount: countHeavyAtoms(molecule, sideB)
        });
      }
      if (choices.length === 0) {
        continue;
      }

      choices.sort((a, b) => {
        if (a.heavyCount !== b.heavyCount) {
          return a.heavyCount - b.heavyCount;
        }
        if (a.atomIds.size !== b.atomIds.size) {
          return a.atomIds.size - b.atomIds.size;
        }
        if (a.pivotId !== b.pivotId) {
          return _layoutCompareAtomIds(molecule, a.pivotId, b.pivotId);
        }
        return _layoutCompareAtomIds(molecule, a.movingId, b.movingId);
      });

      rotatableCandidates.push(choices[0]);
      continue;
    }

    if (order < 2 || bond.properties.aromatic) {
      continue;
    }

    const heavyDegreeA = _layoutNeighbors(molecule, aId).filter(nb => molecule.atoms.get(nb)?.name !== 'H').length;
    const heavyDegreeB = _layoutNeighbors(molecule, bId).filter(nb => molecule.atoms.get(nb)?.name !== 'H').length;
    const heavySideA = sideA ? countHeavyAtoms(molecule, sideA) : 0;
    const heavySideB = sideB ? countHeavyAtoms(molecule, sideB) : 0;
    if (sideA && heavySideA === 1 && heavyDegreeA === 1 && !frozenAtoms.has(aId)) {
      multipleBondCandidates.push({
        kind: 'multiple_terminal',
        bondId: bond.id,
        pivotId: bId,
        movingId: aId,
        atomIds: sideA,
        heavyCount: heavySideA
      });
    }
    if (sideB && heavySideB === 1 && heavyDegreeB === 1 && !frozenAtoms.has(bId)) {
      multipleBondCandidates.push({
        kind: 'multiple_terminal',
        bondId: bond.id,
        pivotId: aId,
        movingId: bId,
        atomIds: sideB,
        heavyCount: heavySideB
      });
    }
  }

  const ringSystemCandidates = freezeRings && includeRingSystemCandidates
    ? collectRingSystemCandidates(molecule, bondLength, cycleData)
    : [];

  return {
    bondLength,
    heavyIds,
    heavyBonds,
    bondedPairs,
    cycleData,
    frozenAtoms,
    rotatableCandidates,
    multipleBondCandidates,
    ringSystemCandidates,
    rings: molecule.getRings().filter(ring => ring.length >= 3)
  };
}

function segmentsProperlyIntersect(a1, a2, b1, b2) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  const eps = 1e-8;
  if (Math.abs(o1) < eps || Math.abs(o2) < eps || Math.abs(o3) < eps || Math.abs(o4) < eps) {
    return false;
  }
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function angleBetweenPoints(a, b, c) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const uLen = Math.hypot(ux, uy);
  const vLen = Math.hypot(vx, vy);
  if (uLen < 1e-8 || vLen < 1e-8) {
    return null;
  }
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (uLen * vLen)));
  return Math.acos(cos);
}

function idealRefinementAngle(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return DEG120;
  }
  const heavyBondOrders = atom.bonds
    .map(bondId => molecule.bonds.get(bondId))
    .filter(Boolean)
    .filter(bond => {
      const otherId = bond.getOtherAtom(atomId);
      return molecule.atoms.get(otherId)?.name !== 'H';
    })
    .map(bond => bond.properties.order ?? 1);
  const hasTriple = heavyBondOrders.some(order => order >= 3);
  const doubleCount = heavyBondOrders.filter(order => order >= 2 && order < 3).length;
  if (hasTriple || doubleCount >= 2) {
    return Math.PI;
  }
  return DEG120;
}

function isStrictTrigonalRefinementCenter(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  const heavyBondOrders = atom.bonds
    .map(bondId => molecule.bonds.get(bondId))
    .filter(Boolean)
    .filter(bond => {
      const otherId = bond.getOtherAtom(atomId);
      return molecule.atoms.get(otherId)?.name !== 'H';
    })
    .map(bond => bond.properties.order ?? 1);
  const doubleCount = heavyBondOrders.filter(order => order >= 2 && order < 3).length;
  const tripleCount = heavyBondOrders.filter(order => order >= 3).length;
  return tripleCount === 0 && doubleCount === 1 && heavyBondOrders.length === 3;
}

function getTerminalMultipleBondNeighborId(molecule, atomId) {
  const atom = molecule.atoms.get(atomId);
  if (!atom) {
    return null;
  }
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (!bond || bond.properties.aromatic || (bond.properties.order ?? 1) < 2) {
      continue;
    }
    const otherId = bond.getOtherAtom(atomId);
    if (!otherId || molecule.atoms.get(otherId)?.name === 'H') {
      continue;
    }
    const heavyDegree = _layoutNeighbors(molecule, otherId).filter(nb => molecule.atoms.get(nb)?.name !== 'H').length;
    if (heavyDegree === 1) {
      return otherId;
    }
  }
  return null;
}

function averageDirectionAwayFromRefs(pivot, refPositions) {
  let sumX = 0;
  let sumY = 0;
  for (const refPos of refPositions) {
    const dx = refPos.x - pivot.x;
    const dy = refPos.y - pivot.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-8) {
      continue;
    }
    sumX += dx / len;
    sumY += dy / len;
  }
  if (Math.hypot(sumX, sumY) < 1e-8) {
    return null;
  }
  return Math.atan2(-sumY, -sumX);
}

function ringSubstituentTargetAngle(molecule, coords, pivotId, ringAtomIds) {
  const pivot = coords.get(pivotId);
  if (!pivot) {
    return null;
  }
  const ringRefPositions = _layoutNeighbors(molecule, pivotId)
    .filter(atomId => ringAtomIds.has(atomId))
    .map(atomId => coords.get(atomId))
    .filter(Boolean);
  if (ringRefPositions.length < 2) {
    return null;
  }
  return averageDirectionAwayFromRefs(pivot, ringRefPositions);
}

function isRefinementChainBond(molecule, aId, bId, allowedAtomIds = null) {
  if (allowedAtomIds && (!allowedAtomIds.has(aId) || !allowedAtomIds.has(bId))) {
    return false;
  }
  const bond = molecule.getBond(aId, bId);
  return Boolean(bond && !bond.properties.aromatic && (bond.properties.order ?? 1) === 1);
}

function isRefinementChainAtom(molecule, atomId, ringAtomIds, allowedAtomIds = null) {
  if (allowedAtomIds && !allowedAtomIds.has(atomId)) {
    return false;
  }
  const atom = molecule.atoms.get(atomId);
  if (!atom || atom.name === 'H' || ringAtomIds.has(atomId)) {
    return false;
  }
  const heavyNeighbors = _layoutNeighbors(molecule, atomId)
    .filter(nb => molecule.atoms.get(nb)?.name !== 'H')
    .filter(nb => !allowedAtomIds || allowedAtomIds.has(nb));
  if (heavyNeighbors.length === 0) {
    return false;
  }
  return heavyNeighbors.every(nb => isRefinementChainBond(molecule, atomId, nb, allowedAtomIds));
}

function collectRefinementChainPath(molecule, startId, ringAtomIds, allowedAtomIds = null) {
  if (!isRefinementChainAtom(molecule, startId, ringAtomIds, allowedAtomIds)) {
    return [];
  }
  const path = [startId];
  let prevId = null;
  let curId = startId;

  for (let step = 0, maxSteps = molecule.atoms.size; step < maxSteps; step++) {
    const nextIds = _layoutNeighbors(molecule, curId)
      .filter(nb => nb !== prevId)
      .filter(nb => molecule.atoms.get(nb)?.name !== 'H')
      .filter(nb => isRefinementChainAtom(molecule, nb, ringAtomIds, allowedAtomIds))
      .filter(nb => isRefinementChainBond(molecule, curId, nb, allowedAtomIds));
    if (nextIds.length !== 1) {
      break;
    }
    prevId = curId;
    curId = nextIds[0];
    path.push(curId);
  }

  return path;
}

function collectAllRefinementChainPaths(molecule, ctx) {
  const eligible = new Set(
    ctx.heavyIds.filter(atomId => isRefinementChainAtom(molecule, atomId, ctx.cycleData.ringAtomIds))
  );
  const neighborMap = new Map();
  for (const atomId of eligible) {
    neighborMap.set(
      atomId,
      _layoutNeighbors(molecule, atomId)
        .filter(nb => eligible.has(nb))
        .filter(nb => isRefinementChainBond(molecule, atomId, nb))
    );
  }

  const visited = new Set();
  const paths = [];
  const edgeKey = (a, b) => a < b ? `${a}\0${b}` : `${b}\0${a}`;

  const starts = [...eligible].sort((a, b) => {
    const da = neighborMap.get(a)?.length ?? 0;
    const db = neighborMap.get(b)?.length ?? 0;
    if (da !== db) {
      return da - db;
    }
    return _layoutCompareAtomIds(molecule, a, b);
  });

  for (const startId of starts) {
    const degree = neighborMap.get(startId)?.length ?? 0;
    if (degree > 1) {
      continue;
    }
    const path = [startId];
    let prevId = null;
    let curId = startId;
    for (let step = 0, maxSteps = eligible.size; step < maxSteps; step++) {
      const nextIds = (neighborMap.get(curId) ?? []).filter(nb => nb !== prevId);
      if (nextIds.length !== 1) {
        break;
      }
      const nextId = nextIds[0];
      const eKey = edgeKey(curId, nextId);
      if (visited.has(eKey)) {
        break;
      }
      visited.add(eKey);
      path.push(nextId);
      prevId = curId;
      curId = nextId;
    }
    if (path.length >= 2) {
      paths.push(path);
    }
  }

  return paths;
}

function collectLayoutIssues(molecule, coords, ctx) {
  const issues = [];
  const atomThresh = ctx.bondLength * 0.72;
  const nearAtomThresh = ctx.bondLength * 0.95;
  const bondAtomThreshC = ctx.bondLength * 0.30;
  const bondAtomThreshHetero = ctx.bondLength * 0.50;
  const stretchedBondThresh = ctx.bondLength * 1.20;
  const compressedBondThresh = ctx.bondLength * 0.80;

  // Spatial grid: bucket heavy atoms into cells of size nearAtomThresh so that
  // only the 3×3 cell neighbourhood needs to be examined for proximity tests.
  // This reduces the atom-pair and bond-atom loops from O(n²) to O(n) for
  // spread-out molecules.
  const cellSize = nearAtomThresh;
  const gridCells  = new Map(); // "cx,cy" → number[] (indices into heavyIds)
  const atomCellCx = new Int32Array(ctx.heavyIds.length);
  const atomCellCy = new Int32Array(ctx.heavyIds.length);
  for (let i = 0; i < ctx.heavyIds.length; i++) {
    const p = coords.get(ctx.heavyIds[i]);
    if (!p) {
      continue;
    }
    const cx = Math.floor(p.x / cellSize);
    const cy = Math.floor(p.y / cellSize);
    atomCellCx[i] = cx;
    atomCellCy[i] = cy;
    const key = `${cx},${cy}`;
    let cell = gridCells.get(key);
    if (!cell) {
      cell = [];
      gridCells.set(key, cell);
    }
    cell.push(i);
  }

  // Collect indices of atoms in the 3×3 neighbourhood of cell (cx, cy).
  function indicesNear(cx, cy) {
    const result = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = gridCells.get(`${cx + dx},${cy + dy}`);
        if (cell) {
          for (const idx of cell) {
            result.push(idx);
          }
        }
      }
    }
    return result;
  }

  // Atom-atom proximity — O(n) thanks to grid.
  for (let i = 0; i < ctx.heavyIds.length; i++) {
    const aId = ctx.heavyIds[i];
    const aPos = coords.get(aId);
    if (!aPos) {
      continue;
    }
    for (const j of indicesNear(atomCellCx[i], atomCellCy[i])) {
      if (j <= i) {
        continue; // deduplicate; only check each pair once
      }
      const bId = ctx.heavyIds[j];
      if (ctx.bondedPairs.has(`${aId}\0${bId}`)) {
        continue;
      }
      const bPos = coords.get(bId);
      if (!bPos) {
        continue;
      }
      const dist = Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y);
      if (dist < atomThresh) {
        issues.push({
          type: 'atom_overlap',
          severity: 20 + (atomThresh - dist) * 40,
          atoms: [aId, bId]
        });
      } else if (dist < nearAtomThresh) {
        issues.push({
          type: 'atom_near',
          severity: (nearAtomThresh - dist) * 6,
          atoms: [aId, bId]
        });
      }
    }
  }

  for (let i = 0; i < ctx.heavyBonds.length; i++) {
    const bond = ctx.heavyBonds[i];
    const [aId, bId] = bond.atoms;
    const aPos = coords.get(aId);
    const bPos = coords.get(bId);
    if (!aPos || !bPos) {
      continue;
    }
    const bondDist = Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y);

    if (bondDist > stretchedBondThresh) {
      issues.push({
        type: 'bond_stretch',
        severity: 10 + (bondDist - stretchedBondThresh) * 18,
        atoms: [aId, bId],
        bonds: [bond.id]
      });
    } else if (bondDist < compressedBondThresh) {
      issues.push({
        type: 'bond_compression',
        severity: 10 + (compressedBondThresh - bondDist) * 24,
        atoms: [aId, bId],
        bonds: [bond.id]
      });
    }

    // Bond-atom crowding — O(1) per bond thanks to grid.
    // An atom within bondAtomThreshHetero of the segment must be within
    // bondAtomThreshHetero + bondLength/2 ≤ nearAtomThresh of at least one
    // endpoint, so checking the 3×3 neighbourhood of both endpoints suffices.
    const checkedForBond = new Set([aId, bId]);
    for (const pos of [aPos, bPos]) {
      const cx = Math.floor(pos.x / cellSize);
      const cy = Math.floor(pos.y / cellSize);
      for (const idx of indicesNear(cx, cy)) {
        const atomId = ctx.heavyIds[idx];
        if (checkedForBond.has(atomId)) {
          continue;
        }
        checkedForBond.add(atomId);
        if (ctx.bondedPairs.has(`${atomId}\0${aId}`) || ctx.bondedPairs.has(`${atomId}\0${bId}`)) {
          continue;
        }
        const atomPos = coords.get(atomId);
        if (!atomPos) {
          continue;
        }
        const atom = molecule.atoms.get(atomId);
        const thresh = atom?.name === 'C' ? bondAtomThreshC : bondAtomThreshHetero;
        const dist = pointToSegmentDistance(atomPos, aPos, bPos);
        if (dist < thresh) {
          issues.push({
            type: 'bond_atom_crowding',
            severity: (atom?.name === 'C' ? 4 : 12) + (thresh - dist) * (atom?.name === 'C' ? 10 : 35),
            atoms: [atomId, aId, bId],
            bonds: [bond.id]
          });
        }
      }
    }

    for (let j = i + 1; j < ctx.heavyBonds.length; j++) {
      const otherBond = ctx.heavyBonds[j];
      const shared = bond.atoms.some(atomId => otherBond.atoms.includes(atomId));
      if (shared) {
        continue;
      }
      // Cheap bounding-box pre-reject before calling segmentsProperlyIntersect.
      const cPos = coords.get(otherBond.atoms[0]);
      const dPos = coords.get(otherBond.atoms[1]);
      if (!cPos || !dPos) {
        continue;
      }
      if (
        Math.max(aPos.x, bPos.x) < Math.min(cPos.x, dPos.x) - 1e-6 ||
        Math.min(aPos.x, bPos.x) > Math.max(cPos.x, dPos.x) + 1e-6 ||
        Math.max(aPos.y, bPos.y) < Math.min(cPos.y, dPos.y) - 1e-6 ||
        Math.min(aPos.y, bPos.y) > Math.max(cPos.y, dPos.y) + 1e-6
      ) {
        continue;
      }
      if (segmentsProperlyIntersect(aPos, bPos, cPos, dPos)) {
        issues.push({
          type: 'bond_crossing',
          severity: 30,
          atoms: [...bond.atoms, ...otherBond.atoms],
          bonds: [bond.id, otherBond.id]
        });
      }
    }
  }

  for (const pivotId of ctx.heavyIds) {
    if (ctx.cycleData.ringAtomIds.has(pivotId)) {
      const ringNeighbors = _layoutNeighbors(molecule, pivotId)
        .filter(atomId => ctx.cycleData.ringAtomIds.has(atomId))
        .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
        .filter(atomId => coords.has(atomId));
      const substituents = _layoutNeighbors(molecule, pivotId)
        .filter(atomId => !ctx.cycleData.ringAtomIds.has(atomId))
        .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
        .filter(atomId => coords.has(atomId));
      if (ringNeighbors.length >= 2 && substituents.length === 1) {
        const pivotPos = coords.get(pivotId);
        const subPos = coords.get(substituents[0]);
        const targetAngle = ringSubstituentTargetAngle(molecule, coords, pivotId, ctx.cycleData.ringAtomIds);
        if (pivotPos && subPos && targetAngle != null) {
          const actualAngle = angleTo(pivotPos, subPos);
          const err = Math.abs(normalizeAngle(actualAngle - targetAngle));
          if (err > (18 * Math.PI / 180)) {
            issues.push({
              type: 'ring_substituent_angle',
              severity: 10 + err * 18,
              atoms: [pivotId, substituents[0], ...ringNeighbors]
            });
          }
        }
      }
      continue;
    }
    const neighbors = _layoutNeighbors(molecule, pivotId)
      .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
      .filter(atomId => coords.has(atomId));
    if (neighbors.length < 2 || neighbors.length > 4) {
      continue;
    }

    const pivotPos = coords.get(pivotId);
    if (!pivotPos) {
      continue;
    }

    // Quaternary centres (4 heavy neighbors) cannot all be at a single ideal
    // pairwise angle (adjacent pairs ≈ 90°, opposite pairs ≈ 180°).  Instead
    // check the minimum consecutive angular gap: the ideal gap is 360°/4 = 90°,
    // and we flag if any adjacent pair of bonds is closer than 60° (2/3 of
    // ideal), indicating two bonds have collapsed toward each other.
    if (neighbors.length === 4) {
      const bondAngles = neighbors
        .map(nbId => {
          const nbPos = coords.get(nbId);
          return nbPos ? Math.atan2(nbPos.y - pivotPos.y, nbPos.x - pivotPos.x) : null;
        })
        .filter(a => a !== null)
        .sort((a, b) => a - b);
      if (bondAngles.length < 4) {
        continue;
      }
      let minGap = Infinity;
      for (let i = 0; i < 4; i++) {
        const gap = (i < 3)
          ? bondAngles[i + 1] - bondAngles[i]
          : bondAngles[0] + TWO_PI - bondAngles[3]; // wraparound gap
        if (gap < minGap) {
          minGap = gap;
        }
      }
      const minGapThreshold = 60 * Math.PI / 180;
      if (minGap < minGapThreshold) {
        const err = minGapThreshold - minGap;
        issues.push({
          type: 'quaternary_angle',
          severity: 8 + err * 22,
          atoms: [pivotId, ...neighbors]
        });
      }
      continue;
    }

    const ideal = idealRefinementAngle(molecule, pivotId);
    const strictTrigonal = ideal === DEG120 && neighbors.length === 3 && isStrictTrigonalRefinementCenter(molecule, pivotId);
    const worstErrThreshold = strictTrigonal ? (4 * Math.PI / 180) : (12 * Math.PI / 180);
    const avgErrThreshold = strictTrigonal ? (3 * Math.PI / 180) : 0;
    let worstErr = 0;
    let errSum = 0;
    let pairCount = 0;
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const aPos = coords.get(neighbors[i]);
        const bPos = coords.get(neighbors[j]);
        if (!aPos || !bPos) {
          continue;
        }
        const angle = angleBetweenPoints(aPos, pivotPos, bPos);
        if (angle == null) {
          continue;
        }
        const err = Math.abs(angle - ideal);
        if (err > worstErr) {
          worstErr = err;
        }
        errSum += err;
        pairCount++;
      }
    }
    if (pairCount === 0) {
      continue;
    }
    const avgErr = errSum / pairCount;
    if (worstErr > worstErrThreshold || (strictTrigonal && avgErr > avgErrThreshold)) {
      issues.push({
        type: neighbors.length === 3 ? 'planar_angle' : 'chain_angle',
        severity: (strictTrigonal ? 10 : 8) + worstErr * (strictTrigonal ? 34 : 22) + avgErr * (strictTrigonal ? 16 : 8),
        atoms: [pivotId, ...neighbors]
      });
    }
  }

  for (let i = 0; i < ctx.ringSystemCandidates.length; i++) {
    const ringSystem = ctx.ringSystemCandidates[i];
    const deviation = measureRingSystemDeviation(coords, ringSystem);
    if (!deviation) {
      continue;
    }
    if (deviation.maxDisp > ctx.bondLength * 0.16 || deviation.rmsDisp > ctx.bondLength * 0.10) {
      issues.push({
        type: 'ring_geometry',
        severity: 12 + deviation.maxDisp * 18 + deviation.rmsDisp * 18,
        atoms: [...ringSystem.atomIds]
      });
    }
  }

  for (const path of (ctx.chainPaths ??= collectAllRefinementChainPaths(molecule, ctx))) {
    if (path.length < 4) {
      continue;
    }

    const startPos = coords.get(path[0]);
    const endPos = coords.get(path[path.length - 1]);
    if (startPos && endPos) {
      const endToEnd = Math.hypot(startPos.x - endPos.x, startPos.y - endPos.y);
      const idealEndToEnd = ctx.bondLength * (path.length - 1) * 0.82;
      if (endToEnd < idealEndToEnd) {
        issues.push({
          type: 'chain_compaction',
          severity: 6 + (idealEndToEnd - endToEnd) * 5,
          atoms: [...path]
        });
      }
    }

    for (let i = 0; i <= path.length - 4; i++) {
      const sign1 = backboneTurnSign(coords, path[i], path[i + 1], path[i + 2]);
      const sign2 = backboneTurnSign(coords, path[i + 1], path[i + 2], path[i + 3]);
      if (sign1 !== 0 && sign2 !== 0 && sign1 === sign2) {
        issues.push({
          type: 'chain_curl',
          severity: 8,
          atoms: [path[i], path[i + 1], path[i + 2], path[i + 3]]
        });
      }
    }
  }

  // Atom-inside-ring: penalise any non-ring heavy atom whose coordinate falls
  // inside a ring polygon.  The existing atom-overlap / bond-atom-crowding /
  // bond-crossing checks are insufficient for this case: for a regular hexagon
  // a substituent placed at the ring-inward direction lands ≈ 1 BL from every
  // ring atom (above the 0.72 BL overlap threshold), ≈ 0.866 BL from every
  // ring bond (above the 0.30 BL carbon crowding threshold), and its bond to
  // the ring atom shares an endpoint with adjacent ring bonds so
  // segmentsProperlyIntersect correctly returns false.  Without this check the
  // scoring function accepts the ring-interior position.
  if (ctx.rings?.length > 0) {
    for (let i = 0; i < ctx.heavyIds.length; i++) {
      const atomId = ctx.heavyIds[i];
      if (ctx.cycleData.ringAtomIds.has(atomId)) {
        continue;
      }
      const p = coords.get(atomId);
      if (!p) {
        continue;
      }
      for (const ring of ctx.rings) {
        const poly = ring.map(id => coords.get(id)).filter(Boolean);
        if (poly.length < 3) {
          continue;
        }
        if (pointInPolygon(p, poly)) {
          issues.push({
            type: 'atom_inside_ring',
            severity: 500,
            atoms: [atomId]
          });
          break; // one issue per atom is enough
        }
      }
    }
  }

  issues.sort((a, b) => b.severity - a.severity);
  return issues;
}

function scoreLayoutIssues(issues) {
  return issues.reduce((sum, issue) => sum + issue.severity, 0);
}

function rotateSubtreeCoords(baseCoords, atomIds, originId, angle) {
  const origin = baseCoords.get(originId);
  if (!origin || Math.abs(angle) < 1e-9) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }
  const rotated = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      rotated.set(atomId, rotateAround(pos, origin, angle));
    }
  }
  return rotated;
}

function reflectSubtreeCoords(baseCoords, atomIds, axisAId, axisBId) {
  const a = baseCoords.get(axisAId);
  const b = baseCoords.get(axisBId);
  if (!a || !b) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }
  const reflected = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      reflected.set(atomId, _reflectPoint(pos, a, b));
    }
  }
  return reflected;
}

function reanchorSubtreeCoords(baseCoords, atomIds, pivotId, movingId, targetLength) {
  const pivot = baseCoords.get(pivotId);
  const moving = baseCoords.get(movingId);
  if (!pivot || !moving) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }

  let dx = moving.x - pivot.x;
  let dy = moving.y - pivot.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-6) {
    dx = 1;
    dy = 0;
    dist = 1;
  }

  const targetX = pivot.x + (dx / dist) * targetLength;
  const targetY = pivot.y + (dy / dist) * targetLength;
  const shiftX = targetX - moving.x;
  const shiftY = targetY - moving.y;

  const translated = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      translated.set(atomId, vec2(pos.x + shiftX, pos.y + shiftY));
    }
  }
  return translated;
}

function reprojectSubtreeCoords(baseCoords, atomIds, pivotId, movingId, targetAngle, targetLength) {
  const pivot = baseCoords.get(pivotId);
  const moving = baseCoords.get(movingId);
  if (!pivot || !moving) {
    return new Map([...atomIds].map(id => [id, baseCoords.get(id)]).filter(([, pos]) => Boolean(pos)));
  }

  const currentAngle = angleTo(pivot, moving);
  const deltaAngle = normalizeAngle(targetAngle - currentAngle);
  const targetPos = project(pivot, targetAngle, targetLength);
  const rotated = new Map();
  for (const atomId of atomIds) {
    const pos = baseCoords.get(atomId);
    if (pos) {
      rotated.set(atomId, rotateAround(pos, moving, deltaAngle));
    }
  }

  const movedAnchor = rotated.get(movingId) ?? moving;
  const shiftX = targetPos.x - movedAnchor.x;
  const shiftY = targetPos.y - movedAnchor.y;
  for (const [atomId, pos] of rotated) {
    rotated.set(atomId, vec2(pos.x + shiftX, pos.y + shiftY));
  }
  return rotated;
}

function applyRefinementCoords(baseCoords, updates) {
  const next = new Map(baseCoords);
  for (const [atomId, pos] of updates) {
    next.set(atomId, pos);
  }
  return next;
}

function strictTrigonalCenterError(molecule, coords, centerId) {
  const center = coords.get(centerId);
  if (!center) {
    return Infinity;
  }
  const neighbors = _layoutNeighbors(molecule, centerId)
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => coords.has(atomId));
  if (neighbors.length !== 3) {
    return Infinity;
  }
  let err = 0;
  let pairCount = 0;
  for (let i = 0; i < neighbors.length; i++) {
    for (let j = i + 1; j < neighbors.length; j++) {
      const aPos = coords.get(neighbors[i]);
      const bPos = coords.get(neighbors[j]);
      const angle = angleBetweenPoints(aPos, center, bPos);
      if (angle == null) {
        return Infinity;
      }
      err += Math.abs(angle - DEG120);
      pairCount++;
    }
  }
  return pairCount > 0 ? err / pairCount : Infinity;
}

function buildStrictTrigonalCenterTransforms(molecule, baseCoords, centerId, ctx) {
  if (!isStrictTrigonalRefinementCenter(molecule, centerId) ||
      !getTerminalMultipleBondNeighborId(molecule, centerId)) {
    return [];
  }

  const center = baseCoords.get(centerId);
  if (!center) {
    return [];
  }

  const neighbors = _layoutNeighbors(molecule, centerId)
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (neighbors.length !== 3) {
    return [];
  }

  const infos = neighbors.map(neighborId => {
    const subtree = collectRefinementSubtree(molecule, neighborId, centerId, ctx.frozenAtoms);
    const movable = Boolean(
      subtree &&
      subtree.size > 0 &&
      countHeavyAtoms(molecule, subtree) > 0 &&
      countHeavyAtoms(molecule, subtree) <= ctx.heavyIds.length - countHeavyAtoms(molecule, subtree)
    );
    return {
      neighborId,
      pos: baseCoords.get(neighborId),
      subtree,
      movable
    };
  });

  const movableInfos = infos.filter(info => info.movable);
  const fixedInfos = infos.filter(info => !info.movable);
  if (movableInfos.length === 0 || fixedInfos.length === 0) {
    return [];
  }

  const transforms = [];
  const mergeUpdates = parts => {
    const merged = new Map();
    for (const part of parts) {
      for (const [atomId, pos] of part) {
        merged.set(atomId, pos);
      }
    }
    return merged;
  };

  if (fixedInfos.length === 2 && movableInfos.length === 1) {
    const targetAngle = averageDirectionAwayFromRefs(center, fixedInfos.map(info => info.pos));
    if (targetAngle != null) {
      transforms.push(
        reprojectSubtreeCoords(
          baseCoords,
          movableInfos[0].subtree,
          centerId,
          movableInfos[0].neighborId,
          targetAngle,
          ctx.bondLength
        )
      );
    }
    return transforms;
  }

  if (fixedInfos.length === 1 && movableInfos.length === 2) {
    const refAngle = angleTo(center, fixedInfos[0].pos);
    const targetAngles = [
      normalizeAngle(refAngle + DEG120),
      normalizeAngle(refAngle - DEG120)
    ];
    const assignments = [
      [targetAngles[0], targetAngles[1]],
      [targetAngles[1], targetAngles[0]]
    ];
    for (const [firstAngle, secondAngle] of assignments) {
      transforms.push(
        mergeUpdates([
          reprojectSubtreeCoords(
            baseCoords,
            movableInfos[0].subtree,
            centerId,
            movableInfos[0].neighborId,
            firstAngle,
            ctx.bondLength
          ),
          reprojectSubtreeCoords(
            baseCoords,
            movableInfos[1].subtree,
            centerId,
            movableInfos[1].neighborId,
            secondAngle,
            ctx.bondLength
          )
        ])
      );
    }
  }

  return transforms;
}

function idealizeStrictTrigonalCenters(molecule, baseCoords, ctx, {
  maxPasses = 2,
  requireNonWorseScore = true
} = {}) {
  let currentCoords = baseCoords;
  let currentScore = scoreLayoutIssues(collectLayoutIssues(molecule, currentCoords, ctx));

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    const centerIds = ctx.heavyIds
      .filter(atomId => getTerminalMultipleBondNeighborId(molecule, atomId))
      .sort((a, b) => strictTrigonalCenterError(molecule, currentCoords, b) - strictTrigonalCenterError(molecule, currentCoords, a));

    for (const centerId of centerIds) {
      const baseLocalError = strictTrigonalCenterError(molecule, currentCoords, centerId);
      if (!Number.isFinite(baseLocalError) || baseLocalError < (2 * Math.PI / 180)) {
        continue;
      }

      let bestCoords = null;
      let bestScore = currentScore;
      let bestLocalError = baseLocalError;
      for (const updates of buildStrictTrigonalCenterTransforms(molecule, currentCoords, centerId, ctx)) {
        const trialCoords = applyRefinementCoords(currentCoords, updates);
        const trialLocalError = strictTrigonalCenterError(molecule, trialCoords, centerId);
        if (!(trialLocalError + 1e-6 < bestLocalError)) {
          continue;
        }
        const trialScore = scoreLayoutIssues(collectLayoutIssues(molecule, trialCoords, ctx));
        if ((!requireNonWorseScore || trialScore <= currentScore + 1e-6) &&
            (trialScore + 1e-6 < bestScore || trialLocalError + 1e-6 < bestLocalError)) {
          bestCoords = trialCoords;
          bestScore = trialScore;
          bestLocalError = trialLocalError;
        }
      }

      if (bestCoords) {
        currentCoords = bestCoords;
        currentScore = bestScore;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return currentCoords;
}

function applyRingSystemTemplate(baseCoords, ringSystem) {
  const deviation = measureRingSystemDeviation(baseCoords, ringSystem);
  return deviation?.aligned ? applyRefinementCoords(baseCoords, deviation.aligned) : baseCoords;
}

function buildChainProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  const pivot = baseCoords.get(candidate.pivotId);
  const moving = baseCoords.get(candidate.movingId);
  if (!pivot || !moving) {
    return [];
  }

  const refIds = _layoutNeighbors(molecule, candidate.pivotId)
    .filter(atomId => atomId !== candidate.movingId)
    .filter(atomId => !candidate.atomIds.has(atomId))
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (refIds.length === 0) {
    return [];
  }

  const targetLength = ctx.bondLength;
  const idealAngle = idealRefinementAngle(molecule, candidate.pivotId);
  const transforms = [];
  const seenAngles = new Set();

  for (const refId of refIds) {
    const refPos = baseCoords.get(refId);
    if (!refPos) {
      continue;
    }
    const refAngle = angleTo(pivot, refPos);
    const candidateAngles = idealAngle >= Math.PI - 1e-6
      ? [normalizeAngle(refAngle + Math.PI)]
      : [normalizeAngle(refAngle + idealAngle), normalizeAngle(refAngle - idealAngle)];

    for (const angle of candidateAngles) {
      const key = angle.toFixed(6);
      if (seenAngles.has(key)) {
        continue;
      }
      seenAngles.add(key);
      transforms.push(reprojectSubtreeCoords(baseCoords, candidate.atomIds, candidate.pivotId, candidate.movingId, angle, targetLength));
    }
  }

  return transforms;
}

function buildPlanarProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  const pivot = baseCoords.get(candidate.pivotId);
  const moving = baseCoords.get(candidate.movingId);
  if (!pivot || !moving) {
    return [];
  }

  const refIds = _layoutNeighbors(molecule, candidate.pivotId)
    .filter(atomId => atomId !== candidate.movingId)
    .filter(atomId => !candidate.atomIds.has(atomId))
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (refIds.length < 2) {
    return [];
  }

  const idealAngle = idealRefinementAngle(molecule, candidate.pivotId);
  if (Math.abs(idealAngle - DEG120) > 1e-6) {
    return [];
  }

  const refPositions = refIds.map(atomId => baseCoords.get(atomId)).filter(Boolean);
  const targetAngle = averageDirectionAwayFromRefs(pivot, refPositions);
  if (targetAngle == null) {
    return [];
  }

  return [
    reprojectSubtreeCoords(
      baseCoords,
      candidate.atomIds,
      candidate.pivotId,
      candidate.movingId,
      targetAngle,
      ctx.bondLength
    )
  ];
}

function buildRingSubstituentProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  if (!ctx.cycleData.ringAtomIds.has(candidate.pivotId)) {
    return [];
  }
  const targetAngle = ringSubstituentTargetAngle(molecule, baseCoords, candidate.pivotId, ctx.cycleData.ringAtomIds);
  if (targetAngle == null) {
    return [];
  }
  return [
    reprojectSubtreeCoords(
      baseCoords,
      candidate.atomIds,
      candidate.pivotId,
      candidate.movingId,
      targetAngle,
      ctx.bondLength
    )
  ];
}

function buildExtendedZigZagChainTransforms(molecule, baseCoords, candidate, ctx) {
  if (candidate.kind !== 'rotatable') {
    return [];
  }

  const path = collectRefinementChainPath(molecule, candidate.movingId, ctx.cycleData.ringAtomIds, candidate.atomIds);
  if (path.length < 3) {
    return [];
  }

  const pivot = baseCoords.get(candidate.pivotId);
  const moving = baseCoords.get(candidate.movingId);
  if (!pivot || !moving) {
    return [];
  }

  const refIds = _layoutNeighbors(molecule, candidate.pivotId)
    .filter(atomId => atomId !== candidate.movingId)
    .filter(atomId => !candidate.atomIds.has(atomId))
    .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
    .filter(atomId => baseCoords.has(atomId));
  if (refIds.length === 0) {
    return [];
  }

  const targetLength = ctx.bondLength;
  const idealAngle = idealRefinementAngle(molecule, candidate.pivotId);
  const startAngles = new Set();
  for (const refId of refIds) {
    const refPos = baseCoords.get(refId);
    if (!refPos) {
      continue;
    }
    const refAngle = angleTo(pivot, refPos);
    if (idealAngle >= Math.PI - 1e-6) {
      startAngles.add(normalizeAngle(refAngle + Math.PI).toFixed(6));
    } else {
      startAngles.add(normalizeAngle(refAngle + idealAngle).toFixed(6));
      startAngles.add(normalizeAngle(refAngle - idealAngle).toFixed(6));
    }
  }

  const pathSet = new Set(path);
  const sideSubtrees = [];
  const seenSide = new Set();
  for (const anchorId of path) {
    for (const nbId of _layoutNeighbors(molecule, anchorId)) {
      if (!candidate.atomIds.has(nbId) || pathSet.has(nbId) || seenSide.has(nbId)) {
        continue;
      }
      const subtree = new Set();
      const queue = [nbId];
      while (queue.length > 0) {
        const curId = queue.shift();
        if (subtree.has(curId) || pathSet.has(curId) || !candidate.atomIds.has(curId)) {
          continue;
        }
        subtree.add(curId);
        seenSide.add(curId);
        for (const nextId of _layoutNeighbors(molecule, curId)) {
          if (!subtree.has(nextId) && !pathSet.has(nextId) && candidate.atomIds.has(nextId)) {
            queue.push(nextId);
          }
        }
      }
      if (subtree.size > 0) {
        sideSubtrees.push({ anchorId, atomIds: subtree });
      }
    }
  }

  const transforms = [];
  for (const startAngleKey of startAngles) {
    const startAngle = Number(startAngleKey);
    for (const parity of [1, -1]) {
      const updates = new Map();
      let currentPos = project(pivot, startAngle, targetLength);
      let currentDir = startAngle;
      let currentSign = parity;

      updates.set(path[0], currentPos);
      for (let i = 1; i < path.length; i++) {
        const nextDir = normalizeAngle(currentDir + currentSign * DEG60);
        const nextPos = project(currentPos, nextDir, targetLength);
        updates.set(path[i], nextPos);
        currentPos = nextPos;
        currentDir = nextDir;
        currentSign *= -1;
      }

      for (const { anchorId, atomIds } of sideSubtrees) {
        const oldAnchor = baseCoords.get(anchorId);
        const newAnchor = updates.get(anchorId);
        if (!oldAnchor || !newAnchor) {
          continue;
        }
        const dx = newAnchor.x - oldAnchor.x;
        const dy = newAnchor.y - oldAnchor.y;
        for (const atomId of atomIds) {
          const pos = baseCoords.get(atomId);
          if (pos) {
            updates.set(atomId, vec2(pos.x + dx, pos.y + dy));
          }
        }
      }

      transforms.push(updates);
    }
  }

  return transforms;
}

function buildAttachedMultipleBondProjectionTransforms(molecule, baseCoords, candidate, ctx) {
  const moving = baseCoords.get(candidate.movingId);
  if (!moving) {
    return [];
  }

  const transforms = [];
  for (const bondId of molecule.atoms.get(candidate.movingId)?.bonds ?? []) {
    const bond = molecule.bonds.get(bondId);
    if (!bond || bond.properties.aromatic || (bond.properties.order ?? 1) < 2) {
      continue;
    }
    const childId = bond.getOtherAtom(candidate.movingId);
    if (!candidate.atomIds.has(childId) || molecule.atoms.get(childId)?.name === 'H') {
      continue;
    }

    const childAtoms = collectRefinementSubtree(molecule, childId, candidate.movingId, ctx.frozenAtoms);
    if (!childAtoms || countHeavyAtoms(molecule, childAtoms) !== 1) {
      continue;
    }

    const refIds = _layoutNeighbors(molecule, candidate.movingId)
      .filter(atomId => atomId !== childId)
      .filter(atomId => !childAtoms.has(atomId))
      .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
      .filter(atomId => baseCoords.has(atomId));
    if (refIds.length === 0) {
      continue;
    }

    const idealAngle = idealRefinementAngle(molecule, candidate.movingId);
    const seenAngles = new Set();
    const addAngle = angle => {
      const key = normalizeAngle(angle).toFixed(6);
      if (seenAngles.has(key)) {
        return;
      }
      seenAngles.add(key);
      transforms.push(
        reprojectSubtreeCoords(
          baseCoords,
          childAtoms,
          candidate.movingId,
          childId,
          normalizeAngle(angle),
          ctx.bondLength
        )
      );
    };

    if (Math.abs(idealAngle - DEG120) < 1e-6 && refIds.length >= 2) {
      const targetAngle = averageDirectionAwayFromRefs(
        moving,
        refIds.map(atomId => baseCoords.get(atomId)).filter(Boolean)
      );
      if (targetAngle != null) {
        addAngle(targetAngle);
      }
    }

    for (const refId of refIds) {
      const refPos = baseCoords.get(refId);
      if (!refPos) {
        continue;
      }
      const refAngle = angleTo(moving, refPos);
      if (idealAngle >= Math.PI - 1e-6) {
        addAngle(refAngle + Math.PI);
      } else {
        addAngle(refAngle + idealAngle);
        addAngle(refAngle - idealAngle);
      }
    }
  }

  return transforms;
}

/**
 * If `molecule` has multiple disconnected components whose bounding boxes
 * overlap (or nearly touch), re-arranges them in a horizontal row with
 * `bondLength * 2` gaps between them, vertically centred at y = 0.
 * Returns the (possibly updated) coords map; the input map is never mutated.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {Map<string, Vec2>} coords
 * @param {number} bondLength
 * @returns {Map<string, Vec2>}
 */
function _separateOverlappingComponents(molecule, coords, bondLength) {
  const components = molecule.getComponents();
  if (components.length <= 1) {
    return coords;
  }

  // Build bounding box for each component.
  const compData = components.map(comp => {
    const ids = [...comp.atoms.keys()];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = coords.get(id);
      if (!p) {
        continue;
      }
      if (p.x < minX) {
        minX = p.x;
      }
      if (p.x > maxX) {
        maxX = p.x;
      }
      if (p.y < minY) {
        minY = p.y;
      }
      if (p.y > maxY) {
        maxY = p.y;
      }
    }
    return {
      ids,
      minX: isFinite(minX) ? minX : 0,
      maxX: isFinite(maxX) ? maxX : 0,
      minY: isFinite(minY) ? minY : 0,
      maxY: isFinite(maxY) ? maxY : 0
    };
  });

  // Check whether any pair of components has overlapping (or nearly touching)
  // bounding boxes.  pad prevents "just kissing" layouts from triggering.
  const pad = bondLength * 0.5;
  let needSeparate = false;
  outer: for (let i = 0; i < compData.length; i++) {
    for (let j = i + 1; j < compData.length; j++) {
      const a = compData[i];
      const b = compData[j];
      if (
        a.maxX + pad > b.minX && b.maxX + pad > a.minX &&
        a.maxY + pad > b.minY && b.maxY + pad > a.minY
      ) {
        needSeparate = true;
        break outer;
      }
    }
  }
  if (!needSeparate) {
    return coords;
  }

  // Re-arrange: lay components out in a horizontal row, each centred at y = 0.
  const gap = bondLength * 2;
  const newCoords = new Map(coords);
  let curX = 0;
  for (const comp of compData) {
    const w  = comp.maxX - comp.minX;
    const cy = (comp.minY + comp.maxY) / 2;
    const shiftX = curX - comp.minX;
    const shiftY = -cy;
    for (const id of comp.ids) {
      const p = coords.get(id);
      if (p) {
        newCoords.set(id, vec2(p.x + shiftX, p.y + shiftY));
      }
    }
    curX += w + gap;
  }
  return newCoords;
}

/**
 * Refines already assigned 2D coordinates by trying discrete subtree moves
 * around rotatable single bonds. This is intended as a conservative cleanup
 * pass after an initial layout, not as a replacement for `generateCoords()`.
 *
 * Reads `atom.x` / `atom.y`, mutates them in place when an improving move is
 * found, and returns the final coordinate map.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {object} [options]
 * @param {number} [options.bondLength=1.5]
 * @param {number} [options.maxPasses=6]
 * @param {boolean} [options.freezeRings=true]
 * @param {boolean} [options.freezeChiralCenters=false]
 * @param {boolean} [options.allowBranchReflect=true]
 * @param {number[]} [options.rotateAngles] Rotation candidates in radians.
 * @param {number} [options.maxCandidatesPerPass=24] - Maximum number of rotatable-bond candidates evaluated per pass. Capping this keeps refinement interactive for large molecules.
 * @returns {Map<string, { x: number, y: number }>}
 */
export function refineExistingCoords(molecule, options = {}) {
  const coords = readExistingCoords(molecule);
  if (coords.size === 0) {
    return coords;
  }

  const {
    bondLength = DEFAULT_BOND_LENGTH,
    maxPasses = 6,
    freezeRings = true,
    freezeChiralCenters = false,
    allowBranchReflect = true,
    rotateAngles = [-Math.PI / 2, -Math.PI / 3, -Math.PI / 6, Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI],
    // Cap the number of bond-rotation candidates tried per pass so that
    // large molecules (many rotatable bonds) remain interactive.
    maxCandidatesPerPass = 24
  } = options;

  const ctx = buildRefinementContext(molecule, coords, {
    bondLength,
    freezeRings,
    freezeChiralCenters
  });
  if (ctx.rotatableCandidates.length === 0 &&
      ctx.multipleBondCandidates.length === 0 &&
      ctx.ringSystemCandidates.length === 0) {
    const idealized = idealizeStrictTrigonalCenters(molecule, coords, ctx);
    const separated = _separateOverlappingComponents(molecule, idealized, bondLength);
    if (separated !== coords) {
      for (const [atomId, pos] of separated) {
        const atom = molecule.atoms.get(atomId);
        if (atom) {
          atom.x = pos.x;
          atom.y = pos.y;
        }
      }
    }
    return separated;
  }

  let currentCoords = coords;
  for (const ringSystem of ctx.ringSystemCandidates) {
    const deviation = measureRingSystemDeviation(currentCoords, ringSystem);
    if (!deviation) {
      continue;
    }
    if (deviation.maxDisp > ctx.bondLength * 0.16 || deviation.rmsDisp > ctx.bondLength * 0.10) {
      currentCoords = applyRefinementCoords(currentCoords, deviation.aligned);
    }
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    const currentIssues = collectLayoutIssues(molecule, currentCoords, ctx);
    const currentScore = scoreLayoutIssues(currentIssues);
    if (currentScore <= 1e-9) {
      break;
    }

    const issueAtoms = new Set(
      currentIssues
        .slice(0, 12)
        .flatMap(issue => issue.atoms ?? [])
    );
    const allCandidates = [...ctx.rotatableCandidates, ...ctx.multipleBondCandidates];
    let candidatePool = allCandidates.filter(candidate =>
      issueAtoms.size === 0 ||
      issueAtoms.has(candidate.pivotId) ||
      issueAtoms.has(candidate.movingId) ||
      [...candidate.atomIds].some(atomId => issueAtoms.has(atomId))
    );
    if (candidatePool.length > maxCandidatesPerPass) {
      // Candidates are already sorted by heavyCount (smallest subtree first),
      // so capping keeps the most local (cheapest) moves.
      candidatePool = candidatePool.slice(0, maxCandidatesPerPass);
    }
    const candidates = candidatePool.length > 0 ? candidatePool : allCandidates.slice(0, maxCandidatesPerPass);
    const ringCandidates = ctx.ringSystemCandidates.filter(ringSystem =>
      issueAtoms.size === 0 || [...ringSystem.atomIds].some(atomId => issueAtoms.has(atomId))
    );
    const activeRingCandidates = ringCandidates.length > 0 ? ringCandidates : ctx.ringSystemCandidates;

    let bestScore = currentScore;
    let bestCoords = null;

    for (const ringSystem of activeRingCandidates) {
      const trialCoords = applyRingSystemTemplate(currentCoords, ringSystem);
      if (trialCoords === currentCoords) {
        continue;
      }
      const trialScore = scoreLayoutIssues(collectLayoutIssues(molecule, trialCoords, ctx));
      if (trialScore + 1e-6 < bestScore) {
        bestScore = trialScore;
        bestCoords = trialCoords;
      }
    }

    for (const candidate of candidates) {
      const transforms = [];
      if (candidate.kind === 'rotatable') {
        for (const angle of rotateAngles) {
          transforms.push(rotateSubtreeCoords(currentCoords, candidate.atomIds, candidate.pivotId, angle));
        }
      }
      transforms.push(...buildExtendedZigZagChainTransforms(molecule, currentCoords, candidate, ctx));
      transforms.push(...buildRingSubstituentProjectionTransforms(molecule, currentCoords, candidate, ctx));
      transforms.push(...buildChainProjectionTransforms(molecule, currentCoords, candidate, ctx));
      transforms.push(...buildPlanarProjectionTransforms(molecule, currentCoords, candidate, ctx));
      transforms.push(reanchorSubtreeCoords(currentCoords, candidate.atomIds, candidate.pivotId, candidate.movingId, ctx.bondLength));
      if (allowBranchReflect && candidate.kind === 'rotatable') {
        transforms.push(reflectSubtreeCoords(currentCoords, candidate.atomIds, candidate.pivotId, candidate.movingId));
      }

      for (const updates of transforms) {
        const trialCoords = applyRefinementCoords(currentCoords, updates);
        const trialScore = scoreLayoutIssues(collectLayoutIssues(molecule, trialCoords, ctx));
        const improved = trialScore + 1e-6 < bestScore;
        if (improved) {
          bestScore = trialScore;
          bestCoords = trialCoords;
        }

        // Attached multiple-bond corrections often need a coordinated move:
        // the base trial can look neutral or slightly worse until the bonded
        // carbonyl/imine partner is reprojected as well. Always evaluate the
        // child transforms so ring-bound esters/acids and similar systems can
        // recover their full trigonal geometry in one refinement step.
        for (const childUpdates of buildAttachedMultipleBondProjectionTransforms(molecule, trialCoords, candidate, ctx)) {
          const childTrialCoords = applyRefinementCoords(trialCoords, childUpdates);
          const childTrialScore = scoreLayoutIssues(collectLayoutIssues(molecule, childTrialCoords, ctx));
          if (childTrialScore + 1e-6 < bestScore) {
            bestScore = childTrialScore;
            bestCoords = childTrialCoords;
          }
        }
      }
    }

    if (!bestCoords) {
      break;
    }
    currentCoords = bestCoords;
  }

  currentCoords = idealizeStrictTrigonalCenters(molecule, currentCoords, ctx);
  currentCoords = _separateOverlappingComponents(molecule, currentCoords, bondLength);
  if (ctx.cycleData.ringAtomIds.size > 0) {
    normalizeOrientation(currentCoords, molecule);
  }
  levelCoords(currentCoords, molecule);

  for (const [atomId, pos] of currentCoords) {
    const atom = molecule.atoms.get(atomId);
    if (atom) {
      atom.x = pos.x;
      atom.y = pos.y;
    }
  }
  return currentCoords;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assigns 2D coordinates to every atom in `molecule`.
 * Coordinates are written to `atom.x` and `atom.y`.
 *
 * @param {import('../core/Molecule.js').Molecule} molecule
 * @param {object}  [options]
 * @param {number}  [options.bondLength=1.5]  Target bond length in Angstroms.
 * @param {boolean} [options.suppressH=true]  When true, explicit H atoms are
 *   placed at their parent position (offset slightly) rather than laid out as
 *   full chain atoms.
 * @returns {Map<string, { x: number, y: number }>} Map from atom ID to {x, y}.
 */
export function generateCoords(molecule, options = {}) {
  if (molecule.atomCount === 0) {
    return new Map();
  }

  const bondLength = options.bondLength ?? DEFAULT_BOND_LENGTH;
  const suppressH  = options.suppressH  ?? true;

  // Delegate multi-component molecules.
  if (molecule.getComponents().length > 1) {
    return layoutComponents(molecule, options);
  }

  _buildLayoutNeighborCache(molecule);

  const coords = new Map();
  const placed = new Set();

  // Phase A — detect rings and place ring systems.
  const rings   = molecule.getRings();
  // Sort ring systems so the largest goes first, then BFS-order by connectivity.
  // Two ring systems are "connected" if any atom of one can reach any atom of the
  // other via a path through non-ring atoms (inter-ring chain) or a direct bond.
  // BFS ordering ensures that when ring system si is processed, at least one other
  // already-placed ring system is reachable, allowing the extended-anchor search to
  // find it.  Without this ordering, a ring that is "downstream" in the chain could
  // be processed before its nearer neighbour, making the path to the anchor go
  // through an unplaced ring system and triggering the fallback disconnect placement.
  const systems = (() => {
    const unsorted = detectRingSystems(rings).sort((a, b) => {
      if (b.atomIds.length !== a.atomIds.length) {
        return b.atomIds.length - a.atomIds.length;
      }
      const aMin = [...a.atomIds].sort((x, y) => _layoutCompareAtomIds(molecule, x, y))[0];
      const bMin = [...b.atomIds].sort((x, y) => _layoutCompareAtomIds(molecule, x, y))[0];
      return _layoutCompareAtomIds(molecule, aMin, bMin);
    });
    if (unsorted.length <= 1) {
      return unsorted;
    }

    const allRingAtomIds = new Set(unsorted.flatMap(s => s.atomIds));

    // Returns true if any atom of src can reach any atom of dst via a path through
    // non-ring atoms (i.e. the two ring systems are connected in the molecule graph).
    function ringSysReachable(src, dst) {
      const dstSet = new Set(dst.atomIds);
      const srcSet = new Set(src.atomIds);
      const visited = new Set(srcSet);
      const q = [...src.atomIds];
      while (q.length > 0) {
        const cur = q.shift();
        for (const nb of _layoutNeighbors(molecule, cur)) {
          if (visited.has(nb)) {
            continue;
          }
          if (dstSet.has(nb)) {
            return true;
          }
          visited.add(nb);
          // Traverse through non-ring atoms; stop at ring atoms of other systems.
          if (!allRingAtomIds.has(nb)) {
            q.push(nb);
          }
        }
      }
      return false;
    }

    // BFS over the ring-system graph starting from the largest ring.
    const ordered = [];
    const inQueue = new Set();
    const bfsQ = [unsorted[0]];
    inQueue.add(unsorted[0]);
    while (bfsQ.length > 0) {
      const cur = bfsQ.shift();
      ordered.push(cur);
      // Among unqueued ring systems that can reach `cur` (or be reached from it),
      // enqueue preferring the largest (already sorted by size in unsorted).
      for (const other of unsorted) {
        if (inQueue.has(other)) {
          continue;
        }
        if (ringSysReachable(cur, other) || ringSysReachable(other, cur)) {
          bfsQ.push(other);
          inQueue.add(other);
        }
      }
    }
    // Append any disconnected ring systems not yet ordered.
    for (const s of unsorted) {
      if (!inQueue.has(s)) {
        ordered.push(s);
      }
    }
    return ordered;
  })();

  // Keep track of all ring atom IDs so chain layout knows which atoms are ring atoms.
  const ringAtomSet = new Set(systems.flatMap(s => s.atomIds));

  for (let si = 0; si < systems.length; si++) {
    const system = systems[si];

    if (si === 0) {
      placeRingSystem(molecule, system, rings, bondLength, vec2(0, 0), coords);
    } else {
      // Try to anchor this ring system to an already-placed atom via a direct bond.
      let anchorAtomId    = null; // atom in THIS system that is bonded to a placed atom
      let anchorTargetPos = null; // where anchorAtomId should be placed
      let anchorOutAngle  = 0;   // outgoing direction from the placed neighbor

      const orderedSystemAtomIds = [...system.atomIds].sort((a, b) => _layoutCompareAtomIds(molecule, a, b));
      for (const atomId of orderedSystemAtomIds) {
        for (const nbId of _layoutNeighbors(molecule, atomId)) {
          if (!placed.has(nbId)) {
            continue;
          }
          const nbCoord = coords.get(nbId);
          if (!nbCoord) {
            continue;
          }

          // Outgoing direction: bisector of the largest angular gap around nbId,
          // ignoring the direction toward the new ring atom (atomId, not yet placed).
          // This is more robust than the centroid→nbId direction when nbId is bonded
          // to atoms in multiple ring systems (e.g. a spiro/junction atom connecting
          // benzene, a 5-ring, AND a cyclopropyl): the centroid direction may point
          // toward an existing ring rather than into free space.
          const placedNbAngles = _layoutNeighbors(molecule, nbId)
            .filter(id => id !== atomId && placed.has(id))
            .map(id => angleTo(nbCoord, coords.get(id)))
            .sort((a, b) => a - b);
          let outAngle;
          if (placedNbAngles.length > 0) {
            let gapStart = placedNbAngles[placedNbAngles.length - 1];
            let gapSize  = placedNbAngles[0] - placedNbAngles[placedNbAngles.length - 1] + TWO_PI;
            for (let g = 0; g < placedNbAngles.length - 1; g++) {
              const gap = placedNbAngles[g + 1] - placedNbAngles[g];
              if (gap > gapSize) {
                gapSize = gap; gapStart = placedNbAngles[g];
              }
            }
            outAngle = normalizeAngle(gapStart + gapSize / 2);
          } else {
            // nbId has no other placed neighbours — fall back to centroid direction.
            const nbSystem = systems.slice(0, si).find(s => s.atomIds.includes(nbId));
            outAngle = nbSystem ? angleTo(centroid(nbSystem.atomIds, coords), nbCoord) : 0;
          }

          anchorAtomId    = atomId;
          anchorOutAngle  = outAngle;
          anchorTargetPos = project(nbCoord, outAngle, bondLength);
          break;
        }
        if (anchorAtomId) {
          break;
        }
      }

      // Extended anchor search: look up to 5 hops through unplaced acyclic atoms.
      // This handles aromatic substituents hanging off a macrocycle backbone
      // via short aliphatic chains (e.g. Phe side chain: ring-C-C-macrocycle).
      if (!anchorAtomId) {
        // BFS from ring system atoms outward through unplaced, non-ring atoms.
        // We want to find the shortest path to an already-placed atom.
        const MAX_HOPS = 5;
        const visited  = new Set(system.atomIds);
        // queue entries: { id, hops, path } — path is [ring_atom, ..., frontier_atom]
        let frontier = orderedSystemAtomIds.map(id => ({ id, hops: 0, path: [id] }));
        outer2:
        for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
          const next = [];
          for (const { id, path } of frontier) {
            for (const nbId of _layoutNeighbors(molecule, id)) {
              if (visited.has(nbId)) {
                continue;
              }
              visited.add(nbId);
              const extPath = [...path, nbId]; // [ring_atom, ...intermediates, placed_atom]
              if (placed.has(nbId)) {
                // Found a placed atom via extPath.
                // extPath[0]   = atom in this ring system (the anchor)
                // extPath[1..n-2] = intermediate acyclic atoms to place
                // extPath[n-1] = already-placed atom
                const placedCoord  = coords.get(nbId);
                const nbSys        = systems.slice(0, si).find(s => s.atomIds.includes(nbId));
                // Direction: radially away from the placed ring system's center.
                // This is the direction extPath[n-1] → extPath[n-2] → ... → extPath[0].
                // If the found atom is a non-ring chain intermediate (placed by a prior
                // ring system's extended anchor), use the angular gap around its already-
                // placed neighbours so we don't collide with that earlier chain.
                let dirAngle;
                if (nbSys) {
                  dirAngle = angleTo(centroid(nbSys.atomIds, coords), placedCoord);
                } else {
                  const placedNbAngles = _layoutNeighbors(molecule, nbId)
                    .filter(id2 => placed.has(id2) && coords.has(id2))
                    .map(id2 => angleTo(placedCoord, coords.get(id2)))
                    .sort((a, b) => a - b);
                  if (placedNbAngles.length > 0) {
                    let gapStart = placedNbAngles[placedNbAngles.length - 1];
                    let gapSize  = placedNbAngles[0] - placedNbAngles[placedNbAngles.length - 1] + TWO_PI;
                    for (let g = 0; g < placedNbAngles.length - 1; g++) {
                      const gap = placedNbAngles[g + 1] - placedNbAngles[g];
                      if (gap > gapSize) {
                        gapSize = gap; gapStart = placedNbAngles[g];
                      }
                    }
                    dirAngle = normalizeAngle(gapStart + gapSize / 2);
                  } else {
                    dirAngle = angleTo(vec2(0, 0), placedCoord);
                  }
                }

                // Walk the chain from the placed end toward the ring system,
                // placing each intermediate atom at `bondLength` in `dirAngle`.
                let curCoord = placedCoord;
                for (let k = extPath.length - 2; k >= 1; k--) {
                  const midId   = extPath[k];
                  const midCoord = project(curCoord, dirAngle, bondLength);
                  coords.set(midId, midCoord);
                  placed.add(midId);
                  curCoord = midCoord;
                  // Keep the same direction — chain goes in a straight line for now.
                  // Phase B / refineCoords will handle exact geometry later.
                }

                // extPath[0] is the ring atom that will be the anchor.
                // Its target position is one bond further in the same direction.
                anchorAtomId    = extPath[0];
                anchorTargetPos = project(curCoord, dirAngle, bondLength);
                anchorOutAngle  = dirAngle; // outgoing direction AT the placed end
                break outer2;
              }
              if (!ringAtomSet.has(nbId)) {
                next.push({ id: nbId, hops: hop + 1, path: extPath });
              }
            }
          }
          frontier = next;
        }
      }

      if (anchorAtomId) {
        // Tentatively place the ring system centered at (0, 0), then rotate it so
        // anchorAtomId faces back toward the connecting ring, and translate it so
        // the anchor atom lands exactly at anchorTargetPos.
        // Try 12 evenly-spaced additional rotations and pick the orientation with
        // the fewest clashes against already-placed atoms.
        const tempCoords = new Map();
        placeRingSystem(molecule, system, rings, bondLength, vec2(0, 0), tempCoords);

        const tentativeAnchor = tempCoords.get(anchorAtomId);
        const currentAngle    = Math.atan2(tentativeAnchor.y, tentativeAnchor.x);
        const targetAngle     = normalizeAngle(anchorOutAngle + Math.PI);
        const baseRotation    = normalizeAngle(targetAngle - currentAngle);

        // Helper: apply rotation `rot` + translation so anchor lands at anchorTargetPos,
        // count how many atoms of the new ring system overlap existing placed atoms.
        const CLASH_THRESH = bondLength * 0.5;

        const applyAndCount = (extraRot) => {
          const rot    = baseRotation + extraRot;
          const cosR   = Math.cos(rot), sinR = Math.sin(rot);
          const ancRX  = tentativeAnchor.x * cosR - tentativeAnchor.y * sinR;
          const ancRY  = tentativeAnchor.x * sinR + tentativeAnchor.y * cosR;
          const tx     = anchorTargetPos.x - ancRX;
          const ty     = anchorTargetPos.y - ancRY;
          let clashes  = 0;
          for (const [, pos] of tempCoords) {
            const nx = pos.x * cosR - pos.y * sinR + tx;
            const ny = pos.x * sinR + pos.y * cosR + ty;
            for (const [pid] of coords) {
              if (!placed.has(pid)) {
                continue;
              }
              const pc = coords.get(pid);
              if (pc && Math.hypot(nx - pc.x, ny - pc.y) < CLASH_THRESH) {
                clashes++; break;
              }
            }
          }
          return { clashes, rot };
        };

        // Test 12 evenly spaced rotations (every 30°) relative to the base.
        const STEPS = 12;
        let best = applyAndCount(0);
        for (let k = 1; k < STEPS && best.clashes > 0; k++) {
          const candidate = applyAndCount(k * (TWO_PI / STEPS));
          if (candidate.clashes < best.clashes) {
            best = candidate;
          }
        }

        const cosR = Math.cos(best.rot), sinR = Math.sin(best.rot);
        const ancRX = tentativeAnchor.x * cosR - tentativeAnchor.y * sinR;
        const ancRY = tentativeAnchor.x * sinR + tentativeAnchor.y * cosR;
        const tx = anchorTargetPos.x - ancRX;
        const ty = anchorTargetPos.y - ancRY;

        for (const [id, pos] of tempCoords) {
          coords.set(id, {
            x: pos.x * cosR - pos.y * sinR + tx,
            y: pos.x * sinR + pos.y * cosR + ty
          });
        }
      } else {
        // No direct bond to placed atoms — place to the right (true disconnected fallback).
        let maxX = -Infinity;
        for (const id of placed) {
          const c = coords.get(id);
          if (c && c.x > maxX) {
            maxX = c.x;
          }
        }
        placeRingSystem(molecule, system, rings, bondLength, vec2(maxX + bondLength * 3, 0), coords);
      }
    }

    for (const id of system.atomIds) {
      placed.add(id);
    }
  }

  // Phase B — chain layout outward from ring-atom attachment points.
  for (const system of systems) {
    // Process ring atoms in descending order of their substituent subtree size so that
    // the ring atom with the largest chain is placed first at natural 120° angles,
    // and subsequent atoms use clash avoidance only when necessary.  This prevents the
    // common ortho-disubstituted case (e.g. aspirin) from forcing the larger chain into
    // a distorted angle because the smaller chain was placed first.
    const phaseBOrder = [...system.atomIds].sort((a, b) => {
      const unplacedA = _layoutNeighbors(molecule, a).filter(id => !placed.has(id));
      const unplacedB = _layoutNeighbors(molecule, b).filter(id => !placed.has(id));
      // BFS size of substituent subtree (non-ring side only)
      function chainSize(startId, ringSet) {
        const vis = new Set();
        const q = [startId];
        while (q.length) {
          const cur = q.shift();
          if (vis.has(cur)) {
            continue;
          }
          vis.add(cur);
          for (const nb of _layoutNeighbors(molecule, cur)) {
            if (!ringSet.has(nb) && !vis.has(nb)) {
              q.push(nb);
            }
          }
        }
        return vis.size;
      }
      const ringSet = new Set(system.atomIds);
      const sA = unplacedA.reduce((s, id) => s + chainSize(id, ringSet), 0);
      const sB = unplacedB.reduce((s, id) => s + chainSize(id, ringSet), 0);
      if (sB !== sA) {
        return sB - sA; // descending
      }
      return _layoutCompareAtomIds(molecule, a, b);
    });
    for (const atomId of phaseBOrder) {
      const atom      = molecule.atoms.get(atomId);
      if (!atom) {
        continue;
      }
      const unplaced  = _layoutNeighbors(molecule, atomId).filter(id => !placed.has(id));
      if (unplaced.length === 0) {
        continue;
      }

      // Incoming angle: from ring center toward this atom.
      const sysCenter = centroid(system.atomIds, coords);
      const myCoord   = coords.get(atomId);
      const incoming  = angleTo(myCoord, sysCenter); // toward center = "where we came from"

      layoutChain(molecule, atomId, incoming, placed, bondLength, coords, true);
    }
  }

  // Phase C — purely acyclic molecules (no rings at all).
  let acyclicRoot = null;
  if (rings.length === 0) {
    // When H atoms are suppressed, pre-mark them as "placed" (without coords)
    // so layoutChain never processes them.  H atoms placed in the grid during
    // Phase C clash detection would block valid heavy-atom positions (e.g. an
    // H atom on a methyl root coincides with an ideal placement for a
    // quaternary carbon, forcing a 30° rotation and bad chain geometry).
    // Phase D / Phase I will assign H coords from the parent regardless.
    if (suppressH) {
      for (const [id, atom] of molecule.atoms) {
        if (atom.name === 'H') {
          placed.add(id);
        }
      }
    }
    // Find the atom with highest degree as the root (stable layout).
    let maxDeg = -1;
    for (const [id] of molecule.atoms) {
      const deg = molecule.getDegree(id);
      if (deg > maxDeg || (deg === maxDeg && acyclicRoot && _layoutCompareAtomIds(molecule, id, acyclicRoot) < 0)) {
        maxDeg = deg; acyclicRoot = id;
      }
    }
    if (acyclicRoot && !placed.has(acyclicRoot)) {
      coords.set(acyclicRoot, vec2(0, 0));
      placed.add(acyclicRoot);
      layoutChain(molecule, acyclicRoot, Math.PI, placed, bondLength, coords, false);
    }
  }

  // Phase D — place explicit hydrogens.
  if (!suppressH) {
    placeHydrogens(molecule, coords, bondLength);
  } else {
    // For suppressed H atoms, assign parent coordinates (hidden by renderer).
    for (const [atomId, atom] of molecule.atoms) {
      if (atom.name !== 'H' || coords.has(atomId)) {
        continue;
      }
      const parentId = _layoutNeighbors(molecule, atomId)[0];
      if (parentId && coords.has(parentId)) {
        coords.set(atomId, { ...coords.get(parentId) });
      }
    }
  }

  // Phase F — analytic geometry refinement.
  // For each ring attachment atom re-places its substituents into the largest
  // angular gap using analytical bisection, then re-runs layoutChain.
  // Only needed (and beneficial) when rings are present.
  if (systems.length > 0) {
    refineCoords(molecule, coords, ringAtomSet, bondLength);
    // Re-place H atoms after refineCoords repositioned heavy-atom substituents.
    // refineCoords deletes subtree coords (including H) then re-runs layoutChain,
    // which no longer places H atoms, so they need to be re-placed here.
    if (!suppressH) {
      placeHydrogens(molecule, coords, bondLength);
    }
  }

  // Phase G — force-field relaxation.
  // For ring-containing molecules: ring atoms are frozen, chain atoms relaxed.
  // For purely acyclic molecules: only run if the initial layout produced a
  // near-collision between non-bonded atoms (< 0.6 × bondLength), which
  // indicates a badly-folded branch (e.g. a chain of adjacent quaternary
  // carbons where the DFS layout curls a branch back on itself).  Simple
  // acyclic molecules (chains, isobutane, etc.) produce exact analytic
  // geometry and must NOT be force-field-relaxed — strict 1e-9 bond-length
  // tests depend on that exactness.
  if (systems.length > 0) {
    // Freeze ALL ring atoms during force-field refinement.  The ring
    // placement phases (ellipse for large rings, regular polygon for small)
    // already produce correct backbone geometry; only side-chain atoms need
    // relaxation.  Making large-ring atoms semi-movable caused angle springs
    // on mixed ring/side-chain triplets to collapse backbone bond lengths.
    forceFieldRefine(molecule, coords, ringAtomSet, bondLength);

    // Bond-length snap: BFS outward from ring atoms, projecting each
    // non-ring atom to exactly `bondLength` from its already-processed
    // parent.  Processing in BFS order (ring → leaves) means every atom
    // is corrected relative to a fixed or already-corrected ancestor,
    // so corrections propagate outward without cascading back inward.
    {
      const isHAtom = id => molecule.atoms.get(id)?.name === 'H';
      const snapQueue  = [...ringAtomSet].filter(id => !isHAtom(id));
      const snapSeen   = new Set(snapQueue);
      while (snapQueue.length > 0) {
        const parentId = snapQueue.shift();
        const cp = coords.get(parentId);
        if (!cp) {
          continue;
        }
        for (const childId of _layoutNeighbors(molecule, parentId)) {
          if (snapSeen.has(childId) || isHAtom(childId)) {
            continue;
          }
          snapSeen.add(childId);
          const cc = coords.get(childId);
          if (!cc) {
            snapQueue.push(childId); continue;
          }
          // Project child to exactly bondLength from parent.
          const dx = cc.x - cp.x, dy = cc.y - cp.y;
          const d  = Math.hypot(dx, dy) || 1e-9;
          coords.set(childId, { x: cp.x + dx * bondLength / d,
            y: cp.y + dy * bondLength / d });
          snapQueue.push(childId);
        }
      }
    }

    // Cross-chain reconciliation: the BFS snap corrects each atom to exactly
    // bondLength from its spanning-tree parent, but bonds that bridge two
    // independent chain subtrees (e.g. a linker chain between two ring
    // systems) remain stretched because the snap satisfies each side
    // independently.  We iterate: force-field pass (pulls stretched bonds
    // toward bondLength) followed by BFS snap (restores per-chain bond
    // lengths), up to 3 times or until no bond exceeds 1.15 × bondLength.
    {
      const crossChainThreshold = bondLength * 1.15;
      const isHAtomCC = id => molecule.atoms.get(id)?.name === 'H';

      // Helper: BFS snap from ring atoms outward.
      const bfsSnapFromRings = () => {
        const snapQ    = [...ringAtomSet].filter(id => !isHAtomCC(id));
        const snapSeen = new Set(snapQ);
        while (snapQ.length > 0) {
          const pId = snapQ.shift();
          const cp = coords.get(pId);
          if (!cp) {
            continue;
          }
          for (const cId of _layoutNeighbors(molecule, pId)) {
            if (snapSeen.has(cId) || isHAtomCC(cId)) {
              continue;
            }
            snapSeen.add(cId);
            const cc = coords.get(cId);
            if (!cc) {
              snapQ.push(cId); continue;
            }
            const dx = cc.x - cp.x, dy = cc.y - cp.y;
            const d  = Math.hypot(dx, dy) || 1e-9;
            coords.set(cId, { x: cp.x + dx * bondLength / d,
              y: cp.y + dy * bondLength / d });
            snapQ.push(cId);
          }
        }
      };

      // Helper: check whether any heavy-atom bond exceeds the threshold.
      const hasCrossChainBond = () => {
        for (const [, bond] of molecule.bonds) {
          const [aId, bId] = bond.atoms;
          if (isHAtomCC(aId) || isHAtomCC(bId)) {
            continue;
          }
          const ca = coords.get(aId), cb = coords.get(bId);
          if (!ca || !cb) {
            continue;
          }
          if (Math.hypot(cb.x - ca.x, cb.y - ca.y) > crossChainThreshold) {
            return true;
          }
        }
        return false;
      };

      for (let ccIter = 0; ccIter < 3; ccIter++) {
        if (!hasCrossChainBond()) {
          break;
        }
        forceFieldRefine(molecule, coords, ringAtomSet, bondLength);
        bfsSnapFromRings();
      }
    }

    // Post-G ring-interior correction: the force field can push direct
    // ring substituents inside the ring polygon via angle springs.  For each
    // individual ring, check if any directly bonded non-ring atom ended up
    // inside the ring polygon; if so, relocate it to the exterior.
    //
    // Simple mirroring (origin - delta) fails for fused polycyclic systems:
    // a substituent on a ring-junction atom (in rings A and B) that is inside
    // ring A gets mirrored into ring B, then the ring-B pass mirrors it back —
    // an infinite oscillation leaving it inside a ring.  Instead we place the
    // atom in the direction AWAY FROM the average centroid of all rings that
    // contain the parent ring atom.  This is robust for ring-junction atoms
    // in fused polycyclics where angular-gap heuristics fail.  ringPolys is
    // hoisted so the proximity correction below can also use it.
    {
      const isHSub = id => molecule.atoms.get(id)?.name === 'H';

      // Precompute polygon data for every ring so the inner loop doesn't redo
      // per-ring sorting.  ringPolys is declared with var so the proximity
      // correction block below can access it.
      // eslint-disable-next-line no-var
      var ringPolys = rings.map(ring => {
        if (ring.length < 3) {
          return null;
        }
        const pts = ring.map(id => coords.get(id)).filter(Boolean);
        if (pts.length < 3) {
          return null;
        }
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        pts.sort((a, b) =>
          Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
        return { ring, ringSet: new Set(ring), pts, cx, cy };
      });

      const corrected = new Set();

      for (const rpd of ringPolys) {
        if (!rpd) {
          continue;
        }
        const { ring, ringSet, pts } = rpd;

        for (const ringId of ring) {
          const origin = coords.get(ringId);
          if (!origin) {
            continue;
          }
          for (const subId of _layoutNeighbors(molecule, ringId)) {
            if (ringSet.has(subId) || isHSub(subId) || corrected.has(subId)) {
              continue;
            }
            const subPos = coords.get(subId);
            if (!subPos || !pointInPolygon(subPos, pts)) {
              continue;
            }

            // Skip atoms that bridge two ring systems (inter-ring linkers).
            // Moving such an atom "outward from one ring" severs its bond to
            // the atom on the other ring's side.  We detect this by BFS: if
            // any non-ring atom reachable from subId (excluding ringId) is a
            // neighbour of a different ring atom, the subtree is anchored and
            // must not be relocated.
            {
              let anchored = false;
              const ancBfsQ = [subId];
              const ancSeen = new Set([subId, ringId]);
              outer2: while (ancBfsQ.length > 0) {
                const cur = ancBfsQ.shift();
                for (const nb of _layoutNeighbors(molecule, cur)) {
                  if (ancSeen.has(nb) || isHSub(nb)) {
                    continue;
                  }
                  if (ringAtomSet.has(nb)) {
                    anchored = true; break outer2;
                  }
                  ancSeen.add(nb);
                  ancBfsQ.push(nb);
                }
              }
              if (anchored) {
                continue;
              }
            }

            // subId is inside this ring.  Compute the outward direction from
            // ringId as the direction AWAY from the average centroid of all
            // rings that contain ringId.  This is robust for ring-junction
            // atoms (in 2+ rings) where the angular-gap heuristic fails when
            // all gaps are equal (~120° each in tricyclics).
            const containingRings = ringPolys.filter(r => r && r.ringSet.has(ringId));
            let outAngle;
            if (containingRings.length > 0) {
              const avgCx = containingRings.reduce((s, r) => s + r.cx, 0) / containingRings.length;
              const avgCy = containingRings.reduce((s, r) => s + r.cy, 0) / containingRings.length;
              outAngle = Math.atan2(origin.y - avgCy, origin.x - avgCx);
            } else {
              // Fallback: keep current direction, just ensure exact bondLength.
              outAngle = Math.atan2(subPos.y - origin.y, subPos.x - origin.x);
            }

            coords.set(subId, {
              x: origin.x + Math.cos(outAngle) * bondLength,
              y: origin.y + Math.sin(outAngle) * bondLength
            });
            corrected.add(subId);
          }
        }
      }
    }

    // Post-G proximity correction: the ring-interior check above only catches
    // atoms that are geometrically inside a ring polygon.  A second failure
    // mode exists in fused polycyclic systems: the force field can push a
    // direct ring substituent toward an adjacent ring atom (its 1-3 neighbour
    // through the ring junction) to the point where the two atoms nearly
    // overlap.  Because 1-3 pairs are excluded from non-bonded repulsion, the
    // force field cannot self-correct this.  We detect it here: any non-ring
    // atom within 0.75 × bondLength of a non-bonded ring atom is in a
    // clearly wrong position and gets relocated to the largest angular gap
    // around its bonded ring-atom parent (the same strategy used above).
    {
      const isHProx = id => molecule.atoms.get(id)?.name === 'H';
      const PROX_THRESH = bondLength * 0.75;

      for (const [subId] of molecule.atoms) {
        if (ringAtomSet.has(subId) || isHProx(subId)) {
          continue;
        }
        const subPos = coords.get(subId);
        if (!subPos) {
          continue;
        }

        // Find the bonded ring-atom parent (first bonded ring atom found).
        const parentRingId = _layoutNeighbors(molecule, subId)
          .find(id => ringAtomSet.has(id));
        if (parentRingId === undefined) {
          continue;
        }

        // Check proximity to non-bonded ring atoms.
        const bondedNbs = new Set(_layoutNeighbors(molecule, subId));
        let tooClose = false;
        for (const ringId of ringAtomSet) {
          if (bondedNbs.has(ringId)) {
            continue;
          }
          const rPos = coords.get(ringId);
          if (rPos && Math.hypot(subPos.x - rPos.x, subPos.y - rPos.y) < PROX_THRESH) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          continue;
        }

        // Skip inter-ring linkers — same anchored check as ring-interior correction.
        {
          let anchored = false;
          const ancBfsQ2 = [subId];
          const ancSeen2 = new Set([subId, parentRingId]);
          outer3: while (ancBfsQ2.length > 0) {
            const cur = ancBfsQ2.shift();
            for (const nb of _layoutNeighbors(molecule, cur)) {
              if (ancSeen2.has(nb) || isHProx(nb)) {
                continue;
              }
              if (ringAtomSet.has(nb)) {
                anchored = true; break outer3;
              }
              ancSeen2.add(nb);
              ancBfsQ2.push(nb);
            }
          }
          if (anchored) {
            continue;
          }
        }

        // Reposition using average-centroid outward direction around the
        // parent ring atom (same approach as ring-interior correction above).
        const origin = coords.get(parentRingId);
        if (!origin) {
          continue;
        }
        const containingRings2 = ringPolys.filter(r => r && r.ringSet.has(parentRingId));
        let outAngle2;
        if (containingRings2.length > 0) {
          const avgCx2 = containingRings2.reduce((s, r) => s + r.cx, 0) / containingRings2.length;
          const avgCy2 = containingRings2.reduce((s, r) => s + r.cy, 0) / containingRings2.length;
          outAngle2 = Math.atan2(origin.y - avgCy2, origin.x - avgCx2);
        } else {
          outAngle2 = Math.atan2(subPos.y - origin.y, subPos.x - origin.x);
        }

        coords.set(subId, {
          x: origin.x + Math.cos(outAngle2) * bondLength,
          y: origin.y + Math.sin(outAngle2) * bondLength
        });
      }
    }
    // Phase F2 — restore analytical ring-substituent angles after force-field
    // distortion.  Phase G's soft 1-4 non-bonded repulsion can displace direct
    // ring substituents from their analytically correct gap-bisector angles.
    // For each simple (non-inter-ring) chain: recompute the gap bisector from
    // the ring's current bond directions and re-layout the subtree from that
    // angle rather than the BFS-snapped (still-distorted) direction.
    // Inter-ring chains (subtree bridges to a second ring atom) are skipped.
    {
      const isHF2 = id => molecule.atoms.get(id)?.name === 'H';
      for (const ringId of ringAtomSet) {
        const ringPos = coords.get(ringId);
        if (!ringPos) {
          continue;
        }
        const subs = _layoutNeighbors(molecule, ringId)
          .filter(id => !ringAtomSet.has(id) && !isHF2(id));
        // Only correct single-substituent ring atoms.  For 2+ substituents,
        // Phase F (refineCoords) already used clash-aware placement; re-laying
        // from the raw gap bisector would spread gem groups onto adjacent atoms.
        if (subs.length !== 1) {
          continue;
        }

        // Analytical gap bisector: find the largest arc between ring bonds.
        const ringNbAngles = _layoutNeighbors(molecule, ringId)
          .filter(id => ringAtomSet.has(id))
          .map(id => {
            const c = coords.get(id);
            return Math.atan2(c.y - ringPos.y, c.x - ringPos.x);
          })
          .sort((a, b) => a - b);

        let bestGapStart = ringNbAngles[ringNbAngles.length - 1];
        let bestGapSize  = ringNbAngles[0] - ringNbAngles[ringNbAngles.length - 1] + TWO_PI;
        for (let k = 0; k < ringNbAngles.length - 1; k++) {
          const gap = ringNbAngles[k + 1] - ringNbAngles[k];
          if (gap > bestGapSize) {
            bestGapSize = gap; bestGapStart = ringNbAngles[k];
          }
        }

        // Distribute substituents symmetrically within the gap (same logic as
        // refineCoords): 1 sub → bisector; 2 subs → ±60° from bisector.
        const n = subs.length;
        let subAngles;
        if (n === 1) {
          subAngles = [normalizeAngle(bestGapStart + bestGapSize / 2)];
        } else if (n === 2) {
          const mid = normalizeAngle(bestGapStart + bestGapSize / 2);
          subAngles = [normalizeAngle(mid - DEG60), normalizeAngle(mid + DEG60)];
        } else {
          const step = bestGapSize / (n + 1);
          subAngles = subs.map((_, i) => normalizeAngle(bestGapStart + step * (i + 1)));
        }

        for (let si = 0; si < subs.length; si++) {
          const subId  = subs[si];
          const subPos = coords.get(subId);
          if (!subPos) {
            continue;
          }

          // BFS to collect the subtree and check if it bridges another ring.
          const subtree = new Set([subId]);
          const bfsQ = [subId];
          let anchored = false;
          outerF2: while (bfsQ.length > 0) {
            const cur = bfsQ.shift();
            for (const nb of _layoutNeighbors(molecule, cur)) {
              if (nb === ringId || subtree.has(nb) || isHF2(nb)) {
                continue;
              }
              if (ringAtomSet.has(nb)) {
                anchored = true; break outerF2;
              }
              subtree.add(nb);
              bfsQ.push(nb);
            }
          }
          if (anchored) {
            continue; // inter-ring chain — leave untouched
          }

          // Skip if the gap-bisector position falls inside a ring polygon that
          // contains ringId.  This guards ring-junction atoms in fused polycyclics
          // where the largest angular gap can point inward (into a ring), which
          // would undo the post-G ring-interior correction.
          const subAngle = subAngles[si];
          {
            const proposedPos = {
              x: ringPos.x + Math.cos(subAngle) * bondLength,
              y: ringPos.y + Math.sin(subAngle) * bondLength
            };
            const insideRing = typeof ringPolys !== 'undefined' && ringPolys.some(
              r => r && r.ringSet.has(ringId) && pointInPolygon(proposedPos, r.pts)
            );
            if (insideRing) {
              continue;
            }
          }
          const chainPlaced = new Set([...coords.keys()].filter(id => molecule.atoms.has(id)));
          for (const id of subtree) {
            chainPlaced.delete(id);
          }
          chainPlaced.add(ringId);
          for (const id of subtree) {
            coords.delete(id);
          }
          layoutChain(molecule, ringId, normalizeAngle(subAngle + Math.PI),
            chainPlaced, bondLength, coords, true);
        }
      }
      if (!suppressH) {
        placeHydrogens(molecule, coords, bondLength);
      }
    }

    straightenPreferredBackbone(molecule, coords, findPreferredBackbonePath(molecule));

  } else if (acyclicRoot !== null) {
    // Acyclic near-collision fallback: if the DFS layout folded a branch so
    // that two non-bonded heavy atoms ended up too close (< 0.6 × bondLength),
    // run the force field with ALL atoms movable to push them apart, then
    // restore exact bond lengths with a BFS snap from the root.
    const isHAtom2 = id => molecule.atoms.get(id)?.name === 'H';
    const heavyIds = [...coords.keys()].filter(id => molecule.atoms.has(id) && !isHAtom2(id));
    const bondedSet = new Set();
    for (const [, bond] of molecule.bonds) {
      bondedSet.add(`${bond.atoms[0]}\0${bond.atoms[1]}`);
      bondedSet.add(`${bond.atoms[1]}\0${bond.atoms[0]}`);
    }
    let hasNearCollision = false;
    outer3: for (let i = 0; i < heavyIds.length; i++) {
      const ci = coords.get(heavyIds[i]);
      for (let j = i + 1; j < heavyIds.length; j++) {
        if (bondedSet.has(`${heavyIds[i]}\0${heavyIds[j]}`)) {
          continue;
        }
        const cj = coords.get(heavyIds[j]);
        if (Math.hypot(ci.x - cj.x, ci.y - cj.y) < bondLength * 0.6) {
          hasNearCollision = true;
          break outer3;
        }
      }
    }
    if (hasNearCollision) {
      forceFieldRefine(molecule, coords, new Set(), bondLength);
      // Bond-length snap: BFS outward from the acyclic root so every bond is
      // restored to exactly bondLength (force field leaves them approximate).
      {
        const snapQueue = [acyclicRoot];
        const snapSeen  = new Set(snapQueue);
        while (snapQueue.length > 0) {
          const pId = snapQueue.shift();
          const cp  = coords.get(pId);
          if (!cp) {
            continue;
          }
          for (const cId of _layoutNeighbors(molecule, pId)) {
            if (snapSeen.has(cId) || isHAtom2(cId)) {
              continue;
            }
            snapSeen.add(cId);
            const cc = coords.get(cId);
            if (!cc) {
              snapQueue.push(cId); continue;
            }
            const dx = cc.x - cp.x, dy = cc.y - cp.y;
            const d  = Math.hypot(dx, dy) || 1e-9;
            coords.set(cId, { x: cp.x + dx * bondLength / d,
              y: cp.y + dy * bondLength / d });
            snapQueue.push(cId);
          }
        }
      }
    }

    // Straighten the preferred backbone for pure acyclic molecules: the DFS
    // zigzag can produce a hexagonal spiral (always turning the same direction)
    // when all atoms have degree ≤ 2.  This corrects turn direction alternation.
    straightenPreferredBackbone(molecule, coords, findPreferredBackbonePath(molecule));
  }

  optimizeAcyclicMultipleBondSubtrees(molecule, coords, bondLength);

  // Phase H — canonical orientation.
  // Rotate molecules so the principal axis (maximum spatial spread, from 2D
  // inertia tensor) is horizontal.  For long acyclic backbones (≥ 8 atoms)
  // normalizeOrientation aligns the start-to-end backbone direction instead.
  normalizeOrientation(coords, molecule);

  // Phase I — re-sync suppressed hydrogen positions.
  // Suppressed H atoms were placed at their parent's position in phase D,
  // but chain atoms may have moved during phases F and G (force-field and
  // refineCoords).  Refresh every suppressed H to its parent's final position
  // so that measured C-H / N-H bond lengths are correct.
  if (suppressH) {
    for (const [atomId, atom] of molecule.atoms) {
      if (atom.name !== 'H') {
        continue;
      }
      const parentId = _layoutNeighbors(molecule, atomId)[0];
      if (parentId && coords.has(parentId)) {
        coords.set(atomId, { ...coords.get(parentId) });
      }
    }
  }

  // Phase I.5 — enforce simple acyclic alkene E/Z geometry.
  // This pass is intentionally conservative: it only corrects non-ring
  // double bonds whose intended E/Z assignment is explicitly derivable from
  // the stored directional bond markers.
  enforceAcyclicEZStereo(molecule, coords);

  // Phase I.6 — restore local trigonal geometry for carbonyl / imino centers.
  // This catches side-chain carbonyls that can be skewed by the earlier ring
  // and force-field passes without broadly perturbing alkene geometry.
  {
    const trigonalCtx = buildRefinementContext(molecule, coords, {
      bondLength,
      freezeRings: systems.length > 0,
      freezeChiralCenters: false,
      includeRingSystemCandidates: false
    });
    const idealized = idealizeStrictTrigonalCenters(molecule, coords, trigonalCtx, {
      requireNonWorseScore: false
    });
    if (idealized !== coords) {
      coords.clear();
      for (const [atomId, pos] of idealized) {
        coords.set(atomId, pos);
      }
    }
  }

  // Phase J — level to the nearest 30° bond-angle grid, then write back.
  levelCoords(coords, molecule);
  for (const [atomId, { x, y }] of coords) {
    const atom = molecule.atoms.get(atomId);
    if (atom) {
      atom.x = x; atom.y = y;
    }
  }

  return coords;
}
