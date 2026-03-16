/**
 * Example: compute multiple topological indices on several molecules.
 */
import { parseSMILES, adjacencyMatrix, distanceMatrix, degreeMatrix, reciprocalMatrix } from '../src/index.js';
import { wienerIndex, hyperWienerIndex, balabanIndex, zagreb1, zagreb2, hararyIndex, hosoyaIndex } from '../src/descriptors/topological.js';

const molecules = [
  { name: 'Methane',  smiles: 'C' },
  { name: 'Ethane',   smiles: 'CC' },
  { name: 'Propane',  smiles: 'CCC' },
  { name: 'Isobutane', smiles: 'CC(C)C' }
];

for (const { name, smiles } of molecules) {
  const mol = parseSMILES(smiles);
  const A = adjacencyMatrix(mol);
  const D = distanceMatrix(A);
  const DEG = degreeMatrix(A);
  const RD = reciprocalMatrix(D);

  console.log(`\n${name} (${smiles})`);
  console.log('  W  =', wienerIndex(D));
  console.log('  WW =', hyperWienerIndex(D));
  console.log('  J  =', balabanIndex(D, A).toFixed(4));
  console.log('  M1 =', zagreb1(DEG));
  console.log('  M2 =', zagreb2(A, DEG));
  console.log('  H  =', hararyIndex(RD).toFixed(4));
  console.log('  Z  =', hosoyaIndex(mol));
}
