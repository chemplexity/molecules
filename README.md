# molecules.js

A chemical graph theory library for JavaScript. Latest demo of `molecules.js` + `d3.js` [here](https://chemplexity.github.io/molecules/index.html).

![Imgur](http://i.imgur.com/idP2r6Q.jpg)

## Features

- **I/O** — parse and serialise SMILES and InChI formats
- **2D layout** — coordinate generation and refinement for skeletal-structure rendering
- **Aromaticity** — Hückel π-electron perception for arbitrary ring systems
- **SMARTS** — substructure search and built-in functional group detection
- **SMIRKS** — reaction transform parsing and application with built-in reaction templates
- **Graph matrices** — adjacency, degree, distance, Laplacian, Randić, reciprocal
- **Topological indices** — Wiener, Balaban, Randić, Zagreb, Harary, Schultz, and more
- **Physicochemical properties** — logP, TPSA, H-bond donors/acceptors, Lipinski Ro5
- **Spectral descriptors** — adjacency/Laplacian spectra, Estrada index, graph entropy
- **Valence validation** — detect over- and under-bonded atoms

## Installation

```sh
npm install molecules
```

## Quick Start

```js
import {
  parseSMILES,
  toCanonicalSMILES,
  toInChI,
  molecularFormula,
  wienerIndex,
  adjacencyMatrix,
  distanceMatrix
} from 'molecules';

const mol = parseSMILES('CC(=O)O'); // acetic acid

console.log(molecularFormula(mol)); // C2H4O2
console.log(toCanonicalSMILES(mol)); // canonical SMILES
console.log(toInChI(mol)); // InChI=1S/C2H4O2/c1-2(3)4/h1H3,(H,3,4)

const A = adjacencyMatrix(mol);
const D = distanceMatrix(A);
console.log(wienerIndex(D)); // 10
```

## Parsing and Serialisation

```js
import { parseSMILES, toSMILES, toCanonicalSMILES, parseINCHI, toInChI, toJSON, fromJSON } from 'molecules';

const mol = parseSMILES('[C@@H](F)(Cl)Br');

toSMILES(mol); // preserves input atom order
toCanonicalSMILES(mol); // stable, Morgan-ranked identifier
toInChI(mol); // full InChI with stereo (/t, /b) and isotope (/i) layers

const mol2 = parseINCHI('InChI=1S/C6H6/c1-2-4-6-5-3-1/h1-6H');
```

## SMARTS and Functional Groups

```js
import { parseSMILES, findSMARTS, matchesSMARTS, functionalGroups } from 'molecules';

const mol = parseSMILES('CC(=O)O');

// Detect all built-in functional groups
const groups = functionalGroups(mol);
// { carboxylicAcid: [[...]], carbonyl: [[...]], alkene: [], ... }

// Custom SMARTS query
const hits = findSMARTS('[CX3](=O)[OX2H1]', mol);
console.log(matchesSMARTS('[CX3](=O)[OX2H1]', mol)); // true
```

## SMIRKS Reaction Transforms

```js
import { parseSMILES, parseSMIRKS, applySMIRKS, reactionTemplates } from 'molecules';

// Apply a built-in reaction template
const alcohol = parseSMILES('CCO');
const product = applySMIRKS(alcohol, reactionTemplates.alcoholOxidation.smirks);

// Apply a custom SMIRKS transform
const mol = parseSMILES('CCl');
const hydrolysed = applySMIRKS(mol, '[C:1][Cl,Br,I:2]>>[C:1][OH:2]');
```

Built-in templates include `alcoholOxidation`, `carbonylReduction`,
`alkeneHydrogenation`, `alkynePartialReduction`, `esterHydrolysis`,
`amideHydrolysis`, `halideHydrolysis`, `dehalogenation`, and more.

## Descriptors

```js
import {
  // Physicochemical
  logP,
  tpsa,
  hBondDonors,
  hBondAcceptors,
  lipinskiRuleOfFive,
  // Topological
  wienerIndex,
  balabanIndex,
  randicIndex,
  zagreb1,
  zagreb2,
  hararyIndex,
  szegedIndex,
  hosoyaIndex,
  eccentricConnectivityIndex,
  // Spectral / information
  spectralRadius,
  estradaIndex,
  graphEntropy
} from 'molecules';
```

## 2D Coordinates

```js
import { parseSMILES, generateCoords } from 'molecules';

const mol = parseSMILES('c1ccccc1');
generateCoords(mol);
// atom.x and atom.y are now set in Ångströms
```

## Valence Validation

```js
import { parseSMILES, validateValence } from 'molecules';

const warnings = validateValence(parseSMILES('C(C)(C)(C)(C)C'));
// [{ atomId, element, actual, expected, message }]
```

## Sub-path Imports

```js
import { Molecule, Atom, Bond } from 'molecules/core';
import { parseSMILES, toCanonicalSMILES, toInChI } from 'molecules/io';
import { wienerIndex, logP, lipinskiRuleOfFive } from 'molecules/descriptors';
import { adjacencyMatrix, distanceMatrix } from 'molecules/matrices';
import { perceiveAromaticity, morganRanks } from 'molecules/algorithms';
import { validateValence } from 'molecules/validation';
```

## Molecule Catalog

A curated catalog of common molecules organised into named collections (amino acids, nucleobases, lipids, polycyclic aromatic hydrocarbons, and more).

```js
import { moleculeCatalog, findMolecules, getMoleculeCatalogById } from 'molecules/data';

// All collections
console.log(moleculeCatalog.length); // number of collections

// Search across all collections by name, alias, or tag
const hits = findMolecules('adenine'); // [{ molecule, collection }]

// Look up a collection by id
const nucleobases = getMoleculeCatalogById('nucleobases');
console.log(nucleobases.molecules.map(m => m.name));
```

## Documentation

Full API documentation and guides are in [`docs/`](docs/).
