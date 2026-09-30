import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../../../src/core/Molecule.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { createLayoutEvaluationContext } from '../../../../src/layout/engine/audit/layout-evaluation-context.js';

/**
 * Creates a graph with independently positioned atoms for overlap checks.
 * @param {boolean} suppressH - Whether hydrogens participate in layout scratch.
 * @returns {object} Layout graph.
 */
function graphFor(suppressH = true) {
  const molecule = new Molecule();
  molecule.addAtom('a', 'C');
  molecule.addAtom('b', 'C');
  molecule.addAtom('c', 'O');
  molecule.addAtom('h', 'H');
  return createLayoutGraph(molecule, { suppressH });
}

describe('evaluation context coordinate replacement', () => {
  for (const change of ['add', 'remove', 'replace', 'move']) {
    it(`matches fresh evaluation after coordinate ${change}`, () => {
      const graph = graphFor();
      const before = new Map([['a', { x: 0, y: 0 }], ['b', { x: 5, y: 0 }]]);
      const after = structuredClone(before);
      if (change === 'remove' || change === 'replace') {
        after.delete('b');
      }
      if (change === 'add' || change === 'replace') {
        after.set('c', { x: 0.1, y: 0 });
      }
      if (change === 'move') {
        after.set('b', { x: 0.1, y: 0 });
      }
      const context = createLayoutEvaluationContext(graph, before);
      const originalIds = [...context.layoutAtomIds()];
      context.visibleHeavyAtomIds();
      context.atomGrid();
      context.displayAtomCounts();
      const derived = context.withCoords(after);
      const fresh = createLayoutEvaluationContext(graph, after);
      assert.deepEqual(derived.layoutAtomIds(), fresh.layoutAtomIds());
      assert.deepEqual(derived.visibleHeavyAtomIds(), fresh.visibleHeavyAtomIds());
      assert.deepEqual(derived.findSevereOverlaps(), fresh.findSevereOverlaps());
      assert.deepEqual(derived.measureOverlapState(), fresh.measureOverlapState());
      assert.deepEqual(derived.measureLayoutState(), fresh.measureLayoutState());
      assert.equal(derived.findSevereOverlaps().length, change === 'remove' ? 0 : 1);
      assert.notEqual(derived.atomGrid(), context.atomGrid());
      assert.deepEqual(context.layoutAtomIds(), originalIds);
      assert.equal(context.findSevereOverlaps().length, 0);
    });
  }

  for (const suppressH of [false, true]) {
    it(`rebuilds both lists after warming an empty map, suppressH=${suppressH}`, () => {
      const context = createLayoutEvaluationContext(graphFor(suppressH), new Map());
      assert.deepEqual(context.layoutAtomIds(), []);
      assert.deepEqual(context.visibleHeavyAtomIds(), []);
      const coords = new Map([['a', { x: 0, y: 0 }], ['h', { x: 1.5, y: 0 }]]);
      const derived = context.withCoords(coords);
      assert.deepEqual(derived.layoutAtomIds(), suppressH ? ['a'] : ['a', 'h']);
      assert.deepEqual(derived.visibleHeavyAtomIds(), ['a']);
    });
  }

  it('accepts caller-supplied replacement scratch without inheriting old lists', () => {
    const graph = graphFor();
    const context = createLayoutEvaluationContext(graph, new Map([['a', { x: 0, y: 0 }]]));
    context.visibleHeavyAtomIds();
    const coords = new Map([['b', { x: 0, y: 0 }], ['c', { x: 0.1, y: 0 }]]);
    const fresh = createLayoutEvaluationContext(graph, coords);
    const atomGrid = fresh.atomGrid();
    const derived = context.withCoords(coords, { atomGrid });
    assert.equal(derived.atomGrid(), atomGrid);
    assert.equal(derived.findSevereOverlaps().length, 1);
    const subset = context.withCoords(coords, { layoutAtomIds: ['c'] });
    assert.deepEqual(subset.visibleHeavyAtomIds(), ['c']);
    const heavy = ['b', 'c'];
    assert.equal(context.withCoords(coords, { visibleHeavyAtomIds: heavy }).visibleHeavyAtomIds(), heavy);
  });
});
