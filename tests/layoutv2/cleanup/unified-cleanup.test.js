import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { findSevereOverlaps, measureLayoutCost } from '../../../src/layoutv2/audit/invariants.js';
import { runLocalCleanup } from '../../../src/layoutv2/cleanup/local-rotation.js';
import { resolveOverlaps } from '../../../src/layoutv2/cleanup/overlap-resolution.js';
import { runUnifiedCleanup } from '../../../src/layoutv2/cleanup/unified-cleanup.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { normalizeOptions } from '../../../src/layoutv2/options.js';
import { resolveProfile } from '../../../src/layoutv2/profile.js';
import { layoutSupportedComponents } from '../../../src/layoutv2/placement/component-layout.js';
import { resolvePolicy } from '../../../src/layoutv2/standards/profile-policy.js';

/**
 * Returns the synthetic geminal cyclohexane clump used to exercise cleanup strategy choice.
 * @returns {{graph: object, coords: Map<string, {x: number, y: number}>}} Layout graph and synthetic coordinates.
 */
function makeGeminalCyclohexaneClump() {
  return {
    graph: createLayoutGraph(parseSMILES('CC1(C)CCCCC1'), { suppressH: true }),
    coords: new Map([
      ['C2', { x: 0, y: 0 }],
      ['C4', { x: 1.5, y: 0 }],
      ['C5', { x: 2.25, y: -1.299038105676658 }],
      ['C6', { x: 3.75, y: -1.299038105676658 }],
      ['C7', { x: 4.5, y: 0 }],
      ['C8', { x: 3.75, y: 1.299038105676658 }],
      ['C1', { x: 1.3, y: 0.25 }],
      ['C3', { x: 1.3, y: -0.25 }]
    ])
  };
}

describe('layoutv2/cleanup/unified-cleanup', () => {
  it('resolves a geminal ring clump in fewer accepted steps than sequential cleanup phases', () => {
    const { graph, coords } = makeGeminalCyclohexaneClump();
    const overlapFirst = resolveOverlaps(graph, coords, { bondLength: 1.5, maxPasses: 6 });
    const sequential = runLocalCleanup(graph, overlapFirst.coords, { bondLength: 1.5, maxPasses: 6 });
    const unified = runUnifiedCleanup(graph, coords, { bondLength: 1.5, maxPasses: 6 });

    assert.equal(findSevereOverlaps(graph, unified.coords, 1.5).length, 0);
    assert.ok(measureLayoutCost(graph, unified.coords, 1.5) <= measureLayoutCost(graph, sequential.coords, 1.5) + 1e-9);
    assert.ok(unified.passes < overlapFirst.moves + sequential.passes);
  });

  it('stops early when rerun on an already settled cleanup result', () => {
    const { graph, coords } = makeGeminalCyclohexaneClump();
    const settled = runUnifiedCleanup(graph, coords, { bondLength: 1.5, maxPasses: 6 });
    const rerun = runUnifiedCleanup(graph, settled.coords, { bondLength: 1.5, maxPasses: 6 });

    assert.equal(rerun.passes, 0);
    assert.equal(rerun.overlapMoves, 0);
    assert.equal(rerun.improvement, 0);
    assert.deepEqual([...rerun.coords.entries()], [...settled.coords.entries()]);
  });

  it('prioritizes overlap-reducing cleanup moves first on large crowded macrocycles', () => {
    const smiles = 'CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O';
    const graph = createLayoutGraph(parseSMILES(smiles), normalizeOptions({ suppressH: true }));
    const policy = resolvePolicy(resolveProfile(graph.options.profile), graph.traits);
    const placement = layoutSupportedComponents(graph, policy);
    const beforeOverlapCount = findSevereOverlaps(graph, placement.coords, graph.options.bondLength).length;
    const result = runUnifiedCleanup(graph, placement.coords, {
      bondLength: graph.options.bondLength,
      maxPasses: graph.options.maxCleanupPasses
    });

    assert.ok(beforeOverlapCount > 0);
    assert.equal(findSevereOverlaps(graph, result.coords, graph.options.bondLength).length, 0);
    assert.ok(result.overlapMoves > 0);
    assert.ok(result.passes >= result.overlapMoves);
  });
});
