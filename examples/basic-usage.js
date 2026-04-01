/**
 * Basic usage example: parse SMILES, build matrices, compute Wiener index.
 */
import { parseSMILES, adjacencyMatrix, distanceMatrix, degreeMatrix, wienerIndex, randicIndex } from '../src/index.js';

const mol = parseSMILES('CCC'); // propane

const A = adjacencyMatrix(mol);
const D = distanceMatrix(A);
const DEG = degreeMatrix(A);

console.log('Propane (CCC)');
console.log('  Atoms:', mol.atomCount, '  Bonds:', mol.bondCount);
console.log('  Wiener index W =', wienerIndex(D)); // 4
console.log('  Randić index χ =', randicIndex(A, DEG).toFixed(4));
