import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { buildScaffoldPlan } from '../../../../src/layout/engine/model/scaffold-plan.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { collectRigidPendantRingSubtrees, resolveOverlaps } from '../../../../src/layout/engine/cleanup/overlap-resolution.js';
import { runLocalCleanup } from '../../../../src/layout/engine/cleanup/local-rotation.js';
import { add, angleOf, angularDifference, centroid, rotate, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { layoutMixedFamily } from '../../../../src/layout/engine/families/mixed.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';
import { makeDisconnectedEthanes } from '../support/molecules.js';

function bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstAngle = angleOf(sub(coords.get(firstNeighborAtomId), centerPosition));
  const secondAngle = angleOf(sub(coords.get(secondNeighborAtomId), centerPosition));
  return angularDifference(firstAngle, secondAngle);
}

function preferredRingAttachmentAngle(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  for (const ring of layoutGraph.atomToRings?.get(anchorAtomId) ?? []) {
    const ringPositions = ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (ringPositions.length < 3) {
      continue;
    }
    return angleOf(sub(anchorPosition, centroid(ringPositions)));
  }
  return null;
}

function buildAdjacency(layoutGraph, atomIds) {
  const adjacency = new Map([...atomIds].map(atomId => [atomId, []]));
  for (const bond of layoutGraph.bonds.values()) {
    if (!atomIds.has(bond.a) || !atomIds.has(bond.b)) {
      continue;
    }
    adjacency.get(bond.a).push(bond.b);
    adjacency.get(bond.b).push(bond.a);
  }
  return adjacency;
}

