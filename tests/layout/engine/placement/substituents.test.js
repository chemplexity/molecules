import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { computeIncidentRingOutwardAngles } from '../../../../src/layout/engine/geometry/ring-direction.js';
import { angularDifference } from '../../../../src/layout/engine/geometry/vec2.js';

import { chooseAttachmentAngle, placeRemainingBranches } from '../../../../src/layout/engine/placement/branch-placement.js';

function buildAdjacency(layoutGraph) {
  const adjacency = new Map([...layoutGraph.atoms.keys()].map(atomId => [atomId, []]));
  for (const bond of layoutGraph.bonds.values()) {
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }
  return adjacency;
}

function regularHexagonCoords(atomIds, radius = 1.5) {
  const coords = new Map();
  atomIds.forEach((atomId, index) => {
    const angle = (Math.PI / 3) * index;
    coords.set(atomId, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    });
  });
  return coords;
}

function exactRingOutwardAngle(graph, coords, anchorAtomId) {
  const outwardAngles = computeIncidentRingOutwardAngles(graph, anchorAtomId, atomId => coords.get(atomId) ?? null);
  assert.equal(outwardAngles.length, 1, `expected one local outward direction for ${anchorAtomId}`);
  return outwardAngles[0];
}

describe('layout/engine/placement/substituents', () => {
  it('chooses an outward attachment angle and places remaining branch atoms', () => {
    const adjacency = new Map([
      ['a0', ['a1', 'a2']],
      ['a1', ['a0']],
      ['a2', ['a0']]
    ]);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }]
    ]);
    const rank = new Map([
      ['a0', 0],
      ['a1', 1],
      ['a2', 2]
    ]);
    const angle = chooseAttachmentAngle(adjacency, coords, 'a0', new Set(['a0', 'a1', 'a2']));
    assert.ok(Number.isFinite(angle));

    placeRemainingBranches(adjacency, rank, coords, new Set(['a0', 'a1', 'a2']), ['a0', 'a1'], 1.5);
    assert.equal(coords.has('a2'), true);
  });

  it('keeps pending alkene attachments on trigonal continuation angles instead of the widest open gap', () => {
    const graph = createLayoutGraph(parseSMILES('CC=C'));
    const adjacency = new Map([
      ['C1', ['C2']],
      ['C2', ['C1', 'C3', 'H7']],
      ['C3', ['C2', 'H8', 'H9']],
      ['H7', ['C2']],
      ['H8', ['C3']],
      ['H9', ['C3']]
    ]);
    const coords = new Map([
      ['C1', { x: 0, y: 0 }],
      ['C2', { x: 1.5, y: 0 }]
    ]);
    const angle = chooseAttachmentAngle(adjacency, coords, 'C2', new Set(adjacency.keys()), null, graph, 'C3');

    assert.ok(
      angularDifference(angle, Math.PI / 3) < 1e-6 || angularDifference(angle, (5 * Math.PI) / 3) < 1e-6,
      `expected trigonal alkene continuation, got ${((angle * 180) / Math.PI).toFixed(2)}°`
    );
  });

  it('uses the exact local ring-outward angle for safe terminal hetero substituents', () => {
    const graph = createLayoutGraph(parseSMILES('C1CCCCC1O'), { suppressH: true });
    const adjacency = new Map([
      ['C1', ['C2', 'C6']],
      ['C2', ['C1', 'C3']],
      ['C3', ['C2', 'C4']],
      ['C4', ['C3', 'C5']],
      ['C5', ['C4', 'C6']],
      ['C6', ['C1', 'C5', 'O7']],
      ['O7', ['C6']]
    ]);
    const coords = new Map([
      ['C1', { x: -1.1, y: 0.3 }],
      ['C2', { x: -0.1, y: 1.25 }],
      ['C3', { x: 1.1, y: 1.1 }],
      ['C4', { x: 1.45, y: -0.1 }],
      ['C5', { x: 0.3, y: -1.1 }],
      ['C6', { x: -0.9, y: -0.8 }]
    ]);
    const exactOutwardAngle = exactRingOutwardAngle(graph, coords, 'C6');
    const angle = chooseAttachmentAngle(adjacency, coords, 'C6', new Set(adjacency.keys()), null, graph, 'O7');

    assert.ok(
      angularDifference(angle, exactOutwardAngle) < 1e-6,
      `expected exact ring-outward angle, got ${((angle * 180) / Math.PI).toFixed(2)}° vs ${((exactOutwardAngle * 180) / Math.PI).toFixed(2)}°`
    );
  });

  it('uses the exact local ring-outward angle for safe ether substituent roots', () => {
    const graph = createLayoutGraph(parseSMILES('COc1ccccc1'), { suppressH: true });
    const adjacency = buildAdjacency(graph);
    const coords = regularHexagonCoords(graph.rings[0].atomIds);
    const oxygenAtomId = [...graph.atoms.values()].find(atom => atom.element === 'O' && (graph.atomToRings.get(atom.id)?.length ?? 0) === 0)?.id;
    assert.ok(oxygenAtomId);
    const oxygenNeighbors = (adjacency.get(oxygenAtomId) ?? []);
    const anchorAtomId = oxygenNeighbors.find(atomId => (graph.atomToRings.get(atomId)?.length ?? 0) > 0);
    assert.ok(anchorAtomId);
    const angle = chooseAttachmentAngle(adjacency, coords, anchorAtomId, new Set(adjacency.keys()), null, graph, oxygenAtomId);
    const exactOutwardAngle = exactRingOutwardAngle(graph, coords, anchorAtomId);

    assert.ok(
      angularDifference(angle, exactOutwardAngle) < 1e-6,
      `expected ether root to follow the exact ring-outward angle, got ${((angle * 180) / Math.PI).toFixed(2)}° vs ${((exactOutwardAngle * 180) / Math.PI).toFixed(2)}°`
    );
  });

  it('uses the exact local ring-outward angle for safe benzylic nitrile roots', () => {
    const graph = createLayoutGraph(parseSMILES('N#Cc1ccccc1'), { suppressH: true });
    const adjacency = buildAdjacency(graph);
    const coords = regularHexagonCoords(graph.rings[0].atomIds);
    const nitrileCarbonAtomId = [...graph.atoms.values()].find(atom =>
      atom.element === 'C'
      && (graph.atomToRings.get(atom.id)?.length ?? 0) === 0
      && atom.heavyDegree === 2
      && (adjacency.get(atom.id) ?? []).some(neighborAtomId => graph.atoms.get(neighborAtomId)?.element === 'N')
    )?.id;
    assert.ok(nitrileCarbonAtomId);
    const anchorAtomId = (adjacency.get(nitrileCarbonAtomId) ?? []).find(atomId => (graph.atomToRings.get(atomId)?.length ?? 0) > 0);
    assert.ok(anchorAtomId);
    const angle = chooseAttachmentAngle(adjacency, coords, anchorAtomId, new Set(adjacency.keys()), null, graph, nitrileCarbonAtomId);
    const exactOutwardAngle = exactRingOutwardAngle(graph, coords, anchorAtomId);

    assert.ok(
      angularDifference(angle, exactOutwardAngle) < 1e-6,
      `expected nitrile root to follow the exact ring-outward angle, got ${((angle * 180) / Math.PI).toFixed(2)}° vs ${((exactOutwardAngle * 180) / Math.PI).toFixed(2)}°`
    );
  });
});
