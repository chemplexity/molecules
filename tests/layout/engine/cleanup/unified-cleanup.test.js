import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { findSevereOverlaps, measureLayoutCost } from '../../../../src/layout/engine/audit/invariants.js';
import { runLocalCleanup } from '../../../../src/layout/engine/cleanup/local-rotation.js';
import { resolveOverlaps } from '../../../../src/layout/engine/cleanup/overlap-resolution.js';
import { collectCutSubtree } from '../../../../src/layout/engine/cleanup/subtree-utils.js';
import { runUnifiedCleanup } from '../../../../src/layout/engine/cleanup/unified-cleanup.js';
import { add, rotate, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { normalizeOptions } from '../../../../src/layout/engine/options.js';
import { resolveProfile } from '../../../../src/layout/engine/profile.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';
import { resolvePolicy } from '../../../../src/layout/engine/standards/profile-policy.js';
import { makeLargeExplicitHydrogenPeptide } from '../support/molecules.js';

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

/**
 * Rotates one side of a cut bond while preserving all bond lengths on the moved side.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Source coordinates.
 * @param {string} anchorAtomId - Fixed atom across the cut bond.
 * @param {string} rootAtomId - Root atom on the moved side.
 * @param {number} angle - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>} Perturbed coordinates.
 */
function rotateCutSubtree(layoutGraph, coords, anchorAtomId, rootAtomId, angle) {
  const anchorPosition = coords.get(anchorAtomId);
  const rotatedCoords = new Map();
  for (const [atomId, position] of coords) {
    rotatedCoords.set(atomId, { x: position.x, y: position.y });
  }
  if (!anchorPosition) {
    return rotatedCoords;
  }

  for (const atomId of collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    rotatedCoords.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), angle)));
  }
  return rotatedCoords;
}

