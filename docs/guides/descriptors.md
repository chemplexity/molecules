# Molecular Descriptors

This guide covers every descriptor function available in the `molecules` library, from simple
molecular formula to spectral graph indices.

---

## Contents

- [Molecular composition](#molecular-composition)
- [Physicochemical descriptors](#physicochemical-descriptors)
- [Matrix foundations](#matrix-foundations)
- [Topological indices](#topological-indices)
- [Spectral descriptors](#spectral-descriptors)
- [Information and entropy](#information-and-entropy)
- [Quick-reference table](#quick-reference-table)

---

## Molecular composition

```js
import { parseSMILES } from 'molecules';
import { molecularFormula, molecularMass } from 'molecules/descriptors';

const caffeine = parseSMILES('Cn1cnc2c1c(=O)n(c(=O)n2C)C');

console.log(molecularFormula(caffeine)); // { C: 8, H: 10, N: 4, O: 2 }
console.log(molecularMass(caffeine)); // 194.19  (monoisotopic, Da)
```

---

## Physicochemical descriptors

All physicochemical functions accept a `Molecule` as their first argument.

```js
import { logP, tpsa, hBondDonors, hBondAcceptors, rotatableBondCount, fsp3, lipinskiRuleOfFive } from 'molecules/descriptors';
import { parseSMILES } from 'molecules';

const aspirin = parseSMILES('CC(=O)Oc1ccccc1C(=O)O');
```

### `logP(mol)` → `number`

Wildman–Crippen partition coefficient (lipophilicity). Negative values indicate hydrophilicity.

```js
logP(aspirin); // 1.19
```

### `tpsa(mol)` → `number`

Topological polar surface area in Ų. Computed from N- and O-containing fragments.

```js
tpsa(aspirin); // 63.6
```

### `hBondDonors(mol)` → `{ count: number, atoms: string[] }`

Counts NH and OH groups. `atoms` lists the heavy-atom IDs that donate.

```js
const { count, atoms } = hBondDonors(aspirin);
console.log(count); // 1
```

### `hBondAcceptors(mol)` → `{ count: number, atoms: string[] }`

Counts lone-pair acceptors (N, O). `atoms` lists the accepting atom IDs.

```js
const { count } = hBondAcceptors(aspirin);
console.log(count); // 3
```

### `rotatableBondCount(mol)` → `{ count: number, bonds: string[] }`

Number of rotatable (non-ring, non-terminal) single bonds. `bonds` lists the bond IDs.

```js
const { count } = rotatableBondCount(aspirin);
count; // 3
```

### `fsp³(mol)` → `number`

Fraction of sp³ carbons. Values near 1 indicate greater three-dimensionality.

```js
fsp3(aspirin); // 0.111
```

### `lipinskiRuleOfFive(mol)` → `object`

Evaluates Lipinski's Rule-of-Five and returns a summary object.

```js
const ro5 = lipinskiRuleOfFive(aspirin);
// {
//   molecularWeight: 180.16,
//   logP: 1.19,
//   hBondDonors: 1,
//   hBondAcceptors: 4,
//   violations: 0,
//   passes: true
// }
```

A molecule `passes` when it has at most one violation.

---

## Matrix foundations

Topological and spectral indices operate on numeric matrices rather than `Molecule` objects
directly. Use the matrix helpers to convert first.

```js
import { adjacencyMatrix, degreeMatrix, distanceMatrix, laplacianMatrix } from 'molecules/matrices';
import { parseSMILES } from 'molecules';

const propane = parseSMILES('CCC');
const A = adjacencyMatrix(propane); // n×n  (heavy atoms only)
const DEG = degreeMatrix(A); // diagonal, DEG[i][i] = degree of atom i
const D = distanceMatrix(A); // shortest-path distances (Floyd-Warshall)
const L = laplacianMatrix(A, DEG); // L = DEG − A
```

### Matrix functions

| Function                  | Inputs     | Output                                 |
| ------------------------- | ---------- | -------------------------------------- |
| `adjacencyMatrix(mol)`    | Molecule   | `A` — n×n, hydrogen-suppressed         |
| `degreeMatrix(A)`         | `A`        | `DEG` — diagonal                       |
| `distanceMatrix(A)`       | `A`        | `D` — all-pairs shortest paths         |
| `laplacianMatrix(A, DEG)` | `A`, `DEG` | `L = DEG − A`                          |
| `randicMatrix(A, DEG)`    | `A`, `DEG` | `R[i][j] = 1/√(dᵢdⱼ)` for bonded pairs |
| `reciprocalMatrix(D)`     | `D`        | `RD[i][j] = 1/D[i][j]` (0 on diagonal) |

---

## Topological indices

All topological index functions accept pre-built matrices. Compute the matrices once and reuse
them when calculating several indices.

```js
import { adjacencyMatrix, degreeMatrix, distanceMatrix } from 'molecules/matrices';
import {
  wienerIndex,
  hyperWienerIndex,
  balabanIndex,
  randicIndex,
  zagreb1,
  zagreb2,
  hararyIndex,
  plattIndex,
  szegedIndex,
  abcIndex,
  gaIndex,
  harmonicIndex,
  sumConnectivityIndex,
  eccentricConnectivityIndex,
  wienerPolarityIndex,
  schultzIndex,
  gutmanIndex,
  forgottenIndex,
  narumiKatayamaIndex,
  hosoyaIndex
} from 'molecules/descriptors';
import { parseSMILES } from 'molecules';

const butane = parseSMILES('CCCC');
const A = adjacencyMatrix(butane);
const DEG = degreeMatrix(A);
const D = distanceMatrix(A);
```

### Distance-based indices

These take `D` (and sometimes `A`).

| Function              | Signature     | Description                                      |
| --------------------- | ------------- | ------------------------------------------------ |
| `wienerIndex`         | `(D)`         | Sum of all pairwise distances; W = Σᵢ＜ⱼ D[i][j] |
| `hyperWienerIndex`    | `(D)`         | WW = ½ Σᵢ＜ⱼ (D + D²)                            |
| `balabanIndex`        | `(D, A)`      | J index; encodes cyclic structure                |
| `hararyIndex`         | `(RD)`        | H = ½ Σ RD[i][j]; pass `reciprocalMatrix(D)`     |
| `szegedIndex`         | `(D, A)`      | Sz = Σ nᵤ(e)·nᵥ(e); equals Wiener for trees      |
| `wienerPolarityIndex` | `(D)`         | WP = number of pairs at distance 3               |
| `schultzIndex`        | `(D, A, DEG)` | MTI = Σᵢ (row sum of (A + D))ᵢ · degᵢ            |
| `gutmanIndex`         | `(D, A, DEG)` | WA = Σ edge (deg·row_sum)                        |

```js
console.log(wienerIndex(D)); // 10
console.log(balabanIndex(D, A)); // 2.0  (acyclic = m/(m−n+2)·…)
```

### Degree-based indices

These take `A` and/or `DEG`.

| Function               | Signature  | Description                           |
| ---------------------- | ---------- | ------------------------------------- |
| `randicIndex`          | `(A, DEG)` | χ = Σ (dᵢ·dⱼ)^(−½) for each edge      |
| `zagreb1`              | `(DEG)`    | M1 = Σ dᵢ²                            |
| `zagreb2`              | `(A, DEG)` | M2 = Σ dᵢ·dⱼ per edge                 |
| `plattIndex`           | `(A, DEG)` | F = Σ (dᵢ + dⱼ − 2) per edge          |
| `abcIndex`             | `(A, DEG)` | ABC = Σ √((dᵢ+dⱼ−2)/(dᵢ·dⱼ)) per edge |
| `gaIndex`              | `(A, DEG)` | GA = Σ 2√(dᵢdⱼ)/(dᵢ+dⱼ) per edge      |
| `harmonicIndex`        | `(A, DEG)` | H = Σ 2/(dᵢ+dⱼ) per edge              |
| `sumConnectivityIndex` | `(A, DEG)` | χˢ = Σ (dᵢ+dⱼ)^(−½) per edge          |
| `forgottenIndex`       | `(A, DEG)` | F-index = Σ (dᵢ³)                     |
| `narumiKatayamaIndex`  | `(A, DEG)` | NK = Π dᵢ^dᵢ                          |

```js
console.log(zagreb1(DEG)); // 8   (n-butane: degrees 1,2,2,1  → 1+4+4+1)
console.log(randicIndex(A, DEG)); // ~1.73
```

### Mixed indices

| Function                     | Signature     | Description                                           |
| ---------------------------- | ------------- | ----------------------------------------------------- |
| `eccentricConnectivityIndex` | `(A, DEG, D)` | ξᶜ = Σᵢ ecc(i)·deg(i); ecc = max row of D             |
| `hosoyaIndex`                | `(mol)`       | Z-index; total count of matchings including empty set |

```js
// hosoyaIndex takes the molecule directly (not matrices)
import { hosoyaIndex } from 'molecules/descriptors';
console.log(hosoyaIndex(butane)); // 6
```

**Full example — computing several indices at once**

```js
import { parseSMILES } from 'molecules';
import { adjacencyMatrix, degreeMatrix, distanceMatrix } from 'molecules/matrices';
import { wienerIndex, balabanIndex, randicIndex, zagreb1 } from 'molecules/descriptors';

const naphthalene = parseSMILES('c1ccc2ccccc2c1');
const A = adjacencyMatrix(naphthalene);
const DEG = degreeMatrix(A);
const D = distanceMatrix(A);

console.log('Wiener:  ', wienerIndex(D));
console.log('Balaban: ', balabanIndex(D, A));
console.log('Randić:  ', randicIndex(A, DEG));
console.log('Zagreb₁: ', zagreb1(DEG));
```

---

## Spectral descriptors

Spectral descriptors are derived from the eigenvalues of the adjacency or Laplacian matrix.

```js
import { adjacencyMatrix, degreeMatrix, laplacianMatrix } from 'molecules/matrices';
import { adjacencySpectrum, laplacianSpectrum, spectralRadius, estradaIndex } from 'molecules/descriptors';
import { parseSMILES } from 'molecules';

const benzene = parseSMILES('c1ccccc1');
const A = adjacencyMatrix(benzene);
const DEG = degreeMatrix(A);
const L = laplacianMatrix(A, DEG);
```

### `adjacencySpectrum(A)` → `number[]`

Returns eigenvalues of `A` sorted in descending order.

```js
adjacencySpectrum(A); // [2, 1, 1, -1, -1, -2]  (benzene)
```

### `laplacianSpectrum(L)` → `number[]`

Returns eigenvalues of `L` sorted ascending. The smallest is always 0 (connected graph).
The second-smallest (Fiedler value) quantifies connectivity strength.

```js
const λ = laplacianSpectrum(L);
console.log('Fiedler value:', λ[1]);
```

### `spectralRadius(A)` → `number`

The largest eigenvalue of `A`. Correlates with branching.

```js
spectralRadius(A); // 2.0  (benzene)
```

### `estradaIndex(A)` → `number`

EE = Σ eˡᵢ; sensitive to network connectivity and folding.

```js
estradaIndex(A); // ~13.43  (benzene)
```

---

## Information and entropy

### `graphEntropy(mol)` → `number`

Mowshowitz (1968) entropy based on degree partitioning of heavy atoms.

H = −Σ (nₖ/n) log₂(nₖ/n) where nₖ = count of atoms with degree k.

```js
import { graphEntropy } from 'molecules/descriptors';
import { parseSMILES } from 'molecules';

const mol = parseSMILES('CC(=O)O'); // acetic acid
graphEntropy(mol); // ~0.92  bits
```

Higher values indicate more diverse degree distribution (more complex topology).

### `topologicalEntropy(D)` → `number`

Bonchev–Trinajstić index based on distance-sum partitioning. Takes the distance matrix.

```js
import { topologicalEntropy } from 'molecules/descriptors';
import { adjacencyMatrix, distanceMatrix } from 'molecules/matrices';

const mol = parseSMILES('CCCC');
const D = distanceMatrix(adjacencyMatrix(mol));
topologicalEntropy(D); // ~1.94  bits
```

---

## Quick-reference table

| Function                     | Module        | Input               | Returns                     |
| ---------------------------- | ------------- | ------------------- | --------------------------- |
| `molecularFormula`           | `descriptors` | `mol`               | `{ [element]: count }`      |
| `molecularMass`              | `descriptors` | `mol`               | `number` (Da)               |
| `logP`                       | `descriptors` | `mol`               | `number`                    |
| `tpsa`                       | `descriptors` | `mol`               | `number` (Ų)                |
| `hBondDonors`                | `descriptors` | `mol`               | `{ count, atoms }`          |
| `hBondAcceptors`             | `descriptors` | `mol`               | `{ count, atoms }`          |
| `rotatableBondCount`         | `descriptors` | `mol`               | `{ count, bonds }`          |
| `fsp3`                       | `descriptors` | `mol`               | `number` [0–1]              |
| `lipinskiRuleOfFive`         | `descriptors` | `mol`               | `{ passes, violations, … }` |
| `graphEntropy`               | `descriptors` | `mol`               | `number` (bits)             |
| `hosoyaIndex`                | `descriptors` | `mol`               | `number`                    |
| `adjacencyMatrix`            | `matrices`    | `mol`               | `number[][]`                |
| `degreeMatrix`               | `matrices`    | `A`                 | `number[][]`                |
| `distanceMatrix`             | `matrices`    | `A`                 | `number[][]`                |
| `laplacianMatrix`            | `matrices`    | `A, DEG`            | `number[][]`                |
| `reciprocalMatrix`           | `matrices`    | `D`                 | `number[][]`                |
| `wienerIndex`                | `descriptors` | `D`                 | `number`                    |
| `hyperWienerIndex`           | `descriptors` | `D`                 | `number`                    |
| `balabanIndex`               | `descriptors` | `D, A`              | `number`                    |
| `randicIndex`                | `descriptors` | `A, DEG`            | `number`                    |
| `zagreb1`                    | `descriptors` | `DEG`               | `number`                    |
| `zagreb2`                    | `descriptors` | `A, DEG`            | `number`                    |
| `hararyIndex`                | `descriptors` | `RD` (reciprocal D) | `number`                    |
| `plattIndex`                 | `descriptors` | `A, DEG`            | `number`                    |
| `szegedIndex`                | `descriptors` | `D, A`              | `number`                    |
| `abcIndex`                   | `descriptors` | `A, DEG`            | `number`                    |
| `gaIndex`                    | `descriptors` | `A, DEG`            | `number`                    |
| `harmonicIndex`              | `descriptors` | `A, DEG`            | `number`                    |
| `sumConnectivityIndex`       | `descriptors` | `A, DEG`            | `number`                    |
| `eccentricConnectivityIndex` | `descriptors` | `A, DEG, D`         | `number`                    |
| `wienerPolarityIndex`        | `descriptors` | `D`                 | `number`                    |
| `schultzIndex`               | `descriptors` | `D, A, DEG`         | `number`                    |
| `gutmanIndex`                | `descriptors` | `D, A, DEG`         | `number`                    |
| `forgottenIndex`             | `descriptors` | `A, DEG`            | `number`                    |
| `narumiKatayamaIndex`        | `descriptors` | `A, DEG`            | `number`                    |
| `topologicalEntropy`         | `descriptors` | `D`                 | `number` (bits)             |
| `adjacencySpectrum`          | `descriptors` | `A`                 | `number[]`                  |
| `laplacianSpectrum`          | `descriptors` | `L`                 | `number[]`                  |
| `spectralRadius`             | `descriptors` | `A`                 | `number`                    |
| `estradaIndex`               | `descriptors` | `A`                 | `number`                    |
