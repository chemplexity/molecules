import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getDefaultRenderOptions, getRenderOptions, updateRenderOptions } from '../../../src/app/render/helpers.js';

afterEach(() => {
  updateRenderOptions(getDefaultRenderOptions());
});

describe('app/render/helpers', () => {
  it('defaults 2d render styling without a renderer version toggle', () => {
    assert.equal(getDefaultRenderOptions().twoDAtomFontSize, 14);
    assert.equal(getDefaultRenderOptions().layoutBondLength, 1.5);
    assert.equal(getDefaultRenderOptions().bondEnFontSize, 10);
    assert.equal(getDefaultRenderOptions().reactionFontSize, 16);
    assert.equal(getDefaultRenderOptions().showReactionReagents, true);
    assert.equal(getDefaultRenderOptions().showReactionConditions, false);
    assert.equal(getRenderOptions().twoDAtomFontSize, 14);
    assert.equal(getRenderOptions().layoutBondLength, 1.5);
    assert.equal(getRenderOptions().bondEnFontSize, 10);
    assert.equal(getRenderOptions().reactionFontSize, 16);
    assert.equal(getRenderOptions().showReactionReagents, true);
    assert.equal(getRenderOptions().showReactionConditions, false);
    assert.equal('legacy2dRendererToggle' in getDefaultRenderOptions(), false);
  });

  it('ignores unknown render options', () => {
    const updated = updateRenderOptions({ legacy2dRendererToggle: 'v1', layoutBondLength: 3.5, twoDAtomFontSize: 18 });

    assert.equal(updated.twoDAtomFontSize, 18);
    assert.equal(updated.layoutBondLength, 3);
    assert.equal('legacy2dRendererToggle' in updated, false);

    const lowClamped = updateRenderOptions({ layoutBondLength: 0.1 });
    assert.equal(lowClamped.layoutBondLength, 0.5);
  });

  it('updates reaction metadata display toggles', () => {
    const updated = updateRenderOptions({ showReactionReagents: false, showReactionConditions: true, reactionFontSize: 30 });

    assert.equal(updated.showReactionReagents, false);
    assert.equal(updated.showReactionConditions, true);
    assert.equal(updated.reactionFontSize, 24);

    const lowClamped = updateRenderOptions({ reactionFontSize: 6 });
    assert.equal(lowClamped.reactionFontSize, 8);
  });
});
