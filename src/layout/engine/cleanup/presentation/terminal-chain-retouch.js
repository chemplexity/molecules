/** @module cleanup/presentation/terminal-chain-retouch */

import { auditLayout } from '../../audit/audit.js';
import { computeBounds } from '../../geometry/bounds.js';
import { add, angleOf, angularDifference, centroid, fromAngle, sub } from '../../geometry/vec2.js';
import { describePathLikeIsolatedRingChain } from '../../topology/isolated-ring-chain.js';

const MIN_TERMINAL_CHAIN_ATOM_COUNT = 8;
const MIN_TERMINAL_CHAIN_CARBON_COUNT = 7;
const TERMINAL_CHAIN_ANGLE_STEP = Math.PI / 18;
const TERMINAL_CHAIN_ZIGZAG_ANGLE = Math.PI / 3;
const TERMINAL_CHAIN_AXIS_WEIGHT = 2500;
const TERMINAL_CHAIN_ANGLE_VALUES = Object.freeze(
  Array.from({ length: 36 }, (_value, index) => -Math.PI + index * TERMINAL_CHAIN_ANGLE_STEP)
);

function otherBondAtomId(bond, atomId) {
  return bond.a === atomId ? bond.b : bond.a;
}

function heavyNeighborIds(layoutGraph, atomId) {
  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .map(bond => otherBondAtomId(bond, atomId))
    .filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
}

function findBond(layoutGraph, firstAtomId, secondAtomId) {
  const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondByAtomPair.get(key) ?? null;
}

