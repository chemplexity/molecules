import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Atom } from '../../../src/core/index.js';
import {
  atomColor,
  atomTooltipHtml,
  getDefaultRenderOptions,
  getFunctionalGroupHighlightStyle,
  getHighlightStyleVariant,
  getPhysicochemicalHighlightStyle,
  getSelectionHighlightStyle,
  HIGHLIGHT_STYLE_PALETTES,
  isRadioactiveElement,
  strokeColor,
  updateRenderOptions
} from '../../../src/app/render/helpers.js';

afterEach(() => {
  updateRenderOptions(getDefaultRenderOptions());
});

describe('getHighlightStyleVariant', () => {
  it('starts the default rainbow with the existing green highlight', () => {
    assert.deepEqual(getHighlightStyleVariant('default', 0), HIGHLIGHT_STYLE_PALETTES.default[0]);
  });

  it('cycles through the default rainbow palette by highlight index', () => {
    assert.deepEqual(getHighlightStyleVariant('default', 1), HIGHLIGHT_STYLE_PALETTES.default[1]);
    assert.deepEqual(getHighlightStyleVariant('default', HIGHLIGHT_STYLE_PALETTES.default.length), HIGHLIGHT_STYLE_PALETTES.default[0]);
  });

  it('keeps physchem highlights on their dedicated palette', () => {
    assert.deepEqual(getHighlightStyleVariant('physchem', 0), HIGHLIGHT_STYLE_PALETTES.physchem[0]);
    assert.deepEqual(getHighlightStyleVariant('physchem', 5), HIGHLIGHT_STYLE_PALETTES.physchem[0]);
  });

  it('falls back to the default palette for unknown styles', () => {
    assert.deepEqual(getHighlightStyleVariant('missing-style', 2), HIGHLIGHT_STYLE_PALETTES.default[2]);
  });

  it('returns configured live highlight colors with derived outlines', () => {
    updateRenderOptions({
      selectionHighlightColor: '#654321',
      functionalGroupHighlightColor: '#123456',
      physicochemicalHighlightColor: '#abcdef'
    });

    assert.deepEqual(getSelectionHighlightStyle(), { fill: '#654321', outline: '#3b2713' });
    assert.deepEqual(getFunctionalGroupHighlightStyle(), { fill: '#123456', outline: '#0a1e32' });
    assert.deepEqual(getPhysicochemicalHighlightStyle(), { fill: '#abcdef', outline: '#63778b' });
  });
});

describe('atomColor', () => {
  it('uses dark hydrogen text in 2D while preserving the white force/CPK hydrogen swatch', () => {
    assert.equal(atomColor('H', '2d'), '#333333');
    assert.equal(atomColor('D', '2d'), '#333333');
    assert.equal(atomColor('H', 'force'), '#FFFFFF');
  });
});

describe('force atom strokes', () => {
  it('uses a translucent yellow-green outline for radioactive-only elements', () => {
    assert.equal(isRadioactiveElement('U'), true);
    assert.equal(isRadioactiveElement('Tc'), true);
    assert.equal(isRadioactiveElement('C'), false);
    assert.match(strokeColor('U'), /^rgba\(184, 224, 46, 0\.62\)$/);
    assert.notEqual(strokeColor('C'), strokeColor('U'));
  });
});

describe('atomTooltipHtml', () => {
  it('includes the valence warning reason when provided', () => {
    const atom = new Atom('a0', 'C');
    const html = atomTooltipHtml(atom, null, { reason: 'Bond order 5 is not valid for C with charge 0 (allowed: 0, 2, 4)' });
    assert.match(html, /Bond order 5 is not valid/);
    assert.match(html, /allowed: 0, 2, 4/);
  });

  it('does not include an electrons row', () => {
    const atom = new Atom('a0', 'O');
    const html = atomTooltipHtml(atom, null, null);
    assert.match(html, /Bonds/);
    assert.doesNotMatch(html, /Electrons/);
  });

  it('uses dark text for hydrogen tooltip headers', () => {
    const atom = new Atom('h0', 'H');
    const html = atomTooltipHtml(atom, null, null);
    assert.match(html, /class="tt-head" style="color:#111111"/);
    assert.doesNotMatch(html, /color:#FFFFFF/);
  });
});
