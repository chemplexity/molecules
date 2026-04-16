/** @module families/organometallic */

import { auditLayout } from '../audit/audit.js';
import { BRIDGED_KK_LIMITS, ORGANOMETALLIC_RESCUE_LIMITS } from '../constants.js';
import { add, angleOf, centroid, distance, fromAngle, normalize, perpLeft, rotate, scale, sub } from '../geometry/vec2.js';
import { layoutKamadaKawai } from '../geometry/kk-layout.js';
import { assignBondValidationClass, mergeBondValidationClasses } from '../placement/bond-validation.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { buildSliceAdjacency, classifyAtomSliceFamily, createAtomSlice, layoutAtomSlice, ringConnectionsForSlice, ringsForAtomSlice } from '../placement/atom-slice.js';
import { organometallicArrangementSpecs, organometallicGeometryKind } from './organometallic-geometry.js';

function isMetalAtom(layoutGraph, atomId) {
  const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
  if (!atom || atom.name === 'H') {
    return false;
  }
  const group = atom.properties.group ?? 0;
  return group >= 3 && group <= 12;
}

function sortAtomIds(layoutGraph, atomIds) {
  return [...atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
}

function connectedFragments(adjacency, orderedAtomIds) {
  const seen = new Set();
  const fragments = [];

  for (const seedAtomId of orderedAtomIds) {
    if (seen.has(seedAtomId)) {
      continue;
    }
    const queue = [seedAtomId];
    const atomIds = [];
    seen.add(seedAtomId);
    let queueHead = 0;

    while (queueHead < queue.length) {
      const atomId = queue[queueHead++];
      atomIds.push(atomId);
      for (const neighborAtomId of adjacency.get(atomId) ?? []) {
        if (seen.has(neighborAtomId)) {
          continue;
        }
        seen.add(neighborAtomId);
        queue.push(neighborAtomId);
      }
    }

    fragments.push(atomIds);
  }

  return fragments;
}

/**
 * Returns the supported publication-style geometry for one metal center and its ligand records.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom ID.
 * @param {object[]} records - Ligand-fragment records attached to the metal.
 * @returns {ReturnType<typeof organometallicGeometryKind>} Geometry kind.
 */
function coordinationGeometryKind(layoutGraph, metalAtomId, records) {
  const element = layoutGraph.sourceMolecule.atoms.get(metalAtomId)?.name ?? '';
  return organometallicGeometryKind(element, records.length, {
    allLigandsMonodentate: records.every(record => record.anchorAtomIds.length === 1)
  });
}

/**
 * Returns placement specs for one metal center based on safe coordination rules.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom ID.
 * @param {object[]} records - Ligand-fragment records attached to the metal.
 * @returns {Array<{angle: number, displayType: ('wedge'|'dash'|null)}>} Placement specs.
 */
function arrangementSpecs(layoutGraph, metalAtomId, records) {
  const geometryKind = coordinationGeometryKind(layoutGraph, metalAtomId, records);
  return organometallicArrangementSpecs(geometryKind, records.length);
}

/**
 * Finds the bond that joins a metal center to a ligand anchor atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom ID.
 * @param {string} anchorAtomId - Ligand anchor atom ID.
 * @returns {string|null} Bond ID, or null when the atoms are not directly bonded.
 */
function findMetalAnchorBondId(layoutGraph, metalAtomId, anchorAtomId) {
  for (const bond of layoutGraph.bondsByAtomId.get(metalAtomId) ?? []) {
    if (!bond) {
      continue;
    }
    const otherAtomId = bond.a === metalAtomId ? bond.b : bond.a;
    if (otherAtomId === anchorAtomId) {
      return bond.id;
    }
  }
  return null;
}

function transformFragment(coords, anchorAtomIds, targetAnchorCenter, desiredAngle) {
  const anchorCenter = centroid(anchorAtomIds.map(atomId => coords.get(atomId)).filter(Boolean));
  const fragmentCenter = centroid([...coords.values()]);
  const localDirection = sub(fragmentCenter, anchorCenter);
  const currentAngle = Math.hypot(localDirection.x, localDirection.y) <= 1e-12 ? 0 : angleOf(localDirection);
  const rotation = desiredAngle - currentAngle;
  const transformed = new Map();

  for (const [atomId, position] of coords) {
    const shifted = sub(position, anchorCenter);
    const rotated = rotate(shifted, rotation);
    transformed.set(atomId, add(targetAnchorCenter, rotated));
  }

  return transformed;
}

function sortRecordsByCanonicalId(records) {
  return [...records].sort((firstRecord, secondRecord) => {
    const firstId = firstRecord.atomIds[0] ?? '';
    const secondId = secondRecord.atomIds[0] ?? '';
    return firstId.localeCompare(secondId, 'en', { numeric: true });
  });
}

function buildOrganometallicBondValidationClasses(layoutGraph, participantAtomIds, sourceMaps = []) {
  const bondValidationClasses = assignBondValidationClass(layoutGraph, participantAtomIds, 'planar');
  for (const sourceMap of sourceMaps) {
    mergeBondValidationClasses(bondValidationClasses, sourceMap);
  }
  return bondValidationClasses;
}

function auditOrganometallicPlacement(layoutGraph, participantAtomIds, placement, bondLength) {
  if (!placement?.coords || placement.coords.size === 0) {
    return null;
  }
  return auditLayout(layoutGraph, placement.coords, {
    bondLength,
    bondValidationClasses:
      placement.bondValidationClasses
      ?? buildOrganometallicBondValidationClasses(layoutGraph, participantAtomIds)
  });
}

function isBetterOrganometallicPlacement(candidateAudit, incumbentAudit) {
  if (!candidateAudit) {
    return false;
  }
  if (!incumbentAudit) {
    return true;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
  }
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
    return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
  }
  return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
}

