/**
 * render2d.js — reusable 2D skeletal-structure renderer
 *
 * Exports:
 *   renderMolSVG(smiles)          → { svgContent, cellW, cellH } | null
 *   buildCompositeSVG(cells, cols) → SVG string
 *   svgToPng(svgString)           → Buffer (PNG)
 */

import { parseSMILES }    from '../io/smiles.js';
import { generateCoords } from './index.js';
import { Resvg }          from '@resvg/resvg-js';

// ---------------------------------------------------------------------------
// CPK colours (mirrors index.html)
// ---------------------------------------------------------------------------
const CPK = {
  H: '#FFFFFF', He: '#D9FFFF', Li: '#CC80FF', Be: '#C2FF00',
  B: '#FFB5B5', C: '#333333', N: '#3050F8', O: '#FF0D0D',
  F: '#90E050', Ne: '#B3E3F5', Na: '#AB5CF2', Mg: '#8AFF00',
  Al: '#BFA6A6', Si: '#F0C8A0', P: '#FF8000', S: '#C8A000',
  Cl: '#1FF01F', Ar: '#80D1E3', K: '#8F40D4', Ca: '#3DFF00',
  Fe: '#E06633', Co: '#F090A0', Ni: '#50D050', Cu: '#C88033',
  Zn: '#7D80B0', Br: '#A62929', I: '#940094'
};
const DEFAULT_COLOR = '#FF69B4';
function atomColor(sym) {
  return CPK[sym] ?? DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// Rendering constants (match index.html values)
// ---------------------------------------------------------------------------
export const SCALE    = 46;   // px per Ångström
export const BOND_OFF = 5.5;  // px between parallel bond lines
export const STROKE_W = 1.5;  // px
export const FONT_SIZE = 11;  // px
export const CELL_PAD  = 22;  // px padding inside each cell

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function perpUnit(dx, dy) {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

function shortenLine(x1, y1, x2, y2, d1, d2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  return { x1: x1 + ux * d1, y1: y1 + uy * d1, x2: x2 - ux * d2, y2: y2 - uy * d2 };
}

function secondaryDir(a1, a2, mol, toSVG) {
  const resolveNbs = (atom, excludeId) =>
    atom.getNeighbors(mol).filter(n => n && n.id !== excludeId && n.name !== 'H' && n.x != null);
  const allNb = [...resolveNbs(a1, a2.id), ...resolveNbs(a2, a1.id)];
  if (allNb.length === 0) {
    return 1;
  }
  const s1 = toSVG(a1), s2 = toSVG(a2);
  const { nx, ny } = perpUnit(s2.x - s1.x, s2.y - s1.y);
  const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
  let dot = 0;
  for (const n of allNb) {
    const sn = toSVG(n);
    dot += (sn.x - mid.x) * nx + (sn.y - mid.y) * ny;
  }
  return dot >= 0 ? 1 : -1;
}

function labelHalfW(label) {
  if (!label) {
    return 0;
  }
  return FONT_SIZE * 0.38 * label.length + 3;
}

function getAtomLabel(atom, hCounts, toSVG, mol) {
  const symbol = atom.name;
  const hCount = hCounts.get(atom.id) ?? 0;
  if (symbol === 'C' && atom.bonds.length > 0) {
    return null;
  }
  if (hCount === 0) {
    return symbol;
  }
  const hStr = hCount === 1 ? 'H' : `H${hCount}`;
  const aSVG = toSVG(atom);
  let avgDx = 0, nbCount = 0;
  for (const n of atom.getNeighbors(mol)) {
    if (n && n.x != null) {
      avgDx += toSVG(n).x - aSVG.x; nbCount++;
    }
  }
  return (nbCount > 0 && avgDx > 0) ? hStr + symbol : symbol + hStr;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// renderMolSVG — render one molecule as an SVG fragment
//
// Returns { svgContent: string, cellW: number, cellH: number }
// or null if parsing / layout fails.
// ---------------------------------------------------------------------------
export function renderMolSVG(smiles) {
  let mol;
  try {
    mol = parseSMILES(smiles);
  } catch {
    return null;
  }

  // Collect H counts before stripping
  const hCounts = new Map();
  for (const [, atom] of mol.atoms) {
    if (atom.name === 'H') {
      continue;
    }
    const count = atom.getNeighbors(mol).filter(n => n.name === 'H').length;
    if (count > 0) {
      hCounts.set(atom.id, count);
    }
  }
  mol = mol.stripHydrogens();

  try {
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });
  } catch {
    return null;
  }

  const atoms = [...mol.atoms.values()].filter(a => a.x != null);
  if (atoms.length === 0) {
    return null;
  }

  // Bounding box in layout coords
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of atoms) {
    if (a.x < minX) {
      minX = a.x;
    } if (a.x > maxX) {
      maxX = a.x;
    }
    if (a.y < minY) {
      minY = a.y;
    } if (a.y > maxY) {
      maxY = a.y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const molW = Math.max((maxX - minX) * SCALE, 1);
  const molH = Math.max((maxY - minY) * SCALE, 1);
  const cellW = Math.max(molW + CELL_PAD * 2, 90);
  const cellH = Math.max(molH + CELL_PAD * 2, 80);

  const toSVG = (a) => ({
    x: cellW / 2 + (a.x - cx) * SCALE,
    y: cellH / 2 + (a.y - cy) * SCALE
  });

  const lines = [];

  // Bonds
  for (const bond of mol.bonds.values()) {
    const [a1, a2] = bond.getAtomObjects(mol);
    if (!a1 || !a2 || a1.x == null || a2.x == null) {
      continue;
    }
    const order = bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
    const s1 = toSVG(a1), s2 = toSVG(a2);
    const dx = s2.x - s1.x, dy = s2.y - s1.y;
    const { nx, ny } = perpUnit(dx, dy);

    const lineEl = (x1, y1, x2, y2, dash) =>
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#222" stroke-width="${STROKE_W}"${dash ? ' stroke-dasharray="3,3"' : ''}/>`;

    if (order === 1) {
      lines.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
    } else if (order === 2) {
      const dir = secondaryDir(a1, a2, mol, toSVG);
      lines.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
      const ox = nx * BOND_OFF * dir, oy = ny * BOND_OFF * dir;
      const l2 = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy, 4, 4);
      lines.push(lineEl(l2.x1, l2.y1, l2.x2, l2.y2, false));
    } else if (order === 3) {
      for (const d of [-BOND_OFF, 0, BOND_OFF]) {
        const ox = nx * d, oy = ny * d;
        const lt = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy,
          d !== 0 ? 4 : 0, d !== 0 ? 4 : 0);
        lines.push(lineEl(lt.x1, lt.y1, lt.x2, lt.y2, false));
      }
    } else if (order === 1.5) {
      const dir = secondaryDir(a1, a2, mol, toSVG);
      lines.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
      const ox = nx * BOND_OFF * dir, oy = ny * BOND_OFF * dir;
      const ld = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy, 5, 5);
      lines.push(lineEl(ld.x1, ld.y1, ld.x2, ld.y2, true));
    }
  }

  // Atom labels
  const labelEls = [];
  for (const atom of atoms) {
    const label = getAtomLabel(atom, hCounts, toSVG, mol);
    if (!label) {
      continue;
    }
    const { x, y } = toSVG(atom);
    const color = atomColor(atom.name);
    const hw = labelHalfW(label);
    const hh = FONT_SIZE * 0.58 + 2;

    labelEls.push(
      `<rect x="${(x - hw).toFixed(2)}" y="${(y - hh).toFixed(2)}" width="${(hw * 2).toFixed(2)}" height="${(hh * 2).toFixed(2)}" fill="white" rx="2"/>`
    );

    let textContent = '';
    let i = 0;
    while (i < label.length) {
      if (label[i] >= '0' && label[i] <= '9') {
        let num = '';
        while (i < label.length && label[i] >= '0' && label[i] <= '9') {
          num += label[i++];
        }
        textContent += `<tspan baseline-shift="sub" font-size="${(FONT_SIZE * 0.72).toFixed(1)}">${num}</tspan>`;
      } else {
        let word = '';
        while (i < label.length && !(label[i] >= '0' && label[i] <= '9')) {
          word += label[i++];
        }
        textContent += `<tspan>${escapeXml(word)}</tspan>`;
      }
    }

    const charge = atom.properties.charge ?? 0;
    let chargeSup = '';
    if (charge !== 0) {
      const sign = charge === 1 ? '+' : charge > 1 ? `${charge}+`
        : charge === -1 ? '−' : `${Math.abs(charge)}−`;
      chargeSup = `<text x="${(x + hw).toFixed(2)}" y="${(y - FONT_SIZE * 0.42).toFixed(2)}" font-family="sans-serif" font-size="${(FONT_SIZE * 0.8).toFixed(1)}" fill="${color}" text-anchor="start">${escapeXml(sign)}</text>`;
    }

    labelEls.push(
      `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="sans-serif" font-size="${FONT_SIZE}" fill="${color}" text-anchor="middle" dominant-baseline="central">${textContent}</text>${chargeSup}`
    );
  }

  const svgContent = [
    `<rect width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="white"/>`,
    ...lines,
    ...labelEls
  ].join('\n');

  return { svgContent, cellW, cellH };
}

