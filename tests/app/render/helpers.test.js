import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getDefaultRenderOptions, getRenderOptions, updateRenderOptions } from '../../../src/app/render/helpers.js';

afterEach(() => {
  updateRenderOptions(getDefaultRenderOptions());
});

describe('app/render/helpers', () => {
  it('defaults 2d render styling without a renderer version toggle', () => {
    assert.equal(getDefaultRenderOptions().twoDAtomFontSize, 14);
    assert.equal(getRenderOptions().twoDAtomFontSize, 14);
    assert.equal('legacy2dRendererToggle' in getDefaultRenderOptions(), false);
  });

  it('ignores unknown render options', () => {
    const updated = updateRenderOptions({ legacy2dRendererToggle: 'v1', twoDAtomFontSize: 18 });

    assert.equal(updated.twoDAtomFontSize, 18);
    assert.equal('legacy2dRendererToggle' in updated, false);
  });
});
