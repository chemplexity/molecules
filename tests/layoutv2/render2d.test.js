import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { generateCoords } from '../../src/layoutv2/api.js';
import { renderMolSVG, renderMolSVGFromSMILES } from '../../src/layoutv2/render2d.js';

describe('layoutv2/render2d', () => {
  it('omits lone-pair circles by default', () => {
    const molecule = parseSMILES('CO');
    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 0);
  });

  it('emits lone-pair circles when enabled', () => {
    const molecule = parseSMILES('CO');
    const rendered = renderMolSVG(molecule, { showLonePairs: true });

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 4);
  });

  it('shows a lone pair for aromatic [nH] when enabled', () => {
    const molecule = parseSMILES('c1ccc2[nH]ccc2c1');
    const rendered = renderMolSVG(molecule, { showLonePairs: true });

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="lone-pair"/g) ?? []).length, 2);
  });

  it('wraps charge labels in a thin outlined circle', () => {
    const molecule = parseSMILES('[NH4+]');
    const rendered = renderMolSVG(molecule);

    assert.ok(rendered, 'expected SVG render output');
    assert.equal((rendered.svgContent.match(/class="atom-charge-ring"/g) ?? []).length, 1);
    assert.equal((rendered.svgContent.match(/class="atom-charge-text"/g) ?? []).length, 1);
    assert.match(rendered.svgContent, />\+<\/text>/);
  });

  it('accepts a precomputed layout result', () => {
    const molecule = parseSMILES('c1ccccc1');
    const layoutResult = generateCoords(molecule);
    const rendered = renderMolSVG(molecule, { layoutResult });

    assert.ok(rendered, 'expected SVG render output');
    assert.match(rendered.svgContent, /<line /);
  });

  it('renders directly from SMILES convenience wrapper', () => {
    const rendered = renderMolSVGFromSMILES('CCO');

    assert.ok(rendered, 'expected SVG render output');
    assert.match(rendered.svgContent, /<rect /);
  });
});
