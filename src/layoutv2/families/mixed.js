/** @module families/mixed */

import { angleOf, centroid, fromAngle, sub, add, rotate } from '../geometry/vec2.js';
import { transformAttachedBlock } from '../placement/linkers.js';
import { assignBondValidationClass, resolvePlacementValidationClass } from '../placement/bond-validation.js';
import { chooseAttachmentAngle, placeRemainingBranches } from '../placement/substituents.js';
import { measureLayoutCost } from '../audit/invariants.js';
import { layoutAcyclicFamily } from './acyclic.js';
import { layoutBridgedFamily } from './bridged.js';
import { layoutFusedFamily } from './fused.js';
import { layoutIsolatedRingFamily } from './isolated-ring.js';
import { layoutMacrocycleFamily } from './macrocycle.js';
import { layoutSpiroFamily } from './spiro.js';
import { classifyRingSystemFamily } from '../model/scaffold-plan.js';

function compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank) {
  const firstRank = canonicalAtomRank.get(firstAtomId) ?? Number.MAX_SAFE_INTEGER;
  const secondRank = canonicalAtomRank.get(secondAtomId) ?? Number.MAX_SAFE_INTEGER;
  return firstRank - secondRank || String(firstAtomId).localeCompare(String(secondAtomId), 'en', { numeric: true });
}

function ringSystemDescriptors(layoutGraph, ringSystem) {
  const ringIdSet = new Set(ringSystem.ringIds);
  const rings = layoutGraph.rings.filter(ring => ringIdSet.has(ring.id));
  const connections = layoutGraph.ringConnections.filter(connection => ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId));
  return { rings, connections };
}

function ringSystemAdjacency(layoutGraph, ringSystem) {
  const { rings, connections } = ringSystemDescriptors(layoutGraph, ringSystem);
  const ringAdj = new Map(rings.map(ring => [ring.id, []]));
  const ringConnectionByPair = new Map();
  for (const connection of connections) {
    ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
    ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
    const key = connection.firstRingId < connection.secondRingId
      ? `${connection.firstRingId}:${connection.secondRingId}`
      : `${connection.secondRingId}:${connection.firstRingId}`;
    ringConnectionByPair.set(key, connection);
  }
  for (const neighbors of ringAdj.values()) {
    neighbors.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
  }
  return { rings, ringAdj, ringConnectionByPair };
}

/**
 * Lays out one ring system inside a mixed scaffold and resolves its audit class.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Ring-system descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {string|null} [templateId] - Matched template ID.
 * @returns {{family: string, validationClass: 'planar'|'bridged', coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Ring-system layout result.
 */
function layoutRingSystem(layoutGraph, ringSystem, bondLength, templateId = null) {
  const family = classifyRingSystemFamily(layoutGraph, ringSystem);
  const { rings, ringAdj, ringConnectionByPair } = ringSystemAdjacency(layoutGraph, ringSystem);
  if (family === 'isolated-ring') {
    const result = layoutIsolatedRingFamily(rings[0], bondLength, { layoutGraph, templateId });
    return {
      family,
      validationClass: resolvePlacementValidationClass(family, result.placementMode, templateId),
      ...result
    };
  }
  if (family === 'macrocycle') {
    const result = layoutMacrocycleFamily(rings, bondLength, { layoutGraph, templateId });
    return result
      ? {
        family,
        validationClass: resolvePlacementValidationClass(family, result.placementMode, templateId),
        ...result
      }
      : null;
  }
  if (family === 'bridged') {
    const result = layoutBridgedFamily(rings, bondLength, { layoutGraph, templateId });
    return result
      ? {
        family,
        validationClass: resolvePlacementValidationClass(family, result.placementMode, templateId),
        ...result
      }
      : null;
  }
  if (family === 'fused') {
    const result = layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId });
    return {
      family,
      validationClass: resolvePlacementValidationClass(family, result.placementMode, templateId),
      ...result
    };
  }
  if (family === 'spiro') {
    const result = layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId });
    return {
      family,
      validationClass: resolvePlacementValidationClass(family, result.placementMode, templateId),
      ...result
    };
  }
  return null;
}

