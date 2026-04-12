/**
 * render2d.js — reusable 2D skeletal-structure renderer
 *
 * Exports:
 *   renderMolSVG(mol, options)              → { svgContent, cellW, cellH } | null
 *   renderMolSVGFromSMILES(smiles, options) → { svgContent, cellW, cellH } | null
 *   renderMolSVGFromINCHI(inchi, options)   → { svgContent, cellW, cellH } | null
 *   buildCompositeSVG(cells, cols)       → SVG string
 *   svgToPng(svgString)                  → Buffer (PNG)
 *
 * options.aromaticMode  'localized' (default) — Kekulé alternating single/double
 *                       'delocalized'         — uniform 1.5-order dashed bond
 * options.showLonePairs false (default) — render lone-pair dots on eligible atoms
 */

import { parseSMILES } from '../io/smiles.js';
import { parseINCHI } from '../io/inchi.js';
import { generateAndRefine2dCoords } from './index.js';
import {
  atomColor,
  WEDGE_HALF_W,
  WEDGE_DASHES,
  perpUnit,
  shortenLine,
  secondaryDir,
  labelHalfW,
  labelHalfH,
  labelTextOffset,
  formatChargeLabel,
  computeChargeBadgePlacement,
  getAtomLabel,
  computeLonePairDotPositions,
  pickStereoWedges,
  stereoBondCenterIdForRender,
  kekulize,
  atomBBox
} from './mol2d-helpers.js';
import { synthesizeHydrogenPosition } from '../layoutv2/stereo/wedge-geometry.js';
import { Resvg } from '@resvg/resvg-js';

// ---------------------------------------------------------------------------
// Rendering constants
// ---------------------------------------------------------------------------
export const SCALE = 46; // px per Ångström
export const BOND_OFF = 5.5; // px between parallel bond lines
export const STROKE_W = 1.5; // px
export const FONT_SIZE = 11; // px
export const CELL_PAD = 22; // px padding inside each cell
export const AROMATIC_RENDER_MODE = 'localized'; // 'localized' | 'delocalized'
export const WEDGE_TIP_TRIM = WEDGE_HALF_W * 0.5;

/**
 * Returns the placed incident ring polygons for one atom.
 * @param {import('../core/Molecule.js').Molecule} mol - Molecule graph.
 * @param {string} atomId - Atom id.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
function incidentRingPolygonsForAtom(mol, atomId) {
  return mol.getRings()
    .filter(ringAtomIds => ringAtomIds.includes(atomId))
    .map(ringAtomIds => ringAtomIds
      .map(ringAtomId => mol.atoms.get(ringAtomId))
      .filter(atom => atom && atom.x != null && atom.y != null)
      .map(atom => ({ x: atom.x, y: atom.y })))
    .filter(polygon => polygon.length >= 3);
}

/**
 * Projects hidden stereo hydrogens into drawable positions around their chiral parent atoms.
 * @param {import('../core/Molecule.js').Molecule} mol - Molecule graph.
 * @param {number} bondLength - Reference hidden-hydrogen bond length.
 * @returns {Map<string, {x: number, y: number}>} Projected hidden-hydrogen coordinates keyed by atom id.
 */
function projectHiddenStereoHydrogens(mol, bondLength) {
  const projectedCoords = new Map();
  for (const [, atom] of mol.atoms) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const neighbors = atom.getNeighbors(mol);
    if (neighbors.length !== 1) {
      continue;
    }
    const parent = neighbors[0];
    if (!parent.getChirality()) {
      continue;
    }
    const knownPositions = parent.getNeighbors(mol)
      .filter(neighbor => neighbor.id !== atom.id && neighbor.x != null && neighbor.y != null)
      .map(neighbor => ({ x: neighbor.x, y: neighbor.y }));
    const projectedPosition = synthesizeHydrogenPosition(
      { x: parent.x, y: parent.y },
      knownPositions,
      bondLength,
      {
        incidentRingPolygons: incidentRingPolygonsForAtom(mol, parent.id)
      }
    );
    projectedCoords.set(atom.id, projectedPosition);
  }
  return projectedCoords;
}

/**
 * Returns the coordinate that should be rendered for the atom.
 * @param {object} atom - Atom descriptor.
 * @param {Map<string, {x: number, y: number}>} projectedCoords - Projected hidden-hydrogen coordinate overrides.
 * @param {import('../core/Molecule.js').Molecule} mol - Molecule graph.
 * @returns {{x: number, y: number}|null} Render position, or null when unavailable.
 */
