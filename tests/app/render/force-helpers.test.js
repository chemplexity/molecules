import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORCE_LAYOUT_BOND_LENGTH,
  FORCE_LAYOUT_H_BOND_LENGTH,
  FORCE_LAYOUT_MULTIPLE_BOND_FACTOR,
  FORCE_LAYOUT_AROMATIC_BOND_FACTOR,
  createForceAnchorRadiusForce,
  createForceHelpers,
  forceLinkDistance,
  placeHydrogensAroundParent,
  zoomTransformsDiffer
} from '../../../src/app/render/force-helpers.js';

function makeZoomIdentity() {
  return {
    translate(x, y) {
      return {
        x,
        y,
        scale(k) {
          return { x, y, k };
        }
      };
    }
  };
}

describe('force-helpers', () => {
  it('computes force link distances for heavy, hydrogen, and aromatic bonds', () => {
    assert.equal(forceLinkDistance({ source: { name: 'C' }, target: { name: 'C' }, order: 1 }), FORCE_LAYOUT_BOND_LENGTH);
    assert.equal(forceLinkDistance({ source: { name: 'H' }, target: { name: 'C' }, order: 1 }), FORCE_LAYOUT_H_BOND_LENGTH);
    assert.equal(forceLinkDistance({ source: { name: 'C' }, target: { name: 'C' }, order: 2 }), FORCE_LAYOUT_BOND_LENGTH * FORCE_LAYOUT_MULTIPLE_BOND_FACTOR);
    assert.equal(forceLinkDistance({ source: { name: 'C' }, target: { name: 'C' }, order: 1.5 }), FORCE_LAYOUT_BOND_LENGTH * FORCE_LAYOUT_AROMATIC_BOND_FACTOR);
  });

  it('places hydrogens into open angles around the parent atom', () => {
    const parentNode = { id: 'c1', x: 0, y: 0 };
    const hydrogen = { id: 'h1', name: 'H' };
    const occupiedNeighbor = { id: 'c2', x: 20, y: 0 };
    const links = [{ source: parentNode, target: occupiedNeighbor }];

    placeHydrogensAroundParent(parentNode, [hydrogen], links);

    assert.ok(hydrogen.x < 0);
    assert.ok(Math.abs(hydrogen.y) < 1e-6);
    assert.equal(hydrogen.anchorX, hydrogen.x);
    assert.equal(hydrogen.anchorY, hydrogen.y);
  });

  it('keeps heavy atoms gently tethered to the seeded 2D anchor shape', () => {
    const anchorForce = createForceAnchorRadiusForce(10, 0.3);
    const nearNode = { id: 'c1', name: 'C', x: 6, y: 0, vx: 0, vy: 0, anchorX: 0, anchorY: 0 };
    const farNode = { id: 'c2', name: 'C', x: 16, y: 0, vx: 0, vy: 0, anchorX: 0, anchorY: 0 };
    anchorForce.initialize([nearNode, farNode]);

    anchorForce(1);

    assert.ok(nearNode.vx < 0, 'near nodes should still be nudged back toward the 2D seed');
    assert.ok(farNode.vx < nearNode.vx, 'farther nodes should be pulled back more strongly');
  });

  it('seeds positions and patches force nodes through the extracted helper bundle', () => {
    const records = [];
    const linkForce = {
      linksValue: [],
      links() {
        return this.linksValue;
      }
    };
    const simulation = {
      _nodes: [
        { id: 'c1', name: 'C', x: 10, y: 20, vx: 1, vy: 1 },
        { id: 'h1', name: 'H', x: 15, y: 20, vx: 1, vy: 1 }
      ],
      nodes() {
        return this._nodes;
      },
      force(name) {
        assert.equal(name, 'link');
        return linkForce;
      },
      alpha(value) {
        if (value !== undefined) {
          records.push(['alpha', value]);
          return this;
        }
        return 0.02;
      },
      restart() {
        records.push(['restart']);
        return this;
      }
    };

    const helpers = createForceHelpers({
      d3: { zoomIdentity: makeZoomIdentity() },
      plotEl: { clientWidth: 600, clientHeight: 400 },
      simulation,
      viewportFitPadding: pad => ({ left: pad, right: pad, top: pad, bottom: pad }),
      generateAndRefine2dCoords: () => {},
      alignReaction2dProductOrientation: () => {},
      spreadReaction2dProductComponents: () => {},
      centerReaction2dPairCoords: () => {}
    });

    const graph = {
      nodes: [
        { id: 'c1', name: 'C', protons: 6 },
        { id: 'h1', name: 'H', protons: 1 }
      ],
      links: [{ source: 0, target: 1, order: 1 }]
    };
    const anchorLayout = new Map([['c1', { x: 0, y: 0 }]]);

    helpers.seedForceNodePositions(graph, null, anchorLayout);

    assert.equal(graph.nodes[0].x, 300);
    assert.equal(graph.nodes[0].y, 200);
    assert.ok(Number.isFinite(graph.nodes[1].x));
    assert.ok(Number.isFinite(graph.nodes[1].y));

    linkForce.linksValue = [{ source: simulation._nodes[0], target: simulation._nodes[1] }];
    const patchPos = new Map([['c1', { x: 100, y: 120 }]]);
    helpers.patchForceNodePositions(patchPos);
    helpers.reseatHydrogensAroundPatched(patchPos);

    assert.equal(simulation._nodes[0].x, 100);
    assert.equal(simulation._nodes[0].y, 120);
    assert.equal(simulation._nodes[0].anchorX, 100);
    assert.equal(simulation._nodes[0].anchorY, 120);
    assert.ok(records.some(([kind]) => kind === 'restart'));
    assert.ok(Number.isFinite(simulation._nodes[1].x));
    assert.ok(Number.isFinite(simulation._nodes[1].y));
  });

  it('compares zoom transforms with a small tolerance', () => {
    assert.equal(zoomTransformsDiffer({ x: 1, y: 2, k: 3 }, { x: 1.0004, y: 2.0004, k: 3.0004 }), false);
    assert.equal(zoomTransformsDiffer({ x: 1, y: 2, k: 3 }, { x: 1.01, y: 2, k: 3 }), true);
  });
});
