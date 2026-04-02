/** @module app/render/helpers */

import { atomColor, kekulize } from '../../layout/mol2d-helpers.js';

// ---------------------------------------------------------------------------
// Bond rendering constants
// ---------------------------------------------------------------------------
export const BOND_MULT = 3;
export const BOND_OFFSET = 2;
export const PI_STROKE = { stroke: '#FFFFFF', width: '2px' };
export const ARO_STROKE = { stroke: '#696969', width: '3px', dashArray: '3,3' };
export const AROMATIC_RENDER_MODE = 'localized'; // 'localized' | 'delocalized'
export const STROKE_W = 1.6; // px
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

export function getHighlightStyleVariant(styleName = 'default', index = 0) {
  const palette = HIGHLIGHT_STYLE_PALETTES[styleName] ?? HIGHLIGHT_STYLE_PALETTES.default;
  return palette[((index % palette.length) + palette.length) % palette.length];
}

export function strokeColor(symbol) {
  const light = new Set(['H', 'F', 'Cl', 'Mg', 'Ca', 'He', 'Ne', 'Ar', 'B', 'Si', 'Be', 'Li']);
  return light.has(symbol) ? '#888' : 'rgba(0,0,0,0.25)';
}

export function singleBondWidth(order) {
  return `${(order * BOND_MULT - 1) * (BOND_MULT / 2)}px`;
}

export function renderBondOrder(bond) {
  if (AROMATIC_RENDER_MODE === 'localized' && (bond.properties.aromatic ?? false)) {
    return bond.properties.localizedOrder ?? bond.properties.order ?? 1.5;
  }
  return bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
}

export function prepareAromaticBondRendering(molecule) {
  if (AROMATIC_RENDER_MODE === 'localized') {
    kekulize(molecule);
  }
}

export function atomRadius(protons) {
  if (protons == null || protons >= 11) {
    return 10;
  }
  return Math.sqrt(protons + 2.7) * 2.8;
}

export function xOffset(offset, src, tgt) {
  const dx = tgt.x - src.x,
    dy = tgt.y - src.y;
  if (dy === 0 || Math.abs(dx / dy) > 1) {
    return offset * (dy / dx);
  }
  return offset;
}

export function yOffset(offset, src, tgt) {
  const dx = tgt.x - src.x,
    dy = tgt.y - src.y;
  if (dy === 0 || Math.abs(dx / dy) > 1) {
    return -offset;
  }
  return offset * -(dx / dy);
}

export function bondTooltipHtml(bond, a1, a2) {
  const order = bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
  const typeLabel =
    order === 1.5
      ? 'Aromatic'
      : order === 1
        ? 'Single'
        : order === 2
          ? 'Double'
          : order === 3
            ? 'Triple'
            : `Order ${order}`;
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
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function atomTooltipHtml(atom, _mol, valenceWarning = null) {
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

  const color = atomColor(atom.name);
  const warningHtml = valenceWarning
    ? `<div style="margin:6px 0 8px;color:#b3202e;font-weight:600">${escapeHtml(valenceWarning.reason)}</div>`
    : '';
  return `<div class="tt-head" style="color:${color}">${isotopePrefix}${atom.name}${chargeSup}
        <span style="font-size:11px;font-weight:normal;color:#aaa;margin-left:4px">${atom.id}</span>
    </div>${warningHtml}<table>${rows}</table>`;
}

export function renderAtomLabel(group, label, color, xOffset = 0) {
  const textEl = group
    .append('text')
    .attr('class', 'atom-label')
    .attr('fill', color)
    .attr('x', xOffset)
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

export function addLine(group, x1, y1, x2, y2, extraClass) {
  return group
    .append('line')
    .attr('class', extraClass ? `bond ${extraClass}` : 'bond')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .style('stroke-width', `${STROKE_W}px`);
}
