/** @module render2d */

import { Resvg } from '@resvg/resvg-js';

import { parseSMILES } from '../../io/smiles.js';
import { parseINCHI } from '../../io/inchi.js';
import { applyCoords } from './apply.js';
import { generateCoords } from './api.js';
import { getRingAtomIds } from './topology/ring-analysis.js';
import { synthesizeHydrogenPosition } from './stereo/wedge-geometry.js';
import {
  atomBBox,
  atomColor,
  computeChargeBadgePlacement,
  computeLonePairDotPositions,
  formatChargeLabel,
  getAtomLabel,
  kekulize,
  labelHalfH,
  labelHalfW,
  ringLabelOffset,
  perpUnit,
  secondaryDir,
  shortenLine,
  stereoBondCenterIdForRender,
  WEDGE_DASHES,
  WEDGE_HALF_W
} from './render-helpers.js';

export const SCALE = 46;
export const BOND_OFF = 5.5;
export const STROKE_W = 1.5;
export const FONT_SIZE = 11;
export const CELL_PAD = 22;
export const AROMATIC_RENDER_MODE = 'localized';
export const WEDGE_TIP_TRIM = WEDGE_HALF_W * 0.5;

function renderBondOrder(bond, mode = AROMATIC_RENDER_MODE) {
  if (mode === 'localized' && (bond.properties.aromatic ?? false)) {
    return bond.properties.localizedOrder ?? bond.properties.order ?? 1.5;
  }
  return bond.properties.aromatic ? 1.5 : (bond.properties.order ?? 1);
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function collectStereoDisplayMap(molecule) {
  const map = new Map();
  for (const bond of molecule.bonds.values()) {
    const displayType = bond.properties.display?.as ?? null;
    if (displayType === 'wedge' || displayType === 'dash') {
      map.set(bond.id, displayType);
    }
  }
  return map;
}

function resolveLayoutSource(molecule, layoutResult, coords, layoutOptions) {
  if (layoutResult && coords) {
    throw new TypeError('renderMolSVG accepts either layoutResult or coords, not both.');
  }
  if (coords) {
    return {
      layoutSource: coords,
      bondLength: layoutOptions.bondLength ?? 1.5
    };
  }
  if (layoutResult) {
    return {
      layoutSource: layoutResult,
      bondLength: layoutResult.layoutGraph?.options?.bondLength ?? layoutOptions.bondLength ?? 1.5
    };
  }
  const generated = generateCoords(molecule, {
    suppressH: true,
    ...layoutOptions
  });
  return {
    layoutSource: generated,
    bondLength: generated.layoutGraph?.options?.bondLength ?? layoutOptions.bondLength ?? 1.5
  };
}

/**
 * Returns the currently placed incident ring polygons for one atom.
 * @param {object} molecule - Molecule graph.
 * @param {string} atomId - Atom id.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
function incidentRingPolygonsForAtom(molecule, atomId) {
  return getRingAtomIds(molecule)
    .filter(ringAtomIds => ringAtomIds.includes(atomId))
    .map(ringAtomIds =>
      ringAtomIds
        .map(ringAtomId => molecule.atoms.get(ringAtomId))
        .filter(atom => atom && atom.x != null && atom.y != null)
        .map(atom => ({ x: atom.x, y: atom.y }))
    )
    .filter(polygon => polygon.length >= 3);
}

/**
 * Projects hidden stereo hydrogens into drawable positions around their chiral parent atoms.
 * @param {object} molecule - Molecule graph.
 * @param {number} bondLength - Reference bond length.
 * @returns {Map<string, {x: number, y: number}>} Projected hidden-hydrogen coordinates keyed by atom id.
 */
function projectHiddenStereoHydrogens(molecule, bondLength) {
  const projectedCoords = new Map();
  for (const atom of molecule.atoms.values()) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const neighbors = atom.getNeighbors(molecule);
    if (neighbors.length !== 1) {
      continue;
    }
    const parent = neighbors[0];
    if (!parent.getChirality()) {
      continue;
    }
    const knownPositions = parent
      .getNeighbors(molecule)
      .filter(neighbor => neighbor.id !== atom.id && neighbor.x != null && neighbor.y != null)
      .map(neighbor => ({ x: neighbor.x, y: neighbor.y }));
    const projectedPosition = synthesizeHydrogenPosition({ x: parent.x, y: parent.y }, knownPositions, bondLength * 0.75, {
      incidentRingPolygons: incidentRingPolygonsForAtom(molecule, parent.id)
    });
    projectedCoords.set(atom.id, projectedPosition);
  }
  return projectedCoords;
}

