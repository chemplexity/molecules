import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { layoutLargeMoleculeFamily } from '../../../src/layoutv2/families/large-molecule.js';
import { computeBounds } from '../../../src/layoutv2/geometry/bounds.js';
import { layoutAtomSlice } from '../../../src/layoutv2/placement/atom-slice.js';
import { makeLargeExplicitHydrogenPeptide, makeLargePolyaryl } from '../support/molecules.js';

/**
 * Returns the area of the current placed coordinate bounds.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number} Bounding-box area.
 */
function boundsArea(coords) {
  const bounds = computeBounds(coords, [...coords.keys()]);
  return bounds ? bounds.width * bounds.height : 0;
}

describe('layoutv2/families/large-molecule', () => {
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

    assert.equal(result.placementMode, 'block-stitched');
    assert.equal(result.rootFallbackUsed, false);
    assert.ok(result.blockCount > 4);
    assert.equal(result.coords.size > 0, true);
    assert.ok(Date.now() - start < 15000);
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
});