function renderPosition(atom, projectedCoords, mol) {
  if (!atom) {
    return null;
  }
  const projectedPosition = projectedCoords.get(atom.id);
  if (projectedPosition) {
    return projectedPosition;
  }
  if (atom.x == null || atom.y == null) {
    if (atom.name === 'H' && atom.visible === false) {
      const [parent] = atom.getNeighbors(mol);
      if (parent?.x != null && parent?.y != null) {
        return { x: parent.x, y: parent.y };
      }
    }
    return null;
  }
  return { x: atom.x, y: atom.y };
}

function renderBondOrder(bond, mode = AROMATIC_RENDER_MODE) {
  if (mode === 'localized' && (bond.properties.aromatic ?? false)) {
    return bond.properties.localizedOrder ?? bond.properties.order ?? 1.5;
  }
  return bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
}

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
function bondToSVG(bond, a1, a2, mol, toSVG, stereoType, aromaticMode = AROMATIC_RENDER_MODE) {
  const out = [];

  if (stereoType === 'wedge' || stereoType === 'dash') {
    const s1 = toSVG(a1),
      s2 = toSVG(a2);
    const { nx, ny } = perpUnit(s2.x - s1.x, s2.y - s1.y);
    if (stereoType === 'wedge') {
      const bondLength = Math.hypot(s2.x - s1.x, s2.y - s1.y) || 1;
      const tip = {
        x: s1.x + ((s2.x - s1.x) / bondLength) * WEDGE_TIP_TRIM,
        y: s1.y + ((s2.y - s1.y) / bondLength) * WEDGE_TIP_TRIM
      };
      const pts =
        `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ` +
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

  const order = renderBondOrder(bond, aromaticMode);
  const s1 = toSVG(a1),
    s2 = toSVG(a2);
  const dx = s2.x - s1.x,
    dy = s2.y - s1.y;
  const { nx, ny } = perpUnit(dx, dy);

  const lineEl = (x1, y1, x2, y2, dash) =>
    `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"` +
    ` stroke="#222" stroke-width="${STROKE_W}"${dash ? ' stroke-dasharray="3,3"' : ''}/>`;

  if (order === 1) {
    out.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
  } else if (order === 2) {
    const dir = secondaryDir(a1, a2, mol, toSVG);
    out.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
    const ox = nx * BOND_OFF * dir,
      oy = ny * BOND_OFF * dir;
    const l2 = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy, 4, 4);
    out.push(lineEl(l2.x1, l2.y1, l2.x2, l2.y2, false));
  } else if (order === 3) {
    for (const d of [-BOND_OFF, 0, BOND_OFF]) {
      const ox = nx * d,
        oy = ny * d;
      const lt = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy, d !== 0 ? 4 : 0, d !== 0 ? 4 : 0);
      out.push(lineEl(lt.x1, lt.y1, lt.x2, lt.y2, false));
    }
  } else if (order === 1.5) {
    const dir = secondaryDir(a1, a2, mol, toSVG);
    out.push(lineEl(s1.x, s1.y, s2.x, s2.y, false));
    const ox = nx * BOND_OFF * dir,
      oy = ny * BOND_OFF * dir;
    const ld = shortenLine(s1.x + ox, s1.y + oy, s2.x + ox, s2.y + oy, 5, 5);
    out.push(lineEl(ld.x1, ld.y1, ld.x2, ld.y2, true));
  }

  return out;
}

// ---------------------------------------------------------------------------
// renderMolSVG — render one molecule as an SVG fragment
//
// Accepts a pre-parsed Molecule object.
// Returns { svgContent: string, cellW: number, cellH: number } or null.
// ---------------------------------------------------------------------------
/**
 * Renders a molecule as an SVG fragment.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule to render.
 * @param {object} [options] - Rendering options.
 * @param {boolean} [options.showChiralLabels] - Whether to show chiral labels.
 * @param {boolean} [options.showLonePairs] - Whether to show lone pairs.
 * @param {string} [options.aromaticMode] - Aromatic ring rendering mode.
 * @returns {{svgContent: string, cellW: number, cellH: number}|null} SVG fragment or null.
 */
