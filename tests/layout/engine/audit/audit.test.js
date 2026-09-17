import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/index.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { auditCandidateSafety, auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { buildAtomGrid, measureBondLengthDeviation } from '../../../../src/layout/engine/audit/invariants.js';
import { AUDIT_PLANAR_VALIDATION, BRIDGED_VALIDATION, HAPTIC_VALIDATION } from '../../../../src/layout/engine/constants.js';
import { inspectEZStereo } from '../../../../src/layout/engine/stereo/ez.js';
import { add, centroid, rotate, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { makeEAlkene, makeEthane, makeMacrocycle } from '../support/molecules.js';

/**
 * Checks all candidate safety fields against their full-audit counterparts.
 * @param {object} graph - Layout graph.
 * @param {Map<string, {x: number, y: number}>} coords - Supplied geometry.
 * @param {object} [options] - Shared audit options.
 * @returns {object} Full audit summary.
 */
function assertSafetyParity(graph, coords, options = {}) {
  const full = auditLayout(graph, coords, options);
  const safety = auditCandidateSafety(graph, coords, options);
  assert.equal(safety.ok, full.ok);
  assert.equal('fallback' in safety, false);
  assert.equal('labelOverlapCount' in safety, false);
  assert.equal(safety.visibleHeavyBondCrossingCount, full.visibleHeavyBondCrossingCount);
  assert.equal(safety.visibleHeavyBondCrossingFailureCount, full.visibleHeavyBondCrossingFailureCount);
  for (const [key, value] of Object.entries(safety)) {
    assert.deepEqual(value, full[key], key);
  }
  assert.deepEqual(auditCandidateSafety(graph, coords, { ...options, includeFallback: true }).fallback, full.fallback);
  return full;
}

/**
 * Builds two crossed ethane bonds plus an independently placed ring scaffold.
 * @param {string} ringSmiles - Carbon ring scaffold.
 * @param {boolean} connected - Whether to connect all fragments with acyclic bonds.
 * @returns {{molecule: object, coords: Map<string, {x: number, y: number}>}} Audit fixture.
 */
function crossingBesideRing(ringSmiles, connected) {
  const molecule = new Molecule();
  const coords = new Map([
    ['a', { x: -0.75, y: 0 }],
    ['b', { x: 0.75, y: 0 }],
    ['c', { x: 0, y: -0.75 }],
    ['d', { x: 0, y: 0.75 }]
  ]);
  for (const id of coords.keys()) {
    molecule.addAtom(id, 'C');
  }
  molecule.addBond('ab', 'a', 'b', {}, false);
  molecule.addBond('cd', 'c', 'd', {}, false);
  const ring = parseSMILES(ringSmiles);
  const placed = runPipeline(ring, { suppressH: true });
  const ringIds = [];
  for (const atom of ring.atoms.values()) {
    if (atom.name === 'H') {
      continue;
    }
    const id = `ring-${atom.id}`;
    molecule.addAtom(id, 'C');
    ringIds.push(id);
    const position = placed.coords.get(atom.id);
    coords.set(id, { x: position.x + 30, y: position.y });
  }
  for (const bond of ring.bonds.values()) {
    const [a, b] = bond.atoms.map(id => `ring-${id}`);
    if (coords.has(a) && coords.has(b)) {
      molecule.addBond(`ring-${bond.id}`, a, b, {}, false);
    }
  }
  if (connected) {
    const anchor = ringIds.reduce((left, id) => (coords.get(id).x < coords.get(left).x ? id : left));
    molecule.addBond('link-fragments', 'b', 'd', {}, false);
    molecule.addBond('link-ring', 'b', anchor, {}, false);
  }
  return { molecule, coords };
}

describe('layout/engine/audit/audit', () => {
  for (const validationClass of ['planar', 'bridged', 'haptic']) {
    it(`matches candidate crossing safety for ${validationClass} bonds and clean alternatives`, () => {
      const molecule = new Molecule();
      const coords = new Map([
        ['a', { x: -0.75, y: 0 }],
        ['b', { x: 0.75, y: 0 }],
        ['c', { x: 0, y: -0.75 }],
        ['d', { x: 0, y: 0.75 }]
      ]);
      for (const id of coords.keys()) {
        molecule.addAtom(id, 'C');
      }
      molecule.addBond('ab', 'a', 'b', {}, false);
      molecule.addBond('cd', 'c', 'd', {}, false);
      const graph = createLayoutGraph(molecule);
      assert.equal(assertSafetyParity(graph, coords).ok, false);
      const options = { bondValidationClasses: new Map([['ab', validationClass]]) };
      const audit = assertSafetyParity(graph, coords, options);
      assert.equal(audit.severeOverlapCount, 0);
      assert.equal(audit.bondLengthFailureCount, 0);
      assert.equal(audit.visibleHeavyBondCrossingCount, 1);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, validationClass === 'planar' ? 1 : 0);
      assert.equal(audit.ok, validationClass !== 'planar');
      assert.equal(audit.fallback.reasons.includes('visible-heavy-bond-crossings'), validationClass === 'planar');
      assert.equal(assertSafetyParity(graph, coords, { ...options, includeVisibleHeavyBondCrossings: false }).ok, true);
      coords.set('c', { x: 3, y: -0.75 });
      coords.set('d', { x: 3, y: 0.75 });
      assert.equal(assertSafetyParity(graph, coords, options).ok, true);
    });
  }

  for (const ringSmiles of ['C1CCCCCCC1', 'C1CC2CCC1C2']) {
    for (const connected of [false, true]) {
      it(`does not let ${ringSmiles} hide an unrelated crossing with connected=${connected}`, () => {
        const { molecule, coords } = crossingBesideRing(ringSmiles, connected);
        const graph = createLayoutGraph(molecule);
        assert.equal(graph.components.length, connected ? 1 : 3);
        const audit = assertSafetyParity(graph, coords);
        assert.equal(audit.visibleHeavyBondCrossingFailureCount, 1);
        assert.equal(audit.ok, false);
        assert.ok(audit.fallback.reasons.includes('visible-heavy-bond-crossings'));
      });
    }
  }

  for (const ringCount of [1, 2]) {
    it(`retains one internal crossing allowance for each of ${ringCount} macrocycles`, () => {
      const molecule = new Molecule();
      const coords = new Map();
      const points = [
        [-1, -1],
        [-0.3, -0.3],
        [1, 1],
        [1, 0],
        [1, -1],
        [0.3, -0.3],
        [-1, 1],
        [-1, 0]
      ];
      for (let ring = 0; ring < ringCount; ring++) {
        for (let index = 0; index < 8; index++) {
          const id = `${ring}-${index}`;
          molecule.addAtom(id, 'C');
          coords.set(id, { x: points[index][0] + ring * 30, y: points[index][1] });
        }
        for (let index = 0; index < 8; index++) {
          molecule.addBond(`b${ring}-${index}`, `${ring}-${index}`, `${ring}-${(index + 1) % 8}`, {}, false);
        }
      }
      const audit = assertSafetyParity(createLayoutGraph(molecule), coords);
      assert.equal(audit.visibleHeavyBondCrossingCount, ringCount);
      assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
    });
  }

  it('retains projected internal crossings in a bridged ring system', () => {
    const graph = createLayoutGraph(parseSMILES('C1CC2CCC1C2'), { suppressH: true });
    const ids = [...graph.atoms.values()].filter(atom => atom.element !== 'H').map(atom => atom.id);
    const coords = new Map(ids.map((id, index) => [id, { x: 3 * Math.cos((index * 2 * Math.PI) / ids.length), y: 3 * Math.sin((index * 2 * Math.PI) / ids.length) }]));
    const audit = auditLayout(graph, coords);
    assert.ok(graph.traits.bridgedRingConnectionCount > 0);
    assertSafetyParity(graph, coords);
    assert.ok(audit.visibleHeavyBondCrossingCount > 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, 0);
  });

  it('does not spend a macrocycle allowance more than once within a ring system', () => {
    const graph = createLayoutGraph(parseSMILES('C1CCCCCCC1'), { suppressH: true });
    const order = [0, 2, 4, 6, 1, 3, 5, 7];
    const coords = new Map(
      graph.rings[0].atomIds.map((id, index) => [
        id,
        {
          x: 3 * Math.cos((order[index] * Math.PI) / 4),
          y: 3 * Math.sin((order[index] * Math.PI) / 4)
        }
      ])
    );
    const audit = auditLayout(graph, coords);
    assert.ok(audit.visibleHeavyBondCrossingCount > 1);
    assertSafetyParity(graph, coords);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, audit.visibleHeavyBondCrossingCount - 1);
  });

  it('does not exempt crossings between separate macrocycles', () => {
    const graph = createLayoutGraph(parseSMILES('C1CCCCCCC1.C1CCCCCCC1'), { suppressH: true });
    const coords = new Map();
    for (const [index, ring] of graph.rings.entries()) {
      ring.atomIds.forEach((id, vertex) =>
        coords.set(id, {
          x: 2 * Math.cos((vertex * Math.PI) / 4) + index * 2.3,
          y: 2 * Math.sin((vertex * Math.PI) / 4) + index * 0.2
        })
      );
    }
    const audit = auditLayout(graph, coords);
    assert.ok(audit.visibleHeavyBondCrossingCount > 0);
    assert.equal(audit.visibleHeavyBondCrossingFailureCount, audit.visibleHeavyBondCrossingCount);
    assertSafetyParity(graph, coords);
  });

  for (const [validationClass, limits] of [
    ['planar', AUDIT_PLANAR_VALIDATION],
    ['bridged', BRIDGED_VALIDATION],
    ['haptic', HAPTIC_VALIDATION]
  ]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`checks both ${validationClass} bond-length limits at scale ${bondLength}`, () => {
        const graph = createLayoutGraph(makeEthane(), { bondLength });
        const options = { bondLength, bondValidationClasses: new Map([['b0', validationClass]]) };
        const min = bondLength * limits.minBondLengthFactor;
        const max = bondLength * limits.maxBondLengthFactor;
        for (const [distance, failures] of [
          [0, 1],
          [min - 1e-7, 1],
          [min, 0],
          [min + 1e-7, 0],
          [bondLength, 0],
          [max - 1e-7, 0],
          [max, 0],
          [max + 1e-7, 1]
        ]) {
          const coords = new Map([
            ['a0', { x: 0, y: 0 }],
            ['a1', { x: distance, y: 0 }]
          ]);
          const stats = measureBondLengthDeviation(graph, coords, bondLength, options);
          assert.equal(stats.failingBondCount, failures, `distance ${distance}`);
          assert.equal(stats.sampleCount, 1);
          assert.equal(stats.mildFailingBondCount + stats.severeFailingBondCount, failures);
          assert.ok(Math.abs(stats.maxDeviation - Math.abs(distance - bondLength)) < 1e-9);
          assert.equal(stats.meanDeviation, stats.maxDeviation);
          for (const auditFn of [auditLayout, auditCandidateSafety]) {
            const audit = auditFn(graph, coords, options);
            assert.equal(audit.bondLengthFailureCount, failures);
            assert.equal(audit.ok, failures === 0);
          }
        }
      });
    }
  }

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
    assert.equal(fullAudit.ok, false);
    assert.equal(okOnlyAudit.ok, true);
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
