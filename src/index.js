// Core data structures
export { Atom, Bond, Molecule } from './core/index.js';

// Graph algorithms
export { bfs, dfs, allPairsShortestPaths } from './algorithms/index.js';

// Matrix builders
export {
  adjacencyMatrix,
  degreeMatrix,
  distanceMatrix,
  laplacianMatrix,
  randicMatrix,
  reciprocalMatrix,
  allMatrices
} from './matrices/index.js';

// Molecular properties
export { molecularFormula, molecularMass } from './descriptors/molecular.js';

// Topological descriptors
export {
  wienerIndex,
  hyperWienerIndex,
  balabanIndex,
  randicIndex,
  zagreb1,
  zagreb2,
  hararyIndex,
  hosoyaIndex
} from './descriptors/topological.js';

// Information-theoretic descriptors
export { graphEntropy, topologicalEntropy } from './descriptors/information.js';

// Spectral descriptors
export { adjacencySpectrum, laplacianSpectrum, spectralRadius } from './descriptors/spectral.js';

// I/O
export { parseSMILES, tokenize, decode, toJSON, fromJSON } from './io/index.js';

// 2D layout
export { generateCoords } from './layout/index.js';

// Periodic table
export { default as elements } from './data/elements.js';

// Utilities
export {
  zeros,
  ones,
  identity,
  addMatrices,
  subtractMatrices,
  multiplyMatrices,
  scalarMultiply,
  transposeMatrix,
  factorial,
  binomial,
  combinations,
  computeEigenvalues
} from './utils/index.js';
