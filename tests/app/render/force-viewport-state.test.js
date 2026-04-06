import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createForceViewportStateHelpers } from '../../../src/app/render/force-viewport-state.js';

describe('createForceViewportStateHelpers', () => {
  it('enables keep-in-view with the provided tick count', () => {
    const records = [];
    const helpers = createForceViewportStateHelpers({
      state: {
        setKeepInView: value => records.push(['setKeepInView', value]),
        setKeepInViewTicks: value => records.push(['setKeepInViewTicks', value])
      },
      constants: {
        getDefaultKeepInViewTicks: () => 12
      }
    });

    helpers.enableKeepInView(7);

    assert.deepEqual(records, [
      ['setKeepInView', true],
      ['setKeepInViewTicks', 7]
    ]);
  });

  it('uses the default tick count and clears keep-in-view state on disable', () => {
    const records = [];
    const helpers = createForceViewportStateHelpers({
      state: {
        setKeepInView: value => records.push(['setKeepInView', value]),
        setKeepInViewTicks: value => records.push(['setKeepInViewTicks', value])
      },
      constants: {
        getDefaultKeepInViewTicks: () => 9
      }
    });

    helpers.enableKeepInView();
    helpers.disableKeepInView();

    assert.deepEqual(records, [
      ['setKeepInView', true],
      ['setKeepInViewTicks', 9],
      ['setKeepInView', false],
      ['setKeepInViewTicks', 0]
    ]);
  });
});
