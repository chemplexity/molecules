import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getDefaultRenderOptions, getRenderOptions, updateRenderOptions, xOffset, yOffset } from '../../../src/app/render/helpers.js';

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

  it('falls back to a finite offset instead of NaN for coincident bond endpoints', () => {
    const src = { x: 5, y: 5 };
    const tgt = { x: 5, y: 5 };

    assert.equal(xOffset(3, src, tgt), 3);
    assert.equal(yOffset(3, src, tgt), -3);
  });

  it('still offsets non-degenerate horizontal and vertical bonds correctly', () => {
    const horizontal = { x: 10, y: 0 };
    assert.equal(xOffset(3, { x: 0, y: 0 }, horizontal), 0);
    assert.equal(yOffset(3, { x: 0, y: 0 }, horizontal), -3);

    const vertical = { x: 0, y: 10 };
    assert.equal(xOffset(3, { x: 0, y: 0 }, vertical), 3);
    assert.equal(Math.abs(yOffset(3, { x: 0, y: 0 }, vertical)), 0);
  });
});
