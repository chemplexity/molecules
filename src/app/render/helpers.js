/** @module app/render/helpers */

import { atomColor as baseAtomColor, kekulize } from '../../layout/mol2d-helpers.js';

// ---------------------------------------------------------------------------
// Bond rendering constants
// ---------------------------------------------------------------------------
export const BOND_MULT = 3;
export const BOND_OFFSET = 2;
export const AROMATIC_RENDER_MODE = 'localized'; // 'localized' | 'delocalized'
export const TWO_D_RENDERER_VERSIONS = Object.freeze(['v1', 'v2']);
export const RENDER_OPTION_LIMITS = Object.freeze({
  twoDAtomFontSize: { min: 10, max: 24, step: 1 },
  atomNumberingFontSize: { min: 8, max: 24, step: 1 },
  twoDBondThickness: { min: 0.8, max: 4, step: 0.1 },
  forceAtomSizeMultiplier: { min: 0.5, max: 2.5, step: 0.1 },
  forceBondThicknessMultiplier: { min: 0.5, max: 2.5, step: 0.1 }
});
const DEFAULT_RENDER_OPTIONS = Object.freeze({
  showValenceWarnings: true,
  showAtomTooltips: true,
  showLonePairs: false,
  twoDRendererVersion: 'v2',
  twoDAtomColoring: true,
  twoDAtomFontSize: 14,
  atomNumberingFontSize: 10,
  twoDBondThickness: 1.6,
  forceAtomSizeMultiplier: 1,
  forceBondThicknessMultiplier: 1
});

export let PI_STROKE = { stroke: '#FFFFFF', width: '2px' };
export let ARO_STROKE = { stroke: '#696969', width: '3px', dashArray: '3,3' };
export let STROKE_W = DEFAULT_RENDER_OPTIONS.twoDBondThickness; // px
let _renderOptions = { ...DEFAULT_RENDER_OPTIONS };

function _clampOptionValue(value, limits) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.min(limits.max, Math.max(limits.min, value));
}

function _syncDerivedRenderConstants() {
  const twoDScale = _renderOptions.twoDBondThickness / DEFAULT_RENDER_OPTIONS.twoDBondThickness;
  STROKE_W = _renderOptions.twoDBondThickness;
  PI_STROKE = { stroke: '#FFFFFF', width: `${2 * twoDScale}px` };
  ARO_STROKE = { stroke: '#696969', width: `${3 * twoDScale}px`, dashArray: '3,3' };
}

/**
 * Returns a shallow copy of the current render options object.
 * @returns {object} Current render options.
 */
export function getRenderOptions() {
  return { ..._renderOptions };
}

/**
 * Returns a shallow copy of the default render options object.
 * @returns {object} Default render options.
 */
export function getDefaultRenderOptions() {
  return { ...DEFAULT_RENDER_OPTIONS };
}

/**
 * Merges valid properties from the provided options into the current render options and updates derived constants.
 * @param {object} [nextOptions] - Optional partial render options to apply.
 * @returns {object} The updated render options after merging.
 */
export function updateRenderOptions(nextOptions = {}) {
  const merged = { ..._renderOptions };
  if (typeof nextOptions.showValenceWarnings === 'boolean') {
    merged.showValenceWarnings = nextOptions.showValenceWarnings;
  }
  if (typeof nextOptions.showAtomTooltips === 'boolean') {
    merged.showAtomTooltips = nextOptions.showAtomTooltips;
  }
  if (typeof nextOptions.showLonePairs === 'boolean') {
    merged.showLonePairs = nextOptions.showLonePairs;
  }
  if (typeof nextOptions.twoDRendererVersion === 'string' && TWO_D_RENDERER_VERSIONS.includes(nextOptions.twoDRendererVersion)) {
    merged.twoDRendererVersion = nextOptions.twoDRendererVersion;
  }
  if (typeof nextOptions.twoDAtomColoring === 'boolean') {
    merged.twoDAtomColoring = nextOptions.twoDAtomColoring;
  }
  if (nextOptions.twoDAtomFontSize !== undefined) {
    const clamped = _clampOptionValue(Number(nextOptions.twoDAtomFontSize), RENDER_OPTION_LIMITS.twoDAtomFontSize);
    if (clamped !== null) {
      merged.twoDAtomFontSize = Math.round(clamped);
    }
  }
  if (nextOptions.atomNumberingFontSize !== undefined) {
    const clamped = _clampOptionValue(Number(nextOptions.atomNumberingFontSize), RENDER_OPTION_LIMITS.atomNumberingFontSize);
    if (clamped !== null) {
      merged.atomNumberingFontSize = Math.round(clamped);
    }
  }
  if (nextOptions.twoDBondThickness !== undefined) {
    const clamped = _clampOptionValue(Number(nextOptions.twoDBondThickness), RENDER_OPTION_LIMITS.twoDBondThickness);
    if (clamped !== null) {
      merged.twoDBondThickness = clamped;
    }
  }
  if (nextOptions.forceAtomSizeMultiplier !== undefined) {
    const clamped = _clampOptionValue(Number(nextOptions.forceAtomSizeMultiplier), RENDER_OPTION_LIMITS.forceAtomSizeMultiplier);
    if (clamped !== null) {
      merged.forceAtomSizeMultiplier = clamped;
    }
  }
  if (nextOptions.forceBondThicknessMultiplier !== undefined) {
    const clamped = _clampOptionValue(Number(nextOptions.forceBondThicknessMultiplier), RENDER_OPTION_LIMITS.forceBondThicknessMultiplier);
    if (clamped !== null) {
      merged.forceBondThicknessMultiplier = clamped;
    }
  }
  _renderOptions = merged;
  _syncDerivedRenderConstants();
  return getRenderOptions();
}