describe('layout/engine/cleanup/unified-cleanup', () => {
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
    const smiles =
      'CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O';
    const graph = createLayoutGraph(parseSMILES(smiles), normalizeOptions({ suppressH: true }));
    const policy = resolvePolicy(resolveProfile(graph.options.profile), graph.traits);
    const placement = layoutSupportedComponents(graph, policy);
    const crowdedCoords = rotateCutSubtree(graph, placement.coords, 'C20', 'O28', (2 * Math.PI) / 3);
    const beforeOverlapCount = findSevereOverlaps(graph, crowdedCoords, graph.options.bondLength).length;
    const result = runUnifiedCleanup(graph, crowdedCoords, {
      bondLength: graph.options.bondLength,
      maxPasses: graph.options.maxCleanupPasses
    });
    const afterAudit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });

    assert.ok(beforeOverlapCount > 0);
    assert.ok(findSevereOverlaps(graph, result.coords, graph.options.bondLength).length <= beforeOverlapCount);
    assert.ok(result.overlapMoves > 0);
    assert.ok(result.passes >= result.overlapMoves);
    assert.equal(afterAudit.severeOverlapCount, 0);
    assert.equal(afterAudit.bondLengthFailureCount, 0);
  });

  it('does not trade large-molecule backbone bond integrity for overlap cleanup', () => {
    const graph = createLayoutGraph(
      parseSMILES(
        'O=C([C@H](CCCCNC([C@@H](NC([C@@H](NC([C@H](CCCCNC([C@H]1N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]2CCCN2C([C@@H](NC(C3=CC=C(O[C@H]4[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O4)C=C3)=O)CCCC[NH3+])=O)=O)NC([C@@H]5CCCN5C([C@@H](NC(C6=CC=C(O[C@H]7[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O7)C=C6)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC1)=O)NC([C@H]8N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]9CCCN9C([C@@H](NC(C%10=CC=C(O[C@@H]%11O[C@H](CO)[C@H](O)[C@H](O)[C@H]%11O)C=C%10)=O)CCCC[NH3+])=O)=O)NC([C@@H]%12CCCN%12C([C@@H](NC(C%13=CC=C(O[C@@H]%14O[C@H](CO)[C@H](O)[C@H](O)[C@H]%14O)C=C%13)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC8)=O)=O)CCCC[NH3+])=O)[C@@H](C)CC)=O)NC([C@@H](NC([C@@H](NC([C@H](CCCCNC([C@H]%15N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]%16CCCN%16C([C@@H](NC(C%17=CC=C(O[C@@H]%18O[C@H](CO)[C@H](O)[C@H](O)[C@H]%18O)C=C%17)=O)CCCC[NH3+])=O)=O)NC([C@@H]%19CCCN%19C([C@@H](NC(C%20=CC=C(O[C@@H]%21O[C@H](CO)[C@H](O)[C@H](O)[C@H]%21O)C=C%20)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC%15)=O)NC([C@H]%22N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]%23CCCN%23C([C@@H](NC(C%24=CC=C(O[C@H]%25[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O%25)C=C%24)=O)CCCC[NH3+])=O)=O)NC([C@@H]%26CCCN%26C([C@@H](NC(C%27=CC=C(O[C@H]%28[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O%28)C=C%27)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC%22)=O)=O)CCCC[NH3+])=O)[C@@H](C)CC)=O)N[C@@H](CC%29=CN=CN%29)C(N[C@@H]([C@H](CC)C)C(N)=O)=O'
      ),
      normalizeOptions({ suppressH: true })
    );
    const placement = layoutSupportedComponents(graph);
    const beforeAudit = auditLayout(graph, placement.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    const cleaned = runUnifiedCleanup(graph, placement.coords, {
      bondLength: graph.options.bondLength,
      maxPasses: 3,
      protectLargeMoleculeBackbone: true
    });
    const afterAudit = auditLayout(graph, cleaned.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });

    assert.deepEqual(placement.placedFamilies, ['large-molecule']);
    assert.equal(beforeAudit.bondLengthFailureCount, 0);
    assert.equal(afterAudit.bondLengthFailureCount, 0);
    assert.ok(afterAudit.severeOverlapCount <= beforeAudit.severeOverlapCount);
    assert.ok(afterAudit.maxBondLengthDeviation < 0.05);
  });

  it('uses stitched large-molecule block subtrees to reduce overlaps beyond protected atom nudges', () => {
    const graph = createLayoutGraph(makeLargeExplicitHydrogenPeptide(), normalizeOptions({ suppressH: true }));
    const placement = layoutSupportedComponents(graph);
    const plainFirstPassCleanup = runUnifiedCleanup(graph, placement.coords, {
      bondLength: graph.options.bondLength,
      maxPasses: 1,
      protectLargeMoleculeBackbone: true
    });
    const blockAwareFirstPassCleanup = runUnifiedCleanup(graph, placement.coords, {
      bondLength: graph.options.bondLength,
      maxPasses: 1,
      protectLargeMoleculeBackbone: true,
      cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId
    });
    const plainCleanup = runUnifiedCleanup(graph, placement.coords, {
      bondLength: graph.options.bondLength,
      maxPasses: 3,
      protectLargeMoleculeBackbone: true
    });
    const blockAwareCleanup = runUnifiedCleanup(graph, placement.coords, {
      bondLength: graph.options.bondLength,
      maxPasses: 3,
      protectLargeMoleculeBackbone: true,
      cleanupRigidSubtreesByAtomId: placement.cleanupRigidSubtreesByAtomId
    });
    const plainAudit = auditLayout(graph, plainCleanup.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    const plainFirstPassAudit = auditLayout(graph, plainFirstPassCleanup.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    const blockAwareAudit = auditLayout(graph, blockAwareCleanup.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    const blockAwareFirstPassAudit = auditLayout(graph, blockAwareFirstPassCleanup.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });

    assert.deepEqual(placement.placedFamilies, ['large-molecule']);
    assert.ok(placement.cleanupRigidSubtreesByAtomId instanceof Map);
    assert.ok(placement.cleanupRigidSubtreesByAtomId.size > 0);
    assert.equal(plainAudit.bondLengthFailureCount, 0);
    assert.equal(blockAwareAudit.bondLengthFailureCount, 0);
    assert.ok(
      blockAwareFirstPassAudit.severeOverlapCount < plainFirstPassAudit.severeOverlapCount
      || (
        blockAwareFirstPassAudit.severeOverlapCount === plainFirstPassAudit.severeOverlapCount
        && blockAwareFirstPassAudit.severeOverlapPenalty <= plainFirstPassAudit.severeOverlapPenalty
      )
    );
    assert.ok(blockAwareAudit.severeOverlapCount <= plainAudit.severeOverlapCount);
    assert.ok(blockAwareFirstPassCleanup.overlapMoves >= plainFirstPassCleanup.overlapMoves);
    assert.ok(blockAwareCleanup.overlapMoves >= plainCleanup.overlapMoves);
  });
});