// ---------------------------------------------------------------------------
// buildCompositeSVG — assemble rendered cells into a grid SVG string
//
// cells: array of { svgContent, cellW, cellH } | null  (one per molecule)
// cols:  number of columns
// ---------------------------------------------------------------------------
export function buildCompositeSVG(cells, cols) {
  const rows = Math.ceil(cells.length / cols);

  const colWidths  = Array(cols).fill(0);
  const rowHeights = Array(rows).fill(0);

  for (let idx = 0; idx < cells.length; idx++) {
    const cell = cells[idx];
    if (!cell) {
      continue;
    }
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    colWidths[col]  = Math.max(colWidths[col],  cell.cellW);
    rowHeights[row] = Math.max(rowHeights[row], cell.cellH);
  }

  const colX = [0];
  for (let c = 0; c < cols - 1; c++) {
    colX.push(colX[c] + colWidths[c]);
  }
  const rowY = [0];
  for (let r = 0; r < rows - 1; r++) {
    rowY.push(rowY[r] + rowHeights[r]);
  }

  const totalW = colX[cols - 1] + colWidths[cols - 1];
  const totalH = rowY[rows - 1] + rowHeights[rows - 1];

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">`,
    `<rect width="${totalW}" height="${totalH}" fill="white"/>`
  ];

  // Grid lines
  for (let c = 1; c < cols; c++) {
    parts.push(`<line x1="${colX[c]}" y1="0" x2="${colX[c]}" y2="${totalH}" stroke="#e0e0e0" stroke-width="1"/>`);
  }
  for (let r = 1; r < rows; r++) {
    parts.push(`<line x1="0" y1="${rowY[r]}" x2="${totalW}" y2="${rowY[r]}" stroke="#e0e0e0" stroke-width="1"/>`);
  }

  // Cells — centred within their column/row slot
  for (let idx = 0; idx < cells.length; idx++) {
    const cell = cells[idx];
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = colX[col] + (colWidths[col]  - (cell?.cellW ?? 0)) / 2;
    const y = rowY[row] + (rowHeights[row] - (cell?.cellH ?? 0)) / 2;
    if (cell) {
      parts.push(`<g transform="translate(${x.toFixed(2)},${y.toFixed(2)})">`);
      parts.push(cell.svgContent);
      parts.push('</g>');
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// svgToPng — convert an SVG string to a PNG Buffer via resvg-js
// ---------------------------------------------------------------------------
export function svgToPng(svgString) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: true }
  });
  return resvg.render().asPng();
}
