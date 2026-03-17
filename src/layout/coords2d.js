/** @module layout/coords2d */

const DEFAULT_BOND_LENGTH = 1.5;
const TWO_PI = 2 * Math.PI;
const DEG60 = Math.PI / 3;   // 60°
const DEG120 = 2 * Math.PI / 3;

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
    // startAngle = 0 (rightmost atom first) → flat-top hexagon (ChemDraw convention).
    const ring = rings[ringIds[0]];
    placeRing(ring, origin.x, origin.y, bondLength, 0, coords);
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
  const startRingId = ringIds.reduce((best, ri) =>
    rings[ri].length > rings[best].length ? ri : best, ringIds[0]);
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
              // Detect this and push the bridge atom outward by 3 × the perpendicular
              // height h = sqrt(BL² − (chord/2)²), which gives exactly BL separation
              // from the clashing atom while keeping the bond lengths equal.
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
                const halfCh = Math.hypot(nbB.x - nbA.x, nbB.y - nbA.y) / 2;
                const legH   = halfCh < bondLength
                  ? Math.sqrt(bondLength * bondLength - halfCh * halfCh) : bondLength;
                const outDx  = nbMx - curCenter.x, outDy = nbMy - curCenter.y;
                const outLen = Math.hypot(outDx, outDy) || 1;
                coords.set(freeId, vec2(nbMx + (outDx / outLen) * 3 * legH,
                  nbMy + (outDy / outLen) * 3 * legH));
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
    const neighbors = molecule.getNeighbors(atomId).filter(id => !placed.has(id));
    if (neighbors.length === 0) {
      continue;
    }

    const outAngle = normalizeAngle(incoming + Math.PI);

    const isLinear = molecule.atoms.get(atomId)?.bonds.some(bId =>
      (molecule.bonds.get(bId)?.properties.order ?? 1) === 3
    ) ?? false;

    // For non-ring atoms with ≥2 unplaced children and at least one already-placed
    // heavy neighbor (i.e. the parent in the BFS tree), use the "largest angular gap"
    // strategy: place children evenly inside the gap between the placed neighbors.
    // This is the same principle refineCoords uses for ring substituents, but applied
    // directly during the initial chain traversal.  It prevents a successive chain of
    // quaternary carbons from folding children back toward earlier atoms.
    //
    // The n=1 case is excluded deliberately — single children use the zig-zag logic in
    // computeChildAngles to produce 120° chain angles.
    const isH = id => molecule.atoms.get(id)?.name === 'H';
    const placedNbs = molecule.getNeighbors(atomId)
      .filter(id => placed.has(id) && !isH(id));

    let angles;
    if (!fRing && !isLinear && neighbors.length >= 2 && placedNbs.length > 0) {
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
      if (placedNbs.length === 0) {
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
    if (countClashes(angles, origin, coords, bondLength, grid) + linearPenalty(angles) > 0) {
      const INC = Math.PI / 6;
      const steps = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
      let best = angles;
      let bestScore = countClashes(angles, origin, coords, bondLength, grid) + linearPenalty(angles);
      for (const k of steps) {
        const delta = k * INC;
        const candidate = !fRing && !isLinear && neighbors.length >= 2 && placedNbs.length > 0
          ? angles.map(a => normalizeAngle(a + delta))
          : computeChildAngles(neighbors.length, outAngle + delta, false, incoming + delta, isLinear);
        const score = countClashes(candidate, origin, coords, bondLength, grid) + linearPenalty(candidate);
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

    const neighbors = molecule.getNeighbors(atomId);
    if (neighbors.length !== 1) {
      continue;
    }

    const parentId    = neighbors[0];
    const parentCoord = coords.get(parentId);
    if (!parentCoord) {
      continue;
    }

    // Compute the average direction of all OTHER neighbors of parent.
    const parentNeighbors = molecule.getNeighbors(parentId).filter(id => id !== atomId);
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
  // sp: triple bond present → 180°
  const hasTriple = atom.bonds.some(bId =>
    (molecule.bonds.get(bId)?.properties.order ?? 1) === 3
  );
  if (hasTriple) {
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
      for (const nb of molecule.getNeighbors(cur)) {
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
    const subA = molecule.getNeighbors(a).filter(id => !frozen.has(id) && !isH(id) && allAtomIds.has(id));
    const subB = molecule.getNeighbors(b).filter(id => !frozen.has(id) && !isH(id) && allAtomIds.has(id));
    const sizeA = subA.reduce((s, id) => s + subtreeSize(id), 0);
    const sizeB = subB.reduce((s, id) => s + subtreeSize(id), 0);
    return sizeB - sizeA; // descending: largest first
  });

  for (const atomId of frozenList) {
    const origin = coords.get(atomId);
    if (!origin) {
      continue;
    }
    const allNeighbors  = molecule.getNeighbors(atomId).filter(id => allAtomIds.has(id));
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

    // Divide the gap evenly among substituents.
    const nSub = subNeighbors.length;
    const step = bestGapSize / (nSub + 1);
    const proposedAngles = Array.from({ length: nSub }, (_, i) =>
      normalizeAngle(bestGapStart + step * (i + 1))
    );

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
        for (const nb of molecule.getNeighbors(cur)) {
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
        for (const nb of molecule.getNeighbors(subId)) {
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
  // 180° for sp (any triple bond), 120° for everything else in 2D.
  function idealBondAngle(atomId) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      return DEG120;
    }
    if (atom.bonds.some(bId => (molecule.bonds.get(bId)?.properties.order ?? 1) === 3)) {
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

  if (Math.abs(elon) < 1e-6) {
    return;
  } // already aligned

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
    const unsorted = detectRingSystems(rings).sort((a, b) => b.atomIds.length - a.atomIds.length);
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
        for (const nb of molecule.getNeighbors(cur)) {
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

      for (const atomId of system.atomIds) {
        for (const nbId of molecule.getNeighbors(atomId)) {
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
          const placedNbAngles = molecule.getNeighbors(nbId)
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
        let frontier = system.atomIds.map(id => ({ id, hops: 0, path: [id] }));
        outer2:
        for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
          const next = [];
          for (const { id, path } of frontier) {
            for (const nbId of molecule.getNeighbors(id)) {
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
                  const placedNbAngles = molecule.getNeighbors(nbId)
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
      const unplacedA = molecule.getNeighbors(a).filter(id => !placed.has(id));
      const unplacedB = molecule.getNeighbors(b).filter(id => !placed.has(id));
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
          for (const nb of molecule.getNeighbors(cur)) {
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
      return sB - sA; // descending
    });
    for (const atomId of phaseBOrder) {
      const atom      = molecule.atoms.get(atomId);
      if (!atom) {
        continue;
      }
      const unplaced  = molecule.getNeighbors(atomId).filter(id => !placed.has(id));
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
      if (deg > maxDeg) {
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
      const parentId = molecule.getNeighbors(atomId)[0];
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
        for (const childId of molecule.getNeighbors(parentId)) {
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

    // Post-G ring-interior correction: the force field can push direct
    // ring substituents inside the ring polygon via angle springs.  For each
    // individual ring, check if any directly bonded non-ring atom ended up
    // inside the ring polygon; if so, mirror it to the exterior side.
    {
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const ringSet = new Set(ring);
        const ringPolyPts = ring.map(id => coords.get(id)).filter(Boolean);
        if (ringPolyPts.length < 3) continue;
        const rCx = ringPolyPts.reduce((s, p) => s + p.x, 0) / ringPolyPts.length;
        const rCy = ringPolyPts.reduce((s, p) => s + p.y, 0) / ringPolyPts.length;
        ringPolyPts.sort((a, b) =>
          Math.atan2(a.y - rCy, a.x - rCx) - Math.atan2(b.y - rCy, b.x - rCx));

        for (const ringId of ring) {
          const origin = coords.get(ringId);
          if (!origin) continue;
          for (const subId of molecule.getNeighbors(ringId)) {
            if (ringSet.has(subId)) continue;         // skip other ring atoms
            if (molecule.atoms.get(subId)?.name === 'H') continue;
            const subPos = coords.get(subId);
            if (!subPos) continue;
            if (pointInPolygon(subPos, ringPolyPts)) {
              // Mirror the substituent through the ring atom to the exterior.
              const dx = subPos.x - origin.x, dy = subPos.y - origin.y;
              coords.set(subId, { x: origin.x - dx, y: origin.y - dy });
            }
          }
        }
      }
    }
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
          for (const cId of molecule.getNeighbors(pId)) {
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
  }

  // Phase H — canonical orientation.
  // Rotate ring-containing molecules so the principal axis (maximum spatial
  // spread, from 2D inertia tensor) is horizontal.  Acyclic molecules are
  // exempt: their DFS zigzag already produces a natural horizontal layout
  // and bond-length exactness tests depend on the unchanged geometry.
  if (systems.length > 0) {
    normalizeOrientation(coords, molecule);
  }

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
      const parentId = molecule.getNeighbors(atomId)[0];
      if (parentId && coords.has(parentId)) {
        coords.set(atomId, { ...coords.get(parentId) });
      }
    }
  }

  // Phase E — write back coordinates to atom.properties.
  for (const [atomId, { x, y }] of coords) {
    const atom = molecule.atoms.get(atomId);
    if (atom) {
      atom.x = x; atom.y = y;
    }
  }

  return coords;
}