export function renderMolSVG(mol, { showChiralLabels = false, showLonePairs = false, aromaticMode = AROMATIC_RENDER_MODE } = {}) {
  if (!mol || mol.atoms.size === 0) {
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

  // Assign Kekulé bond orders to any aromatic bonds that lack them.
  if (aromaticMode === 'localized') {
    kekulize(mol);
  }

  try {
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength: 1.5, maxPasses: 6 });
  } catch {
    return null;
  }

  const projectedCoords = projectHiddenStereoHydrogens(mol, 1.5 * 0.75);

  const stereoMap = pickStereoWedges(mol);

  const atoms = [...mol.atoms.values()].filter(a => a.x != null && a.visible !== false);
  if (atoms.length === 0) {
    return null;
  }

  // Bounding box
  const { minX, maxX, minY, maxY, cx, cy } = atomBBox(atoms);

  const molW = Math.max((maxX - minX) * SCALE, 1);
  const molH = Math.max((maxY - minY) * SCALE, 1);
  const cellW = Math.max(molW + CELL_PAD * 2, 90);
  const cellH = Math.max(molH + CELL_PAD * 2, 80);

  const toSVG = atom => {
    const position = renderPosition(atom, projectedCoords, mol);
    return {
      x: cellW / 2 + (position.x - cx) * SCALE,
      y: cellH / 2 - (position.y - cy) * SCALE // negate y: mol coords are y-up, SVG is y-down
    };
  };

  const lines = [];

  // Bonds — skip hidden-H bonds unless they carry a stereo bond.
  for (const bond of mol.bonds.values()) {
    const [a1, a2] = bond.getAtomObjects(mol);
    if (!renderPosition(a1, projectedCoords, mol) || !renderPosition(a2, projectedCoords, mol)) {
      continue;
    }
    const isHBond = a1.visible === false || a2.visible === false;
    if (isHBond && !stereoMap.has(bond.id)) {
      continue;
    }

    const stereoType = stereoMap.get(bond.id) ?? null;
    let sa1 = a1,
      sa2 = a2;
    if (stereoType) {
      const centerId = stereoBondCenterIdForRender(mol, bond.id);
      if (centerId === a2.id) {
        sa1 = a2;
        sa2 = a1;
      }
    }
    lines.push(...bondToSVG(bond, sa1, sa2, mol, toSVG, stereoType, aromaticMode));
  }

  // Decrement hCount for any H shown via a stereo bond.
  for (const [bondId] of stereoMap) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [ba1, ba2] = bond.getAtomObjects(mol);
    const hAtom = ba1?.visible === false ? ba1 : ba2?.visible === false ? ba2 : null;
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
  const lonePairEls = [];
  const lonePairDotsByAtomId = new Map();
  for (const atom of atoms) {
    const label = getAtomLabel(atom, hCounts, toSVG, mol);
    let lonePairDots = [];
    if (showLonePairs) {
      lonePairDots = computeLonePairDotPositions(atom, mol, {
        pointForAtom: toSVG,
        label,
        fontSize: FONT_SIZE,
        offsetFromBoundary: label ? 5 : 6,
        dotSpacing: 4.2
      });
      lonePairDotsByAtomId.set(atom.id, lonePairDots);
    }
    if (!label) {
      if (showLonePairs) {
        for (const dot of lonePairDots) {
          lonePairEls.push(`<circle class="lone-pair" cx="${dot.x.toFixed(2)}" cy="${dot.y.toFixed(2)}" r="1.45" fill="#111"/>`);
        }
      }
      continue;
    }
    const { x, y } = toSVG(atom);
    const color = atomColor(atom.name);
    const hw = labelHalfW(label, FONT_SIZE);
    const hh = labelHalfH(label, FONT_SIZE);
    const dx = labelTextOffset(label, FONT_SIZE);

    labelEls.push(`<rect x="${(x + dx - hw).toFixed(2)}" y="${(y - hh).toFixed(2)}" width="${(hw * 2).toFixed(2)}" height="${(hh * 2).toFixed(2)}" fill="white" rx="2"/>`);

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

    const charge = atom.getCharge();
    let chargeSup = '';
    if (charge !== 0) {
      const sign = formatChargeLabel(charge);
      const extraOccupiedAngles = showLonePairs ? (lonePairDotsByAtomId.get(atom.id) ?? []).map(dot => Math.atan2(dot.y - y, dot.x - x)).filter(Number.isFinite) : [];
      const placement = computeChargeBadgePlacement(atom, mol, {
        pointForAtom: toSVG,
        label,
        fontSize: FONT_SIZE,
        chargeLabel: sign,
        extraOccupiedAngles
      });
      if (placement) {
        chargeSup =
          `<circle class="atom-charge-ring" cx="${placement.x.toFixed(2)}" cy="${placement.y.toFixed(2)}" r="${placement.radius.toFixed(2)}" fill="white" stroke="#111" stroke-width="0.9"/>` +
          `<text class="atom-charge-text" x="${placement.x.toFixed(2)}" y="${placement.y.toFixed(2)}" font-family="sans-serif" font-size="${placement.fontSize.toFixed(1)}" font-weight="700" fill="#111" text-anchor="middle" dominant-baseline="central">${escapeXml(sign)}</text>`;
      }
    }

    labelEls.push(
      `<text x="${(x + dx).toFixed(2)}" y="${y.toFixed(2)}" font-family="sans-serif" font-size="${FONT_SIZE}" fill="${color}" text-anchor="middle" dominant-baseline="central">${textContent}</text>${chargeSup}`
    );

    if (showLonePairs) {
      for (const dot of lonePairDots) {
        lonePairEls.push(`<circle class="lone-pair" cx="${dot.x.toFixed(2)}" cy="${dot.y.toFixed(2)}" r="1.45" fill="#111"/>`);
      }
    }
  }

  const chiralEls = [];
  if (showChiralLabels) {
    for (const atom of atoms) {
      const rs = atom.getChirality();
      if (rs !== 'R' && rs !== 'S') {
        continue;
      }
      const { x, y } = toSVG(atom);
      chiralEls.push(
        `<text x="${x.toFixed(2)}" y="${(y - 10).toFixed(2)}" font-family="sans-serif" font-size="10" font-style="italic" fill="#555" text-anchor="middle" dominant-baseline="auto">${rs}</text>`
      );
    }
  }

  const svgContent = [`<rect width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="white"/>`, ...lines, ...labelEls, ...lonePairEls, ...chiralEls].join('\n');

  return { svgContent, cellW, cellH };
}