_syncDerivedRenderConstants();
export const HIGHLIGHT_STYLE_PALETTES = {
  default: [
    { fill: 'rgb(130, 210, 80)', outline: 'rgb(70, 140, 40)' },
    { fill: 'rgb(86, 190, 230)', outline: 'rgb(36, 119, 166)' },
    { fill: 'rgb(110, 148, 235)', outline: 'rgb(64, 90, 176)' },
    { fill: 'rgb(179, 123, 235)', outline: 'rgb(118, 68, 178)' },
    { fill: 'rgb(237, 124, 198)', outline: 'rgb(177, 70, 140)' },
    { fill: 'rgb(236, 129, 96)', outline: 'rgb(176, 79, 52)' },
    { fill: 'rgb(241, 194, 84)', outline: 'rgb(181, 136, 31)' }
  ],
  physchem: [{ fill: 'rgb(246, 227, 110)', outline: 'rgb(194, 168, 24)' }]
};

/**
 * Returns a highlight style object `{fill, outline}` from the named palette at the given index, wrapping cyclically.
 * @param {string} [styleName] - Palette name; falls back to `'default'` if not found.
 * @param {number} [index] - Zero-based index into the palette; wraps cyclically.
 * @returns {{fill: string, outline: string}} Highlight fill and outline color strings.
 */
export function getHighlightStyleVariant(styleName = 'default', index = 0) {
  const palette = HIGHLIGHT_STYLE_PALETTES[styleName] ?? HIGHLIGHT_STYLE_PALETTES.default;
  return palette[((index % palette.length) + palette.length) % palette.length];
}

/**
 * Returns the display color for an atom symbol, respecting the current 2D atom-coloring setting.
 * @param {string} sym - Element symbol (e.g. `'O'`, `'N'`).
 * @param {string} [layout] - Layout mode: `'2d'` or `'force'`.
 * @returns {string} CSS color string.
 */
export function atomColor(sym, layout = '2d') {
  if (layout === '2d' && !_renderOptions.twoDAtomColoring) {
    return '#333333';
  }
  return baseAtomColor(sym);
}

/**
 * Returns the stroke color used for an atom circle outline in force-layout mode, choosing a lighter or darker tint based on the element.
 * @param {string} symbol - Element symbol.
 * @returns {string} CSS color string.
 */
export function strokeColor(symbol) {
  const light = new Set(['H', 'F', 'Cl', 'Mg', 'Ca', 'He', 'Ne', 'Ar', 'B', 'Si', 'Be', 'Li']);
  return light.has(symbol) ? '#888' : 'rgba(0,0,0,0.25)';
}

/**
 * Returns the CSS stroke-width string for a force-layout bond of the given order, scaled by the current bond-thickness multiplier.
 * @param {number} order - Bond order (1, 2, or 3).
 * @returns {string} CSS pixel width string (e.g. `'3px'`).
 */
export function singleBondWidth(order) {
  return `${(order * BOND_MULT - 1) * (BOND_MULT / 2) * _renderOptions.forceBondThicknessMultiplier}px`;
}

/**
 * Returns the effective render order for a bond, resolving aromatic bonds according to the current render mode.
 * @param {object} bond - Bond object with a `properties` map containing `order` and `aromatic`.
 * @returns {number} Effective render order (1, 1.5, 2, or 3).
 */
export function renderBondOrder(bond) {
  if (AROMATIC_RENDER_MODE === 'localized' && (bond.properties.aromatic ?? false)) {
    return bond.properties.localizedOrder ?? bond.properties.order ?? 1.5;
  }
  return bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
}

/**
 * Prepares a molecule for aromatic bond rendering by kekulizing it when localized aromatic mode is active.
 * @param {object} molecule - Molecule instance to kekulize in place if needed.
 */
export function prepareAromaticBondRendering(molecule) {
  if (AROMATIC_RENDER_MODE === 'localized') {
    kekulize(molecule);
  }
}

