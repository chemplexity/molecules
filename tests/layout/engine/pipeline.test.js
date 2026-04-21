import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../src/core/Molecule.js';
import { parseSMILES } from '../../../src/io/smiles.js';
import { auditLayout } from '../../../src/layout/engine/audit/audit.js';
import { angleOf, angularDifference, centroid, sub } from '../../../src/layout/engine/geometry/vec2.js';
import { computeBounds } from '../../../src/layout/engine/geometry/bounds.js';
import { createLayoutGraphFromNormalized } from '../../../src/layout/engine/model/layout-graph.js';
import { normalizeOptions } from '../../../src/layout/engine/options.js';
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
 * Returns the smaller bond angle at one center atom in degrees.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstNeighborAtomId - First neighbor atom ID.
 * @param {string} secondNeighborAtomId - Second neighbor atom ID.
 * @returns {number} Smaller bond angle in degrees.
 */
function bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  return angularDifference(
    angleOf(sub(coords.get(firstNeighborAtomId), coords.get(centerAtomId))),
    angleOf(sub(coords.get(secondNeighborAtomId), coords.get(centerAtomId)))
  ) * (180 / Math.PI);
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
  const anchorRingCount = layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0;
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
    assert.equal(typeof result.metadata.timing.labelClearanceMs, 'number');
    assert.equal(typeof result.metadata.timing.stereoMs, 'number');
    assert.equal(typeof result.metadata.timing.auditMs, 'number');
    assert.ok(result.metadata.timing.totalMs >= 0);
    assert.ok(result.metadata.timing.placementMs >= 0);
    assert.ok(result.metadata.timing.cleanupMs >= 0);
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
    assert.equal(typeof result.metadata.stageTelemetry.selectedStage, 'string');
    assert.ok(result.metadata.stageTelemetry.stageAudits.placement);
    assert.ok(result.metadata.stageTelemetry.stageAudits[result.metadata.stageTelemetry.selectedStage]);
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
    assert.ok(result.metadata.audit.bondLengthFailureCount > 0);
  });

  it('avoids catastrophic bridge projection on dense mixed bridged cages', () => {
    const result = runPipeline(
      parseSMILES(
        'COC(=O)C1=C2Nc3ccccc3[C@@]24CCN5[C@@H]6O[C@]78[C@H]9C[C@]%10%11CCO[C@H]%10CCN%12CC[C@]7([C@H]%11%12)c%13cccc(OC)c%13N8C[C@]6(C9)[C@@H]%14OCC[C@]%14(C1)[C@@H]45'
      ),
      { suppressH: true }
    );

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= 1);
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.7);
    assert.ok(result.metadata.cleanupPostHookNudges > 0);
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
      if ((result.layoutGraph.atomToRings.get(atomId)?.length ?? 0) !== 1) {
        continue;
      }
      const atom = result.layoutGraph.atoms.get(atomId);
      if (!atom || atom.aromatic || atom.heavyDegree !== 3) {
        continue;
      }
      const oxygenChildren = (result.layoutGraph.bondsByAtomId.get(atomId) ?? [])
        .filter(bond => !bond.inRing && bond.kind === 'covalent' && !bond.aromatic && (bond.order ?? 1) === 1)
        .map(bond => (bond.a === atomId ? bond.b : bond.a))
        .filter(childAtomId => (result.layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) === 0 && result.layoutGraph.atoms.get(childAtomId)?.element === 'O');
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

    const etherAngle = coords =>
      angularDifference(angleOf(sub(coords.get(heavyNeighborIds[0]), coords.get(oxygenAtom.id))), angleOf(sub(coords.get(heavyNeighborIds[1]), coords.get(oxygenAtom.id))));

    assert.ok(Math.abs(etherAngle(result.coords) - (2 * Math.PI) / 3) < 1e-6);
    assert.ok(Math.abs(etherAngle(result.coords) - etherAngle(placement.coords)) < 1e-6);
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
    assert.equal(result.metadata.stageTelemetry.selectedGeometryStage, 'placement');
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

  it('lets cleanup clear crowded geminal alkyl-branch overlaps on protonated acyclic centers', () => {
    const result = runPipeline(parseSMILES('CCC(CC)([NH2+]C(CC)(CC)C(C[SiH3])OC)C(C[SiH3])OC'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.primaryFamily, 'acyclic');
    assert.equal(result.metadata.stageTelemetry.stageAudits.placement.severeOverlapCount, 1);
    assert.equal(result.metadata.stageTelemetry.stageAudits.cleanup.severeOverlapCount, 0);
    assert.equal(result.metadata.stageTelemetry.selectedGeometryStage, 'cleanup');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps crowded methyl branches overlap-free without distorting the tertiary amine spread after cleanup', () => {
    const { result } = inspectPlacementAndFinalAudit('CCC1(C)OC2=C3C(NCC13N(C)C)=C(O)N2', { suppressH: true, auditTelemetry: true });
    const finalFirstClearance = nearestHeavyBondDistance(result.layoutGraph, result.coords, 'N12', 'C13');
    const finalSecondClearance = nearestHeavyBondDistance(result.layoutGraph, result.coords, 'N12', 'C14');
    const amineAngles = ['C11', 'C13', 'C14']
      .map(atomId => angleOf(sub(result.coords.get(atomId), result.coords.get('N12'))))
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const amineSeparations = amineAngles.map((angle, index) => {
      const nextAngle = amineAngles[(index + 1) % amineAngles.length];
      const rawGap = nextAngle - angle;
      return (rawGap > 0 ? rawGap : rawGap + Math.PI * 2) * (180 / Math.PI);
    });

    assert.equal(result.metadata.stageTelemetry.stageAudits.placement.severeOverlapCount, 1);
    assert.equal(result.metadata.stageTelemetry.selectedGeometryStage, 'cleanup');
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
        (result.layoutGraph.atomToRings.get(atom.id)?.length ?? 0) === 0 &&
        (result.layoutGraph.bondsByAtomId.get(atom.id) ?? []).some(bond => (bond.order ?? 1) === 3)
    )?.id;
    assert.ok(nitrileCarbonAtomId);
    const anchorAtomId = (result.layoutGraph.bondsByAtomId.get(nitrileCarbonAtomId) ?? [])
      .map(bond => (bond.a === nitrileCarbonAtomId ? bond.b : bond.a))
      .find(atomId => (result.layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0);
    assert.ok(anchorAtomId);
    const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, anchorAtomId);
    assert.notEqual(preferredAngle, null);
    const childAngle = angleOf(sub(result.coords.get(nitrileCarbonAtomId), result.coords.get(anchorAtomId)));

    assert.ok(angularDifference(childAngle, preferredAngle) < 1e-6);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps the reported crowded benzylic ethyl tail on an exact 120-degree zigzag through cleanup', () => {
    const result = runPipeline(
      parseSMILES('CCC1=CC=CC(CC)=C1NC(=O)C1=C(C)N(CC(C)C)C(C)=C(Br)C1=O'),
      { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true }
    );
    const benzylicAngle = bondAngleAtAtom(result.coords, 'C2', 'C1', 'C3');
    const anilideAngle = bondAngleAtAtom(result.coords, 'N11', 'C10', 'C12');
    const amideCarbonylFirstAngle = bondAngleAtAtom(result.coords, 'C12', 'C14', 'O13');
    const amideCarbonylSecondAngle = bondAngleAtAtom(result.coords, 'C12', 'C14', 'N11');
    const amideCarbonylThirdAngle = bondAngleAtAtom(result.coords, 'C12', 'O13', 'N11');

    assert.ok(
      Math.abs(benzylicAngle - 120) < 1e-6,
      `expected the benzylic ethyl methylene to stay on an exact 120-degree zigzag, got ${benzylicAngle.toFixed(2)} degrees`
    );
    assert.ok(Math.abs(anilideAngle - 120) < 1e-6, `expected C10-N11-C12 to stay at 120 degrees, got ${anilideAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideCarbonylFirstAngle - 120) < 1e-6, `expected C14-C12-O13 to stay at 120 degrees, got ${amideCarbonylFirstAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideCarbonylSecondAngle - 120) < 1e-6, `expected C14-C12-N11 to stay at 120 degrees, got ${amideCarbonylSecondAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideCarbonylThirdAngle - 120) < 1e-6, `expected O13-C12-N11 to stay at 120 degrees, got ${amideCarbonylThirdAngle.toFixed(2)} degrees`);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('keeps the reported thiazole-linked middle NH and chlorophenyl amide nitrogen on exact 120-degree link angles', () => {
    const result = runPipeline(
      parseSMILES('CC1=NC(NC2=NC=C(S2)C(=O)NC2=C(C)C=CC=C2Cl)=CC(=N1)N1CCN(CCO)CC1'),
      { suppressH: true, auditTelemetry: true, finalLandscapeOrientation: true }
    );
    const middleNitrogenAngle = bondAngleAtAtom(result.coords, 'N5', 'C4', 'C6');
    const amideNitrogenAngle = bondAngleAtAtom(result.coords, 'N13', 'C11', 'C14');

    assert.ok(Math.abs(middleNitrogenAngle - 120) < 1e-6, `expected C4-N5-C6 to stay at 120 degrees, got ${middleNitrogenAngle.toFixed(2)} degrees`);
    assert.ok(Math.abs(amideNitrogenAngle - 120) < 1e-6, `expected C11-N13-C14 to stay at 120 degrees, got ${amideNitrogenAngle.toFixed(2)} degrees`);
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
    assert.ok(
      angularDifference(childAngle, preferredAngle) > (3 * Math.PI) / 180,
      'expected the imidazole sidechain root to keep a zigzag bias instead of landing on the exact radial outward axis'
    );
    assert.ok(Math.abs(separations[0] - 108) < 1e-6);
    assert.ok(Math.abs(separations[1] - 120) < 1e-6);
    assert.ok(Math.abs(separations[2] - 132) < 1e-6);
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
    assert.ok(
      angularDifference(sharedJunctionExitAngle, sharedJunctionContinuationAngle) < 1e-6,
      'expected the C4-C2 bridgehead exit to stay on the exact shared-junction continuation'
    );
    for (const separation of separations) {
      assert.ok(Math.abs(separation - (2 * Math.PI) / 3) < 1e-6, `expected C2 separations near 120 degrees, got ${((separation * 180) / Math.PI).toFixed(2)}`);
    }
    assert.equal(result.metadata.audit.ok, true);
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

    assert.ok(
      angularDifference(leafAngle, idealAngle) < 1e-6,
      `expected ${centerAtomId}-${leafAtomId} to stay on the exact local trigonal bisector`
    );
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('uses the late attached-ring touchup to rotate the ester root and attached pyridyl ring into a clean row-228 pose', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit(
      'COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13',
      { suppressH: true, auditTelemetry: true }
    );
    const anchorAtomId = 'C16';
    const childAtomId = 'C14';
    const preferredAngle = preferredRingAttachmentAngle(result.layoutGraph, result.coords, anchorAtomId);
    const childAngle = angleOf(sub(result.coords.get(childAtomId), result.coords.get(anchorAtomId)));

    assert.ok(placementAudit.ringSubstituentReadabilityFailureCount > 0);
    assert.ok(placementAudit.outwardAxisRingSubstituentFailureCount > 0);
    assert.equal(result.metadata.stageTelemetry?.selectedStage, 'finalAttachedRingRotationTouchup');
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.outwardAxisRingSubstituentFailureCount, 0);
    assert.notEqual(preferredAngle, null);
    assert.ok(
      angularDifference(childAngle, preferredAngle) <= Math.PI / 6 + 1e-6,
      `expected ${anchorAtomId}-${childAtomId} to end within 30 degrees of the local outward direction`
    );
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
    assert.equal(result.metadata.stageTelemetry.selectedGeometryStage, 'cleanup');
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

  it('keeps mixed bridged cleanup from sacrificing bond counts for overlap wins', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit(
      '[H][C@@]12N(C)C3=C(C=C(C(OC)=C3)[C@]3(C[C@@H]4CN(C[C@](O)(CC)C4)CCC4=C3NC3=CC=CC=C43)C(=O)OC)[C@@]11CCN3CC=C[C@@](CC)([C@@H](OC(C)=O)[C@]2(O)C(=O)OC)[C@@]13[H]'
    );

    assert.equal(result.metadata.primaryFamily, 'bridged');
    assert.equal(result.metadata.mixedMode, true);
    assert.ok(placementAudit.bondLengthFailureCount > 0);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= placementAudit.bondLengthFailureCount);
    assert.ok(result.metadata.audit.maxBondLengthDeviation <= placementAudit.maxBondLengthDeviation + 1e-6);
    assert.ok(result.metadata.audit.severeOverlapCount <= placementAudit.severeOverlapCount);
  });

  it('keeps mixed organometallic cleanup from worsening cobalt-corrin bond failures', () => {
    const { placementAudit, result } = inspectPlacementAndFinalAudit(
      '[C@@H]12N3C4=C([N]([Co+]567(N8C9=C(C%10=[N]5C([C@H]([C@]%10(C)CC(N)=O)CCC(N)=O)=CC5=[N]6C([C@H](C5(C)C)CCC(N)=O)=C(C5=[N]7[C@H]([C@@H]([C@@]5(C)CCC(=O)NCC(C)OP([O-])(=O)O[C@@H]([C@H]1O)[C@@H](CO)O2)CC(N)=O)[C@]8([C@@]([C@@H]9CCC(N)=O)(C)CC(N)=O)C)C)C)C)=C3)C=C(C(C)=C4)C'
    );

    assert.equal(result.metadata.primaryFamily, 'organometallic');
    assert.equal(result.metadata.mixedMode, true);
    assert.ok(placementAudit.bondLengthFailureCount > 0);
    assert.ok(result.metadata.audit.bondLengthFailureCount <= placementAudit.bondLengthFailureCount);
    assert.ok(result.metadata.audit.maxBondLengthDeviation <= placementAudit.maxBondLengthDeviation + 1e-6);
    assert.ok(result.metadata.audit.severeOverlapCount <= placementAudit.severeOverlapCount);
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
    assert.ok(result.metadata.audit.maxBondLengthDeviation < 0.05);
    assert.ok(result.metadata.timing.totalMs < 500, `expected large cyclic peptide reroute to stay fast, got ${result.metadata.timing.totalMs}ms`);
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
    assert.ok(result.metadata.timing.totalMs < 2000, `expected metallomacrocycle reroute to avoid runaway large-molecule placement, got ${result.metadata.timing.totalMs}ms`);
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
    assert.deepEqual(result.metadata.placedFamilies, ['mixed']);
    assert.equal(result.metadata.audit.collapsedMacrocycleCount, 0);
    assert.ok(
      result.metadata.audit.maxBondLengthDeviation < 1,
      `expected dense macrocycle fusion to avoid catastrophic bond blowups, got ${result.metadata.audit.maxBondLengthDeviation}`
    );
    assert.ok(
      result.metadata.audit.bondLengthFailureCount < 20,
      `expected dense macrocycle fusion to stay below the catastrophic failure bucket, got ${result.metadata.audit.bondLengthFailureCount}`
    );
    assert.ok(result.metadata.audit.severeOverlapCount <= 6, `expected dense macrocycle fusion to keep overlaps contained, got ${result.metadata.audit.severeOverlapCount}`);
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

  it('routes chain-heavy peptide-like mixed components through the large-molecule path', () => {
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
    assert.ok(result.metadata.audit.severeOverlapCount <= 5);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
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
    assert.ok(elapsed < 5000, `expected the peptide timeout regression to finish far below the 30s stress-test timeout, got ${elapsed}ms`);
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
    assert.ok(result.metadata.timing.placementMs < 3000, `expected overlap-heavy large-molecule packing to avoid runaway rescoring, got ${result.metadata.timing.placementMs}ms`);
    assert.ok(elapsed < 4500, `expected overlap-heavy large-molecule packing to finish comfortably under 4.5s, got ${elapsed}ms`);
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
    assert.ok(
      angularDifference(actualRootAngle, preferredRootAngle) <= Math.PI / 6 + 1e-6,
      'expected the ester root to stay within 30 degrees of the local outward ring direction after cleanup'
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
});
