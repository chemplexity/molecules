/**
 * Generate a composite PNG image of all molecules in the randomMolecule array
 * from index.html, rendered as 2D skeletal structures in a 10-column grid.
 *
 * Usage:  node examples/generate_grid.js
 * Output: examples/yyyymmdd_molecules_test_grid.png
 */

import { writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import { renderMolSVG, buildCompositeSVG, svgToPng } from '../src/layout/render2d.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// All SMILES from index.html's randomMolecule array
// ---------------------------------------------------------------------------
const randomMolecule = [
  'CCCCC',
  'CC(C)CC',
  'CC(C)(C)C',
  'CC=CC',
  'C=CCC',
  'C/C=C\\C',
  'C/C=C/C',
  'C=CC=C',
  'C=C=CC',
  'CC#CC',
  'C#CCC',
  'OCCCC',
  'CC(O)CC',
  'CC(O)(C)C',
  'C(=O)CCC',
  'CC(=O)CC',
  'OC(CCC)=O',
  'O=C(CC)OC',
  'NC(CCC)=O',
  'O=C(CCC)OO',
  'ClC(CCC)=O',
  'O=C(CC)OC(C)=O',
  'C1CCCCC1',
  'C1CCCCC1C2CCCCC2',
  'C12(CCCCC1)CCCCC2',
  'C1C=CCC=C1',
  'c1ccccc1',
  'OCc1ccccc1',
  'c1ccccc1-c2ccccc2',
  'C12=CC=CC=C1C3=C(C=CC=C3)C=C2',
  'C1=CC=CN1',
  'c1occc1',
  'c1sccc1',
  'NC(C)C(O)=O',
  'NC(CCCNC(N)=N)C(O)=O',
  'NC(CC(N)=O)C(O)=O',
  'NC(CC(O)=O)C(O)=O',
  'NC(CS)C(O)=O',
  'NC(CCC(O)=O)C(O)=O',
  'NC(CCC(N)=O)C(O)=O',
  'NC(CC1=CNC=N1)C(O)=O',
  'NC(C(CC)C)C(O)=O',
  'CC(=O)C(Cl)CC(C(C)C)C=C',
  'C2C(=O)C1COCCC1CC2',
  'CC(CC(Cl)CCO)C',
  'CC1C(CC(CC1C)CCO)=O',
  'CCO',
  'CC(N)CC=O',
  'C#N',
  'O=C1CCCCC1',
  'c1ccc2ccccc2c1',
  'CC(=O)Oc1ccccc1C(=O)O',
  'C%10CCCCC%10',
  'C%10CC%11CCC%10C%11',
  'C1(C(C(C(C(C1F)Cl)Br)I)N)P',
  'C(C(C(C(C(C(C(C(C))))))))O',
  'CC(C)(C(C)(C(C)(C)C)C)C',
  'N[C@@H](C(=O)O)C1=CC=CC=C1',
  'N[C@H](C(=O)O)C1=CC=CC=C1',
  '[NH4+].[Cl-]',
  '[Na+].[O-]C(=O)C1=CC=CC=C1',
  '[13CH3][C@H]1CC[C@@H](O)[C@H](C1)N',
  '[2H]OC([2H])([2H])C',
  'C1=CC=[N+](C)=CC=C1',
  '[O-][N+](=O)C1=CC=CC=C1',
  'C1=CC2=C(C=C1)C=CC=C2',
  'c1ncccc1',
  'c1cc([N+](=O)[O-])ccc1',
  'C1(CC(CC(C1)C(C)(C)C)O)N',
  'C(C)(C)(C)(C)C',
  'P(=O)(O)(O)O',
  'S(=O)(=O)(N)N',
  'C1CN2CCC1CC2',
  'C1C2C3C1C23',
  'C12C3C4C1C5C2C3C45',
  'C1(C2(C3(C4(C1C5(C2C3C45)))))',
  'C%10N(CC%10)C(=O)C',
  'O=C1N(C)C(=O)N(C)C(=O)N1C',
  'C1=CC=C(C=C1)C(C(=O)O)(N)P(=O)(O)O',
  'CC1(C)S[C@@H]2[C@H](NC(=O)C(N)=O)C(=O)N2[C@H]1C(=O)O',
  'C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O',
  'N#CC(C#N)=C(C#N)C#N',
  'C(=C(/F)\\F)\\C(/Cl)=C\\Br',
  'F/C=C/F',
  'F/C=C\\F',
  'C1(=CC=CC=C1)C(=O)[O-].[K+]',
  '[Cu+2].[O-]S(=O)(=O)[O-]',
  'Cl[C@H]1[C@@H](Br)[C@H](I)[C@@H](F)[C@H]1N',
  'C1(CC2(CC3(CC1CC(C2)C3)))',
  'c1ccc(cc1)C2=NC(=O)N(C(=O)N2)C',
  'N1C=NC2=C1N=CN2[C@H]3C[C@H](O)[C@@H](CO)O3',
  'OC[C@H]1O[C@@H](O[C@H]2[C@@H](O)[C@H](O)[C@@H](CO)O[C@H]2O)[C@H](O)[C@@H](O)[C@@H]1O',
  'CC(C)(C1=CC(=CC(=C1O)C(C)(C)C)O)C(C)(C)C',
  'C1=CC=C2C(=C1)C3=CC=CC=C3C=C2',
  'C1=CC2=C3C=CC=CC3=CC=C2C=C1',
  'c1cc2ccc3cccc4cccc(c1)c2c34',
  '[C@@H]1([C@@H]([C@H]([C@@H](O1)O)O)O)O',
  'N(CC)(CC)(CC)',
  'C[N+](C)(C)CCO',
  '[O-]C1=CC=CC=C1',
  'C1=CC=[O+]C=C1',
  '[Si](C)(C)(C)C',
  '[Ge](C)(C)(C)C',
  '[Se](=O)(C)C',
  '[nH]1cccc1',
  'c1ccc2[nH]ccc2c1',
  'B(O)O',
  '[BH4-].[Na+]',
  'C1=CC=C(C=C1)[N+](=O)[O-]',
  'O=[N+]([O-])O',
  '[O-][S+](C)C',
  'C1CCC2(CC1)CCCCC2',
  'C1CC2CCC3CCC(C1)C23',
  'C1C[C@H]2[C@@H](C1)C=C[C@H]2O',
  'C1=CN=C[N-]1',
  '[Zn+2].[Cl-].[Cl-]',
  'C(C(C(C(C(C)))))(C(C)(C)C)C',
  'CC(C)(C)C1=CC(=O)C(=O)C=C1',
  'O=C([O-])C([N+](C)(C)C)C',
  'C1(N2CCCCC2)=CC=CC=C1',
  'C1=CC=C(C=C1)S(=O)(=O)N(C)C',
  'FC(F)(F)C1=CC=C(C=C1)C(=O)N2CCN(CC2)C',
  'C1CC1C2CC2C3CC3',
  'C1OC2(CCCCC2)O1',
  'C1C2C3C4C1C5C4C3C25',
  'N#C[C@@](Br)(Cl)I',
  '[C@](F)(Cl)(Br)I',
  'C1=CC(=CC=C1/C=C/C(=O)O)O',
  'COC1=CC(/C=C/C(=O)O)=CC(OC)=C1O',
  'C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2',
  'C%10OC%11CC(C%10)C%11',
  'C1(C2(C3(C4(C5(C1C2C3C45)))))',
  'N1([C@H](C)C)C(=O)N(C)C(=O)C(C)(C)C1=O',
  'C1=CC2=C(C=C1)N(C3CCCCC3)C(=O)C=C2',
  'CC1=C(C(=O)NC(=O)N1)N',
  'O=C1NC(=O)NC(=O)N1',
  '[Fe+2].[O-]C(=O)C1=CC=CC=C1.[O-]C(=O)C2=CC=CC=C2',
  'C1=CC=[C-]C=C1.[Li+]',
  'c1ccc(cc1)[C@H](F)[C@@H](Cl)Br',
  'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O',
  'C1CCC2C3CCC4=CC(=O)CCC4(C3CCC12C)C',
  'CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1',
  'CC(C)(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1',
  'CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C',
  'C1=CC2=C(C=C1O)C(=CN2)CCN',
  'OC[C@H]1O[C@@H](O[C@H]2[C@@H](O)[C@H](O)[C@@H](CO)O[C@H]2O)[C@H](O)[C@@H](O)[C@@H]1OC(=O)CCCCCC',
  'CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)N',
  'CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1C(=O)OC'
];

// ---------------------------------------------------------------------------
// Render and assemble
// ---------------------------------------------------------------------------
const COLS = 10;

console.log(`Rendering ${randomMolecule.length} molecules…`);
const cells = randomMolecule.map((smi, i) => {
  const result = renderMolSVG(smi);
  if (!result) {
    console.warn(`  [${i}] failed: ${smi}`); // eslint-disable-line no-console
  }
  return result;
});

const svgString = buildCompositeSVG(cells, COLS);
const pngBuffer = svgToPng(svgString);

// ---------------------------------------------------------------------------
// Date-stamped output filename
// ---------------------------------------------------------------------------
const now = new Date();
const yyyy = now.getFullYear();
const mm   = String(now.getMonth() + 1).padStart(2, '0');
const dd   = String(now.getDate()).padStart(2, '0');
const baseName = `${yyyy}${mm}${dd}_molecules_test_grid`;
let outPath = join(__dirname, `${baseName}.png`);
if (existsSync(outPath)) {
  let n = 1;
  while (existsSync(join(__dirname, `${baseName}-${n}.png`))) { n++; }
  outPath = join(__dirname, `${baseName}-${n}.png`);
}

writeFileSync(outPath, pngBuffer);
console.log(`Saved ${outPath}  (${(pngBuffer.length / 1024).toFixed(0)} KB)`);