describe('layout/engine/cleanup/overlap-resolution', () => {
  it('moves the more disposable atom without stretching the less movable partner', () => {
    const graph = {
      options: { bondLength: 1.5, preserveFixed: true },
      fixedCoords: new Map(),
      atoms: new Map([
        ['anchor', { id: 'anchor', element: 'C', heavyDegree: 3 }],
        ['leaf', { id: 'leaf', element: 'C', heavyDegree: 1 }],
        ['core', { id: 'core', element: 'C', heavyDegree: 3 }]
      ]),
      bondedPairSet: new Set(['anchor:leaf']),
      bondsByAtomId: new Map([
        ['anchor', [{ a: 'anchor', b: 'leaf', kind: 'covalent' }]],
        ['leaf', [{ a: 'anchor', b: 'leaf', kind: 'covalent' }]],
        ['core', []]
      ])
    };
    const inputCoords = new Map([
      ['anchor', { x: -1.5, y: 0 }],
      ['leaf', { x: 0, y: 0 }],
      ['core', { x: 0.1, y: 0 }]
    ]);

    const result = resolveOverlaps(graph, inputCoords, { bondLength: 1.5 });
    const anchorPosition = result.coords.get('anchor');
    const leafPosition = result.coords.get('leaf');
    const originalDistance = Math.hypot(inputCoords.get('leaf').x - inputCoords.get('core').x, inputCoords.get('leaf').y - inputCoords.get('core').y);
    const resolvedDistance = Math.hypot(leafPosition.x - result.coords.get('core').x, leafPosition.y - result.coords.get('core').y);

    assert.ok(result.moves > 0);
    assert.equal(result.coords.get('core').x, 0.1);
    assert.ok(resolvedDistance > originalDistance);
    assert.ok(Math.abs(Math.hypot(leafPosition.x - anchorPosition.x, leafPosition.y - anchorPosition.y) - 1.5) < 1e-9);
  });

  it('nudges severe overlaps apart before local cleanup', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes());
    const result = resolveOverlaps(
      graph,
      new Map([
        ['a0', { x: 0, y: 0 }],
        ['c0', { x: 0.1, y: 0 }]
      ]),
      { bondLength: graph.options.bondLength }
    );
    assert.ok(result.moves > 0);
    assert.ok(result.coords.get('c0').x > 0.1);
  });

  it('keeps conjugated divalent nitrogens on their exact 120-degree continuation without worsening an already clean mixed layout', () => {
    const smiles = 'CC\\C(=C/1\\N=C(OC1=O)c2ccc(Cl)cc2Cl)\\N3CCC[C@H]3C(=O)N[C@@H](<Cc4ccc(O)cc4>)C(=O)N';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const component = graph.components[0];
    const adjacency = buildAdjacency(graph, new Set(component.atomIds));
    const mixedResult = layoutMixedFamily(graph, component, adjacency, buildScaffoldPlan(graph, component), graph.options.bondLength);

    const beforeAudit = auditLayout(graph, mixedResult.coords, { bondLength: graph.options.bondLength });
    const result = resolveOverlaps(graph, mixedResult.coords, { bondLength: graph.options.bondLength });
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const amideAngle = bondAngleAtAtom(result.coords, 'N26', 'C24', 'C27');

    assert.equal(beforeAudit.severeOverlapCount, 0);
    assert.ok(audit.severeOverlapCount <= beforeAudit.severeOverlapCount);
    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(Math.abs(amideAngle - ((2 * Math.PI) / 3)) < 1e-6, `expected N26 to stay at 120 degrees, got ${((amideAngle * 180) / Math.PI).toFixed(2)}`);
  });

  it('honors larger configured overlap targets above the audit floor', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes());
    const initialCoords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['c0', { x: 0.3, y: 0 }]
    ]);
    const defaultResult = resolveOverlaps(graph, initialCoords, {
      bondLength: graph.options.bondLength
    });
    const widerTarget = resolveOverlaps(graph, initialCoords, {
      bondLength: graph.options.bondLength,
      thresholdFactor: 0.7
    });
    const defaultSeparation = defaultResult.coords.get('c0').x - defaultResult.coords.get('a0').x;
    const widerSeparation = widerTarget.coords.get('c0').x - widerTarget.coords.get('a0').x;

    assert.ok(widerSeparation > defaultSeparation);
  });

  it('chooses the safer pivot direction when a leaf can avoid creating a second overlap', () => {
    const graph = {
      options: { bondLength: 1.5, preserveFixed: true },
      fixedCoords: new Map(),
      atoms: new Map([
        ['anchor', { id: 'anchor', element: 'C', heavyDegree: 3 }],
        ['leaf', { id: 'leaf', element: 'C', heavyDegree: 1 }],
        ['opposing', { id: 'opposing', element: 'C', heavyDegree: 3 }],
        ['blocker', { id: 'blocker', element: 'O', heavyDegree: 2 }]
      ]),
      bondedPairSet: new Set(['anchor:leaf']),
      bondsByAtomId: new Map([
        ['anchor', [{ a: 'anchor', b: 'leaf', kind: 'covalent' }]],
        ['leaf', [{ a: 'anchor', b: 'leaf', kind: 'covalent' }]],
        ['opposing', []],
        ['blocker', []]
      ])
    };
    const inputCoords = new Map([
      ['anchor', { x: 0, y: 0 }],
      ['leaf', { x: 1.5, y: 0 }],
      ['opposing', { x: 1.55, y: 0.05 }],
      ['blocker', { x: 1.45, y: -1.35 }]
    ]);

    const result = resolveOverlaps(graph, inputCoords, { bondLength: 1.5 });
    const leafPosition = result.coords.get('leaf');
    const blockerPosition = result.coords.get('blocker');

    assert.ok(result.moves > 0);
    assert.ok(leafPosition.y > 0, 'expected the leaf to pivot toward the safer side away from the blocker');
    assert.ok(Math.hypot(leafPosition.x - blockerPosition.x, leafPosition.y - blockerPosition.y) >= 1.5 * 0.55);
  });

  it('rotates singly attached sugar rings as rigid subtrees instead of stretching them apart', () => {
    const molecule = parseSMILES(
      'CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O'
    );
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const placement = layoutSupportedComponents(graph);
    const cleanup = runLocalCleanup(graph, placement.coords, { bondLength: graph.options.bondLength });
    const rigidDescriptor = [
      ...new Map(
        [...collectRigidPendantRingSubtrees(graph).values()].map(descriptor => [
          `${descriptor.anchorAtomId}|${descriptor.rootAtomId}|${descriptor.subtreeAtomIds.join(',')}`,
          descriptor
        ])
      ).values()
    ].find(descriptor => descriptor.anchorAtomId === 'C20' && descriptor.rootAtomId === 'O28');
    assert.ok(rigidDescriptor);

    const perturbedCoords = new Map([...cleanup.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const anchorPosition = perturbedCoords.get(rigidDescriptor.anchorAtomId);
    const movableAtomIds = rigidDescriptor.subtreeAtomIds.filter(atomId => perturbedCoords.has(atomId));
    for (const atomId of movableAtomIds) {
      const currentPosition = perturbedCoords.get(atomId);
      perturbedCoords.set(atomId, add(anchorPosition, rotate(sub(currentPosition, anchorPosition), (2 * Math.PI) / 3)));
    }

    const beforeAudit = auditLayout(graph, perturbedCoords, { bondLength: graph.options.bondLength });
    const result = resolveOverlaps(graph, perturbedCoords, { bondLength: graph.options.bondLength });
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });

    assert.ok(beforeAudit.severeOverlapCount > 0);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(result.moves > 0);
  });

  it('accepts cached rigid pendant-ring descriptors without changing the resolved layout', () => {
    const molecule = parseSMILES(
      'CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O'
    );
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const placement = layoutSupportedComponents(graph);
    const cleanup = runLocalCleanup(graph, placement.coords, { bondLength: graph.options.bondLength });
    const cachedRigidSubtrees = collectRigidPendantRingSubtrees(graph);
    const visibleAtomCount = [...graph.atoms.values()].filter(atom => atom.visible).length;

    const direct = resolveOverlaps(graph, cleanup.coords, { bondLength: graph.options.bondLength });
    const cached = resolveOverlaps(graph, cleanup.coords, {
      bondLength: graph.options.bondLength,
      rigidSubtreesByAtomId: cachedRigidSubtrees,
      visibleAtomCount
    });

    assert.deepEqual([...cached.coords.entries()], [...direct.coords.entries()]);
    assert.equal(cached.moves, direct.moves);
  });

  it('flips the compact aryl ester subtree across its bond axis to clear ortho acid clashes without softening either ring root', () => {
    const graph = createLayoutGraph(parseSMILES('CC(=O)OC1=C(C=CC(=C1)C(F)(F)F)C(O)=O'), {
      suppressH: true
    });
    const placement = layoutSupportedComponents(graph);
    const rigidDescriptor = collectRigidPendantRingSubtrees(graph).get('C1');
    assert.ok(rigidDescriptor);
    assert.equal(rigidDescriptor.anchorAtomId, 'C5');
    assert.equal(rigidDescriptor.rootAtomId, 'O4');
    assert.deepEqual([...rigidDescriptor.subtreeAtomIds].filter(atomId => graph.atoms.get(atomId)?.element !== 'H').sort(), ['C1', 'C2', 'O3', 'O4']);

    const result = resolveOverlaps(graph, placement.coords, { bondLength: graph.options.bondLength });
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const esterAngle = bondAngleAtAtom(result.coords, 'O4', 'C2', 'C5');
    const acidRingAngle = bondAngleAtAtom(result.coords, 'C6', 'C5', 'C15');
    const esterRootPreferredAngle = preferredRingAttachmentAngle(graph, result.coords, 'C5');
    const esterRootAngle = angleOf(sub(result.coords.get('O4'), result.coords.get('C5')));
    const acidRootPreferredAngle = preferredRingAttachmentAngle(graph, result.coords, 'C6');
    const acidRootAngle = angleOf(sub(result.coords.get('C15'), result.coords.get('C6')));

    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(Math.abs(esterAngle - (2 * Math.PI) / 3) < 1e-6);
    assert.ok(Math.abs(acidRingAngle - (2 * Math.PI) / 3) < 1e-6);
    assert.notEqual(esterRootPreferredAngle, null);
    assert.ok(angularDifference(esterRootAngle, esterRootPreferredAngle) < 1e-6);
    assert.notEqual(acidRootPreferredAngle, null);
    assert.ok(angularDifference(acidRootAngle, acidRootPreferredAngle) < 1e-6);
  });

  it('prefers the smallest clash-clearing rigid ester rotation before falling back to a large ring-root swing', () => {
    const graph = createLayoutGraph(parseSMILES('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'), {
      suppressH: true
    });
    const placement = layoutSupportedComponents(graph);
    const result = resolveOverlaps(graph, placement.coords, { bondLength: graph.options.bondLength });
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const preferredRootAngle = preferredRingAttachmentAngle(graph, result.coords, 'C31');
    const actualRootAngle = angleOf(sub(result.coords.get('C32'), result.coords.get('C31')));

    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.notEqual(preferredRootAngle, null);
    assert.ok(
      angularDifference(actualRootAngle, preferredRootAngle) <= Math.PI / 6 + 1e-6,
      `expected cleanup to keep the ester root within 30 degrees of the local outward ring direction`
    );
  });

  it('probes exact omitted-h trigonal rigid-root slots before accepting a distorted overlap fix', () => {
    const graph = createLayoutGraph(parseSMILES('CCCCC1=CC2=C(C=C1C(=CC1=CC=NO1)C(C)C)C(C)(C)CC2(C)C'), { suppressH: true });
    const placement = layoutSupportedComponents(graph);
    const result = resolveOverlaps(graph, placement.coords, { bondLength: graph.options.bondLength });
    const audit = auditLayout(graph, result.coords, { bondLength: graph.options.bondLength });
    const trigonalAngle = bondAngleAtAtom(result.coords, 'C12', 'C11', 'C13');
    const isopropylSpreads = [
      bondAngleAtAtom(result.coords, 'C18', 'C11', 'C19'),
      bondAngleAtAtom(result.coords, 'C18', 'C11', 'C20'),
      bondAngleAtAtom(result.coords, 'C18', 'C19', 'C20')
    ];

    assert.equal(audit.severeOverlapCount, 0);
    assert.ok(Math.abs(trigonalAngle - (2 * Math.PI) / 3) < 1e-6);
    for (const spread of isopropylSpreads) {
      assert.ok(Math.abs(spread - (2 * Math.PI) / 3) < 1e-6, `expected C18 spreads near 120 degrees, got ${((spread * 180) / Math.PI).toFixed(2)}`);
    }
  });
});