function findAttachmentBond(layoutGraph, ringSystem, placedAtomIds) {
  const ringAtomIdSet = new Set(ringSystem.atomIds);
  const orderedAtomIds = [...ringSystem.atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
  for (const atomId of orderedAtomIds) {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const orderedBondIds = [...atom.bonds].sort((firstBondId, secondBondId) => String(firstBondId).localeCompare(String(secondBondId), 'en', { numeric: true }));
    for (const bondId of orderedBondIds) {
      const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherAtomId = bond.getOtherAtom(atomId);
      if (ringAtomIdSet.has(otherAtomId) || !placedAtomIds.has(otherAtomId)) {
        continue;
      }
      return {
        attachmentAtomId: atomId,
        parentAtomId: otherAtomId
      };
    }
  }
  return null;
}

/**
 * Scores an attached-block orientation by placing the block plus the remaining
 * heavy non-ring branches into a temporary mixed-layout snapshot.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} primaryNonRingAtomIds - Heavy non-ring atom IDs.
 * @param {Iterable<string>} placedAtomIds - Already placed atom IDs.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate attached-block coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {number} Candidate layout cost.
 */
function scoreAttachedBlockOrientation(
  adjacency,
  canonicalAtomRank,
  coords,
  primaryNonRingAtomIds,
  placedAtomIds,
  transformedCoords,
  bondLength,
  layoutGraph
) {
  const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const candidateSeedAtomIds = new Set(placedAtomIds);

  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, { ...position });
    candidateSeedAtomIds.add(atomId);
  }

  placeRemainingBranches(
    adjacency,
    canonicalAtomRank,
    candidateCoords,
    primaryNonRingAtomIds,
    [...candidateSeedAtomIds],
    bondLength,
    layoutGraph
  );
  return measureLayoutCost(layoutGraph, candidateCoords, bondLength);
}

/**
 * Splits non-ring participant atoms into heavy atoms and explicit hydrogens.
 * Mixed layouts attach pending ring systems after the initial branch-growth
 * pass, so explicit hydrogens should wait until those heavier attachments are
 * resolved to avoid claiming trigonal alkene slots too early.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} atomIds - Atom IDs to classify.
 * @returns {{primaryAtomIds: Set<string>, deferredHydrogenAtomIds: Set<string>}} Classified non-ring atom IDs.
 */
function splitDeferredMixedHydrogens(layoutGraph, atomIds) {
  const primaryAtomIds = new Set();
  const deferredHydrogenAtomIds = new Set();

  for (const atomId of atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom?.element === 'H') {
      deferredHydrogenAtomIds.add(atomId);
      continue;
    }
    primaryAtomIds.add(atomId);
  }

  return { primaryAtomIds, deferredHydrogenAtomIds };
}

/**
 * Rotates a monosubstituted benzene root so its outgoing heavy substituent
 * axis is horizontal before mixed branch growth begins.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Root ring-system descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Root ring coordinates.
 * @param {Set<string>} participantAtomIds - Visible component atom IDs.
 * @returns {Map<string, {x: number, y: number}>} Possibly rotated root coordinates.
 */
