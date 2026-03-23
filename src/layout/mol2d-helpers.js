/**
 * mol2d-helpers.js — shared 2D rendering utilities
 *
 * Pure functions and constants used by both the browser renderer (index.html)
 * and the server-side SVG/PNG exporter (render2d.js).  No DOM, no D3, no
 * Node-only dependencies — safe to import in any environment.
 */

import { assignCIPRanks } from '../core/Molecule.js';

// ---------------------------------------------------------------------------
// CPK atom colours
// ---------------------------------------------------------------------------
export const CPK = {
  H: '#FFFFFF', He: '#D9FFFF', Li: '#CC80FF', Be: '#C2FF00',
  B: '#FFB5B5', C: '#333333', N: '#3050F8', O: '#FF0D0D',
  F: '#90E050', Ne: '#B3E3F5', Na: '#AB5CF2', Mg: '#8AFF00',
  Al: '#BFA6A6', Si: '#F0C8A0', P: '#FF8000', S: '#C8A000',
  Cl: '#1FF01F', Ar: '#80D1E3', K: '#8F40D4', Ca: '#3DFF00',
  Sc: '#E6E6E6', Ti: '#BFC2C7', V: '#A6A6AB', Cr: '#8A99C7',
  Mn: '#9C7AC7', Fe: '#E06633', Co: '#F090A0', Ni: '#50D050',
  Cu: '#C88033', Zn: '#7D80B0', Br: '#A62929', I: '#940094'
};
const DEFAULT_COLOR = '#FF69B4';

