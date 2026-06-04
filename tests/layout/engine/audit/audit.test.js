import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { auditCandidateSafety, auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { buildAtomGrid } from '../../../../src/layout/engine/audit/invariants.js';
import { inspectEZStereo } from '../../../../src/layout/engine/stereo/ez.js';
import { add, centroid, rotate, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { makeEAlkene, makeEthane, makeMacrocycle } from '../support/molecules.js';

describe('layout/engine/audit/audit', () => {
  it('reports a clean simple layout as passing audit', () => {
    const graph = createLayoutGraph(makeEthane());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }]
    ]);
    const audit = auditLayout(graph, coords);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.collapsedMacrocycleCount, 0);
  });

  it('flags collapsed macrocycles and severe overlap conditions', () => {
    const graph = createLayoutGraph(makeMacrocycle());
    const coords = new Map(graph.rings[0].atomIds.map(atomId => [atomId, { x: 0, y: 0 }]));
    const audit = auditLayout(graph, coords);
    assert.equal(audit.ok, false);
    assert.ok(audit.severeOverlapCount > 0);
    assert.ok(audit.worstOverlapDeficit > 0);
    assert.equal(typeof audit.minSevereOverlapDistance, 'number');
    assert.ok(audit.collapsedMacrocycleCount > 0);
  });

  it('treats contradicted alkene stereo as an audit failure', () => {
    const graph = createLayoutGraph(makeEAlkene());
    const coords = new Map([
      ['F1', { x: -1, y: 1 }],
      ['C2', { x: 0, y: 0 }],
      ['C3', { x: 1.5, y: 0 }],
      ['F4', { x: 2.5, y: 1 }],
      ['H5', { x: -0.5, y: -1 }],
      ['H6', { x: 2, y: -1 }]
    ]);
    const ez = inspectEZStereo(graph, coords);
    const audit = auditLayout(graph, coords, {
      stereo: {
        ezViolationCount: ez.violationCount,
        chiralCenterCount: 0,
        unassignedCenterCount: 0
      }
    });

    assert.equal(audit.ok, false);
    assert.equal(audit.stereoContradiction, true);
  });

  it('does not treat unsupported annotated ring double bonds as stereo contradictions', () => {
    const graph = createLayoutGraph(parseSMILES('C1CC/C=C/CC1'), { suppressH: true, bondLength: 1.5 });
    const coords = runPipeline(parseSMILES('C1CC/C=C\\CC1'), { suppressH: true }).coords;
    const ez = inspectEZStereo(graph, coords);
    const audit = auditLayout(graph, coords, {
      stereo: {
        ezViolationCount: ez.violationCount,
        chiralCenterCount: 0,
        unassignedCenterCount: 0
      }
    });

    assert.equal(ez.supportedCheckCount, 0);
    assert.equal(ez.unsupportedCheckCount, 1);
    assert.equal(audit.ok, true);
    assert.equal(audit.stereoContradiction, false);
  });

  it('reports per-bond bridged validation classes in bond-length audit stats', () => {
    const graph = createLayoutGraph(makeEthane());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.8, y: 0 }]
    ]);

    const planarAudit = auditLayout(graph, coords);
    const bridgedAudit = auditLayout(graph, coords, {
      bondValidationClasses: new Map([['b0', 'bridged']])
    });

    assert.equal(planarAudit.ok, false);
    assert.equal(bridgedAudit.ok, true);
    assert.equal(planarAudit.bondLengthFailureCount, 1);
    assert.equal(planarAudit.mildBondLengthFailureCount + planarAudit.severeBondLengthFailureCount, 1);
    assert.ok(planarAudit.meanBondLengthDeviation > 0);
    assert.equal(bridgedAudit.bondLengthFailureCount, 0);
  });

  it('ignores explicit hydrogen bond stretches in bond-length audit stats', () => {
    const graph = createLayoutGraph(parseSMILES('N'));
    const coords = new Map([
      ['N1', { x: 0, y: 0 }],
      ['H2', { x: 3, y: 0 }],
      ['H3', { x: 0, y: 3 }],
      ['H4', { x: -3, y: 0 }]
    ]);

    const audit = auditLayout(graph, coords);

    assert.equal(audit.ok, true);
    assert.equal(audit.bondLengthFailureCount, 0);
  });

  it('reports overlapping multi-character labels in audit metadata', () => {
    const graph = createLayoutGraph(parseSMILES('Cl.Br'), { suppressH: true });
    const coords = new Map([
      ['Cl1', { x: 0, y: 0 }],
      ['Br2', { x: 0.9, y: 0 }]
    ]);

    const audit = auditLayout(graph, coords);

    assert.equal(audit.ok, true);
    assert.equal(audit.labelOverlapCount, 1);
  });

  it('can skip visible heavy-bond crossing counts for ok-only audit probes', () => {
    const graph = createLayoutGraph(parseSMILES('CC.CC'), { suppressH: true, bondLength: 1.5 });
    const [firstBond, secondBond] = [...graph.bonds.values()];
    const coords = new Map([
      [firstBond.a, { x: -0.75, y: 0 }],
      [firstBond.b, { x: 0.75, y: 0 }],
      [secondBond.a, { x: 0, y: -0.75 }],
      [secondBond.b, { x: 0, y: 0.75 }]
    ]);

    const fullAudit = auditLayout(graph, coords);
    const okOnlyAudit = auditLayout(graph, coords, {
      includeVisibleHeavyBondCrossings: false
    });

    assert.ok(fullAudit.visibleHeavyBondCrossingCount > 0);
    assert.equal(okOnlyAudit.visibleHeavyBondCrossingCount, 0);
    assert.equal(okOnlyAudit.ok, fullAudit.ok);
  });

  it('returns identical audit results when severe-overlap scratch is reused', () => {
    const graph = createLayoutGraph(parseSMILES('CC.CC'), { suppressH: true, bondLength: 1.5 });
    const atomIds = [...graph.atoms.keys()];
    const coords = new Map([
      [atomIds[0], { x: 0, y: 0 }],
      [atomIds[1], { x: 1.5, y: 0 }],
      [atomIds[2], { x: 0.2, y: 0 }],
      [atomIds[3], { x: 1.7, y: 0 }]
    ]);
    const visibleHeavyAtomIds = atomIds.filter(atomId => graph.atoms.get(atomId)?.element !== 'H' && coords.has(atomId));
    const atomGrid = buildAtomGrid(graph, coords, graph.options.bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });

    const directAudit = auditLayout(graph, coords);
    const reusedScratchAudit = auditLayout(graph, coords, {
      atomGrid,
      visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: true
    });

    assert.deepEqual(reusedScratchAudit, directAudit);
  });

  it('matches full audit safety fields for candidate probes', () => {
    const graph = createLayoutGraph(makeMacrocycle());
    const coords = new Map(graph.rings[0].atomIds.map(atomId => [atomId, { x: 0, y: 0 }]));

    const fullAudit = auditLayout(graph, coords);
    const safetyAudit = auditCandidateSafety(graph, coords);
    const safetyAuditWithFallback = auditCandidateSafety(graph, coords, {
      includeFallback: true
    });

    assert.equal(safetyAudit.ok, fullAudit.ok);
    assert.equal(safetyAudit.severeOverlapCount, fullAudit.severeOverlapCount);
    assert.equal(safetyAudit.worstOverlapDeficit, fullAudit.worstOverlapDeficit);
    assert.equal(safetyAudit.bondLengthFailureCount, fullAudit.bondLengthFailureCount);
    assert.equal(safetyAudit.collapsedMacrocycleCount, fullAudit.collapsedMacrocycleCount);
    assert.equal(safetyAudit.ringSubstituentReadabilityFailureCount, fullAudit.ringSubstituentReadabilityFailureCount);
    assert.deepEqual(safetyAuditWithFallback.fallback, fullAudit.fallback);
  });

  it('does not flag a clean anisole substituent as a ring-substituent readability failure', () => {
    const smiles = 'COc1ccccc1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const audit = auditLayout(graph, result.coords);

    assert.equal(audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(audit.ok, true);
  });

  it('flags tangential exocyclic ring-to-ring substituents as readability failures', () => {
    const smiles = 'c1ccccc1-c1ccccc1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const coords = new Map([...result.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const linkBond = [...graph.bonds.values()].find(bond => (graph.atomToRings.get(bond.a)?.length ?? 0) > 0 && (graph.atomToRings.get(bond.b)?.length ?? 0) > 0 && !bond.inRing);
    assert.ok(linkBond);
    const anchorAtomId = linkBond.a;
    const childAtomId = linkBond.b;
    const anchorPosition = coords.get(anchorAtomId);
    const anchorRingPolygon = (graph.atomToRings.get(anchorAtomId) ?? [])[0].atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    const childRingSystemAtomIds = graph.ringSystems.find(ringSystem => ringSystem.id === graph.atomToRingSystemId.get(childAtomId))?.atomIds ?? [];
    const childCentroid = centroid(childRingSystemAtomIds.map(atomId => coords.get(atomId)).filter(Boolean));
    const outwardVector = sub(anchorPosition, centroid(anchorRingPolygon));
    const rotation = Math.atan2(outwardVector.y, outwardVector.x) + Math.PI / 2 - Math.atan2(childCentroid.y - anchorPosition.y, childCentroid.x - anchorPosition.x);
    for (const atomId of childRingSystemAtomIds) {
      coords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), rotation)));
    }

    const audit = auditLayout(graph, coords);

    assert.equal(audit.ok, false);
    assert.ok(audit.ringSubstituentReadabilityFailureCount > 0);
    assert.ok(audit.outwardAxisRingSubstituentFailureCount > 0);
  });

  it('flags ring substituents that miss every local outward ring direction', () => {
    const smiles = 'COc1ccccc1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const coords = new Map([...result.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const oxygenAtomId = [...graph.atoms.values()].find(atom => atom.element === 'O' && (graph.atomToRings.get(atom.id)?.length ?? 0) === 0)?.id;
    assert.ok(oxygenAtomId);
    const oxygenNeighbors = (graph.bondsByAtomId.get(oxygenAtomId) ?? []).map(bond => (bond.a === oxygenAtomId ? bond.b : bond.a));
    const anchorAtomId = oxygenNeighbors.find(atomId => (graph.atomToRings.get(atomId)?.length ?? 0) > 0);
    const methylAtomId = oxygenNeighbors.find(atomId => atomId !== anchorAtomId);
    assert.ok(anchorAtomId);
    assert.ok(methylAtomId);

    const anchorPosition = coords.get(anchorAtomId);
    const oxygenPosition = coords.get(oxygenAtomId);
    const ringPolygon = (graph.atomToRings.get(anchorAtomId) ?? [])[0].atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    const outwardVector = sub(anchorPosition, centroid(ringPolygon));
    const currentVector = sub(oxygenPosition, anchorPosition);
    const rotation = Math.atan2(outwardVector.y, outwardVector.x) + Math.PI / 2 - Math.atan2(currentVector.y, currentVector.x);
    for (const atomId of [oxygenAtomId, methylAtomId]) {
      coords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), rotation)));
    }

    const audit = auditLayout(graph, coords);
    const safetyAudit = auditCandidateSafety(graph, coords);

    assert.equal(audit.ok, false);
    assert.equal(safetyAudit.ok, audit.ok);
    assert.ok(audit.ringSubstituentReadabilityFailureCount > 0);
    assert.equal(safetyAudit.ringSubstituentReadabilityFailureCount, audit.ringSubstituentReadabilityFailureCount);
    assert.ok(audit.outwardAxisRingSubstituentFailureCount > 0);
    assert.ok(audit.fallback.reasons.includes('ring-substituent-readability'));
  });
});