function orientSingleAttachmentBenzeneRoot(layoutGraph, ringSystem, coords, participantAtomIds) {
  const rootRings = layoutGraph.rings.filter(ring => ringSystem.ringIds.includes(ring.id));
  if (rootRings.length !== 1) {
    return coords;
  }

  const [ring] = rootRings;
  if (!ring.aromatic || ring.atomIds.length !== 6 || !ring.atomIds.every(atomId => layoutGraph.atoms.get(atomId)?.element === 'C')) {
    return coords;
  }

  const ringAtomIdSet = new Set(ring.atomIds);
  const heavyAttachmentAnchors = ring.atomIds.filter(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      return false;
    }
    return atom.getNeighbors(layoutGraph.sourceMolecule).some(neighborAtom => neighborAtom
      && neighborAtom.name !== 'H'
      && participantAtomIds.has(neighborAtom.id)
      && !ringAtomIdSet.has(neighborAtom.id));
  });

  if (heavyAttachmentAnchors.length !== 1) {
    return coords;
  }

  const anchorAtomId = heavyAttachmentAnchors[0];
  const ringCenter = centroid([...coords.values()]);
  const anchorPosition = coords.get(anchorAtomId);
  const anchorVector = anchorPosition ? sub(anchorPosition, ringCenter) : null;
  if (!anchorVector || Math.hypot(anchorVector.x, anchorVector.y) <= 1e-6) {
    return coords;
  }

  const currentAngle = angleOf(anchorVector);
  const targetAngle = anchorVector.x >= 0 ? 0 : Math.PI;
  const rotationAngle = targetAngle - currentAngle;
  if (Math.abs(rotationAngle) <= 1e-6) {
    return coords;
  }

  const rotatedCoords = new Map();
  for (const [atomId, position] of coords) {
    rotatedCoords.set(atomId, add(ringCenter, rotate(sub(position, ringCenter), rotationAngle)));
  }
  return rotatedCoords;
}

/**
 * Places a mixed component by selecting a root scaffold, growing acyclic
 * connectors from it, and attaching secondary ring systems once they become
 * reachable from the placed region.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {object} scaffoldPlan - Scaffold plan.
 * @param {number} bondLength - Target bond length.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}} Mixed placement result.
 */
