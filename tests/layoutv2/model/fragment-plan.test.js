import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createFragmentPlan } from '../../../src/layoutv2/model/fragment-plan.js';

describe('layoutv2/model/fragment-plan', () => {
  it('clones fragment placement inputs into a stable packing descriptor', () => {
    const coords = new Map([['a0', { x: 1, y: 2 }]]);
    const plan = createFragmentPlan({
      componentId: 'c0',
      atomIds: ['a0'],
      coords,
      anchored: true,
      role: 'principal',
      anchorPreference: 'principal-right'
    });

    coords.get('a0').x = 99;
    assert.equal(plan.componentId, 'c0');
    assert.equal(plan.anchored, true);
    assert.equal(plan.role, 'principal');
    assert.equal(plan.anchorPreference, 'principal-right');
    assert.deepEqual(plan.coords.get('a0'), { x: 1, y: 2 });
  });
});