/**
 * Returns the display radius (in pixels) for an atom in force-layout or 2D mode based on its proton count.
 * @param {number|null} protons - Atomic number; null or ≥11 uses the default heavy-atom radius.
 * @param {string} [layout] - Layout mode: `'force'` applies the atom-size multiplier, `'2d'` does not.
 * @returns {number} Radius in pixels.
 */
export function atomRadius(protons, layout = 'force') {
  if (protons == null || protons >= 11) {
    return 10 * (layout === 'force' ? _renderOptions.forceAtomSizeMultiplier : 1);
  }
  const baseRadius = Math.sqrt(protons + 2.7) * 2.8;
  return baseRadius * (layout === 'force' ? _renderOptions.forceAtomSizeMultiplier : 1);
}

/**
 * Returns the x-component of the parallel offset vector for a secondary bond line.
 * @param {number} offset - Desired perpendicular offset magnitude.
 * @param {{x: number, y: number}} src - Source atom screen coordinates.
 * @param {{x: number, y: number}} tgt - Target atom screen coordinates.
 * @returns {number} X offset value in pixels.
 */
export function xOffset(offset, src, tgt) {
  const dx = tgt.x - src.x,
    dy = tgt.y - src.y;
  if (dy === 0 || Math.abs(dx / dy) > 1) {
    return offset * (dy / dx);
  }
  return offset;
}

/**
 * Returns the y-component of the parallel offset vector for a secondary bond line.
 * @param {number} offset - Desired perpendicular offset magnitude.
 * @param {{x: number, y: number}} src - Source atom screen coordinates.
 * @param {{x: number, y: number}} tgt - Target atom screen coordinates.
 * @returns {number} Y offset value in pixels.
 */
export function yOffset(offset, src, tgt) {
  const dx = tgt.x - src.x,
    dy = tgt.y - src.y;
  if (dy === 0 || Math.abs(dx / dy) > 1) {
    return -offset;
  }
  return offset * -(dx / dy);
}

/**
 * Generates the HTML string for a bond hover tooltip.
 * @param {object} bond - Bond object with `properties` containing order, aromatic, and optionally stereo.
 * @param {object} a1 - First atom object with a `name` property.
 * @param {object} a2 - Second atom object with a `name` property.
 * @returns {string} HTML string for the tooltip content.
 */
