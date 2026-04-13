import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import {
  buildComponentFixedCoords,
  buildRefinementContext,
  canPreserveComponentPlacement,
  deriveTouchedAtomIds,
  preserveComponentPlacement
} from '../../../../src/layout/engine/placement/refinement.js';
import { makeDisconnectedEthanes } from '../support/molecules.js';

describe('layout/engine/placement/refinement', () => {
  it('derives touched atoms from both touched atom and touched bond hints', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes(), {
      touchedAtoms: new Set(['a0']),
      touchedBonds: new Set(['d0'])
    });
    const touched = deriveTouchedAtomIds(graph);

    assert.deepEqual([...touched].sort(), ['a0', 'c0', 'c1']);
  });

  it('preserves an untouched component when all of its participant atoms already have coords', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes(), {
      existingCoords: new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['c0', { x: 10, y: 0 }],
        ['c1', { x: 11.5, y: 0 }]
      ]),
      touchedAtoms: new Set(['a0'])
    });
    const refinementContext = buildRefinementContext(graph);
    const untouchedComponent = graph.components.find(component => component.atomIds.includes('c0'));

    assert.equal(canPreserveComponentPlacement(graph, untouchedComponent, refinementContext), true);
    assert.deepEqual(preserveComponentPlacement(graph, untouchedComponent), {
      atomIds: ['c0', 'c1'],
      coords: new Map([
        ['c0', { x: 10, y: 0 }],
        ['c1', { x: 11.5, y: 0 }]
      ])
    });
  });

  it('does not preserve a fully specified acyclic component during cleanup-only refinement', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes(), {
      existingCoords: new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['c0', { x: 10, y: 0 }],
        ['c1', { x: 11.5, y: 0 }]
      ])
    });
    const refinementContext = buildRefinementContext(graph);
    const component = graph.components.find(candidate => candidate.atomIds.includes('a0'));

    assert.equal(canPreserveComponentPlacement(graph, component, refinementContext), false);
  });

  it('anchors touched-component relayout to untouched existing atoms', () => {
    const graph = createLayoutGraph(makeDisconnectedEthanes(), {
      fixedCoords: new Map([['a0', { x: 0, y: 0 }]]),
      existingCoords: new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['c0', { x: 10, y: 0 }],
        ['c1', { x: 11.5, y: 0 }]
      ]),
      touchedAtoms: new Set(['a1'])
    });
    const refinementContext = buildRefinementContext(graph);
    const touchedComponent = graph.components.find(component => component.atomIds.includes('a0'));
    const fixedCoords = buildComponentFixedCoords(graph, touchedComponent, refinementContext);

    assert.deepEqual([...fixedCoords.entries()].sort(([firstId], [secondId]) => firstId.localeCompare(secondId)), [
      ['a0', { x: 0, y: 0 }]
    ]);
  });
});
