import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bugMolecules } from '../../../examples/bug-molecules.js';
import { Molecule } from '../../../src/core/Molecule.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { auditLayout } from '../../../src/layout/engine/audit/audit.js';
import {
  findSevereOverlaps,
  findVisibleHeavyBondCrossings,
  measureDivalentContinuationDistortion,
  measureThreeHeavyContinuationDistortion,
  measureTrigonalDistortion
} from '../../../src/layout/engine/audit/invariants.js';
import { measureOrthogonalHypervalentDeviation, measureRingAnchoredHypervalentBranchDeviation } from '../../../src/layout/engine/cleanup/hypervalent-angle-tidy.js';
import { pointInPolygon } from '../../../src/layout/engine/geometry/polygon.js';
import { angleOf, angularDifference, centroid, distance, sub } from '../../../src/layout/engine/geometry/vec2.js';
import { computeBounds } from '../../../src/layout/engine/geometry/bounds.js';
import { computeIncidentRingOutwardAngles } from '../../../src/layout/engine/geometry/ring-direction.js';
import { BRIDGED_VALIDATION } from '../../../src/layout/engine/constants.js';
import { createLayoutGraphFromNormalized } from '../../../src/layout/engine/model/layout-graph.js';
import { normalizeOptions } from '../../../src/layout/engine/options.js';
import { describePathLikeIsolatedRingChain } from '../../../src/layout/engine/topology/isolated-ring-chain.js';
import { measureSmallRingExteriorGapSpreadPenalty, smallRingExteriorTargetAngles } from '../../../src/layout/engine/placement/branch-placement.js';
import { layoutSupportedComponents } from '../../../src/layout/engine/placement/component-layout.js';
import { classifyFamily, runPipeline } from '../../../src/layout/engine/pipeline.js';
import { resolveProfile } from '../../../src/layout/engine/profile.js';
import { resolvePolicy } from '../../../src/layout/engine/standards/profile-policy.js';
import {
  makeAlternatingMethylMacrocycle,
  makeDisconnectedEthanes,
  makeLargePolyaryl,
  makeMacrocycle,
  makeMacrocycleWithSubstituent,
  makeMethylbenzene,
  makeNorbornane,
  makeOrganometallic,
  makeUnmatchedBridgedCage
} from './support/molecules.js';

const GLYCOPEPTIDE_MACROCYCLE_SMILES =
  'C[NH2+][C@@H](CC(C)C)C(=O)N[C@@H]1[C@H](O)C2=CC=C(OC3=CC4=CC(OC5=CC=C(C=C5Cl)[C@@H](O[C@H]5C[C@@](C)([NH3+])[C@H](O)[C@@H](C)O5)[C@H]5NC(=O)[C@H](NC(=O)[C@H]4NC(=O)[C@@H](CC(N)=O)NC1=O)C1=CC=C(O)C(=C1)C1=C(O)C=C(O)C=C1[C@@H](NC5=O)C(O)=O)=C3O[C@H]1O[C@@H](CO)[C@H](O)[C@@H](O)[C@@H]1O[C@@H]1C[C@](C)([NH3+])[C@@H](O)[C@H](C)O1)C(Cl)=C2';

/**
 * Returns the interior angles for an ordered ring path.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Ordered ring atom IDs.
 * @returns {number[]} Interior angles in degrees.
 */
function ringAngles(coords, atomIds) {
  return atomIds.map((atomId, index) => {
    const previous = coords.get(atomIds[(index - 1 + atomIds.length) % atomIds.length]);
    const current = coords.get(atomId);
    const next = coords.get(atomIds[(index + 1) % atomIds.length]);
    const firstVector = {
      x: previous.x - current.x,
      y: previous.y - current.y
    };
    const secondVector = {
      x: next.x - current.x,
      y: next.y - current.y
    };
    const dot = firstVector.x * secondVector.x + firstVector.y * secondVector.y;
    const firstMagnitude = Math.hypot(firstVector.x, firstVector.y);
    const secondMagnitude = Math.hypot(secondVector.x, secondVector.y);
    return Math.acos(Math.max(-1, Math.min(1, dot / (firstMagnitude * secondMagnitude)))) * (180 / Math.PI);
  });
}

/**
 * Returns the bond lengths for an ordered ring path.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Ordered ring atom IDs.
 * @returns {number[]} Ring bond lengths.
 */
function ringBondLengths(coords, atomIds) {
  return atomIds.map((atomId, index) => distance(coords.get(atomId), coords.get(atomIds[(index + 1) % atomIds.length])));
}

/**
 * Returns the smaller bond angle at one center atom in degrees.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstNeighborAtomId - First neighbor atom ID.
 * @param {string} secondNeighborAtomId - Second neighbor atom ID.
 * @returns {number} Smaller bond angle in degrees.
 */
function bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  return angularDifference(angleOf(sub(coords.get(firstNeighborAtomId), coords.get(centerAtomId))), angleOf(sub(coords.get(secondNeighborAtomId), coords.get(centerAtomId)))) * (180 / Math.PI);
}

/**
 * Returns the shortest distance from a point to a finite segment.
 * @param {{x: number, y: number}} point - Point to measure.
 * @param {{x: number, y: number}} firstEndpoint - Segment start.
 * @param {{x: number, y: number}} secondEndpoint - Segment end.
 * @returns {number} Distance to the segment.
 */
function pointToSegmentDistance(point, firstEndpoint, secondEndpoint) {
  const segment = sub(secondEndpoint, firstEndpoint);
  const segmentLengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (segmentLengthSquared === 0) {
    return distance(point, firstEndpoint);
  }
  const rawProjection = ((point.x - firstEndpoint.x) * segment.x + (point.y - firstEndpoint.y) * segment.y) / segmentLengthSquared;
  const projection = Math.max(0, Math.min(1, rawProjection));
  return distance(point, {
    x: firstEndpoint.x + segment.x * projection,
    y: firstEndpoint.y + segment.y * projection
  });
}

function pathLikeRingChainAspect(layoutGraph, coords) {
  const ringChain = describePathLikeIsolatedRingChain(layoutGraph, layoutGraph.components[0]);
  assert.ok(ringChain, 'expected a path-like isolated ring chain');
  const ringSystemById = new Map(ringChain.ringSystems.map(ringSystem => [ringSystem.id, ringSystem]));
  const centers = ringChain.orderedRingSystemIds.map(ringSystemId => {
    const ringSystem = ringSystemById.get(ringSystemId);
    const positions = ringSystem.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    return centroid(positions);
  });
  const xs = centers.map(position => position.x);
  const ys = centers.map(position => position.y);
  return (Math.max(...xs) - Math.min(...xs)) / Math.max(Math.max(...ys) - Math.min(...ys), 1e-6);
}

function maxAngleDeviation(angles, targetAngle) {
  return Math.max(...angles.map(angle => Math.abs(angle - targetAngle)));
}

function assertOrthogonalCross(angles, label) {
  const sortedAngles = [...angles].map(angle => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((first, second) => first - second);
  const deltas = sortedAngles.map((angle, index) => (sortedAngles[(index + 1) % sortedAngles.length] - angle + Math.PI * 2) % (Math.PI * 2));
  for (const delta of deltas) {
    assert.ok(Math.abs(delta - Math.PI / 2) < 1e-6, `${label} expected orthogonal 90 degree separations, got ${deltas.map(candidate => ((candidate * 180) / Math.PI).toFixed(3)).join(', ')}`);
  }
}

/**
 * Returns the placement-stage audit and final pipeline result for one SMILES input.
 * @param {string} smiles - SMILES string.
 * @param {object} [options] - Pipeline options.
 * @returns {{placement: object, placementAudit: object, result: object}} Placement result, placement audit, and final result.
 */
function inspectPlacementAndFinalAudit(smiles, options = { suppressH: true }) {
  const molecule = parseSMILES(smiles);
  const normalizedOptions = normalizeOptions(options);
  const layoutGraph = createLayoutGraphFromNormalized(molecule, normalizedOptions);
  const familySummary = classifyFamily(layoutGraph);
  const policy = resolvePolicy(resolveProfile(normalizedOptions.profile), {
    ...layoutGraph.traits,
    ...familySummary
  });
  const placement = layoutSupportedComponents(layoutGraph, policy);
  const placementAudit = auditLayout(layoutGraph, placement.coords, {
    bondLength: normalizedOptions.bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });

  return {
    placement,
    placementAudit,
    result: runPipeline(molecule, options)
  };
}

/**
 * Returns the ring-outward angle used by branch placement for one ring anchor.
 * Multi-ring anchors use the whole ring-system centroid; single-ring anchors
 * use the local ring centroid.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @returns {number|null} Preferred ring-outward angle in radians.
 */
function preferredRingAttachmentAngle(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const anchorRingCount = layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0;
  if (anchorRingCount > 1) {
    const ringSystem = layoutGraph.ringSystems.find(candidateRingSystem => candidateRingSystem.atomIds.includes(anchorAtomId));
    const positions = ringSystem?.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId)) ?? [];
    return positions.length >= 3 ? angleOf(sub(anchorPosition, centroid(positions))) : null;
  }
  const ring = (layoutGraph.atomToRings.get(anchorAtomId) ?? [])[0] ?? null;
  if (!ring) {
    return null;
  }
  return angleOf(sub(anchorPosition, centroid(ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))));
}

function distancePointToSegment(point, firstPoint, secondPoint) {
  const deltaX = secondPoint.x - firstPoint.x;
  const deltaY = secondPoint.y - firstPoint.y;
  const spanSquared = deltaX * deltaX + deltaY * deltaY;
  if (spanSquared <= 1e-12) {
    return Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y);
  }
  const projection = ((point.x - firstPoint.x) * deltaX + (point.y - firstPoint.y) * deltaY) / spanSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const closestPoint = {
    x: firstPoint.x + deltaX * clampedProjection,
    y: firstPoint.y + deltaY * clampedProjection
  };
  return Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y);
}

function pointOnSegment(point, firstPoint, secondPoint) {
  return (
    point.x >= Math.min(firstPoint.x, secondPoint.x) - 1e-9 &&
    point.x <= Math.max(firstPoint.x, secondPoint.x) + 1e-9 &&
    point.y >= Math.min(firstPoint.y, secondPoint.y) - 1e-9 &&
    point.y <= Math.max(firstPoint.y, secondPoint.y) + 1e-9
  );
}

function orientation(firstPoint, secondPoint, thirdPoint) {
  const determinant = (secondPoint.x - firstPoint.x) * (thirdPoint.y - firstPoint.y) - (secondPoint.y - firstPoint.y) * (thirdPoint.x - firstPoint.x);
  if (Math.abs(determinant) <= 1e-12) {
    return 0;
  }
  return determinant > 0 ? 1 : -1;
}

