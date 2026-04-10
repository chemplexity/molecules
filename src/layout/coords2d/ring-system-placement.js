/** @module layout/coords2d/ring-system-placement */

import { vec2, angleTo, project, circumradius, centroid, normalizeAngle } from './geom2d.js';
import { evaluateKamadaKawaiLayout, layoutBridgedComponentKK } from './kk-layout.js';
import { forceFieldRefine } from './force-field-refine.js';

const TWO_PI = 2 * Math.PI;

/**
 * Picks a deterministic starting ring for ring-system placement.
 * @param {object} molecule - Molecule-like graph.
 * @param {number[]} ringIds - Ring IDs in the system.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {(molecule: object, firstAtomId: string, secondAtomId: string) => number} compareAtomIds - Atom ordering helper.
 * @returns {number} Preferred starting ring ID.
 */
export function pickPreferredStartRingId(molecule, ringIds, rings, compareAtomIds) {
  return ringIds.reduce((bestRingId, ringId) => {
    if (rings[ringId].length !== rings[bestRingId].length) {
      return rings[ringId].length > rings[bestRingId].length ? ringId : bestRingId;
    }
    const bestMinAtomId = [...rings[bestRingId]].sort((a, b) => compareAtomIds(molecule, a, b))[0];
    const currentMinAtomId = [...rings[ringId]].sort((a, b) => compareAtomIds(molecule, a, b))[0];
    return compareAtomIds(molecule, currentMinAtomId, bestMinAtomId) < 0 ? ringId : bestRingId;
  }, ringIds[0]);
}

/**
 * Places a ring that shares multiple atoms with an already placed ring.
 * @param {object} molecule - Molecule-like graph.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} curRingIdx - Index of the already placed ring.
 * @param {number} nextRingIdx - Index of the ring being placed.
 * @param {string[]} sharedAtomIds - Shared atom IDs between the rings.
 * @returns {void}
 */