export function bondTooltipHtml(bond, a1, a2) {
  const order = bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
  const typeLabel = order === 1.5 ? 'Aromatic' : order === 1 ? 'Single' : order === 2 ? 'Double' : order === 3 ? 'Triple' : `Order ${order}`;
  const bondSymbol = order === 2 ? '=' : order === 3 ? '≡' : '–';

  const row = (label, val) => `<tr><td>${label}</td><td><b>${val}</b></td></tr>`;
  let rows = row('Type', typeLabel);
  rows += row('Order', order);
  if (bond.properties.stereo) {
    rows += row('Stereo', bond.properties.stereo);
  }

  return `<div class="tt-head" style="color:#555">${a1.name}${bondSymbol}${a2.name}
        <span style="font-size:11px;font-weight:normal;color:#aaa;margin-left:4px">${bond.id}</span>
    </div><table>${rows}</table>`;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Generates the HTML string for an atom hover tooltip, including atomic properties and any valence warning.
 * @param {object} atom - Atom object with `name`, `bonds`, `id`, and `properties`.
 * @param {object} _mol - Molecule instance (unused directly but kept for signature compatibility).
 * @param {object|null} [valenceWarning] - Optional valence warning object with a `reason` string.
 * @param {string} [layout] - Layout mode: `'2d'` or `'force'` (affects atom color rendering).
 * @returns {string} HTML string for the tooltip content.
 */
export function atomTooltipHtml(atom, _mol, valenceWarning = null, layout = '2d') {
  const p = atom.properties;
  const charge = p.charge ?? 0;

  // Formatted charge string for the header  (e.g.  +  2+  −  2−)
  let chargeSup = '';
  if (charge !== 0) {
    const abs = Math.abs(charge);
    const sign = charge > 0 ? '+' : '−';
    chargeSup = `<sup style="font-size:11px">${abs > 1 ? abs : ''}${sign}</sup>`;
  }

  // Isotope: standard mass = protons + round(neutrons from elements table).
  // If the stored neutrons differ noticeably, it's a non-standard isotope.
  let isotopePrefix = '';
  if (p.protons != null && p.neutrons != null) {
    const massNo = p.protons + Math.round(p.neutrons);
    // Detect non-standard by comparing to neutral-atom rounding
    const stdNeutrons = { H: 0, C: 6, N: 7, O: 8, S: 16, P: 16, F: 10, Cl: 18, Br: 45, I: 74 };
    const std = stdNeutrons[atom.name];
    if (std !== undefined && Math.round(p.neutrons) !== std) {
      isotopePrefix = `<sup style="font-size:11px">${massNo}</sup>`;
    }
  }

  const degree = atom.bonds.length;

  const row = (label, val) => `<tr><td>${label}</td><td><b>${val}</b></td></tr>`;

  let rows = '';
  if (p.protons != null) {
    rows += row('Atomic #', p.protons);
  }
  if (p.electrons != null) {
    rows += row('Electrons', p.electrons);
  }
  rows += row('Bonds', degree);
  if (charge !== 0) {
    const sign = charge > 0 ? `+${charge}` : `${charge}`;
    rows += row('Charge', sign);
  }
  if (p.aromatic) {
    rows += row('Aromatic', 'yes');
  }
  if (p.chirality) {
    rows += row('Chirality', p.chirality);
  }

  let color = atomColor(atom.name, layout);
  if (atom.name === 'H' && layout === 'force') {
    color = 'black';
  }
  const warningHtml = valenceWarning ? `<div style="margin:6px 0 8px;color:#b3202e;font-weight:600">${escapeHtml(valenceWarning.reason)}</div>` : '';
  return `<div class="tt-head" style="color:${color}">${isotopePrefix}${atom.name}${chargeSup}
        <span style="font-size:11px;font-weight:normal;color:#aaa;margin-left:4px">${atom.id}</span>
    </div>${warningHtml}<table>${rows}</table>`;
}

/**
 * Renders an atom label as an SVG text element with subscripted digit spans appended to the given D3 group.
 * @param {object} group - D3 selection of the parent SVG group element.
 * @param {string} label - Atom label string, potentially containing digits (e.g. `'NH2'`).
 * @param {string} color - CSS color for the label text.
 * @param {number} [xOffset] - Horizontal offset from the atom center in pixels.
 * @param {number} [fontSize] - Font size in pixels.
 */
export function renderAtomLabel(group, label, color, xOffset = 0, fontSize = DEFAULT_RENDER_OPTIONS.twoDAtomFontSize) {
  const textEl = group
    .append('text')
    .attr('class', 'atom-label')
    .attr('fill', color)
    .attr('x', xOffset)
    .style('font-size', `${fontSize}px`)
    .attr('pointer-events', 'none')
    .attr('text-anchor', 'middle');
  let i = 0;
  let first = true;
  while (i < label.length) {
    const ch = label[i];
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < label.length && label[i] >= '0' && label[i] <= '9') {
        num += label[i++];
      }
      textEl.append('tspan').attr('baseline-shift', 'sub').attr('font-size', '0.72em').text(num);
    } else {
      let word = '';
      while (i < label.length && !(label[i] >= '0' && label[i] <= '9')) {
        word += label[i++];
      }
      const ts = textEl.append('tspan').text(word);
      if (first) {
        ts.attr('dy', '0.35em');
        first = false;
      }
    }
  }
}

/**
 * Renders lone-pair dot circles into the given D3 group element.
 * @param {object} group - D3 selection of the parent SVG group element.
 * @param {Array<{x: number, y: number}>} dots - Array of dot position objects.
 * @param {object} [options] - Optional styling parameters.
 * @param {number} [options.radius] - Dot radius in pixels.
 * @param {string} [options.fill] - Dot fill color.
 * @param {string} [options.stroke] - Dot stroke color.
 * @param {number} [options.strokeWidth] - Dot stroke width in pixels.
 * @param {string} [options.className] - CSS class applied to each dot circle.
 * @returns {object} D3 selection of the newly appended dot group element.
 */
export function renderLonePairDots(group, dots, { radius = 1.5, fill = '#111111', stroke = 'none', strokeWidth = 0, className = 'lone-pair' } = {}) {
  const dotGroup = group.append('g').attr('class', 'lone-pair-dots').attr('pointer-events', 'none');
  for (const dot of dots) {
    dotGroup
      .append('circle')
      .attr('class', className)
      .attr('cx', dot.x)
      .attr('cy', dot.y)
      .attr('r', radius)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', strokeWidth);
  }
  return dotGroup;
}

/**
 * Appends a bond line SVG element to the given D3 group with the current stroke width.
 * @param {object} group - D3 selection of the parent SVG group element.
 * @param {number} x1 - Start x coordinate.
 * @param {number} y1 - Start y coordinate.
 * @param {number} x2 - End x coordinate.
 * @param {number} y2 - End y coordinate.
 * @param {string} [extraClass] - Additional CSS class to append to the `bond` class.
 * @returns {object} D3 selection of the appended line element.
 */
export function addLine(group, x1, y1, x2, y2, extraClass) {
  return group
    .append('line')
    .attr('class', extraClass ? `bond ${extraClass}` : 'bond')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('pointer-events', 'none')
    .style('stroke-width', `${STROKE_W}px`);
}
