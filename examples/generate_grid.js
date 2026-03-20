/**
 * Generate composite PNG images of all molecules in the shared example-molecules
 * list, rendered as 2D skeletal structures in a 10-column grid.
 *
 * Produces two output files:
 *   - YYYYmmdd_molecules_test_grid_smiles.png  (rendered from SMILES)
 *   - YYYYmmdd_molecules_test_grid_inchi.png   (rendered from InChI; null entries skipped)
 *
 * Usage:  node examples/generate_grid.js
 */

import { writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import { renderMolSVGFromSMILES, renderMolSVGFromINCHI, buildCompositeSVG, svgToPng } from '../src/layout/render2d.js';
import { randomMolecule } from './example-molecules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const COLS = 10;

function saveGrid(molecules, key, renderFn, suffix) {
  console.log(`Rendering ${molecules.length} molecules (${suffix})\u2026`); // eslint-disable-line no-console
  const cells = molecules.map((mol, i) => {
    const val = mol[key];
    const result = val ? renderFn(val) : null;
    if (val && !result) {
      console.warn(`  [${i}] failed: ${val}`); // eslint-disable-line no-console
    }
    return result;
  });

  const svgString = buildCompositeSVG(cells, COLS);
  const pngBuffer = svgToPng(svgString);

  const now      = new Date();
  const yyyy     = now.getFullYear();
  const mm       = String(now.getMonth() + 1).padStart(2, '0');
  const dd       = String(now.getDate()).padStart(2, '0');
  const baseName = `${yyyy}${mm}${dd}_molecules_test_grid_${suffix}`;
  let   outPath  = join(__dirname, `${baseName}.png`);
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
saveGrid(randomMolecule, 'smiles', renderMolSVGFromSMILES, 'smiles');
saveGrid(randomMolecule.filter(m => m.inchi), 'inchi', renderMolSVGFromINCHI, 'inchi');