/**
 * Returns the coordinate that should be rendered for the atom.
 * @param {object} atom - Atom descriptor.
 * @param {Map<string, {x: number, y: number}>} projectedCoords - Projected hidden-hydrogen coordinate overrides.
 * @param {object} molecule - Molecule graph.
 * @returns {{x: number, y: number}|null} Render position, or null when unavailable.
 */
function renderPosition(atom, projectedCoords, molecule) {
  if (!atom) {
    return null;
  }
  const projectedPosition = projectedCoords.get(atom.id);
  if (projectedPosition) {
    return projectedPosition;
  }
  if (atom.x == null || atom.y == null) {
    if (atom.name === 'H' && atom.visible === false) {
      const [parent] = atom.getNeighbors(molecule);
      if (parent?.x != null && parent?.y != null) {
        return { x: parent.x, y: parent.y };
      }
    }
    return null;
  }
  return { x: atom.x, y: atom.y };
}

function labelClearance(atom, otherSVGPt, molecule, toSVG, hCounts) {
  const label = getAtomLabel(atom, hCounts, toSVG, molecule);
  if (!label) {
    return 0;
  }
  const center = toSVG(atom);
  const dx = otherSVGPt.x - center.x;
  const dy = otherSVGPt.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  const { dx: cx, dy: cy } = ringLabelOffset(atom, molecule, toSVG, label, FONT_SIZE);
  const hw = labelHalfW(label, FONT_SIZE) + 1;
  const hh = labelHalfH(label, FONT_SIZE) + 1;
  const dirX = dx / length;
  const dirY = dy / length;
  const candidates = [];

  if (Math.abs(dirX) > 1e-9) {
    candidates.push((cx + hw) / dirX);
    candidates.push((cx - hw) / dirX);
  }
  if (Math.abs(dirY) > 1e-9) {
    candidates.push((cy + hh) / dirY);
    candidates.push((cy - hh) / dirY);
  }

  let best = Infinity;
  for (const t of candidates) {
    if (!(t > 0)) {
      continue;
    }
    const px = dirX * t;
    const py = dirY * t;
    if (px < cx - hw - 1e-6 || px > cx + hw + 1e-6) {
      continue;
    }
    if (py < cy - hh - 1e-6 || py > cy + hh + 1e-6) {
      continue;
    }
    best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : Math.max(hw, hh);
}

function shortenBondLineWithLabelClearance(atom1, atom2, start, end, molecule, toSVG, hCounts, minimumClearance = 0) {
  const c1 = Math.max(labelClearance(atom1, end, molecule, toSVG, hCounts), minimumClearance);
  const c2 = Math.max(labelClearance(atom2, start, molecule, toSVG, hCounts), minimumClearance);
  return shortenLine(start.x, start.y, end.x, end.y, c1, c2);
}

function bondToSVG(bond, firstAtom, secondAtom, molecule, toSVG, stereoType, hCounts, aromaticMode = AROMATIC_RENDER_MODE) {
  const output = [];

  if (stereoType === 'wedge' || stereoType === 'dash') {
    const startOriginal = toSVG(firstAtom);
    const endOriginal = toSVG(secondAtom);
    const { nx, ny } = perpUnit(endOriginal.x - startOriginal.x, endOriginal.y - startOriginal.y);
    const trimmed = shortenBondLineWithLabelClearance(firstAtom, secondAtom, startOriginal, endOriginal, molecule, toSVG, hCounts);
    const start = { x: trimmed.x1, y: trimmed.y1 };
    const end = { x: trimmed.x2, y: trimmed.y2 };
    if (stereoType === 'wedge') {
      const bondLength = Math.hypot(end.x - start.x, end.y - start.y) || 1;
      const tip = {
        x: start.x + ((end.x - start.x) / bondLength) * WEDGE_TIP_TRIM,
        y: start.y + ((end.y - start.y) / bondLength) * WEDGE_TIP_TRIM
      };
      const points =
        `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ` +
        `${(end.x - nx * WEDGE_HALF_W).toFixed(2)},${(end.y - ny * WEDGE_HALF_W).toFixed(2)} ` +
        `${(end.x + nx * WEDGE_HALF_W).toFixed(2)},${(end.y + ny * WEDGE_HALF_W).toFixed(2)}`;
      output.push(`<polygon points="${points}" fill="#111" stroke="none"/>`);
    } else {
      for (let index = 1; index <= WEDGE_DASHES; index++) {
        const t = index / (WEDGE_DASHES + 1);
        const px = start.x + t * (end.x - start.x);
        const py = start.y + t * (end.y - start.y);
        const halfWidth = WEDGE_HALF_W * t;
        output.push(
          `<line x1="${(px - nx * halfWidth).toFixed(2)}" y1="${(py - ny * halfWidth).toFixed(2)}"` +
            ` x2="${(px + nx * halfWidth).toFixed(2)}" y2="${(py + ny * halfWidth).toFixed(2)}"` +
            ' stroke="#111" stroke-width="1.2" stroke-linecap="round"/>'
        );
      }
    }
    return output;
  }

  const order = renderBondOrder(bond, aromaticMode);
  const start = toSVG(firstAtom);
  const end = toSVG(secondAtom);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const { nx, ny } = perpUnit(dx, dy);

  const lineElement = (x1, y1, x2, y2, dashed) =>
    `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"` +
    ` stroke="#222" stroke-width="${STROKE_W}"${dashed ? ' stroke-dasharray="3,3"' : ''}/>`;

  if (order === 1) {
    const trimmed = shortenBondLineWithLabelClearance(firstAtom, secondAtom, start, end, molecule, toSVG, hCounts);
    output.push(lineElement(trimmed.x1, trimmed.y1, trimmed.x2, trimmed.y2, false));
  } else if (order === 2) {
    const direction = secondaryDir(firstAtom, secondAtom, molecule, toSVG);
    const primary = shortenBondLineWithLabelClearance(firstAtom, secondAtom, start, end, molecule, toSVG, hCounts);
    output.push(lineElement(primary.x1, primary.y1, primary.x2, primary.y2, false));
    const ox = nx * BOND_OFF * direction;
    const oy = ny * BOND_OFF * direction;
    const shifted = shortenBondLineWithLabelClearance(
      firstAtom,
      secondAtom,
      { x: start.x + ox, y: start.y + oy },
      { x: end.x + ox, y: end.y + oy },
      molecule,
      toSVG,
      hCounts,
      4
    );
    output.push(lineElement(shifted.x1, shifted.y1, shifted.x2, shifted.y2, false));
  } else if (order === 3) {
    for (const distance of [-BOND_OFF, 0, BOND_OFF]) {
      const ox = nx * distance;
      const oy = ny * distance;
      const shifted = shortenBondLineWithLabelClearance(
        firstAtom,
        secondAtom,
        { x: start.x + ox, y: start.y + oy },
        { x: end.x + ox, y: end.y + oy },
        molecule,
        toSVG,
        hCounts,
        distance !== 0 ? 4 : 0
      );
      output.push(lineElement(shifted.x1, shifted.y1, shifted.x2, shifted.y2, false));
    }
  } else if (order === 1.5) {
    const direction = secondaryDir(firstAtom, secondAtom, molecule, toSVG);
    const primary = shortenBondLineWithLabelClearance(firstAtom, secondAtom, start, end, molecule, toSVG, hCounts);
    output.push(lineElement(primary.x1, primary.y1, primary.x2, primary.y2, false));
    const ox = nx * BOND_OFF * direction;
    const oy = ny * BOND_OFF * direction;
    const shifted = shortenBondLineWithLabelClearance(
      firstAtom,
      secondAtom,
      { x: start.x + ox, y: start.y + oy },
      { x: end.x + ox, y: end.y + oy },
      molecule,
      toSVG,
      hCounts,
      5
    );
    output.push(lineElement(shifted.x1, shifted.y1, shifted.x2, shifted.y2, true));
  }

  return output;
}

/**
 * Renders a molecule as an SVG fragment using the layout/engine coordinate pipeline.
 * @param {object} molecule - Molecule graph.
 * @param {object} [options] - Rendering options.
 * @param {boolean} [options.showChiralLabels] - Whether to show chiral labels.
 * @param {boolean} [options.showLonePairs] - Whether to show lone-pair dots.
 * @param {'localized'|'delocalized'} [options.aromaticMode] - Aromatic rendering mode.
 * @param {object|null} [options.layoutResult] - Optional precomputed layout result.
 * @param {Map<string, {x: number, y: number}>|null} [options.coords] - Optional raw coordinate map.
 * @param {object} [options.layoutOptions] - Options passed to generateCoords when no external layout is provided.
 * @param {object} [options.applyOptions] - Options passed to applyCoords.
 * @returns {{svgContent: string, cellW: number, cellH: number}|null} SVG fragment or null.
 */
export function renderMolSVG(
  molecule,
  { showChiralLabels = false, showLonePairs = false, aromaticMode = AROMATIC_RENDER_MODE, layoutResult = null, coords = null, layoutOptions = {}, applyOptions = {} } = {}
) {
  if (!molecule || molecule.atoms.size === 0) {
    return null;
  }

  const hCounts = new Map();
  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H') {
      continue;
    }
    const count = atom.getNeighbors(molecule).filter(neighbor => neighbor.name === 'H').length;
    if (count > 0) {
      hCounts.set(atom.id, count);
    }
  }

  molecule.hideHydrogens();

  if (aromaticMode === 'localized') {
    kekulize(molecule);
  }

  let bondLength = 1.5;
  try {
    const resolved = resolveLayoutSource(molecule, layoutResult, coords, layoutOptions);
    bondLength = resolved.bondLength;
    applyCoords(molecule, resolved.layoutSource, {
      hiddenHydrogenMode: 'inherit',
      syncStereoDisplay: true,
      ...applyOptions
    });
  } catch {
    return null;
  }

  const projectedCoords = projectHiddenStereoHydrogens(molecule, bondLength);
  const stereoMap = collectStereoDisplayMap(molecule);
  const atoms = [...molecule.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
  if (atoms.length === 0) {
    return null;
  }

  const { minX, maxX, minY, maxY, cx, cy } = atomBBox(atoms);
  const molWidth = Math.max((maxX - minX) * SCALE, 1);
  const molHeight = Math.max((maxY - minY) * SCALE, 1);
  const cellW = Math.max(molWidth + CELL_PAD * 2, 90);
  const cellH = Math.max(molHeight + CELL_PAD * 2, 80);

  const toSVG = atom => {
    const position = renderPosition(atom, projectedCoords, molecule);
    return {
      x: cellW / 2 + (position.x - cx) * SCALE,
      y: cellH / 2 - (position.y - cy) * SCALE
    };
  };

  const bondElements = [];
  for (const bond of molecule.bonds.values()) {
    const [firstAtom, secondAtom] = bond.getAtomObjects(molecule);
    if (!renderPosition(firstAtom, projectedCoords, molecule) || !renderPosition(secondAtom, projectedCoords, molecule)) {
      continue;
    }
    const hiddenBond = firstAtom.visible === false || secondAtom.visible === false;
    if (hiddenBond && !stereoMap.has(bond.id)) {
      continue;
    }

    const stereoType = stereoMap.get(bond.id) ?? null;
    let renderFirst = firstAtom;
    let renderSecond = secondAtom;
    if (stereoType) {
      const centerId = stereoBondCenterIdForRender(molecule, bond.id);
      if (centerId === secondAtom.id) {
        renderFirst = secondAtom;
        renderSecond = firstAtom;
      }
    }
    bondElements.push(...bondToSVG(bond, renderFirst, renderSecond, molecule, toSVG, stereoType, hCounts, aromaticMode));
  }

  for (const [bondId] of stereoMap) {
    const bond = molecule.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [firstAtom, secondAtom] = bond.getAtomObjects(molecule);
    const hiddenHydrogen = firstAtom?.visible === false ? firstAtom : secondAtom?.visible === false ? secondAtom : null;
    const heavyAtom = hiddenHydrogen ? (hiddenHydrogen === firstAtom ? secondAtom : firstAtom) : null;
    if (!heavyAtom) {
      continue;
    }
    const nextCount = (hCounts.get(heavyAtom.id) ?? 0) - 1;
    if (nextCount <= 0) {
      hCounts.delete(heavyAtom.id);
    } else {
      hCounts.set(heavyAtom.id, nextCount);
    }
  }

  const labelElements = [];
  const lonePairElements = [];
  const lonePairAnglesByAtomId = new Map();
  for (const atom of atoms) {
    const label = getAtomLabel(atom, hCounts, toSVG, molecule);
    let lonePairDots = [];
    if (showLonePairs) {
      lonePairDots = computeLonePairDotPositions(atom, molecule, {
        pointForAtom: toSVG,
        label,
        fontSize: FONT_SIZE,
        offsetFromBoundary: label ? 5 : 6,
        dotSpacing: 4.2
      });
      lonePairAnglesByAtomId.set(
        atom.id,
        lonePairDots
          .map(dot => {
            const point = toSVG(atom);
            return Math.atan2(dot.y - point.y, dot.x - point.x);
          })
          .filter(Number.isFinite)
      );
    }

    if (!label) {
      if (showLonePairs) {
        for (const dot of lonePairDots) {
          lonePairElements.push(`<circle class="lone-pair" cx="${dot.x.toFixed(2)}" cy="${dot.y.toFixed(2)}" r="1.45" fill="#111"/>`);
        }
      }
      continue;
    }

    const { x, y } = toSVG(atom);
    const color = atomColor(atom.name);
    const halfWidth = labelHalfW(label, FONT_SIZE);
    const halfHeight = labelHalfH(label, FONT_SIZE);
    const { dx, dy } = ringLabelOffset(atom, molecule, toSVG, label, FONT_SIZE);

    labelElements.push(
      `<rect x="${(x + dx - halfWidth).toFixed(2)}" y="${(y + dy - halfHeight).toFixed(2)}" width="${(halfWidth * 2).toFixed(2)}" height="${(halfHeight * 2).toFixed(2)}" fill="white" rx="2"/>`
    );

    let textContent = '';
    let index = 0;
    while (index < label.length) {
      if (label[index] >= '0' && label[index] <= '9') {
        let number = '';
        while (index < label.length && label[index] >= '0' && label[index] <= '9') {
          number += label[index++];
        }
        textContent += `<tspan baseline-shift="sub" font-size="${(FONT_SIZE * 0.72).toFixed(1)}">${number}</tspan>`;
      } else {
        let word = '';
        while (index < label.length && !(label[index] >= '0' && label[index] <= '9')) {
          word += label[index++];
        }
        textContent += `<tspan>${escapeXml(word)}</tspan>`;
      }
    }

    const charge = atom.getCharge();
    let chargeMarkup = '';
    if (charge !== 0) {
      const chargeLabel = formatChargeLabel(charge);
      const placement = computeChargeBadgePlacement(atom, molecule, {
        pointForAtom: toSVG,
        label,
        fontSize: FONT_SIZE,
        chargeLabel,
        extraOccupiedAngles: lonePairAnglesByAtomId.get(atom.id) ?? []
      });
      if (placement) {
        chargeMarkup =
          `<circle class="atom-charge-ring" cx="${placement.x.toFixed(2)}" cy="${placement.y.toFixed(2)}" r="${placement.radius.toFixed(2)}" fill="white" stroke="#111" stroke-width="0.9"/>` +
          `<text class="atom-charge-text" x="${placement.x.toFixed(2)}" y="${placement.y.toFixed(2)}" font-family="sans-serif" font-size="${placement.fontSize.toFixed(1)}" font-weight="700" fill="#111" text-anchor="middle" dominant-baseline="central">${escapeXml(chargeLabel)}</text>`;
      }
    }

    labelElements.push(
      `<text x="${(x + dx).toFixed(2)}" y="${(y + dy).toFixed(2)}" font-family="sans-serif" font-size="${FONT_SIZE}" fill="${color}" text-anchor="middle" dominant-baseline="central">${textContent}</text>${chargeMarkup}`
    );

    if (showLonePairs) {
      for (const dot of lonePairDots) {
        lonePairElements.push(`<circle class="lone-pair" cx="${dot.x.toFixed(2)}" cy="${dot.y.toFixed(2)}" r="1.45" fill="#111"/>`);
      }
    }
  }

  const chiralElements = [];
  if (showChiralLabels) {
    for (const atom of atoms) {
      const chirality = atom.getChirality();
      if (chirality !== 'R' && chirality !== 'S') {
        continue;
      }
      const { x, y } = toSVG(atom);
      chiralElements.push(
        `<text x="${x.toFixed(2)}" y="${(y - 10).toFixed(2)}" font-family="sans-serif" font-size="10" font-style="italic" fill="#555" text-anchor="middle" dominant-baseline="auto">${chirality}</text>`
      );
    }
  }

  const svgContent = [
    `<rect width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" fill="white"/>`,
    ...bondElements,
    ...labelElements,
    ...lonePairElements,
    ...chiralElements
  ].join('\n');

  return { svgContent, cellW, cellH };
}