// ---------------------------------------------------------------------------
// buildCompositeSVG — assemble rendered cells into a grid SVG string
// ---------------------------------------------------------------------------
/**
 * Assembles rendered SVG cells into a grid SVG string.
 * @param {Array<{svgContent: string, cellW: number, cellH: number}|null>} cells - Array of rendered cells.
 * @param {number} cols - Number of columns in the grid.
 * @returns {string} The composite SVG string.
 */
export function buildCompositeSVG(cells, cols) {
  const rows = Math.ceil(cells.length / cols);

  const colWidths = Array(cols).fill(0);
  const rowHeights = Array(rows).fill(0);

  for (let idx = 0; idx < cells.length; idx++) {
    const cell = cells[idx];
    if (!cell) {
      continue;
    }
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    colWidths[col] = Math.max(colWidths[col], cell.cellW);
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

  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">`, `<rect width="${totalW}" height="${totalH}" fill="white"/>`];

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
    const x = colX[col] + (colWidths[col] - (cell?.cellW ?? 0)) / 2;
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
// renderMolSVGFromSMILES / renderMolSVGFromINCHI — convenience wrappers
// ---------------------------------------------------------------------------
/**
 * Parses a SMILES string and renders the resulting molecule as SVG.
 * @param {string} smiles - The SMILES string to parse.
 * @param {object} [options] - Rendering options passed to renderMolSVG.
 * @returns {{svgContent: string, cellW: number, cellH: number}|null} SVG fragment or null.
 */
export function renderMolSVGFromSMILES(smiles, options) {
  let mol;
  try {
    mol = parseSMILES(smiles);
  } catch {
    return null;
  }
  return renderMolSVG(mol, options);
}

/**
 * Parses an InChI string and renders the resulting molecule as SVG.
 * @param {string} inchi - The InChI string to parse.
 * @param {object} [options] - Rendering options passed to renderMolSVG.
 * @returns {{svgContent: string, cellW: number, cellH: number}|null} SVG fragment or null.
 */
export function renderMolSVGFromINCHI(inchi, options) {
  let mol;
  try {
    mol = parseINCHI(inchi);
  } catch {
    return null;
  }
  return renderMolSVG(mol, options);
}

// ---------------------------------------------------------------------------
// svgToPng — convert an SVG string to a PNG Buffer via resvg-js
// ---------------------------------------------------------------------------
/**
 * Converts an SVG string to a PNG Buffer.
 * @param {string} svgString - The SVG content to convert.
 * @returns {Buffer} PNG image buffer.
 */
export function svgToPng(svgString) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: true }
  });
  return resvg.render().asPng();
}