function scoreClusterLigandPosition(position, existingCoords, frameworkCentroid, anchorIds) {
  let minDistance = Infinity;
  const anchorIdSet = new Set(anchorIds);
  for (const [atomId, otherPosition] of existingCoords) {
    if (anchorIdSet.has(atomId)) {
      continue;
    }
    minDistance = Math.min(minDistance, distance(position, otherPosition));
  }
  const centroidDistance = distance(position, frameworkCentroid);
  return (Number.isFinite(minDistance) ? minDistance : 0) + centroidDistance * 0.25;
}

function angularDistance(firstAngle, secondAngle) {
  let difference = Math.abs(firstAngle - secondAngle);
  while (difference > Math.PI) {
    difference = Math.abs(difference - 2 * Math.PI);
  }
  return difference;
}

function placeSingleAnchorClusterLigands(recordGroup, metalPosition, frameworkCentroid, bondLength) {
  const outward = normalize(sub(metalPosition, frameworkCentroid));
  const baseDirection = Math.hypot(outward.x, outward.y) <= 1e-12 ? { x: 1, y: 0 } : outward;
  const orderedRecords = sortRecordsByCanonicalId(recordGroup);
  const placements = [];
  const centerIndex = (orderedRecords.length - 1) / 2;

  for (let index = 0; index < orderedRecords.length; index++) {
    const step = index - centerIndex;
    const direction = rotate(baseDirection, step * ORGANOMETALLIC_RESCUE_LIMITS.singleAnchorSpreadStep);
    placements.push({
      atomId: orderedRecords[index].atomIds[0],
      position: add(metalPosition, scale(direction, bondLength))
    });
  }

  return placements;
}

