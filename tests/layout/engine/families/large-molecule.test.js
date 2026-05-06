import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/index.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { measureBondLengthDeviation } from '../../../../src/layout/engine/audit/invariants.js';
import { layoutLargeMoleculeFamily } from '../../../../src/layout/engine/families/large-molecule.js';
import { computeBounds } from '../../../../src/layout/engine/geometry/bounds.js';
import { layoutAtomSlice } from '../../../../src/layout/engine/placement/atom-slice.js';
import { makeLargeExplicitHydrogenPeptide, makeLargePolyaryl } from '../support/molecules.js';

const SULFATED_GLYCOSIDE_SMILES = 'CCCCCCCCCCCCO[C@H]1O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](OS(=O)(=O)O)[C@@H]1O[C@H]2O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]3O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]4O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]5O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](OS(=O)(=O)O)[C@@H]5OS(=O)(=O)O)[C@@H]4OS(=O)(=O)O)[C@@H]3OS(=O)(=O)O)[C@@H]2OS(=O)(=O)O';

/**
 * Returns the area of the current placed coordinate bounds.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number} Bounding-box area.
 */
function boundsArea(coords) {
  const bounds = computeBounds(coords, [...coords.keys()]);
  return bounds ? bounds.width * bounds.height : 0;
}

describe('layout/engine/families/large-molecule', () => {
  it('partitions and stitches a multi-block organic component', () => {
    const graph = createLayoutGraph(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    const result = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength);
    assert.equal(result.placementMode, 'block-stitched');
    assert.equal(result.coords.size, 34);
    assert.ok(result.blockCount > 1);
    assert.equal(typeof result.refinedStitchCount, 'number');
    assert.ok(result.coords.has('a0'));
    assert.ok(result.coords.has('b0'));
    assert.ok(result.coords.has('e0'));
  });

  it('falls back to a linear whole-component layout when the root block is unsupported', () => {
    const graph = createLayoutGraph(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    const result = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength, {
      sliceLayouter(layoutGraph, block) {
        return {
          family: 'acyclic',
          supported: false,
          atomIds: block.atomIds,
          coords: new Map()
        };
      }
    });

    assert.equal(result.placementMode, 'block-linear-fallback');
    assert.equal(result.coords.size, 34);
    assert.equal(result.rootFallbackUsed, true);
    assert.equal(result.linearFallbackCount, 1);
    assert.ok([...result.coords.values()].every(position => Math.abs(position.y) < 1e-9));
  });

  it('falls back linearly for unsupported child blocks instead of aborting the whole component', () => {
    const graph = createLayoutGraph(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    const result = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength, {
      sliceLayouter(layoutGraph, block, bondLength) {
        if (block.atomIds.includes('e0') && !block.atomIds.includes('a0')) {
          return {
            family: 'acyclic',
            supported: false,
            atomIds: block.atomIds,
            coords: new Map()
          };
        }
        return layoutAtomSlice(layoutGraph, block, bondLength);
      }
    });

    assert.equal(result.placementMode, 'block-stitched');
    assert.equal(result.coords.size, 34);
    assert.equal(result.rootFallbackUsed, false);
    assert.ok(result.linearFallbackCount >= 1);
    assert.ok(result.coords.has('e0'));
    assert.equal(typeof result.repulsionMoveCount, 'number');
  });

  it('keeps splitting explicit-h large blocks until mixed slices stay manageable', () => {
    const graph = createLayoutGraph(makeLargeExplicitHydrogenPeptide(), {
      suppressH: true
    });
    const start = Date.now();
    const result = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength);
    const bondDeviation = measureBondLengthDeviation(graph, result.coords, graph.options.bondLength, {
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.placementMode, 'block-stitched');
    assert.equal(result.rootFallbackUsed, false);
    assert.ok(result.blockCount > 4);
    assert.equal(result.coords.size > 0, true);
    assert.equal(bondDeviation.failingBondCount, 0);
    assert.ok(Date.now() - start < 25000);
  }, 20000);

  it('rotates stitched child subtrees when doing so compacts the packed block layout', () => {
    const graph = createLayoutGraph(makeLargePolyaryl(), {
      largeMoleculeThreshold: {
        heavyAtomCount: 12,
        ringSystemCount: 2,
        blockCount: 16
      }
    });
    const withoutRotationPacking = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength, {
      disableRotationPacking: true
    });
    const withRotationPacking = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength);

    assert.equal(withoutRotationPacking.placementMode, 'block-stitched');
    assert.equal(withRotationPacking.placementMode, 'block-stitched');
    assert.ok(withRotationPacking.rotationMoveCount >= 1);
    assert.ok(boundsArea(withRotationPacking.coords) < boundsArea(withoutRotationPacking.coords));
  });

  it('tries one alternate root for overlap-heavy bond-clean stitched placements without regressing the audit', () => {
    const graph = createLayoutGraph(
      parseSMILES(
        'O=C(N[C@@H](CC(C)C)C(N)=O)[C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H](NC([C@H](CCCCNC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)NC([C@H](CC(C)C)NC([C@@H]([NH3+])CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)=O)CCCC[NH3+])=O)=O)=O)CCCC[NH3+]'
      ),
      { suppressH: true }
    );
    const baseline = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength, {
      disableAlternateRootRetry: true
    });
    const retried = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength, {
      forceAlternateRootRetry: true
    });
    const baselineAudit = auditLayout(graph, baseline.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: baseline.bondValidationClasses
    });
    const retriedAudit = auditLayout(graph, retried.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: retried.bondValidationClasses
    });

    assert.equal(baselineAudit.bondLengthFailureCount, 0);
    assert.ok(baselineAudit.severeOverlapCount >= 4);
    assert.equal(retried.rootRetryAttemptCount, 1);
    assert.equal(retriedAudit.bondLengthFailureCount, 0);
    assert.ok(retriedAudit.severeOverlapCount <= baselineAudit.severeOverlapCount);
  });

  it('retries dense partitions for ring-rich sulfated glycosides before cleanup', () => {
    const graph = createLayoutGraph(parseSMILES(SULFATED_GLYCOSIDE_SMILES), {
      suppressH: true,
      finalLandscapeOrientation: true
    });
    const coarsePlacement = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength, {
      disableDensePartitionRetry: true
    });
    const densePlacement = layoutLargeMoleculeFamily(graph, graph.components[0], graph.options.bondLength);
    const coarseAudit = auditLayout(graph, coarsePlacement.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: coarsePlacement.bondValidationClasses
    });
    const denseAudit = auditLayout(graph, densePlacement.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: densePlacement.bondValidationClasses
    });

    assert.equal(coarsePlacement.blockCount, 2);
    assert.equal(densePlacement.densePartitionRetryUsed, true);
    assert.equal(densePlacement.blockCount, 12);
    assert.equal(denseAudit.bondLengthFailureCount, 0);
    assert.ok(denseAudit.severeOverlapCount < coarseAudit.severeOverlapCount);
    assert.ok(denseAudit.visibleHeavyBondCrossingCount <= coarseAudit.visibleHeavyBondCrossingCount);
  });
});