function isRetouchableChainBond(layoutGraph, firstAtomId, secondAtomId) {
  const bond = findBond(layoutGraph, firstAtomId, secondAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

function orderedTerminalChain(layoutGraph, rootAtomId, anchorAtomId) {
  const atomIds = [rootAtomId];
  let previousAtomId = anchorAtomId;
  let currentAtomId = rootAtomId;
  const seenAtomIds = new Set([anchorAtomId, rootAtomId]);

  while (currentAtomId != null) {
    const nextAtomIds = heavyNeighborIds(layoutGraph, currentAtomId)
      .filter(atomId => atomId !== previousAtomId)
      .filter(atomId => !seenAtomIds.has(atomId));
    if (nextAtomIds.length === 0) {
      break;
    }
    if (nextAtomIds.length > 1) {
      return null;
    }
    const nextAtomId = nextAtomIds[0];
    if ((layoutGraph.atomToRings.get(nextAtomId)?.length ?? 0) > 0) {
      return null;
    }
    if (!isRetouchableChainBond(layoutGraph, currentAtomId, nextAtomId)) {
      return null;
    }
    atomIds.push(nextAtomId);
    seenAtomIds.add(nextAtomId);
    previousAtomId = currentAtomId;
    currentAtomId = nextAtomId;
  }

  const carbonCount = atomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element === 'C').length;
  return atomIds.length >= MIN_TERMINAL_CHAIN_ATOM_COUNT && carbonCount >= MIN_TERMINAL_CHAIN_CARBON_COUNT
    ? atomIds
    : null;
}

function terminalChainCandidates(layoutGraph, ringChain) {
  const terminalRingSystemIds = new Set(ringChain.terminalRingSystemIds ?? []);
  const linkerAtomIds = new Set((ringChain.edges ?? []).flatMap(edge => edge.linkerAtomIds ?? []));
  const candidates = [];

  for (const ringSystem of ringChain.ringSystems ?? []) {
    if (!terminalRingSystemIds.has(ringSystem.id)) {
      continue;
    }
    const ringAtomIds = new Set(ringSystem.atomIds);
    for (const anchorAtomId of ringSystem.atomIds) {
      for (const rootAtomId of heavyNeighborIds(layoutGraph, anchorAtomId)) {
        if (ringAtomIds.has(rootAtomId) || linkerAtomIds.has(rootAtomId)) {
          continue;
        }
        if ((layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) > 0) {
          continue;
        }
        if (!isRetouchableChainBond(layoutGraph, anchorAtomId, rootAtomId)) {
          continue;
        }
        const chainAtomIds = orderedTerminalChain(layoutGraph, rootAtomId, anchorAtomId);
        if (!chainAtomIds) {
          continue;
        }
        candidates.push({
          ringChain,
          ringSystemId: ringSystem.id,
          anchorAtomId,
          chainAtomIds
        });
      }
    }
  }

  candidates.sort((firstCandidate, secondCandidate) => {
    if (secondCandidate.chainAtomIds.length !== firstCandidate.chainAtomIds.length) {
      return secondCandidate.chainAtomIds.length - firstCandidate.chainAtomIds.length;
    }
    return firstCandidate.anchorAtomId.localeCompare(secondCandidate.anchorAtomId, 'en', { numeric: true });
  });
  return candidates;
}

function ringSystemCenter(coords, ringSystem) {
  const positions = (ringSystem?.atomIds ?? [])
    .map(atomId => coords.get(atomId))
    .filter(Boolean);
  return positions.length > 0 ? centroid(positions) : null;
}

function preferredTerminalChainAngle(inputCoords, ringChain, ringSystemId) {
  const orderedRingSystemIds = ringChain?.orderedRingSystemIds ?? [];
  const ringIndex = orderedRingSystemIds.indexOf(ringSystemId);
  if (ringIndex !== 0 && ringIndex !== orderedRingSystemIds.length - 1) {
    return null;
  }
  const neighborIndex = ringIndex === 0 ? 1 : orderedRingSystemIds.length - 2;
  const ringSystemById = new Map((ringChain.ringSystems ?? []).map(ringSystem => [ringSystem.id, ringSystem]));
  const terminalCenter = ringSystemCenter(inputCoords, ringSystemById.get(ringSystemId));
  const neighborCenter = ringSystemCenter(inputCoords, ringSystemById.get(orderedRingSystemIds[neighborIndex]));
  return terminalCenter && neighborCenter ? angleOf(sub(terminalCenter, neighborCenter)) : null;
}

function rebuildTerminalChainCoords(inputCoords, anchorPosition, chainAtomIds, bondLength, anchorAngle, chainAngle, turnSign) {
  const coords = new Map(inputCoords);
  let currentPosition = add(anchorPosition, fromAngle(anchorAngle, bondLength));
  coords.set(chainAtomIds[0], currentPosition);
  for (let index = 1; index < chainAtomIds.length; index++) {
    const segmentAngle = chainAngle + ((index - 1) % 2 === 0 ? 0 : turnSign * TERMINAL_CHAIN_ZIGZAG_ANGLE);
    currentPosition = add(currentPosition, fromAngle(segmentAngle, bondLength));
    coords.set(chainAtomIds[index], currentPosition);
  }
  return coords;
}

function terminalChainAxisPenalty(preferredAngle, anchorAngle, chainAngle, turnSign) {
  if (preferredAngle == null) {
    return 0;
  }
  const zigzagAverageAngle = chainAngle + (turnSign * TERMINAL_CHAIN_ZIGZAG_ANGLE) / 2;
  return (
    angularDifference(zigzagAverageAngle, preferredAngle)
    + angularDifference(anchorAngle, preferredAngle) * 0.25
  ) * TERMINAL_CHAIN_AXIS_WEIGHT;
}

function auditScore(audit, bounds, axisPenalty = 0) {
  return (
    audit.severeOverlapCount * 10_000_000
    + (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000
    + audit.bondLengthFailureCount * 100_000
    + (audit.ringSubstituentReadabilityFailureCount ?? 0) * 10_000
    + (audit.inwardRingSubstituentCount ?? 0) * 10_000
    + (audit.outwardAxisRingSubstituentFailureCount ?? 0) * 10_000
    + audit.labelOverlapCount * 5_000
    + audit.severeOverlapPenalty * 1_000
    + axisPenalty
    - Math.min(bounds.width / Math.max(bounds.height, 1e-6), 4) * 1_000
  );
}

function isImprovedAudit(candidateAudit, baseAudit) {
  if (candidateAudit.ok !== baseAudit.ok) {
    return candidateAudit.ok === true;
  }
  if (candidateAudit.severeOverlapCount !== baseAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < baseAudit.severeOverlapCount;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) !== (baseAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return (candidateAudit.visibleHeavyBondCrossingCount ?? 0) < (baseAudit.visibleHeavyBondCrossingCount ?? 0);
  }
  if (candidateAudit.bondLengthFailureCount !== baseAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < baseAudit.bondLengthFailureCount;
  }
  if ((candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) !== (baseAudit.ringSubstituentReadabilityFailureCount ?? 0)) {
    return (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) < (baseAudit.ringSubstituentReadabilityFailureCount ?? 0);
  }
  if ((candidateAudit.inwardRingSubstituentCount ?? 0) !== (baseAudit.inwardRingSubstituentCount ?? 0)) {
    return (candidateAudit.inwardRingSubstituentCount ?? 0) < (baseAudit.inwardRingSubstituentCount ?? 0);
  }
  return candidateAudit.severeOverlapPenalty < baseAudit.severeOverlapPenalty - 1e-9;
}

function bestTerminalChainRetouch(layoutGraph, inputCoords, candidate, options) {
  const anchorPosition = inputCoords.get(candidate.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const preferredAngle = preferredTerminalChainAngle(inputCoords, candidate.ringChain, candidate.ringSystemId);
  let best = null;
  for (const anchorAngle of TERMINAL_CHAIN_ANGLE_VALUES) {
    for (const chainAngle of TERMINAL_CHAIN_ANGLE_VALUES) {
      for (const turnSign of [-1, 1]) {
        const coords = rebuildTerminalChainCoords(
          inputCoords,
          anchorPosition,
          candidate.chainAtomIds,
          options.bondLength,
          anchorAngle,
          chainAngle,
          turnSign
        );
        const audit = auditLayout(layoutGraph, coords, {
          bondLength: options.bondLength,
          bondValidationClasses: options.bondValidationClasses
        });
        const bounds = computeBounds(coords, [...coords.keys()]);
        const score = auditScore(audit, bounds, terminalChainAxisPenalty(preferredAngle, anchorAngle, chainAngle, turnSign));
        if (!best || score < best.score) {
          best = {
            coords,
            audit,
            bounds,
            score,
            movedAtomIds: candidate.chainAtomIds
          };
        }
      }
    }
  }
  return best;
}

/**
 * Rebuilds long terminal acyclic chains attached to path-like isolated ring
 * chains when late cleanup folds the chain back across the first ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Current coordinates.
 * @param {object} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, changed: boolean, movedAtomIds: string[], audit: object|null}} Retouch result.
 */
export function runTerminalAcyclicChainRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  const baseAudit = auditLayout(layoutGraph, inputCoords, {
    bondLength,
    bondValidationClasses
  });
  if (baseAudit.ok) {
    return { coords: inputCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }

  let best = null;
  for (const component of layoutGraph.components ?? []) {
    const ringChain = describePathLikeIsolatedRingChain(layoutGraph, component);
    if (!ringChain) {
      continue;
    }
    for (const candidate of terminalChainCandidates(layoutGraph, ringChain)) {
      const retouch = bestTerminalChainRetouch(layoutGraph, inputCoords, candidate, {
        bondLength,
        bondValidationClasses
      });
      if (!retouch) {
        continue;
      }
      if (!best || retouch.score < best.score) {
        best = retouch;
      }
    }
  }

  if (!best || !isImprovedAudit(best.audit, baseAudit)) {
    return { coords: inputCoords, changed: false, movedAtomIds: [], audit: baseAudit };
  }
  return {
    coords: best.coords,
    changed: true,
    movedAtomIds: best.movedAtomIds,
    audit: best.audit
  };
}