/** Returns the CPK fill colour for an element symbol. */
export function atomColor(sym) {
  return CPK[sym] ?? DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// Stereo bond constants (same in both renderers)
// ---------------------------------------------------------------------------
export const WEDGE_HALF_W = 6;  // px — half-width at the wide end
export const WEDGE_DASHES = 6;  // number of hash lines in a dashed bond

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Length of 2D vector (x, y). Returns at least 1 to avoid division by zero. */
export function vecLen(x, y) {
  return Math.sqrt(x * x + y * y) || 1;
}

/**
 * Axis-aligned bounding box of a set of atoms with 2D coordinates.
 *
 * @param {Array<{x:number, y:number}>} atoms - Array of objects with x and y properties.
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number, cx: number, cy: number }}
 */
export function atomBBox(atoms) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of atoms) {
    if (a.x < minX) {
      minX = a.x;
    }
    if (a.x > maxX) {
      maxX = a.x;
    }
    if (a.y < minY) {
      minY = a.y;
    }
    if (a.y > maxY) {
      maxY = a.y;
    }
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Unit perpendicular vector (rotated 90° CCW) for a direction (dx, dy). */
export function perpUnit(dx, dy) {
  const len = vecLen(dx, dy);
  return { nx: -dy / len, ny: dx / len };
}

/** Shorten a line segment by d1 at the start and d2 at the end. */
export function shortenLine(x1, y1, x2, y2, d1, d2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = vecLen(dx, dy);
  const ux = dx / len, uy = dy / len;
  return {
    x1: x1 + ux * d1, y1: y1 + uy * d1,
    x2: x2 - ux * d2, y2: y2 - uy * d2
  };
}

/**
 * Returns +1 or -1 indicating which side of the bond axis the secondary
 * parallel line of a double bond should be placed on, based on the
 * positions of neighbouring heavy atoms.
 *
 * @param {import('../core/Atom.js').Atom} a1
 * @param {import('../core/Atom.js').Atom} a2
 * @param {import('../core/Molecule.js').Molecule} mol
 * @param {function} toSVG - converts an atom to { x, y } in SVG space
 * @returns {1|-1}
 */
export function secondaryDir(a1, a2, mol, toSVG) {
  const resolveNbs = (atom, excludeId) =>
    atom.getNeighbors(mol).filter(n => n && n.id !== excludeId && n.name !== 'H' && n.x != null);
  const allNb = [...resolveNbs(a1, a2.id), ...resolveNbs(a2, a1.id)];
  if (allNb.length === 0) {
    return 1;
  }
  const s1 = toSVG(a1), s2 = toSVG(a2);
  const { nx, ny } = perpUnit(s2.x - s1.x, s2.y - s1.y);
  const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
  let dot = 0;
  for (const n of allNb) {
    const sn = toSVG(n);
    dot += (sn.x - mid.x) * nx + (sn.y - mid.y) * ny;
  }
  return dot >= 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Atom label helpers
// ---------------------------------------------------------------------------

/**
 * Half-width of an atom label bounding box in SVG pixels.
 *
 * @param {string|null} label
 * @param {number} fontSize - font size in px
 * @returns {number}
 */
export function labelHalfW(label, fontSize) {
  if (!label) {
    return 0;
  }
  return fontSize * 0.38 * label.length + 4;
}

/**
 * Half-height of an atom label bounding box in SVG pixels.
 *
 * @param {string|null} label
 * @param {number} fontSize - font size in px
 * @returns {number}
 */
export function labelHalfH(label, fontSize) {
  if (!label) {
    return 0;
  }
  return fontSize * 0.58 + 2;
}

/**
 * Returns the display label for an atom in 2D skeletal notation, or null
 * for unlabelled carbons.  The H-count subscript is placed left or right
 * of the element symbol based on the average neighbour direction.
 *
 * @param {import('../core/Atom.js').Atom} atom
 * @param {Map<string,number>} hCounts - atom id → implicit-H count
 * @param {function} toSVG - converts an atom to { x, y } in SVG space
 * @param {import('../core/Molecule.js').Molecule} mol
 * @returns {string|null}
 */
export function getAtomLabel(atom, hCounts, toSVG, mol) {
  const symbol = atom.name;
  const hCount = hCounts.get(atom.id) ?? 0;
  const charge = atom.properties.charge ?? 0;
  if (symbol === 'C' && charge === 0 && atom.getNeighbors(mol).some(n => n.name !== 'H')) {
    return null;
  }
  if (hCount === 0) {
    return symbol;
  }
  const hStr = hCount === 1 ? 'H' : `H${hCount}`;
  const aSVG = toSVG(atom);
  let avgDx = 0, nbCount = 0;
  for (const n of atom.getNeighbors(mol)) {
    if (n && n.x != null) {
      avgDx += toSVG(n).x - aSVG.x; nbCount++;
    }
  }
  return (nbCount > 0 && avgDx > 0) ? hStr + symbol : symbol + hStr;
}

// ---------------------------------------------------------------------------
// Stereochemistry
// ---------------------------------------------------------------------------

/**
 * Returns a Map from bond ID → `'wedge'` | `'dash'` for all chiral centers
 * in the molecule that have 2D coordinates assigned.
 *
 * Picks exactly one bond per chiral center, preferring visible exocyclic
 * substituents, then visible ring atoms, then H.  Within each tier the bond
 * with the largest vertical offset from the center is chosen (most
 * perpendicular to the main chain).  The wedge/dash type is determined via
 * parity-aware CIP winding so the correct absolute configuration is conveyed
 * regardless of which substituent is chosen.
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @returns {Map<string, 'wedge'|'dash'>}
 */
export function pickStereoWedges(mol) {
  const result = new Map();
  for (const centerId of mol.getChiralCenters()) {
    const center = mol.atoms.get(centerId);
    if (!center || center.x == null) {
      continue;
    }
    const chirality = center.properties.chirality;
    if (!chirality) {
      continue;
    }

    const neighbors = center.getNeighbors(mol).filter(n => n && n.x != null);
    if (neighbors.length !== 4) {
      continue;
    }

    const ranks = assignCIPRanks(centerId, neighbors.map(n => n.id), mol);
    const entries = neighbors.map((n, i) => {
      const bond = [...mol.bonds.values()].find(b =>
        (b.atoms[0] === centerId && b.atoms[1] === n.id) ||
        (b.atoms[1] === centerId && b.atoms[0] === n.id)
      );
      return { atom: n, rank: ranks[i], bond };
    }).filter(e => e.bond);

    if (entries.length !== 4) {
      continue;
    }
    entries.sort((a, b) => a.rank - b.rank);

    const v = (e) => ({ x: e.atom.x - center.x, y: e.atom.y - center.y });
    const cross2D = (u, w) => u.x * w.y - u.y * w.x;
    const visible = entries.filter(e => e.atom.visible !== false);
    const exocyclic = visible.filter(e => !e.atom.isInRing(mol));
    const exocyclicHeavy = exocyclic.filter(e => e.atom.name !== 'H');
    const candidates = exocyclicHeavy.length > 0 ? exocyclicHeavy
      : exocyclic.length > 0 ? exocyclic
        : visible.length > 0 ? visible
          : entries;

    // Pick the highest CIP rank among candidates — this is a topological,
    // rotation-invariant criterion that prefers the most substituted group.
    const chosen = candidates.reduce((best, cand) =>
      cand.rank > best.rank || (cand.rank === best.rank && cand.bond.id < best.bond.id)
        ? cand : best
    );

    const others = entries.filter(e => e !== chosen).sort((a, b) => b.rank - a.rank);

    // Compute vectors for the signed-area winding check.  If the H atom (lowest
    // CIP rank, always visible=false) is one of the three remaining substituents,
    // its placed 2D position was computed from ALL non-H neighbours — including the
    // chosen exocyclic atom whose coordinates can differ slightly between JavaScript
    // engines (V8 vs JavaScriptCore) due to force-field refinement.  Using that
    // engine-dependent position in the cross-product can flip the winding sign and
    // produce the wrong wedge/dash type in the browser vs Node.js.
    //
    // Fix: when H is in `others`, replace its vector with the analytic "opposite of
    // the centroid of the two heavy atoms in `others`" — a value that depends only
    // on ring-atom (frozen, deterministic) coordinates, not on variable exocyclic ones.
    const heavyOtherVecs = others
      .filter(e => !(e.atom.name === 'H' && e.atom.visible === false))
      .map(v);

    const safeV = (e) => {
      if (e.atom.name === 'H' && e.atom.visible === false && heavyOtherVecs.length === 2) {
        const sx = -(heavyOtherVecs[0].x + heavyOtherVecs[1].x);
        const sy = -(heavyOtherVecs[0].y + heavyOtherVecs[1].y);
        const len = vecLen(sx, sy);
        // Scale to the same magnitude as the first heavy vector so cross products
        // are numerically comparable (sign is all that matters, but stability helps).
        const bl = vecLen(heavyOtherVecs[0].x, heavyOtherVecs[0].y);
        return { x: sx / len * bl, y: sy / len * bl };
      }
      return v(e);
    };

    const [vA, vB, vD] = others.map(safeV);
    const signedArea = cross2D(vA, vB) + cross2D(vB, vD) + cross2D(vD, vA);
    const lowerCount = entries.filter(e => e.rank < chosen.rank).length;
    let computed = signedArea > 0 ? 'S' : 'R';
    if (lowerCount % 2 === 1) {
      computed = computed === 'S' ? 'R' : 'S';
    }
    result.set(chosen.bond.id, computed === chirality ? 'dash' : 'wedge');
  }
  return result;
}

// ---------------------------------------------------------------------------
// kekulize — assign localizedOrder (1 or 2) to aromatic bonds that lack it.
//
// Uses DFS augmenting-path maximum matching on the aromatic π-subgraph.
// Bonds that already have localizedOrder (e.g. from InChI parsing) are
// left untouched.  The function mutates bond.properties in-place and is
// idempotent — calling it twice has no additional effect.
// ---------------------------------------------------------------------------
export function kekulize(mol) {
  const aroBonds = [];
  for (const bond of mol.bonds.values()) {
    if (bond.properties.aromatic && bond.properties.localizedOrder == null) {
      aroBonds.push(bond);
    }
  }
  if (aroBonds.length === 0) {
    return;
  }

  const aroAtomIds = new Set();
  for (const b of aroBonds) {
    aroAtomIds.add(b.atoms[0]); aroAtomIds.add(b.atoms[1]);
  }

  // Neutral σ-frame valence for common aromatic elements.
  // Used to determine whether an atom has capacity for a π (double) bond.
  const SIGMA_VAL = {
    B: 3, C: 4, N: 3, O: 2, F: 1,
    Si: 4, P: 3, S: 2, Cl: 1, As: 3, Se: 2, Br: 1, Te: 2, I: 1
  };

  // For each aromatic atom, sum the σ-frame contribution of every bond it has
  // (treating all aromatic bonds as order 1, non-aromatic bonds at face value).
  // This tells us how much of the atom's valence is already committed to the σ
  // skeleton, leaving the remainder for a possible π bond.
  const sigmaBO = new Map();
  for (const id of aroAtomIds) {
    sigmaBO.set(id, 0);
  }
  for (const bond of mol.bonds.values()) {
    const [a, c] = bond.atoms;
    const contrib = bond.properties.aromatic ? 1 : (bond.properties.order ?? 1);
    if (aroAtomIds.has(a)) {
      sigmaBO.set(a, sigmaBO.get(a) + contrib);
    }
    if (aroAtomIds.has(c)) {
      sigmaBO.set(c, sigmaBO.get(c) + contrib);
    }
  }

  // An atom can hold a π bond only when its available sigma-frame valence
  // leaves room for one more bond order. Positive charges can expand that
  // capacity for common aromatic heteroatoms (for example pyrylium O+ and
  // pyridinium [nH+]), while negative charges can reduce it.
  // Examples that are correctly excluded:
  //   Indolizine N (3 aro bonds, val 3): 3 − 3 = 0 → lone-pair donor, no C=N
  //   Furan O     (2 aro bonds, val 2): 2 − 2 = 0 → lone-pair donor, no C=O
  //   Pyrrole N–H (2 aro bonds + 1 H):  3 − 3 = 0 → lone-pair donor
  //   Pyridine N  (2 aro bonds, val 3): 3 − 2 = 1 → included ✓
  const canHaveDouble = new Set();
  for (const id of aroAtomIds) {
    const atom = mol.atoms.get(id);
    const neutralBase = SIGMA_VAL[atom.name] ?? 4;
    const adjustedBase = Math.max(0, neutralBase + (atom?.properties.charge ?? 0));
    if (adjustedBase - sigmaBO.get(id) >= 1) {
      canHaveDouble.add(id);
    }
  }

  // Build matching adjacency — only bonds between two π-capable atoms.
  const adj = new Map();
  for (const id of canHaveDouble) {
    adj.set(id, []);
  }
  for (const b of aroBonds) {
    const [a, c] = b.atoms;
    if (canHaveDouble.has(a) && canHaveDouble.has(c)) {
      adj.get(a).push({ bondId: b.id, otherId: c });
      adj.get(c).push({ bondId: b.id, otherId: a });
    }
  }

  const mate = new Map();
  for (const id of canHaveDouble) {
    mate.set(id, null);
  }
  const matchedBond = new Map();

  function tryAugment(startId) {
    const visited = new Set([startId]);
    function dfs(v) {
      for (const { bondId, otherId: u } of adj.get(v)) {
        if (visited.has(u)) {
          continue;
        }
        visited.add(u);
        const mateOfU = mate.get(u);
        if (mateOfU === null || dfs(mateOfU)) {
          mate.set(v, u); mate.set(u, v);
          matchedBond.set(v, bondId); matchedBond.set(u, bondId);
          return true;
        }
      }
      return false;
    }
    return dfs(startId);
  }

  for (const id of canHaveDouble) {
    if (mate.get(id) === null) {
      tryAugment(id);
    }
  }

  const doubleBondIds = new Set();
  for (const [atomId, bondId] of matchedBond) {
    if (mate.get(atomId) !== null) {
      doubleBondIds.add(bondId);
    }
  }
  for (const b of aroBonds) {
    b.properties.localizedOrder = doubleBondIds.has(b.id) ? 2 : 1;
  }
}
