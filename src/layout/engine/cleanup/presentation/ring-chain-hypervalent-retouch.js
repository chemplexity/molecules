/** @module cleanup/presentation/ring-chain-hypervalent-retouch */

import { auditLayout } from '../../audit/audit.js';
import { computeBounds } from '../../geometry/bounds.js';
import { add, rotate, sub } from '../../geometry/vec2.js';
import { describePathLikeIsolatedRingChain } from '../../topology/isolated-ring-chain.js';
import { compareCanonicalAtomIds } from '../../topology/canonical-order.js';
import { collectCutSubtree } from '../subtree-utils.js';

const HYPERVALENT_BRANCH_CENTER_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const HYPERVALENT_BRANCH_LIGAND_ELEMENTS = new Set(['O', 'N', 'S', 'Se', 'F', 'Cl']);
const MAX_BRANCH_HEAVY_ATOMS = 10;
const MAX_BRANCH_ATOMS = 16;
const MAX_RETOUCH_PASSES = 12;
const ROTATION_CANDIDATES = Object.freeze(
  Array.from({ length: 12 }, (_value, index) => ((index + 1) * Math.PI) / 12)
    .flatMap(angle => (Math.abs(angle - Math.PI) <= 1e-9 ? [Math.PI] : [angle, -angle]))
);

function otherBondAtomId(bond, atomId) {
  return bond.a === atomId ? bond.b : bond.a;
}

function isVisibleHeavyAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return Boolean(atom && atom.element !== 'H' && !(layoutGraph.options?.suppressH && atom.visible === false));
}

function subtreeHeavyAtomCount(layoutGraph, atomIds) {
  return atomIds.filter(atomId => isVisibleHeavyAtom(layoutGraph, atomId)).length;
}

function subtreeContainsRingAtom(layoutGraph, atomIds) {
  return atomIds.some(atomId => (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0);
}

function subtreeContainsHypervalentBranchCenter(layoutGraph, atomIds) {
  const atomIdSet = new Set(atomIds);
  return atomIds.some(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || !HYPERVALENT_BRANCH_CENTER_ELEMENTS.has(atom.element)) {
      return false;
    }
    let ligandCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      const neighborAtom = layoutGraph.atoms.get(otherBondAtomId(bond, atomId));
      if (neighborAtom && atomIdSet.has(neighborAtom.id) && HYPERVALENT_BRANCH_LIGAND_ELEMENTS.has(neighborAtom.element)) {
        ligandCount++;
      }
    }
    return ligandCount >= 3;
  });
}

function ringChainRingAtomIds(ringChain) {
  return new Set((ringChain?.ringSystems ?? []).flatMap(ringSystem => ringSystem.atomIds ?? []));
}

function hypervalentBranchCandidates(layoutGraph, ringChain) {
  const ringAtomIds = ringChainRingAtomIds(ringChain);
  const candidates = [];
  const seenKeys = new Set();
  for (const anchorAtomId of ringAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
        continue;
      }
      const rootAtomId = otherBondAtomId(bond, anchorAtomId);
      if (!isVisibleHeavyAtom(layoutGraph, rootAtomId) || ringAtomIds.has(rootAtomId)) {
        continue;
      }
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)]
        .filter(atomId => layoutGraph.atoms.has(atomId));
      const key = subtreeAtomIds.slice().sort().join(':');
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      const heavyAtomCount = subtreeHeavyAtomCount(layoutGraph, subtreeAtomIds);
      if (
        subtreeAtomIds.length > MAX_BRANCH_ATOMS
        || heavyAtomCount > MAX_BRANCH_HEAVY_ATOMS
        || subtreeContainsRingAtom(layoutGraph, subtreeAtomIds)
        || !subtreeContainsHypervalentBranchCenter(layoutGraph, subtreeAtomIds)
      ) {
        continue;
      }
      candidates.push({
        anchorAtomId,
        rootAtomId,
        subtreeAtomIds
      });
    }
  }
  candidates.sort((firstCandidate, secondCandidate) => {
    if (firstCandidate.anchorAtomId !== secondCandidate.anchorAtomId) {
      return compareCanonicalAtomIds(firstCandidate.anchorAtomId, secondCandidate.anchorAtomId, layoutGraph.canonicalAtomRank);
    }
    return compareCanonicalAtomIds(firstCandidate.rootAtomId, secondCandidate.rootAtomId, layoutGraph.canonicalAtomRank);
  });
  return candidates;
}