function distanceBetweenSegments(firstStart, firstEnd, secondStart, secondEnd) {
  const firstOrientationA = orientation(firstStart, firstEnd, secondStart);
  const firstOrientationB = orientation(firstStart, firstEnd, secondEnd);
  const secondOrientationA = orientation(secondStart, secondEnd, firstStart);
  const secondOrientationB = orientation(secondStart, secondEnd, firstEnd);
  if (
    (firstOrientationA !== firstOrientationB && secondOrientationA !== secondOrientationB) ||
    (firstOrientationA === 0 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (firstOrientationB === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (secondOrientationA === 0 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (secondOrientationB === 0 && pointOnSegment(firstEnd, secondStart, secondEnd))
  ) {
    return 0;
  }
  return Math.min(
    distancePointToSegment(firstStart, secondStart, secondEnd),
    distancePointToSegment(firstEnd, secondStart, secondEnd),
    distancePointToSegment(secondStart, firstStart, firstEnd),
    distancePointToSegment(secondEnd, firstStart, firstEnd)
  );
}

function nearestHeavyBondDistance(layoutGraph, coords, firstAtomId, secondAtomId) {
  let bestDistance = Infinity;
  for (const bond of layoutGraph.bonds.values()) {
    if (
      bond.kind !== 'covalent' ||
      layoutGraph.atoms.get(bond.a)?.element === 'H' ||
      layoutGraph.atoms.get(bond.b)?.element === 'H' ||
      bond.a === firstAtomId ||
      bond.b === firstAtomId ||
      bond.a === secondAtomId ||
      bond.b === secondAtomId
    ) {
      continue;
    }
    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    const thirdPosition = coords.get(bond.a);
    const fourthPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition || !thirdPosition || !fourthPosition) {
      continue;
    }
    bestDistance = Math.min(bestDistance, distanceBetweenSegments(firstPosition, secondPosition, thirdPosition, fourthPosition));
  }
  return bestDistance;
}

describe('layout/engine/pipeline', () => {
  it('short-circuits invalid and atom-less inputs with a stable unsupported result', () => {
    const emptyMolecule = new Molecule();
    const invalidResult = runPipeline(null);
    const emptyResult = runPipeline(emptyMolecule);

    assert.equal(invalidResult.metadata.stage, 'unsupported');
    assert.equal(invalidResult.metadata.audit.reason, 'invalid-molecule');
    assert.equal(invalidResult.metadata.fixedAtomCount, 0);
    assert.equal(invalidResult.metadata.existingCoordCount, 0);
    assert.equal(invalidResult.layoutGraph, null);

    assert.equal(emptyResult.metadata.stage, 'unsupported');
    assert.equal(emptyResult.metadata.audit.reason, 'empty-molecule');
    assert.equal(emptyResult.metadata.primaryFamily, 'empty');
    assert.deepEqual(emptyResult.metadata.placedFamilies, []);
    assert.equal(emptyResult.layoutGraph, null);
  });

  it('classifies primary families across the milestone-1 family boundary', () => {
    assert.deepEqual(
      classifyFamily({
        options: { largeMoleculeThreshold: { heavyAtomCount: 100, ringSystemCount: 10, blockCount: 16 } },
        traits: { heavyAtomCount: 2, containsMetal: false, ringSystemCount: 0 },
        components: [{}],
        rings: [],
        ringSystems: [],
        ringConnections: [],
        atoms: new Map([
          ['a0', { id: 'a0', element: 'C' }],
          ['a1', { id: 'a1', element: 'C' }]
        ])
      }),
      { primaryFamily: 'acyclic', mixedMode: false }
    );

    assert.equal(
      classifyFamily({
        options: { largeMoleculeThreshold: { heavyAtomCount: 100, ringSystemCount: 10, blockCount: 16 } },
        traits: { heavyAtomCount: 2, containsMetal: true, ringSystemCount: 0 },
        components: [{}],
        rings: [],
        ringSystems: [],
        ringConnections: [],
        atoms: new Map()
      }).primaryFamily,
      'organometallic'
    );

    assert.equal(
      classifyFamily({
        options: { largeMoleculeThreshold: { heavyAtomCount: 100, ringSystemCount: 10, blockCount: 16 } },
        traits: { heavyAtomCount: 12, containsMetal: false, ringSystemCount: 1 },
        components: [{}],
        rings: [{ atomIds: ['a0'], size: 12 }],
        ringSystems: [{ ringIds: [0] }],
        ringConnections: [],
        atoms: new Map([['a0', { id: 'a0', element: 'C' }]])
      }).primaryFamily,
      'macrocycle'
    );

    assert.equal(
      classifyFamily({
        options: { largeMoleculeThreshold: { heavyAtomCount: 5, ringSystemCount: 10, blockCount: 16 } },
        traits: { heavyAtomCount: 6, containsMetal: false, ringSystemCount: 0 },
        components: [{}],
        rings: [],
        ringSystems: [],
        ringConnections: [],
        atoms: new Map()
      }).primaryFamily,
      'large-molecule'
    );
  });

  it('marks mixed mode when a ring scaffold carries non-ring heavy atoms', () => {
    const result = runPipeline(makeMethylbenzene());
    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.coords.has('a6'), true);
  });

  it('runs the milestone-1 pipeline shell and seeds incoming coordinates', () => {
    const molecule = makeOrganometallic();
    const result = runPipeline(molecule, {
      existingCoords: new Map([['n1', { x: 1, y: 2 }]]),
      fixedCoords: new Map([['ru', { x: 0, y: 0 }]])
    });
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.fixedAtomCount, 1);
    assert.equal(result.metadata.existingCoordCount, 1);
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.metadata.unplacedComponentCount, 0);
    assert.ok(result.coords.has('ru'));
    assert.ok(result.coords.has('n1'));
    assert.equal(result.metadata.policy.organometallicMode, 'ligand-first');
    assert.equal(result.metadata.ringDependency.ok, true);
    assert.equal(typeof result.metadata.stereo.ezViolationCount, 'number');
    assert.equal(Array.isArray(result.metadata.stereo.assignments), true);
    assert.equal(typeof result.metadata.cleanupPasses, 'number');
    assert.equal(typeof result.metadata.cleanupImprovement, 'number');
    assert.equal(typeof result.metadata.audit.ok, 'boolean');
  });

  it('records per-phase timing metadata when explicitly enabled', () => {
    const result = runPipeline(makeOrganometallic(), {
      timing: true
    });

    assert.ok(result.metadata.timing);
    assert.equal(typeof result.metadata.timing.totalMs, 'number');
    assert.equal(typeof result.metadata.timing.placementMs, 'number');
    assert.equal(typeof result.metadata.timing.cleanupMs, 'number');
    assert.equal(typeof result.metadata.timing.finalRetouchMs, 'number');
    assert.equal(typeof result.metadata.timing.finalRetouchBreakdownMs, 'object');
    assert.equal(typeof result.metadata.timing.cleanupStageBudget, 'object');
    assert.equal(typeof result.metadata.timing.cleanupStageBudget.limitMs, 'number');
    assert.equal(typeof result.metadata.timing.cleanupStageBudget.skippedStageCount, 'number');
    assert.equal(typeof result.metadata.timing.labelClearanceMs, 'number');
    assert.equal(typeof result.metadata.timing.stereoMs, 'number');
    assert.equal(typeof result.metadata.timing.auditMs, 'number');
    assert.ok(result.metadata.timing.totalMs >= 0);
    assert.ok(result.metadata.timing.placementMs >= 0);
    assert.ok(result.metadata.timing.cleanupMs >= 0);
    assert.ok(result.metadata.timing.finalRetouchMs >= 0);
    assert.ok(result.metadata.timing.cleanupStageBudget.limitMs > 0);
    assert.ok(result.metadata.timing.labelClearanceMs >= 0);
    assert.ok(result.metadata.timing.stereoMs >= 0);
    assert.ok(result.metadata.timing.auditMs >= 0);
  });

  it('exports placement and stage telemetry when audit telemetry is enabled', () => {
    const result = runPipeline(parseSMILES('CC1=CC=CC=C1'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(typeof result.metadata.placementFamily, 'string');
    assert.ok(Array.isArray(result.metadata.placementModes));
    assert.ok(Array.isArray(result.metadata.componentPlacements));
    assert.ok(result.metadata.placementAudit);
    assert.equal(typeof result.metadata.placementAudit.labelOverlapCount, 'number');
    assert.equal(typeof result.metadata.placementAudit.meanBondLengthDeviation, 'number');
    assert.ok(result.metadata.stageTelemetry);
    assert.ok(result.metadata.cleanupTelemetry);
    assert.equal(typeof result.metadata.stageTelemetry.selectedStage, 'string');
    assert.ok(result.metadata.stageTelemetry.stageAudits.placement);
    assert.ok(result.metadata.stageTelemetry.stageAudits[result.metadata.stageTelemetry.selectedStage]);
    assert.equal(result.metadata.cleanupTelemetry.selectedStage, result.metadata.stageTelemetry.selectedStage);
    assert.equal(result.metadata.cleanupTelemetry.selectedGeometryStage, result.metadata.stageTelemetry.selectedGeometryStage);
    assert.equal(result.metadata.cleanupTelemetry.stages.selectedGeometryCheckpoint?.targetStage, 'selectedGeometryCheckpoint');
    assert.equal(result.metadata.cleanupTelemetry.stages.stereoRescueCleanup?.targetStage, 'stereoRescueCleanup');
    assert.equal(result.metadata.cleanupTelemetry.stages.stereoTouchup?.targetStage, 'stereoRescueCleanup');
    assert.equal(result.metadata.cleanupTelemetry.stages.stereoTouchup.category, 'stereo-rescue');
    assert.equal(result.metadata.cleanupTelemetry.stages.placement?.ran, true);
    assert.equal(typeof result.metadata.cleanupTelemetry.stages.placement?.elapsedMs, 'number');
    assert.equal(result.metadata.cleanupTelemetry.selectedStageAlias, result.metadata.cleanupTelemetry.stages[result.metadata.cleanupTelemetry.selectedStage]?.targetStage ?? null);
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, result.metadata.cleanupTelemetry.stages[result.metadata.cleanupTelemetry.selectedStage]?.category ?? null);
    assert.equal(result.metadata.cleanupTelemetry.stages[result.metadata.cleanupTelemetry.selectedStage]?.won, true);
  });

  it('skips cleanup stages when placement already passes cleanly', () => {
    const result = runPipeline(parseSMILES('CC1=CC=CC=C1'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.placementAudit.ok, true);
    assert.equal(result.metadata.cleanupFastPath, true);
    assert.equal(result.metadata.cleanupTelemetry.selectedGeometryStage, 'placement');
    assert.equal(result.metadata.cleanupTelemetry.selectedStage, 'selectedGeometryCheckpoint');
    assert.equal(result.metadata.cleanupTelemetry.counts.stagesRan, 2);
    assert.equal(result.metadata.cleanupTelemetry.stages.coreGeometryCleanup?.ran, false);
    assert.equal(result.metadata.cleanupTelemetry.stages.stereoRescueCleanup?.ran, false);
    assert.equal(result.metadata.cleanupTelemetry.stages.presentationCleanup?.ran, false);
    assert.equal(result.metadata.cleanupTelemetry.stages.specialistCleanup?.ran, false);
    assert.equal(result.metadata.cleanupTelemetry.stages.stabilizeAfterCleanup?.ran, false);
  });

  it('does not fast-path audit-clean placements with remaining angle presentation need', () => {
    const result = runPipeline(parseSMILES('O=CC12CC(C1)CC2'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.placementAudit.ok, true);
    assert.equal(result.metadata.cleanupFastPath, false);
    assert.equal(result.metadata.cleanupTelemetry.selectedStage, 'terminalMultipleBondLeafFinalRetouch');
    assert.ok(result.metadata.cleanupTelemetry.counts.stagesRan > 2);
  });

  it('reuses the selected geometry checkpoint audit when final coords stay unchanged', () => {
    const result = runPipeline(parseSMILES('CC1=CC=CC=C1'), {
      suppressH: true,
      auditTelemetry: true,
      timing: true
    });

    assert.equal(result.metadata.cleanupTelemetry.selectedStage, 'selectedGeometryCheckpoint');
    assert.equal(result.metadata.timing.auditMs, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.ezCheckedBondCount, 0);
    assert.equal(result.metadata.stereo.chiralCenterCount, 0);
  });

  it('keeps stageTelemetry and cleanupTelemetry audits aligned', () => {
    const result = runPipeline(parseSMILES('COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13'), {
      suppressH: true,
      auditTelemetry: true
    });
    const { cleanupTelemetry, stageTelemetry } = result.metadata;

    assert.equal(cleanupTelemetry.selectedStage, stageTelemetry.selectedStage);
    assert.equal(cleanupTelemetry.selectedGeometryStage, stageTelemetry.selectedGeometryStage);
    for (const [stageName, audit] of Object.entries(stageTelemetry.stageAudits)) {
      assert.deepEqual(cleanupTelemetry.stages[stageName]?.audit, audit);
    }
  });

  it('advances bridged molecules to coordinates-ready when a template exists', () => {
    const result = runPipeline(makeNorbornane());
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 7);
  });

  it('also advances unmatched bridged cages through the KK fallback path', () => {
    const result = runPipeline(makeUnmatchedBridgedCage());
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 6);
  });

  it('keeps large unmatched bridged cages under the KK fallback runtime budget without catastrophic geometry', () => {
    const molecule = parseSMILES(
      'O=C(OCC)C1(C(OCC)=O)C2(C3=C4C5=C6C7=C8C9=C%10C%11=C%12C%13=C%14C%15=C%16C%17=C%18C%19=C%20C%21=C4C%22=C5C%23=C7C%24=C9C%25=C%26C%27=C(C%14=C%17C%28=C%27C%29=C%26C%24=C%23C%30=C%29C(C%20=C%22%30)=C%18%28)C%13=C%10%25)C%21=C%19C%16=C%31C%15=C%12C%32=C%11C8=C6C3=C%32C2%311'
    );
    const start = Date.now();
    const result = runPipeline(molecule, { suppressH: true, timing: true });
    const elapsed = Date.now() - start;

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.coords.size, molecule.atoms.size);
    assert.ok(result.metadata.audit.severeOverlapCount <= 5);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= 25);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 1.0);
    assert.ok(result.metadata.timing.placementMs < 1000, `expected the large unmatched bridged cage to avoid the runaway KK loop, got ${result.metadata.timing.placementMs}ms`);
    assert.ok(elapsed < 2000, `expected the large unmatched bridged cage to finish comfortably under 2s, got ${elapsed}ms`);
  });

  it('keeps compact bridged cages off the dense-cage tidy hook', () => {
    const result = runPipeline(parseSMILES('C1(CC2(CC3(CC1CC(C2)C3)))'), { suppressH: true });

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, false);
    assert.equal(result.metadata.cleanupPostHookNudges, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  });

  it('keeps five-aryl-fused bridged cyclohexane cores regular around spiro branches', () => {
    const result = runPipeline(parseSMILES('CN1CCC2(CC(CO)CC2N)C2=NNN=C12'), {
      suppressH: true,
      auditTelemetry: true
    });
    const fusedCyclohexaneAtomIds = ['C17', 'C13', 'C5', 'C4', 'C3', 'N2'];
    const fusedAromaticAtomIds = ['C17', 'N16', 'N15', 'N14', 'C13'];
    const spiroSideRingAtomIds = ['C11', 'C10', 'C7', 'C6', 'C5'];
    const fusedCyclohexaneAngles = ringAngles(result.coords, fusedCyclohexaneAtomIds);
    const fusedCyclohexaneBonds = ringBondLengths(result.coords, fusedCyclohexaneAtomIds);
    const fusedAromaticAngles = ringAngles(result.coords, fusedAromaticAtomIds);
    const spiroSideRingAngles = ringAngles(result.coords, spiroSideRingAtomIds);
    const spiroSideRingBonds = ringBondLengths(result.coords, spiroSideRingAtomIds);

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.25);
    assert.ok(maxAngleDeviation(fusedCyclohexaneAngles, 120) < 1e-6, `expected the fused six-ring to stay exact, got ${fusedCyclohexaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      Math.max(...fusedCyclohexaneBonds) / Math.min(...fusedCyclohexaneBonds) < 1.01,
      `expected the fused six-ring bonds to stay even, got ${fusedCyclohexaneBonds.map(length => length.toFixed(2)).join(', ')}`
    );
    assert.ok(maxAngleDeviation(fusedAromaticAngles, 108) < 1e-6, `expected the fused aromatic five-ring to stay exact, got ${fusedAromaticAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      maxAngleDeviation(spiroSideRingAngles, 108) < 1e-6,
      `expected the spiro side five-ring to regularize while preserving the fused core, got ${spiroSideRingAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.max(...spiroSideRingBonds) / Math.min(...spiroSideRingBonds) < 1.01,
      `expected the spiro side five-ring bonds to stay even, got ${spiroSideRingBonds.map(length => length.toFixed(2)).join(', ')}`
    );
  });

  it('keeps compact spiro oxetanes out of parent-ring bond slots after cleanup', () => {
    const result = runPipeline(parseSMILES('CC1(C)Oc2ccc(cc2C3(COC(=N3)N)C14COC4)c5cncc(Cl)c5'), { suppressH: true, auditTelemetry: true });
    const oxetaneAngles = ringAngles(result.coords, ['C20', 'O19', 'C18', 'C17']);
    const spiroParentSeparation = bondAngleAtAtom(result.coords, 'C17', 'C2', 'C20');
    const spiroSideSeparation = bondAngleAtAtom(result.coords, 'C17', 'C11', 'C18');

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(
      Math.min(spiroParentSeparation, spiroSideSeparation) >= 45 - 1e-6,
      `expected the spiro oxetane bonds to avoid the parent-ring slots, got ${spiroParentSeparation.toFixed(2)} and ${spiroSideSeparation.toFixed(2)} degrees`
    );
    assert.ok(maxAngleDeviation(oxetaneAngles, 90) < 1e-6, `expected the oxetane to remain square, got ${oxetaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('avoids catastrophic bridge projection on dense mixed bridged cages', () => {
    const result = runPipeline(
      parseSMILES('COC(=O)C1=C2Nc3ccccc3[C@@]24CCN5[C@@H]6O[C@]78[C@H]9C[C@]%10%11CCO[C@H]%10CCN%12CC[C@]7([C@H]%11%12)c%13cccc(OC)c%13N8C[C@]6(C9)[C@@H]%14OCC[C@]%14(C1)[C@@H]45'),
      { suppressH: true, auditTelemetry: true }
    );

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.ok(['specialistCleanup', 'stabilizeAfterCleanup'].includes(result.metadata.cleanupTelemetry?.selectedStage));
    assert.ok(['specialist', 'stabilization'].includes(result.metadata.cleanupTelemetry?.selectedStageCategory));
    assert.deepEqual(result.metadata.cleanupTelemetry?.stabilizationRequests.stages, ['specialistCleanup']);
    assert.deepEqual(result.metadata.cleanupTelemetry?.stabilizationRequests.reasons, ['specialist:bridged']);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= 1);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.7);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 1);
    assert.ok(result.metadata.cleanupPostHookNudges > 0);

    const oxolaneAngles = ringAngles(result.coords, ['C29', 'O28', 'C27', 'C26', 'C25']);
    assert.ok(Math.min(...oxolaneAngles) > 70, `expected the peripheral oxolane ring to avoid pinched corners, got ${oxolaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(oxolaneAngles, 108) < 13, `expected the peripheral oxolane ring to stay readable, got ${oxolaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    const centralEtherAngles = ringAngles(result.coords, ['C50', 'C22', 'C21', 'O20', 'C18', 'C49']);
    assert.ok(maxAngleDeviation(centralEtherAngles, 120) < 13, `expected the central ether ring to avoid a skewed bridge, got ${centralEtherAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    const centralEtherBondLengths = ringBondLengths(result.coords, ['C50', 'C22', 'C21', 'O20', 'C18', 'C49']);
    assert.ok(
      Math.max(...centralEtherBondLengths) / Math.min(...centralEtherBondLengths) < 1.65,
      `expected the central ether ring to avoid extreme short/long bonds, got ${centralEtherBondLengths.map(length => length.toFixed(3)).join(', ')}`
    );
    const rightAmineAngles = ringAngles(result.coords, ['C37', 'C36', 'C35', 'C34', 'N33']);
    assert.ok(maxAngleDeviation(rightAmineAngles, 108) < 13, `expected the right amine ring to keep regular corners, got ${rightAmineAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    const fusedIndoleFiveAngles = ringAngles(result.coords, ['C14', 'C13', 'C8', 'N7', 'C6']);
    assert.ok(
      maxAngleDeviation(fusedIndoleFiveAngles, 108) < 13,
      `expected the fused indole-adjacent five-ring to keep strict corners, got ${fusedIndoleFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );

    const lowerAromaticBondLengths = ringBondLengths(result.coords, ['C9', 'C10', 'C11', 'C12', 'C13', 'C8']);
    assert.ok(
      Math.max(...lowerAromaticBondLengths.map(length => Math.abs(length - 1.5))) < 0.45,
      `expected the lower aromatic ring around C11 to stay even, got ${lowerAromaticBondLengths.map(length => length.toFixed(3)).join(', ')}`
    );
    const lowerAromaticAngles = ringAngles(result.coords, ['C9', 'C10', 'C11', 'C12', 'C13', 'C8']);
    assert.ok(
      maxAngleDeviation(lowerAromaticAngles, 120) < 13,
      `expected the lower aromatic ring around C11 to avoid flattening, got ${lowerAromaticAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    const rightAromaticBondLengths = ringBondLengths(result.coords, ['C46', 'C39', 'C40', 'C41', 'C42', 'C43']);
    assert.ok(
      Math.max(...rightAromaticBondLengths.map(length => Math.abs(length - 1.5))) < 0.45,
      `expected the right aromatic ring around C42 to stay even, got ${rightAromaticBondLengths.map(length => length.toFixed(3)).join(', ')}`
    );
    const rightAromaticAngles = ringAngles(result.coords, ['C46', 'C39', 'C40', 'C41', 'C42', 'C43']);
    assert.ok(
      maxAngleDeviation(rightAromaticAngles, 120) < 13,
      `expected the right aromatic ring around C42 to avoid flattening, got ${rightAromaticAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
  });

  it('routes exact cubane cage matches through the bridged template path', () => {
    const result = runPipeline(parseSMILES('C12C3C4C1C5C4C3C25'));
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, false);
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['bridged']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('keeps the bridged sulfur-oxygen cage on the template-backed mixed path instead of the catastrophic fallback', () => {
    const result = runPipeline(parseSMILES('CC1(C)CC2CC(C2)COC2=CC=C1S2'), { suppressH: true, auditTelemetry: true });
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok((result.metadata.placementAudit?.maxBondLengthDeviation ?? 1) < 0.35);
  });

  it('keeps the acyl-substituted spiro-bridged aza cage compact and crossing-free', () => {
    const result = runPipeline(parseSMILES('CCC(=O)C1CC2(C1)[NH2+]C1CC2C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bridgedReadabilityFailure, false);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.32);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);

    const rightSpiroCornerAngle = bondAngleAtAtom(result.coords, 'C13', 'C7', 'C14');
    const rightAmmoniumRingAngle = bondAngleAtAtom(result.coords, 'C11', 'C14', 'N9');
    const ammoniumBridgeAngle = bondAngleAtAtom(result.coords, 'N9', 'C7', 'C11');
    const rightRingBondLengths = [
      distance(result.coords.get('C13'), result.coords.get('C14')),
      distance(result.coords.get('C14'), result.coords.get('C11')),
      distance(result.coords.get('C11'), result.coords.get('N9')),
      distance(result.coords.get('N9'), result.coords.get('C7'))
    ];

    assert.ok(rightSpiroCornerAngle > 48, `expected the right spiro corner to open, got ${rightSpiroCornerAngle.toFixed(2)} degrees`);
    assert.ok(rightAmmoniumRingAngle > 67, `expected the ammonium-side ring to stay open, got ${rightAmmoniumRingAngle.toFixed(2)} degrees`);
    assert.ok(ammoniumBridgeAngle > 88, `expected the ammonium bridge to avoid pinching, got ${ammoniumBridgeAngle.toFixed(2)} degrees`);
    assert.ok(Math.min(...rightRingBondLengths) > 1.18, `expected right-side ring bonds to avoid compression, got ${rightRingBondLengths.map(length => length.toFixed(3)).join(', ')}`);
  });

  it('uses the N-methyl lactam diazatricyclo template instead of pinching the fused five-rings', () => {
    const result = runPipeline(parseSMILES('CN1CCC2C3NC(=O)C2([NH3+])CC13'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C14', 'C6', 'C5', 'C4', 'C3', 'N2'],
      ['C10', 'C13', 'C14', 'C6', 'C5'],
      ['C10', 'C5', 'C6', 'N7', 'C8']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.35);
    assert.ok(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords).length <= 1);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 60, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 136, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.35, `expected ${ring.join('-')} bonds to stay bounded, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the ammonium cyclobutyl-pyrrolidine template instead of crossing the charged cage', () => {
    const result = runPipeline(parseSMILES('CNC1=C(N(C)C=C1)C12CC(C1)C[NH2+]2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C9', 'C10', 'C11', 'C12'],
      ['C9', 'C12', 'C11', 'C13', 'N14'],
      ['C3', 'C4', 'N5', 'C7', 'C8']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.6);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 45, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 110, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.4);
    }
  });

  it('uses the azabicyclo-pyrrolidine template instead of stretching the neutral amine cage', () => {
    const result = runPipeline(parseSMILES('CC(C)C(NC12CN(C1)CC2)C#N'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C11', 'C10', 'N8', 'C9', 'C6'],
      ['C9', 'N8', 'C7', 'C6']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.35);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 44, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 105, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.15, `expected ${ring.join('-')} bonds to stay compact, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the shared-edge tricyclic ether template instead of crossing the saturated cage', () => {
    const result = runPipeline(parseSMILES('CC1COCCCC23CCCC12CCC3'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C12', 'C8', 'C7', 'C6', 'C5', 'O4', 'C3', 'C2'],
      ['C9', 'C10', 'C11', 'C12', 'C8'],
      ['C12', 'C13', 'C14', 'C15', 'C8']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 85, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 165, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.4, `expected ${ring.join('-')} bonds to stay compact, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the N-methyl amino diaza tricyclo template instead of folding the aminal cage', () => {
    const result = runPipeline(parseSMILES('CN1CC2CC(C)(N)CC11CNC21'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C9', 'C10', 'C13', 'C4', 'C5', 'C6'],
      ['C10', 'C13', 'C4', 'C3', 'N2'],
      ['C13', 'N12', 'C11', 'C10']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.25);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);

    const sixRingAngles = ringAngles(result.coords, ringAtomIds[0]);
    assert.ok(Math.min(...sixRingAngles) > 100, `expected six-ring lane to stay structured, got ${sixRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...sixRingAngles) < 155, `expected six-ring lane to avoid over-flattening, got ${sixRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);

    const fiveRingAngles = ringAngles(result.coords, ringAtomIds[1]);
    assert.ok(Math.min(...fiveRingAngles) > 55, `expected diaza lane to stay open, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fiveRingAngles) < 155, `expected diaza lane to avoid over-flattening, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);

    const fourRingAngles = ringAngles(result.coords, ringAtomIds[2]);
    assert.ok(Math.min(...fourRingAngles) > 80, `expected aminal cap to stay open, got ${fourRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fourRingAngles) < 110, `expected aminal cap to avoid over-flattening, got ${fourRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);

    for (const ring of ringAtomIds) {
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.2, `expected ${ring.join('-')} bonds to stay bounded, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the substituted bicyclo[2.1.1]hexane template before attaching the azetidinium side ring', () => {
    const result = runPipeline(parseSMILES('N#CC(C1C[NH2+]C1)C12CC(C1)CC2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C14', 'C13', 'C11', 'C12', 'C9'],
      ['C12', 'C11', 'C10', 'C9'],
      ['C8', 'N6', 'C5', 'C4']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 45, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 113, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.4, `expected ${ring.join('-')} bonds to stay compact, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
    assert.ok(Math.abs(ringAngles(result.coords, ringAtomIds[0])[0] - ringAngles(result.coords, ringAtomIds[0])[1]) < 1);
    assert.ok(Math.abs(ringAngles(result.coords, ringAtomIds[0])[2] - ringAngles(result.coords, ringAtomIds[0])[4]) < 1);
  });

  it('uses the trigonal-carbon bicyclo[2.1.1]hexane template instead of pinching the formyl cage', () => {
    const result = runPipeline(parseSMILES('O=CC12CC(C1)CC2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C8', 'C7', 'C5', 'C6', 'C3'],
      ['C6', 'C5', 'C4', 'C3']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 45, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 123, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.4, `expected ${ring.join('-')} bonds to stay compact, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
    assert.ok(Math.abs(ringAngles(result.coords, ringAtomIds[0])[0] - ringAngles(result.coords, ringAtomIds[0])[1]) < 1);
    assert.ok(Math.abs(ringAngles(result.coords, ringAtomIds[0])[2] - ringAngles(result.coords, ringAtomIds[0])[4]) < 1);
  });

  it('uses the cyclopropane-capped azacyclooctane template instead of collapsing compact ammonium cages', () => {
    const result = runPipeline(parseSMILES('CC1C2CC3(CC3)C1C(C)C[NH2+]C(C)(C)C2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C17', 'C14', 'N12', 'C11', 'C9', 'C8', 'C2', 'C3'],
      ['C8', 'C5', 'C4', 'C3', 'C2'],
      ['C7', 'C6', 'C5']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 50, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 150, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.4, `expected ${ring.join('-')} bonds to stay compact, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the hydroxy aminopropyl cyclobutane-decalin template instead of flattening the saturated cage', () => {
    const result = runPipeline(parseSMILES('CC1CC2(C1)CC1(O)CCC2C(CC[NH3+])C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringAtomIds = [
      ['C6', 'C7', 'C9', 'C10', 'C11', 'C4'],
      ['C11', 'C12', 'C17', 'C7', 'C6', 'C4'],
      ['C5', 'C4', 'C3', 'C2']
    ];
    const visibleCrossings = findVisibleHeavyBondCrossings(result.layoutGraph, result.coords);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.3);
    assert.ok(visibleCrossings.length <= 1);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(result.coords, ring);
      const lengths = ring.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 55, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 136, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < result.layoutGraph.options.bondLength * 1.4, `expected ${ring.join('-')} bonds to stay compact, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the bridged lactone template instead of collapsing compact oxabicyclic rings', () => {
    const result = runPipeline(parseSMILES('CN(CCN)C(=[NH2+])C1CCC2CCC1OC2=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const sixMemberRingAngles = ringAngles(result.coords, ['C17', 'O16', 'C15', 'C14', 'C13', 'C12']);
    const sevenMemberRingAngles = ringAngles(result.coords, ['C15', 'O16', 'C17', 'C12', 'C11', 'C10', 'C9']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const angle of sixMemberRingAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-4, `expected the lactone six-ring to stay regular, got ${sixMemberRingAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    assert.ok(Math.min(...sixMemberRingAngles) > 100, `expected the lactone ring to stay open, got ${sixMemberRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...sevenMemberRingAngles) > 95, `expected the larger bridged ring to stay open, got ${sevenMemberRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the hydroxy diformyl bicyclooctadiene template instead of flattening bridged six-rings', () => {
    const { result } = inspectPlacementAndFinalAudit('CCCC1C(O)C2C(C=O)=CC1C=C2C=O', {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const upperRingAngles = ringAngles(result.coords, ['C7', 'C8', 'C11', 'C12', 'C4', 'C5']);
    const lowerRingAngles = ringAngles(result.coords, ['C12', 'C13', 'C14', 'C7', 'C5', 'C4']);
    const firstFormylAngle = bondAngleAtAtom(result.coords, 'C9', 'C8', 'O10');
    const secondFormylAngle = bondAngleAtAtom(result.coords, 'C15', 'C14', 'O16');

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(Math.min(...upperRingAngles) > 95, `expected upper bridged ring to stay open, got ${upperRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...lowerRingAngles) > 70, `expected lower bridged ring to stay open, got ${lowerRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      Math.max(...upperRingAngles, ...lowerRingAngles) < 160,
      `expected bridged rings to avoid flattened fallback geometry, got ${[...upperRingAngles, ...lowerRingAngles].map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(Math.abs(firstFormylAngle - 120) < 1e-6, `expected C9 formyl angle to stay trigonal, got ${firstFormylAngle.toFixed(2)}`);
    assert.ok(Math.abs(secondFormylAngle - 120) < 1e-6, `expected C15 formyl angle to stay trigonal, got ${secondFormylAngle.toFixed(2)}`);
  });

  it('uses the alkenyl phenyl oxabicycloheptane template instead of crossing the ether cage', () => {
    const { result } = inspectPlacementAndFinalAudit('CCCCC(C)(C)C(O)C=CC1C2CC(CO2)(C1CC=CCCCC([O-])=O)C1=CC=CC=C1', {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbocycleAngles = ringAngles(result.coords, ['C18', 'C15', 'C14', 'C13', 'C12']);
    const etherRingAngles = ringAngles(result.coords, ['O17', 'C16', 'C15', 'C14', 'C13']);
    const allRingAngles = [...carbocycleAngles, ...etherRingAngles];
    const allRingLengths = [...ringBondLengths(result.coords, ['C18', 'C15', 'C14', 'C13', 'C12']), ...ringBondLengths(result.coords, ['O17', 'C16', 'C15', 'C14', 'C13'])];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.34);
    assert.ok(Math.min(...allRingAngles) > 100, `expected the oxabicycloheptane rings to stay open, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...allRingAngles) < 116, `expected the oxabicycloheptane rings to avoid flat shared paths, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...allRingLengths) > result.layoutGraph.options.bondLength * 0.7);
    assert.ok(Math.max(...allRingLengths) < result.layoutGraph.options.bondLength * 1.34);
  });

  it('uses the caged hydroxy lactone template instead of flattening the steroid-like ring system', () => {
    const { result } = inspectPlacementAndFinalAudit('[H][C@@]12C[C@@]3(CC1=C)[C@@]([H])(CC2)[C@@]12CC[C@]([H])(O)[C@@](C)(C(=O)O1)[C@@]2([H])[C@]3([H])C(O)=O', {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const leftSixAngles = ringAngles(result.coords, ['C11', 'C10', 'C8', 'C4', 'C3', 'C2']);
    const rightSixAngles = ringAngles(result.coords, ['C18', 'C23', 'C12', 'C13', 'C14', 'C15']);
    const lactoneAngles = ringAngles(result.coords, ['O22', 'C20', 'C18', 'C23', 'C12']);
    const centralBridgeAngles = ringAngles(result.coords, ['C25', 'C23', 'C12', 'C8', 'C4']);
    const c12LactoneExitSeparation = bondAngleAtAtom(result.coords, 'C12', 'O22', 'C13');
    const c20CarbonylAngles = [bondAngleAtAtom(result.coords, 'C20', 'O22', 'O21'), bondAngleAtAtom(result.coords, 'C20', 'C18', 'O21')];
    const carbonylLeafEdgeClearance = pointToSegmentDistance(result.coords.get('O21'), result.coords.get('C14'), result.coords.get('C15'));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(Math.min(...leftSixAngles) > 88, `expected the left six-ring to stay open, got ${leftSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...rightSixAngles) > 100, `expected the lactone-side six-ring to stay readable, got ${rightSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...lactoneAngles) > 87, `expected the embedded lactone to avoid pinching, got ${lactoneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(c12LactoneExitSeparation > 25, `expected the C12 lactone exits to separate, got ${c12LactoneExitSeparation.toFixed(2)}`);
    assert.ok(Math.min(...c20CarbonylAngles) > 116, `expected the C20 carbonyl to stay trigonal, got ${c20CarbonylAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...c20CarbonylAngles) < 127, `expected the C20 carbonyl to avoid over-opening, got ${c20CarbonylAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(carbonylLeafEdgeClearance > 0.26, `expected the exocyclic carbonyl leaf to clear the fused-ring edge, got ${carbonylLeafEdgeClearance.toFixed(3)}`);
    assert.ok(Math.max(...centralBridgeAngles) < 112, `expected the central bridge to stay compact but regular, got ${centralBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the oxazabicyclic lactam template instead of crossing compact bridged rings', () => {
    const result = runPipeline(parseSMILES('CC1(CC#N)CC2COC1C(=O)N2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const etherRingAngles = ringAngles(result.coords, ['C6', 'C7', 'C8', 'O9', 'C10', 'C2']);
    const lactamRingAngles = ringAngles(result.coords, ['C10', 'C11', 'N13', 'C7', 'C6', 'C2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(Math.min(...etherRingAngles) > 90, `expected the ether bridged ring to stay open, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...lactamRingAngles) > 105, `expected the lactam bridged ring to stay open, got ${lactamRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the hydroxy oxazabicyclic lactam template so the terminal alcohol clears the lactam nitrogen', () => {
    const result = runPipeline(parseSMILES('OC1C2CNC(=O)C1O2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const lactamRingAngles = ringAngles(result.coords, ['C8', 'O9', 'C3', 'C4', 'N5', 'C6']);
    const hydroxyBridgeAngles = ringAngles(result.coords, ['C8', 'O9', 'C3', 'C2']);
    const alcoholNitrogenClearance = distance(result.coords.get('O1'), result.coords.get('N5'));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(alcoholNitrogenClearance > result.layoutGraph.options.bondLength * 0.8, `expected O1 to clear N5, got ${alcoholNitrogenClearance.toFixed(3)}`);
    assert.ok(Math.min(...lactamRingAngles) > 75, `expected the lactam lane to stay open, got ${lactamRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...hydroxyBridgeAngles) > 65, `expected the hydroxy bridge to stay open, got ${hydroxyBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the acetal amino decalin template so bridged six-member rings do not flatten', () => {
    const result = runPipeline(parseSMILES('COC(OC)[C@@]12CC[C@@H]3CCCC3(C1)[C@@H](N[C@@H]2C(=O)OC)C(=O)OC'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const lowerSixAngles = ringAngles(result.coords, ['C15', 'C6', 'C7', 'C8', 'C9', 'C14']);
    const aminoSixAngles = ringAngles(result.coords, ['C15', 'C14', 'C16', 'N18', 'C19', 'C6']);
    const exteriorFiveAngles = ringAngles(result.coords, ['C14', 'C13', 'C12', 'C11', 'C9']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.4);
    assert.ok(Math.min(...lowerSixAngles) > 115, `expected the lower six-member ring to stay regular, got ${lowerSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...lowerSixAngles) < 125, `expected the lower six-member ring to stay regular, got ${lowerSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...aminoSixAngles) > 75, `expected the amino six-member ring to stay open, got ${aminoSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...aminoSixAngles) < 145, `expected the amino six-member ring to avoid flattening, got ${aminoSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...exteriorFiveAngles) > 104, `expected the exterior five-member ring to stay regular, got ${exteriorFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...exteriorFiveAngles) < 112, `expected the exterior five-member ring to stay regular, got ${exteriorFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the hydroxy amino oxabicyclic acetal template instead of flattening the shared bridge', () => {
    const result = runPipeline(parseSMILES('CC(O)C(O)C1C2COC(C2(C)O)C1(N)CO'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const etherRingAngles = ringAngles(result.coords, ['C8', 'O9', 'C10', 'C11', 'C7']);
    const carbocycleRingAngles = ringAngles(result.coords, ['C14', 'C10', 'C11', 'C7', 'C6']);
    const sharedBridgeAngle = bondAngleAtAtom(result.coords, 'C11', 'C10', 'C7');

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 1);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.4);
    assert.ok(Math.min(...etherRingAngles) > 85, `expected the ether acetal ring to stay open, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...etherRingAngles) < 145, `expected the ether acetal ring to avoid flattening, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...carbocycleRingAngles) > 50, `expected the carbocyclic acetal ring to stay open, got ${carbocycleRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...carbocycleRingAngles) < 145, `expected the carbocyclic acetal ring to avoid flattening, got ${carbocycleRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(sharedBridgeAngle > 115 && sharedBridgeAngle < 155, `expected the shared bridge to stay bent, got ${sharedBridgeAngle.toFixed(2)}`);
  });

  it('uses the aryl phosphite spiro template instead of crossing the polyaryl bridge', () => {
    const result = runPipeline(parseSMILES('COP1OC2=CC=CC3=C2C2(C4=CC=CC=C4OC4=CC=CC(O1)=C24)C1=CC=CC=C1O3'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const lowerLeftArylAngles = ringAngles(result.coords, ['C10', 'C9', 'C8', 'C7', 'C6', 'C5']);
    const upperLeftArylAngles = ringAngles(result.coords, ['C25', 'C23', 'C22', 'C21', 'C20', 'C19']);
    const upperRightArylAngles = ringAngles(result.coords, ['C13', 'C14', 'C15', 'C16', 'C17', 'C12']);
    const lowerRightArylAngles = ringAngles(result.coords, ['C27', 'C28', 'C29', 'C30', 'C31', 'C26']);
    const spiroAngles = [
      ['C10', 'C12'],
      ['C12', 'C25'],
      ['C25', 'C26'],
      ['C26', 'C10']
    ].map(([firstNeighborAtomId, secondNeighborAtomId]) => bondAngleAtAtom(result.coords, 'C11', firstNeighborAtomId, secondNeighborAtomId));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const angles of [lowerLeftArylAngles, upperLeftArylAngles, upperRightArylAngles, lowerRightArylAngles]) {
      assert.ok(Math.min(...angles) > 118, `expected every aryl lobe to stay regular, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 122, `expected every aryl lobe to stay regular, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
    }
    assert.ok(Math.min(...spiroAngles) > 70, `expected the C11 spiro fan to stay open, got ${spiroAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the imino oxazocine lactam template instead of crossing the lactam ether bridge', () => {
    const result = runPipeline(parseSMILES('CC1CN=C(NC=O)C2CCC1NC(=O)CO2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const iminoRingAngles = ringAngles(result.coords, ['C12', 'C11', 'C10', 'C9', 'C5', 'N4', 'C3', 'C2']);
    const lactamEtherRingAngles = ringAngles(result.coords, ['O17', 'C16', 'C14', 'N13', 'C12', 'C11', 'C10', 'C9']);
    const lactamCarbonylLength = distance(result.coords.get('C14'), result.coords.get('O15'));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.4);
    assert.ok(Math.min(...iminoRingAngles) > 110, `expected the imino ring lane to stay open, got ${iminoRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...iminoRingAngles) < 150, `expected the imino ring lane to avoid flattening, got ${iminoRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...lactamEtherRingAngles) > 85, `expected the lactam ether ring to stay open, got ${lactamEtherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...lactamEtherRingAngles) < 152, `expected the lactam ether ring to avoid flattening, got ${lactamEtherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.abs(lactamCarbonylLength - result.layoutGraph.options.bondLength) < 0.01, `expected the lactam carbonyl to keep exact length, got ${lactamCarbonylLength.toFixed(2)}`);
  });

  it('uses the alkylidene oxime bicyclohexane template instead of crossing the theta ring', () => {
    const result = runPipeline(parseSMILES('CC(C)C(=NO)C1CC2(C)CC1C2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclopentaneAngles = ringAngles(result.coords, ['C12', 'C13', 'C9', 'C8', 'C7']);
    const cyclobutaneAngles = ringAngles(result.coords, ['C13', 'C12', 'C11', 'C9']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.36);
    assert.ok(Math.min(...cyclopentaneAngles) > 95, `expected the compact five-ring to stay open, got ${cyclopentaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclopentaneAngles) < 118, `expected the compact five-ring to avoid flattened fallback geometry, got ${cyclopentaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclobutaneAngles) > 60, `expected the compact four-ring to avoid pinching, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneAngles) < 140, `expected the compact four-ring to avoid flattened fallback geometry, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the aminomethyl oxabicyclobutane template instead of crossing the ammonium sidechain', () => {
    const result = runPipeline(parseSMILES('CCC12CC(O1)C2C[NH3+]'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbonCapAngles = ringAngles(result.coords, ['C4', 'C5', 'O6', 'C3']);
    const aminomethylBridgeAngles = ringAngles(result.coords, ['O6', 'C5', 'C7', 'C3']);
    const carbonCapCenterlineDistance = distancePointToSegment(result.coords.get('C4'), result.coords.get('O6'), result.coords.get('C7'));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.36);
    assert.ok(Math.min(...carbonCapAngles) > 58, `expected the oxabicyclobutane cap to stay open, got ${carbonCapAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...carbonCapAngles) < 140, `expected the oxabicyclobutane cap to avoid flattened fallback geometry, got ${carbonCapAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...aminomethylBridgeAngles) > 80, `expected the aminomethyl bridge ring to stay open, got ${aminomethylBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      Math.max(...aminomethylBridgeAngles) < 110,
      `expected the aminomethyl bridge ring to avoid flattened fallback geometry, got ${aminomethylBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(carbonCapCenterlineDistance < 1e-6, `expected the compact bridge atom to align with the stacked top and bottom ring atoms, got ${carbonCapCenterlineDistance.toFixed(4)}`);
  });

  it('uses the cyclopropane azabicyclic enone template instead of crossing the bridged lanes', () => {
    const result = runPipeline(parseSMILES('CCOCC1=CC(=O)C2CCNC1C1CC21'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbocycleAngles = ringAngles(result.coords, ['C13', 'C14', 'C16', 'C9', 'C7', 'C6', 'C5']);
    const azaRingAngles = ringAngles(result.coords, ['C10', 'C11', 'N12', 'C13', 'C14', 'C16', 'C9']);
    const cyclopropaneAngles = ringAngles(result.coords, ['C16', 'C15', 'C14']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.3);
    assert.ok(
      Math.min(...carbocycleAngles, ...azaRingAngles) > 105,
      `expected the bridged seven-rings to stay open, got ${[...carbocycleAngles, ...azaRingAngles].map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.max(...carbocycleAngles, ...azaRingAngles) < 145,
      `expected the bridged seven-rings to avoid folded fallback geometry, got ${[...carbocycleAngles, ...azaRingAngles].map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(Math.min(...cyclopropaneAngles) > 55, `expected the cyclopropane cap to stay triangular, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclopropaneAngles) < 65, `expected the cyclopropane cap to stay triangular, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the azabicyclo ketone oxadiazole template instead of flattening the theta cage', () => {
    const result = runPipeline(parseSMILES('O=C1C2C[NH2+]C1C2C1=NON=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ammoniumRingAngles = ringAngles(result.coords, ['C4', 'N5', 'C7', 'C8', 'C3']);
    const ketoneBridgeAngles = ringAngles(result.coords, ['C7', 'C8', 'C3', 'C2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.2);
    assert.ok(Math.min(...ammoniumRingAngles) > 95, `expected the ammonium ring to stay open, got ${ammoniumRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...ammoniumRingAngles) < 125, `expected the ammonium ring to avoid flat shared paths, got ${ammoniumRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...ketoneBridgeAngles) > 70, `expected the ketone bridge ring to avoid pinching, got ${ketoneBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...ketoneBridgeAngles) < 115, `expected the ketone bridge ring to avoid flattening, got ${ketoneBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the hydroxy keto oxadiazole template so the carbonyl exits outside the bridged core', () => {
    const result = runPipeline(parseSMILES('CCC1CC2(O)C(C)CC3=C(N=CO3)C1C2=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ringSystem = result.layoutGraph.ringSystems[0];
    const ringSystemCentroid = centroid(ringSystem.atomIds.map(atomId => result.coords.get(atomId)));
    const carbonylCenterDistance = distance(result.coords.get('C16'), ringSystemCentroid);
    const carbonylOxygenDistance = distance(result.coords.get('O17'), ringSystemCentroid);
    const carbonylFanAngles = [bondAngleAtAtom(result.coords, 'C16', 'C15', 'C5'), bondAngleAtAtom(result.coords, 'C16', 'C15', 'O17'), bondAngleAtAtom(result.coords, 'C16', 'C5', 'O17')];
    const carbonylRingAngles = ringAngles(result.coords, ['C15', 'C16', 'C5', 'C4', 'C3']);
    const oxadiazoleAngles = ringAngles(result.coords, ['O14', 'C13', 'N12', 'C11', 'C10']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(
      carbonylOxygenDistance > carbonylCenterDistance + result.layoutGraph.options.bondLength * 0.6,
      `expected the carbonyl oxygen to project outside the ring system, got center distance ${carbonylCenterDistance.toFixed(2)} and oxygen distance ${carbonylOxygenDistance.toFixed(2)}`
    );
    assert.ok(maxAngleDeviation(carbonylFanAngles, 120) < 18, `expected the carbonyl fan to stay trigonal, got ${carbonylFanAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...carbonylRingAngles) > 52, `expected the carbonyl cyclopentane ring to avoid pinching, got ${carbonylRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...carbonylRingAngles) < 140, `expected the carbonyl cyclopentane ring to avoid flattening, got ${carbonylRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...oxadiazoleAngles) > 90, `expected the oxadiazole ring to stay open, got ${oxadiazoleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...oxadiazoleAngles) < 126, `expected the oxadiazole ring to avoid flattening, got ${oxadiazoleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the cyanoacyl azabicyclo template instead of crossing the compact cap ring', () => {
    const result = runPipeline(parseSMILES('O=C(C#N)N1CC2CC1C2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const nitrogenRingAngles = ringAngles(result.coords, ['C9', 'C10', 'C7', 'C6', 'N5']);
    const capRingAngles = ringAngles(result.coords, ['C10', 'C9', 'C8', 'C7']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.35);
    assert.ok(Math.min(...nitrogenRingAngles) > 80, `expected the N-acyl bridged ring to stay open, got ${nitrogenRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...nitrogenRingAngles) < 135, `expected the N-acyl bridged ring to avoid flattening, got ${nitrogenRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...capRingAngles) > 80, `expected the compact cap ring to avoid pinching, got ${capRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...capRingAngles) < 105, `expected the compact cap ring to avoid flattened fallback geometry, got ${capRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the aminonitrile acetal-bridged template instead of flattening the fused saturated ring', () => {
    const result = runPipeline(parseSMILES('CC1NC2(C)CC1(OCOC1=C2C=CN1)C#N'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const saturatedRingAngles = ringAngles(result.coords, ['C7', 'C6', 'C4', 'N3', 'C2']);
    const acetalBridgeAngles = ringAngles(result.coords, ['C12', 'C11', 'O10', 'C9', 'O8', 'C7', 'C6', 'C4']);
    const heteroarylAngles = ringAngles(result.coords, ['N15', 'C14', 'C13', 'C12', 'C11']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.35);
    assert.ok(Math.min(...saturatedRingAngles) > 100, `expected the saturated N-ring to stay open, got ${saturatedRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...saturatedRingAngles) < 125, `expected the saturated N-ring to avoid flattened fallback geometry, got ${saturatedRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...acetalBridgeAngles) > 105, `expected the acetal bridge ring to stay open, got ${acetalBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...acetalBridgeAngles) < 138, `expected the acetal bridge ring to avoid flat shared paths, got ${acetalBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...heteroarylAngles) > 106, `expected the fused heteroaryl ring to stay regular, got ${heteroarylAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...heteroarylAngles) < 110, `expected the fused heteroaryl ring to stay regular, got ${heteroarylAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the azabicyclo nitrile template instead of stretching compact charged cage bonds', () => {
    const result = runPipeline(parseSMILES('C[NH+]1C2CCC1C2(C)CC#N'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const fiveRingAngles = ringAngles(result.coords, ['C5', 'C6', 'C7', 'C8', 'C4']);
    const ammoniumRingAngles = ringAngles(result.coords, ['C7', 'C8', 'C4', 'N2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.4);
    assert.ok(Math.min(...fiveRingAngles) > 100, `expected the compact carbon bridge to stay open, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fiveRingAngles) < 120, `expected the compact carbon bridge to avoid flattened fallback geometry, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...ammoniumRingAngles) > 70, `expected the charged four-ring lane to stay open, got ${ammoniumRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...ammoniumRingAngles) < 120, `expected the charged four-ring lane to avoid flattened fallback geometry, got ${ammoniumRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the ammonium cyanomethyl oxatricyclo template instead of pinching the tricyclic ether cage', () => {
    const result = runPipeline(parseSMILES('[NH3+]C1(CC#N)CC23CC(O2)C1C3'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const upperFiveRingAngles = ringAngles(result.coords, ['C13', 'C12', 'C10', 'O11', 'C8']);
    const ammoniumFiveRingAngles = ringAngles(result.coords, ['C12', 'C13', 'C8', 'C7', 'C3']);
    const oxetaneAngles = ringAngles(result.coords, ['O11', 'C10', 'C9', 'C8']);
    const bridgeheadAngles = [bondAngleAtAtom(result.coords, 'C3', 'C12', 'C7'), bondAngleAtAtom(result.coords, 'C3', 'N1', 'C4')];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.3);
    assert.ok(Math.min(...upperFiveRingAngles) > 85, `expected the upper five-ring lane to stay open, got ${upperFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...upperFiveRingAngles) < 142, `expected the upper five-ring lane to avoid flattening, got ${upperFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...ammoniumFiveRingAngles) > 60, `expected the ammonium five-ring lane to avoid pinching, got ${ammoniumFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...ammoniumFiveRingAngles) < 142, `expected the ammonium five-ring lane to avoid flattening, got ${ammoniumFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...oxetaneAngles) > 60, `expected the oxetane lane to avoid folded fallback geometry, got ${oxetaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...oxetaneAngles) < 130, `expected the oxetane lane to avoid flattening, got ${oxetaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...bridgeheadAngles) > 85, `expected C3 exits to stay separated, got ${bridgeheadAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the amino pyrimidine cyclobutane template instead of deforming the four-ring cap', () => {
    const result = runPipeline(parseSMILES('CC(C[NH3+])OC1=NC(N)=C2C3CC(C3)N12'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const fusedFiveRingAngles = ringAngles(result.coords, ['N16', 'C11', 'C12', 'C15', 'C14']);
    const heteroFiveRingAngles = ringAngles(result.coords, ['N16', 'C11', 'C9', 'N8', 'C7']);
    const cyclobutaneAngles = ringAngles(result.coords, ['C15', 'C14', 'C13', 'C12']);
    const cyclobutaneLengths = ringBondLengths(result.coords, ['C15', 'C14', 'C13', 'C12']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(
      Math.min(...fusedFiveRingAngles) > 89 && Math.max(...fusedFiveRingAngles) < 126,
      `expected the fused pyrimidine bridge to stay open, got ${fusedFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(maxAngleDeviation(heteroFiveRingAngles, 108) < 0.1, `expected the hetero five-ring to stay regular, got ${heteroFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(cyclobutaneAngles, 90) < 0.1, `expected the cyclobutane cap to stay square, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    for (const length of cyclobutaneLengths) {
      assert.ok(Math.abs(length - result.layoutGraph.options.bondLength) < 1e-4, `expected cyclobutane bonds to stay normal, got ${cyclobutaneLengths.map(value => value.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the methyl azabicyclo cyclobutanone template to keep the ketone junction open', () => {
    const result = runPipeline(parseSMILES('CC1CCCC23CC([NH+]1C2)C3=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ketoneBridgeAngle = bondAngleAtAtom(result.coords, 'C12', 'C6', 'C8');
    const carbonylExitAngles = [bondAngleAtAtom(result.coords, 'C12', 'C6', 'O13'), bondAngleAtAtom(result.coords, 'C12', 'C8', 'O13')];
    const azabicycloFiveRingAngles = ringAngles(result.coords, ['C11', 'N9', 'C8', 'C12', 'C6']);
    const cyclobutanoneAngles = ringAngles(result.coords, ['C12', 'C8', 'C7', 'C6']);
    const cyclobutanoneLengths = ringBondLengths(result.coords, ['C12', 'C8', 'C7', 'C6']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(Math.abs(ketoneBridgeAngle - 108) < 0.1, `expected C12 to stay open around 108 degrees, got ${ketoneBridgeAngle.toFixed(2)}`);
    assert.ok(Math.min(...carbonylExitAngles) > 120, `expected the C12 carbonyl to exit outside both ring bonds, got ${carbonylExitAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(azabicycloFiveRingAngles, 108) < 0.1, `expected the C11/N9/C8/C12/C6 ring to stay regular, got ${azabicycloFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      Math.min(...cyclobutanoneAngles) > 70 && Math.max(...cyclobutanoneAngles) < 110,
      `expected the cyclobutanone cap to avoid flat fallback geometry, got ${cyclobutanoneAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    for (const length of cyclobutanoneLengths) {
      assert.ok(Math.abs(length - result.layoutGraph.options.bondLength) < 1e-4, `expected cyclobutanone bonds to stay normal, got ${cyclobutanoneLengths.map(value => value.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the methyl imino oxatricyclo template instead of crossing compact cage bonds', () => {
    const result = runPipeline(parseSMILES('CN1CC23CC(C2)OC3C1=[NH2+]'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const oxacycleAngles = ringAngles(result.coords, ['C9', 'O8', 'C6', 'C7', 'C4']);
    const azacycleAngles = ringAngles(result.coords, ['C10', 'C9', 'C4', 'C3', 'N2']);
    const carbonCapAngles = ringAngles(result.coords, ['C7', 'C6', 'C5', 'C4']);
    const carbonCapLengths = ringBondLengths(result.coords, ['C7', 'C6', 'C5', 'C4']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.08);
    assert.ok(
      Math.min(...oxacycleAngles, ...azacycleAngles) > 100 && Math.max(...oxacycleAngles, ...azacycleAngles) < 116,
      `expected the fused five-ring lanes to stay open, got ${[...oxacycleAngles, ...azacycleAngles].map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.min(...carbonCapAngles) > 60 && Math.max(...carbonCapAngles) < 123,
      `expected the carbon cap to stay compact but not crossed, got ${carbonCapAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    for (const length of carbonCapLengths) {
      assert.ok(
        Math.abs(length - result.layoutGraph.options.bondLength) < result.layoutGraph.options.bondLength * 0.08,
        `expected carbon-cap bonds to stay near normal, got ${carbonCapLengths.map(value => value.toFixed(3)).join(', ')}`
      );
    }
  });

  it('uses the hydroxy aminomethyl bicyclo ketone template instead of generic bridged fallback', () => {
    const result = runPipeline(parseSMILES('C[NH2+]CC12CC(O)(C1)C(=O)C2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const ketoneFiveRingAngles = ringAngles(result.coords, ['C12', 'C10', 'C7', 'C9', 'C5']);
    const cyclobutaneAngles = ringAngles(result.coords, ['C9', 'C7', 'C6', 'C5']);
    const cyclobutaneLengths = ringBondLengths(result.coords, ['C9', 'C7', 'C6', 'C5']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.3);
    assert.ok(Math.min(...ketoneFiveRingAngles) > 40, `expected the ketone five-ring to avoid pinched fallback geometry, got ${ketoneFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...ketoneFiveRingAngles) < 125, `expected the ketone five-ring to avoid flattened fallback geometry, got ${ketoneFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclobutaneAngles) > 70, `expected the cyclobutane cap to stay open, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneAngles) < 125, `expected the cyclobutane cap to avoid flattened fallback geometry, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneLengths) < result.layoutGraph.options.bondLength * 1.3);
  });

  it('uses the bridged decalin lactam template instead of flattening shared ring paths', () => {
    const result = runPipeline(parseSMILES('CC1CC(C)C2(C)CCC1CC(=O)N2CC[NH3+]'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbocycleAngles = ringAngles(result.coords, ['C10', 'C9', 'C8', 'C6', 'C4', 'C3', 'C2']);
    const lactamRingAngles = ringAngles(result.coords, ['N14', 'C12', 'C11', 'C10', 'C9', 'C8', 'C6']);
    const allRingAngles = [...carbocycleAngles, ...lactamRingAngles];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.35);
    assert.ok(Math.min(...allRingAngles) > 70, `expected the bridged decalin lactam rings to stay open, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...allRingAngles) < 165, `expected the bridged decalin lactam rings to avoid flat shared paths, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the methyl aza oxa tricyclic template instead of crossing the amine bridge', () => {
    const result = runPipeline(parseSMILES('CC1CCC2NC(C)C3CC(CO3)C1CC2C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const amineBridgeAngles = ringAngles(result.coords, ['C9', 'C10', 'C11', 'C14', 'C15', 'C16', 'C5', 'N6', 'C7']);
    const saturatedRingAngles = ringAngles(result.coords, ['C14', 'C15', 'C16', 'C5', 'C4', 'C3', 'C2']);
    const etherRingAngles = ringAngles(result.coords, ['O13', 'C12', 'C11', 'C10', 'C9']);
    const allRingAngles = [...amineBridgeAngles, ...saturatedRingAngles, ...etherRingAngles];
    const allRingLengths = [
      ...ringBondLengths(result.coords, ['C9', 'C10', 'C11', 'C14', 'C15', 'C16', 'C5', 'N6', 'C7']),
      ...ringBondLengths(result.coords, ['C14', 'C15', 'C16', 'C5', 'C4', 'C3', 'C2']),
      ...ringBondLengths(result.coords, ['O13', 'C12', 'C11', 'C10', 'C9'])
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.22);
    assert.ok(Math.min(...allRingAngles) > 75, `expected the aza-oxa tricyclic rings to stay open, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...allRingAngles) < 145, `expected the aza-oxa tricyclic rings to avoid flattened paths, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...allRingLengths) > result.layoutGraph.options.bondLength * 0.7);
    assert.ok(Math.max(...allRingLengths) < result.layoutGraph.options.bondLength * 1.25);
  });

  it('uses the formyl aza oxatricyclo template without folding terminal amine exits through the cage', () => {
    const result = runPipeline(parseSMILES('CN1CC2CCC3(CO3)C(C1)CN2C=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbonLaneAngles = ringAngles(result.coords, ['C10', 'C12', 'N13', 'C4', 'C5', 'C6', 'C7']);
    const amineLaneAngles = ringAngles(result.coords, ['C11', 'C10', 'C12', 'N13', 'C4', 'C3', 'N2']);
    const oxiraneAngles = ringAngles(result.coords, ['O9', 'C8', 'C7']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.4);
    assert.ok(Math.abs(distance(result.coords.get('N13'), result.coords.get('C14')) - result.layoutGraph.options.bondLength) < 1e-6);
    assert.ok(Math.abs(distance(result.coords.get('N2'), result.coords.get('C1')) - result.layoutGraph.options.bondLength) < 1e-6);
    assert.ok(Math.min(...carbonLaneAngles) > 80, `expected the carbon lane to stay open, got ${carbonLaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...carbonLaneAngles) < 162, `expected the carbon lane not to flatten, got ${carbonLaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...amineLaneAngles) > 100, `expected the amine lane to stay open, got ${amineLaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...amineLaneAngles) < 150, `expected the amine lane not to flatten, got ${amineLaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...oxiraneAngles) > 50, `expected the oxirane cap to stay triangular, got ${oxiraneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...oxiraneAngles) < 80, `expected the oxirane cap to avoid stretching, got ${oxiraneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the ethyl dioxatricyclo oxetane template instead of compressing the small ether cage', () => {
    const result = runPipeline(parseSMILES('CCC12OCC11CC2CO1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const leftOxetaneAngles = ringAngles(result.coords, ['O4', 'C5', 'C6', 'C3']);
    const carbonOxetaneAngles = ringAngles(result.coords, ['C6', 'C7', 'C8', 'C3']);
    const etherRingAngles = ringAngles(result.coords, ['O10', 'C9', 'C8', 'C3', 'C6']);
    const allRingAngles = [...leftOxetaneAngles, ...carbonOxetaneAngles, ...etherRingAngles];
    const allRingLengths = [
      ...ringBondLengths(result.coords, ['O4', 'C5', 'C6', 'C3']),
      ...ringBondLengths(result.coords, ['C6', 'C7', 'C8', 'C3']),
      ...ringBondLengths(result.coords, ['O10', 'C9', 'C8', 'C3', 'C6'])
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.22);
    assert.ok(Math.min(...allRingAngles) > 78, `expected the dioxatricyclo oxetane rings to stay open, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...allRingAngles) < 136, `expected the dioxatricyclo oxetane rings to avoid flattened paths, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...allRingLengths) > result.layoutGraph.options.bondLength * 0.9);
    assert.ok(Math.max(...allRingLengths) < result.layoutGraph.options.bondLength * 1.22);
  });

  it('uses the hydroxy azatricyclo cyclohexene template instead of flattening shared bridged rings', () => {
    const result = runPipeline(parseSMILES('CN1C2CC3C=C(CN)CC(C12)C3O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclohexeneAngles = ringAngles(result.coords, ['C7', 'C10', 'C11', 'C13', 'C5', 'C6']);
    const azaCyclohexaneAngles = ringAngles(result.coords, ['C13', 'C11', 'C12', 'C3', 'C4', 'C5']);
    const aziridineAngles = ringAngles(result.coords, ['C12', 'C3', 'N2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.18);
    assert.ok(Math.min(...cyclohexeneAngles) > 50, `expected the cyclohexene lane to stay open, got ${cyclohexeneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclohexeneAngles) < 155, `expected the cyclohexene lane not to flatten, got ${cyclohexeneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...azaCyclohexaneAngles) > 80, `expected the aza cyclohexane lane to stay open, got ${azaCyclohexaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...azaCyclohexaneAngles) < 155, `expected the aza cyclohexane lane not to flatten, got ${azaCyclohexaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...aziridineAngles) > 55, `expected the aziridine cap to stay triangular, got ${aziridineAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...aziridineAngles) < 65, `expected the aziridine cap to avoid stretching, got ${aziridineAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the imino oxa azatricyclo ketone template instead of flattening shared bridged loops', () => {
    const result = runPipeline(parseSMILES('CN1CCC2(C)CCOC=NC(CO2)C(=O)C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const iminoEtherAngles = ringAngles(result.coords, ['O14', 'C13', 'C12', 'N11', 'C10', 'O9', 'C8', 'C7', 'C5']);
    const azaKetoneAngles = ringAngles(result.coords, ['C17', 'C15', 'C12', 'C13', 'O14', 'C5', 'C4', 'C3', 'N2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.22);
    assert.ok(Math.min(...iminoEtherAngles) > 65, `expected the imino ether loop to stay open, got ${iminoEtherAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...iminoEtherAngles) < 155, `expected the imino ether loop not to flatten, got ${iminoEtherAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...azaKetoneAngles) > 120, `expected the aza ketone loop to stay open, got ${azaKetoneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...azaKetoneAngles) < 155, `expected the aza ketone loop not to flatten, got ${azaKetoneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the cyclopropyl lactam pentacycle template instead of flattening compact cage rings', () => {
    const result = runPipeline(parseSMILES('CC1C2C=C3C4C2C42C(CC(=O)N12)C3C=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const enoneRingAngles = ringAngles(result.coords, ['C5', 'C6', 'C7', 'C3', 'C4']);
    const lactamRingAngles = ringAngles(result.coords, ['C10', 'C11', 'N13', 'C8', 'C9']);
    const aldehydeBridgeAngles = ringAngles(result.coords, ['C14', 'C9', 'C8', 'C6', 'C5']);
    const azaBridgeAngles = ringAngles(result.coords, ['N13', 'C8', 'C7', 'C3', 'C2']);
    const cyclopropaneAngles = ringAngles(result.coords, ['C8', 'C7', 'C6']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.31);
    assert.ok(Math.min(...enoneRingAngles) > 70, `expected the enone five-ring to stay open, got ${enoneRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...enoneRingAngles) < 150, `expected the enone five-ring to avoid flattening, got ${enoneRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...lactamRingAngles) > 95, `expected the lactam five-ring to stay open, got ${lactamRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...lactamRingAngles) < 130, `expected the lactam five-ring to avoid flattening, got ${lactamRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...aldehydeBridgeAngles) > 80, `expected the aldehyde bridge ring to stay open, got ${aldehydeBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...aldehydeBridgeAngles) < 150, `expected the aldehyde bridge ring to avoid flattening, got ${aldehydeBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...azaBridgeAngles) > 80, `expected the aza bridge ring to stay open, got ${azaBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...azaBridgeAngles) < 155, `expected the aza bridge ring to avoid flattening, got ${azaBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclopropaneAngles) > 40, `expected the cyclopropane cap to stay triangular, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclopropaneAngles) < 75, `expected the cyclopropane cap to avoid stretching, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the hydroxy thiazole cyclopropyl pentacycle template to keep compact fused rings readable', () => {
    const result = runPipeline(parseSMILES('CC12C3C4C=CC1(O)C1=NSC4=C1C23C=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclohexeneAngles = ringAngles(result.coords, ['C6', 'C7', 'C2', 'C3', 'C4', 'C5']);
    const cyclopropaneAngles = ringAngles(result.coords, ['C14', 'C3', 'C2']);

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.mixedMode, true);
    assert.ok(result.metadata.audit.severeOverlapCount <= 1);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 2);
    assert.ok(result.metadata.audit.ringSubstituentReadabilityFailureCount <= 1);
    assert.ok(result.metadata.audit.inwardRingSubstituentCount <= 1);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.38);
    assert.ok(Math.min(...cyclohexeneAngles) > 50, `expected the cyclohexene lane to stay open, got ${cyclohexeneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclohexeneAngles) < 150, `expected the cyclohexene lane not to flatten, got ${cyclohexeneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclopropaneAngles) > 50, `expected the cyclopropane cap to stay triangular, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclopropaneAngles) < 75, `expected the cyclopropane cap to avoid stretching, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the sulfonyl aza cycloheptene cyclopropane template to keep the alkene fused ring readable', () => {
    const result = runPipeline(parseSMILES('CCC12C3C4=CCCC(CN1S4(=O)=O)C23OC'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclohepteneAngles = ringAngles(result.coords, ['C6', 'C7', 'C8', 'C9', 'C15', 'C4', 'C5']);
    const azaFiveRingAngles = ringAngles(result.coords, ['N11', 'C10', 'C9', 'C15', 'C3']);
    const sulfoneFiveRingAngles = ringAngles(result.coords, ['S12', 'N11', 'C3', 'C4', 'C5']);
    const cyclopropaneAngles = ringAngles(result.coords, ['C15', 'C4', 'C3']);

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.mixedMode, true);
    assert.ok(result.metadata.audit.severeOverlapCount <= 1);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 1);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.ringSubstituentReadabilityFailureCount <= 1);
    assert.ok(result.metadata.audit.inwardRingSubstituentCount <= 1);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.41);
    assert.ok(Math.min(...cyclohepteneAngles) > 90, `expected the alkene seven-ring to stay open, got ${cyclohepteneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclohepteneAngles) < 155, `expected the alkene seven-ring to avoid flattening, got ${cyclohepteneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...azaFiveRingAngles) > 50, `expected the aza five-ring to stay open, got ${azaFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...azaFiveRingAngles) < 156, `expected the aza five-ring to avoid flattening, got ${azaFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...sulfoneFiveRingAngles) > 50, `expected the sulfone five-ring to stay open, got ${sulfoneFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...sulfoneFiveRingAngles) < 156, `expected the sulfone five-ring to avoid flattening, got ${sulfoneFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclopropaneAngles) > 54, `expected the cyclopropane cap to stay triangular, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclopropaneAngles) < 72, `expected the cyclopropane cap to avoid stretching, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the ammonium benzocyclobutane template instead of stretching the saturated bridge', () => {
    const result = runPipeline(parseSMILES('CC1=CC=CC2=C1C1([NH3+])CC2(C)C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const benzeneAngles = ringAngles(result.coords, ['C7', 'C6', 'C5', 'C4', 'C3', 'C2']);
    const fusedFiveRingAngles = ringAngles(result.coords, ['C12', 'C14', 'C8', 'C7', 'C6']);
    const cyclobutaneAngles = ringAngles(result.coords, ['C14', 'C12', 'C11', 'C8']);
    const fusedFiveRingLengths = ringBondLengths(result.coords, ['C12', 'C14', 'C8', 'C7', 'C6']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.04);
    assert.ok(Math.max(...fusedFiveRingLengths) < result.layoutGraph.options.bondLength * 1.04);
    for (const angle of benzeneAngles) {
      assert.ok(Math.abs(angle - 120) < 0.01, `expected the fused benzene ring to stay exact, got ${benzeneAngles.map(value => value.toFixed(2)).join(', ')}`);
    }
    assert.ok(Math.min(...fusedFiveRingAngles) > 95, `expected the saturated five-ring to stay open, got ${fusedFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fusedFiveRingAngles) < 120, `expected the saturated five-ring to avoid stretching flat, got ${fusedFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclobutaneAngles) > 80, `expected the fused cyclobutane to stay open, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneAngles) < 105, `expected the fused cyclobutane to avoid flattening, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the hydroxy dimethyl oxatricyclo cage template instead of flattening the alcohol bridge', () => {
    const result = runPipeline(parseSMILES('CC1(C)CC2CC3(C2)COC1C3O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const sevenRingAngles = ringAngles(result.coords, ['C11', 'C12', 'C7', 'C8', 'C5', 'C4', 'C2']);
    const etherRingAngles = ringAngles(result.coords, ['C12', 'C11', 'O10', 'C9', 'C7']);
    const cyclobutaneAngles = ringAngles(result.coords, ['C8', 'C7', 'C6', 'C5']);
    const allRingLengths = [
      ...ringBondLengths(result.coords, ['C11', 'C12', 'C7', 'C8', 'C5', 'C4', 'C2']),
      ...ringBondLengths(result.coords, ['C12', 'C11', 'O10', 'C9', 'C7']),
      ...ringBondLengths(result.coords, ['C8', 'C7', 'C6', 'C5'])
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.3);
    assert.ok(Math.min(...sevenRingAngles) > 80, `expected the seven-member cage lane to stay open, got ${sevenRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...sevenRingAngles) < 135, `expected the seven-member cage lane to avoid flattening, got ${sevenRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...etherRingAngles) > 100, `expected the ether five-ring to stay open, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...etherRingAngles) < 125, `expected the ether five-ring to avoid flattening, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclobutaneAngles) > 80, `expected the fused cyclobutane to stay square, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneAngles) < 100, `expected the fused cyclobutane to avoid flattening, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...allRingLengths) > result.layoutGraph.options.bondLength * 0.78);
    assert.ok(Math.max(...allRingLengths) < result.layoutGraph.options.bondLength * 1.3);
  });

  it('uses the hydroxy oxatricyclo diol template instead of collapsing the ether cap', () => {
    const result = runPipeline(parseSMILES('OC12CCC(O)(C1)C1CC2O1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const etherCapAngles = ringAngles(result.coords, ['O11', 'C10', 'C9', 'C8']);
    const allRingLengths = [
      ...ringBondLengths(result.coords, ['C10', 'O11', 'C8', 'C5', 'C7', 'C2']),
      ...ringBondLengths(result.coords, ['C7', 'C5', 'C4', 'C3', 'C2']),
      ...ringBondLengths(result.coords, ['O11', 'C10', 'C9', 'C8'])
    ];
    const capOppositeCornerDistance = distance(result.coords.get('O11'), result.coords.get('C9'));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.31);
    assert.ok(capOppositeCornerDistance > result.layoutGraph.options.bondLength * 1.4);
    assert.ok(Math.min(...etherCapAngles) > 70, `expected the ether cap to stay open, got ${etherCapAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...etherCapAngles) < 110, `expected the ether cap to avoid flattening, got ${etherCapAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...allRingLengths) > result.layoutGraph.options.bondLength * 0.7);
    assert.ok(Math.max(...allRingLengths) < result.layoutGraph.options.bondLength * 1.31);
  });

  it('uses the dimethyl oxatricyclo cage template instead of crossing compact ether lanes', () => {
    const result = runPipeline(parseSMILES('CC12CC3CCC1C3(C)CO2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbocycleAngles = ringAngles(result.coords, ['C5', 'C6', 'C7', 'C8', 'C4']);
    const lowerCageAngles = ringAngles(result.coords, ['C8', 'C7', 'C2', 'C3', 'C4']);
    const etherRingAngles = ringAngles(result.coords, ['C7', 'C8', 'C10', 'O11', 'C2']);
    const allRingAngles = [...carbocycleAngles, ...lowerCageAngles, ...etherRingAngles];
    const allRingLengths = [
      ...ringBondLengths(result.coords, ['C5', 'C6', 'C7', 'C8', 'C4']),
      ...ringBondLengths(result.coords, ['C8', 'C7', 'C2', 'C3', 'C4']),
      ...ringBondLengths(result.coords, ['C7', 'C8', 'C10', 'O11', 'C2'])
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.34);
    assert.ok(Math.min(...allRingAngles) > 89, `expected the oxatricyclo cage rings to stay open, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...allRingAngles) < 136, `expected the oxatricyclo cage rings to avoid flattening, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...allRingLengths) > result.layoutGraph.options.bondLength * 0.7);
    assert.ok(Math.max(...allRingLengths) < result.layoutGraph.options.bondLength * 1.34);
  });

  it('uses the cyclobutane oxadecalin template instead of crossing the ether bridge', () => {
    const result = runPipeline(parseSMILES('CC1CC2(C1)C(C)CC1CCCC2CCO1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbocycleAngles = ringAngles(result.coords, ['C6', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C4']);
    const etherRingAngles = ringAngles(result.coords, ['C13', 'C14', 'C15', 'O16', 'C9', 'C8', 'C6', 'C4']);
    const cyclobutaneAngles = ringAngles(result.coords, ['C5', 'C4', 'C3', 'C2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.24);
    assert.ok(Math.min(...carbocycleAngles) > 105, `expected the carbocycle lane to stay open, got ${carbocycleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...carbocycleAngles) < 162, `expected the carbocycle lane to avoid flattening, got ${carbocycleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...etherRingAngles) > 80, `expected the ether bridge to stay readable, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...etherRingAngles) < 162, `expected the ether bridge to avoid flat crossed fallback geometry, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclobutaneAngles) > 55, `expected the cyclobutane cap to stay open, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneAngles) < 125, `expected the cyclobutane cap to avoid flattening, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the bridged pyrrolizidine dione template instead of malformed tricyclic cage rings', () => {
    const result = runPipeline(parseSMILES(String.raw`C\C=C\C=C\C(=O)C1=C(O)[C@@]2(C)[C@H]3CCCN3[C@@H]1[C@](C)(O)C2=O`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const pyrrolizidineRingAngles = ringAngles(result.coords, ['N18', 'C17', 'C16', 'C15', 'C13']);
    const upperBridgeAngles = ringAngles(result.coords, ['C9', 'C11', 'C13', 'N18', 'C19', 'C8']);
    const lowerBridgeAngles = ringAngles(result.coords, ['C19', 'C21', 'C24', 'C11', 'C9', 'C8']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.31);
    assert.ok(Math.min(...pyrrolizidineRingAngles) > 100, `expected the pyrrolizidine five-ring to stay open, got ${pyrrolizidineRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...upperBridgeAngles) > 40, `expected the upper bridged ring to avoid collapse, got ${upperBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...lowerBridgeAngles) > 40, `expected the lower bridged ring to avoid collapse, got ${lowerBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the bridged diketone tricyclo template instead of flattening the compact cage', () => {
    const result = runPipeline(parseSMILES('O=C1CC2C(=O)C3CCC12C3'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const bridgedFiveAngles = ringAngles(result.coords, ['C8', 'C9', 'C10', 'C11', 'C7']);
    const diketoneFiveAngles = ringAngles(result.coords, ['C7', 'C11', 'C10', 'C4', 'C5']);
    const cyclobutaneAngles = ringAngles(result.coords, ['C10', 'C4', 'C3', 'C2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.2);
    assert.ok(Math.min(...bridgedFiveAngles) > 40, `expected the bridged five-ring to stay open, got ${bridgedFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...bridgedFiveAngles) < 120, `expected the bridged five-ring to avoid flattening, got ${bridgedFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...diketoneFiveAngles) > 100, `expected the diketone five-ring to stay open, got ${diketoneFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...diketoneFiveAngles) < 115, `expected the diketone five-ring to avoid flattening, got ${diketoneFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclobutaneAngles) > 85, `expected the cyclobutane cap to stay square, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the amino oxaza tricyclo template instead of malformed compact bridged rings', () => {
    const result = runPipeline(parseSMILES('CC1=C2C(OC1)C1(N)C3NC3C2CC1N'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const upperRingAngles = ringAngles(result.coords, ['C12', 'C13', 'C14', 'C7', 'C4', 'C3']);
    const oxolaneAngles = ringAngles(result.coords, ['C6', 'O5', 'C4', 'C3', 'C2']);
    const aziridineAngles = ringAngles(result.coords, ['C11', 'N10', 'C9']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.31);
    assert.ok(Math.min(...upperRingAngles) > 110, `expected the bridged six-ring to stay open, got ${upperRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...oxolaneAngles) > 85, `expected the oxolane loop to stay readable, got ${oxolaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...aziridineAngles) > 48, `expected the aziridine cap to stay open, got ${aziridineAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the amino diaza tricyclo template instead of crossing compact bridged lanes', () => {
    const result = runPipeline(parseSMILES('CC1CC(O)C2CNC(=N)C1C1(C)NC=NC21'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const carbocycleAngles = ringAngles(result.coords, ['C11', 'C12', 'C17', 'C6', 'C4', 'C3', 'C2']);
    const imineBridgeAngles = ringAngles(result.coords, ['C11', 'C12', 'C17', 'C6', 'C7', 'N8', 'C9']);
    const diazaCapAtomIds = ['C17', 'N16', 'C15', 'N14', 'C12'];
    const diazaCapAngles = ringAngles(result.coords, diazaCapAtomIds);
    const diazaCapLengths = diazaCapAtomIds.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(diazaCapAtomIds[(index + 1) % diazaCapAtomIds.length])));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.4);
    assert.ok(Math.min(...carbocycleAngles) > 115, `expected the carbocycle lane to stay open, got ${carbocycleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...imineBridgeAngles) > 85, `expected the imine bridge lane to stay readable, got ${imineBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    for (const angle of diazaCapAngles) {
      assert.ok(Math.abs(angle - 108) < 0.5, `expected the diaza cap to stay regular, got ${diazaCapAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    const compactCapLength = result.layoutGraph.options.bondLength * 0.8;
    for (const length of diazaCapLengths) {
      assert.ok(Math.abs(length - compactCapLength) < 1e-4, `expected the diaza cap to stay compact, got ${diazaCapLengths.map(candidate => candidate.toFixed(3)).join(', ')}`);
    }
  });

  it('uses the imino thiazole oxaza tricyclo template instead of collapsing the fused cage', () => {
    const result = runPipeline(parseSMILES('CC1C23COC(=N)C12NCC1=C3N=C(C)S1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const sixRingAngles = ringAngles(result.coords, ['C12', 'C11', 'C10', 'N9', 'C8', 'C3']);
    const oxazaRingAngles = ringAngles(result.coords, ['C8', 'C3', 'C4', 'O5', 'C6']);
    const thiazoleAngles = ringAngles(result.coords, ['S16', 'C14', 'N13', 'C12', 'C11']);
    const cyclopropaneAngles = ringAngles(result.coords, ['C8', 'C3', 'C2']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.2);
    assert.ok(Math.min(...sixRingAngles) > 119, `expected the fused six-ring to stay regular, got ${sixRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...oxazaRingAngles) > 95, `expected the oxaza lane to stay open, got ${oxazaRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...thiazoleAngles) > 107, `expected the thiazole cap to stay regular, got ${thiazoleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclopropaneAngles) > 40, `expected the cyclopropane cap to stay visible, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the amino cyano thiazole oxatricyclo template instead of flattening the saturated six-ring', () => {
    const result = runPipeline(parseSMILES('CC12CCC(C3=NSC=C3O1)C(C)(C#N)C2N'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const saturatedSixRingAngles = ringAngles(result.coords, ['C16', 'C12', 'C5', 'C4', 'C3', 'C2']);
    const etherRingAngles = ringAngles(result.coords, ['O11', 'C10', 'C6', 'C5', 'C12', 'C16', 'C2']);
    const thiazoleAngles = ringAngles(result.coords, ['C10', 'C9', 'S8', 'N7', 'C6']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.22);
    for (const angle of saturatedSixRingAngles) {
      assert.ok(Math.abs(angle - 120) < 0.5, `expected the saturated six-ring to stay regular, got ${saturatedSixRingAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    assert.ok(Math.min(...etherRingAngles) > 85, `expected the ether bridge lane to stay open, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    for (const angle of thiazoleAngles) {
      assert.ok(Math.abs(angle - 108) < 0.5, `expected the thiazole cap to stay regular, got ${thiazoleAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
  });

  it('uses the aza-annulene cyclohexadiene template instead of pinching the six-member ring', () => {
    const result = runPipeline(parseSMILES('CCC1=NC(N)=CC(C)=CC=C2NC=CC1=C2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const sixMemberAtomIds = ['C17', 'C16', 'C15', 'C14', 'N13', 'C12'];
    const sixMemberAngles = ringAngles(result.coords, sixMemberAtomIds);
    const sixMemberLengths = sixMemberAtomIds.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(sixMemberAtomIds[(index + 1) % sixMemberAtomIds.length])));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.01);
    for (const angle of sixMemberAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-4, `expected the six-member ring to stay regular, got ${sixMemberAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    for (const length of sixMemberLengths) {
      assert.ok(
        Math.abs(length - result.layoutGraph.options.bondLength) < 1e-4,
        `expected six-member ring bonds to stay normal, got ${sixMemberLengths.map(candidate => candidate.toFixed(3)).join(', ')}`
      );
    }
  });

  it('uses the indoline aza bridged heptacycle template without collapsing bridge bonds', () => {
    const result = runPipeline(parseSMILES('CC[C@H]1[C@@H]2C[C@H]3[C@@H]4N(C)C5=CC=CC=C5[C@]44C[C@@H](C2[C@H]4O)N3[C@@H]1O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const rootRingSystem = result.layoutGraph.ringSystems[0];
    const minReadableBondLength = result.layoutGraph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor;
    const maxReadableBondLength = result.layoutGraph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor;
    const ringBondLengths = [...result.layoutGraph.bonds.values()]
      .filter(bond => bond.inRing && rootRingSystem.atomIds.includes(bond.a) && rootRingSystem.atomIds.includes(bond.b))
      .map(bond => distance(result.coords.get(bond.a), result.coords.get(bond.b)));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findSevereOverlaps(result.layoutGraph, result.coords), []);
    assert.ok(distance(result.coords.get('C8'), result.coords.get('N28')) > minReadableBondLength);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.08);
    for (const ringBondLength of ringBondLengths) {
      assert.ok(ringBondLength >= minReadableBondLength && ringBondLength <= maxReadableBondLength);
    }
  });

  it('uses the cyclobutane thiophene template instead of stretching the fused cap', () => {
    const result = runPipeline(parseSMILES('CCC1=C2C3CC(CC)(C3)C2=CS1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclobutaneAngles = ringAngles(result.coords, ['C10', 'C7', 'C6', 'C5']);
    const cyclobutaneLengths = ringBondLengths(result.coords, ['C10', 'C7', 'C6', 'C5']);
    const thiopheneAngles = ringAngles(result.coords, ['S13', 'C12', 'C11', 'C4', 'C3']);
    const bridgedFiveAngles = ringAngles(result.coords, ['C11', 'C4', 'C5', 'C10', 'C7']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(Math.min(...cyclobutaneAngles) > 80, `expected the cyclobutane cap to stay square, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneAngles) < 100, `expected the cyclobutane cap to avoid flattening, got ${cyclobutaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclobutaneLengths) < result.layoutGraph.options.bondLength * 1.15);
    assert.ok(Math.min(...thiopheneAngles) > 95, `expected the thiophene ring to stay open, got ${thiopheneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...thiopheneAngles) < 116, `expected the thiophene ring to stay regular, got ${thiopheneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...bridgedFiveAngles) > 88, `expected the fused five-ring not to pinch, got ${bridgedFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...bridgedFiveAngles) < 140, `expected the fused five-ring not to flatten, got ${bridgedFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the oxime lactam cyclopentenyl template instead of flattening the five-member ring', () => {
    const result = runPipeline(parseSMILES('CC1C2CC=C1C(=NO)C(C)C1N(CC1=O)C2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const fiveRingAngles = ringAngles(result.coords, ['C6', 'C5', 'C4', 'C3', 'C2']);
    const lactamAngles = ringAngles(result.coords, ['C15', 'C14', 'N13', 'C12']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(maxAngleDeviation(fiveRingAngles, 108) < 4, `expected the cyclopentenyl ring to stay pentagonal, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(lactamAngles, 90) < 4, `expected the beta-lactam ring to stay square, got ${lactamAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('uses the norbornene child template instead of flattening attached cyclopentyl bridges', () => {
    const result = runPipeline(parseSMILES('CSC1=CC=CC(NC2=NC(NC3C4CC(C=C4)C3C(=O)N(C)C)=C3N=CNC3=N2)=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const cyclopenteneAngles = ringAngles(result.coords, ['C18', 'C17', 'C16', 'C15', 'C14']);
    const lactamSideAngles = ringAngles(result.coords, ['C19', 'C16', 'C15', 'C14', 'C13']);
    const sharedBridgeAngles = [cyclopenteneAngles[3], lactamSideAngles[2]];

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.32);
    assert.ok(Math.min(...sharedBridgeAngles) > 75, `expected the shared cyclopentyl bridge to stay bent open, got ${sharedBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      Math.max(...cyclopenteneAngles, ...lactamSideAngles) < 150,
      `expected attached cyclopentyl rings to avoid flat shared paths, got ${[...cyclopenteneAngles, ...lactamSideAngles].map(angle => angle.toFixed(2)).join(', ')}`
    );
  });

  it('uses the amino acyl aryl norbornane template so bridgehead hydrogens stay outside the cage', () => {
    const result = runPipeline(parseSMILES('[H][C@]12CC[C@]([H])(C1)[C@](N)(C(=O)C1=CC=CC=C1)[C@]2([H])C1=CC=CC=C1'), {
      suppressH: false,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const upperRingAngles = ringAngles(result.coords, ['C7', 'C5', 'C8', 'C18', 'C2']);
    const lowerRingAngles = ringAngles(result.coords, ['C3', 'C4', 'C5', 'C7', 'C2']);
    const bridgeheadHydrogenClearances = ['C4', 'C7', 'C8'].map(atomId => distance(result.coords.get('H6'), result.coords.get(atomId)));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.37);
    assert.ok(
      Math.min(...upperRingAngles, ...lowerRingAngles) > 90,
      `expected the norbornane rings to stay open, got ${[...upperRingAngles, ...lowerRingAngles].map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.max(...upperRingAngles, ...lowerRingAngles) < 126,
      `expected the norbornane rings to avoid flattened bridge paths, got ${[...upperRingAngles, ...lowerRingAngles].map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.min(...bridgeheadHydrogenClearances) > result.layoutGraph.options.bondLength * 1.4,
      `expected the bridgehead hydrogen to project outside the cage, got ${bridgeheadHydrogenClearances.map(value => value.toFixed(2)).join(', ')}`
    );
  });

  it('uses the bridged cyclopropyl-decalin template so methoxy exits stay outside the cage', () => {
    const result = runPipeline(parseSMILES('COC12CCC(CC11CC1)CCCCCC2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const centralSixRingAngles = ringAngles(result.coords, ['C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
    const outerRingAtomIds = ['C16', 'C15', 'C14', 'C13', 'C12', 'C11', 'C6', 'C7', 'C8', 'C3'];
    const outerRingAngles = ringAngles(result.coords, outerRingAtomIds);
    const outerRingBondLengths = outerRingAtomIds.map((atomId, index) => distance(result.coords.get(atomId), result.coords.get(outerRingAtomIds[(index + 1) % outerRingAtomIds.length])));
    const cyclopropaneAngles = ringAngles(result.coords, ['C8', 'C9', 'C10']);
    const cyclopropylExitAngles = [
      bondAngleAtAtom(result.coords, 'C8', 'C3', 'C9'),
      bondAngleAtAtom(result.coords, 'C8', 'C3', 'C10'),
      bondAngleAtAtom(result.coords, 'C8', 'C7', 'C9'),
      bondAngleAtAtom(result.coords, 'C8', 'C7', 'C10')
    ];
    const methoxyToCyclopropaneJunctionAngle = bondAngleAtAtom(result.coords, 'C3', 'O2', 'C8');
    const methoxyToLargeBridgeAngle = bondAngleAtAtom(result.coords, 'C3', 'O2', 'C16');
    const methoxyToSixRingAngle = bondAngleAtAtom(result.coords, 'C3', 'O2', 'C4');

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    for (const angle of centralSixRingAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-4, `expected the six-member carbocycle to stay regular, got ${centralSixRingAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    for (const [firstIndex, secondIndex] of [
      [0, 5],
      [1, 4],
      [2, 3],
      [6, 9]
    ]) {
      assert.ok(
        Math.abs(outerRingAngles[firstIndex] - outerRingAngles[secondIndex]) < 1e-4,
        `expected the outer carbocycle to stay symmetric around the cyclohexane core, got ${outerRingAngles.map(angle => angle.toFixed(2)).join(', ')}`
      );
    }
    for (const [firstIndex, secondIndex] of [
      [0, 4],
      [1, 3],
      [5, 9]
    ]) {
      assert.ok(
        Math.abs(outerRingBondLengths[firstIndex] - outerRingBondLengths[secondIndex]) < 1e-4,
        `expected mirrored outer carbocycle bonds to match, got ${outerRingBondLengths.map(length => length.toFixed(3)).join(', ')}`
      );
    }
    assert.ok(Math.min(...cyclopropaneAngles) > 50, `expected the cyclopropane cap to stay open, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclopropylExitAngles) > 80, `expected cyclopropyl cap bonds to split the ring exterior, got ${cyclopropylExitAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      methoxyToCyclopropaneJunctionAngle > 75 && methoxyToLargeBridgeAngle > 75 && methoxyToSixRingAngle > 120,
      `expected the methoxy exit at C3 to stay outside the bridged cage, got O2-C3 angles ${methoxyToCyclopropaneJunctionAngle.toFixed(2)}, ${methoxyToLargeBridgeAngle.toFixed(2)}, ${methoxyToSixRingAngle.toFixed(2)}`
    );
  });

  it('uses the oxabicyclic lactone ammonium template so theta-lactone rings stay readable', () => {
    const result = runPipeline(parseSMILES('CCC1OC2CC(=O)OC1CC2[NH3+]'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const etherRingAngles = ringAngles(result.coords, ['C10', 'C11', 'C12', 'C5', 'O4', 'C3']);
    const lactoneRingAngles = ringAngles(result.coords, ['O9', 'C10', 'C11', 'C12', 'C5', 'C6', 'C7']);
    const ammoniumExitAngles = [bondAngleAtAtom(result.coords, 'C12', 'N13', 'C5'), bondAngleAtAtom(result.coords, 'C12', 'N13', 'C11')];
    const ethylExitAngles = [bondAngleAtAtom(result.coords, 'C3', 'C2', 'O4'), bondAngleAtAtom(result.coords, 'C3', 'C2', 'C10')];
    const carbonylExitAngles = [bondAngleAtAtom(result.coords, 'C7', 'O8', 'C6'), bondAngleAtAtom(result.coords, 'C7', 'O8', 'O9')];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.41);
    assert.ok(
      Math.min(...etherRingAngles) > 105 && Math.max(...etherRingAngles) < 148,
      `expected the oxabicyclic ether ring to read closer to a cyclohexyl chair projection, got ${etherRingAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(Math.min(...lactoneRingAngles) > 73, `expected the lactone bridge ring to avoid pinched fallback geometry, got ${lactoneRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...ammoniumExitAngles) > 100, `expected ammonium exit to stay outside the bridged lane, got ${ammoniumExitAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...ethylExitAngles) > 115, `expected ethyl exit to stay clear of the lactone bridge, got ${ethylExitAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...carbonylExitAngles) > 100, `expected carbonyl exit to stay trigonal outside the lactone, got ${carbonylExitAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('keeps compact aromatic-bridged ammonium scaffolds from folding the saturated ring flat', () => {
    const result = runPipeline(parseSMILES('CC1NC2C[NH2+]C1(C)CCOC1=CC=CC2=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const graph = result.layoutGraph;
    const strictAudit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const ammoniumBend = bondAngleAtAtom(result.coords, 'N6', 'C8', 'C5');
    const methyleneBend = bondAngleAtAtom(result.coords, 'C5', 'N6', 'C4');
    const benzeneAngles = ringAngles(result.coords, ['C18', 'C17', 'C16', 'C15', 'C14', 'C13']);

    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(strictAudit.maxBondLengthDeviation < graph.options.bondLength * 0.31);
    assert.ok(ammoniumBend > 100 && ammoniumBend < 145, `expected N6 to stay bent inside the saturated ring, got ${ammoniumBend.toFixed(2)} degrees`);
    assert.ok(methyleneBend > 100 && methyleneBend < 145, `expected C5 to stay bent inside the saturated ring, got ${methyleneBend.toFixed(2)} degrees`);
    for (const angle of benzeneAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected the fused benzene ring to stay exact, got ${angle.toFixed(2)} degrees`);
    }
  });

  it('uses the saturated morphinan template instead of stretching compact four-ring bridged cores', () => {
    const result = runPipeline(parseSMILES('[H][C@@]12CCCC[C@@]11CCN(CC=C)[C@@H]2CC2=C1C=C(O)C=C2'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const outerCyclohexaneAngles = ringAngles(result.coords, ['C3', 'C4', 'C5', 'C6', 'C7', 'C2']);
    const azaBridgeAngles = ringAngles(result.coords, ['C7', 'C8', 'C9', 'N10', 'C14', 'C2']);
    const fusedCyclohexeneAngles = ringAngles(result.coords, ['C14', 'C16', 'C17', 'C18', 'C7', 'C2']);
    const aromaticAngles = ringAngles(result.coords, ['C23', 'C22', 'C20', 'C19', 'C18', 'C17']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.22);
    for (const angle of outerCyclohexaneAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-3, `expected the outer cyclohexane to stay regular, got ${outerCyclohexaneAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    assert.ok(Math.min(...azaBridgeAngles) > 50, `expected the aza bridge to avoid collapsed fallback geometry, got ${azaBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...azaBridgeAngles) < 160, `expected the aza bridge to stay bounded, got ${azaBridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    for (const angle of fusedCyclohexeneAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-3, `expected the fused cyclohexene to stay regular, got ${fusedCyclohexeneAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    for (const angle of aromaticAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-3, `expected aromatic angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
  });

  it('uses the oripavine bridged-core template instead of malformed KK rings', () => {
    const result = runPipeline(parseSMILES('[H][C@@]12OC3=C(O)C=CC4=C3[C@@]11CCN(CC3CC3)[C@]([H])(C4)[C@]11CC[C@@]2(OC)[C@H](C1)C(C)(C)O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const crossingKeys = new Set(
      findVisibleHeavyBondCrossings(result.layoutGraph, result.coords).map(crossing => [crossing.firstAtomIds.join('-'), crossing.secondAtomIds.join('-')].sort().join(':'))
    );

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.16);
    assert.equal(crossingKeys.has('C24-C25:C28-C30'), false);
    assert.equal(crossingKeys.has('C11-C12:C19-C22'), false);
  });

  it('uses the oxaza morphinan bridged-core template instead of malformed KK rings', () => {
    const result = runPipeline(parseSMILES('COC1(NC(=O)C(=CC2=CC=CC=C2)C(F)(F)F)C=C(O)C2=C3C1OC1CCCC4C(C2)[N+](CC2CC2)(CCC314)C(C)C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const crossingCount = findVisibleHeavyBondCrossings(result.layoutGraph, result.coords).length;
    const regularSixRings = [
      ['C24', 'C23', 'C22', 'C20', 'C19', 'C3'],
      ['C40', 'C26', 'C27', 'C28', 'C29', 'C30'],
      ['C32', 'C31', 'C30', 'C40', 'C23', 'C22']
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.45);
    assert.ok(crossingCount <= 1);
    for (const ring of regularSixRings) {
      for (const angle of ringAngles(result.coords, ring)) {
        assert.ok(Math.abs(angle - 120) < 1e-4);
      }
      for (let index = 0; index < ring.length; index++) {
        const atomId = ring[index];
        const nextAtomId = ring[(index + 1) % ring.length];
        assert.ok(Math.abs(distance(result.coords.get(atomId), result.coords.get(nextAtomId)) - result.layoutGraph.options.bondLength) < 1e-4);
      }
    }
  });

  it('uses the phenolic oxaza morphinan bridged-core template instead of collapsed fallback rings', () => {
    const result = runPipeline(parseSMILES('O[C@H]1CC[C@@]2(O)[C@H]3CC4=CC=C(O)C5=C4[C@@]2(CCN3CC2CCC2)[C@H]1O5'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const crossingCount = findVisibleHeavyBondCrossings(result.layoutGraph, result.coords).length;
    const regularSixRings = [
      ['C27', 'C18', 'C6', 'C5', 'C4', 'C2'],
      ['C10', 'C11', 'C17', 'C18', 'C6', 'C8'],
      ['C17', 'C16', 'C14', 'C13', 'C12', 'C11']
    ];
    const azaBridgeAngles = ringAngles(result.coords, ['C18', 'C19', 'C20', 'N21', 'C8', 'C6']);
    const etherBridgeAngles = ringAngles(result.coords, ['O29', 'C27', 'C18', 'C17', 'C16']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.45);
    assert.ok(crossingCount <= 1);
    for (const ring of regularSixRings) {
      for (const angle of ringAngles(result.coords, ring)) {
        assert.ok(Math.abs(angle - 120) < 1e-4);
      }
      for (let index = 0; index < ring.length; index++) {
        const atomId = ring[index];
        const nextAtomId = ring[(index + 1) % ring.length];
        assert.ok(Math.abs(distance(result.coords.get(atomId), result.coords.get(nextAtomId)) - result.layoutGraph.options.bondLength) < 1e-4);
      }
    }
    assert.ok(Math.min(...azaBridgeAngles) > 45);
    assert.ok(Math.max(...azaBridgeAngles) < 140);
    assert.ok(Math.min(...etherBridgeAngles) > 88);
    assert.ok(Math.max(...etherBridgeAngles) < 125);
  });

  it('keeps the long ether-tailed phenolic oxaza morphinan cage from pinching the aza bridge', () => {
    const result = runPipeline(parseSMILES('COCCOCCOCCOCCOCCOCCOCCO[C@H]1CC[C@@]2(O)[C@H]3CC4=CC=C(O)C5=C4[C@@]2(CCN3CC=C)[C@H]1O5'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const crossingCount = findVisibleHeavyBondCrossings(result.layoutGraph, result.coords).length;
    const regularSixRings = [
      ['C47', 'C40', 'C28', 'C27', 'C26', 'C24'],
      ['C32', 'C33', 'C39', 'C40', 'C28', 'C30'],
      ['C39', 'C38', 'C36', 'C35', 'C34', 'C33']
    ];
    const azaBridgeAngles = ringAngles(result.coords, ['C40', 'C41', 'C42', 'N43', 'C30', 'C28']);
    const etherBridgeAngles = ringAngles(result.coords, ['O49', 'C47', 'C40', 'C39', 'C38']);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.26);
    assert.ok(crossingCount <= 1);
    for (const ring of regularSixRings) {
      for (const angle of ringAngles(result.coords, ring)) {
        assert.ok(Math.abs(angle - 120) < 1e-4);
      }
      for (let index = 0; index < ring.length; index++) {
        const atomId = ring[index];
        const nextAtomId = ring[(index + 1) % ring.length];
        assert.ok(Math.abs(distance(result.coords.get(atomId), result.coords.get(nextAtomId)) - result.layoutGraph.options.bondLength) < 1e-4);
      }
    }
    assert.ok(Math.min(...azaBridgeAngles) > 45);
    assert.ok(Math.max(...azaBridgeAngles) < 140);
    assert.ok(Math.min(...etherBridgeAngles) > 88);
    assert.ok(Math.max(...etherBridgeAngles) < 125);
  });

  it('snaps constructed fused junction bonds onto an axis for anthracene-like systems', () => {
    const result = runPipeline(parseSMILES('c1ccc2cc3ccccc3cc2c1'));
    const fusedConnections = result.layoutGraph.ringConnections.filter(connection => connection.kind === 'fused');

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(typeof result.metadata.cleanupJunctionSnaps, 'number');
    for (const connection of fusedConnections) {
      const [firstAtomId, secondAtomId] = connection.sharedAtomIds;
      const firstPosition = result.coords.get(firstAtomId);
      const secondPosition = result.coords.get(secondAtomId);
      assert.ok(Math.abs(firstPosition.x - secondPosition.x) < 1e-6 || Math.abs(firstPosition.y - secondPosition.y) < 1e-6);
    }
  });

  it('short-circuits giant fullerene-like fused cages to the direct cage KK rescue without changing the current audit ceiling', () => {
    const molecule = parseSMILES(
      'C12=C3C4=C5C6=C1C7=C8C9=C1C%10=C%11C(=C29)C3=C2C3=C4C4=C5C5=C9C6=C7C6=C7C8=C1C1=C8C%10=C%10C%11=C2C2=C3C3=C4C4=C5C5=C%11C%12=C(C6=C95)C7=C1C1=C%12C5=C%11C4=C3C3=C5C(=C81)C%10=C23'
    );
    const start = Date.now();
    const result = runPipeline(molecule, { suppressH: true, timing: true });
    const elapsed = Date.now() - start;

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.coords.size, molecule.atoms.size);
    assert.ok(result.metadata.audit.severeOverlapCount <= 2);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= 15);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.75);
    assert.ok(result.metadata.timing.placementMs < 1000, `expected the giant fused cage to bypass the runaway planar fused pass, got ${result.metadata.timing.placementMs}ms`);
    assert.ok(elapsed < 2000, `expected the giant fused cage to finish comfortably under 2s, got ${elapsed}ms`);
  });

  it('advances macrocycles to coordinates-ready through the ellipse placer', () => {
    const result = runPipeline(makeMacrocycle());
    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 12);
    assert.deepEqual(result.metadata.policy.postCleanupHooks, ['ring-perimeter-correction', 'ring-terminal-hetero-tidy']);
  });

  it('records organometallic post-cleanup hooks in the resolved policy metadata', () => {
    const result = runPipeline(makeOrganometallic());

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.deepEqual(result.metadata.policy.postCleanupHooks, ['ligand-angle-tidy']);
    assert.equal(typeof result.metadata.cleanupPostHookNudges, 'number');
  });

  it('keeps projected octahedral metal ligands on angled upper-dash and lower-wedge pairs after cleanup', () => {
    const result = runPipeline(parseSMILES('[Rh+3](N)(N)(N)(N)(N)N'), { suppressH: true });
    const metal = result.coords.get('Rh1');
    const projectedBondIds = new Set(result.metadata.displayAssignments.map(assignment => assignment.bondId));
    const dashBondIds = new Set(result.metadata.displayAssignments.filter(assignment => assignment.type === 'dash').map(assignment => assignment.bondId));
    const wedgeBondIds = new Set(result.metadata.displayAssignments.filter(assignment => assignment.type === 'wedge').map(assignment => assignment.bondId));

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(projectedBondIds.size, 4);

    for (const bond of result.molecule.bonds.values()) {
      if (!projectedBondIds.has(bond.id)) {
        continue;
      }
      const ligandAtomId = bond.atoms[0] === 'Rh1' ? bond.atoms[1] : bond.atoms[0];
      const ligand = result.coords.get(ligandAtomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;

      assert.ok(Math.abs(dx) > 1e-6, 'expected projected octahedral ligand to stay off the vertical axis');
      assert.ok(Math.abs(dy) > 1e-6, 'expected projected octahedral ligand to stay off the horizontal axis');
      assert.ok(Math.abs(dx) > Math.abs(dy), 'expected projected octahedral ligand to lean outward more than upward/downward');
      if (dashBondIds.has(bond.id)) {
        assert.ok(dy > 0, 'expected dash ligands to remain on the upper pair');
      }
      if (wedgeBondIds.has(bond.id)) {
        assert.ok(dy < 0, 'expected wedge ligands to remain on the lower pair');
      }
    }
  });

  it('keeps ruthenium polypyridyl coordination closures from folding ligand rings', () => {
    const result = runPipeline(
      parseSMILES('Cc1ccn2c(c1)-c1cc(CC3=C(F)C(F)=C(C(F)=C3F)C3=C(F)C(F)=C(N[C@H]4[C@H]5C[C@@H]6C[C@@H](C[C@H]4C6)C5)C(F)=C3F)ccn1[Ru++]2123N4C=CC=CC4=C4C=CC=CN14.C1=CN2C(C=C1)=C1C=CC=CN31'),
      { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true }
    );
    const rutheniumBonds = [...result.layoutGraph.bonds.values()].filter(bond => bond.a === 'Ru51' || bond.b === 'Ru51');
    const coordinateCrossings = findVisibleHeavyBondCrossings(result.layoutGraph, result.coords, {
      bondValidationClasses: result.metadata.placementBondValidationClasses
    }).filter(crossing => crossing.firstAtomIds.includes('Ru51') || crossing.secondAtomIds.includes('Ru51'));

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(rutheniumBonds.length, 6);
    assert.ok(rutheniumBonds.every(bond => bond.kind === 'coordinate'));
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(coordinateCrossings.length, 0);

    const coordinateBoundAromaticRingAtomIds = [
      ['C54', 'C55', 'C56', 'C57', 'N52', 'C53'],
      ['C60', 'C61', 'C62', 'N63', 'C58', 'C59'],
      ['C69', 'C68', 'C67', 'N66', 'C65', 'C64'],
      ['C72', 'C73', 'C74', 'N75', 'C70', 'C71'],
      ['C7', 'C6', 'N5', 'C4', 'C3', 'C2'],
      ['C48', 'C49', 'N50', 'C8', 'C9', 'C10']
    ];
    for (const ringAtomIds of coordinateBoundAromaticRingAtomIds) {
      const ringAnglesAtAtoms = ringAngles(result.coords, ringAtomIds);
      const ringLengths = ringBondLengths(result.coords, ringAtomIds);
      for (const angle of ringAnglesAtAtoms) {
        assert.ok(Math.abs(angle - 120) < 1e-4, `expected Ru-bound aromatic ring ${ringAtomIds.join(',')} to stay regular, got ${ringAnglesAtAtoms.map(value => value.toFixed(2)).join(', ')}`);
      }
      for (const length of ringLengths) {
        assert.ok(
          Math.abs(length - result.layoutGraph.options.bondLength) < 1e-4,
          `expected Ru-bound aromatic ring ${ringAtomIds.join(',')} bonds to stay normal, got ${ringLengths.map(value => value.toFixed(3)).join(', ')}`
        );
      }
    }
  });

  it('keeps haptic iron cyclopentadienyl ligands regular in the full pipeline', () => {
    const result = runPipeline(parseSMILES('C1(N(C(=O)CC1)CCC12[Fe]3456789%10C%11C3=C4C5=C6%11)=O.C7(C8=C19)=C2%10'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.deepEqual(result.metadata.placedFamilies, ['organometallic']);
    assert.equal(result.metadata.componentPlacements[0].placementMode, 'ligand-first');
    assert.equal(result.metadata.audit.ok, true);

    for (const ringAtomIds of [
      ['C9', 'C19', 'C18', 'C17', 'C20'],
      ['C15', 'C14', 'C13', 'C12', 'C11']
    ]) {
      for (const angle of ringAngles(result.coords, ringAtomIds)) {
        assert.ok(Math.abs(angle - 108) < 1e-4);
      }
      for (const length of ringBondLengths(result.coords, ringAtomIds)) {
        assert.ok(Math.abs(length - result.layoutGraph.options.bondLength) < 1e-4);
      }
    }
  });

  it('keeps organometallic acyclic E/Z rescue from being rejected by coordinate-only metal centers', () => {
    const result = runPipeline(parseSMILES(String.raw`C[C@H]1C[C@H](O)N[C@@H]2CCCCN(O[Fe@@]34O[C@@H](\C=C\CCCCCCC(O)=O)[N@](CCCC[C@H](NC(=O)[C@H]5COC(=N5)C5=CC=CC=C5O3)C(=O)O1)O4)C2=O`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe17']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps ferric hydroxamate stereocenters assigned while treating annotated iron as unsupported', () => {
    const result = runPipeline(parseSMILES(String.raw`OC(=O)CCCCCC\C=C/[C@@H]1O[Fe@]23ON1CCCC[C@@H](NC(=O)[C@@H]1CO[C@H](N1)C1=CC=CC=C1O2)C(=O)OCCC(=O)N[C@@H]1CCCCN(O3)C1=O`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.assignedCenterCount, 5);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe15']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('treats annotated porphyrin iron centers as unsupported instead of stereo contradictions', () => {
    const result = runPipeline(parseSMILES('CCC1=C(C)C2=[N+]3C1=CC1=C(C)C(C=C)=C4C=C5C(C)=C(CCC(O)=O)C6=[N+]5[Fe@@]3(N3C(=C2)C(C)=C(CCC(O)=O)C3=C6)N14'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe29']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps annotated expanded porphyrin iron centers audit-clean when unsupported', () => {
    const result = runPipeline(parseSMILES('CC1=C(CCC(O)=O)C2=CC3=[N+]4C(=CC5=C(C=C)C(C=C)=C6C=C7C(C=C)=C(C=C)C8=[N+]7[Fe@]4(N2C1=C8)N56)C(C)=C3CCC(O)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe33']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps cobalt porphyrin metal annotations unsupported instead of stereo contradictions', () => {
    const result = runPipeline(parseSMILES('CC1=C(C=C)C2=CC3=[N+]4C(=CC5=C(C)C(CCC(O)=O)=C6C=C7C(CCC(O)=O)=C(C)C8=[N+]7[Co@]4(N2C1=C8)N56)C(C=C)=C3C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Co34']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps acetyl porphyrin iron annotations unsupported instead of stereo contradictions', () => {
    const result = runPipeline(parseSMILES('CC(=O)C1=C2C=C3C(C)=C(CCC(O)=O)C4=[N+]3[Fe@@]35N6C(=CC7=[N+]3C(=CC(N25)=C1C)C(C(O)=C)=C7C)C(C)=C(CCC(O)=O)C6=C4'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe18']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps ester porphyrin iron annotations unsupported instead of stereo contradictions', () => {
    const result = runPipeline(parseSMILES('COC(=O)CCC1=C(C)C2=CC3=C(C=C)C(C)=C4C=C5N6C(=CC7=C(C)C(CCC(=O)OC)=C8C=C1N2[Fe@@]6(N78)N34)C(C)=C5C=C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe38']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps charged porphyrin iron stereocenters assigned while treating annotated iron as unsupported', () => {
    const result = runPipeline(parseSMILES('CCc1c(C)c2C=C3C(C)=C(CCC(O)=O)C4=[N+]3[Fe@+3]35[N-]6C(=CC7=[N+]3C(=Cc1[n-]25)[C@](C)(CC)C7=O)C(C)=C(CCC(O)=O)C6=C4'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.assignedCenterCount, 1);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe19']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps porphyrin dione stereocenters assigned while treating annotated iron as unsupported', () => {
    const result = runPipeline(parseSMILES('CC1=C(CCC(O)=O)C2=CC3=C(CCC(O)=O)C(C)=C4C=C5[N+]6=C(C=C7[N+]8=C(C=C1N2[Fe@]68N34)C(=O)[C@@]7(C)CC(O)=O)C(=O)[C@]5(C)CC(O)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.stereo.assignedCenterCount, 2);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe32']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps methylated porphyrin iron centers from reporting stereo contradictions', () => {
    const result = runPipeline(parseSMILES('CC1=C(CCC(O)=O)C2=CC3=[N+]4C(=CC5=C(C=C)C(C)=C6C=C7C(C=C)=C(C)C8=[N+]7[Fe@]4(N2C1=C8)N56)C(C)=C3CCC(O)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe31']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps zinc porphyrin metal annotations unsupported instead of stereo contradictions', () => {
    const result = runPipeline(parseSMILES('CC1=C(CCC(O)=O)C2=CC3=[N+]4C(=CC5=C(C=C)C(C)=C6C=C7C(C=C)=C(C)C8=[N+]7[Zn@]4(N2C1=C8)N56)C(C)=C3CCC(O)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Zn31']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps porphyrin carboxylate stereocenters assigned while treating annotated iron as unsupported', () => {
    const result = runPipeline(parseSMILES('C[C@@]1(CC(O)=O)C2=CC3=C(CC(O)=O)C(CCC(O)=O)=C4C=C5N6C(=CC7=C(CCC(O)=O)[C@](C)(CC(O)=O)C8=CC(N2[Fe@]6(N34)N78)=C1CCC(O)=O)C(CC(O)=O)=C5CCC(O)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.assignedCenterCount, 2);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe44']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps porphyrin vinyl alcohol stereocenters assigned while treating annotated iron as unsupported', () => {
    const result = runPipeline(parseSMILES('CC1=C2C=C3[C@@H](C(O)=C)C(C)=C4C=C5N6C(=CC7=C(CCC(O)=O)C(C)=C8C=C([C@@H]1C=C)N2[Fe@@]6(N34)N78)C(CCC(O)=O)=C5C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.assignedCenterCount, 2);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe36']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps porphyrin alkene stereo audit-clean while treating annotated iron as unsupported', () => {
    const result = runPipeline(parseSMILES(String.raw`C\C=C1\C(C)=C2C=C3N4C(=CC5=C(CCC(O)=O)C(C)=C6C=C7N8C(C=C1N2[Fe@]48N56)=C(C)\C7=C\C)C(CCC(O)=O)=C3C`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Fe29']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps zinc porphyrin alkene stereo audit-clean while treating annotated zinc as unsupported', () => {
    const result = runPipeline(parseSMILES(String.raw`C\C=C1\C(C)=C2C=C3N4C(=CC5=C(CCC(O)=O)C(C)=C6C=C7N8C(C=C1N2[Zn@]48N56)=C(C)\C7=C\C)C(CCC(O)=O)=C3C`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Zn29']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps covalent amine stereo assigned while treating annotated porphyrin copper as unsupported', () => {
    const result = runPipeline(parseSMILES('CCC1=C(C)C2=CC3=C(CC)C(C)=C4C=C5C(C)=C(CCC(O)=O)C6=[N+]5[Cu@@]5(N7C(=CC1=[N+]25)C(C)=C(CCC(O)=O)C7=C6)[N@+]34C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.stereo.assignedCenterCount, 1);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Cu27']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps covalent amine cage stereo assigned while treating annotated copper as unsupported', () => {
    const result = runPipeline(parseSMILES('C(C1=CC=C(C[N@+]23CC[N@@]4CCC[N@]5CC[N@](CCC2)[Cu@@]345)C=C1)[N@+]12CC[N@@]3CCC[N@]4CC[N@](CCC1)[Cu@@]234'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.stereo.assignedCenterCount, 2);
    assert.equal(result.metadata.stereo.unsupportedCenterCount, 1);
    assert.deepEqual(result.metadata.stereo.unsupportedCenterIds, ['Cu21']);
    assert.deepEqual(result.metadata.stereo.missingCenterIds, []);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps supported three-coordinate copper centers on an explicit trigonal-planar spread after cleanup', () => {
    const result = runPipeline(parseSMILES('[Cu](Cl)(Cl)Cl'), { suppressH: true });
    const metal = result.coords.get('Cu1');
    const angles = [...result.molecule.bonds.values()]
      .filter(bond => bond.atoms.includes('Cu1'))
      .map(bond => {
        const ligandAtomId = bond.atoms[0] === 'Cu1' ? bond.atoms[1] : bond.atoms[0];
        const ligand = result.coords.get(ligandAtomId);
        return Math.atan2(ligand.y - metal.y, ligand.x - metal.x);
      })
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const wrappedAngles = [...angles, angles[0] + Math.PI * 2];

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.displayAssignments.length, 0);
    for (let index = 0; index < angles.length; index++) {
      assert.ok(Math.abs(wrappedAngles[index + 1] - wrappedAngles[index] - (2 * Math.PI) / 3) < 1e-6);
    }
  });

  it('keeps projected trigonal-bipyramidal iron ligands on a left projected pair after cleanup', () => {
    const result = runPipeline(parseSMILES('[Fe](Cl)(Cl)(Cl)(Cl)Cl'), { suppressH: true });
    const metal = result.coords.get('Fe1');
    const projectedBondIds = new Set(result.metadata.displayAssignments.map(assignment => assignment.bondId));
    const dashBondIds = new Set(result.metadata.displayAssignments.filter(assignment => assignment.type === 'dash').map(assignment => assignment.bondId));
    const wedgeBondIds = new Set(result.metadata.displayAssignments.filter(assignment => assignment.type === 'wedge').map(assignment => assignment.bondId));
    const projectedOffsets = [];
    const planarOffsets = [];

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(projectedBondIds.size, 2);

    for (const bond of result.molecule.bonds.values()) {
      if (!bond.atoms.includes('Fe1')) {
        continue;
      }
      const ligandAtomId = bond.atoms[0] === 'Fe1' ? bond.atoms[1] : bond.atoms[0];
      const ligand = result.coords.get(ligandAtomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;

      if (projectedBondIds.has(bond.id)) {
        projectedOffsets.push({ bondId: bond.id, dx, dy });
        assert.ok(dx < 0);
        assert.ok(Math.abs(dx) > 1e-6);
        assert.ok(Math.abs(dy) > 1e-6);
        if (dashBondIds.has(bond.id)) {
          assert.ok(dy > 0);
        }
        if (wedgeBondIds.has(bond.id)) {
          assert.ok(dy < 0);
        }
      } else {
        planarOffsets.push({ dx, dy });
      }
    }

    assert.equal(projectedOffsets.length, 2);
    assert.equal(planarOffsets.length, 3);

    const axialOffsets = planarOffsets.filter(offset => Math.abs(offset.dy) > 1e-6);
    const equatorialOffsets = planarOffsets.filter(offset => Math.abs(offset.dy) <= 1e-6);

    assert.equal(axialOffsets.length, 2);
    assert.equal(equatorialOffsets.length, 1);
    assert.ok(axialOffsets.every(offset => Math.abs(offset.dx) < 0.1));
    assert.ok(Math.abs(axialOffsets[0].dy + axialOffsets[1].dy) < 1e-6);
    assert.ok(equatorialOffsets[0].dx > 0);
  });

  it('keeps a supported square-pyramidal rhodium center on the octahedral front/back projection without the bottom ligand', () => {
    const result = runPipeline(parseSMILES('[Rh](Cl)(Cl)(Cl)(Cl)Cl'), { suppressH: true });
    const metal = result.coords.get('Rh1');
    const projectedBondIds = new Set(result.metadata.displayAssignments.map(assignment => assignment.bondId));
    const dashBondIds = new Set(result.metadata.displayAssignments.filter(assignment => assignment.type === 'dash').map(assignment => assignment.bondId));
    const wedgeBondIds = new Set(result.metadata.displayAssignments.filter(assignment => assignment.type === 'wedge').map(assignment => assignment.bondId));
    let planarLigandCount = 0;
    let upperDashCount = 0;
    let lowerWedgeCount = 0;

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(projectedBondIds.size, 4);
    assert.equal(dashBondIds.size, 2);
    assert.equal(wedgeBondIds.size, 2);

    for (const bond of result.molecule.bonds.values()) {
      if (!bond.atoms.includes('Rh1')) {
        continue;
      }
      const ligandAtomId = bond.atoms[0] === 'Rh1' ? bond.atoms[1] : bond.atoms[0];
      const ligand = result.coords.get(ligandAtomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;

      if (projectedBondIds.has(bond.id)) {
        assert.ok(Math.abs(dx) > 1e-6);
        assert.ok(Math.abs(dy) > 1e-6);
        assert.ok(Math.abs(dx) > Math.abs(dy));
        if (dashBondIds.has(bond.id)) {
          assert.ok(dy > 0);
          upperDashCount++;
        }
        if (wedgeBondIds.has(bond.id)) {
          assert.ok(dy < 0);
          lowerWedgeCount++;
        }
      } else {
        planarLigandCount++;
        assert.ok(Math.abs(dx) < 1e-6);
        assert.ok(dy > 0);
      }
    }

    assert.equal(upperDashCount, 2);
    assert.equal(lowerWedgeCount, 2);
    assert.equal(planarLigandCount, 1);
  });

  it('keeps sulfate counter-ions as a cross-like sulfur arrangement in organometallic inputs', () => {
    const result = runPipeline(parseSMILES('[Cu+2].[O-]S(=O)(=O)[O-]'), {
      suppressH: true
    });
    const sulfurId = [...result.layoutGraph.atoms.values()].find(atom => atom.element === 'S')?.id;
    const sulfurPosition = sulfurId ? result.coords.get(sulfurId) : null;
    const singleAngles = [];
    const multipleAngles = [];

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(sulfurId);
    assert.ok(sulfurPosition);

    for (const bond of result.layoutGraph.bondsByAtomId.get(sulfurId) ?? []) {
      const neighborAtomId = bond.a === sulfurId ? bond.b : bond.a;
      const neighborPosition = result.coords.get(neighborAtomId);
      assert.ok(neighborPosition);
      const angle = angleOf(sub(neighborPosition, sulfurPosition));
      if ((bond.order ?? 1) === 1) {
        singleAngles.push(angle);
      } else {
        multipleAngles.push(angle);
      }
    }

    assert.equal(singleAngles.length, 2);
    assert.equal(multipleAngles.length, 2);
    assert.ok(Math.abs(angularDifference(singleAngles[0], singleAngles[1]) - Math.PI) < 1e-6);
    assert.ok(Math.abs(angularDifference(multipleAngles[0], multipleAngles[1]) - Math.PI) < 1e-6);
    for (const singleAngle of singleAngles) {
      for (const multipleAngle of multipleAngles) {
        assert.ok(Math.abs(angularDifference(singleAngle, multipleAngle) - Math.PI / 2) < 1e-6);
      }
    }
  });

  it('centers multi-anion organometallic salts around the metal hub instead of chaining every fragment to one side', () => {
    const result = runPipeline(parseSMILES('[Fe+2].[O-]C(=O)C1=CC=CC=C1.[O-]C(=O)C2=CC=CC=C2'), {
      suppressH: true
    });

    const components = result.layoutGraph.components;
    const metalComponent = components.find(component => component.atomIds.some(atomId => result.layoutGraph.atoms.get(atomId)?.element === 'Fe'));
    const ligandComponents = components.filter(component => component !== metalComponent);

    function componentCenterX(component) {
      const heavyAtomIds = component.atomIds.filter(atomId => result.layoutGraph.atoms.get(atomId)?.element !== 'H');
      const xs = heavyAtomIds.map(atomId => result.coords.get(atomId).x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    }

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(metalComponent);
    assert.equal(ligandComponents.length, 2);

    const metalX = componentCenterX(metalComponent);
    const ligandXs = ligandComponents.map(componentCenterX).sort((firstValue, secondValue) => firstValue - secondValue);
    const heavyPositions = [...result.coords.entries()].filter(([atomId]) => result.layoutGraph.atoms.get(atomId)?.element !== 'H').map(([, position]) => position);
    const maxX = Math.max(...heavyPositions.map(position => position.x));
    const minX = Math.min(...heavyPositions.map(position => position.x));
    const centeredError = Math.abs(metalX - (minX + maxX) / 2);

    assert.ok(ligandXs[0] < metalX && metalX < ligandXs[1]);
    assert.ok(centeredError < 0.8, `expected disconnected salt bounds to stay visibly centered on the metal hub, got error ${centeredError}`);
    assert.ok(maxX - minX < 18.1, `expected disconnected salt packing width < 18.1, got ${maxX - minX}`);
  });

  it('keeps suppressed-h simple rings audit-clean when explicit hydrogens overlap only off-screen', () => {
    const result = runPipeline(parseSMILES('C1CCCCC1'), {
      suppressH: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps reported fused-ring sugar oxygen substituent roots on their exact outward axes in the final layout', () => {
    const result = runPipeline(parseSMILES('C[C@@]1(C[C@@H](O)[C@@]2(O)C=CO[C@@H](O[C@H]3O[C@@H](CO)[C@@H](O)[C@@H](O)[C@@H]3O)[C@@H]12)OC(=O)\\C=C/c4ccccc4'), {
      suppressH: true,
      auditTelemetry: true
    });
    const checkedAnchors = [];

    for (const atomId of result.layoutGraph.components[0].atomIds) {
      if ((result.layoutGraph.ringCountByAtomId.get(atomId) ?? 0) !== 1) {
        continue;
      }
      const atom = result.layoutGraph.atoms.get(atomId);
      if (!atom || atom.aromatic || atom.heavyDegree !== 3) {
        continue;
      }
      const oxygenChildren = (result.layoutGraph.bondsByAtomId.get(atomId) ?? [])
        .filter(bond => !bond.inRing && bond.kind === 'covalent' && !bond.aromatic && (bond.order ?? 1) === 1)
        .map(bond => (bond.a === atomId ? bond.b : bond.a))
        .filter(childAtomId => (result.layoutGraph.ringCountByAtomId.get(childAtomId) ?? 0) === 0 && result.layoutGraph.atoms.get(childAtomId)?.element === 'O');
      if (oxygenChildren.length !== 1) {
        continue;
      }
      const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, atomId);
      assert.notEqual(preferredAngle, null);
      const childAngle = angleOf(sub(result.coords.get(oxygenChildren[0]), result.coords.get(atomId)));
      checkedAnchors.push(atomId);
      assert.ok(angularDifference(childAngle, preferredAngle) < 1e-6, `expected ${atomId} oxygen substituent root to follow the exact outward angle`);
    }
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(checkedAnchors.length >= 3, `expected multiple saturated ring oxygen roots to be checked, got ${checkedAnchors.length}`);
  });

  it('retries long glycoside ring-chain roots so saturated sugar exits stay linear and overlap-free', () => {
    const result = runPipeline(
      parseSMILES(
        'OC[C@@H]1O[C@H](<S[C@@H]2[C@@H](O)[C@@H](O)[C@@H](O[C@@H]3[C@@H](O)[C@@H](O)[C@H](O[C@@H]3CO)S[C@@H]3[C@@H](O)[C@@H](O)[C@@H](O[C@@H]4[C@@H](O)[C@@H](O)[C@H](O[C@@H]4CO)S[C@H]4[C@H](O)[C@@H](O)[C@H](O)O[C@H]4CO)O[C@@H]3CO)O[C@@H]2CO>)[C@H](O)[C@H](O)[C@H]1O'
      ),
      {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.equal(result.metadata.placementAudit.severeOverlapCount, 0);

    for (const [anchorAtomId, childAtomId] of [
      ['C31', 'C33'],
      ['C58', 'C60'],
      ['C75', 'C77'],
      ['C80', 'C82']
    ]) {
      const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, anchorAtomId);
      assert.notEqual(preferredAngle, null);
      const childAngle = angleOf(sub(result.coords.get(childAtomId), result.coords.get(anchorAtomId)));
      assert.ok(angularDifference(childAngle, preferredAngle) < 1e-6, `expected ${anchorAtomId}-${childAtomId} to stay on the exact sugar ring outward axis`);
    }

    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C60', 'C58', 'O61') - 120) < 1e-6);
  });

  it('keeps large sulfated glycoside chains overlap-free after dense block retry', () => {
    const result = runPipeline(
      parseSMILES(
        'CCCCCCCCCCCCO[C@H]1O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](OS(=O)(=O)O)[C@@H]1O[C@H]2O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]3O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]4O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]5O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](OS(=O)(=O)O)[C@@H]5OS(=O)(=O)O)[C@@H]4OS(=O)(=O)O)[C@@H]3OS(=O)(=O)O)[C@@H]2OS(=O)(=O)O'
      ),
      {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.equal(result.metadata.placementMode, 'block-stitched');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.equal(result.metadata.placementAudit.bondLengthFailureCount, 0);
    assert.ok(pathLikeRingChainAspect(result.layoutGraph, result.coords) > 8);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'S35', 'O34', 'O38') - 180) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'S98', 'O97', 'O101') - 180) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'S35', 'O36', 'O38') - 90) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'S98', 'O99', 'O101') - 90) < 1e-6);
  });

  it('keeps the inter-ring ether between fused sugar rings on a proper ether bond angle', () => {
    const smiles = 'C[C@@]1(C[C@@H](O)[C@@]2(O)C=CO[C@@H](O[C@H]3O[C@@H](CO)[C@@H](O)[C@@H](O)[C@@H]3O)[C@@H]12)OC(=O)\\C=C/c4ccccc4';
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit(smiles);
    const graph = result.layoutGraph;
    const coreRing = (graph.atomToRings.get('C12') ?? [])[0];
    const sugarRing = (graph.atomToRings.get('C15') ?? [])[0];
    assert.ok(coreRing);
    assert.ok(sugarRing);

    const bridgeMetrics = coords => {
      const coreCentroid = centroid(coreRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean));
      const sugarCentroid = centroid(sugarRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean));
      const coreToEtherAngle = angleOf(sub(coords.get('O14'), coords.get('C12')));
      const sugarToEtherAngle = angleOf(sub(coords.get('O14'), coords.get('C15')));
      const coreToSugarAngle = angleOf(sub(sugarCentroid, coords.get('C12')));
      const sugarToCoreAngle = angleOf(sub(coreCentroid, coords.get('C15')));
      return {
        totalCentroidDeviation: angularDifference(coreToEtherAngle, coreToSugarAngle) + angularDifference(sugarToEtherAngle, sugarToCoreAngle),
        bridgeAngle: angularDifference(angleOf(sub(coords.get('C12'), coords.get('O14'))), angleOf(sub(coords.get('C15'), coords.get('O14'))))
      };
    };

    const placementMetrics = bridgeMetrics(placement.coords);
    const finalMetrics = bridgeMetrics(result.coords);

    assert.ok(finalMetrics.totalCentroidDeviation <= placementMetrics.totalCentroidDeviation + 1e-6);
    assert.ok(Math.abs(finalMetrics.bridgeAngle - (2 * Math.PI) / 3) < 1e-6);
    assert.ok(finalMetrics.bridgeAngle <= placementMetrics.bridgeAngle + 1e-6);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps linked aminoglycoside ring exits on exact trigonal slots with local guanidine relief', () => {
    const result = runPipeline(parseSMILES('CN[C@H]1[C@H](O)[C@@H](O)[C@H](CO)O[C@H]1O[C@H]1[C@H](O[C@H]2[C@H](O)[C@@H](O)[C@H](NC(N)=N)[C@@H](O)[C@@H]2NC(N)=N)O[C@@H](C)[C@]1(O)C=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C3', 'O18'],
      ['O15', 'O18']
    ]) {
      assert.ok(
        Math.abs(bondAngleAtAtom(result.coords, 'C16', firstNeighborAtomId, secondNeighborAtomId) - 120) < 1e-6,
        `expected ${firstNeighborAtomId}-C16-${secondNeighborAtomId} to stay exactly trigonal`
      );
    }
    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['N45', 'N46'],
      ['N45', 'N43'],
      ['N46', 'N43']
    ]) {
      assert.ok(
        Math.abs(bondAngleAtAtom(result.coords, 'C44', firstNeighborAtomId, secondNeighborAtomId) - 120) <= 5 + 1e-6,
        `expected guanidine relief to keep ${firstNeighborAtomId}-C44-${secondNeighborAtomId} near trigonal`
      );
    }
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
  });

  it('keeps diaryl ether bridges on the same clean publication-style ether angle after cleanup', () => {
    const smiles = 'c1ccccc1Oc1ccccc1';
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit(smiles);
    const oxygenAtom = [...result.layoutGraph.atoms.values()].find(atom => atom.element === 'O');
    assert.ok(oxygenAtom);
    const heavyNeighborIds = (result.layoutGraph.bondsByAtomId.get(oxygenAtom.id) ?? [])
      .filter(bond => bond.kind === 'covalent')
      .map(bond => (bond.a === oxygenAtom.id ? bond.b : bond.a))
      .filter(atomId => result.layoutGraph.atoms.get(atomId)?.element !== 'H');
    assert.equal(heavyNeighborIds.length, 2);

    const etherAngle = coords => angularDifference(angleOf(sub(coords.get(heavyNeighborIds[0]), coords.get(oxygenAtom.id))), angleOf(sub(coords.get(heavyNeighborIds[1]), coords.get(oxygenAtom.id))));

    assert.ok(Math.abs(etherAngle(result.coords) - (2 * Math.PI) / 3) < 1e-6);
    assert.ok(Math.abs(etherAngle(result.coords) - etherAngle(placement.coords)) < 1e-6);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps fused aryl-ether alkyl chains on a sharp publication-style oxygen angle', () => {
    const result = runPipeline(parseSMILES('CCOC1=CSC2=C1NC(OC2=O)=NCCO'), {
      suppressH: true,
      auditTelemetry: true
    });
    const etherAngle = bondAngleAtAtom(result.coords, 'O3', 'C2', 'C4');

    assert.ok(Math.abs(etherAngle - 120) < 1e-6, `expected C2-O3-C4 to stay at 120 degrees, got ${etherAngle.toFixed(2)}`);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps ideal linked-ring ether bridges sharp from placement through cleanup', () => {
    const smiles = 'CC(C)(C)OC(=O)N1CCC(C1)OC1=CC=C(OC(=O)C=CC2=CC3=CC(=CC=C3S2)C#N)C=C1';
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit(smiles, {
      suppressH: true,
      auditTelemetry: true
    });
    const placementAngle = bondAngleAtAtom(placement.coords, 'O13', 'C11', 'C14');
    const finalAngle = bondAngleAtAtom(result.coords, 'O13', 'C11', 'C14');

    assert.ok(Math.abs(placementAngle - 120) < 1e-6, `expected placement to keep the publication-style ether angle at O13, got ${placementAngle.toFixed(2)}`);
    assert.ok(Math.abs(finalAngle - 120) < 1e-6, `expected final layout to keep the publication-style ether angle at O13, got ${finalAngle.toFixed(2)}`);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('straightens linked diaryl-ether exits even when the fused anchor also carries a sibling oxygen leaf', () => {
    const smiles = 'Oc1ccc(cc1)C2=CC(=O)c3c(O)c(Oc4ccc(cc4)C5=CC(=O)c6c(O)cc(O)cc6O5)c(O)cc3O2';
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit(smiles, {
      suppressH: true,
      auditTelemetry: true
    });
    const placementLeftPreferredAngle = preferredRingAttachmentAngle(result.layoutGraph, placement.coords, 'C15');
    const finalLeftPreferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, 'C15');
    const finalRightPreferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, 'C17');
    const placementLeftDeviation = angularDifference(angleOf(sub(placement.coords.get('O16'), placement.coords.get('C15'))), placementLeftPreferredAngle);
    const finalLeftDeviation = angularDifference(angleOf(sub(result.coords.get('O16'), result.coords.get('C15'))), finalLeftPreferredAngle);
    const finalRightDeviation = angularDifference(angleOf(sub(result.coords.get('O16'), result.coords.get('C17'))), finalRightPreferredAngle);

    assert.ok(placementLeftDeviation < 1e-6, `expected placement to keep the fused ether exit exact, got ${(placementLeftDeviation * 180) / Math.PI}`);
    assert.ok(finalLeftDeviation < 1e-6, `expected final left ether exit to be exact, got ${finalLeftDeviation}`);
    assert.ok(finalRightDeviation < 1e-6, `expected final right ether exit to stay exact, got ${finalRightDeviation}`);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps a simple phenoxy bridge and phenol leaf unchanged while the ether exits stay exact', () => {
    const smiles = 'Oc1ccccc1Oc1ccccc1';
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit(smiles, {
      suppressH: true,
      auditTelemetry: true
    });
    const metrics = coords => ({
      phenolDeviation: angularDifference(angleOf(sub(coords.get('O1'), coords.get('C2'))), preferredRingAttachmentAngle(result.layoutGraph, coords, 'C2')),
      leftBridgeDeviation: angularDifference(angleOf(sub(coords.get('O8'), coords.get('C7'))), preferredRingAttachmentAngle(result.layoutGraph, coords, 'C7')),
      rightBridgeDeviation: angularDifference(angleOf(sub(coords.get('O8'), coords.get('C9'))), preferredRingAttachmentAngle(result.layoutGraph, coords, 'C9'))
    });
    const placementMetrics = metrics(placement.coords);
    const finalMetrics = metrics(result.coords);

    assert.ok(placementMetrics.phenolDeviation < 1e-6);
    assert.ok(placementMetrics.leftBridgeDeviation < 1e-6);
    assert.ok(placementMetrics.rightBridgeDeviation < 1e-6);
    assert.ok(finalMetrics.phenolDeviation < 1e-6);
    assert.ok(finalMetrics.leftBridgeDeviation < 1e-6);
    assert.ok(finalMetrics.rightBridgeDeviation < 1e-6);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps this fused mixed cyclopropyl cation overlap-free from placement through the final stage', () => {
    const result = runPipeline(parseSMILES('CCC1(CC1)[NH2+]C1CCC2=C1OC=C2'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.stageTelemetry.stageAudits.placement.severeOverlapCount, 0);
    assert.equal(result.metadata.stageTelemetry.stageAudits.placement.ok, true);
    assert.equal(result.metadata.cleanupTelemetry.selectedGeometryStageCategory, 'placement');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps paired heavy exits off small saturated ring carbons on sharp outside continuations', () => {
    const result = runPipeline(parseSMILES('CCC1(CC1)[NH2+]C1CCC2=C1OC=C2'), {
      suppressH: true
    });
    const centerAtomId = 'C3';
    const ringNeighborIds = ['C4', 'C5'];
    const exocyclicNeighborIds = ['C2', 'N6'];
    const ringContinuationAngles = ringNeighborIds.map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(centerAtomId))) + Math.PI);
    const exocyclicAngles = exocyclicNeighborIds.map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(centerAtomId))));
    const exocyclicSpread = angularDifference(exocyclicAngles[0], exocyclicAngles[1]);

    for (const exocyclicAngle of exocyclicAngles) {
      assert.ok(
        Math.min(...ringContinuationAngles.map(continuationAngle => angularDifference(exocyclicAngle, continuationAngle))) <= Math.PI / 6 + 1e-6,
        'expected each heavy exit to stay close to one outer continuation of the small-ring bonds'
      );
    }
    assert.ok(exocyclicSpread >= Math.PI / 3 - 1e-6, `expected cyclopropyl heavy exits to spread at least 60 degrees, got ${(exocyclicSpread * 180) / Math.PI}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps terminal alcohol leaves on compact bridged ring exterior slots', () => {
    const result = runPipeline(parseSMILES('CC1(C)COC2(CO)C3C12OC(=O)C3(C)O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const centerPosition = result.coords.get('C14');
    const ringNeighborAngles = ['C9', 'C12'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, 5);
    const exocyclicAngles = ['C15', 'O16'].map(atomId => angleOf(sub(result.coords.get(atomId), centerPosition)));
    const alignedDeviation = [angularDifference(exocyclicAngles[0], targetAngles[0]), angularDifference(exocyclicAngles[1], targetAngles[1])];
    const swappedDeviation = [angularDifference(exocyclicAngles[0], targetAngles[1]), angularDifference(exocyclicAngles[1], targetAngles[0])];
    const maxTargetDeviation = Math.min(Math.max(...alignedDeviation), Math.max(...swappedDeviation));
    const terminalLeafAngle = bondAngleAtAtom(result.coords, 'C14', 'C15', 'O16');
    const exteriorPenalty = measureSmallRingExteriorGapSpreadPenalty(result.layoutGraph, result.coords, 'C14');

    assert.ok(maxTargetDeviation < 1e-6, `expected C14 terminal leaves to stay on the five-member exterior targets, got max deviation ${((maxTargetDeviation * 180) / Math.PI).toFixed(2)} degrees`);
    assert.ok(terminalLeafAngle > 80, `expected C14 terminal leaves to avoid a pinched gap, got ${terminalLeafAngle.toFixed(2)} degrees`);
    assert.ok(exteriorPenalty < 1e-10, `expected no small-ring exterior penalty at C14, got ${exteriorPenalty.toExponential(3)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('balances cyclopropyl exterior branches when one branch is an attached ring', () => {
    const result = runPipeline(parseSMILES('CC(C)C1(CC1)C1C[NH2+]C1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const isopropylRingEdgeAngle = bondAngleAtAtom(result.coords, 'C4', 'C2', 'C6');
    const attachedRingEdgeAngle = bondAngleAtAtom(result.coords, 'C4', 'C7', 'C5');

    assert.ok(
      Math.abs(isopropylRingEdgeAngle - attachedRingEdgeAngle) < 1e-6,
      `expected C2-C4-C6 and C7-C4-C5 to stay equal, got ${isopropylRingEdgeAngle.toFixed(2)} and ${attachedRingEdgeAngle.toFixed(2)} degrees`
    );
    assert.ok(Math.abs(isopropylRingEdgeAngle - 100) < 1e-6, `expected the cyclopropyl exterior fan to split the open side into 100-degree gaps, got ${isopropylRingEdgeAngle.toFixed(2)} degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('lets cleanup clear crowded geminal alkyl-branch overlaps on protonated acyclic centers', () => {
    const result = runPipeline(parseSMILES('CCC(CC)([NH2+]C(CC)(CC)C(C[SiH3])OC)C(C[SiH3])OC'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.primaryFamily, 'acyclic');
    assert.equal(result.metadata.stageTelemetry.stageAudits.placement.severeOverlapCount, 1);
    assert.equal(result.metadata.stageTelemetry.stageAudits.coreGeometryCleanup.severeOverlapCount, 0);
    assert.equal(result.metadata.cleanupTelemetry.selectedGeometryStageCategory, 'core-geometry');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps crowded methyl branches overlap-free without distorting the tertiary amine spread after cleanup', () => {
    const { result } = inspectPlacementAndFinalAudit('CCC1(C)OC2=C3C(NCC13N(C)C)=C(O)N2', { suppressH: true, auditTelemetry: true });
    const finalFirstClearance = nearestHeavyBondDistance(result.layoutGraph, result.coords, 'N12', 'C13');
    const finalSecondClearance = nearestHeavyBondDistance(result.layoutGraph, result.coords, 'N12', 'C14');
    const amineAngles = ['C11', 'C13', 'C14'].map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get('N12')))).sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const amineSeparations = amineAngles.map((angle, index) => {
      const nextAngle = amineAngles[(index + 1) % amineAngles.length];
      const rawGap = nextAngle - angle;
      return (rawGap > 0 ? rawGap : rawGap + Math.PI * 2) * (180 / Math.PI);
    });

    assert.ok(result.metadata.stageTelemetry.stageAudits.placement.severeOverlapCount <= 1);
    assert.ok(['core-geometry', 'presentation', 'checkpoint', 'placement'].includes(result.metadata.cleanupTelemetry.selectedGeometryStageCategory));
    assert.ok(finalFirstClearance >= 0.95);
    assert.ok(finalSecondClearance >= 0.7);
    assert.ok(amineSeparations.every(separation => separation >= 100 && separation <= 150));
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps reported benzylic nitrile substituent roots on the exact aromatic ring-outward axis', () => {
    const result = runPipeline(parseSMILES('CC1=CC(=CC(=C1)C1CCCC2=C(C1)N=C(O2)C1=CC=C(F)C=N1)C#N'), { suppressH: true });
    const nitrileCarbonAtomId = [...result.layoutGraph.atoms.values()].find(
      atom =>
        atom.element === 'C' &&
        atom.heavyDegree === 2 &&
        (result.layoutGraph.ringCountByAtomId.get(atom.id) ?? 0) === 0 &&
        (result.layoutGraph.bondsByAtomId.get(atom.id) ?? []).some(bond => (bond.order ?? 1) === 3)
    )?.id;
    assert.ok(nitrileCarbonAtomId);
    const anchorAtomId = (result.layoutGraph.bondsByAtomId.get(nitrileCarbonAtomId) ?? [])
      .map(bond => (bond.a === nitrileCarbonAtomId ? bond.b : bond.a))
      .find(atomId => (result.layoutGraph.ringCountByAtomId.get(atomId) ?? 0) > 0);
    assert.ok(anchorAtomId);
    const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, anchorAtomId);
    assert.notEqual(preferredAngle, null);
    const childAngle = angleOf(sub(result.coords.get(nitrileCarbonAtomId), result.coords.get(anchorAtomId)));

    assert.ok(angularDifference(childAngle, preferredAngle) < 1e-6);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('reflects crowded attached pyridyl rings so aryl nitrile roots keep exact outward angles', () => {
    const result = runPipeline(parseSMILES('COC1=CC=CC(=C1)S(=O)(=O)N1C=C(CN(CC(C)(C)C)C([O-])=O)C(F)=C1C1=CC=CN=C1C#N'), { suppressH: true, auditTelemetry: true });
    const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, 'C33');
    const childAngle = angleOf(sub(result.coords.get('C34'), result.coords.get('C33')));

    assert.notEqual(preferredAngle, null);
    assert.ok(angularDifference(childAngle, preferredAngle) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C33', 'C28', 'C34') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C33', 'N32', 'C34') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C34', 'C33', 'N35') - 180) < 1e-6);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('preserves crowded terminal propanol zigzags while clearing anilino ring overlap', () => {
    const result = runPipeline(parseSMILES('COC1=CC=C(C=C1)N(C)C1=C2C=CC=CC2=NC(CN(CCCO)CC2=NC(N(C)C3=CC=C(OC)C=C3)=C3C=CC=CC3=N2)=N1'), { suppressH: true, auditTelemetry: true });
    const firstPropanolAngle = bondAngleAtAtom(result.coords, 'C23', 'C22', 'C24');
    const secondPropanolAngle = bondAngleAtAtom(result.coords, 'C24', 'C23', 'O25');
    const firstAnilinoAngle = bondAngleAtAtom(result.coords, 'N9', 'C6', 'C10');
    const secondAnilinoAngle = bondAngleAtAtom(result.coords, 'N9', 'C6', 'C11');
    const thirdAnilinoAngle = bondAngleAtAtom(result.coords, 'N9', 'C10', 'C11');
    const firstTertiaryAmineAngle = bondAngleAtAtom(result.coords, 'N21', 'C20', 'C22');
    const secondTertiaryAmineAngle = bondAngleAtAtom(result.coords, 'N21', 'C20', 'C26');
    const thirdTertiaryAmineAngle = bondAngleAtAtom(result.coords, 'N21', 'C22', 'C26');
    const anilinoPenalty = measureTrigonalDistortion(result.layoutGraph, result.coords, {
      focusAtomIds: new Set(['N9'])
    });
    const divalentPenalty = measureDivalentContinuationDistortion(result.layoutGraph, result.coords);

    assert.ok(Math.abs(firstPropanolAngle - 120) < 1e-6, `expected C22-C23-C24 to stay at 120 degrees, got ${firstPropanolAngle.toFixed(2)}`);
    assert.ok(Math.abs(secondPropanolAngle - 120) < 1e-6, `expected C23-C24-O25 to stay at 120 degrees, got ${secondPropanolAngle.toFixed(2)}`);
    assert.ok(Math.abs(firstAnilinoAngle - 120) < 1e-6, `expected C6-N9-C10 to stay at 120 degrees, got ${firstAnilinoAngle.toFixed(2)}`);
    assert.ok(Math.abs(secondAnilinoAngle - 120) < 1e-6, `expected C6-N9-C11 to stay at 120 degrees, got ${secondAnilinoAngle.toFixed(2)}`);
    assert.ok(Math.abs(thirdAnilinoAngle - 120) < 1e-6, `expected C10-N9-C11 to stay at 120 degrees, got ${thirdAnilinoAngle.toFixed(2)}`);
    assert.ok(Math.abs(firstTertiaryAmineAngle - 120) < 1e-6, `expected C20-N21-C22 to stay at 120 degrees, got ${firstTertiaryAmineAngle.toFixed(2)}`);
    assert.ok(Math.abs(secondTertiaryAmineAngle - 120) < 1e-6, `expected C20-N21-C26 to stay at 120 degrees, got ${secondTertiaryAmineAngle.toFixed(2)}`);
    assert.ok(Math.abs(thirdTertiaryAmineAngle - 120) < 1e-6, `expected C22-N21-C26 to stay at 120 degrees, got ${thirdTertiaryAmineAngle.toFixed(2)}`);
    assert.ok(anilinoPenalty.maxDeviation < 1e-12, `expected exact anilino trigonal fan, got ${anilinoPenalty.maxDeviation}`);
    assert.ok(divalentPenalty.maxDeviation < 1e-12, `expected exact divalent continuations, got ${divalentPenalty.maxDeviation}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('compresses a crowded terminal chlorophenyl leaf while preserving the omitted-H junction', () => {
    const result = runPipeline(parseSMILES('CC1=C(C(C2=CC=CC=C2Cl)C(C2=NN=CO2)=C(C)N1)C([O-])=O'), { suppressH: true, auditTelemetry: true });
    const firstChloroAngle = bondAngleAtAtom(result.coords, 'C10', 'C5', 'Cl11');
    const secondChloroAngle = bondAngleAtAtom(result.coords, 'C10', 'C9', 'Cl11');
    const firstBenzylicAngle = bondAngleAtAtom(result.coords, 'C4', 'C3', 'C5');
    const secondBenzylicAngle = bondAngleAtAtom(result.coords, 'C4', 'C3', 'C12');
    const thirdBenzylicAngle = bondAngleAtAtom(result.coords, 'C4', 'C5', 'C12');
    const firstHeteroarylAngle = bondAngleAtAtom(result.coords, 'C12', 'C4', 'C13');
    const secondHeteroarylAngle = bondAngleAtAtom(result.coords, 'C12', 'C13', 'C18');
    const firstOxadiazoleAngle = bondAngleAtAtom(result.coords, 'C13', 'C12', 'O17');
    const secondOxadiazoleAngle = bondAngleAtAtom(result.coords, 'C13', 'C12', 'N14');
    const chloroBondLength = Math.hypot(result.coords.get('Cl11').x - result.coords.get('C10').x, result.coords.get('Cl11').y - result.coords.get('C10').y);
    const chloroMaxDeviation = Math.max(Math.abs(firstChloroAngle - 120), Math.abs(secondChloroAngle - 120));
    const heteroarylMaxDeviation = Math.max(Math.abs(firstHeteroarylAngle - 120), Math.abs(secondHeteroarylAngle - 120));
    const oxadiazoleRootMaxDeviation = Math.max(Math.abs(firstOxadiazoleAngle - 126), Math.abs(secondOxadiazoleAngle - 126));

    assert.ok(chloroMaxDeviation < 1e-6, `expected the chlorophenyl leaf to stay exact after compression, got ${chloroMaxDeviation.toFixed(2)}`);
    assert.ok(chloroBondLength <= result.layoutGraph.options.bondLength * 0.91, `expected C10-Cl11 to compress to avoid overlap, got ${chloroBondLength.toFixed(2)}`);
    assert.ok(heteroarylMaxDeviation < 1e-6, `expected the C12 heteroaryl fan to retidy to 120 degrees, got ${heteroarylMaxDeviation.toFixed(2)}`);
    assert.ok(oxadiazoleRootMaxDeviation <= 7 + 1e-6, `expected the oxadiazole root relief to stay bounded, got ${oxadiazoleRootMaxDeviation.toFixed(2)}`);
    assert.ok(Math.abs(firstBenzylicAngle - 120) < 1e-6, `expected C3-C4-C5 to stay at 120 degrees, got ${firstBenzylicAngle.toFixed(2)}`);
    assert.ok(Math.abs(secondBenzylicAngle - 120) < 1e-6, `expected C3-C4-C12 to stay at 120 degrees, got ${secondBenzylicAngle.toFixed(2)}`);
    assert.ok(Math.abs(thirdBenzylicAngle - 120) < 1e-6, `expected C5-C4-C12 to stay at 120 degrees, got ${thirdBenzylicAngle.toFixed(2)}`);
    assert.equal(result.metadata.stageTelemetry.stageAudits.placement.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps mixed-family alkyne linkers linear when a direct-attached ring block follows the sp carbon', () => {
    const result = runPipeline(parseSMILES('CC1=CC(=NC(N)=N1)C#CC1=C(CNN2C=COC2=O)C=CC=C1'), { suppressH: true, auditTelemetry: true });
    const firstAlkyneAngle = bondAngleAtAtom(result.coords, 'C9', 'C4', 'C10');
    const secondAlkyneAngle = bondAngleAtAtom(result.coords, 'C10', 'C9', 'C11');

    assert.ok(Math.abs(firstAlkyneAngle - 180) < 1e-6, `expected C4-C9-C10 to stay linear at 180 degrees, got ${firstAlkyneAngle.toFixed(2)}`);
    assert.ok(Math.abs(secondAlkyneAngle - 180) < 1e-6, `expected C9-C10-C11 to stay linear at 180 degrees, got ${secondAlkyneAngle.toFixed(2)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps the reported tertiary amide nitrogen on an exact 120-degree spread through attached-ring cleanup', () => {
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit('CCOc1ccccc1N(C)C(=O)Cn2ncc3c4cc(C)ccc4nc3c2O', {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const placementMethylCarbonylAngle = bondAngleAtAtom(placement.coords, 'N10', 'C11', 'C12');
    const placementMethylArylAngle = bondAngleAtAtom(placement.coords, 'N10', 'C11', 'C9');
    const placementCarbonylArylAngle = bondAngleAtAtom(placement.coords, 'N10', 'C12', 'C9');
    const finalMethylCarbonylAngle = bondAngleAtAtom(result.coords, 'N10', 'C11', 'C12');
    const finalMethylArylAngle = bondAngleAtAtom(result.coords, 'N10', 'C11', 'C9');
    const finalCarbonylArylAngle = bondAngleAtAtom(result.coords, 'N10', 'C12', 'C9');

    assert.ok(Math.abs(placementMethylCarbonylAngle - 120) < 1e-6, `expected C11-N10-C12 to start at 120 degrees, got ${placementMethylCarbonylAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(placementMethylArylAngle - 120) < 1e-6, `expected C11-N10-C9 to start at 120 degrees, got ${placementMethylArylAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(placementCarbonylArylAngle - 120) < 1e-6, `expected C12-N10-C9 to start at 120 degrees, got ${placementCarbonylArylAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(finalMethylCarbonylAngle - 120) < 1e-6, `expected C11-N10-C12 to stay at 120 degrees, got ${finalMethylCarbonylAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(finalMethylArylAngle - 120) < 1e-6, `expected C11-N10-C9 to stay at 120 degrees, got ${finalMethylArylAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(finalCarbonylArylAngle - 120) < 1e-6, `expected C12-N10-C9 to stay at 120 degrees, got ${finalCarbonylArylAngle.toFixed(2)} degrees`);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps simple imine-linked aryl branches on an exact 120-degree nitrogen slot during placement', () => {
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit('CCC(=O)NC(=Nc1ccccc1)Nc2nc(C)cc(C)n2', { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const placementImineAngle = bondAngleAtAtom(placement.coords, 'N7', 'C6', 'C8');
    const finalImineAngle = bondAngleAtAtom(result.coords, 'N7', 'C6', 'C8');
    const arylRootAngles = [bondAngleAtAtom(result.coords, 'C8', 'C13', 'N7'), bondAngleAtAtom(result.coords, 'C8', 'N7', 'C9'), bondAngleAtAtom(result.coords, 'C8', 'C13', 'C9')];

    assert.ok(Math.abs(placementImineAngle - 120) < 1e-6, `expected C6-N7-C8 to start at 120 degrees, got ${placementImineAngle.toFixed(2)}`);
    assert.ok(Math.abs(finalImineAngle - 120) < 1e-6, `expected C6-N7-C8 to stay at 120 degrees, got ${finalImineAngle.toFixed(2)}`);
    for (const angle of arylRootAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected the phenyl root fan to remain exact, got ${angle.toFixed(2)}`);
    }
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps imine carbon direct-attached ring roots on exact 120-degree parent slots during placement', () => {
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit('CC=C(OCCO)N=CC1=C(C)C[NH2+]C1', { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const placementImineCarbonAngle = bondAngleAtAtom(placement.coords, 'C9', 'N8', 'C10');
    const finalImineCarbonAngle = bondAngleAtAtom(result.coords, 'C9', 'N8', 'C10');
    const finalImineNitrogenAngle = bondAngleAtAtom(result.coords, 'N8', 'C3', 'C9');

    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.equal(result.metadata.mixedMode, true);
    assert.ok(Math.abs(placementImineCarbonAngle - 120) < 1e-6, `expected C9 imine carbon to start at 120 degrees, got ${placementImineCarbonAngle.toFixed(2)}`);
    assert.ok(Math.abs(finalImineCarbonAngle - 120) < 1e-6, `expected C9 imine carbon to stay at 120 degrees, got ${finalImineCarbonAngle.toFixed(2)}`);
    assert.ok(Math.abs(finalImineNitrogenAngle - 120) < 1e-6, `expected C3-N8-C9 to stay at 120 degrees, got ${finalImineNitrogenAngle.toFixed(2)}`);
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('snaps crowded tertiary-amide aryl roots back to exact aromatic exits after cleanup', () => {
    const result = runPipeline(parseSMILES('OC(=O)C(=O)N(C1=CC=CC=C1C(O)=O)C1=CC=CC2=C1C=CC=C2'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const phenylRootAngles = [bondAngleAtAtom(result.coords, 'C7', 'N6', 'C8'), bondAngleAtAtom(result.coords, 'C7', 'N6', 'C12'), bondAngleAtAtom(result.coords, 'C7', 'C8', 'C12')];
    const naphthylRootAngles = [bondAngleAtAtom(result.coords, 'C16', 'N6', 'C17'), bondAngleAtAtom(result.coords, 'C16', 'N6', 'C21')];

    for (const angle of phenylRootAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected the C7 phenyl root fan to stay exact, got ${angle.toFixed(2)}`);
    }
    for (const angle of naphthylRootAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected the C16 naphthyl root fan to stay exact, got ${angle.toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps ring tertiary amide nitrogens and their carbonyls on exact trigonal slots through cleanup', () => {
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit('CS(=O)(=O)c1cn[nH]c1C2CCCCN2C(=O)Cc3cccnc3', {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const placementRingNitrogenAngles = [
      bondAngleAtAtom(placement.coords, 'N16', 'C11', 'C15'),
      bondAngleAtAtom(placement.coords, 'N16', 'C11', 'C17'),
      bondAngleAtAtom(placement.coords, 'N16', 'C15', 'C17')
    ];
    const finalRingNitrogenAngles = [bondAngleAtAtom(result.coords, 'N16', 'C11', 'C15'), bondAngleAtAtom(result.coords, 'N16', 'C11', 'C17'), bondAngleAtAtom(result.coords, 'N16', 'C15', 'C17')];
    const finalCarbonylAngles = [bondAngleAtAtom(result.coords, 'C17', 'O18', 'N16'), bondAngleAtAtom(result.coords, 'C17', 'O18', 'C19'), bondAngleAtAtom(result.coords, 'C17', 'N16', 'C19')];

    for (const angle of placementRingNitrogenAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected placement N16 fan to start at 120 degrees, got ${angle.toFixed(2)}`);
    }
    for (const angle of finalRingNitrogenAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected final N16 fan to stay at 120 degrees, got ${angle.toFixed(2)}`);
    }
    for (const angle of finalCarbonylAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected final C17 carbonyl fan to stay at 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps secondary anilino hidden-h nitrogens on exact trigonal slots through cleanup', () => {
    const { placement, placementAudit, result } = inspectPlacementAndFinalAudit('[H][C@@](NC1=CC(C)=CC=C1C(C)=O)(C(N)=O)C1=C(Br)C=CC=C1Br', {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const assertN3Spread = (coords, label) => {
      for (const [name, angle] of [
        ['C2-N3-C4', bondAngleAtAtom(coords, 'N3', 'C2', 'C4')],
        ['C2-N3-H25', bondAngleAtAtom(coords, 'N3', 'C2', 'H25')],
        ['C4-N3-H25', bondAngleAtAtom(coords, 'N3', 'C4', 'H25')]
      ]) {
        assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${label} ${name} to stay at 120 degrees, got ${angle.toFixed(2)}`);
      }
    };

    assertN3Spread(placement.coords, 'placement');
    assertN3Spread(result.coords, 'final');
    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('swaps planar tertiary nitrogen sibling branches to clear attached phenyl overlaps without bending the amide', () => {
    const result = runPipeline(parseSMILES('CCN(C(=O)C1=C(O)C2=C(C=CC=C2Cl)N(C)C1=O)C1=CC=CC=C1'), { suppressH: true, auditTelemetry: true });
    const nCarbonylPhenylAngle = bondAngleAtAtom(result.coords, 'N3', 'C4', 'C20');
    const nCarbonylEthylAngle = bondAngleAtAtom(result.coords, 'N3', 'C4', 'C2');
    const nPhenylEthylAngle = bondAngleAtAtom(result.coords, 'N3', 'C20', 'C2');
    const carbonylNitrogenOxygenAngle = bondAngleAtAtom(result.coords, 'C4', 'N3', 'O5');
    const carbonylNitrogenRingAngle = bondAngleAtAtom(result.coords, 'C4', 'N3', 'C6');
    const carbonylOxygenRingAngle = bondAngleAtAtom(result.coords, 'C4', 'O5', 'C6');
    const phenylNitrogenFirstAngle = bondAngleAtAtom(result.coords, 'C20', 'N3', 'C25');
    const phenylNitrogenSecondAngle = bondAngleAtAtom(result.coords, 'C20', 'N3', 'C21');
    const phenylRootAngle = bondAngleAtAtom(result.coords, 'C20', 'C25', 'C21');

    for (const [label, angle] of [
      ['C4-N3-C20', nCarbonylPhenylAngle],
      ['C4-N3-C2', nCarbonylEthylAngle],
      ['C20-N3-C2', nPhenylEthylAngle],
      ['N3-C4-O5', carbonylNitrogenOxygenAngle],
      ['N3-C4-C6', carbonylNitrogenRingAngle],
      ['O5-C4-C6', carbonylOxygenRingAngle],
      ['N3-C20-C25', phenylNitrogenFirstAngle],
      ['N3-C20-C21', phenylNitrogenSecondAngle],
      ['C25-C20-C21', phenylRootAngle]
    ]) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${label} to stay at 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('clears a terminal cation from the phenoxy ring while keeping the diaryl fan exact', () => {
    const result = runPipeline(parseSMILES('CCCCC([NH3+])C(=O)CN(NC(=O)C(C[NH3+])OC1=CC=CC=C1)C(C1=CC=CC=C1)C1=CC=CC=C1'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const n17PhenoxyRingClearance = Math.min(
      ...['C20', 'C21', 'C22', 'C23', 'C24', 'C25'].map(atomId => {
        const n17 = result.coords.get('N17');
        const ringAtom = result.coords.get(atomId);
        return Math.hypot(n17.x - ringAtom.x, n17.y - ringAtom.y);
      })
    );

    for (const angle of [
      bondAngleAtAtom(result.coords, 'N11', 'N12', 'C26'),
      bondAngleAtAtom(result.coords, 'N11', 'N12', 'C10'),
      bondAngleAtAtom(result.coords, 'N11', 'C26', 'C10'),
      bondAngleAtAtom(result.coords, 'C26', 'N11', 'C27'),
      bondAngleAtAtom(result.coords, 'C26', 'N11', 'C33'),
      bondAngleAtAtom(result.coords, 'C26', 'C27', 'C33'),
      bondAngleAtAtom(result.coords, 'C20', 'C25', 'C21'),
      bondAngleAtAtom(result.coords, 'C20', 'C25', 'O19'),
      bondAngleAtAtom(result.coords, 'C20', 'C21', 'O19'),
      bondAngleAtAtom(result.coords, 'C33', 'C26', 'C38'),
      bondAngleAtAtom(result.coords, 'C33', 'C26', 'C34'),
      bondAngleAtAtom(result.coords, 'C33', 'C38', 'C34')
    ]) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected acyl-hydrazine diaryl fan to stay at 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(n17PhenoxyRingClearance > 2.2, `expected N17 to clear the phenoxy ring, got ${n17PhenoxyRingClearance.toFixed(3)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps aryl carboxyl ring-root and terminal fans exact while clearing neighboring ring oxygen overlap', () => {
    const result = runPipeline(parseSMILES('CCCCCNC(=O)C(Cc1ccc(N(C(=O)C(=O)O)c2ccccc2C(=O)O)c(CC)c1)NC(=O)C'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const carboxylOxygenClearance = Math.hypot(result.coords.get('O28').x - result.coords.get('C13').x, result.coords.get('O28').y - result.coords.get('C13').y);
    const carbonylOxygenBondLength = Math.hypot(result.coords.get('O28').x - result.coords.get('C27').x, result.coords.get('O28').y - result.coords.get('C27').y);

    for (const angle of [
      bondAngleAtAtom(result.coords, 'C26', 'C21', 'C25'),
      bondAngleAtAtom(result.coords, 'C26', 'C21', 'C27'),
      bondAngleAtAtom(result.coords, 'C26', 'C25', 'C27'),
      bondAngleAtAtom(result.coords, 'C27', 'C26', 'O28'),
      bondAngleAtAtom(result.coords, 'C27', 'C26', 'O29'),
      bondAngleAtAtom(result.coords, 'C27', 'O28', 'O29')
    ]) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected aryl carboxyl fans to stay at 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(
      carboxylOxygenClearance >= result.layoutGraph.options.bondLength * 0.55 - 1e-6,
      `expected the carboxyl oxygen to clear the neighboring ring atom, got ${carboxylOxygenClearance.toFixed(3)}`
    );
    assert.ok(carbonylOxygenBondLength < result.layoutGraph.options.bondLength * 0.5, `expected the crowded carbonyl oxygen bond to shorten, got ${carbonylOxygenBondLength.toFixed(3)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps the reported crowded benzylic ethyl tail on an exact 120-degree zigzag through cleanup', () => {
    const result = runPipeline(parseSMILES('CCC1=CC=CC(CC)=C1NC(=O)C1=C(C)N(CC(C)C)C(C)=C(Br)C1=O'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const benzylicAngle = bondAngleAtAtom(result.coords, 'C2', 'C1', 'C3');
    const anilideAngle = bondAngleAtAtom(result.coords, 'N11', 'C10', 'C12');
    const amideCarbonylFirstAngle = bondAngleAtAtom(result.coords, 'C12', 'C14', 'O13');
    const amideCarbonylSecondAngle = bondAngleAtAtom(result.coords, 'C12', 'C14', 'N11');
    const amideCarbonylThirdAngle = bondAngleAtAtom(result.coords, 'C12', 'O13', 'N11');

    assert.ok(Math.abs(benzylicAngle - 120) < 1e-6, `expected the benzylic ethyl methylene to stay on an exact 120-degree zigzag, got ${benzylicAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(anilideAngle - 120) < 1e-6, `expected C10-N11-C12 to stay at 120 degrees, got ${anilideAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideCarbonylFirstAngle - 120) < 1e-6, `expected C14-C12-O13 to stay at 120 degrees, got ${amideCarbonylFirstAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideCarbonylSecondAngle - 120) < 1e-6, `expected C14-C12-N11 to stay at 120 degrees, got ${amideCarbonylSecondAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideCarbonylThirdAngle - 120) < 1e-6, `expected O13-C12-N11 to stay at 120 degrees, got ${amideCarbonylThirdAngle.toFixed(2)} degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps the reported thiazole-linked middle NH and chlorophenyl amide nitrogen on exact 120-degree link angles', () => {
    const result = runPipeline(parseSMILES('CC1=NC(NC2=NC=C(S2)C(=O)NC2=C(C)C=CC=C2Cl)=CC(=N1)N1CCN(CCO)CC1'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const middleNitrogenAngle = bondAngleAtAtom(result.coords, 'N5', 'C4', 'C6');
    const amideNitrogenAngle = bondAngleAtAtom(result.coords, 'N13', 'C11', 'C14');

    assert.ok(Math.abs(middleNitrogenAngle - 120) < 1e-6, `expected C4-N5-C6 to stay at 120 degrees, got ${middleNitrogenAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideNitrogenAngle - 120) < 1e-6, `expected C11-N13-C14 to stay at 120 degrees, got ${amideNitrogenAngle.toFixed(2)} degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('tries alternate mixed roots when the primary root leaves a thiazole exit off-axis', () => {
    const result = runPipeline(parseSMILES('Cc1ccc(cc1)c2nc(C)sc2CC(=O)OCC(=O)Nc3c(F)cccc3F'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const firstC5Angle = bondAngleAtAtom(result.coords, 'C5', 'C4', 'C8');
    const secondC5Angle = bondAngleAtAtom(result.coords, 'C5', 'C6', 'C8');

    assert.ok(Math.abs(firstC5Angle - 120) < 1e-6, `expected C4-C5-C8 to stay at 120 degrees, got ${firstC5Angle.toFixed(2)} degrees`);
    assert.ok(Math.abs(secondC5Angle - 120) < 1e-6, `expected C6-C5-C8 to stay at 120 degrees, got ${secondC5Angle.toFixed(2)} degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('uses ring-anchor lookahead so compact allyl tails leave bridged amines outward', () => {
    const result = runPipeline(parseSMILES('Cc1cc(C)cc(NC(=O)NC2CC3CCCC(C2)N3CC=C)c1'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const bridgeheadAllylBend = bondAngleAtAtom(result.coords, 'C21', 'N20', 'C22');
    const vinylAngle = bondAngleAtAtom(result.coords, 'C22', 'C21', 'C23');

    assert.ok(bridgeheadAllylBend > 90, `expected N20-C21-C22 to open away from the bridged amine, got ${bridgeheadAllylBend.toFixed(2)} degrees`);
    assert.ok(Math.abs(vinylAngle - 120) < 1e-6, `expected C21-C22-C23 to stay at 120 degrees, got ${vinylAngle.toFixed(2)} degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('lets short saturated ring-exterior tails escape visible neighbor crossings', () => {
    const result = runPipeline(parseSMILES('CCC1CC1(O)C1(CC)COCOC1=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const exocyclicSplit = bondAngleAtAtom(result.coords, 'C7', 'C5', 'C8');
    const ringExitSplit = bondAngleAtAtom(result.coords, 'C7', 'C8', 'C10');
    const terminalClearance = distance(result.coords.get('O6'), result.coords.get('C9'));

    assert.ok(exocyclicSplit >= 60 - 1e-6, `expected C5-C7-C8 to open to at least 60 degrees, got ${exocyclicSplit.toFixed(2)} degrees`);
    assert.ok(ringExitSplit >= 60 - 1e-6, `expected C8-C7-C10 to open to at least 60 degrees, got ${ringExitSplit.toFixed(2)} degrees`);
    assert.ok(terminalClearance > result.layoutGraph.options.bondLength, `expected terminal ethyl leaf to clear the neighboring oxygen, got ${terminalClearance.toFixed(2)}`);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps simpler diethylbenzene benzylic tails exact while still letting cleanup clear overlaps rigidly', () => {
    const result = runPipeline(parseSMILES('CCC1=CC=CC(CC)=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C2', 'C1', 'C3') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C8', 'C7', 'C9') - 120) < 1e-6);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps flexible imidazole sidechains on the standard 120-degree zigzag instead of forcing an exact radial carbon exit', () => {
    const result = runPipeline(parseSMILES('C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN'), { suppressH: true, auditTelemetry: true });
    const anchorAtomId = 'C2';
    const childAtomId = 'C6';
    const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, anchorAtomId);
    const childAngle = angleOf(sub(result.coords.get(childAtomId), result.coords.get(anchorAtomId)));
    const neighborAngles = ['C1', 'N3', childAtomId]
      .map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(anchorAtomId))))
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const separations = neighborAngles
      .map((angle, index) => {
        const nextAngle = neighborAngles[(index + 1) % neighborAngles.length];
        const rawGap = nextAngle - angle;
        return (rawGap > 0 ? rawGap : rawGap + Math.PI * 2) * (180 / Math.PI);
      })
      .sort((firstGap, secondGap) => firstGap - secondGap);

    assert.notEqual(preferredAngle, null);
    assert.ok(angularDifference(childAngle, preferredAngle) > (3 * Math.PI) / 180, 'expected the imidazole sidechain root to keep a zigzag bias instead of landing on the exact radial outward axis');
    assert.ok(Math.abs(separations[0] - 108) < 1e-6);
    assert.ok(Math.abs(separations[1] - 120) < 1e-6);
    assert.ok(Math.abs(separations[2] - 132) < 1e-6);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('centers heteroaryl carbonyl-methylene substituents on the exact local ring-outward axis', () => {
    const result = runPipeline(parseSMILES('O=C(Cn1ncc2C(=O)Oc3ccccc3c12)N4CCC(CC4)N5CCCCC5'), { suppressH: true, auditTelemetry: true });
    const firstAngle = bondAngleAtAtom(result.coords, 'N4', 'C3', 'C17');
    const secondAngle = bondAngleAtAtom(result.coords, 'N4', 'C3', 'N5');

    assert.ok(Math.abs(firstAngle - secondAngle) < 1e-6, `expected C3-N4-C17 and C3-N4-N5 to match, got ${firstAngle.toFixed(2)} and ${secondAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(firstAngle - 126) < 1e-6, `expected N4 substituent angles to bisect the 108-degree ring angle, got ${firstAngle.toFixed(2)} degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps lone terminal imine leaves on ring trigonal centers at the exact outward angle and 120-degree spread', () => {
    const result = runPipeline(parseSMILES('CC1COCCC1CN1C(=N)N=C(I)N=C1O'), { suppressH: true, auditTelemetry: true });
    const anchorAtomId = 'C10';
    const leafAtomId = 'N11';
    const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, anchorAtomId);
    const leafAngle = angleOf(sub(result.coords.get(leafAtomId), result.coords.get(anchorAtomId)));
    const neighborAngles = (result.layoutGraph.bondsByAtomId.get(anchorAtomId) ?? [])
      .filter(bond => bond.kind === 'covalent')
      .map(bond => (bond.a === anchorAtomId ? bond.b : bond.a))
      .filter(atomId => result.layoutGraph.atoms.get(atomId)?.element !== 'H')
      .map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(anchorAtomId))))
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const separations = neighborAngles.map((angle, index) => {
      const nextAngle = neighborAngles[(index + 1) % neighborAngles.length];
      const rawGap = nextAngle - angle;
      return rawGap > 0 ? rawGap : rawGap + Math.PI * 2;
    });

    assert.notEqual(preferredAngle, null);
    assert.ok(angularDifference(leafAngle, preferredAngle) < 1e-6);
    assert.equal(separations.length, 3);
    for (const separation of separations) {
      assert.ok(Math.abs(separation - (2 * Math.PI) / 3) < 1e-6, `expected C10 trigonal separations near 120 degrees, got ${((separation * 180) / Math.PI).toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps detached counter-ions beside the principal scaffold even after hidden-h final orientation and lets attached imide rings rotate enough for exact carbonyl presentation', () => {
    const molecule = parseSMILES('Cl.CC(=O)c1ccc(OCC(O)CN2CCN(CCN3C(=O)c4cccc5cccc(C3=O)c45)CC2)cc1');
    molecule.hideHydrogens();
    const result = runPipeline(molecule, { suppressH: true });
    const principalComponent = result.layoutGraph.components.find(component => component.role === 'principal');
    const auxiliaryComponent = result.layoutGraph.components.find(component => component.role !== 'principal');
    assert.ok(principalComponent);
    assert.ok(auxiliaryComponent);

    const principalBounds = computeBounds(
      result.coords,
      principalComponent.atomIds.filter(atomId => result.coords.has(atomId))
    );
    const auxiliaryBounds = computeBounds(
      result.coords,
      auxiliaryComponent.atomIds.filter(atomId => result.coords.has(atomId))
    );
    assert.ok(principalBounds);
    assert.ok(auxiliaryBounds);
    const componentGap = auxiliaryBounds.minX - principalBounds.maxX;
    const verticalOvershoot = Math.max(principalBounds.minY - auxiliaryBounds.minY, auxiliaryBounds.maxY - principalBounds.maxY, 0);

    const carbonylAngle = (carbonylCarbonAtomId, oxygenAtomId, nitrogenAtomId) =>
      angularDifference(
        angleOf(sub(result.coords.get(nitrogenAtomId), result.coords.get(carbonylCarbonAtomId))),
        angleOf(sub(result.coords.get(oxygenAtomId), result.coords.get(carbonylCarbonAtomId)))
      );
    const nRingPreferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, 'N14');
    const nRingExitAngle = angleOf(sub(result.coords.get('C13'), result.coords.get('N14')));

    assert.ok(componentGap >= 2.5, `expected detached chloride gap >= 2.5, got ${componentGap}`);
    assert.ok(componentGap <= 3.1, `expected detached chloride gap <= 3.1, got ${componentGap}`);
    assert.ok(verticalOvershoot <= 0.75, `expected detached chloride to stay beside the principal scaffold, got vertical overshoot ${verticalOvershoot}`);
    assert.notEqual(nRingPreferredAngle, null);
    assert.ok(angularDifference(nRingExitAngle, nRingPreferredAngle) < 1e-6, 'expected the piperazine-linked imide arm to follow the exact ring-outward axis');
    assert.ok(Math.abs(carbonylAngle('C21', 'O22', 'N20') - (2 * Math.PI) / 3) < 1.5e-2, `expected C21 imide carbonyl near 120 degrees`);
    assert.ok(Math.abs(carbonylAngle('C32', 'O33', 'N20') - (2 * Math.PI) / 3) < 1.5e-2, `expected C32 imide carbonyl near 120 degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps saturated piperazine anchor-side attached rings on the exact local outward axis', () => {
    const result = runPipeline(parseSMILES('O=C1NC(=O)C(N2CCN(CC2)C2=NC=CC=N2)(C(=O)N1)C1=CC=C(OC2=CC=CC=C2)C=C1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const outwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, 'N7', atomId => result.coords.get(atomId) ?? null);
    const imideExitAngle = angleOf(sub(result.coords.get('C6'), result.coords.get('N7')));

    assert.equal(outwardAngles.length, 1);
    assert.ok(
      angularDifference(imideExitAngle, outwardAngles[0]) < 1e-6,
      `expected N7-C6 to stay on the exact piperazine outward axis, got ${((angularDifference(imideExitAngle, outwardAngles[0]) * 180) / Math.PI).toFixed(2)} degrees`
    );
    for (const [name, angle] of [
      ['C6-N7-C12', bondAngleAtAtom(result.coords, 'N7', 'C6', 'C12')],
      ['C6-N7-C8', bondAngleAtAtom(result.coords, 'N7', 'C6', 'C8')],
      ['C12-N7-C8', bondAngleAtAtom(result.coords, 'N7', 'C12', 'C8')]
    ]) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${name} to stay at 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('keeps the reported constrained carbonyl center on exact local trigonal bisectors even after late touchups rotate nearby ring blocks', () => {
    const result = runPipeline(parseSMILES('CC1(C)S[C@@H]2[C@H](NC(=O)C(N)=O)C(=O)N2[C@H]1C(=O)O'), { suppressH: true, auditTelemetry: true });
    for (const [anchorAtomId, leafAtomId, otherNeighborIds] of [
      ['C10', 'O11', ['N9', 'C12']],
      ['C12', 'N13', ['C10', 'O14']],
      ['C15', 'O16', ['C7', 'N17']],
      ['C20', 'O21', ['C18', 'O22']]
    ]) {
      const idealAngle = angleOf(sub(result.coords.get(anchorAtomId), centroid(otherNeighborIds.map(atomId => result.coords.get(atomId)))));
      const leafAngle = angleOf(sub(result.coords.get(leafAtomId), result.coords.get(anchorAtomId)));
      assert.ok(angularDifference(leafAngle, idealAngle) < 1e-6, `expected ${anchorAtomId}-${leafAtomId} to stay on the exact ideal local trigonal bisector`);
    }
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps omitted-h three-heavy side carbons on the exact remaining trigonal slot and preserves their shared-junction exit through cleanup', () => {
    const result = runPipeline(parseSMILES('CC(N)C12NC(NC(N)=O)=NC1COC2C#N'), { suppressH: true, auditTelemetry: true });
    const centerAtomId = 'C2';
    const methylAtomId = 'C1';
    const otherNeighborIds = ['N3', 'C4'];
    const sharedJunctionAnchorAtomId = 'C4';
    const sharedJunctionNeighborId = 'C12';
    const idealAngle = angleOf(sub(result.coords.get(centerAtomId), centroid(otherNeighborIds.map(atomId => result.coords.get(atomId)))));
    const methylAngle = angleOf(sub(result.coords.get(methylAtomId), result.coords.get(centerAtomId)));
    const sharedJunctionExitAngle = angleOf(sub(result.coords.get(centerAtomId), result.coords.get(sharedJunctionAnchorAtomId)));
    const sharedJunctionContinuationAngle = angleOf(sub(result.coords.get(sharedJunctionAnchorAtomId), result.coords.get(sharedJunctionNeighborId)));
    const neighborAngles = [methylAtomId, ...otherNeighborIds]
      .map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(centerAtomId))))
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const separations = neighborAngles.map((angle, index) => {
      const nextAngle = neighborAngles[(index + 1) % neighborAngles.length];
      const rawGap = nextAngle - angle;
      return rawGap > 0 ? rawGap : rawGap + Math.PI * 2;
    });

    assert.ok(angularDifference(methylAngle, idealAngle) < 1e-6, 'expected the methyl at C2 to stay on the exact remaining trigonal slot');
    assert.ok(angularDifference(sharedJunctionExitAngle, sharedJunctionContinuationAngle) < 1e-6, 'expected the C4-C2 bridgehead exit to stay on the exact shared-junction continuation');
    for (const separation of separations) {
      assert.ok(Math.abs(separation - (2 * Math.PI) / 3) < 1e-6, `expected C2 separations near 120 degrees, got ${((separation * 180) / Math.PI).toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps crowded omitted-h ring hubs on an exact visible three-heavy fan without reopening overlaps', () => {
    const smiles = 'CC(NC(=O)C1=C2C=CC=CC2=NC=C1C(N1CCN(CC([O-])=O)C(=O)C1)C1=CC=CS1)C1CCCCC1';
    const options = {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    };
    const molecule = parseSMILES(smiles);
    const layoutGraph = createLayoutGraphFromNormalized(molecule, normalizeOptions(options));
    const result = runPipeline(molecule, options);
    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['N17', 'C28'],
      ['N17', 'C15'],
      ['C28', 'C15']
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'C16', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${firstNeighborAtomId}-C16-${secondNeighborAtomId} to keep a 120 degree omitted-H fan, got ${angle.toFixed(2)}`);
    }
    const c28OutwardAngles = computeIncidentRingOutwardAngles(layoutGraph, 'C28', atomId => result.coords.get(atomId) ?? null);
    const c28ParentAngle = angleOf(sub(result.coords.get('C16'), result.coords.get('C28')));
    assert.equal(c28OutwardAngles.length, 1);
    assert.ok(angularDifference(c28ParentAngle, c28OutwardAngles[0]) < 1e-6, 'expected C16-C28 to stay on the exact local thiophene outward axis');
    const n17OutwardAngles = computeIncidentRingOutwardAngles(layoutGraph, 'N17', atomId => result.coords.get(atomId) ?? null);
    const n17ParentAngle = angleOf(sub(result.coords.get('C16'), result.coords.get('N17')));
    assert.equal(n17OutwardAngles.length, 1);
    assert.ok(angularDifference(n17ParentAngle, n17OutwardAngles[0]) < 1e-6, 'expected C16-N17 to stay on the exact local piperazine outward axis');
    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C16', 'C18'],
      ['C16', 'C27'],
      ['C18', 'C27']
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'N17', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${firstNeighborAtomId}-N17-${secondNeighborAtomId} near 120 degrees, got ${angle.toFixed(2)}`);
    }
    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C4', 'C15'],
      ['C4', 'C7'],
      ['C15', 'C7']
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'C6', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - 120) <= 18 + 1e-6, `expected ${firstNeighborAtomId}-C6-${secondNeighborAtomId} to stay within the bounded local relief, got ${angle.toFixed(2)}`);
    }
    for (const [firstNeighborAtomId, secondNeighborAtomId, expectedAngle] of [
      ['O5', 'C6', 123],
      ['O5', 'N3', 123],
      ['C6', 'N3', 114]
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'C4', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - expectedAngle) < 1e-6, `expected ${firstNeighborAtomId}-C4-${secondNeighborAtomId} near the balanced local relief angle ${expectedAngle}, got ${angle.toFixed(2)}`);
    }
    for (const [firstNeighborAtomId, secondNeighborAtomId, expectedAngle] of [
      ['C16', 'C29', 126],
      ['C16', 'S32', 126],
      ['C29', 'S32', 108]
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'C28', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - expectedAngle) < 1e-6, `expected ${firstNeighborAtomId}-C28-${secondNeighborAtomId} near ${expectedAngle} degrees, got ${angle.toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('keeps a crowded tetrazole-linked C13 omitted-h fan bounded without collapsing neighboring ring exits', () => {
    const result = runPipeline(parseSMILES('CCCCCCCC(C)C1CC(C(CC)C2=NNC=N2)(C(=O)O1)C1=CC=C(Cl)C=C1C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    const c13Angles = [
      ['C12', 'C14'],
      ['C12', 'C16'],
      ['C14', 'C16']
    ].map(([firstNeighborAtomId, secondNeighborAtomId]) => bondAngleAtAtom(result.coords, 'C13', firstNeighborAtomId, secondNeighborAtomId));
    assert.ok(Math.min(...c13Angles) >= 105 - 1e-6, `expected C13 omitted-H fan angles to stay open, got ${c13Angles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...c13Angles) <= 145 + 1e-6, `expected C13 omitted-H fan angles to stay bounded, got ${c13Angles.map(angle => angle.toFixed(2)).join(', ')}`);
    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C11', 'C13'],
      ['C11', 'C21'],
      ['C11', 'C24'],
      ['C13', 'C21'],
      ['C13', 'C24'],
      ['C21', 'C24']
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'C12', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(angle >= 70, `expected ${firstNeighborAtomId}-C12-${secondNeighborAtomId} to avoid the collapsed branch fan, got ${angle.toFixed(2)}`);
    }
    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C24', 'C31'],
      ['C29', 'C31'],
      ['C24', 'C29']
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'C30', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - 120) <= 15 + 1e-6, `expected ${firstNeighborAtomId}-C30-${secondNeighborAtomId} to stay on the backed-off outward methyl fan, got ${angle.toFixed(2)}`);
    }
    for (const [firstNeighborAtomId, secondNeighborAtomId] of [
      ['C12', 'C30'],
      ['C12', 'C25'],
      ['C30', 'C25']
    ]) {
      const angle = bondAngleAtAtom(result.coords, 'C24', firstNeighborAtomId, secondNeighborAtomId);
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${firstNeighborAtomId}-C24-${secondNeighborAtomId} to keep the phenyl root exact, got ${angle.toFixed(2)}`);
    }
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('keeps exocyclic ring trigonal multiple-bond exits on their exact bisector when that avoids a crowded ring-neighbor collapse', () => {
    const result = runPipeline(parseSMILES('CN(C)S(=O)(=O)C1=CC=C2NC(=O)\\C(=C/C3=CC4=C(CCCC4)N3)C2=C1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const centerAtomId = 'C14';
    const leafAtomId = 'C15';
    const otherNeighborIds = ['C12', 'C25'];
    const idealAngle = angleOf(sub(result.coords.get(centerAtomId), centroid(otherNeighborIds.map(atomId => result.coords.get(atomId)))));
    const leafAngle = angleOf(sub(result.coords.get(leafAtomId), result.coords.get(centerAtomId)));

    assert.ok(angularDifference(leafAngle, idealAngle) < 1e-6, `expected ${centerAtomId}-${leafAtomId} to stay on the exact local trigonal bisector`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps the row-228 ester root and attached pyridyl ring clean even when placement is already sufficient', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit('COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13', { suppressH: true, auditTelemetry: true });
    const anchorAtomId = 'C16';
    const childAtomId = 'C14';
    const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, anchorAtomId);
    const childAngle = angleOf(sub(result.coords.get(childAtomId), result.coords.get(anchorAtomId)));

    assert.equal(placementAudit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(placementAudit.outwardAxisRingSubstituentFailureCount, 0);
    assert.ok(result.metadata.audit.severeOverlapCount <= placementAudit.severeOverlapCount);
    assert.equal(result.metadata.cleanupTelemetry?.stages?.presentationCleanup?.ran, true);
    assert.equal(result.metadata.cleanupTelemetry?.presentationFallbacks.won, false);
    assert.equal(result.metadata.stageTelemetry.selectedGeometryStage, 'placement');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.notEqual(preferredAngle, null);
    assert.ok(angularDifference(childAngle, preferredAngle) < 1e-6, `expected ${anchorAtomId}-${childAtomId} to stay on the exact local outward direction`);
    assert.ok(
      Math.abs(bondAngleAtAtom(result.coords, 'N27', 'C26', 'O28') - 120) < 1e-6,
      `expected C26-N27-O28 to stay at 120 degrees, got ${bondAngleAtAtom(result.coords, 'N27', 'C26', 'O28').toFixed(2)}`
    );
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('retries a better mixed aromatic root when the default root leaves the tertiary aza ring and linker stacked onto each other', () => {
    const result = runPipeline(parseSMILES('COC1=CC(=CC(OC)=C1OC)C(F)(F)C(=O)N1CCCC[C@H]1C(=O)O[C@@H](CCCC1=CC=CC=C1)CCCC1=CN=CC=C1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const c3FirstAngle = bondAngleAtAtom(result.coords, 'C3', 'O2', 'C4');
    const c3SecondAngle = bondAngleAtAtom(result.coords, 'C3', 'O2', 'C10');
    const n18FirstAngle = bondAngleAtAtom(result.coords, 'N18', 'C16', 'C23');
    const n18SecondAngle = bondAngleAtAtom(result.coords, 'N18', 'C16', 'C19');
    const c23FirstAngle = bondAngleAtAtom(result.coords, 'C23', 'N18', 'C25');
    const c23SecondAngle = bondAngleAtAtom(result.coords, 'C23', 'C22', 'C25');
    const c5FirstAngle = bondAngleAtAtom(result.coords, 'C5', 'C6', 'C13');
    const c5SecondAngle = bondAngleAtAtom(result.coords, 'C5', 'C4', 'C13');
    const c7FirstAngle = bondAngleAtAtom(result.coords, 'C7', 'C6', 'O8');
    const c7SecondAngle = bondAngleAtAtom(result.coords, 'C7', 'O8', 'C10');
    const c16FirstAngle = bondAngleAtAtom(result.coords, 'C16', 'C13', 'O17');
    const c16SecondAngle = bondAngleAtAtom(result.coords, 'C16', 'C13', 'N18');
    const c16ThirdAngle = bondAngleAtAtom(result.coords, 'C16', 'O17', 'N18');
    const c13BranchAngle = bondAngleAtAtom(result.coords, 'C13', 'C5', 'C16');
    const c13LeafPairAngle = bondAngleAtAtom(result.coords, 'C13', 'F14', 'F15');
    const c28FirstAngle = bondAngleAtAtom(result.coords, 'C28', 'O27', 'C30');
    const c28SecondAngle = bondAngleAtAtom(result.coords, 'C28', 'O27', 'C39');
    const c28ThirdAngle = bondAngleAtAtom(result.coords, 'C28', 'C30', 'C39');

    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.ok(Math.abs(c3FirstAngle - c3SecondAngle) < 1e-6, `expected C3 to keep a centered anisole methoxy exit, got ${c3FirstAngle.toFixed(2)} and ${c3SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c3FirstAngle - 120) < 1e-6);
    assert.ok(Math.abs(c16FirstAngle - c16SecondAngle) < 1e-6, `expected C16 to keep a centered trigonal carbonyl exit, got ${c16FirstAngle.toFixed(2)} and ${c16SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c16FirstAngle - c16ThirdAngle) < 1e-6, `expected C16 to keep equal carbonyl angles, got ${c16FirstAngle.toFixed(2)} and ${c16ThirdAngle.toFixed(2)}`);
    assert.ok(Math.abs(n18FirstAngle - n18SecondAngle) < 1e-6, `expected N18 to keep a centered ring exit, got ${n18FirstAngle.toFixed(2)} and ${n18SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c23FirstAngle - c23SecondAngle) < 1e-6, `expected C23 to keep a centered lactam-side exit, got ${c23FirstAngle.toFixed(2)} and ${c23SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c5FirstAngle - c5SecondAngle) < 1e-6, `expected C5 to keep a centered anisole exit, got ${c5FirstAngle.toFixed(2)} and ${c5SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c7FirstAngle - c7SecondAngle) < 1e-6, `expected C7 to keep a centered anisole methoxy exit, got ${c7FirstAngle.toFixed(2)} and ${c7SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(n18FirstAngle - 120) < 1e-6);
    assert.ok(Math.abs(c23FirstAngle - 120) < 1e-6);
    assert.ok(Math.abs(c5FirstAngle - 120) < 1e-6);
    assert.ok(Math.abs(c7FirstAngle - 120) < 1e-6);
    assert.ok(Math.abs(c16FirstAngle - 120) < 1e-6);
    assert.ok(Math.abs(c13BranchAngle - 90) < 1e-6, `expected C5-C13-C16 to stay orthogonal so the deferred difluoro leaves can take the opposite slots, got ${c13BranchAngle.toFixed(2)}`);
    assert.ok(Math.abs(c13LeafPairAngle - 90) < 4.5, `expected F14-C13-F15 to avoid the opposite-pair cross, got ${c13LeafPairAngle.toFixed(2)}`);
    assert.ok(Math.abs(c28FirstAngle - 120) < 1e-6, `expected O27-C28-C30 to keep the omitted-H trigonal spread, got ${c28FirstAngle.toFixed(2)}`);
    assert.ok(Math.abs(c28SecondAngle - 120) < 1e-6, `expected O27-C28-C39 to keep the omitted-H trigonal spread, got ${c28SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c28ThirdAngle - 120) < 1e-6, `expected C30-C28-C39 to keep the omitted-H trigonal spread, got ${c28ThirdAngle.toFixed(2)}`);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('does not flag exact outward carbonyl-linked ring substituents just because the downstream ring centroid bends inward', () => {
    const result = runPipeline(parseSMILES('Cn1c2CCN(Cc2nc1C(=O)N3CCOCC3)c4ncccn4'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.ok(result.metadata.audit.severeOverlapCount <= 2);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps saturated multi-ring bridgehead alkyl exits on their local incident-ring bisector even before late presentation cleanup', () => {
    const result = runPipeline(parseSMILES('CNCCCC12CCC(C3=CC=CC=C13)C1=CC=CC=C21'), {
      suppressH: true,
      auditTelemetry: true
    });
    const anchorAtomId = 'C6';
    const childAtomId = 'C5';
    const leftRingAngle = bondAngleAtAtom(result.coords, anchorAtomId, 'C15', childAtomId);
    const rightRingAngle = bondAngleAtAtom(result.coords, anchorAtomId, 'C21', childAtomId);
    const childAngle = angleOf(sub(result.coords.get(childAtomId), result.coords.get(anchorAtomId)));
    const localRingOutwardAngle = angleOf(
      sub(result.coords.get(anchorAtomId), centroid((result.layoutGraph.atomToRings.get(anchorAtomId) ?? [])[0].atomIds.map(atomId => result.coords.get(atomId)).filter(Boolean)))
    );

    assert.equal(result.metadata.cleanupTelemetry?.selectedStageCategory, 'checkpoint');
    assert.ok(Math.abs(leftRingAngle - rightRingAngle) <= 1e-6, 'expected the bridgehead alkyl exit to bisect the local middle-ring angle');
    assert.ok(angularDifference(childAngle, localRingOutwardAngle) <= 1e-6, `expected ${anchorAtomId}-${childAtomId} to land exactly on the local incident-ring outward angle`);
  });

  it('keeps ring-constrained benzylic aromatic exits centered on the local single-ring exterior bisector', () => {
    const result = runPipeline(parseSMILES('CC(N1CC(C)(C[NH3+])C1)C1=C(C)C=C(C)N1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const anchorAtomId = 'C11';
    const childAtomId = 'C2';
    const firstAngle = bondAngleAtAtom(result.coords, anchorAtomId, childAtomId, 'N17');
    const secondAngle = bondAngleAtAtom(result.coords, anchorAtomId, childAtomId, 'C12');
    const outwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, anchorAtomId, atomId => result.coords.get(atomId) ?? null);
    const childAngle = angleOf(sub(result.coords.get(childAtomId), result.coords.get(anchorAtomId)));

    assert.equal(outwardAngles.length, 1);
    assert.ok(Math.abs(firstAngle - secondAngle) < 1e-6, `expected ${anchorAtomId}-${childAtomId} to bisect the incident ring angle, got ${firstAngle.toFixed(2)} and ${secondAngle.toFixed(2)}`);
    assert.ok(angularDifference(childAngle, outwardAngles[0]) < 1e-6, `expected ${anchorAtomId}-${childAtomId} to follow the exact local exterior bisector`);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('restores crowded terminal methyl ring leaves by rotating the nearby attached ring instead of bending the methyl angle', () => {
    const result = runPipeline(parseSMILES('CCOC1CC2=CC=CC=C2C1NC1=C(C)N=C(N(CC)C1=O)C1=CN=C(C=C1C)N(C)C'), {
      suppressH: true,
      auditTelemetry: true
    });
    const outwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, 'C15', atomId => result.coords.get(atomId) ?? null);
    const methylAngle = angleOf(sub(result.coords.get('C16'), result.coords.get('C15')));
    const firstMethylAngle = bondAngleAtAtom(result.coords, 'C15', 'C14', 'C16');
    const secondMethylAngle = bondAngleAtAtom(result.coords, 'C15', 'C16', 'N17');
    const linkedNitrogenAngle = bondAngleAtAtom(result.coords, 'N13', 'C12', 'C14');

    assert.equal(outwardAngles.length, 1);
    assert.ok(
      angularDifference(methylAngle, outwardAngles[0]) < 1e-6,
      `expected C15-C16 to follow the exact local exterior bisector, got ${((angularDifference(methylAngle, outwardAngles[0]) * 180) / Math.PI).toFixed(2)} degrees`
    );
    assert.ok(Math.abs(firstMethylAngle - 120) < 1e-6, `expected C14-C15-C16 to stay at 120 degrees, got ${firstMethylAngle.toFixed(2)}`);
    assert.ok(Math.abs(secondMethylAngle - 120) < 1e-6, `expected C16-C15-N17 to stay at 120 degrees, got ${secondMethylAngle.toFixed(2)}`);
    assert.ok(Math.abs(linkedNitrogenAngle - 120) < 10, `expected C12-N13-C14 to stay in a bounded trigonal bend, got ${linkedNitrogenAngle.toFixed(2)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('preserves ring-bound tertiary amine fan geometry while clearing adjacent branch overlap', () => {
    const result = runPipeline(parseSMILES('CN1CC=C2CCC3OCC1(C(O)C=O)C23'), {
      suppressH: true,
      auditTelemetry: true
    });
    const n2Angles = [bondAngleAtAtom(result.coords, 'N2', 'C11', 'C1'), bondAngleAtAtom(result.coords, 'N2', 'C11', 'C3'), bondAngleAtAtom(result.coords, 'N2', 'C1', 'C3')];

    for (const angle of n2Angles) {
      assert.ok(Math.abs(angle - 120) < 2, `expected N2 fan near 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps crowded quaternary ring roots from collapsing bulky aryl systems into one quadrant', () => {
    const result = runPipeline(parseSMILES('ClC1=CC=CC=C1C(N1C=CN=C1)(C1=CC=CC=C1)C1=CC=CC=C1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const centerAtomId = 'C8';
    const neighborAtomIds = ['N9', 'C14', 'C20', 'C7'];
    const separations = [];
    const c2FirstAngle = bondAngleAtAtom(result.coords, 'C2', 'C7', 'Cl1');
    const c2SecondAngle = bondAngleAtAtom(result.coords, 'C2', 'C3', 'Cl1');
    const c2ChlorineDistance = Math.hypot(result.coords.get('Cl1').x - result.coords.get('C2').x, result.coords.get('Cl1').y - result.coords.get('C2').y);
    const c20FirstAngle = bondAngleAtAtom(result.coords, 'C20', 'C8', 'C25');
    const c20SecondAngle = bondAngleAtAtom(result.coords, 'C20', 'C8', 'C21');
    for (let firstIndex = 0; firstIndex < neighborAtomIds.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < neighborAtomIds.length; secondIndex++) {
        separations.push(bondAngleAtAtom(result.coords, centerAtomId, neighborAtomIds[firstIndex], neighborAtomIds[secondIndex]));
      }
    }

    assert.equal(result.metadata.stageTelemetry.stageAudits.placement.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(Math.min(...separations) >= 60 - 1e-6, `expected C8 substituent separations to stay at least 60 degrees, got ${Math.min(...separations).toFixed(2)}`);
    assert.ok(Math.abs(c2FirstAngle - 120) < 1e-6, `expected C7-C2-Cl1 to stay at 120 degrees, got ${c2FirstAngle.toFixed(2)}`);
    assert.ok(Math.abs(c2SecondAngle - 120) < 1e-6, `expected C3-C2-Cl1 to stay at 120 degrees, got ${c2SecondAngle.toFixed(2)}`);
    assert.ok(c2ChlorineDistance >= result.layoutGraph.options.bondLength * 0.57, `expected C2-Cl1 to use the longest clean compressed bond, got ${c2ChlorineDistance.toFixed(2)}`);
    assert.ok(c2ChlorineDistance <= result.layoutGraph.options.bondLength * 0.59, `expected C2-Cl1 to stay compressed enough to avoid the imidazole collision, got ${c2ChlorineDistance.toFixed(2)}`);
    assert.ok(Math.abs(c20FirstAngle - 120) < 1e-6, `expected C8-C20-C25 to stay at 120 degrees, got ${c20FirstAngle.toFixed(2)}`);
    assert.ok(Math.abs(c20SecondAngle - 120) < 1e-6, `expected C8-C20-C21 to stay at 120 degrees, got ${c20SecondAngle.toFixed(2)}`);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('projects aryl and amide slots at crowded quaternary urea centers without bending the pyridyl fan', () => {
    const result = runPipeline(parseSMILES('CC(C)[NH+]1CCC(CC1)NC(=O)NC(CC1=CC=CC=C1)(C1=CC=CC(OC(F)(F)C(F)F)=C1)C1=CC=C(I)C=N1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const c36Angles = [bondAngleAtAtom(result.coords, 'C36', 'C15', 'N42'), bondAngleAtAtom(result.coords, 'C36', 'C15', 'C37'), bondAngleAtAtom(result.coords, 'C36', 'N42', 'C37')];
    const priorOverlapDistance = Math.hypot(result.coords.get('C24').x - result.coords.get('C12').x, result.coords.get('C24').y - result.coords.get('C12').y);

    for (const angle of c36Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected C36 pyridyl fan to stay at 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(priorOverlapDistance > result.layoutGraph.options.bondLength * 0.75, `expected the aryl ring to clear the urea carbonyl branch, got ${priorOverlapDistance.toFixed(2)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps compact fused-bridged lactam scaffolds from collapsing overlapping atom pairs', () => {
    const result = runPipeline(parseSMILES('N[C@@H](Cc1ccccc1)C(=O)N2C[C@H]3C[C@@H](C2)C4=CC=CC(=O)N4C3'), {
      suppressH: true,
      auditTelemetry: true
    });
    const internalLactamSeparation = Math.hypot(result.coords.get('C22').x - result.coords.get('N27').x, result.coords.get('C22').y - result.coords.get('N27').y);

    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(internalLactamSeparation > result.layoutGraph.options.bondLength * 1.5, `expected C22 and N27 to stay visually separated, got ${internalLactamSeparation.toFixed(2)}`);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps compact bridged ether cages bounded through the full pipeline', () => {
    const result = runPipeline(parseSMILES('CC1CC2C(O)C(C1)C1OCCOC2CC1C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const dioxepaneAngles = ringAngles(result.coords, ['O10', 'C11', 'C12', 'O13', 'C14', 'C15', 'C16', 'C9']);
    const bridgedRingAngles = ringAngles(result.coords, ['C14', 'C15', 'C16', 'C9', 'C7', 'C5', 'C4']);
    const cyclohexaneAngles = ringAngles(result.coords, ['C8', 'C7', 'C5', 'C4', 'C3', 'C2']);

    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 1);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(
      result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.41,
      `expected compact bridged ether cage bonds to stay bounded, got ${result.metadata.audit.maxBondLengthDeviation.toFixed(3)}`
    );
    assert.ok(Math.min(...dioxepaneAngles) > 55, `expected the acetal ether ring to stay open, got ${dioxepaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...dioxepaneAngles) < 156, `expected the acetal ether ring not to flatten, got ${dioxepaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...bridgedRingAngles) > 90, `expected the fused bridged ring to stay open, got ${bridgedRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...bridgedRingAngles) < 156, `expected the fused bridged ring not to flatten, got ${bridgedRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(cyclohexaneAngles, 120) < 5.2, `expected the cyclohexane face to stay bounded, got ${cyclohexaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      Math.abs(distance(result.coords.get('C5'), result.coords.get('O6')) - result.layoutGraph.options.bondLength) < 1e-6,
      'expected the bridgehead O6 alcohol bond to stay at the target length'
    );
    const c5RingPolygons = (result.layoutGraph.atomToRings.get('C5') ?? []).map(ring => ring.atomIds.map(atomId => result.coords.get(atomId)).filter(Boolean));
    assert.equal(
      c5RingPolygons.some(polygon => pointInPolygon(result.coords.get('O6'), polygon)),
      false,
      'expected O6 to stay outside the incident bridged-ring faces'
    );
    assert.equal(result.metadata.audit.ok, true);
  });

  it('moves compact bridged carbonyl leaves outside crossed ring bonds', () => {
    const result = runPipeline(parseSMILES('CCC12CC(CN3C(=O)NC=C3CO1)C2=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const firstCarbonylAngle = bondAngleAtAtom(result.coords, 'C15', 'C3', 'O16');
    const secondCarbonylAngle = bondAngleAtAtom(result.coords, 'C15', 'C5', 'O16');

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(
      firstCarbonylAngle > 90 && secondCarbonylAngle > 90,
      `expected compact bridged carbonyl to sit outside the ring, got ${firstCarbonylAngle.toFixed(2)} and ${secondCarbonylAngle.toFixed(2)} degrees`
    );
  });

  it('keeps the scaffold-side C11/C5 exits exact while the attached phenyl rescue clears the severe overlap', () => {
    const result = runPipeline(parseSMILES('CCCOC1=C(C)C=CC=C1N1C(=S)[N-]N=C1C1=CC=C(O)C=C1O'), {
      suppressH: true,
      auditTelemetry: true
    });
    const c11FirstAngle = bondAngleAtAtom(result.coords, 'C11', 'N12', 'C5');
    const c11SecondAngle = bondAngleAtAtom(result.coords, 'C11', 'N12', 'C10');
    const c5FirstAngle = bondAngleAtAtom(result.coords, 'C5', 'O4', 'C6');
    const c5SecondAngle = bondAngleAtAtom(result.coords, 'C5', 'O4', 'C11');
    const c18AttachmentAngle = angleOf(sub(result.coords.get('C17'), result.coords.get('C18')));
    const c18OutwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, 'C18', atomId => result.coords.get(atomId) ?? null);
    const c18FirstAngle = bondAngleAtAtom(result.coords, 'C18', 'C17', 'C19');
    const c18SecondAngle = bondAngleAtAtom(result.coords, 'C18', 'C17', 'C24');
    const c17AttachmentAngle = angleOf(sub(result.coords.get('C18'), result.coords.get('C17')));
    const c17OutwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, 'C17', atomId => result.coords.get(atomId) ?? null);
    const c17FirstAngle = bondAngleAtAtom(result.coords, 'C17', 'N12', 'C18');
    const c17SecondAngle = bondAngleAtAtom(result.coords, 'C17', 'N16', 'C18');
    const c24AttachmentAngle = angleOf(sub(result.coords.get('O25'), result.coords.get('C24')));
    const c24OutwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, 'C24', atomId => result.coords.get(atomId) ?? null);
    const c24FirstAngle = bondAngleAtAtom(result.coords, 'C24', 'C18', 'O25');
    const c24SecondAngle = bondAngleAtAtom(result.coords, 'C24', 'C23', 'O25');
    const azaRingSystemId = result.layoutGraph.atomToRingSystemId.get('N12');
    const azaRingSystemAtomIds = result.layoutGraph.ringSystems.find(ringSystem => ringSystem.id === azaRingSystemId)?.atomIds ?? [];
    const propoxyClearance = Math.min(
      ...['C1', 'C2', 'C3'].flatMap(chainAtomId =>
        azaRingSystemAtomIds
          .filter(ringAtomId => ringAtomId !== 'N12' && result.coords.has(ringAtomId))
          .map(ringAtomId => Math.hypot(result.coords.get(chainAtomId).x - result.coords.get(ringAtomId).x, result.coords.get(chainAtomId).y - result.coords.get(ringAtomId).y))
      )
    );

    assert.ok(Math.abs(c11FirstAngle - c11SecondAngle) < 1e-6, `expected C11-N12 to bisect the benzenoid ring exit, got ${c11FirstAngle.toFixed(2)} and ${c11SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c11FirstAngle - 120) < 1e-6, `expected C11-N12 to stay at an exact 120-degree benzenoid exit, got ${c11FirstAngle.toFixed(2)}`);
    assert.ok(Math.abs(c5FirstAngle - c5SecondAngle) < 1e-6, `expected C5-O4 to bisect the anisole exit, got ${c5FirstAngle.toFixed(2)} and ${c5SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c5FirstAngle - 120) < 1e-6, `expected C5-O4 to stay at an exact 120-degree anisole exit, got ${c5FirstAngle.toFixed(2)}`);
    assert.equal(c18OutwardAngles.length, 1);
    assert.ok(angularDifference(c18AttachmentAngle, c18OutwardAngles[0]) < 1e-6, 'expected C18-C17 to stay on the exact local phenyl outward bisector after the attached-ring rescue');
    assert.ok(Math.abs(c18FirstAngle - c18SecondAngle) < 1e-6, `expected C17-C18-C19 and C17-C18-C24 to stay equal, got ${c18FirstAngle.toFixed(2)} and ${c18SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c18FirstAngle - 120) < 1e-6, `expected C18-C17 to stay at an exact 120-degree phenyl exit, got ${c18FirstAngle.toFixed(2)}`);
    assert.equal(c17OutwardAngles.length, 1);
    assert.ok(angularDifference(c17AttachmentAngle, c17OutwardAngles[0]) < 1e-6, 'expected C17-C18 to stay on the exact local aza-ring outward bisector after the rescue retouch');
    assert.ok(Math.abs(c17FirstAngle - c17SecondAngle) < 1e-6, `expected N12-C17-C18 and N16-C17-C18 to stay equal, got ${c17FirstAngle.toFixed(2)} and ${c17SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c17FirstAngle - 126) < 1e-6, `expected C17-C18 to stay at an exact 126-degree five-member-ring exit, got ${c17FirstAngle.toFixed(2)}`);
    assert.ok(propoxyClearance > 1.5, `expected the propoxy tail to keep clear of the aza ring system, got minimum clearance ${propoxyClearance.toFixed(2)}`);
    assert.equal(c24OutwardAngles.length, 1);
    assert.ok(angularDifference(c24AttachmentAngle, c24OutwardAngles[0]) < 1e-6, 'expected C24-O25 to stay on the exact local phenol outward bisector after the attached-ring rescue');
    assert.ok(Math.abs(c24FirstAngle - c24SecondAngle) < 1e-6, `expected C18-C24-O25 and C23-C24-O25 to stay equal, got ${c24FirstAngle.toFixed(2)} and ${c24SecondAngle.toFixed(2)}`);
    assert.ok(Math.abs(c24FirstAngle - 120) < 1e-6, `expected C24-O25 to stay at an exact 120-degree phenol exit, got ${c24FirstAngle.toFixed(2)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps rigid omitted-h trigonal ring exits exact even when placement already avoids the aromatic overlap', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit('CCCCC1=CC2=C(C=C1C(=CC1=CC=NO1)C(C)C)C(C)(C)CC2(C)C', { suppressH: true, auditTelemetry: true });
    const trigonalAngle = angularDifference(angleOf(sub(result.coords.get('C11'), result.coords.get('C12'))), angleOf(sub(result.coords.get('C13'), result.coords.get('C12'))));
    const isopropylSpreads = [
      angularDifference(angleOf(sub(result.coords.get('C11'), result.coords.get('C18'))), angleOf(sub(result.coords.get('C19'), result.coords.get('C18')))),
      angularDifference(angleOf(sub(result.coords.get('C11'), result.coords.get('C18'))), angleOf(sub(result.coords.get('C20'), result.coords.get('C18')))),
      angularDifference(angleOf(sub(result.coords.get('C19'), result.coords.get('C18'))), angleOf(sub(result.coords.get('C20'), result.coords.get('C18'))))
    ];

    assert.equal(placementAudit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(Math.abs(trigonalAngle - (2 * Math.PI) / 3) < 1e-6);
    for (const spread of isopropylSpreads) {
      assert.ok(Math.abs(spread - (2 * Math.PI) / 3) < 1e-6, `expected C18 spreads near 120 degrees, got ${((spread * 180) / Math.PI).toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.ok, true);
  });

  it('clears the ortho ester-acid clash by flipping the ester branch while keeping every ring and carbonyl angle exact', () => {
    const result = runPipeline(parseSMILES('CC(=O)OC1=C(C=CC(=C1)C(F)(F)F)C(O)=O'), { suppressH: true, auditTelemetry: true });
    const esterAngle = angularDifference(angleOf(sub(result.coords.get('C2'), result.coords.get('O4'))), angleOf(sub(result.coords.get('C5'), result.coords.get('O4'))));
    const acidCarbonylAngle = angularDifference(angleOf(sub(result.coords.get('C6'), result.coords.get('C15'))), angleOf(sub(result.coords.get('O16'), result.coords.get('C15'))));
    const acidHydroxylAngle = angularDifference(angleOf(sub(result.coords.get('C6'), result.coords.get('C15'))), angleOf(sub(result.coords.get('O17'), result.coords.get('C15'))));
    const esterRootPreferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, 'C5');
    const esterRootAngle = angleOf(sub(result.coords.get('O4'), result.coords.get('C5')));
    const acidRootPreferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, 'C6');
    const acidRootAngle = angleOf(sub(result.coords.get('C15'), result.coords.get('C6')));

    assert.ok(Math.abs(esterAngle - (2 * Math.PI) / 3) < 1e-6, `expected ester oxygen angle near 120 degrees, got ${((esterAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(acidCarbonylAngle - (2 * Math.PI) / 3) < 1e-6, `expected acid carbonyl angle near 120 degrees, got ${((acidCarbonylAngle * 180) / Math.PI).toFixed(2)}`);
    assert.ok(Math.abs(acidHydroxylAngle - (2 * Math.PI) / 3) < 1e-6, `expected acid hydroxyl angle near 120 degrees, got ${((acidHydroxylAngle * 180) / Math.PI).toFixed(2)}`);
    assert.notEqual(esterRootPreferredAngle, null);
    assert.ok(angularDifference(esterRootAngle, esterRootPreferredAngle) < 1e-6);
    assert.notEqual(acidRootPreferredAngle, null);
    assert.ok(angularDifference(acidRootAngle, acidRootPreferredAngle) < 1e-6);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      ['placement', 'core-geometry'].includes(result.metadata.cleanupTelemetry.selectedGeometryStageCategory),
      `expected the final geometry to be selected from placement or core cleanup, got ${result.metadata.cleanupTelemetry.selectedGeometryStageCategory}`
    );
  });

  it('treats macrocycles with substituents as mixed but still places them completely', () => {
    const result = runPipeline(makeMacrocycleWithSubstituent());
    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 13);
  });

  it('keeps alternating macrocycle substituents outward and audit-clean', () => {
    const result = runPipeline(makeAlternatingMethylMacrocycle(), {
      suppressH: true
    });

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('uses the porphine macrocycle template to avoid collapsed porphyrin-core layouts', () => {
    const result = runPipeline(parseSMILES('C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2'));
    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['macrocycle']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  });

  it('uses the calixarene guanidine macrocycle template to keep aryl wall angles regular', () => {
    const result = runPipeline(parseSMILES('NC(=N)NCCOc1c2Cc3cccc(Cc4cccc(Cc5cccc(Cc1ccc2)c5O)c4OCC(=O)NC(=N)N)c3O'), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });
    const arylWallAngles = [bondAngleAtAtom(result.coords, 'C8', 'C29', 'C9'), bondAngleAtAtom(result.coords, 'C33', 'C23', 'C27'), bondAngleAtAtom(result.coords, 'C35', 'C17', 'C21')];

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(
      arylWallAngles.every(angle => Math.abs(angle - 120) < 1e-4),
      `expected calixarene aryl wall angles to stay regular, got ${arylWallAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
  });

  it('uses the trans-polyene macrolide template so fused macrolide rings keep E alkene geometry', () => {
    const result = runPipeline(parseSMILES(String.raw`CC(C)[C@H]1OC(=O)C2=CCCN2C(=O)C2=COC(=N2)CC(=O)C[C@H](O)\C=C(/C)\C=C\CNC(=O)\C=C\[C@H]1C`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezResolvedBondCount, 3);
  });

  it('does not report cyclic E/Z contradictions from partial mixed macrocycle coordinates', () => {
    const result = runPipeline(
      parseSMILES(
        String.raw`CC[C@H](C)[C@@H]1O[C@]2(CC[C@@H]1C)C[C@H]3C[C@H](C\C=C(/C)\[C@@H](O[C@H]4C[C@H](OC)[C@H](O[C@H]5C[C@H](OC)[C@H](O)[C@H](C)O5)[C@H](C)O4)[C@@H](C)\C=C\C=C6CO[C@@H]7[C@@H](O)C(=C[C@H](C(=O)O3)[C@@]67O)C)O2`
      ),
      { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'partial-coordinates');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 2);
    assert.equal(result.metadata.audit.stereoContradiction, false);
  });

  it('does not report unsupported fused macrocycle E/Z rescue failures as contradictions', () => {
    const result = runPipeline(parseSMILES(String.raw`C[C@H]1CCC\C=C\[C@@H]2C[C@H](O)C[C@H]2[C@H](O)[C@@H](CC(=O)O1)[S+]([O-])CCCO`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 1);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(result.metadata.audit.fallback.mode, null);
  });

  it('does not report unsupported bridged cyclic E/Z rescue failures as contradictions', () => {
    const result = runPipeline(parseSMILES(String.raw`CO[C@H]1[C@@H]2C(=O)\C(=C/C3=C[C@H](C)C[C@@]34O[C@]2(CC1(C)C)[C@@H](C)C4=O)\C`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 1);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(result.metadata.audit.fallback.mode, null);
  });

  it('does not report unsupported large polyene macrocycle E/Z rescue failures as contradictions', () => {
    const result = runPipeline(
      parseSMILES(
        String.raw`C[C@@H]1O[C@H](O[C@@H]2C[C@@H]3O[C@](O)(C[C@@H](O)[C@H](O)CC[C@@H](O)C[C@@H](O)C[C@@H](O)CC(=O)O[C@@H](C)[C@H](C)[C@H](O)[C@@H](C)\C=C\C=C\C=C\C=C\C=C\C=C\C=C\2)C[C@H](O)[C@H]3C(=O)O)[C@H](O)[C@@H]([C@H]1O)N(CCCN)CCCN`
      ),
      { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 6);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(result.metadata.audit.fallback.mode, null);
  });

  it('does not report unsupported fused epoxy lactone E/Z rescue failures as contradictions', () => {
    const result = runPipeline(parseSMILES(String.raw`CN(C)NC[C@H]1[C@@H]2CC\C(=C/CC[C@@]3(C)O[C@H]3[C@H]2OC1=O)\C`), { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true });

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 1);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(result.metadata.audit.fallback.mode, null);
  });

  it('does not report unsupported unsaturated lactone E/Z rescue failures as contradictions', () => {
    const result = runPipeline(parseSMILES(String.raw`C\C=C(\C)/C(=O)O[C@@H]1C[C@H](CO)CC\C=C(\CO)/C[C@H]2OC(=O)C(=C)[C@H]12`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezSupportedBondCount, 1);
    assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 1);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(result.metadata.audit.fallback.mode, null);
  });

  it('does not report unsupported large monocyclic macrocycle E/Z rescue failures as contradictions', () => {
    const result = runPipeline(parseSMILES(String.raw`ONC(=O)c1cccc(c1)C(=O)N\N=C\c2cccc(CN3C[C@@H](OC(=O)CC\C=C\CCC3=O)c4ccccc4)c2`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezSupportedBondCount, 1);
    assert.equal(result.metadata.stereo.ezUnsupportedBondCount, 1);
    assert.equal(result.metadata.cleanupStereoReflections, 0);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(result.metadata.audit.fallback.mode, null);
  });

  it('rejects final macrocycle attached-ring retouches that flip accepted E/Z geometry', () => {
    const result = runPipeline(
      parseSMILES(
        String.raw`C[C@H]1CCC[C@H]2O[C@H]2C[C@H](OC(=O)C[C@H](O)C(C)(C)C(=O)[C@H](C)[C@H]1OC(=O)CSSCC(=O)O[C@H]3[C@@H](C)CCC[C@H]4O[C@H]4C[C@H](OC(=O)C[C@H](O)C(C)(C)C(=O)[C@@H]3C)\C(=C\c5csc(C)n5)\C)\C(=C\c6csc(C)n6)\C`
      ),
      { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.stereo.ezSupportedBondCount, 2);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.ok(!result.metadata.audit.fallback.reasons.includes('stereo-contradiction'));
  });

  it('keeps fused ether ansamycin macrocycle closures bond-clean and overlap-free', () => {
    const result = runPipeline(parseSMILES(String.raw`COC1\C=C\OC2(C)Oc3c(C)c(O)c4c(O)c(NC(=O)\C(=C/C=C/C(C)C(O)C(C)C(O)C(C)C(OC(=O)C)C1C)\C)c(C=NN5CCN(Cc6c(C)cc(C)cc6C)CC5)c(O)c4c3C2=O`), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const fusedEtherClosureLengths = [
      distance(result.coords.get('C7'), result.coords.get('O9')),
      distance(result.coords.get('O9'), result.coords.get('C10')),
      distance(result.coords.get('C66'), result.coords.get('C10')),
      distance(result.coords.get('C15'), result.coords.get('C13'))
    ];
    const severeOverlapPairs = findSevereOverlaps(result.layoutGraph, result.coords, result.layoutGraph.options.bondLength).map(overlap => `${overlap.firstAtomId}-${overlap.secondAtomId}`);

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.severeOverlapCount <= 2);
    assert.ok(
      !severeOverlapPairs.includes('C12-C45') && !severeOverlapPairs.includes('C45-C12'),
      `expected imine-side macrocycle crowding to clear, got severe overlaps ${severeOverlapPairs.join(', ')}`
    );
    assert.ok(
      fusedEtherClosureLengths.every(length => Math.abs(length - result.layoutGraph.options.bondLength) < 0.08),
      `expected fused ansamycin ring closures to stay near target length, got ${fusedEtherClosureLengths.map(length => length.toFixed(3)).join(', ')}`
    );
  });

  it('keeps medium and large simple macrocycles within bond-length audit tolerance', () => {
    const mediumResult = runPipeline(parseSMILES('C1CCCCCCCCCCCCCCO1'), {
      suppressH: true
    });
    const largeResult = runPipeline(parseSMILES('C1CCCCCCCCCCCCCCCCCCCCCCC1'), {
      suppressH: true
    });

    assert.equal(mediumResult.metadata.primaryFamily, 'macrocycle');
    assert.equal(mediumResult.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(mediumResult.metadata.audit.ok, true);
    assert.equal(largeResult.metadata.primaryFamily, 'macrocycle');
    assert.equal(largeResult.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(largeResult.metadata.audit.ok, true);
  });

  it('keeps erythromycin-class macrolides audit-clean after macrocycle cleanup', () => {
    const result = runPipeline(
      parseSMILES(
        'CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O'
      ),
      {
        suppressH: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  });

  it('keeps macrocycle cleanup from trading small overlap improvements for heavy bond failures', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit(
      'CC[C@H](C)[C@@H]1NC(=O)[C@H](CCCCN)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CO)NC(=O)[C@H](CC(=O)N)NC(=O)[C@H](Cc2c[nH]c3ccccc23)NC(=O)CCN(C(=O)c4ccccc4C5=C6C=CC(=O)C=C6Oc7cc(O)ccc57)C(=O)NCCN(CC(=O)N)C(=O)[C@@H](NC(=O)[C@H](CC(=O)O)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CC(=O)N)NC(=O)[C@H](CC(=O)O)NC1=O)C(C)C'
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(placementAudit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.severeOverlapCount <= placementAudit.severeOverlapCount);
    assert.ok(result.metadata.audit.collapsedMacrocycleCount <= placementAudit.collapsedMacrocycleCount);
  });

  it('keeps mixed macrocycle cleanup from introducing bond failures when placement is bond-clean', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit(
      'CC(O)C1NC(=O)C(CC2=CC=CC=C2)NC(=O)C(NC(=O)C(CCCCN)NC(=O)C(CC2=CNC3=CC=CC=C23)NC(=O)C(CC2=CC=CC=C2)NC(=O)C(CC2=CC=CC=C2)NC(=O)C(CC(N)=O)NC(=O)C(CCCCN)NC(=O)C(CSSCC(NC(=O)C(CO)NC1=O)C(O)=O)NC(=O)CNC(=O)C(C)N)C(C)O'
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(placementAudit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.severeOverlapCount <= placementAudit.severeOverlapCount);
    assert.ok(result.metadata.audit.maxBondLengthDeviation <= placementAudit.maxBondLengthDeviation + 1e-6);
  });

  it('keeps cleanup from collapsing macrocycles that placement kept intact', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit('CC(C)(C)[C@H]1COC(=O)[C@H](C\\C=C/C[C@@H](CC(=O)N[C@@H](CO)Cc2ccccc2)C(=O)N1)NC(=O)OCC3c4ccccc4c5ccccc35');

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(placementAudit.collapsedMacrocycleCount, 0);
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= placementAudit.bondLengthFailureCount);
    assert.notEqual(result.metadata.audit.fallback.mode, 'macrocycle-circle');
  });

  it('keeps small macrocycles off the macrocycle-circle fallback when placement is already clean', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit('[H][C@@]1(C)C[C@]([H])(C)[C@]([H])(O)[C@@]([H])(C)C(=O)O[C@]([H])(CC)[C@]([H])(C)\\C=C\\C1=O');

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(placementAudit.collapsedMacrocycleCount, 0);
    assert.equal(placementAudit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.notEqual(result.metadata.audit.fallback.mode, 'macrocycle-circle');
  });

  it('keeps bridged cleanup from worsening pre-existing bond failures', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit(
      'CC[C@]1(O)C[C@H]2CN(CCc3c([nH]c4ccc(C)cc34)[C@@](C2)(C(=O)OC)c5cc6c(cc5OC)N(C=O)[C@H]7[C@](O)([C@H](OC(=O)C)[C@]8(CC)CC=CN9CC[C@]67[C@H]89)C(=O)OC)C1'
    );

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.ok(result.metadata.audit.bondLengthFailureCount <= placementAudit.bondLengthFailureCount);
    assert.ok(result.metadata.audit.maxBondLengthDeviation <= placementAudit.maxBondLengthDeviation + 1e-6);
  });

  it('clears crowded mixed bridged acyl branches without stretching bridged rings', () => {
    const smiles = '[H][C@@]12N(C)C3=C(C=C(C(OC)=C3)[C@]3(C[C@@H]4CN(C[C@](O)(CC)C4)CCC4=C3NC3=CC=CC=C43)C(=O)OC)[C@@]11CCN3CC=C[C@@](CC)([C@@H](OC(C)=O)[C@]2(O)C(=O)OC)[C@@]13[H]';
    const { placementAudit, result } = inspectPlacementAndFinalAudit(smiles);
    const bondLength = result.layoutGraph.options.bondLength;
    const ringByAtomIds = new Map(result.layoutGraph.rings.map(ring => [ring.atomIds.join('-'), ring]));

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.ok(result.metadata.audit.severeOverlapCount <= placementAudit.severeOverlapCount);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(distance(result.coords.get('C9'), result.coords.get('O38')) > bondLength * 0.75, 'expected the aryl ester oxygen to clear the neighboring bridged ring');
    assert.ok(distance(result.coords.get('C53'), result.coords.get('O59')) > bondLength * 0.75, 'expected the lower acetate branch to clear the ring carbonyl oxygen');
    assert.ok(
      maxAngleDeviation([bondAngleAtAtom(result.coords, 'C8', 'C7', 'C9'), bondAngleAtAtom(result.coords, 'C8', 'C7', 'C13'), bondAngleAtAtom(result.coords, 'C8', 'C9', 'C13')], 120) < 1e-6,
      'expected the aryl-to-cage C8 exit to keep an exact 120-degree fan'
    );
    assert.ok(distance(result.coords.get('C27'), result.coords.get('O37')) > bondLength * 2, 'expected the upper carbonyl oxygen to clear C27 in the bridged cage');
    assert.equal(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords, { bondLength }).length, 0, 'expected the upper carbonyl bond to avoid crossing the neighboring aryl ring edge');
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'O38', 'C36', 'C39') - 120) < 1e-6, 'expected the upper ester O38 continuation to keep a clean 120-degree angle');
    for (const atomIds of [
      ['C46', 'C47', 'C62', 'N43', 'C44', 'C45'],
      ['C24', 'C20', 'C19', 'N18', 'C17', 'C15'],
      ['C56', 'C50', 'C47', 'C62', 'C40', 'C2'],
      ['C62', 'N43', 'C42', 'C41', 'C40'],
      ['C40', 'C6', 'C5', 'N3', 'C2']
    ]) {
      const ring = ringByAtomIds.get(atomIds.join('-'));
      assert.ok(ring, `expected to find ring ${atomIds.join('-')}`);
      const targetAngle = atomIds.length === 6 ? 120 : 108;
      const angles = ringAngles(result.coords, ring.atomIds);
      assert.ok(maxAngleDeviation(angles, targetAngle) < 9, `expected ${atomIds.join('-')} to keep strict small-ring geometry, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
    }

    const explicitHydrogenResult = runPipeline(parseSMILES(smiles), {
      suppressH: false,
      auditTelemetry: true
    });
    assert.equal(findSevereOverlaps(explicitHydrogenResult.layoutGraph, explicitHydrogenResult.coords, explicitHydrogenResult.layoutGraph.options.bondLength).length, 0);
    assert.ok(distance(explicitHydrogenResult.coords.get('H16'), explicitHydrogenResult.coords.get('C49')) > bondLength * 0.75, 'expected explicit H16 to stay clear of C49');
  });

  it('keeps mixed organometallic cleanup from worsening cobalt-corrin bond failures', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit(
      '[C@@H]12N3C4=C([N]([Co+]567(N8C9=C(C%10=[N]5C([C@H]([C@]%10(C)CC(N)=O)CCC(N)=O)=CC5=[N]6C([C@H](C5(C)C)CCC(N)=O)=C(C5=[N]7[C@H]([C@@H]([C@@]5(C)CCC(=O)NCC(C)OP([O-])(=O)O[C@@H]([C@H]1O)[C@@H](CO)O2)CC(N)=O)[C@]8([C@@]([C@@H]9CCC(N)=O)(C)CC(N)=O)C)C)C)C)=C3)C=C(C(C)=C4)C'
    );

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= placementAudit.bondLengthFailureCount);
    assert.ok(result.metadata.audit.maxBondLengthDeviation <= placementAudit.maxBondLengthDeviation + 1e-6);
    assert.ok(result.metadata.audit.severeOverlapCount <= placementAudit.severeOverlapCount);
  });

  it('centers cobalt in a corrin ligand pocket instead of leaving the metal fan deformed', () => {
    const result = runPipeline(parseSMILES(String.raw`CC1=C(C=C)C2=CC3=[N+]4C(=CC5=C(C)C(CCC(O)=O)=C6C=C7C(CCC(O)=O)=C(C)C8=[N+]7[Co@]4(N2C1=C8)N56)C(C=C)=C3C`), {
      suppressH: true,
      auditTelemetry: true
    });
    const cobaltAtom = [...result.layoutGraph.atoms.values()].find(atom => atom.element === 'Co');
    const ligandAtomIds = (result.layoutGraph.bondsByAtomId.get(cobaltAtom.id) ?? []).map(bond => (bond.a === cobaltAtom.id ? bond.b : bond.a));
    const cobaltPosition = result.coords.get(cobaltAtom.id);
    const ligandAngles = ligandAtomIds.map(atomId => angleOf(sub(result.coords.get(atomId), cobaltPosition))).sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const squarePlanarDeviation = ligandAngles.reduce((totalDeviation, angle, index) => {
      const nextAngle = ligandAngles[(index + 1) % ligandAngles.length] + (index === ligandAngles.length - 1 ? 2 * Math.PI : 0);
      return totalDeviation + Math.abs(nextAngle - angle - Math.PI / 2);
    }, 0);

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(ligandAtomIds.length, 4);
    assert.ok(result.metadata.audit.severeOverlapCount <= 1);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 1);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(squarePlanarDeviation < Math.PI / 8);
    assert.ok(['specialistCleanup', 'presentationCleanup'].includes(result.metadata.stageTelemetry.selectedStage));
  });

  it('keeps mixed organometallic ring-to-metal exits on the local cyclopentadienyl exterior axis', () => {
    const result = runPipeline(parseSMILES('CC1C(C)=C(C)C(C)=C1[Hf]([NH2+]C1CCCCCCCC1)[SiH](C1=CC=CC=C1)C1=CC=CC=C1'), { suppressH: true });
    const c9OutwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, 'C9', atomId => result.coords.get(atomId) ?? null);
    const hafniumAngle = angleOf(sub(result.coords.get('Hf10'), result.coords.get('C9')));
    const c9MetalDeviation = Math.min(...c9OutwardAngles.map(outwardAngle => angularDifference(hafniumAngle, outwardAngle)));
    const leftMetalAngle = bondAngleAtAtom(result.coords, 'C9', 'C2', 'Hf10');
    const rightMetalAngle = bondAngleAtAtom(result.coords, 'C9', 'C7', 'Hf10');

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(c9MetalDeviation < 1e-6);
    assert.ok(leftMetalAngle > 120 && leftMetalAngle < 132);
    assert.ok(rightMetalAngle > 120 && rightMetalAngle < 132);
  });

  it('prefers macrocycle-aware slice placement over large-molecule partitioning for large cyclic peptides', () => {
    const result = runPipeline(
      parseSMILES(
        'CC[C@H](C)[C@H]1NC(=O)[C@H](CCCN=C(N)N)NC(=O)[C@@H](CCCN=C(N)N)NC(=O)[C@@H](NC(=O)[C@H](Cc2ccccc2)NC(=O)CNC(=O)CNC(=O)[C@@H](N)Cc3ccc(O)cc3)C(C)(C)SCCSC(C)(C)[C@@H](NC(=O)[C@H]4CCCN4C(=O)[C@H](CCCN=C(N)N)NC1=O)C(=O)N'
      ),
      {
        suppressH: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.08);
    assert.ok(result.metadata.timing.totalMs < 5000, `expected large cyclic peptide reroute to stay fast on the full-suite host, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps large metallomacrocycles off the catastrophic large-molecule collapse path', () => {
    const result = runPipeline(
      parseSMILES(
        'C1(CC[C@@]2([C@@H](CC(N)=O)[C@@]3([C@@]4([N+]5=C([C@H]([C@@]4(CC(N)=O)C)CCC(N)=O)C(C)=C4[N+]6=C(C=C7[N+]8=C([C@H](C7(C)C)CCC(N)=O)C(C)=C2N3[Co-3]568([N+]2=CN([C@H]3O[C@@H]([C@@H](OP(O[C@@H](CN1)C)([O-])=O)[C@H]3O)CO)C1=CC(C)=C(C=C21)C)C)[C@H]([C@@]4(CC(N)=O)C)CCC(N)=O)C)[H])C)=O'
      ),
      {
        suppressH: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.deepEqual(result.metadata.placedFamilies, ['fused']);
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.ok(result.metadata.audit.bondLengthFailureCount < 40);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 10);
    assert.ok(result.metadata.timing.totalMs < 30000, `expected metallomacrocycle reroute to avoid the 30s runaway placement budget on the full-suite host, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps densely fused cyclic peptide macrocycles off the catastrophic partial-ring completion path', () => {
    const result = runPipeline(
      parseSMILES(
        'CC(C)[C@H]1NC(=O)c2cc3cc(c2)C(=O)NC[C@H](NC(=O)[C@@H](C)NC(=O)[C@H](C)NC(=O)[C@H](CCCNC(=N)N)NC(=O)[C@H](Cc4ccc5ccccc5c4)NC(=O)[C@H]6CCCCN6C(=O)[C@H](NC(=O)[C@H](Cc7ccc(F)cc7)NC1=O)[C@H](C)O)C(=O)N[C@@H](Cc8ccccc8)C(=O)N[C@@H](Cc9ccc%10ccccc%10c9)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CNC3=O)C(=O)N[C@@H](CCCCN)C(=O)O'
      ),
      {
        suppressH: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.placedFamilies.length, 1);
    assert.ok(
      ['mixed', 'large-molecule'].includes(result.metadata.placedFamilies[0]),
      `expected dense macrocycle fusion to use a bounded mixed or large-molecule placement, got ${result.metadata.placedFamilies.join(', ')}`
    );
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 1, `expected dense macrocycle fusion to avoid catastrophic bond blowups, got ${result.metadata.audit.maxBondLengthDeviation}`);
    assert.ok(result.metadata.audit.bondLengthFailureCount < 20, `expected dense macrocycle fusion to stay below the catastrophic failure bucket, got ${result.metadata.audit.bondLengthFailureCount}`);
    assert.ok(result.metadata.audit.severeOverlapCount <= 6, `expected dense macrocycle fusion to keep overlaps contained, got ${result.metadata.audit.severeOverlapCount}`);
  });

  it('keeps macrocycle acid terminal hetero fans trigonal after presentation cleanup', () => {
    const result = runPipeline(
      parseSMILES(
        '[H][C@@]12CC3=CC=C(OC4=C(O[C@@H]5O[C@@H](<[C@@H](O)[C@H](O)[C@H]5NC(=O)CCCCCCCCC(C)C>)C(O)=O)C5=CC(=C4)[C@@]([H])(NC(=O)[C@@]([H])(NC1=O)C1=C(Cl)C(O)=CC(OC4=C(O)C=CC(=C4)[C@@H](NC)C(=O)N2)=C1)C(=O)N[C@]1([H])C2=CC(=C(O)C=C2)C2=C(C=C(O)C=C2O[C@H]2O[C@H](CO)[C@@H](O)[C@H](O)[C@@H]2O)C(NC(=O)[C@@]([H])(NC1=O)[C@H](O)C1=CC(Cl)=C(O5)C=C1)C(=O)NCCCN(C)C)C=C3'
      ),
      {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    const acidFanAngles = [bondAngleAtAtom(result.coords, 'C39', 'C15', 'O40'), bondAngleAtAtom(result.coords, 'C39', 'C15', 'O41'), bondAngleAtAtom(result.coords, 'C39', 'O40', 'O41')];
    assert.ok(maxAngleDeviation(acidFanAngles, 120) < 1e-6, `expected macrocycle acid terminal hetero fan to stay trigonal, got ${acidFanAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    const ringFanContinuation = measureThreeHeavyContinuationDistortion(result.layoutGraph, result.coords);
    assert.ok(ringFanContinuation.maxDeviation < 0.9, `expected crowded macrocycle ring junction fans to be retouched, got max deviation ${ringFanContinuation.maxDeviation}`);
    const strainedRingFanAngles = [
      [bondAngleAtAtom(result.coords, 'C46', 'C44', 'N48'), bondAngleAtAtom(result.coords, 'C46', 'C44', 'C79'), bondAngleAtAtom(result.coords, 'C46', 'N48', 'C79')],
      [bondAngleAtAtom(result.coords, 'C122', 'C82', 'O123'), bondAngleAtAtom(result.coords, 'C122', 'C82', 'N121'), bondAngleAtAtom(result.coords, 'C122', 'O123', 'N121')]
    ];
    assert.ok(
      Math.max(...strainedRingFanAngles.map(angles => maxAngleDeviation(angles, 120))) < 42,
      `expected worst macrocycle ring fans to avoid acute collapse, got ${strainedRingFanAngles.map(angles => angles.map(angle => angle.toFixed(2)).join(', ')).join(' | ')}`
    );
  });

  it('uses the oxygen-bridged bisindole lactam template so the peroxide ester exits outside the fused core', () => {
    const result = runPipeline(parseSMILES('[H][C@@]12C[C@H](<C(=O)OOC>)[C@](C)(O1)N1C3=C(C=C(CSCC)C=C3)C3=C4CNC(=O)C4=C4C5=C(C=CC(CSCC)=C5)N2C4=C13'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const centralAngles = ringAngles(result.coords, ['C26', 'C31', 'C32', 'C44', 'C45', 'C25']);
    const leftArylAngles = ringAngles(result.coords, ['C24', 'C23', 'C18', 'C17', 'C16', 'C15']);
    const rightArylAngles = ringAngles(result.coords, ['C42', 'C37', 'C36', 'C35', 'C34', 'C33']);
    const lowerIndoleAngles = ringAngles(result.coords, ['C45', 'C25', 'C16', 'C15', 'N14']);
    const upperIndoleAngles = ringAngles(result.coords, ['C44', 'N43', 'C34', 'C33', 'C32']);
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < result.layoutGraph.options.bondLength * 0.42);
    assert.ok(Math.max(...centralAngles.map(angle => Math.abs(angle - 120))) < 1.1);
    assert.ok(Math.max(...leftArylAngles.map(angle => Math.abs(angle - 120))) < 0.5);
    assert.ok(Math.max(...rightArylAngles.map(angle => Math.abs(angle - 120))) < 0.5);
    assert.ok(Math.min(...lowerIndoleAngles) > 102, `expected the lower indole lane to stay open, got ${lowerIndoleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...upperIndoleAngles) > 104, `expected the upper indole lane to stay open, got ${upperIndoleAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(distance(result.coords.get('O7'), result.coords.get('C16')) > result.layoutGraph.options.bondLength * 2);
  });

  it('routes large components through block partitioning and stitching', () => {
    const result = runPipeline(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.coords.size, 34);
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
  });

  it('routes chain-heavy peptide-like mixed components through the large-molecule path with a polished amide fan', () => {
    const result = runPipeline(
      parseSMILES(
        'CCNC(=O)[C@@H]1CCCN1C(=O)[C@H](CCCN=C(N)N)NC(=O)[C@H](CC(C)C)NC(=O)[C@@H](CC(C)C)N(C)C(=O)[C@H](Cc2ccc(O)cc2)NC(=O)[C@H](CO)NC(=O)[C@H](Cc3c[nH]c4ccccc34)NC(=O)[C@H](Cc5c[nH]cn5)NC(=O)[C@@H]6CCC(=O)N6'
      ),
      {
        suppressH: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.ok(result.metadata.audit.severeOverlapCount <= 6);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    const c43Angles = [bondAngleAtAtom(result.coords, 'C43', 'N41', 'O44'), bondAngleAtAtom(result.coords, 'C43', 'N41', 'C45'), bondAngleAtAtom(result.coords, 'C43', 'O44', 'C45')];
    assert.ok(maxAngleDeviation(c43Angles, 120) < 8, `expected the C43 amide fan to stay near trigonal, got ${c43Angles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('keeps peptide timeout regressions well under the stress-test budget after large-molecule partitioning', () => {
    const start = Date.now();
    const result = runPipeline(
      parseSMILES(
        'CC[C@H](C)[C@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)[C@H](NC(=O)[C@H](C)NC(=O)[C@H](CCSC)NC(=O)[C@H](CCC(=O)N)NC(=O)[C@@H](NC(=O)[C@H](C)NC(=O)[C@@H](N)[C@@H](C)O)C(C)C)C(C)C)C(=O)N[C@@H](Cc2cnc[nH]2)C(=O)N[C@@H](CC(=O)N)C(=O)N[C@@H](Cc3ccccc3)C(=O)N[C@@H](CCCCN)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCCN)C(=O)O'
      ),
      {
        suppressH: true,
        timing: true
      }
    );
    const elapsed = Date.now() - start;

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.ok(result.metadata.audit.severeOverlapCount <= 15);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.25);
    assert.ok(elapsed < 10000, `expected the peptide timeout regression to finish far below the 30s stress-test timeout, got ${elapsed}ms`);
  });

  it('expands compact direct phenyl attachments in peptide-like mixed layouts to clear carbonyl overlaps', () => {
    const result = runPipeline(
      parseSMILES('CC[C@H](C)[C@H](<NC(=O)[C@H](CC(=O)O)NC(=O)[C@H](CC(C)C)NC(=O)[C@@H](NC(=O)C)C(c1ccccc1)c2ccccc2>)C(=O)N[C@@H](<C(C)C>)C(=O)N[C@@H](Cc3c[nH]c4ccccc34)C(=O)O'),
      {
        suppressH: true
      }
    );

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(distance(result.coords.get('O33'), result.coords.get('C47')) > result.layoutGraph.options.bondLength * 0.8, 'expected the carbonyl oxygen to clear the neighboring phenyl atom');
  });

  it('keeps peptide-like attached phenyl methylene continuations exact after mixed root retry', () => {
    const result = runPipeline(parseSMILES('CC(C)C(NC(=O)C1(CCC2=C(C1)C1=CC=CC=C1N2)NC(=O)C(CC1=CC=CC=C1)C1=CC=CC=C1)C(=O)NC(CC([O-])=O)C(N)=O'), {
      suppressH: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(
      Math.abs(bondAngleAtAtom(result.coords, 'C25', 'C24', 'C26') - 120) < 1e-6,
      `expected C24-C25-C26 to stay at 120 degrees, got ${bondAngleAtAtom(result.coords, 'C25', 'C24', 'C26').toFixed(2)}`
    );
  });

  it('keeps crowded diaryl hydroxy mixed roots on an exact hidden-h fan', () => {
    const result = runPipeline(parseSMILES('COC1=CC=CC=C1C(C(O)C1OC(N2C=CC(=O)NC2=O)C(F)=C1)(C1=CC=CC=C1)C1=CC=CC=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const hydroxyFanAngles = [bondAngleAtAtom(result.coords, 'C10', 'C9', 'O11'), bondAngleAtAtom(result.coords, 'C10', 'C9', 'C12'), bondAngleAtAtom(result.coords, 'C10', 'O11', 'C12')];
    const methoxyArylExitAngles = [bondAngleAtAtom(result.coords, 'C3', 'C4', 'O2'), bondAngleAtAtom(result.coords, 'C3', 'C8', 'O2'), bondAngleAtAtom(result.coords, 'C3', 'C4', 'C8')];
    const hydroxyFanDistortion = measureThreeHeavyContinuationDistortion(result.layoutGraph, result.coords, {
      focusAtomIds: new Set(['C10'])
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(maxAngleDeviation(hydroxyFanAngles, 120) < 1e-6, `expected the hydroxy linker fan to stay trigonal, got ${hydroxyFanAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(methoxyArylExitAngles, 120) < 8.2, `expected the methoxy aryl exit to stay near trigonal, got ${methoxyArylExitAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(hydroxyFanDistortion.maxDeviation < 1e-12, `expected focused hidden-h distortion to be eliminated, got ${hydroxyFanDistortion.maxDeviation}`);
  });

  it('uses finer dense partitions for ring-rich peptide chains before residual retouch', () => {
    const result = runPipeline(
      parseSMILES(
        'NCCCC[C@H](<NC(=O)[C@@H](N)CCCNC(=N)N>)C(=O)N[C@@H](Cc1c[nH]c2ccccc12)C(=O)N[C@@H](Cc3c[nH]c4ccccc34)C(=O)N[C@@H](<CCCNC(=N)N>)C(=O)N[C@@H](Cc5c[nH]c6ccccc56)C(=O)N[C@@H](Cc7c[nH]c8ccccc78)C(=O)N[C@@H](<CCCNC(=N)N>)C(=O)N[C@@H](Cc9c[nH]c%10ccccc9%10)C(=O)O'
      ),
      {
        suppressH: true,
        timing: true
      }
    );
    const alphaFanAngles = [bondAngleAtAtom(result.coords, 'C56', 'C58', 'C65'), bondAngleAtAtom(result.coords, 'C56', 'C58', 'N55'), bondAngleAtAtom(result.coords, 'C56', 'C65', 'N55')];
    const carbonylFanAngles = [bondAngleAtAtom(result.coords, 'C65', 'C56', 'O66'), bondAngleAtAtom(result.coords, 'C65', 'C56', 'N67'), bondAngleAtAtom(result.coords, 'C65', 'O66', 'N67')];
    const sidechainFanAngles = [bondAngleAtAtom(result.coords, 'C68', 'C70', 'C81'), bondAngleAtAtom(result.coords, 'C68', 'C70', 'N67'), bondAngleAtAtom(result.coords, 'C68', 'C81', 'N67')];

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(maxAngleDeviation(alphaFanAngles, 120) < 1e-6, `expected the peptide alpha fan to stay trigonal, got ${alphaFanAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(carbonylFanAngles, 120) < 13, `expected the adjacent amide fan to remain readable, got ${carbonylFanAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(sidechainFanAngles, 120) < 1e-6, `expected the protected peptide sidechain fan to stay trigonal, got ${sidechainFanAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(result.metadata.timing.totalMs < 20000, `expected finer dense partition retry to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('retouches residual peptide sidechain overlaps after large-molecule block stitching', () => {
    const result = runPipeline(
      parseSMILES(
        'CC[C@H](C)[C@H](<NC(=O)[C@H](CC(=O)O)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CCCCN)NC(=O)[C@H](CCCN=C(N)N)NC(=O)[C@H](CC(=O)N)NC(=O)[C@H](CO)NC(=O)[C@H](Cc1c[nH]cn1)NC(=O)[C@H](C)NC(=O)[C@H](C)NC(=O)[C@H](CCC(=O)N)NC(=O)[C@H](C)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CCC(=O)N)NC(=O)[C@H](CC(=O)O)NC(=O)[C@H](C)NC(=O)[C@H](CCCCN)NC(=O)[C@@H](NC(=O)[C@H](CCSC)NC(=O)[C@H](CCC(=O)O)NC(=O)[C@H](CC(C)C)NC(=O)[C@@H](NC(=O)[C@H](CCC(=O)O)NC(=O)[C@H](CCCN=C(N)N)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](Cc2c[nH]cn2)NC(=O)[C@H](Cc3ccccc3)NC(=O)[C@@H](NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CC(=O)O)NC(=O)[C@H](CC(C)C)NC(=O)[C@H](CO)NC(=O)[C@@H](NC(=O)[C@@H]4CCCN4C(=O)[C@@H]5CCCN5C(=O)[C@H](CCC(=O)O)NC(=O)[C@H](CCC(=O)N)NC(=O)[C@@H](N)CO)[C@@H](C)CC)[C@@H](C)O)C(C)C)[C@@H](C)O>)C(=O)N[C@@H](C)C(=O)N'
      ),
      {
        suppressH: true,
        timing: true,
        finalLandscapeOrientation: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    const trigonalDistortion = measureTrigonalDistortion(result.layoutGraph, result.coords);
    const divalentDistortion = measureDivalentContinuationDistortion(result.layoutGraph, result.coords);
    const threeHeavyDistortion = measureThreeHeavyContinuationDistortion(result.layoutGraph, result.coords);
    const angularDistortionTotal = trigonalDistortion.totalDeviation + divalentDistortion.totalDeviation + threeHeavyDistortion.totalDeviation;
    assert.ok(trigonalDistortion.maxDeviation < 0.6, `expected trigonal fan relief, got ${trigonalDistortion.maxDeviation}`);
    assert.ok(divalentDistortion.maxDeviation < 0.2, `expected divalent angle relief, got ${divalentDistortion.maxDeviation}`);
    assert.ok(threeHeavyDistortion.maxDeviation < 0.4, `expected hidden-h three-heavy fan relief, got ${threeHeavyDistortion.maxDeviation}`);
    assert.ok(angularDistortionTotal < 3.8, `expected residual angle relief to stay bounded, got ${angularDistortionTotal}`);
    const c208Angles = [bondAngleAtAtom(result.coords, 'C208', 'C206', 'C210'), bondAngleAtAtom(result.coords, 'C208', 'C206', 'N217'), bondAngleAtAtom(result.coords, 'C208', 'C210', 'N217')];
    const c283Angles = [bondAngleAtAtom(result.coords, 'C283', 'O284', 'C285'), bondAngleAtAtom(result.coords, 'C283', 'O284', 'N282'), bondAngleAtAtom(result.coords, 'C283', 'C285', 'N282')];
    const c285Angles = [bondAngleAtAtom(result.coords, 'C285', 'C283', 'C287'), bondAngleAtAtom(result.coords, 'C285', 'C283', 'N291'), bondAngleAtAtom(result.coords, 'C285', 'C287', 'N291')];
    assert.ok(maxAngleDeviation(c208Angles, 120) < 1e-6, `expected C208 peptide branch fan to stay trigonal, got ${c208Angles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(c283Angles, 120) < 5.1, `expected C283 peptide branch fan to be polished, got ${c283Angles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(maxAngleDeviation(c285Angles, 120) < 5.1, `expected C285 peptide branch fan to be polished, got ${c285Angles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(result.metadata.timing.totalMs < 125000, `expected residual peptide retouch to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('rotates nearby aromatic sidechain roots to clear residual peptide label overlaps', () => {
    const result = runPipeline(
      parseSMILES(
        'CC[C@H](C)[C@H](NC(=O)CNC(=O)[C@H](CCCNC(=N)N)NC(=O)[C@H](Cc1ccccc1)NC(=O)[C@@H](NC(=O)[C@H](Cc2cnc[nH]2)NC(=O)[C@H](Cc3cnc[nH]3)NC(=O)[C@H](Cc4ccccc4)NC(=O)[C@@H](N)Cc5ccccc5)[C@@H](C)CC)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](Cc6cnc[nH]6)C(=O)N[C@@H](C(C)C)C(=O)NCC(=O)N[C@@H](CCCCN)C(=O)N[C@@H]([C@@H](C)O)C(=O)N[C@@H]([C@@H](C)CC)C(=O)N[C@@H](Cc7cnc[nH]7)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H]([C@@H](C)O)C(=O)NCC(=O)O'
      ),
      {
        suppressH: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 25000, `expected peptide label-overlap retouch to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps lipidated indole peptide sidechains label-clean after large-molecule residual retouch', () => {
    const result = runPipeline(
      parseSMILES(
        'CCCCCCCCCCCCCC(=O)N[C@@H](CCCCN)C(=O)N[C@@H](<[C@@H](C)CC>)C(=O)N[C@@H](CCCCN)C(=O)N[C@@H](<CCCNC(=N)N>)C(=O)N[C@@H](Cc1c[nH]c2ccccc12)C(=O)N[C@@H](Cc3c[nH]c4ccccc34)C(=O)N[C@@H](<CCCNC(=N)N>)C(=O)N'
      ),
      {
        suppressH: true,
        finalLandscapeOrientation: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 15000, `expected lipidated peptide label retouch to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('clears final glycan phosphate terminal-label overlaps after large-molecule retouch', { timeout: 30000 }, () => {
    let finalLabelClearanceMetrics = null;
    const result = runPipeline(
      parseSMILES(
        'C[C@@H]1O[C@@H](<O[C@H]2[C@H](O)[C@H](NC(=O)C)[C@H](O[C@@H]3[C@@H](OP(=O)(O)OC[C@@H](OCCN(C4CCCCC4)C5CCCCC5)C(=O)O)O[C@@H](C(=O)N)[C@@](C)(O)[C@@H]3OC(=O)N)O[C@H]2CO[C@@H]6O[C@@H](CO)[C@@H](O)[C@H](O)[C@@H]6O>)[C@@H](<NC(=O)C>)[C@@H](O)[C@@H]1O[C@@H]7O[C@H](<[C@H](O)[C@H](O)[C@@H]7O>)C(=O)N'
      ),
      {
        suppressH: true,
        finalLandscapeOrientation: true,
        timing: true,
        debug: {
          onStep(label, _description, _coords, metrics) {
            if (label === 'Final Label Clearance') {
              finalLabelClearanceMetrics = metrics;
            }
          }
        }
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(finalLabelClearanceMetrics?.labelOverlapCountAfter ?? 0, 0);
    assert.ok(result.metadata.timing.totalMs < 15000, `expected glycan phosphate label retouch to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps perfluoroalkyl fused triazine sidechains label-clean after mixed placement', () => {
    const result = runPipeline(parseSMILES('FC(F)(F)c1cc(nc2N=CN(Cc3cn(CCC(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F)nn3)C(=O)c12)c4ccccc4'), {
      suppressH: true,
      finalLandscapeOrientation: true,
      timing: true
    });

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.ok(result.metadata.audit.severeOverlapCount <= 5);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 3);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 5000, `expected perfluoroalkyl fused triazine layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps compact purine sugar acid sidechains label-clean after mixed placement', () => {
    const result = runPipeline(parseSMILES('Nc1nc(O)c2ncn([C@@H]3O[C@H]4C[C@@](<CC(=O)O>)(O[C@H]4[C@H]3O)C(=O)O)c2n1'), {
      suppressH: true,
      finalLandscapeOrientation: true,
      timing: true
    });

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 4000, `expected compact purine sugar acid layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps phosphorylated difluoro cyclohexene acid labels clean after mixed cleanup', () => {
    const result = runPipeline(parseSMILES('O[C@H]1[C@@H](<CC(=C[C@H]1OP(=O)(O)O)C(=O)O>)O[C@](<OP(=O)(O)O>)(C(=O)O)C(F)(F)F'), {
      suppressH: true,
      finalLandscapeOrientation: true,
      timing: true
    });

    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 3000, `expected phosphorylated difluoro cyclohexene acid layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps sodium triphosphate nucleosides label-clean after fragment packing', () => {
    const result = runPipeline(parseSMILES('[Na+].[Na+].[Na+].C[C@@H]1O[C@H](<OP(=O)([O-])OP(=O)([O-])OP(=O)([O-])OC[C@H]2O[C@H]([C@H](O)[C@@H]2O)n3cnc4c(O)nc(N)nc34>)[C@H](O)[C@@H](O)[C@@H]1O'), {
      suppressH: true,
      finalLandscapeOrientation: true,
      timing: true
    });

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed', 'acyclic', 'acyclic', 'acyclic']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 3000, `expected sodium triphosphate nucleoside layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('rotates terminal methoxy leaves out of chloropyridyl oxime bond crossings', () => {
    const result = runPipeline(parseSMILES(String.raw`CO\N=C(/c1ccccc1COc2ncc(Cl)cc2Cl)\c3nccn3C`), {
      suppressH: true,
      finalLandscapeOrientation: true,
      timing: true
    });

    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 3000, `expected chloropyridyl oxime layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps aromatic amide nitro trifluoromethyl labels clean after final orientation', () => {
    const result = runPipeline(parseSMILES('CC(=O)Nc1ccc(OCC(C)(O)C(=O)Nc2ccc(c(c2)C(F)(F)F)[N+](=O)[O-])cc1'), {
      suppressH: true,
      finalLandscapeOrientation: true,
      timing: true
    });

    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 3000, `expected aromatic amide nitro trifluoromethyl layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('clears perfluoroaryl sulfonamide terminal fluorine contacts after final retouch', () => {
    const result = runPipeline(parseSMILES('NS(=O)(=O)c1cc(c(NS(=O)(=O)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F)cc1Cl)S(=O)(=O)N'), {
      suppressH: true,
      finalLandscapeOrientation: true,
      timing: true
    });

    assert.equal(result.metadata.primaryFamily, 'isolated-ring');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 3000, `expected perfluoroaryl sulfonamide layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('coordinates adjacent macrocycle chromophore ring exits after final readability retouch', { timeout: 12000 }, () => {
    const result = runPipeline(
      parseSMILES(
        '[H][C@@]12CCCN1C(=O)[C@H](<NC(=O)[C@@H](NC(=O)C1=C3N=C4C(OC3=C(C)C=C1)=C(C)C(=O)C(N)=C4C(=O)N[C@H]1[C@@H](C)OC(=O)[C@H](C(C)C)N(C)C(=O)CN(C)C(=O)[C@]3([H])CCCN3C(=O)[C@H](NC1=O)C(C)C)[C@@H](C)OC(=O)[C@H](C(C)C)N(C)C(=O)CN(C)C2=O>)C(C)C'
      ),
      {
        suppressH: true,
        finalLandscapeOrientation: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 8000, `expected macrocycle chromophore retouch to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps audit-clean macrocycle core cleanup over dirtier protected placement', { timeout: 12000 }, () => {
    const result = runPipeline(
      parseSMILES(
        String.raw`OC(=O)CC[C@H]1\C2=C\C3=N\C(=C(C)/C4=N[C@@H](<[C@@H](CC(O)=O)[C@]4(C)CCC(O)=O>)[C@@]4(C)N\C(=C(C)/C(=N2)[C@]1(C)CC(O)=O)[C@H](<CCC(O)=O>)[C@@]4(C)CC(O)=O)\[C@H](CCC(O)=O)C3(C)C`
      ),
      {
        suppressH: true,
        finalLandscapeOrientation: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.06);
    assert.ok(result.metadata.timing.totalMs < 25000, `expected tetrapyrrole macrocycle layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('clears peptide proline branch residual overlaps and carbonyl label contacts', { timeout: 18000 }, () => {
    const result = runPipeline(
      parseSMILES(
        'CC[C@H](C)[C@H](NC(=O)[C@H](CCC(=O)O)NC(=O)[C@H](CCC(=O)O)NC(=O)[C@H](Cc1ccccc1)NC(=O)[C@H](CC(=O)O)NC(=O)C)C(=O)N2CCC[C@H]2C(=O)N[C@@H](CCC(=O)O)C(=O)N[C@@H](CCC(=O)O)C(=O)N[C@@H](Cc3ccc(OS(=O)(=O)O)cc3)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CCC(=O)N)C(=O)O'
      ),
      {
        suppressH: true,
        finalLandscapeOrientation: true,
        timing: true
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.timing.totalMs < 15000, `expected peptide proline branch layout to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('repairs ultra-large nucleotide phosphate residual label overlaps without final angle-polish churn', { timeout: 60000 }, () => {
    let residualRetouchMetrics = null;
    const result = runPipeline(
      parseSMILES(
        'CO[C@@H]1[C@H](<OP(=O)(O)OC[C@H]2O[C@H]([C@H](OC)[C@@H]2OP(=O)(O)OC[C@H]3O[C@H]([C@H](OC)[C@@H]3OP(=O)(O)OC[C@H]4O[C@H]([C@H](OC)[C@@H]4OP(=O)(O)OC[C@H]5O[C@H]([C@H](OC)[C@@H]5OP(=O)(O)O)N6C=CC(=NC6=O)N)n7cnc8C(=O)NC(=Nc78)N)n9cnc%10C(=O)NC(=Nc9%10)N)N%11C=CC(=NC%11=O)N>)[C@@H](<COP(=O)(O)O[C@@H]%12[C@@H](COP(=O)(O)O[C@@H]%13[C@@H](COP(=O)(O)O[C@@H]%14[C@@H](COP(=O)(O)O[C@@H]%15[C@@H](COP(=O)(O)O[C@@H]%16[C@@H](COP(=O)(O)O[C@@H]%17[C@@H](COP(=O)(O)O[C@@H]%18[C@@H](COP(=O)(O)OP(=O)(O)O[C@@H]%19[C@@H](COP(=O)(O)O[C@@H]%20[C@@H](COP(=O)(O)O[C@@H]%21[C@@H](COP(=O)(O)O[C@@H]%22[C@@H](COP(=O)(O)O[C@@H]%23[C@@H](COP(=O)(O)O[C@H]%24C[C@@H](O[C@@H]%24CN%25NNC(=C%25)CO[C@H]%26CC[C@]%27(C)[C@H]%28CC[C@]%29(C)[C@H](CC[C@H]%29[C@@H]%28CC=C%27C%26)[C@H](C)CCCC(C)C)N%30C=C(C)C(=O)NC%30=O)O[C@H]([C@@H]%23OC)n%31cnc%32c(N)ncnc%31%32)O[C@H]([C@@H]%22OC)N%33C=CC(=NC%33=O)N)O[C@H]([C@@H]%21OC)N%34C=CC(=NC%34=O)N)O[C@H]([C@@H]%20OC)N%35C=CC(=NC%35=O)N)O[C@H]([C@@H]%19OC)n%36cnc%37c(N)ncnc%36%37)O[C@H]([C@@H]%18OC)n%38cnc%39c(N)ncnc%38%39)O[C@H]([C@@H]%17OC)N%40C=CC(=NC%40=O)N)O[C@H]([C@@H]%16OC)n%41cnc%42c(N)ncnc%41%42)O[C@H]([C@@H]%15OC)N%43C=CC(=NC%43=O)N)O[C@H]([C@@H]%14OC)N%44C=CC(=O)NC%44=O)O[C@H]([C@@H]%13OC)n%45cnc%46c(N)ncnc%45%46)O[C@H]([C@@H]%12OC)N%47C=CC(=NC%47=O)N>)O[C@H]1N%48C=CC(=O)NC%48=O'
      ),
      {
        suppressH: true,
        timing: true,
        maxCleanupPasses: 6,
        debug: {
          onStep(label, _description, _coords, metrics) {
            if (label === 'Large Molecule Residual Retouch') {
              residualRetouchMetrics = metrics;
            }
          }
        }
      }
    );

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.ok(result.metadata.audit.severeOverlapCount <= 5);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.ok(result.metadata.audit.visibleHeavyBondCrossingCount <= 3);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(residualRetouchMetrics?.finalAnglePolishPasses, 0);
    assert.ok(result.metadata.timing.totalMs < 50000, `expected nucleotide residual retouch to stay bounded, got ${result.metadata.timing.totalMs}ms`);
  });

  it('keeps overlap-heavy large-molecule packing fast without cleanup stretching backbone bonds', () => {
    const start = Date.now();
    const result = runPipeline(
      parseSMILES(
        'O=C(N[C@@H](CC(C)C)C(N)=O)[C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)=O)CCCC[NH3+]'
      ),
      {
        suppressH: true,
        timing: true
      }
    );
    const elapsed = Date.now() - start;

    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.audit.severeOverlapCount <= 23);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.05);
    assert.ok(result.metadata.timing.placementMs < 6000, `expected overlap-heavy large-molecule packing to avoid runaway rescoring, got ${result.metadata.timing.placementMs}ms`);
    assert.ok(elapsed < 20000, `expected overlap-heavy large-molecule packing to stay under the full-suite host budget, got ${elapsed}ms`);
  });

  it('reports preserved disconnected components during refinement-aware pipeline runs', () => {
    const result = runPipeline(makeDisconnectedEthanes(), {
      existingCoords: new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['c0', { x: 10, y: 3 }],
        ['c1', { x: 11.5, y: 3 }]
      ]),
      touchedAtoms: new Set(['a0'])
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.preservedComponentCount, 1);
    assert.deepEqual(result.coords.get('c0'), { x: 10, y: 3 });
    assert.deepEqual(result.coords.get('c1'), { x: 11.5, y: 3 });
  });

  it('avoids severe overlaps for phosphono amino-acid mixed layouts', () => {
    const result = runPipeline(parseSMILES('C1=CC=C(C=C1)C(C(=O)O)(N)P(=O)(O)O'), {
      suppressH: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps hidden-h mono-oxo phosphonate ligands on a visible trigonal fan', () => {
    const result = runPipeline(parseSMILES('C[C@@H](<NC(=O)CCCC[C@@H](NC(=O)C[NH3+])C([O-])=O>)P([O-])=O'), {
      suppressH: true
    });
    const phosphonateAngles = [bondAngleAtAtom(result.coords, 'P22', 'C2', 'O23'), bondAngleAtAtom(result.coords, 'P22', 'C2', 'O24'), bondAngleAtAtom(result.coords, 'P22', 'O23', 'O24')];

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(maxAngleDeviation(phosphonateAngles, 120) < 1e-6, `expected hidden-h phosphonate ligands to use a trigonal fan, got ${phosphonateAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('keeps bulky diaryl phosphine oxide branches from crossing visible bonds', () => {
    const result = runPipeline(parseSMILES('CCCCP(=O)(C(=O)C1=C(CC)C=C(CC)C=C1CC)C(=O)C1=C(CC)C=C(CC)C=C1CC'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
  });

  it('keeps sodium tetrazole C2 isopropyl branches from crossing neighboring aryl bonds', () => {
    const result = runPipeline(parseSMILES('[Na+].CC(C)n1nnnc1C(=C(c2ccc(F)cc2)c3ccc(F)cc3)\\C=C\\[C@@H](O)C[C@@H](O)CC(=O)[O-]'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
  });

  it('keeps tetraaryl silane ligands on a perfect orthogonal cross', () => {
    const result = runPipeline(parseSMILES('N(C1=CC=CC=C1)C1=CC=C2N(C3=CC=C(C=C3C2=C1)[Si](C1=CC=CC=C1)(C1=CC=CC=C1)C1=CC=CC=C1)C1=CC=CC=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const siliconAtom = [...result.layoutGraph.atoms.values()].find(atom => atom.element === 'Si');
    assert.ok(siliconAtom);
    const ligandAngles = (result.layoutGraph.bondsByAtomId.get(siliconAtom.id) ?? [])
      .map(bond => (bond.a === siliconAtom.id ? bond.b : bond.a))
      .filter(atomId => result.layoutGraph.atoms.get(atomId)?.element !== 'H')
      .map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(siliconAtom.id))));

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords) < 1e-9);
    assert.equal(ligandAngles.length, 4);
    assertOrthogonalCross(ligandAngles, 'tetraaryl Si21');
  });

  it('keeps mixed alkyl aryl silane ligands on a perfect orthogonal cross', () => {
    const result = runPipeline(parseSMILES('C[Si](<CCC(=O)NC(=O)C1CCC2=CC=CC=C12>)(C1=CC=CC=C1)C1=CC=CC=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const siliconAtom = [...result.layoutGraph.atoms.values()].find(atom => atom.element === 'Si');
    assert.ok(siliconAtom);
    const ligandAngles = (result.layoutGraph.bondsByAtomId.get(siliconAtom.id) ?? [])
      .map(bond => (bond.a === siliconAtom.id ? bond.b : bond.a))
      .filter(atomId => result.layoutGraph.atoms.get(atomId)?.element !== 'H')
      .map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(siliconAtom.id))));

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords) < 1e-9);
    assert.equal(ligandAngles.length, 4);
    assertOrthogonalCross(ligandAngles, 'mixed alkyl aryl Si2');
  });

  it('keeps acyclic silane and quaternary ammonium ligands on projected four-slot fans', () => {
    const result = runPipeline(parseSMILES('CO[Si](C)(CCCOCC(O)C[N+](C)(CCC[N+](C)(C)C)CCC[N+](C)(C)C)OC'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const siliconAngles = ['C4', 'C5', 'O29', 'O2'].map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get('Si3'))));
    const ammoniumAngles = ['C14', 'C15', 'C22', 'C12'].map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get('N13'))));

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'acyclic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assertOrthogonalCross(siliconAngles, 'acyclic Si3');
    assertOrthogonalCross(ammoniumAngles, 'acyclic N13');
  });

  it('keeps tert-butyl sulfone carbon leaves on projected four-slot fans', () => {
    const result = runPipeline(parseSMILES('CCCNS(=O)(=O)C(C)(C)C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const sulfoneAngles = ['O6', 'O7', 'C8', 'N4'].map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get('S5'))));
    const tertButylAngles = ['S5', 'C9', 'C10', 'C11'].map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get('C8'))));

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'acyclic');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assertOrthogonalCross(sulfoneAngles, 'acyclic S5');
    assertOrthogonalCross(tertButylAngles, 'tert-butyl C8');
  });

  it('rotates crowded aryl sulfonic acid connector subtrees so final sulfur fans stay exact', () => {
    const result = runPipeline(
      parseSMILES(
        'CC1=C(NC(=O)C2=CC(NC(=O)NC3=CC=CC(=C3)C(=O)NC3=C(C)C=CC(=C3)C(=O)NC3=C4C(C=C(C=C4S(O)(=O)=O)S(O)(=O)=O)=C(C=C3)S(O)(=O)=O)=CC=C2)C=C(C=C1)C(=O)NC1=C2C(C=C(C=C2S(O)(=O)=O)S(O)(=O)=O)=C(C=C1)S(O)(=O)=O'
      ),
      {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      }
    );

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'large-molecule');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords) < 1e-6, 'expected connector rotation to restore exact sulfonic acid hypervalent angles');
    assert.ok(measureRingAnchoredHypervalentBranchDeviation(result.layoutGraph, result.coords).maxDeviation < 1e-6, 'expected crowded aryl sulfonic acid branches to stay on their ring-outward axes');

    for (const [centerAtomId, ligandAtomIds] of [
      ['S40', ['C39', 'O41', 'O42', 'O43']],
      ['S44', ['C37', 'O45', 'O46', 'O47']],
      ['S51', ['C48', 'O52', 'O53', 'O54']],
      ['S72', ['C71', 'O73', 'O74', 'O75']],
      ['S76', ['C69', 'O77', 'O78', 'O79']],
      ['S83', ['C80', 'O84', 'O85', 'O86']]
    ]) {
      assertOrthogonalCross(
        ligandAtomIds.map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get(centerAtomId)))),
        `aryl sulfonic acid ${centerAtomId}`
      );
    }
  });

  it('keeps compact aryl phosphate alkyl tails from folding back into neighboring rings', () => {
    const result = runPipeline(parseSMILES('CCCC1=CC=CC(CC#C)=C1OP(=O)(OC1=C(CCC)C=CC=C1CC#C)OC1=C(CCC)C=CC=C1CC#C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    const phosphateLinkerAngles = [bondAngleAtAtom(result.coords, 'O13', 'P14', 'C12'), bondAngleAtAtom(result.coords, 'O16', 'P14', 'C17'), bondAngleAtAtom(result.coords, 'O29', 'P14', 'C30')];
    assert.ok(Math.min(...phosphateLinkerAngles) >= 135 - 1e-6, `expected phosphate P-O-C spokes to stay broadly straight, got ${phosphateLinkerAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(
      phosphateLinkerAngles.filter(angle => angle >= 150 - 1e-6).length === 3 && phosphateLinkerAngles.some(angle => angle >= 165 - 1e-6),
      `expected phosphate P-O-C spokes to remain broadly linear with one near-linear spoke, got ${phosphateLinkerAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C3', 'C2', 'C4') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C18', 'C17', 'C19') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C18', 'C19', 'C22') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C38', 'C30', 'C39') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C38', 'C37', 'C39') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C19', 'C18', 'C20') - 120) < 1e-6);
    assert.ok(Math.abs(bondAngleAtAtom(result.coords, 'C39', 'C38', 'C40') - 120) < 1e-6);
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
  });

  it('keeps the trisodium anthraquinone propionate sidechain at a clean C37 zigzag angle', () => {
    const result = runPipeline(parseSMILES('[Na+].[Na+].[Na+].CCc1cc(C(=O)C)c([O-])cc1OCCCOc2ccc3C(=O)c4cc(ccc4Oc3c2CCC(=O)[O-])C(=O)[O-]'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const sidechainAngle = bondAngleAtAtom(result.coords, 'C37', 'C36', 'C38');

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(Math.abs(sidechainAngle - 120) < 1e-6, `expected C36-C37-C38 to stay at 120 degrees, got ${sidechainAngle.toFixed(2)}`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps linked sugar phosphates clean after the late ring and hypervalent touchups', () => {
    const result = runPipeline(parseSMILES('O[C@H]1[C@H](OP(O)(O)=O)[C@H](OP(O)(O)=O)[C@@H](OP(O)(O)=O)[C@@H](OP(O)(O)=O)[C@@H]1OP(O)(O)=O'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps diazatricyclodecane carbamate branches placed outside the cage', () => {
    const result = runPipeline(parseSMILES('CC(C)OC(=O)N1C2CC3CC1CC(C2)N3c4ncnc(Oc5ccc(cc5)n6cnnn6)c4C'), {
      suppressH: true,
      auditTelemetry: true
    });
    const cageAtomIds = new Set(['N7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'N16']);
    const visibleHeavyBondCrossings = findVisibleHeavyBondCrossings(result.layoutGraph, result.coords);

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.unplacedComponentCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    for (const carbamateAtomId of ['C1', 'C2', 'C3', 'O4', 'C5', 'O6']) {
      assert.ok(result.coords.has(carbamateAtomId), `expected carbamate atom ${carbamateAtomId} to remain placed`);
    }
    assert.ok(
      visibleHeavyBondCrossings.every(crossing => crossing.firstAtomIds.every(atomId => cageAtomIds.has(atomId)) && crossing.secondAtomIds.every(atomId => cageAtomIds.has(atomId))),
      `expected any remaining crossing to stay internal to the compact cage, got ${visibleHeavyBondCrossings.map(crossing => `${crossing.firstAtomIds.join('-')}/${crossing.secondAtomIds.join('-')}`).join(', ')}`
    );
  });

  it('keeps triazaadamantane thiourea cages overlap-free and uncrossed', () => {
    const result = runPipeline(parseSMILES('COc1ccccc1N=C(S)NC23CN4CN(CN(C4)C2)C3'), {
      suppressH: true,
      auditTelemetry: true
    });
    const exposedCarbonAngles = [
      angularDifference(angleOf(sub(result.coords.get('C13'), result.coords.get('C14'))), angleOf(sub(result.coords.get('N15'), result.coords.get('C14')))) * (180 / Math.PI),
      angularDifference(angleOf(sub(result.coords.get('C13'), result.coords.get('C22'))), angleOf(sub(result.coords.get('N17'), result.coords.get('C22')))) * (180 / Math.PI)
    ];

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(
      exposedCarbonAngles.every(angle => angle < 160),
      `expected C14/C22 to remain visible cage vertices, got ${exposedCarbonAngles.map(angle => angle.toFixed(1)).join(', ')}`
    );
    assert.deepEqual(findVisibleHeavyBondCrossings(result.layoutGraph, result.coords), []);
  });

  it('keeps steroid mixed layouts audit-clean without forcing the ester root into a large cleanup swing', () => {
    const result = runPipeline(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'), {
      suppressH: true,
      auditTelemetry: true
    });
    const preferredRootAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, 'C31');
    const actualRootAngle = angleOf(sub(result.coords.get('C32'), result.coords.get('C31')));

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok((result.metadata.stageTelemetry?.stageAudits.placement.severeOverlapCount ?? 0) <= 1);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.notEqual(preferredRootAngle, null);
    assert.ok(angularDifference(actualRootAngle, preferredRootAngle) <= Math.PI / 6 + 1e-6, 'expected the ester root to stay within 30 degrees of the local outward ring direction after cleanup');
  });

  it('keeps the reported steroid methyl outside and aligns the fluorine with the fused junction', () => {
    const result = runPipeline(parseSMILES('[H][C@@]12C[C@@]3([H])[C@]4([H])C[C@]([H])(F)C5=CC(=O)C=C[C@]5(C)[C@@]4(F)[C@@H](O)C[C@]3(C)[C@@]1(OC(C)(C)O2)C(=O)COC(C)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const leafInsideIncidentRing = (anchorAtomId, leafAtomId) =>
      (result.layoutGraph.atomToRings.get(anchorAtomId) ?? []).some(ring =>
        pointInPolygon(
          result.coords.get(leafAtomId),
          ring.atomIds.map(atomId => result.coords.get(atomId))
        )
      );

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(leafInsideIncidentRing('C18', 'C19'), false);
    assert.equal(leafInsideIncidentRing('C20', 'F21'), false);
    assert.ok(
      angularDifference(angleOf(sub(result.coords.get('F21'), result.coords.get('C20'))), angleOf(sub(result.coords.get('C20'), result.coords.get('C6')))) < 1e-6,
      'expected F21 to continue straight off the C6-C20 fused junction'
    );
  });

  it('relaxes cyclic fused mixed scaffolds so re-entrant fused edges do not overstretch aromatic bonds', () => {
    const result = runPipeline(parseSMILES('CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C'), {
      suppressH: true
    });
    const aromaticSixRing = ['C17', 'C18', 'C19', 'C20', 'C21', 'C16'];
    const aromaticAngles = ringAngles(result.coords, aromaticSixRing);

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
    assert.ok(Math.max(...aromaticAngles) - Math.min(...aromaticAngles) < 12);
  });

  it('keeps pericondensed heteroaromatic ketone rings strict on a fused hex lattice', () => {
    const result = runPipeline(parseSMILES('Nc1ccc2nc3C(=O)c4cccnc4c5nccc(c35)c2c1Br'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const allRingAngles = result.layoutGraph.rings.flatMap(ring => ringAngles(result.coords, ring.atomIds));
    const allRingLengths = result.layoutGraph.rings.flatMap(ring => ringBondLengths(result.coords, ring.atomIds));
    const maxRingBondDeviation = Math.max(...allRingLengths.map(length => Math.abs(length - result.layoutGraph.options.bondLength)));

    assert.equal(result.metadata.primaryFamily, 'fused');
    assert.equal(result.metadata.mixedMode, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(maxRingBondDeviation < 1e-9);
    assert.ok(maxAngleDeviation(allRingAngles, 120) < 1e-9, `expected fused rings to stay strict, got ${allRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('keeps glycopeptide macrocycle closures covered during large-molecule layout', () => {
    const result = runPipeline(parseSMILES(GLYCOPEPTIDE_MACROCYCLE_SMILES), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const supplementalClosureRing = result.layoutGraph.rings.find(ring => ring.supplemental === true && ring.atomIds.includes('C36') && ring.atomIds.includes('C53'));
    const closureLength = distance(result.coords.get('C36'), result.coords.get('C53'));

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'macrocycle');
    assert.deepEqual(result.metadata.placedFamilies, ['large-molecule']);
    assert.ok(supplementalClosureRing, 'expected the hidden C36-C53 closure to be represented as a supplemental ring');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.fallback.mode, null);
    assert.ok(
      Math.abs(closureLength - result.layoutGraph.options.bondLength) < result.layoutGraph.options.bondLength * 0.05,
      `expected the hidden macrocycle closure to stay at normal bond length, got ${closureLength.toFixed(3)}`
    );
  });

  it('keeps the latest 20260516 label-overlap audit batch clean', () => {
    const cases = [
      'CC(C)C(=O)[N+]1=C2C(=O)NC(=O)N=C2N(C[C@@H](O)[C@@H](O)[C@H](O)CO[P@]([O-])(=O)O[P@@](O)(=O)OC[C@@H]2O[C@H](<[C@H](O)[C@H]2O>)N2C=NC3=C2N=CN=C3N)C2=CC(C)=C(C)C=C12',
      'CC1=CN([C@@H]2C[C@H](N=[N+]=[N-])[C@@H](<CO[P@]([O-])(=O)O[P@@]([O-])(=O)O[P@]([O-])(=O)O[P@@]([O-])(=O)O[P@@]([O-])(=O)OC[C@@H]3O[C@H]([C@H](O)[C@H]3O)N3C=NC4=C3N=CN=C4N>)O2)C(=O)NC1=O',
      '[Ta]1234567[Br][Ta]1189%10%11[Br][Ta]2112%12%13%14([Ta]33([Br]4)([Br]1)[Ta]821([Br][Ta]5931([Br]%12)([Br]6)[Br]%10)([Br]%13)([Br]%14)[Br]%11)[Br]7',
      'CC1=C(CCO[P@]([O-])(=O)O[P@@]([O-])(=O)OC[C@@H]2O[C@H](<[C@H](O)[C@H]2O>)N2C=NC3=C2N=CN=C3N)SC(=N1)C([O-])=O',
      '[O--][Mo+6]123([O--])[O--][Mo+6]45([O--])([O--])[O--][Mo+6]67([O--])([O--])[O--][Mo+6]89([O--])([O--])[O--][Mo+6]%10%11([O--])([O--])[O--][Mo+6]%12([O--])([O--])([O--]1)[O--]%10[Mo+6]([O--]2)([O--]8)([O--]46)([O--]35%12)[O--]79%11'
    ];

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears the next 20260516 label-overlap audit entries', { timeout: 60000 }, () => {
    const cases = [
      {
        smiles: bugMolecules.find(smiles => smiles.startsWith('[H][C@]12OC3([O-])OC(C4C(O)[NH+]=C(N)NC4')),
        requireCleanAudit: true
      },
      {
        smiles: bugMolecules.find(smiles => smiles.startsWith('FC1=C(CN2C(=O)C3=CC=CN3')),
        requireCleanAudit: true
      },
      {
        smiles: bugMolecules.find(smiles => smiles.startsWith('CC[C@H](C)[C@H](<NC(=O)[C@H](CCC(N)=O)')),
        requireCleanAudit: false
      },
      {
        smiles: bugMolecules.find(smiles => smiles.startsWith('[H]C1(CC([H])(OP(O)(=S)OCC2')),
        requireCleanAudit: false
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'FC(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)Br'),
        requireCleanAudit: true
      }
    ];

    assert.equal(
      cases.every(({ smiles }) => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases.map(({ smiles }) => smiles)).size, cases.length);

    for (const { smiles, requireCleanAudit } of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.labelOverlapCount, 0, `expected label-overlap audit to clear for ${smiles}`);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0, `expected no bond failures for ${smiles}`);
      if (requireCleanAudit) {
        assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
        assert.equal(result.metadata.audit.severeOverlapCount, 0);
        assert.equal(result.metadata.audit.fallback.mode, null);
      }
    }
  });

  it('clears the following 20260516 label-overlap audit entries', () => {
    const cases = [
      bugMolecules.find(smiles => smiles.startsWith('CC(=O)NC1=CC=C(OC[C@](C)(O)C(=O)NC2=CC')),
      bugMolecules.find(smiles => smiles.startsWith('OC(COC1=CC=CC(=C1)C1=CC=CC')),
      bugMolecules.find(smiles => smiles.startsWith('COC(=O)C1=C(C)NC(C)=C(C1C1=CC=CC=C1')),
      bugMolecules.find(smiles => smiles === 'NCCCCCC(O)(P(O)(O)=O)P(O)(O)=O'),
      bugMolecules.find(smiles => smiles === 'C1OC2C3OCC12CO3')
    ];

    assert.equal(
      cases.every(smiles => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases).size, cases.length);

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears compact bridged 20260516 label-overlap audit entries', () => {
    const cases = [
      bugMolecules.find(smiles => smiles === 'CC1C[NH+]2CC(C)C1C1=C(C2)C=NO1'),
      bugMolecules.find(smiles => smiles === 'OC1C2CNC(=O)C1O2'),
      bugMolecules.find(smiles => smiles === '[NH3+]C1C2COC(=O)C11OCOC21'),
      bugMolecules.find(smiles => smiles === 'CC1(O)CC2C([NH3+])CC1N1N=CN=C21'),
      bugMolecules.find(smiles => smiles === 'C[NH+]1CCC2OC(C)(C)OC(C1)C2(C)CO')
    ];

    assert.equal(
      cases.every(smiles => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases).size, cases.length);

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears the next compact bridged 20260516 label-overlap batch', () => {
    const cases = [
      bugMolecules.find(smiles => smiles === 'CCC12CCOCC(C)(CCC[NH2+]1)C2'),
      bugMolecules.find(smiles => smiles === 'CC1COC2(C)CC(C)(O1)C(=O)CC(O2)C#C'),
      bugMolecules.find(smiles => smiles === 'CCC1C(O)C=CC1C1OC2CS(=O)(=O)C1O2'),
      bugMolecules.find(smiles => smiles === 'CCC1(C)C(NC)C2NCC1(O)C(OC)C2=O'),
      bugMolecules.find(smiles => smiles === 'CCC(CC#N)OC1(C)C2OC(C)C(O2)C1=O')
    ];

    assert.equal(
      cases.every(smiles => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases).size, cases.length);

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears the sulfonyl compact 20260516 label-overlap batch', () => {
    const cases = [
      bugMolecules.find(smiles => smiles === 'CN1CCC2(OC2CC(C)=O)S(=O)(=O)S1(=O)=O'),
      bugMolecules.find(smiles => smiles === 'CCC12OCC(N)(CNS1(=O)=O)C1=NSN=C21'),
      bugMolecules.find(smiles => smiles === 'CC1C(C)=CN(C)S(=O)(=O)C1(N)CCCO'),
      bugMolecules.find(smiles => smiles === 'CCC1=C(C#C)S(=O)(=O)S(=O)(=O)N=C(C)C=N1'),
      bugMolecules.find(smiles => smiles === 'CC1CNC2C1C(C)C1=CNS(=O)(=O)C21O')
    ];

    assert.equal(
      cases.every(smiles => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases).size, cases.length);

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears the following sulfonyl compact 20260516 label-overlap batch', () => {
    const cases = [
      bugMolecules.find(smiles => smiles === 'CC(OC(=O)C#N)C1(O)C=CCNS1(=O)=O'),
      bugMolecules.find(smiles => smiles === 'CC1OCS(=O)(=O)C2(O)CC=C(CC=O)C12'),
      bugMolecules.find(smiles => smiles === 'CCC1(C)OC2(CO)CC2(O)S(=O)(=O)C1NC'),
      bugMolecules.find(smiles => smiles === 'CCC(=O)S(=O)(=O)NCS(=O)(=O)C(C)NC=O'),
      bugMolecules.find(smiles => smiles === 'CC12OC(=N)C(N)(C1N1C=COC1=N)C(=N)O2')
    ];

    assert.equal(
      cases.every(smiles => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases).size, cases.length);

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears organotin and perfluoro 20260516 label-overlap audit entries', () => {
    const cases = [
      bugMolecules.find(smiles => smiles === 'CCS(=O)(=O)C1=CC(=CC=C1C(O)C(=O)OCC1=CC=CC=C1)C1=CC=CC=C1'),
      bugMolecules.find(smiles => smiles === '[O-]C(=O)[C-](<C(F)(F)F>)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F'),
      bugMolecules.find(smiles => smiles === 'CCCCC(CC)CO[Sn](CCCC)(OCC(CC)CCCC)O[Sn](CCCC)(CCCC)CCCC'),
      bugMolecules.find(smiles => smiles === 'CCCCC1COC(OC1)C1=CC=C(C=C1)C(=O)OC1=CC=C(OCC(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F)C=C1'),
      bugMolecules.find(smiles => smiles === 'CC(OC(C)C(F)(F)C(F)(F)C(F)(F)F)C(F)(F)C(F)(F)C(F)(F)F')
    ];

    assert.equal(
      cases.every(smiles => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases).size, cases.length);

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears the next five 20260516 label-overlap audit entries', { timeout: 60000 }, () => {
    const cases = [
      {
        smiles: bugMolecules.find(smiles => smiles === 'CC1=CC=C(C(NC(=O)C2(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C2(F)F)=C1)N(=O)=O'),
        requireCleanAudit: true
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'FC(F)(F)C1=CC=CC=C1C1=C(Cl)C=CC(C=O)=C1OCC1=CC=CC=C1'),
        requireCleanAudit: true
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'CC(C)(C)N[PH+](N1CCCC1)N(=P(N1CCCC1)(N1CCCC1)N1CCCC1)=P(N1CCCC1)(N1CCCC1)N1CCCC1'),
        requireCleanAudit: false
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'NC1=CC=CC(=C1)C1(O)C2CCC1C[NH+](CC1=CC=C3C=CC=CC3=C1)C2'),
        requireCleanAudit: false
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'FC(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)CS(=O)(=O)OCCCOS(=O)(=O)CC(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)F'),
        requireCleanAudit: true
      }
    ];

    assert.equal(
      cases.every(({ smiles }) => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases.map(({ smiles }) => smiles)).size, cases.length);

    for (const { smiles, requireCleanAudit } of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.labelOverlapCount, 0, `expected label-overlap audit to clear for ${smiles}`);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0, `expected no bond failures for ${smiles}`);
      if (requireCleanAudit) {
        assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
        assert.equal(result.metadata.audit.severeOverlapCount, 0);
        assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
        assert.equal(result.metadata.audit.fallback.mode, null);
      }
    }
  });

  it('clears acyclic acyl and perfluoro 20260516 label-overlap audit entries', () => {
    const cases = [
      bugMolecules.find(smiles => smiles === 'CCCCCC(CC)C(CC([O-])=O)(C([O-])=O)S([O-])(=O)=O'),
      bugMolecules.find(smiles => smiles === 'FN(F)C(F)(C(F)(F)F)C(F)(N(F)F)C(F)(F)F'),
      bugMolecules.find(smiles => smiles === 'CC(=O)OC(CC(=O)OCC=C)(CC(=O)OCC=C)C(=O)OCC=C'),
      bugMolecules.find(smiles => smiles === 'CCN(CCOC(=O)C=C)S(=O)(=O)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F'),
      bugMolecules.find(smiles => smiles === 'CC(=O)C(CS)(CCC([O-])=O)C([O-])=O')
    ];

    assert.equal(
      cases.every(smiles => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases).size, cases.length);

    for (const smiles of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.fallback.mode, null);
    }
  });

  it('clears the current top five label-overlap audit entries', { timeout: 60000 }, () => {
    const cases = [
      {
        smiles: bugMolecules.find(smiles => smiles === 'CC(=C)C(=O)OC(OCCCCC(F)(F)C(F)(F)S([O-])(=O)=O)(C(=O)OCC1=CC=CC=C1)C(F)(F)F'),
        requireCleanAudit: true
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'CCOC(=O)C(=C)CCCCOCC([O-])(C(F)(F)F)C(F)(F)F'),
        requireCleanAudit: true
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'CC(C)C(NC(=O)CCC1=CC=CC=C1)P([O-])(=O)CC(C([O-])=O)C1=CC=CC(C[NH3+])=C1'),
        requireCleanAudit: true
      },
      {
        smiles: bugMolecules.find(
          smiles =>
            smiles ===
            'CO[C@@H]1[C@H](OP(=O)(O)OC[C@H]2O[C@H]([C@H](OC)[C@@H]2OP(=O)(O)OC[C@H]3O[C@H]([C@H](OC)[C@@H]3OP(=O)(O)OC[C@H]4O[C@H]([C@H](OC)[C@@H]4OP(=O)(O)OC[C@H]5O[C@H]([C@H](OC)[C@@H]5OP(=O)(O)O)N6C=CC(=NC6=O)N)n7cnc8C(=O)NC(=Nc78)N)n9cnc%10C(=O)NC(=Nc9%10)N)N%11C=CC(=NC%11=O)N)[C@@H](COP(=O)(O)O[C@@H]%12[C@@H](COP(=O)(O)O[C@@H]%13[C@@H](COP(=O)(O)O[C@@H]%14[C@@H](COP(=O)(O)O[C@@H]%15[C@@H](COP(=O)(O)O[C@@H]%16[C@@H](COP(=O)(O)O[C@@H]%17[C@@H](COP(=O)(O)O[C@@H]%18[C@@H](COP(=O)(O)OP(=O)(O)O[C@@H]%19[C@@H](COP(=O)(O)O[C@@H]%20[C@@H](COP(=O)(O)O[C@@H]%21[C@@H](COP(=O)(O)O[C@@H]%22[C@@H](COP(=O)(O)O[C@@H]%23[C@@H](COP(=O)(O)O[C@H]%24C[C@@H](O[C@@H]%24CN%25NNC(=C%25)CO[C@H]%26CC[C@]%27(C)[C@H]%28CC[C@]%29(C)[C@H](CC[C@H]%29[C@@H]%28CC=C%27C%26)[C@H](C)CCCC(C)C)N%30C=C(C)C(=O)NC%30=O)O[C@H]([C@@H]%23OC)n%31cnc%32c(N)ncnc%31%32)O[C@H]([C@@H]%22OC)N%33C=CC(=NC%33=O)N)O[C@H]([C@@H]%21OC)N%34C=CC(=NC%34=O)N)O[C@H]([C@@H]%20OC)N%35C=CC(=NC%35=O)N)O[C@H]([C@@H]%19OC)n%36cnc%37c(N)ncnc%36%37)O[C@H]([C@@H]%18OC)n%38cnc%39c(N)ncnc%38%39)O[C@H]([C@@H]%17OC)N%40C=CC(=NC%40=O)N)O[C@H]([C@@H]%16OC)n%41cnc%42c(N)ncnc%41%42)O[C@H]([C@@H]%15OC)N%43C=CC(=NC%43=O)N)O[C@H]([C@@H]%14OC)N%44C=CC(=O)NC%44=O)O[C@H]([C@@H]%13OC)n%45cnc%46c(N)ncnc%45%46)O[C@H]([C@@H]%12OC)N%47C=CC(=NC%47=O)N)O[C@H]1N%48C=CC(=O)NC%48=O'
        ),
        requireCleanAudit: false
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'CO\\N=C(/c1ccccc1COc2ncc(Cl)cc2Cl)\\c3nccn3C'),
        requireCleanAudit: true
      }
    ];

    assert.equal(
      cases.every(({ smiles }) => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases.map(({ smiles }) => smiles)).size, cases.length);

    for (const { smiles, requireCleanAudit } of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.stereoContradictionCount ?? 0, 0);
      if (requireCleanAudit) {
        assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
        assert.equal(result.metadata.audit.severeOverlapCount, 0);
        assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
        assert.equal(result.metadata.audit.fallback.mode, null);
      }
    }
  });

  it('clears the remaining 20260518 label-overlap audit entries', { timeout: 60000 }, () => {
    const cases = [
      {
        smiles: bugMolecules.find(smiles => smiles === 'CC1=C(CCC(O)=O)C2=CC3=C(CCC(O)=O)C(C)=C4C=C5[N+]6=C(C=C7[N+]8=C(C=C1N2[Fe@]68N34)C(=O)[C@@]7(C)CC(O)=O)C(=O)[C@]5(C)CC(O)=O'),
        requireCleanAudit: false
      },
      {
        smiles: bugMolecules.find(
          smiles =>
            smiles ===
            '[H]C1(CC([H])(OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(CC2([H])OP(O)(=S)OCC2([H])OC([H])(N3C=NC4=C3NC(=N)N=C4O)C([H])(OCCOC)C2([H])OP(O)(=S)OCC2([H])OC([H])(N3C=C(C)C(=N)N=C3O)C([H])(OCCOC)C2([H])OP(O)(=S)OCC2([H])OC([H])(N3C=NC4=C(N)N=CN=C34)C([H])(OCCOC)C2([H])OP(O)(=S)OCC2([H])OC([H])(N3C=C(C)C(=N)N=C3O)C([H])(OCCOC)C2([H])OP(O)(=S)OCC2([H])OC([H])(N3C=C(C)C(=N)N=C3O)C([H])(OCCOC)C2([H])O)N2C=C(C)C(=N)N=C2O)N2C=C(C)C(O)=NC2=O)N2C=C(C)C(O)=NC2=O)N2C=C(C)C(=N)N=C2O)N2C=NC3=C2NC(=N)N=C3O)N2C=C(C)C(O)=NC2=O)N2C=C(C)C(=N)N=C2O)N2C=C(C)C(O)=NC2=O)C([H])(COP(O)(=S)OC2([H])CC([H])(OC2([H])COP(O)(=S)OC2([H])C([H])(COP(O)(=S)OC3([H])C([H])(COP(O)(=S)OC4([H])C([H])(COP(O)(=S)OC5([H])C([H])(COP(O)(=S)OC6([H])C([H])(CO)OC([H])(N7C=NC8=C7NC(=N)N=C8O)C6([H])OCCOC)OC([H])(N6C=C(C)C(=N)N=C6O)C5([H])OCCOC)OC([H])(N5C=C(C)C(=N)N=C5O)C4([H])OCCOC)OC([H])(N4C=C(C)C(O)=NC4=O)C3([H])OCCOC)OC([H])(N3C=C(C)C(=N)N=C3O)C2([H])OCCOC)N2C=NC3=C(N)N=CN=C23)O1)N1C=NC2=C1NC(=N)N=C2O'
        ),
        requireCleanAudit: false
      },
      {
        smiles: bugMolecules.find(smiles => smiles === 'CN1CC2=CC=CC(NC3=CC=NC(NC4=CC(Cl)=CC=C4OCCNC(=O)C1)=N3)=C2'),
        requireCleanAudit: true
      }
    ];

    assert.equal(
      cases.every(({ smiles }) => typeof smiles === 'string'),
      true
    );
    assert.equal(new Set(cases.map(({ smiles }) => smiles)).size, cases.length);

    for (const { smiles, requireCleanAudit } of cases) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.audit.labelOverlapCount, 0, `expected label-overlap audit to clear for ${smiles}`);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0, `expected no bond failures for ${smiles}`);
      if (requireCleanAudit) {
        assert.equal(result.metadata.audit.ok, true, `expected clean audit for ${smiles}`);
        assert.equal(result.metadata.audit.severeOverlapCount, 0);
        assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
        assert.equal(result.metadata.audit.fallback.mode, null);
      }
    }
  });
});
