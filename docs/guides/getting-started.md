# Getting Started

## Installation

```sh
npm install molecules-v2
```

## Quick Start

```js
import { parseSMILES, adjacencyMatrix, distanceMatrix, wienerIndex } from 'molecules-v2';

const mol = parseSMILES('CCC'); // propane
const { matrix: A } = adjacencyMatrix(mol);
const { matrix: D } = distanceMatrix(mol);

console.log(wienerIndex(D)); // 4
```

## Building a Molecule Manually

```js
import { Molecule } from 'molecules-v2';

const mol = new Molecule();
mol.addAtom('C1', 'C');
mol.addAtom('C2', 'C');
mol.addAtom('O1', 'O');
mol.addBond('b1', 'C1', 'C2');
mol.addBond('b2', 'C2', 'O1');
```

## Sub-path Imports

Import only what you need for smaller bundles:

```js
import { Molecule } from 'molecules-v2/core';
import { wienerIndex, zagreb1 } from 'molecules-v2/descriptors';
```
