import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Atom } from '../../../src/core/index.js';
import { atomTooltipHtml, getHighlightStyleVariant, HIGHLIGHT_STYLE_PALETTES } from '../../../src/app/render/helpers.js';

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
