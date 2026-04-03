/**
 * Generate composite PNG images of all molecules in the shared example-molecules
 * list, rendered as 2D skeletal structures in a 10-column grid.
 *
 * Produces two output files:
 *   - YYYYmmdd_molecules_test_grid_smiles.png  (rendered from SMILES)
 *   - YYYYmmdd_molecules_test_grid_inchi.png   (rendered from InChI; null entries skipped)
 *
 * Usage:  node scripts/validation/generate-molecule-grid.js
 */

import { writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { renderMolSVGFromSMILES, renderMolSVGFromINCHI, buildCompositeSVG, svgToPng } from '../../src/layout/render2d.js';
import { randomMolecule } from '../../examples/example-molecules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const COLS = 10;
const LABEL_SPACE = 22;
const LABEL_FONT_SIZE = 11;
const LABEL_MAX_CHARS = 54;

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function clampLabel(text, maxChars = LABEL_MAX_CHARS) {
  if (!text) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

function withBottomLabel(cell, labelText) {
  if (!cell) {
    return null;
  }
  const cellW = cell.cellW;
  const cellH = cell.cellH + LABEL_SPACE;
  const label = escapeXml(clampLabel(labelText));
  const baselineY = cellH - 7;

  const svgContent = [
    '<g>',
    cell.svgContent,
    `<text x="${(cellW / 2).toFixed(2)}" y="${baselineY.toFixed(2)}"` +
      ' text-anchor="middle" dominant-baseline="alphabetic"' +
      ' font-family="Arial, Helvetica, sans-serif"' +
      ` font-size="${LABEL_FONT_SIZE}" fill="#5f5f5f">${label}</text>`,
    '</g>'
  ].join('');

  return { svgContent, cellW, cellH };
}

function saveGrid(molecules, key, renderFn, suffix) {
  console.log(`Rendering ${molecules.length} molecules (${suffix})…`); // eslint-disable-line no-console
  const cells = molecules.map((mol, i) => {
    const val = mol[key];
    const result = val ? renderFn(val) : null;
    if (val && !result) {
      console.warn(`  [${i}] failed: ${val}`); // eslint-disable-line no-console
    }
    return withBottomLabel(result, val);
  });

  const svgString = buildCompositeSVG(cells, COLS);
  const pngBuffer = svgToPng(svgString);

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const baseName = `${yyyy}${mm}${dd}_molecules_test_grid_${suffix}`;
  let outPath = join(__dirname, `${baseName}.png`);
  if (existsSync(outPath)) {
    let n = 1;
    while (existsSync(join(__dirname, `${baseName}-${n}.png`))) {
      n++;
    }
    outPath = join(__dirname, `${baseName}-${n}.png`);
  }
  writeFileSync(outPath, pngBuffer);
  console.log(`Saved ${outPath}  (${(pngBuffer.length / 1024).toFixed(0)} KB)`); // eslint-disable-line no-console
}

// ---------------------------------------------------------------------------
// Generate both grids
// ---------------------------------------------------------------------------
const options = { showChiralLabels: true, showLonePairs: true };
saveGrid(randomMolecule, 'smiles', smi => renderMolSVGFromSMILES(smi, options), 'smiles');
saveGrid(
  randomMolecule.filter(m => m.inchi),
  'inchi',
  inchi => renderMolSVGFromINCHI(inchi, options),
  'inchi'
);
