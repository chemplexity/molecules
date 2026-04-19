import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../../src/io/smiles.js';
import { layoutIsolatedRingFamily } from '../../../../../src/layout/engine/families/isolated-ring.js';
import { angleOf, angularDifference, sub } from '../../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph } from '../../../../../src/layout/engine/model/layout-graph.js';
import { placeRemainingBranches } from '../../../../../src/layout/engine/placement/branch-placement/remaining-branches.js';

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

describe('layout/engine/placement/branch-placement/remaining-branches', () => {
  it('keeps safe off-grid ring-linker continuations on the exact zig-zag angle', () => {
    const graph = createLayoutGraph(parseSMILES('NC(CC1=CNC=N1)C(O)=O'), { suppressH: true });
    const componentAtomIds = new Set(graph.components[0].atomIds);
    const coords = new Map(
      layoutIsolatedRingFamily(graph.rings[0], graph.options.bondLength, {
        layoutGraph: graph,
        templateId: 'imidazole'
      }).coords
    );

    placeRemainingBranches(
      buildAdjacency(graph, componentAtomIds),
      graph.canonicalAtomRank,
      coords,
      componentAtomIds,
      [...coords.keys()],
      graph.options.bondLength,
      graph
    );

    const incomingAngle = angleOf(sub(coords.get('C4'), coords.get('C3')));
    const outgoingAngle = angleOf(sub(coords.get('C2'), coords.get('C3')));
    const continuationAngle = angularDifference(incomingAngle, outgoingAngle);

    assert.ok(
      Math.abs(continuationAngle - ((2 * Math.PI) / 3)) < 1e-6,
      `expected exact 120-degree continuation, got ${((continuationAngle * 180) / Math.PI).toFixed(2)}°`
    );
  });
});