export function placeSharedRingAnalytically(molecule, rings, bondLength, coords, curRingIdx, nextRingIdx, sharedAtomIds) {
  const nextRing = rings[nextRingIdx];
  const n2 = nextRing.length;
  const curCenter = centroid(rings[curRingIdx], coords);

  let sA = sharedAtomIds[0],
    sB = sharedAtomIds[1];
  const iA = nextRing.indexOf(sA);
  const iB = nextRing.indexOf(sB);
  const adjacent = Math.abs(iA - iB) === 1 || Math.abs(iA - iB) === n2 - 1;
  if (!adjacent && sharedAtomIds.length > 2) {
    outer: for (let p = 0; p < sharedAtomIds.length; p++) {
      for (let q = p + 1; q < sharedAtomIds.length; q++) {
        const ia = nextRing.indexOf(sharedAtomIds[p]);
        const ib = nextRing.indexOf(sharedAtomIds[q]);
        if (Math.abs(ia - ib) === 1 || Math.abs(ia - ib) === n2 - 1) {
          sA = sharedAtomIds[p];
          sB = sharedAtomIds[q];
          break outer;
        }
      }
    }
  }

  const cA = coords.get(sA);
  const cB = coords.get(sB);
  const midx = (cA.x + cB.x) / 2;
  const midy = (cA.y + cB.y) / 2;
  const edx = cB.x - cA.x;
  const edy = cB.y - cA.y;
  const elen = Math.hypot(edx, edy) || 1;
  const px = -edy / elen;
  const py = edx / elen;
  const toCur = (curCenter.x - midx) * px + (curCenter.y - midy) * py;
  const side = toCur > 0 ? -1 : 1;
  const inrad = bondLength / (2 * Math.tan(Math.PI / n2));
  const newCenter = vec2(midx + side * px * inrad, midy + side * py * inrad);
  const prePlacedIds = nextRing.filter(id => coords.has(id));
  let arcFitted = false;
  if (prePlacedIds.length >= 2) {
    const prePlacedSet = new Set(prePlacedIds);
    let fi = -1;
    for (let k = 0; k < n2; k++) {
      if (!prePlacedSet.has(nextRing[k])) {
        fi = k;
        break;
      }
    }
    if (fi >= 0) {
      let b1 = (fi - 1 + n2) % n2;
      while (!prePlacedSet.has(nextRing[b1])) {
        b1 = (b1 - 1 + n2) % n2;
      }
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
      const pEnd = coords.get(nextRing[b2]);
      const chord = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);
      const nBonds = nFree + 1;

      if (nFree > 0 && chord > 1e-9 && chord < nBonds * bondLength - 1e-9) {
        let rLo = bondLength / 2 + 1e-9;
        let rHi = nBonds * bondLength;
        for (let iter = 0; iter < 64; iter++) {
          const rMid = (rLo + rHi) / 2;
          const sinArg = bondLength / (2 * rMid);
          const arcChord = sinArg <= 1 ? 2 * rMid * Math.sin(nBonds * Math.asin(sinArg)) : 0;
          if (arcChord < chord) {
            rLo = rMid;
          } else {
            rHi = rMid;
          }
        }
        const R = (rLo + rHi) / 2;
        const mx = (pStart.x + pEnd.x) / 2;
        const my = (pStart.y + pEnd.y) / 2;
        const cdx = pEnd.x - pStart.x;
        const cdy = pEnd.y - pStart.y;
        const cpx = -cdy / chord;
        const cpy = cdx / chord;
        let acx = 0;
        let acy = 0;
        for (const id of prePlacedIds) {
          const p = coords.get(id);
          acx += p.x;
          acy += p.y;
        }
        acx /= prePlacedIds.length;
        acy /= prePlacedIds.length;
        let dotPre = (curCenter.x - mx) * cpx + (curCenter.y - my) * cpy;
        if (Math.abs(dotPre) < 1e-6) {
          dotPre = (acx - mx) * cpx + (acy - my) * cpy;
        }
        const arcSide = dotPre >= 0 ? -1 : 1;
        const h = Math.sqrt(Math.max(0, R * R - (chord / 2) ** 2));
        const arcCx = mx + arcSide * cpx * h;
        const arcCy = my + arcSide * cpy * h;
        const angleS = Math.atan2(pStart.y - arcCy, pStart.x - arcCx);
        const angleE = Math.atan2(pEnd.y - arcCy, pEnd.x - arcCx);
        const alpha = 2 * Math.asin(bondLength / (2 * R));
        let cwDelta = angleS - angleE;
        while (cwDelta < 0) {
          cwDelta += TWO_PI;
        }
        const totalArc = nBonds * alpha;
        let arcDirMul = Math.abs(cwDelta - totalArc) <= Math.abs(TWO_PI - cwDelta - totalArc) ? -1 : 1;
        const firstFreeAngle = angleS + arcDirMul * alpha;
        const firstFreeDot = (arcCx + R * Math.cos(firstFreeAngle) - mx) * cpx + (arcCy + R * Math.sin(firstFreeAngle) - my) * cpy;
        if (dotPre * firstFreeDot > 0) {
          arcDirMul = -arcDirMul;
        }

        let k2 = (b1 + 1) % n2;
        let step2 = 1;
        while (k2 !== b2) {
          coords.set(nextRing[k2], vec2(arcCx + R * Math.cos(angleS + step2 * arcDirMul * alpha), arcCy + R * Math.sin(angleS + step2 * arcDirMul * alpha)));
          k2 = (k2 + 1) % n2;
          step2++;
        }

        for (let kc = (b1 + 1) % n2; kc !== b2; kc = (kc + 1) % n2) {
          const freeId = nextRing[kc];
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
              bridgeClash = true;
              break;
            }
          }
          if (!bridgeClash) {
            continue;
          }
          const ki = nextRing.indexOf(freeId);
          const nbA = coords.get(nextRing[(ki - 1 + n2) % n2]);
          const nbB = coords.get(nextRing[(ki + 1) % n2]);
          if (!nbA || !nbB) {
            continue;
          }
          const nbMx = (nbA.x + nbB.x) / 2;
          const nbMy = (nbA.y + nbB.y) / 2;
          const chordDx = nbB.x - nbA.x;
          const chordDy = nbB.y - nbA.y;
          const chordLen = Math.hypot(chordDx, chordDy) || 1;
          const halfCh = chordLen / 2;
          const perpX = -chordDy / chordLen;
          const perpY = chordDx / chordLen;
          const preferredSideDot = (curCenter.x - nbMx) * perpX + (curCenter.y - nbMy) * perpY;
          const preferredSide = preferredSideDot >= 0 ? -1 : 1;
          const exactLegH = halfCh < bondLength ? Math.sqrt(bondLength * bondLength - halfCh * halfCh) : 0;
          const otherPlaced = [...coords.entries()].filter(
            ([otherId]) => otherId !== freeId && otherId !== nextRing[(ki - 1 + n2) % n2] && otherId !== nextRing[(ki + 1) % n2]
          );
          const candidateScore = candidate => {
            let minDist = Infinity;
            for (const [, otherPos] of otherPlaced) {
              minDist = Math.min(minDist, Math.hypot(candidate.x - otherPos.x, candidate.y - otherPos.y));
            }
            return minDist;
          };
          const heightCandidates = exactLegH > 1e-6 ? [0.35, 0.6, 0.85, 1].map(scale => exactLegH * scale) : [0.2, 0.35, 0.5, 0.65].map(scale => bondLength * scale);
          let bestCandidate = null;
          let bestScore = -Infinity;
          let bestMaxBond = Infinity;
          for (const height of heightCandidates) {
            for (const candidateSide of [preferredSide, -preferredSide]) {
              const candidate = vec2(nbMx + candidateSide * perpX * height, nbMy + candidateSide * perpY * height);
              const score = candidateScore(candidate);
              const maxBond = Math.max(Math.hypot(candidate.x - nbA.x, candidate.y - nbA.y), Math.hypot(candidate.x - nbB.x, candidate.y - nbB.y));
              if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && maxBond < bestMaxBond - 1e-6)) {
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
    const startIdx = nextRing.indexOf(sA);
    const step = TWO_PI / n2;
    const baseAngle = angleTo(newCenter, cA);
    const nextIdxCW = (startIdx + 1) % n2;
    const arrayDir = nextRing[nextIdxCW] === sB ? 1 : -1;
    const dAng = normalizeAngle(angleTo(newCenter, cB) - angleTo(newCenter, cA));
    const angularDir = dAng > 0 ? 1 : -1;
    for (let i = 0; i < n2; i++) {
      const idx = (((startIdx + i * arrayDir) % n2) + n2) % n2;
      const atomId = nextRing[idx];
      if (!coords.has(atomId)) {
        coords.set(atomId, project(newCenter, baseAngle + i * step * angularDir, circumradius(n2, bondLength)));
      }
    }
  }
}

/**
 * Places a ring that shares a single spiro atom with an already placed ring.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} curRingIdx - Index of the already placed ring.
 * @param {number} nextRingIdx - Index of the ring being placed.
 * @param {string} sharedAtomId - Shared spiro atom ID.
 * @returns {void}
 */
export function placeSpiroRingAnalytically(rings, bondLength, coords, curRingIdx, nextRingIdx, sharedAtomId) {
  const nextRing = rings[nextRingIdx];
  const n2 = nextRing.length;
  const curCenter = centroid(rings[curRingIdx], coords);
  const spiroCoord = coords.get(sharedAtomId);
  const awayAngle = angleTo(curCenter, spiroCoord);
  const radius = circumradius(n2, bondLength);
  const newCenter = project(spiroCoord, awayAngle, radius);
  const backAngle = awayAngle + Math.PI;
  const startIdx = nextRing.indexOf(sharedAtomId);
  const step = TWO_PI / n2;
  for (let i = 0; i < n2; i++) {
    const idx = (startIdx + i) % n2;
    const atomId = nextRing[idx];
    if (!coords.has(atomId)) {
      coords.set(atomId, project(newCenter, backAngle - i * step, radius));
    }
  }
}

/**
 * Places a bridged component with a KK seed and local refinement.
 * @param {object} molecule - Molecule-like graph.
 * @param {{atomIds: string[]}} component - Bridged component descriptor.
 * @param {Array<Array<string>>} rings - Ring atom lists.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {number|null} [anchorRingId] - Optional anchor ring index. Defaults to `null`.
 * @param {{x: number, y: number}} [origin] - Preferred origin for unanchored placement. Defaults to `vec2(0, 0)`.
 * @returns {boolean} True when placement succeeds.
 */
export function placeBridgedComponentWithKK(molecule, component, rings, coords, bondLength, anchorRingId = null, origin = vec2(0, 0)) {
  const pinnedAtomIds = component.atomIds.filter(atomId => coords.has(atomId));
  let center = origin;
  if (pinnedAtomIds.length > 1) {
    center = centroid(pinnedAtomIds, coords);
  } else if (pinnedAtomIds.length === 1) {
    const pinnedCoord = coords.get(pinnedAtomIds[0]);
    if (anchorRingId != null) {
      const anchorCenter = centroid(rings[anchorRingId], coords);
      center = project(pinnedCoord, angleTo(anchorCenter, pinnedCoord), circumradius(Math.max(component.atomIds.length, 3), bondLength));
    } else {
      center = pinnedCoord;
    }
  }

  const result = layoutBridgedComponentKK(molecule, component.atomIds, {
    coords,
    pinnedAtomIds,
    center,
    bondLength
  });
  const kkCoords = new Map(result.coords);
  forceFieldRefine(molecule, kkCoords, new Set(pinnedAtomIds), bondLength);
  if (!evaluateKamadaKawaiLayout(molecule, component.atomIds, kkCoords, bondLength)) {
    return false;
  }

  const componentAtomIdSet = new Set(component.atomIds);
  for (const atomId of component.atomIds) {
    const atom = molecule.atoms.get(atomId);
    const pos = kkCoords.get(atomId);
    if (!atom || atom.name === 'H' || !pos) {
      continue;
    }
    for (const [otherId, otherPos] of coords) {
      if (componentAtomIdSet.has(otherId)) {
        continue;
      }
      const otherAtom = molecule.atoms.get(otherId);
      if (!otherAtom || otherAtom.name === 'H') {
        continue;
      }
      const isBonded = atom.bonds.some(bondId => {
        const bond = molecule.bonds.get(bondId);
        return bond && bond.atoms.includes(otherId);
      });
      if (isBonded) {
        continue;
      }
      if (Math.hypot(pos.x - otherPos.x, pos.y - otherPos.y) < 0.5) {
        return false;
      }
    }
  }

  for (const atomId of component.atomIds) {
    coords.set(atomId, kkCoords.get(atomId));
  }
  return true;
}