export function layoutMixedFamily(layoutGraph, component, adjacency, scaffoldPlan, bondLength) {
  const participantAtomIds = new Set(component.atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
  }));
  const coords = new Map();
  const placedAtomIds = new Set();
  const bondValidationClasses = new Map();
  const root = scaffoldPlan.rootScaffold;

  if (root.type === 'acyclic') {
    const acyclicCoords = layoutAcyclicFamily(adjacency, participantAtomIds, layoutGraph.canonicalAtomRank, bondLength, { layoutGraph });
    for (const [atomId, position] of acyclicCoords) {
      coords.set(atomId, position);
      placedAtomIds.add(atomId);
    }
    return {
      family: 'mixed',
      supported: true,
      atomIds: [...participantAtomIds],
      coords,
      bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar', bondValidationClasses)
    };
  }

  const rootRingSystem = layoutGraph.ringSystems.find(ringSystem => `ring-system:${ringSystem.id}` === root.id);
  const rootLayout = rootRingSystem ? layoutRingSystem(layoutGraph, rootRingSystem, bondLength, root.templateId ?? null) : null;
  if (!rootLayout) {
    return {
      family: 'mixed',
      supported: false,
      atomIds: [...participantAtomIds],
      coords,
      bondValidationClasses
    };
  }
  const rootCoords = orientSingleAttachmentBenzeneRoot(
    layoutGraph,
    rootRingSystem,
    rootLayout.coords,
    participantAtomIds
  );
  for (const [atomId, position] of rootCoords) {
    coords.set(atomId, position);
    placedAtomIds.add(atomId);
  }
  assignBondValidationClass(layoutGraph, rootRingSystem.atomIds, rootLayout.validationClass, bondValidationClasses);

  const nonRingAtomIds = new Set(
    [...participantAtomIds].filter(atomId => !layoutGraph.ringSystems.some(ringSystem => ringSystem.atomIds.includes(atomId)))
  );
  const {
    primaryAtomIds: primaryNonRingAtomIds,
    deferredHydrogenAtomIds
  } = splitDeferredMixedHydrogens(layoutGraph, nonRingAtomIds);
  const pendingRingSystems = scaffoldPlan.placementSequence
    .filter(entry => entry.kind === 'ring-system' && entry.candidateId !== root.id)
    .map(entry => {
      const ringSystem = layoutGraph.ringSystems.find(candidateRingSystem => `ring-system:${candidateRingSystem.id}` === entry.candidateId);
      return ringSystem ? { ringSystem, templateId: entry.templateId ?? null } : null;
    })
    .filter(Boolean);

  let progressed = true;
  while (progressed) {
    progressed = false;
    const sizeBeforeBranches = coords.size;
    placeRemainingBranches(adjacency, layoutGraph.canonicalAtomRank, coords, primaryNonRingAtomIds, [...placedAtomIds], bondLength, layoutGraph);
    for (const atomId of primaryNonRingAtomIds) {
      if (coords.has(atomId)) {
        placedAtomIds.add(atomId);
      }
    }
    if (coords.size > sizeBeforeBranches) {
      progressed = true;
    }

    for (let index = 0; index < pendingRingSystems.length; index++) {
      const pendingRingSystem = pendingRingSystems[index];
      const attachment = findAttachmentBond(layoutGraph, pendingRingSystem.ringSystem, placedAtomIds);
      if (!attachment) {
        continue;
      }
      const blockLayout = layoutRingSystem(layoutGraph, pendingRingSystem.ringSystem, bondLength, pendingRingSystem.templateId);
      if (!blockLayout) {
        continue;
      }
      const parentPosition = coords.get(attachment.parentAtomId);
      const placedCentroid = centroid([...placedAtomIds].map(atomId => coords.get(atomId)).filter(Boolean));
      const preferredAngle = angleOf(sub(parentPosition, placedCentroid));
      const attachmentAngle = chooseAttachmentAngle(
        adjacency,
        coords,
        attachment.parentAtomId,
        participantAtomIds,
        preferredAngle,
        layoutGraph,
        attachment.attachmentAtomId
      );
      const targetPosition = add(parentPosition, fromAngle(attachmentAngle, bondLength));
      const normalCoords = transformAttachedBlock(blockLayout.coords, attachment.attachmentAtomId, targetPosition, attachmentAngle);
      const mirroredCoords = transformAttachedBlock(blockLayout.coords, attachment.attachmentAtomId, targetPosition, attachmentAngle, { mirror: true });
      const normalCost = scoreAttachedBlockOrientation(
        adjacency,
        layoutGraph.canonicalAtomRank,
        coords,
        primaryNonRingAtomIds,
        placedAtomIds,
        normalCoords,
        bondLength,
        layoutGraph
      );
      const mirroredCost = scoreAttachedBlockOrientation(
        adjacency,
        layoutGraph.canonicalAtomRank,
        coords,
        primaryNonRingAtomIds,
        placedAtomIds,
        mirroredCoords,
        bondLength,
        layoutGraph
      );
      const transformedCoords = mirroredCost < normalCost ? mirroredCoords : normalCoords;
      for (const [atomId, position] of transformedCoords) {
        coords.set(atomId, position);
        placedAtomIds.add(atomId);
      }
      assignBondValidationClass(layoutGraph, pendingRingSystem.ringSystem.atomIds, blockLayout.validationClass, bondValidationClasses);
      pendingRingSystems.splice(index, 1);
      index--;
      progressed = true;
    }
  }

  placeRemainingBranches(adjacency, layoutGraph.canonicalAtomRank, coords, primaryNonRingAtomIds, [...placedAtomIds], bondLength, layoutGraph);
  for (const atomId of primaryNonRingAtomIds) {
    if (coords.has(atomId)) {
      placedAtomIds.add(atomId);
    }
  }
  if (deferredHydrogenAtomIds.size > 0) {
    placeRemainingBranches(adjacency, layoutGraph.canonicalAtomRank, coords, deferredHydrogenAtomIds, [...placedAtomIds], bondLength, layoutGraph);
  }
  for (const atomId of nonRingAtomIds) {
    if (coords.has(atomId)) {
      placedAtomIds.add(atomId);
    }
  }

  const supported = [...participantAtomIds].every(atomId => coords.has(atomId));
  return {
    family: 'mixed',
    supported,
    atomIds: [...participantAtomIds],
    coords,
    bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar', bondValidationClasses, { overwrite: false })
  };
}
