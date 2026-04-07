/** @module layout/coords2d/orientation */

import { vec2, rotateCoords } from './geom2d.js';
import { findPreferredBackbonePath } from './stereo-enforcement.js';

// ---------------------------------------------------------------------------
// Canonical orientation — rotate so principal axis is horizontal
// ---------------------------------------------------------------------------

function _trimTerminalPeripheralHeteroEndpoints(path, molecule) {
  if (!Array.isArray(path) || path.length < 3 || !molecule) {
    return path;
  }

  let start = 0;
  let end = path.length - 1;
  const isTerminalPeripheralHetero = atomId => {
    const atom = molecule.atoms.get(atomId);
    if (!atom || atom.name === 'H' || atom.name === 'C') {
      return false;
    }
    const heavyDegree = atom.getNeighbors(molecule).filter(nb => nb.name !== 'H').length;
    return heavyDegree <= 1;
  };

  while (end - start + 1 >= 3 && isTerminalPeripheralHetero(path[start])) {
    start++;
  }
  while (end - start + 1 >= 3 && isTerminalPeripheralHetero(path[end])) {
    end--;
  }
  return path.slice(start, end + 1);
}

function _isLandscapeChainBond(molecule, aId, bId) {
  const bond = molecule.getBond(aId, bId);
  const order = bond?.properties.order ?? 1;
  return Boolean(bond && !bond.properties.aromatic && (order === 1 || order === 2));
}

function _longestNonRingLandscapePath(molecule) {
  const ringAtoms = new Set(molecule.getRings().flat());
  const heavyIds = [...molecule.atoms.keys()].filter(atomId => {
    const atom = molecule.atoms.get(atomId);
    return atom && atom.name !== 'H' && !ringAtoms.has(atomId);
  });
  if (heavyIds.length < 2) {
    return null;
  }

  const adjacency = new Map();
  for (const atomId of heavyIds) {
    const atom = molecule.atoms.get(atomId);
    const neighbors = atom
      .getNeighbors(molecule)
      .filter(neighbor => neighbor.name !== 'H' && !ringAtoms.has(neighbor.id))
      .filter(neighbor => _isLandscapeChainBond(molecule, atomId, neighbor.id))
      .map(neighbor => neighbor.id);
    adjacency.set(atomId, neighbors);
  }

  let bestPath = null;
  const nonCarbonCount = path => path.reduce((count, atomId) => count + (molecule.atoms.get(atomId)?.name === 'C' ? 0 : 1), 0);
  const comparePaths = (candidate, incumbent) => {
    if (!incumbent) {
      return 1;
    }
    if (candidate.length !== incumbent.length) {
      return candidate.length - incumbent.length;
    }
    return nonCarbonCount(incumbent) - nonCarbonCount(candidate);
  };

  for (const startId of heavyIds) {
    const prev = new Map([[startId, null]]);
    const queue = [startId];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const curId = queue[queueHead++];
      for (const nbId of adjacency.get(curId) ?? []) {
        if (prev.has(nbId)) {
          continue;
        }
        prev.set(nbId, curId);
        queue.push(nbId);
      }
    }

    for (const endId of heavyIds) {
      if (endId === startId || !prev.has(endId)) {
        continue;
      }
      const path = [];
      for (let curId = endId; curId != null; curId = prev.get(curId)) {
        path.push(curId);
      }
      path.reverse();
      if (comparePaths(path, bestPath) > 0) {
        bestPath = path;
      }
    }
  }

  return bestPath;
}

function _landscapePathMinLength(molecule) {
  return molecule.getRings().length > 0 ? 6 : 8;
}