/**
 * Assembles rendered SVG cells into a grid SVG string.
 * @param {Array<{svgContent: string, cellW: number, cellH: number}|null>} cells - Rendered cells.
 * @param {number} cols - Grid column count.
 * @returns {string} Composite SVG.
 */
export function buildCompositeSVG(cells, cols) {
  const rows = Math.ceil(cells.length / cols);
  const colWidths = Array(cols).fill(0);
  const rowHeights = Array(rows).fill(0);

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    if (!cell) {
      continue;
    }
    const col = index % cols;
    const row = Math.floor(index / cols);
    colWidths[col] = Math.max(colWidths[col], cell.cellW);
    rowHeights[row] = Math.max(rowHeights[row], cell.cellH);
  }

  const colX = [0];
  for (let col = 0; col < cols - 1; col++) {
    colX.push(colX[col] + colWidths[col]);
  }
  const rowY = [0];
  for (let row = 0; row < rows - 1; row++) {
    rowY.push(rowY[row] + rowHeights[row]);
  }

  const totalW = colX[cols - 1] + colWidths[cols - 1];
  const totalH = rowY[rows - 1] + rowHeights[rows - 1];
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">`, `<rect width="${totalW}" height="${totalH}" fill="white"/>`];

  for (let col = 1; col < cols; col++) {
    parts.push(`<line x1="${colX[col]}" y1="0" x2="${colX[col]}" y2="${totalH}" stroke="#e0e0e0" stroke-width="1"/>`);
  }
  for (let row = 1; row < rows; row++) {
    parts.push(`<line x1="0" y1="${rowY[row]}" x2="${totalW}" y2="${rowY[row]}" stroke="#e0e0e0" stroke-width="1"/>`);
  }

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    const col = index % cols;
    const row = Math.floor(index / cols);
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

/**
 * Parses a SMILES string and renders the resulting molecule as SVG.
 * @param {string} smiles - SMILES string.
 * @param {object} [options] - Rendering options.
 * @returns {{svgContent: string, cellW: number, cellH: number}|null} SVG fragment or null.
 */
export function renderMolSVGFromSMILES(smiles, options) {
  let molecule;
  try {
    molecule = parseSMILES(smiles);
  } catch {
    return null;
  }
  return renderMolSVG(molecule, options);
}

/**
 * Parses an InChI string and renders the resulting molecule as SVG.
 * @param {string} inchi - InChI string.
 * @param {object} [options] - Rendering options.
 * @returns {{svgContent: string, cellW: number, cellH: number}|null} SVG fragment or null.
 */
export function renderMolSVGFromINCHI(inchi, options) {
  let molecule;
  try {
    molecule = parseINCHI(inchi);
  } catch {
    return null;
  }
  return renderMolSVG(molecule, options);
}

/**
 * Converts an SVG string to a PNG buffer.
 * @param {string} svgString - SVG content.
 * @returns {Buffer} PNG buffer.
 */
export function svgToPng(svgString) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: true }
  });
  return resvg.render().asPng();
}