function rotateSubtree(inputCoords, anchorPosition, subtreeAtomIds, angle) {
  const coords = new Map(inputCoords);
  for (const atomId of subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    coords.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), angle)));
  }
  return coords;
}

function auditScore(audit, bounds) {
  return (
    audit.bondLengthFailureCount * 100_000_000
    + audit.severeOverlapCount * 10_000_000
    + (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000
    + (audit.ringSubstituentReadabilityFailureCount ?? 0) * 100_000
    + (audit.inwardRingSubstituentCount ?? 0) * 100_000
    + (audit.outwardAxisRingSubstituentFailureCount ?? 0) * 100_000
    + audit.labelOverlapCount * 10_000
    + audit.severeOverlapPenalty * 1_000
    - Math.min(bounds.width / Math.max(bounds.height, 1e-6), 4) * 1_000
  );
}

function countDoesNotWorsen(candidateAudit, baseAudit, key) {
  return (candidateAudit[key] ?? 0) <= (baseAudit[key] ?? 0);
}

function bestBranchRetouch(layoutGraph, inputCoords, candidate, options, baseAudit) {
  const anchorPosition = inputCoords.get(candidate.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const baseBounds = computeBounds(inputCoords, [...inputCoords.keys()]);
  const baseScore = auditScore(baseAudit, baseBounds);
  let best = null;
  for (const angle of ROTATION_CANDIDATES) {
    const coords = rotateSubtree(inputCoords, anchorPosition, candidate.subtreeAtomIds, angle);
    const audit = auditLayout(layoutGraph, coords, {
      bondLength: options.bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    if (
      !countDoesNotWorsen(audit, baseAudit, 'bondLengthFailureCount')
      || !countDoesNotWorsen(audit, baseAudit, 'severeOverlapCount')
      || !countDoesNotWorsen(audit, baseAudit, 'visibleHeavyBondCrossingCount')
      || ((audit.stereoContradiction ?? false) && !(baseAudit.stereoContradiction ?? false))
    ) {
      continue;
    }
    const bounds = computeBounds(coords, [...coords.keys()]);
    const score = auditScore(audit, bounds);
    if (score >= baseScore - 1e-9) {
      continue;
    }
    if (!best || score < best.score - 1e-9) {
      best = {
        coords,
        audit,
        score,
        movedAtomIds: candidate.subtreeAtomIds
      };
    }
  }
  return best;
}

/**
 * Rotates small sulfate/phosphate-like branches on path-like isolated ring
 * chains when their terminal ligands cross the next ring/linker bonds.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinates.
 * @param {object} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, movedAtomIds: string[], audit: object|null}} Retouch result.
 */
export function runRingChainHypervalentBranchRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  let coords = inputCoords;
  let audit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses
  });
  let changed = false;
  const movedAtomIds = [];

  for (let pass = 0; pass < MAX_RETOUCH_PASSES; pass++) {
    let best = null;
    for (const component of layoutGraph.components ?? []) {
      const ringChain = describePathLikeIsolatedRingChain(layoutGraph, component);
      if (!ringChain) {
        continue;
      }
      for (const candidate of hypervalentBranchCandidates(layoutGraph, ringChain)) {
        const retouch = bestBranchRetouch(layoutGraph, coords, candidate, {
          bondLength,
          bondValidationClasses
        }, audit);
        if (retouch && (!best || retouch.score < best.score)) {
          best = retouch;
        }
      }
    }
    if (!best) {
      break;
    }
    coords = best.coords;
    audit = best.audit;
    changed = true;
    movedAtomIds.push(...best.movedAtomIds);
  }

  return {
    coords,
    changed,
    movedAtomIds,
    audit
  };
}