function placeDoubleAnchorClusterLigands(recordGroup, anchorIds, frameworkCoords, existingCoords, frameworkCentroid, bondLength) {
  const [firstAnchorId, secondAnchorId] = anchorIds;
  const firstAnchorPosition = frameworkCoords.get(firstAnchorId);
  const secondAnchorPosition = frameworkCoords.get(secondAnchorId);
  if (!firstAnchorPosition || !secondAnchorPosition) {
    return [];
  }

  const midpoint = scale(add(firstAnchorPosition, secondAnchorPosition), 0.5);
  const edgeVector = sub(secondAnchorPosition, firstAnchorPosition);
  const edgeLength = distance(firstAnchorPosition, secondAnchorPosition);
  const perpendicular = normalize(perpLeft(edgeVector));
  const offsetLength = Math.sqrt(Math.max(bondLength ** 2 - (edgeLength ** 2) / 4, 0));
  const firstCandidate = add(midpoint, scale(perpendicular, offsetLength));
  const secondCandidate = add(midpoint, scale(perpendicular, -offsetLength));
  const orderedRecords = sortRecordsByCanonicalId(recordGroup);
  const candidates = [
    { position: firstCandidate, score: scoreClusterLigandPosition(firstCandidate, existingCoords, frameworkCentroid, anchorIds) },
    { position: secondCandidate, score: scoreClusterLigandPosition(secondCandidate, existingCoords, frameworkCentroid, anchorIds) }
  ].sort((firstCandidateEntry, secondCandidateEntry) => secondCandidateEntry.score - firstCandidateEntry.score);

  if (orderedRecords.length === 1) {
    return [
      {
        atomId: orderedRecords[0].atomIds[0],
        position: candidates[0].position
      }
    ];
  }

  const placements = [];
  for (let index = 0; index < orderedRecords.length; index++) {
    placements.push({
      atomId: orderedRecords[index].atomIds[0],
      position: candidates[index % candidates.length].position
    });
  }
  return placements;
}

function shouldTryMetalFrameworkRescue(metalAtomIds, fragmentRecords, incumbentAudit) {
  if (!incumbentAudit || incumbentAudit.bondLengthFailureCount <= 0) {
    return false;
  }
  if (metalAtomIds.length < ORGANOMETALLIC_RESCUE_LIMITS.frameworkMinMetalCount || fragmentRecords.length === 0) {
    return false;
  }
  const allFragmentsSimple = fragmentRecords.every(record =>
    record.atomIds.length <= ORGANOMETALLIC_RESCUE_LIMITS.maxLigandFragmentAtomCount
    && record.anchorAtomIds.length === 1
    && record.anchorMetalIds.length >= 1
    && record.anchorMetalIds.length <= ORGANOMETALLIC_RESCUE_LIMITS.maxAnchorMetalCount
  );
  return allFragmentsSimple && fragmentRecords.some(record => record.anchorMetalIds.length === 2);
}

function hasDirectMetalFramework(layoutGraph, metalAtomIds) {
  const metalAtomIdSet = new Set(metalAtomIds);
  for (const metalAtomId of metalAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(metalAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const otherAtomId = bond.a === metalAtomId ? bond.b : bond.a;
      if (metalAtomIdSet.has(otherAtomId)) {
        return true;
      }
    }
  }
  return false;
}

function isPolyoxoFragmentRecord(layoutGraph, record) {
  if (record.atomIds.length !== 1 || record.anchorMetalIds.length === 0 || record.anchorMetalIds.length > ORGANOMETALLIC_RESCUE_LIMITS.polyoxoMaxAnchorMetalCount) {
    return false;
  }
  const atom = layoutGraph.sourceMolecule.atoms.get(record.atomIds[0]);
  return atom?.name === 'O';
}

function shouldTryPolyoxoClusterRescue(layoutGraph, metalAtomIds, fragmentRecords, incumbentAudit) {
  if (!incumbentAudit || incumbentAudit.bondLengthFailureCount <= 0) {
    return false;
  }
  if (metalAtomIds.length < ORGANOMETALLIC_RESCUE_LIMITS.polyoxoMinMetalCount || fragmentRecords.length === 0) {
    return false;
  }
  if (!fragmentRecords.every(record => isPolyoxoFragmentRecord(layoutGraph, record))) {
    return false;
  }
  return fragmentRecords.some(record => record.anchorMetalIds.length >= 2);
}

