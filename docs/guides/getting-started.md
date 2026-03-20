# Getting Started

## Installation

```sh
npm install molecules
```

## Quick Start

Parse a SMILES string and compute a topological descriptor:

```js
import { parseSMILES, wienerIndex, distanceMatrix, adjacencyMatrix } from 'molecules';

const mol = parseSMILES('CCC'); // propane
const { matrix: A } = adjacencyMatrix(mol);
const { matrix: D } = distanceMatrix(A);

console.log(wienerIndex(D)); // 4
```

## Parsing and Serialising Molecules

```js
import { parseSMILES, toSMILES, toCanonicalSMILES, parseINCHI, toInChI } from 'molecules';

// SMILES round-trip
const mol = parseSMILES('CC(=O)O');  // acetic acid
console.log(toSMILES(mol));          // CC(=O)O  (input order)
console.log(toCanonicalSMILES(mol)); // canonical, stable identifier

// InChI round-trip
const inchi = toInChI(mol);          // InChI=1S/C2H4O2/c1-2(3)4/h1H3,(H,3,4)
const mol2  = parseINCHI(inchi);

// JSON serialisation
import { toJSON, fromJSON } from 'molecules';
const json = toJSON(mol);
const mol3 = fromJSON(json);
```

`toCanonicalSMILES` uses a Morgan-rank DFS so the same molecular graph always
produces the same string regardless of atom input order.

`toInChI` generates a standard InChI including the `/c` connection, `/h` hydrogen,
`/q` charge, `/b` E/Z, `/t` tetrahedral stereo, `/m`/`/s` stereo flags, and
`/i` isotope layers.

## Building a Molecule Manually

```js
import { Molecule } from 'molecules';

const mol = new Molecule();
mol.addAtom('C1', 'C');
mol.addAtom('C2', 'C');
mol.addAtom('O1', 'O');
mol.addBond('b1', 'C1', 'C2');
mol.addBond('b2', 'C2', 'O1');
```

## Molecular Descriptors

### Formula and mass

```js
import { parseSMILES, molecularFormula, molecularMass } from 'molecules';

const mol = parseSMILES('c1ccccc1'); // benzene
console.log(molecularFormula(mol)); // C6H6
console.log(molecularMass(mol));    // 78.11
```

### Topological indices

```js
import {
  wienerIndex, hyperWienerIndex, balabanIndex, randicIndex,
  zagreb1, zagreb2, hararyIndex, plattIndex, szegedIndex,
  hosoyaIndex, abcIndex, gaIndex, harmonicIndex,
  eccentricConnectivityIndex, wienerPolarityIndex,
  schultzIndex, gutmanIndex, forgottenIndex, narumiKatayamaIndex
} from 'molecules';
```

### Physicochemical properties

```js
import { logP, tpsa, hBondDonors, hBondAcceptors,
         rotatableBondCount, fsp3, lipinskiRuleOfFive } from 'molecules';

const mol = parseSMILES('CC(=O)Oc1ccccc1C(=O)O'); // aspirin
const rule = lipinskiRuleOfFive(mol);
// { mw, logP, hbd, hba, violations }
```

### Spectral descriptors

```js
import { adjacencySpectrum, laplacianSpectrum,
         spectralRadius, estradaIndex } from 'molecules';
```

### Information-theoretic descriptors

```js
import { graphEntropy, topologicalEntropy } from 'molecules';
```

## Graph Matrices

```js
import { parseSMILES, adjacencyMatrix, degreeMatrix,
         distanceMatrix, laplacianMatrix, randicMatrix,
         reciprocalMatrix, allMatrices } from 'molecules';

const mol = parseSMILES('CCC');
const { matrix: A } = adjacencyMatrix(mol);
const DEG = degreeMatrix(A);
const { matrix: D } = distanceMatrix(A);
const L = laplacianMatrix(A, DEG);
```

`allMatrices(mol)` returns all matrices at once.

## SMARTS Matching and Functional Groups

```js
import { parseSMILES, findSMARTS, matchesSMARTS,
         functionalGroups } from 'molecules';

const mol = parseSMILES('CC(=O)O');

// Built-in functional group detection
const groups = functionalGroups(mol);
// e.g. { carboxylicAcid: [...], carbonyl: [...], ... }

// Custom SMARTS query
const matches = findSMARTS('[CX3](=O)[OX2H1]', mol);
console.log(matchesSMARTS('[CX3](=O)[OX2H1]', mol)); // true
```

## Aromaticity

```js
import { parseSMILES, perceiveAromaticity } from 'molecules';

const mol = parseSMILES('C1=CC=CC=C1'); // Kekulé benzene
perceiveAromaticity(mol, { preserveKekule: true });
// Each ring atom now has atom.properties.aromatic === true
// Each ring bond now has bond.properties.aromatic === true
```

## Graph Traversal and Subgraph Isomorphism

```js
import { parseSMILES, bfs, dfs,
         findSubgraphMappings, matchesSubgraph } from 'molecules';

const mol   = parseSMILES('c1ccccc1CC');
const query = parseSMILES('c1ccccc1');

const mappings = findSubgraphMappings(mol, query);
console.log(matchesSubgraph(mol, query)); // true

// BFS from a start atom
const order = bfs(mol, [...mol.atoms.keys()][0]);
```

## 2D Coordinate Generation

```js
import { parseSMILES, generateCoords } from 'molecules';

const mol = parseSMILES('c1ccccc1');
generateCoords(mol);
// Each heavy atom now has atom.x and atom.y in Ångströms
```

## Valence Validation

```js
import { parseSMILES, validateValence } from 'molecules';

const warnings = validateValence(parseSMILES('C(C)(C)(C)(C)C'));
// [{ atomId, element, actual, expected, message }, ...]
```

## Sub-path Imports

Import only what you need to keep bundle sizes small:

```js
import { Molecule, Atom, Bond } from 'molecules/core';
import { parseSMILES, toSMILES, toCanonicalSMILES,
         parseINCHI, toInChI } from 'molecules/io';
import { wienerIndex, balabanIndex, logP } from 'molecules/descriptors';
import { adjacencyMatrix, distanceMatrix } from 'molecules/matrices';
import { generateCoords } from 'molecules/layout';
import { findSMARTS, functionalGroups } from 'molecules/smarts';
import { perceiveAromaticity, morganRanks } from 'molecules/algorithms';
import { validateValence } from 'molecules/validation';
```