function _orientationPathScore(path, molecule) {
  if (!path?.length) {
    return -Infinity;
  }

  const ringAtoms = new Set(molecule.getRings().flat());
  const endpoints = [path[0], path[path.length - 1]];
  const ringAnchoredEndpoints = endpoints.reduce((count, atomId) => {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      return count;
    }
    return count + (atom.getNeighbors(molecule).some(neighbor => neighbor.name !== 'H' && ringAtoms.has(neighbor.id)) ? 1 : 0);
  }, 0);
  const terminalLeafEndpoints = endpoints.reduce((count, atomId) => {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      return count;
    }
    const heavyDegree = atom.getNeighbors(molecule).filter(neighbor => neighbor.name !== 'H').length;
    return count + (heavyDegree <= 1 ? 1 : 0);
  }, 0);

  return path.length + ringAnchoredEndpoints * 1.5 - terminalLeafEndpoints * 0.25;
}

function _preferredLandscapeOrientationPath(molecule) {
  const preferredBackbone = findPreferredBackbonePath(molecule);
  const longestNonRingPath = _trimTerminalPeripheralHeteroEndpoints(_longestNonRingLandscapePath(molecule), molecule);
  const preferLongerPath = candidate => {
    if (!candidate?.length) {
      return longestNonRingPath?.length >= 2 ? longestNonRingPath : null;
    }
    if (!longestNonRingPath?.length || _orientationPathScore(candidate, molecule) >= _orientationPathScore(longestNonRingPath, molecule)) {
      return candidate;
    }
    return longestNonRingPath;
  };

  if (!preferredBackbone?.path?.length) {
    return longestNonRingPath?.length >= 2 ? longestNonRingPath : null;
  }

  const trimmedPath = _trimTerminalPeripheralHeteroEndpoints(preferredBackbone.path, molecule);
  if (trimmedPath.length < 2) {
    return longestNonRingPath?.length >= 2 ? longestNonRingPath : null;
  }
  if (preferredBackbone.ringCount === 0) {
    return preferLongerPath(trimmedPath);
  }

  const ringAtoms = new Set(molecule.getRings().flat());
  let bestRun = null;
  let currentRun = [];
  const commitRun = () => {
    if (currentRun.length >= 2 && (!bestRun || currentRun.length > bestRun.length)) {
      bestRun = [...currentRun];
    }
    currentRun = [];
  };

  for (const atomId of trimmedPath) {
    if (ringAtoms.has(atomId)) {
      commitRun();
      continue;
    }
    currentRun.push(atomId);
  }
  commitRun();
  return preferLongerPath(bestRun);
}

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
export function normalizeOrientation(coords, molecule) {
  if (coords.size < 2) {
    return;
  }

  const heavyIds = [...coords.keys()].filter(id => molecule.atoms.has(id) && molecule.atoms.get(id).name !== 'H');
  if (heavyIds.length < 2) {
    return;
  }

  const orientPath = _preferredLandscapeOrientationPath(molecule);
  if (orientPath && orientPath.length >= _landscapePathMinLength(molecule)) {
    const start = coords.get(orientPath[0]);
    const end = coords.get(orientPath[orientPath.length - 1]);
    if (start && end) {
      const ang = Math.atan2(end.y - start.y, end.x - start.x);
      if (Math.abs(ang) >= 1e-6) {
        let sx = 0;
        let sy = 0;
        for (const id of heavyIds) {
          const p = coords.get(id);
          sx += p.x;
          sy += p.y;
        }
        rotateCoords(coords, vec2(sx / heavyIds.length, sy / heavyIds.length), -ang);
      }

      let sx = 0;
      let sy = 0;
      for (const id of heavyIds) {
        const p = coords.get(id);
        sx += p.x;
        sy += p.y;
      }
      const cx = sx / heavyIds.length;
      const cy = sy / heavyIds.length;
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
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
      return;
    }
  }

  // Only include heavy (non-H) atoms in the inertia calculation so that
  // explicit hydrogens — placed radially, often asymmetrically — do not
  // distort the principal axis of the heavy-atom skeleton.

  // Centroid of heavy atoms.
  let sx = 0,
    sy = 0;
  for (const id of heavyIds) {
    const p = coords.get(id);
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / heavyIds.length,
    cy = sy / heavyIds.length;

  // 2D inertia tensor (relative to centroid).
  // Ixx = Σ dy², Iyy = Σ dx², Ixy = -Σ dx·dy
  let Ixx = 0,
    Iyy = 0,
    Ixy = 0;
  for (const id of heavyIds) {
    const p = coords.get(id);
    const dx = p.x - cx,
      dy = p.y - cy;
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
  const I0 = Ixx * Math.cos(angle0) ** 2 + Iyy * Math.sin(angle0) ** 2 + Ixy * Math.sin(2 * angle0); // correct sign: I(θ) = Ixx·c² + Iyy·s² + Ixy·sin2θ
  const I1 = Ixx + Iyy - I0; // trace is invariant
  // Pick the candidate with smaller inertia = elongation direction.
  let elon = I0 <= I1 ? angle0 : angle0 + Math.PI / 2;
  // Normalise to (−π/2, π/2]: axes at θ and θ+π are identical, so prefer |θ| ≤ π/2.
  if (elon > Math.PI / 2) {
    elon -= Math.PI;
  }
  if (elon <= -Math.PI / 2) {
    elon += Math.PI;
  }

  if (Math.abs(elon) > 1e-6) {
    // Rotate ALL atoms (including H) about the heavy-atom centroid so the
    // elongation axis becomes horizontal.
    const cosA = Math.cos(-elon),
      sinA = Math.sin(-elon);
    // Collect all entries first so Map mutation doesn't affect the traversal.
    const entries = [...coords.entries()];
    for (const [id, pos] of entries) {
      const dx = pos.x - cx,
        dy = pos.y - cy;
      coords.set(id, vec2(cx + dx * cosA - dy * sinA, cy + dx * sinA + dy * cosA));
    }
  }

  // Portrait-to-landscape guard: the inertia tensor guarantees the principal
  // axis is aligned with X, but for nearly isotropic ring systems (I0 ≈ I1)
  // it can pick the wrong candidate and leave the molecule taller than wide.
  // Explicitly rotate 90° whenever the heavy-atom bounding box is portrait.
  {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
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

  // Resolve 180° orientation ambiguity for ring-containing molecules.
  // After the inertia-tensor rotation, the elongation axis is horizontal but
  // there are two valid orientations (ring left or ring right).  A single
  // side-chain CH₂ addition can shift the inertia just enough to flip the
  // choice, inverting the whole ring orientation between near-identical molecules.
  // Convention: the ring-system centroid should be on the positive-x side of
  // the heavy-atom centroid.  When it is not, rotate 180° to correct it.
  const rings = molecule.getRings();
  if (rings.length > 0) {
    const ringAtomIds = new Set(rings.flatMap(r => r));
    let rxSum = 0;
    let rCount = 0;
    for (const id of ringAtomIds) {
      const p = coords.get(id);
      if (p && molecule.atoms.get(id)?.name !== 'H') {
        rxSum += p.x;
        rCount++;
      }
    }
    if (rCount > 0 && rxSum / rCount < cx - 1e-6) {
      rotateCoords(coords, vec2(cx, cy), Math.PI);
    }
  }
}

export function shouldPreferFinalLandscapeOrientation(molecule) {
  const preferredBackbone = findPreferredBackbonePath(molecule);
  if (preferredBackbone && preferredBackbone.ringCount === 0 && preferredBackbone.path.length >= 8) {
    return true;
  }
  const orientPath = _preferredLandscapeOrientationPath(molecule);
  return Boolean(orientPath && orientPath.length >= _landscapePathMinLength(molecule));
}

export function preferLandscapeOrientation(coords, molecule) {
  const heavyIds = [...coords.keys()].filter(id => molecule.atoms.has(id) && molecule.atoms.get(id).name !== 'H');
  if (heavyIds.length < 2) {
    return;
  }

  let sx = 0;
  let sy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const id of heavyIds) {
    const p = coords.get(id);
    if (!p) {
      continue;
    }
    sx += p.x;
    sy += p.y;
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

  if (maxY - minY <= maxX - minX) {
    return;
  }

  rotateCoords(coords, vec2(sx / heavyIds.length, sy / heavyIds.length), Math.PI / 2);
}