function buildSyntheticMetalFramework(layoutGraph, metalAtomIds, fragmentRecords) {
  const synthetic = {
    atoms: new Map(),
    bonds: new Map()
  };
  for (const metalAtomId of metalAtomIds) {
    synthetic.atoms.set(metalAtomId, {
      id: metalAtomId,
      name: layoutGraph.sourceMolecule.atoms.get(metalAtomId)?.name ?? 'M'
    });
  }

  const edgeKeys = new Set();
  for (const record of fragmentRecords) {
    if (record.anchorMetalIds.length < 2) {
      continue;
    }
    const anchorMetalIds = [...record.anchorMetalIds].sort((firstMetalId, secondMetalId) => firstMetalId.localeCompare(secondMetalId, 'en', { numeric: true }));
    for (let firstIndex = 0; firstIndex < anchorMetalIds.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < anchorMetalIds.length; secondIndex++) {
        const firstMetalId = anchorMetalIds[firstIndex];
        const secondMetalId = anchorMetalIds[secondIndex];
        edgeKeys.add(`${firstMetalId}|${secondMetalId}`);
      }
    }
  }

  let bondIndex = 0;
  for (const edgeKey of [...edgeKeys].sort((firstKey, secondKey) => firstKey.localeCompare(secondKey, 'en', { numeric: true }))) {
    const [firstMetalId, secondMetalId] = edgeKey.split('|');
    synthetic.bonds.set(`framework:${bondIndex++}`, {
      id: `framework:${bondIndex}`,
      atoms: [firstMetalId, secondMetalId]
    });
  }

  return synthetic.bonds.size > 0 ? synthetic : null;
}

function positionPolyoxoPairBridge(firstAnchorPosition, secondAnchorPosition, bridgeIndex, bondLength) {
  const midpoint = scale(add(firstAnchorPosition, secondAnchorPosition), 0.5);
  const edgeVector = sub(secondAnchorPosition, firstAnchorPosition);
  const edgeLength = distance(firstAnchorPosition, secondAnchorPosition);
  const normal = normalize(perpLeft(edgeVector));
  const direction = bridgeIndex % 2 === 0 ? 1 : -1;
  const offset = Math.min(
    bondLength * ORGANOMETALLIC_RESCUE_LIMITS.polyoxoPairBridgeOffsetFactor,
    edgeLength * 0.1
  );
  return add(midpoint, scale(normal, direction * offset));
}

function positionPolyoxoTripleBridge(anchorPositions, frameworkCentroid, bridgeIndex, bondLength) {
  const center = centroid(anchorPositions);
  const meanAnchorDistance = anchorPositions.reduce((sum, anchorPosition) => sum + distance(center, anchorPosition), 0) / anchorPositions.length;
  const outward = normalize(sub(center, frameworkCentroid));
  const outwardAngle = Math.hypot(outward.x, outward.y) <= 1e-12 ? 0 : angleOf(outward);
  const radialAdjustment = Math.max(0, bondLength - meanAnchorDistance);
  const spreadAngle = outwardAngle + bridgeIndex * ((Math.PI * 2) / Math.max(3, anchorPositions.length + 1));
  return add(center, scale(fromAngle(spreadAngle, 1), radialAdjustment));
}

function choosePolyoxoTerminalAngles(metalPosition, frameworkCentroid, occupiedAngles, terminalCount) {
  const outwardAngle = angleOf(sub(metalPosition, frameworkCentroid));
  const slotAngles = Array.from({ length: ORGANOMETALLIC_RESCUE_LIMITS.polyoxoTerminalSlotCount }, (_, index) =>
    Math.PI / 2 - index * ((Math.PI * 2) / ORGANOMETALLIC_RESCUE_LIMITS.polyoxoTerminalSlotCount)
  );
  const scoredSlots = slotAngles
    .map(angle => {
      const minSeparation =
        occupiedAngles.length > 0
          ? Math.min(...occupiedAngles.map(otherAngle => angularDistance(angle, otherAngle)))
          : Math.PI;
      return {
        angle,
        score: minSeparation * 2 - angularDistance(angle, outwardAngle)
      };
    })
    .sort((firstSlot, secondSlot) => secondSlot.score - firstSlot.score);

  const chosenAngles = [];
  for (const slot of scoredSlots) {
    if (
      chosenAngles.some(chosenAngle =>
        angularDistance(chosenAngle, slot.angle) < ORGANOMETALLIC_RESCUE_LIMITS.polyoxoTerminalMinSlotSeparation
      )
    ) {
      continue;
    }
    chosenAngles.push(slot.angle);
    if (chosenAngles.length >= terminalCount) {
      break;
    }
  }
  return chosenAngles;
}

