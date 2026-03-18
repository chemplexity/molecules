/**
 * render2d.js — reusable 2D skeletal-structure renderer
 *
 * Exports:
 *   renderMolSVG(smiles)           → { svgContent, cellW, cellH } | null
 *   buildCompositeSVG(cells, cols) → SVG string
 *   svgToPng(svgString)            → Buffer (PNG)
 */

import { parseSMILES }    from '../io/smiles.js';
import { generateCoords } from './index.js';
import {
  atomColor,
  WEDGE_HALF_W, WEDGE_DASHES,
  perpUnit, shortenLine, secondaryDir,
  labelHalfW, labelHalfH,
  getAtomLabel, pickStereoWedges
} from './mol2d-helpers.js';
import { Resvg } from '@resvg/resvg-js';

// ---------------------------------------------------------------------------
// Rendering constants
// ---------------------------------------------------------------------------
export const SCALE    = 46;   // px per Ångström
export const BOND_OFF = 5.5;  // px between parallel bond lines
export const STROKE_W = 1.5;  // px
export const FONT_SIZE = 11;  // px
export const CELL_PAD  = 22;  // px padding inside each cell

// ---------------------------------------------------------------------------
// XML helper
// ---------------------------------------------------------------------------
function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Bond SVG rendering — returns an array of SVG element strings.
// For stereo bonds a1 is the chiral centre (pointed tip).
// ---------------------------------------------------------------------------
function bondToSVG(bond, a1, a2, mol, toSVG, stereoType) {
  const out = [];

  if (stereoType === 'wedge' || stereoType === 'dash') {
    const s1 = toSVG(a1), s2 = toSVG(a2);
    const { nx, ny } = perpUnit(s2.x - s1.x, s2.y - s1.y);
    if (stereoType === 'wedge') {
      const pts =
        `${s1.x.toFixed(2)},${s1.y.toFixed(2)} ` +
        `${(s2.x - nx * WEDGE_HALF_W).toFixed(2)},${(s2.y - ny * WEDGE_HALF_W).toFixed(2)} ` +
        `${(s2.x + nx * WEDGE_HALF_W).toFixed(2)},${(s2.y + ny * WEDGE_HALF_W).toFixed(2)}`;
      out.push(`<polygon points="${pts}" fill="#111" stroke="none"/>`);
    } else {
      for (let i = 1; i <= WEDGE_DASHES; i++) {
        const t = i / (WEDGE_DASHES + 1);
        const px = s1.x + t * (s2.x - s1.x);
        const py = s1.y + t * (s2.y - s1.y);
        const hw = WEDGE_HALF_W * t;
        out.push(
          `<line x1="${(px - nx * hw).toFixed(2)}" y1="${(py - ny * hw).toFixed(2)}"` +
          ` x2="${(px + nx * hw).toFixed(2)}" y2="${(py + ny * hw).toFixed(2)}"` +
          ' stroke="#111" stroke-width="1.2" stroke-linecap="round"/>'
        );
      }
    }
    return out;
  }

  const order = bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
  const s1 = toSVG(a1), s2 = toSVG(a2);
  const dx = s2.x - s1.x, dy = s2.y - s1.y;
  const { nx, ny } = perpUnit(dx, dy);

  const lineEl = (x1, y1, x2, y2, dash) =>
    `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"` +
    ` stroke="#222" stroke-width="${STROKE_W}"${dash ? ' stroke-dasharray="3,3"' : ''}/>`;

  if (order === 1) {
    out.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
  } else if (order === 2) {
    const dir = secondaryDir(a1, a2, mol, toSVG);
    out.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
    const ox = nx * BOND_OFF * dir, oy = ny * BOND_OFF * dir;
    const l2 = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy, 4, 4);
    out.push(lineEl(l2.x1, l2.y1, l2.x2, l2.y2, false));
  } else if (order === 3) {
    for (const d of [-BOND_OFF, 0, BOND_OFF]) {
      const ox = nx * d, oy = ny * d;
      const lt = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy,
        d !== 0 ? 4 : 0, d !== 0 ? 4 : 0);
      out.push(lineEl(lt.x1, lt.y1, lt.x2, lt.y2, false));
    }
  } else if (order === 1.5) {
    const dir = secondaryDir(a1, a2, mol, toSVG);
    out.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
    const ox = nx * BOND_OFF * dir, oy = ny * BOND_OFF * dir;
    const ld = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy, 5, 5);
    out.push(lineEl(ld.x1, ld.y1, ld.x2, ld.y2, true));
  }

  return out;
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

  // Collect implicit-H counts before hiding hydrogens.
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

  // Hide (not strip) so chiral centers retain their H neighbours.
  mol.hideHydrogens();

  try {
    generateCoords(mol, { suppressH: true, bondLength: 1.5 });
  } catch {
    return null;
  }

  // Give chiral H atoms a real position so their stereo bond can be drawn.
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const nbrs = atom.getNeighbors(mol);
    if (nbrs.length !== 1) {
      continue;
    }
    const parent = nbrs[0];
    if (!parent.properties.chirality) {
      continue;
    }
    const others = parent.getNeighbors(mol).filter(n => n.id !== atom.id);
    let sumX = 0, sumY = 0, cnt = 0;
    for (const nb of others) {
      if (nb.x != null) {
        sumX += nb.x - parent.x; sumY += nb.y - parent.y; cnt++;
      }
    }
    const angle = cnt > 0 ? Math.atan2(-sumY, -sumX) : 0;
    atom.x = parent.x + Math.cos(angle) * 1.5 * 0.75;
    atom.y = parent.y + Math.sin(angle) * 1.5 * 0.75;
  }

  const stereoMap = pickStereoWedges(mol);

  const atoms = [...mol.atoms.values()].filter(a => a.x != null && a.visible !== false);
  if (atoms.length === 0) {
    return null;
  }

  // Bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of atoms) {
    if (a.x < minX) {
      minX = a.x;
    }
    if (a.x > maxX) {
      maxX = a.x;
    }
    if (a.y < minY) {
      minY = a.y;
    }
    if (a.y > maxY) {
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
    y: cellH / 2 - (a.y - cy) * SCALE  // negate y: mol coords are y-up, SVG is y-down
  });

  const lines = [];

  // Bonds — skip hidden-H bonds unless they carry a stereo bond.
  for (const bond of mol.bonds.values()) {
    const [a1, a2] = bond.getAtomObjects(mol);
    if (!a1 || !a2 || a1.x == null || a2.x == null) {
      continue;
    }
    const isHBond = a1.visible === false || a2.visible === false;
    if (isHBond && !stereoMap.has(bond.id)) {
      continue;
    }

    const stereoType = stereoMap.get(bond.id) ?? null;
    let sa1 = a1, sa2 = a2;
    if (stereoType && a2.properties.chirality) {
      sa1 = a2; sa2 = a1;
    }
    lines.push(...bondToSVG(bond, sa1, sa2, mol, toSVG, stereoType));
  }

  // Decrement hCount for any H shown via a stereo bond.
  for (const [bondId] of stereoMap) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [ba1, ba2] = bond.getAtomObjects(mol);
    const hAtom   = ba1?.visible === false ? ba1 : (ba2?.visible === false ? ba2 : null);
    const heavyAt = hAtom ? (hAtom === ba1 ? ba2 : ba1) : null;
    if (!heavyAt) {
      continue;
    }
    const n = (hCounts.get(heavyAt.id) ?? 0) - 1;
    if (n <= 0) {
      hCounts.delete(heavyAt.id);
    } else {
      hCounts.set(heavyAt.id, n);
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
    const hw = labelHalfW(label, FONT_SIZE);
    const hh = labelHalfH(label, FONT_SIZE);

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

  // R/S chirality labels — small italic text above each chiral centre.
  const chiralEls = [];
  for (const atom of atoms) {
    const rs = atom.properties.chirality;
    if (rs !== 'R' && rs !== 'S') {
      continue;
    }
    const { x, y } = toSVG(atom);
    // Offset upward by ~8 px so the label sits just above the atom symbol (or bond junction).
    chiralEls.push(
      `<text x="${x.toFixed(2)}" y="${(y - 10).toFixed(2)}" font-family="sans-serif" font-size="10" font-style="italic" fill="#555" text-anchor="middle" dominant-baseline="auto">${rs}</text>`
    );
  }

  const svgContent = [
    `<rect width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="white"/>`,
    ...lines,
    ...labelEls,
    ...chiralEls
  ].join('\n');

  return { svgContent, cellW, cellH };
}

// ---------------------------------------------------------------------------
// buildCompositeSVG — assemble rendered cells into a grid SVG string
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

  for (let c = 1; c < cols; c++) {
    parts.push(`<line x1="${colX[c]}" y1="0" x2="${colX[c]}" y2="${totalH}" stroke="#e0e0e0" stroke-width="1"/>`);
  }
  for (let r = 1; r < rows; r++) {
    parts.push(`<line x1="0" y1="${rowY[r]}" x2="${totalW}" y2="${rowY[r]}" stroke="#e0e0e0" stroke-width="1"/>`);
  }

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
