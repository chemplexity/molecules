import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  convertForceCoordsToLineLayout,
  convertMolecule,
  convertLineCoordsToForceLayout,
  FORCE_LAYOUT_BOND_LENGTH,
  FORCE_LAYOUT_HEAVY_ANCHOR_RADIUS,
  FORCE_LAYOUT_HEAVY_ANCHOR_STRENGTH,
  FORCE_LAYOUT_H_BOND_LENGTH,
  FORCE_LAYOUT_MULTIPLE_BOND_FACTOR,
  FORCE_LAYOUT_AROMATIC_BOND_FACTOR,
  createForceAnchorRadiusForce,
  createForceHydrogenRepulsionForce,
  createForceHydrogenPlacementForce,
  createForceHelpers,
  forceLinkDistance,
  placeHydrogensAroundParent,
  reseatForceGraphHydrogens,
  zoomTransformsDiffer
} from '../../../src/app/render/force-helpers.js';
import { Molecule } from '../../../src/core/Molecule.js';

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

function approxEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

describe('force-helpers', () => {
  it('converts line coordinates to force coordinates while reseating hydrogens in stable slots', () => {
    const mol = new Molecule();
    const c1 = mol.addAtom('c1', 'C');
    const c2 = mol.addAtom('c2', 'C');
    const h1 = mol.addAtom('h1', 'H');
    c1.x = 0;
    c1.y = 0;
    c2.x = 1.5;
    c2.y = 0;
    h1.visible = false;
    mol.addBond('b1', 'c1', 'c2', { order: 1 }, false);
    mol.addBond('b2', 'c1', 'h1', { order: 1 }, false);

    const converted = convertLineCoordsToForceLayout(mol, {
      forceCenter: { x: 100, y: 50 }
    });
    const c1Coords = converted.coords.get('c1');
    const c2Coords = converted.coords.get('c2');
    const h1Coords = converted.coords.get('h1');

    assert.equal(converted.scale, FORCE_LAYOUT_BOND_LENGTH / 1.5);
    assert.equal(Math.hypot(c2Coords.x - c1Coords.x, c2Coords.y - c1Coords.y), FORCE_LAYOUT_BOND_LENGTH);
    assert.equal((c1Coords.x + c2Coords.x) / 2, 100);
    assert.equal(c1Coords.y, 50);
    assert.equal(c2Coords.y, 50);
    assert.ok(h1Coords.x < c1Coords.x, 'hydrogen should use the open force slot opposite the heavy neighbor');
    assert.ok(Math.abs(h1Coords.y - c1Coords.y) < 1e-6);
    assert.equal(h1Coords.forcePlacementParentId, 'c1');
    assert.equal(converted.forceAnchorCoords.get('c1').x, c1Coords.x);
  });

  it('converts force coordinates back to line coordinates and omits hidden hydrogens by default', () => {
    const mol = new Molecule();
    const c1 = mol.addAtom('c1', 'C');
    const c2 = mol.addAtom('c2', 'C');
    const h1 = mol.addAtom('h1', 'H');
    c1.x = -0.75;
    c1.y = 0;
    c2.x = 0.75;
    c2.y = 0;
    h1.visible = false;
    mol.addBond('b1', 'c1', 'c2', { order: 1 }, false);
    mol.addBond('b2', 'c1', 'h1', { order: 1 }, false);

    const forceLayout = convertLineCoordsToForceLayout(mol, {
      forceCenter: { x: 300, y: 200 }
    });
    const lineLayout = convertForceCoordsToLineLayout(mol, forceLayout.nodes);

    assert.deepEqual([...lineLayout.coords.keys()].sort(), ['c1', 'c2']);
    assert.equal(lineLayout.coords.get('c1').x, -0.75);
    assert.equal(lineLayout.coords.get('c1').y, 0);
    assert.equal(lineLayout.coords.get('c2').x, 0.75);
    assert.equal(lineLayout.coords.get('c2').y, 0);
  });

  it('can preserve force hydrogen coordinates when converting back to line coordinates', () => {
    const mol = new Molecule();
    mol.addAtom('c1', 'C');
    const h1 = mol.addAtom('h1', 'H');
    h1.visible = false;
    mol.addBond('b1', 'c1', 'h1', { order: 1 }, false);
    const forceNodes = [
      { id: 'c1', name: 'C', x: 100, y: 100 },
      { id: 'h1', name: 'H', x: 100, y: 120 }
    ];

    const lineLayout = convertForceCoordsToLineLayout(mol, forceNodes, {
      hydrogenMode: 'preserve'
    });

    assert.deepEqual([...lineLayout.coords.keys()].sort(), ['c1', 'h1']);
    assert.equal(lineLayout.coords.get('c1').x, 0);
    assert.equal(lineLayout.coords.get('c1').y, 0);
    assert.equal(lineLayout.coords.get('h1').x, 0);
    assert.equal(lineLayout.coords.get('h1').y, -20 * (1.5 / FORCE_LAYOUT_BOND_LENGTH));
  });

  it('computes force link distances for heavy, hydrogen, and aromatic bonds', () => {
    assert.equal(forceLinkDistance({ source: { name: 'C' }, target: { name: 'C' }, order: 1 }), FORCE_LAYOUT_BOND_LENGTH);
    assert.equal(forceLinkDistance({ source: { name: 'H' }, target: { name: 'C' }, order: 1 }), FORCE_LAYOUT_H_BOND_LENGTH);
    assert.equal(forceLinkDistance({ source: { name: 'C' }, target: { name: 'C' }, order: 2 }), FORCE_LAYOUT_BOND_LENGTH * FORCE_LAYOUT_MULTIPLE_BOND_FACTOR);
    assert.equal(forceLinkDistance({ source: { name: 'C' }, target: { name: 'C' }, order: 1.5 }), FORCE_LAYOUT_BOND_LENGTH * FORCE_LAYOUT_AROMATIC_BOND_FACTOR);
    assert.equal(forceLinkDistance({ source: { name: 'C' }, target: { name: 'C' }, order: 1 }, { layoutBondLength: 2.5 }), FORCE_LAYOUT_BOND_LENGTH * (2.5 / 1.5));
    assert.equal(forceLinkDistance({ source: { name: 'H' }, target: { name: 'C' }, order: 1 }, { layoutBondLength: 2.5 }), FORCE_LAYOUT_H_BOND_LENGTH * (2.5 / 1.5));
  });

  it('keeps force aromatic links at 1.5 while rendering localized ring orders when available', () => {
    const mol = new Molecule();
    const c1 = mol.addAtom('c1', 'C', { aromatic: true });
    const c2 = mol.addAtom('c2', 'C', { aromatic: true });
    c1.x = 0;
    c1.y = 0;
    c2.x = 1.5;
    c2.y = 0;
    const bond = mol.addBond('b1', 'c1', 'c2', { aromatic: true }, false);
    bond.properties.localizedOrder = 2;

    const graph = convertMolecule(mol);
    const forceLayout = convertLineCoordsToForceLayout(mol);

    assert.equal(graph.links[0].order, 1.5);
    assert.equal(graph.links[0].renderOrder, 2);
    assert.equal(graph.links[0].aromatic, true);
    assert.equal(forceLayout.links[0].order, 1.5);
    assert.equal(forceLayout.links[0].renderOrder, 2);
    assert.equal(forceLayout.links[0].aromatic, true);
  });

  it('renders standalone force 1.5 bonds as 1.5 when no localized order exists', () => {
    const mol = new Molecule();
    const c1 = mol.addAtom('c1', 'C');
    const c2 = mol.addAtom('c2', 'C');
    c1.x = 0;
    c1.y = 0;
    c2.x = 1.5;
    c2.y = 0;
    mol.addBond('b1', 'c1', 'c2', { order: 1 }, false).setAromatic(true);

    const graph = convertMolecule(mol);
    const forceLayout = convertLineCoordsToForceLayout(mol);

    assert.equal(graph.links[0].order, 1.5);
    assert.equal(graph.links[0].renderOrder, 1.5);
    assert.equal(forceLayout.links[0].order, 1.5);
    assert.equal(forceLayout.links[0].renderOrder, 1.5);
  });

  it('allows force auto-fit to zoom closer for short layout bond lengths', () => {
    const nodes = [
      { id: 'c1', name: 'C', protons: 6, x: 100, y: 100 },
      { id: 'c2', name: 'C', protons: 6, x: 140, y: 100 }
    ];
    const makeHelpers = layoutBondLength =>
      createForceHelpers({
        d3: { zoomIdentity: makeZoomIdentity() },
        plotEl: { clientWidth: 600, clientHeight: 400 },
        simulation: {
          nodes: () => [],
          force: () => ({ links: () => [] })
        },
        viewportFitPadding: pad => ({ left: pad, right: pad, top: pad, bottom: pad }),
        getLayoutBondLength: () => layoutBondLength,
        generate2dCoords: () => {},
        alignReaction2dProductOrientation: () => {},
        spreadReaction2dProductComponents: () => {},
        centerReaction2dPairCoords: () => {}
    });

    assert.equal(makeHelpers(1.5).forceFitTransform(nodes, 40, { scaleMultiplier: 1.3 }).k, 1.3);
    approxEqual(makeHelpers(0.5).forceFitTransform(nodes, 40, { scaleMultiplier: 1.3 }).k, 3.9);
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

  it('nudges force hydrogens toward stable open slots around their parent', () => {
    const parentNode = { id: 'c1', name: 'C', x: 0, y: 0 };
    const heavyNeighbor = { id: 'c2', name: 'C', x: 20, y: 0 };
    const hydrogen = { id: 'h1', name: 'H', x: 0, y: 20, vx: 0, vy: 0 };
    const hydrogenPlacement = createForceHydrogenPlacementForce(
      [
        { source: parentNode, target: heavyNeighbor },
        { source: parentNode, target: hydrogen }
      ],
      { distance: 20, strength: 0.5, rigid: false }
    );
    hydrogenPlacement.initialize([parentNode, heavyNeighbor, hydrogen]);

    hydrogenPlacement(1);

    assert.ok(hydrogen.vx < 0, 'expected hydrogen to move opposite the occupied heavy-atom bond');
    assert.ok(hydrogen.vy < 0, 'expected hydrogen to move back toward the parent-centered slot');
  });

  it('spreads multiple force hydrogens into separate parent slots', () => {
    const parentNode = { id: 'c1', name: 'C', x: 0, y: 0 };
    const heavyNeighbor = { id: 'c2', name: 'C', x: 20, y: 0 };
    const hydrogenA = { id: 'h1', name: 'H', x: 0, y: 0, vx: 0, vy: 0 };
    const hydrogenB = { id: 'h2', name: 'H', x: 0, y: 0, vx: 0, vy: 0 };
    const hydrogenPlacement = createForceHydrogenPlacementForce(
      [
        { source: parentNode, target: heavyNeighbor },
        { source: parentNode, target: hydrogenB },
        { source: parentNode, target: hydrogenA }
      ],
      { distance: 20 }
    );
    hydrogenPlacement.initialize([parentNode, heavyNeighbor, hydrogenA, hydrogenB]);

    hydrogenPlacement(1);

    assert.ok(hydrogenA.x < 0, 'first hydrogen should use the largest open slot opposite the heavy bond');
    assert.ok(Math.abs(hydrogenA.y) < 1e-6);
    assert.equal(hydrogenA.vx, 0);
    assert.equal(hydrogenA.vy, 0);
    assert.ok(hydrogenB.x < 1e-6, 'second hydrogen should not collapse onto the first slot');
    assert.ok(hydrogenB.y > 0);
    assert.equal(hydrogenB.vx, 0);
    assert.equal(hydrogenB.vy, 0);
  });

  it('keeps force hydrogens on their assigned parent slot between ticks', () => {
    const parentNode = { id: 'c1', name: 'C', x: 0, y: 0 };
    const heavyNeighbor = { id: 'c2', name: 'C', x: 20, y: 0 };
    const hydrogen = {
      id: 'h1',
      name: 'H',
      x: 0,
      y: 20,
      vx: 3,
      vy: 4,
      forcePlacementParentId: 'c1',
      forcePlacementAngle: Math.PI / 2
    };
    const hydrogenPlacement = createForceHydrogenPlacementForce(
      [
        { source: parentNode, target: heavyNeighbor },
        { source: parentNode, target: hydrogen }
      ],
      { distance: 20 }
    );
    hydrogenPlacement.initialize([parentNode, heavyNeighbor, hydrogen]);

    hydrogenPlacement(1);
    heavyNeighbor.x = -20;
    hydrogenPlacement(1);

    assert.ok(Math.abs(hydrogen.x) < 1e-6);
    assert.ok(Math.abs(hydrogen.y - 20) < 1e-6);
    assert.equal(hydrogen.vx, 0);
    assert.equal(hydrogen.vy, 0);
  });

  it('does not repel hydrogens bonded to the same parent atom', () => {
    const parentNode = { id: 'c1', name: 'C', x: 0, y: 0 };
    const hydrogenA = { id: 'h1', name: 'H', x: 20, y: 0, vx: 0, vy: 0 };
    const hydrogenB = { id: 'h2', name: 'H', x: -10, y: 17.32, vx: 0, vy: 0 };
    const hydrogenC = { id: 'h3', name: 'H', x: -10, y: -17.32, vx: 0, vy: 0 };
    const hydrogenRepulsion = createForceHydrogenRepulsionForce(40, 30, [
      { source: parentNode, target: hydrogenA },
      { source: parentNode, target: hydrogenB },
      { source: parentNode, target: hydrogenC }
    ]);
    hydrogenRepulsion.initialize([parentNode, hydrogenA, hydrogenB, hydrogenC]);

    hydrogenRepulsion(1);

    assert.equal(hydrogenA.vx, 0);
    assert.equal(hydrogenA.vy, 0);
    assert.equal(hydrogenB.vx, 0);
    assert.equal(hydrogenB.vy, 0);
    assert.equal(hydrogenC.vx, 0);
    assert.equal(hydrogenC.vy, 0);
  });

  it('still repels close hydrogens bonded to different parent atoms', () => {
    const parentA = { id: 'c1', name: 'C', x: 0, y: 0 };
    const parentB = { id: 'c2', name: 'C', x: 30, y: 0 };
    const hydrogenA = { id: 'h1', name: 'H', x: 10, y: 0, vx: 0, vy: 0 };
    const hydrogenB = { id: 'h2', name: 'H', x: 20, y: 0, vx: 0, vy: 0 };
    const hydrogenRepulsion = createForceHydrogenRepulsionForce(40, 30, [
      { source: parentA, target: hydrogenA },
      { source: parentB, target: hydrogenB }
    ]);
    hydrogenRepulsion.initialize([parentA, parentB, hydrogenA, hydrogenB]);

    hydrogenRepulsion(1);

    assert.ok(hydrogenA.vx < 0);
    assert.equal(hydrogenA.vy, 0);
    assert.ok(hydrogenB.vx > 0);
    assert.equal(hydrogenB.vy, 0);
  });

  it('reseats graph hydrogens and clears their initial velocity', () => {
    const parentNode = { id: 'c1', name: 'C', x: 0, y: 0 };
    const heavyNeighbor = { id: 'c2', name: 'C', x: 20, y: 0 };
    const hydrogen = { id: 'h1', name: 'H', x: 4, y: 5, vx: 8, vy: -6 };
    const graph = {
      nodes: [parentNode, heavyNeighbor, hydrogen],
      links: [
        { source: parentNode, target: heavyNeighbor },
        { source: parentNode, target: hydrogen }
      ]
    };

    reseatForceGraphHydrogens(graph);

    assert.ok(hydrogen.x < 0);
    assert.ok(Math.abs(hydrogen.y) < 1e-6);
    assert.equal(hydrogen.vx, 0);
    assert.equal(hydrogen.vy, 0);
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

  it('uses rigid default anchors so force layouts stay close to the 2D seed', () => {
    const anchorForce = createForceAnchorRadiusForce();
    const node = {
      id: 'c1',
      name: 'C',
      x: FORCE_LAYOUT_HEAVY_ANCHOR_RADIUS * 2,
      y: 0,
      vx: 0,
      vy: 0,
      anchorX: 0,
      anchorY: 0
    };
    anchorForce.initialize([node]);

    anchorForce(1);

    assert.ok(node.vx < -FORCE_LAYOUT_HEAVY_ANCHOR_STRENGTH * FORCE_LAYOUT_HEAVY_ANCHOR_RADIUS);
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
      generate2dCoords: () => {},
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
    helpers.patchForceNodePositions(new Map([['h1', { x: 80, y: 120, forcePlacementParentId: 'c1', forcePlacementAngle: Math.PI }]]));
    assert.equal(simulation._nodes[1].forcePlacementParentId, 'c1');
    assert.equal(simulation._nodes[1].forcePlacementAngle, Math.PI);
  });

  it('preserves force hydrogen slot metadata when reusing previous node positions', () => {
    const helpers = createForceHelpers({
      d3: { zoomIdentity: makeZoomIdentity() },
      plotEl: { clientWidth: 600, clientHeight: 400 },
      simulation: {
        nodes: () => [],
        force: () => ({ links: () => [] })
      },
      viewportFitPadding: pad => ({ left: pad, right: pad, top: pad, bottom: pad }),
      generate2dCoords: () => {},
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
    const previousNodePositions = new Map([
      [
        'h1',
        {
          x: 111,
          y: 222,
          vx: 5,
          vy: -7,
          fx: undefined,
          fy: undefined,
          forcePlacementParentId: 'c1',
          forcePlacementAngle: Math.PI / 3
        }
      ]
    ]);

    helpers.seedForceNodePositions(graph, null, new Map([['c1', { x: 0, y: 0 }]]), {
      previousNodePositions
    });

    assert.equal(graph.nodes[1].x, 111);
    assert.equal(graph.nodes[1].y, 222);
    assert.equal(graph.nodes[1].vx, 0);
    assert.equal(graph.nodes[1].vy, 0);
    assert.equal(graph.nodes[1].forcePlacementParentId, 'c1');
    assert.equal(graph.nodes[1].forcePlacementAngle, Math.PI / 3);
  });

  it('compares zoom transforms with a small tolerance', () => {
    assert.equal(zoomTransformsDiffer({ x: 1, y: 2, k: 3 }, { x: 1.0004, y: 2.0004, k: 3.0004 }), false);
    assert.equal(zoomTransformsDiffer({ x: 1, y: 2, k: 3 }, { x: 1.01, y: 2, k: 3 }), true);
  });
});