function layoutPolyoxoClusterRescue(layoutGraph, participantAtomIds, metalAtomIds, fragmentRecords, bondLength) {
  const framework = buildSyntheticMetalFramework(layoutGraph, metalAtomIds, fragmentRecords);
  if (!framework) {
    return null;
  }

  const metalFramework = layoutKamadaKawai(framework, metalAtomIds, {
    bondLength: bondLength * ORGANOMETALLIC_RESCUE_LIMITS.polyoxoFrameworkBondLengthFactor,
    maxComponentSize: 64,
    threshold: BRIDGED_KK_LIMITS.threshold,
    innerThreshold: BRIDGED_KK_LIMITS.threshold,
    maxIterations: BRIDGED_KK_LIMITS.largeMaxIterations,
    maxInnerIterations: BRIDGED_KK_LIMITS.largeMaxInnerIterations
  });
  if (metalFramework.coords.size !== metalAtomIds.length) {
    return null;
  }

  const coords = new Map(metalFramework.coords);
  const frameworkCentroid = centroid([...metalFramework.coords.values()]);
  const orderedRecords = [...fragmentRecords].sort((firstRecord, secondRecord) => {
    if (firstRecord.anchorMetalIds.length !== secondRecord.anchorMetalIds.length) {
      return firstRecord.anchorMetalIds.length - secondRecord.anchorMetalIds.length;
    }
    return firstRecord.atomIds[0].localeCompare(secondRecord.atomIds[0], 'en', { numeric: true });
  });

  const pairBridgeCounts = new Map();
  const tripleBridgeCounts = new Map();
  for (const record of orderedRecords) {
    if (record.anchorMetalIds.length === 1) {
      continue;
    }
    const anchorMetalIds = [...record.anchorMetalIds].sort((firstMetalId, secondMetalId) => firstMetalId.localeCompare(secondMetalId, 'en', { numeric: true }));
    const anchorPositions = anchorMetalIds.map(anchorMetalId => coords.get(anchorMetalId)).filter(Boolean);
    if (anchorPositions.length !== anchorMetalIds.length) {
      return null;
    }
    if (anchorMetalIds.length === 2) {
      const key = anchorMetalIds.join('|');
      const bridgeIndex = pairBridgeCounts.get(key) ?? 0;
      pairBridgeCounts.set(key, bridgeIndex + 1);
      coords.set(
        record.atomIds[0],
        positionPolyoxoPairBridge(anchorPositions[0], anchorPositions[1], bridgeIndex, bondLength)
      );
      continue;
    }
    const key = anchorMetalIds.join('|');
    const bridgeIndex = tripleBridgeCounts.get(key) ?? 0;
    tripleBridgeCounts.set(key, bridgeIndex + 1);
    coords.set(record.atomIds[0], positionPolyoxoTripleBridge(anchorPositions, frameworkCentroid, bridgeIndex, bondLength));
  }

  for (const metalAtomId of metalAtomIds) {
    const terminalRecords = orderedRecords.filter(record => record.anchorMetalIds.length === 1 && record.anchorMetalIds[0] === metalAtomId);
    if (terminalRecords.length === 0) {
      continue;
    }
    const metalPosition = coords.get(metalAtomId);
    const occupiedAngles = orderedRecords
      .filter(record => record.anchorMetalIds.includes(metalAtomId) && coords.has(record.atomIds[0]))
      .map(record => angleOf(sub(coords.get(record.atomIds[0]), metalPosition)));
    const chosenAngles = choosePolyoxoTerminalAngles(metalPosition, frameworkCentroid, occupiedAngles, terminalRecords.length);
    for (let index = 0; index < terminalRecords.length; index++) {
      coords.set(
        terminalRecords[index].atomIds[0],
        add(metalPosition, fromAngle(chosenAngles[index] ?? angleOf(sub(metalPosition, frameworkCentroid)), bondLength))
      );
    }
  }

  for (const metalAtomId of metalAtomIds) {
    const ligandPositions = [];
    for (const bond of layoutGraph.bondsByAtomId.get(metalAtomId) ?? []) {
      if (!bond) {
        continue;
      }
      const otherAtomId = bond.a === metalAtomId ? bond.b : bond.a;
      const otherPosition = coords.get(otherAtomId);
      if (otherPosition) {
        ligandPositions.push(otherPosition);
      }
    }
    if (ligandPositions.length >= 2) {
      coords.set(metalAtomId, centroid(ligandPositions));
    }
  }

  return {
    coords,
    placementMode: 'polyoxo-framework-rescue',
    displayAssignments: [],
    bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'bridged')
  };
}

function layoutMetalFrameworkRescue(layoutGraph, participantAtomIds, metalAtomIds, fragmentRecords, bondLength) {
  const metalComponent = createAtomSlice(layoutGraph, metalAtomIds, 'metal-framework');
  const metalAdjacency = buildSliceAdjacency(layoutGraph, metalAtomIds, {
    includeBond(bond) {
      return bond.kind === 'covalent';
    }
  });
  const metalRings = ringsForAtomSlice(layoutGraph, metalAtomIds);
  const metalConnections = ringConnectionsForSlice(
    layoutGraph,
    metalRings.map(ring => ring.id)
  );
  const metalFrameworkFamily = classifyAtomSliceFamily(layoutGraph, metalAtomIds, metalRings, metalConnections, {
    ignoreMetals: true
  });
  const metalFramework = layoutAtomSlice(layoutGraph, metalComponent, bondLength, {
    adjacency: metalAdjacency,
    ignoreMetalsForFamily: true,
    forceFamily: metalFrameworkFamily
  });
  if (!metalFramework.supported || metalFramework.coords.size !== metalAtomIds.length) {
    return null;
  }

  const coords = new Map(metalFramework.coords);
  const frameworkCentroid = centroid([...metalFramework.coords.values()]);
  const groupedRecords = new Map();
  for (const record of fragmentRecords) {
    const key = [...record.anchorMetalIds].sort((firstMetalId, secondMetalId) => firstMetalId.localeCompare(secondMetalId, 'en', { numeric: true })).join('|');
    const records = groupedRecords.get(key) ?? [];
    records.push(record);
    groupedRecords.set(key, records);
  }

  for (const [key, recordGroup] of [...groupedRecords.entries()].sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey, 'en', { numeric: true }))) {
    const anchorIds = key.split('|').filter(Boolean);
    const placements =
      anchorIds.length === 1
        ? placeSingleAnchorClusterLigands(recordGroup, metalFramework.coords.get(anchorIds[0]), frameworkCentroid, bondLength)
        : placeDoubleAnchorClusterLigands(recordGroup, anchorIds, metalFramework.coords, coords, frameworkCentroid, bondLength);
    for (const placement of placements) {
      coords.set(placement.atomId, placement.position);
    }
  }

  return {
    coords,
    placementMode: 'metal-framework-rescue',
    displayAssignments: [],
    bondValidationClasses: buildOrganometallicBondValidationClasses(layoutGraph, participantAtomIds, [
      metalFramework.bondValidationClasses
    ])
  };
}

function layoutLigandFirstOrganometallicPlacement(layoutGraph, participantAtomIds, metalAtomIds, fragmentRecords, bondLength) {
  const metalCoords = new Map();
  if (metalAtomIds.length === 1) {
    metalCoords.set(metalAtomIds[0], { x: 0, y: 0 });
  } else {
    for (let index = 0; index < metalAtomIds.length; index++) {
      metalCoords.set(metalAtomIds[index], { x: index * bondLength * 2, y: 0 });
    }
  }

  const fragmentCoords = new Map();
  const displayAssignments = [];
  const groupedByMetal = new Map(metalAtomIds.map(metalAtomId => [metalAtomId, []]));
  for (const record of fragmentRecords) {
    const key = record.anchorMetalIds[0] ?? metalAtomIds[0];
    groupedByMetal.get(key)?.push(record);
  }
  for (const records of groupedByMetal.values()) {
    records.sort((firstRecord, secondRecord) => {
      if (secondRecord.anchorAtomIds.length !== firstRecord.anchorAtomIds.length) {
        return secondRecord.anchorAtomIds.length - firstRecord.anchorAtomIds.length;
      }
      if (secondRecord.component.atomIds.length !== firstRecord.component.atomIds.length) {
        return secondRecord.component.atomIds.length - firstRecord.component.atomIds.length;
      }
      return firstRecord.component.canonicalSignature.localeCompare(secondRecord.component.canonicalSignature, 'en', { numeric: true });
    });
  }

  for (const metalAtomId of metalAtomIds) {
    const provisionalMetalPosition = metalCoords.get(metalAtomId);
    const records = groupedByMetal.get(metalAtomId) ?? [];
    const specs = arrangementSpecs(layoutGraph, metalAtomId, records);
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const ligandLayout = layoutAtomSlice(layoutGraph, record.component, bondLength, {
        adjacency: buildSliceAdjacency(layoutGraph, record.component.atomIds, {
          includeBond(bond) {
            return bond.kind === 'covalent';
          }
        })
      });
      if (!ligandLayout.supported || ligandLayout.coords.size === 0 || record.anchorAtomIds.length === 0) {
        return null;
      }

      const spec = specs[index] ?? { angle: 0, displayType: null };
      const targetAnchorCenter = add(provisionalMetalPosition, fromAngle(spec.angle, bondLength));
      const transformed = transformFragment(ligandLayout.coords, record.anchorAtomIds, targetAnchorCenter, spec.angle);
      for (const [atomId, position] of transformed) {
        fragmentCoords.set(atomId, position);
      }
      if (spec.displayType && record.anchorAtomIds.length === 1) {
        const bondId = findMetalAnchorBondId(layoutGraph, metalAtomId, record.anchorAtomIds[0]);
        if (bondId) {
          displayAssignments.push({
            bondId,
            type: spec.displayType,
            centerId: metalAtomId
          });
        }
      }
    }
  }

  for (const metalAtomId of metalAtomIds) {
    const records = groupedByMetal.get(metalAtomId) ?? [];
    const geometryKind = coordinationGeometryKind(layoutGraph, metalAtomId, records);
    if (geometryKind === 'projected-trigonal-bipyramidal') {
      continue;
    }
    const bondedLigandPositions = [];
    const metalAtom = layoutGraph.sourceMolecule.atoms.get(metalAtomId);
    for (const bondId of metalAtom?.bonds ?? []) {
      const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherAtomId = bond.getOtherAtom(metalAtomId);
      const otherPosition = fragmentCoords.get(otherAtomId);
      if (otherPosition) {
        bondedLigandPositions.push(otherPosition);
      }
    }
    if (bondedLigandPositions.length >= 2) {
      metalCoords.set(metalAtomId, centroid(bondedLigandPositions));
    }
  }

  const coords = new Map(fragmentCoords);
  for (const [metalAtomId, position] of metalCoords) {
    coords.set(metalAtomId, position);
  }

  return {
    coords,
    placementMode: 'ligand-first',
    displayAssignments,
    bondValidationClasses: buildOrganometallicBondValidationClasses(layoutGraph, participantAtomIds)
  };
}

/**
 * Places a simple organometallic component by laying out ligand fragments as
 * organic slices, arranging them around provisional metal centers, and then
 * placing metals from their bonded-neighbor centroids when possible.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, placementMode: string, displayAssignments: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>}|null} Placement result.
 */
export function layoutOrganometallicFamily(layoutGraph, component, bondLength) {
  const participantAtomIds = component.atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
  });
  const metalAtomIds = sortAtomIds(
    layoutGraph,
    participantAtomIds.filter(atomId => isMetalAtom(layoutGraph, atomId))
  );
  if (metalAtomIds.length === 0) {
    return null;
  }

  const nonMetalAtomIds = sortAtomIds(
    layoutGraph,
    participantAtomIds.filter(atomId => !isMetalAtom(layoutGraph, atomId))
  );
  const ligandAdjacency = buildSliceAdjacency(layoutGraph, nonMetalAtomIds, {
    includeBond(bond) {
      return bond.kind === 'covalent';
    }
  });
  const ligandFragments = connectedFragments(ligandAdjacency, nonMetalAtomIds);
  const fragmentRecords = ligandFragments.map((atomIds, index) => {
    const componentSlice = createAtomSlice(layoutGraph, atomIds, `ligand:${index}`);
    const anchorAtomIds = sortAtomIds(
      layoutGraph,
      atomIds.filter(atomId => {
        const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
        return (
          atom?.bonds.some(bondId => {
            const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
            if (!bond) {
              return false;
            }
            const otherAtomId = bond.getOtherAtom(atomId);
            return metalAtomIds.includes(otherAtomId);
          }) ?? false
        );
      })
    );
    const anchorMetalIds = sortAtomIds(
      layoutGraph,
      metalAtomIds.filter(metalAtomId => {
        const metalAtom = layoutGraph.sourceMolecule.atoms.get(metalAtomId);
        return (
          metalAtom?.bonds.some(bondId => {
            const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
            if (!bond) {
              return false;
            }
            const otherAtomId = bond.getOtherAtom(metalAtomId);
            return atomIds.includes(otherAtomId);
          }) ?? false
        );
      })
    );
    return {
      atomIds,
      component: componentSlice,
      anchorAtomIds,
      anchorMetalIds
    };
  });
  const ligandFirstPlacement = layoutLigandFirstOrganometallicPlacement(
    layoutGraph,
    participantAtomIds,
    metalAtomIds,
    fragmentRecords,
    bondLength
  );
  if (!ligandFirstPlacement) {
    return null;
  }

  const ligandFirstAudit = auditOrganometallicPlacement(layoutGraph, participantAtomIds, ligandFirstPlacement, bondLength);
  let bestPlacement = ligandFirstPlacement;
  let bestAudit = ligandFirstAudit;

  if (hasDirectMetalFramework(layoutGraph, metalAtomIds) && shouldTryMetalFrameworkRescue(metalAtomIds, fragmentRecords, bestAudit)) {
    const frameworkRescuePlacement = layoutMetalFrameworkRescue(
      layoutGraph,
      participantAtomIds,
      metalAtomIds,
      fragmentRecords,
      bondLength
    );
    const frameworkRescueAudit = auditOrganometallicPlacement(layoutGraph, participantAtomIds, frameworkRescuePlacement, bondLength);
    if (isBetterOrganometallicPlacement(frameworkRescueAudit, bestAudit)) {
      bestPlacement = frameworkRescuePlacement;
      bestAudit = frameworkRescueAudit;
    }
  }

  if (shouldTryPolyoxoClusterRescue(layoutGraph, metalAtomIds, fragmentRecords, bestAudit)) {
    const polyoxoRescuePlacement = layoutPolyoxoClusterRescue(
      layoutGraph,
      participantAtomIds,
      metalAtomIds,
      fragmentRecords,
      bondLength
    );
    const polyoxoRescueAudit = auditOrganometallicPlacement(layoutGraph, participantAtomIds, polyoxoRescuePlacement, bondLength);
    if (isBetterOrganometallicPlacement(polyoxoRescueAudit, bestAudit)) {
      bestPlacement = polyoxoRescuePlacement;
    }
  }

  return bestPlacement;
}
