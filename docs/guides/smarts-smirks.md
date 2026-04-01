# SMARTS and SMIRKS

This guide covers substructure searching with SMARTS and reaction transforms with SMIRKS.

---

## Contents

- [SMARTS syntax primer](#smarts-syntax-primer)
- [Substructure searching](#substructure-searching)
- [Functional group library](#functional-group-library)
- [SMIRKS reaction transforms](#smirks-reaction-transforms)
- [Reaction template library](#reaction-template-library)

---

## SMARTS syntax primer

SMARTS extends SMILES with query primitives in `[...]` brackets and bond primitives between atoms.

### Atom primitives

| Primitive | Meaning                            | Example              |
| --------- | ---------------------------------- | -------------------- |
| `#6`      | By atomic number                   | `[#6]` = any carbon  |
| `c` / `C` | Aromatic / aliphatic carbon        | `[c]`, `[C]`         |
| `X<n>`    | Exactly _n_ total connections      | `[CX4]` = sp³ carbon |
| `H<n>`    | Exactly _n_ attached hydrogens     | `[OH1]` = OH group   |
| `+` / `-` | Formal charge                      | `[N+]`, `[O-]`       |
| `a` / `A` | Aromatic / aliphatic (any element) | `[a]`                |
| `r<n>`    | In a ring of size _n_              | `[C;r6]` = in 6-ring |
| `R`       | In any ring                        | `[C;R]`              |
| `!`       | NOT                                | `[!C]` = non-carbon  |
| `;` / `,` | AND (high/low precedence) / OR     | `[C;X3,X4]`          |
| `$()`     | Recursive SMARTS                   | `[C;$([C](=O))]`     |

### Bond primitives

| Symbol  | Meaning       |
| ------- | ------------- |
| `-`     | Single bond   |
| `=`     | Double bond   |
| `#`     | Triple bond   |
| `:`     | Aromatic bond |
| `~`     | Any bond      |
| `/` `\` | Stereo (E/Z)  |

---

## Substructure searching

### `matchesSMARTS(mol, smarts)` → `boolean`

Returns `true` if the pattern matches anywhere in the molecule.

```js
import { parseSMILES } from 'molecules';
import { matchesSMARTS } from 'molecules/smarts';

const aspirin = parseSMILES('CC(=O)Oc1ccccc1C(=O)O');

matchesSMARTS(aspirin, '[CX3](=O)[OX2H1]'); // true  – carboxylic acid present
matchesSMARTS(aspirin, '[SX2H]'); // false – no thiol
```

### `findSMARTS(mol, smarts[, options])` → `Generator<Map>`

Yields one `Map<queryAtomId, targetAtomId>` per unique match (deduped by atom set).
Use the spread operator or `for...of` to collect matches.

```js
import { findSMARTS } from 'molecules/smarts';

const glycine = parseSMILES('NCC(=O)O');

const matches = [...findSMARTS(glycine, '[CX3](=O)[OX2H1]')];
console.log(matches.length); // 1

// Iterate over each match
for (const mapping of findSMARTS(glycine, '[#6]')) {
  for (const [queryId, targetId] of mapping) {
    const atom = glycine.atoms.get(targetId);
    console.log(targetId, atom.name);
  }
}
```

**Options**

| Key     | Type     | Default    | Description            |
| ------- | -------- | ---------- | ---------------------- |
| `limit` | `number` | `Infinity` | Stop after _n_ matches |

### `firstSMARTS(mol, smarts)` → `Map | null`

Returns the first mapping or `null` — convenient when you only need one.

```js
import { firstSMARTS } from 'molecules/smarts';

const hit = firstSMARTS(aspirin, '[CX3](=O)[OX2H1]');
if (hit) {
  const [, targetAtomId] = [...hit.entries()][0];
  console.log('matched atom:', targetAtomId);
}
```

### Working with match mappings

Each match is a `Map` from **query atom ID** → **target atom ID**.

```js
const imine = parseSMILES('CC(=N)C');
const [match] = [...findSMARTS(imine, '[CX3]=[NX2]')];

for (const [queryId, targetId] of match) {
  const atom = imine.atoms.get(targetId);
  console.log(`Query ${queryId} → target atom ${targetId} (${atom.name})`);
}
```

### E/Z stereo matching

Use `/` and `\` in the SMARTS pattern to match specific double-bond geometry.

```js
const transBut2ene = parseSMILES('C/C=C/C');
const cisBut2ene = parseSMILES('C/C=C\\C');

matchesSMARTS(transBut2ene, 'C/C=C/C'); // true
matchesSMARTS(cisBut2ene, 'C/C=C/C'); // false
```

---

## Functional group library

`functionalGroups` is a named catalog of SMARTS patterns for common functional groups.

```js
import { functionalGroups } from 'molecules/smarts';
import { matchesSMARTS, findSMARTS } from 'molecules/smarts';
import { parseSMILES } from 'molecules';

const mol = parseSMILES('CC(=O)O');

// Check for a carboxylic acid
matchesSMARTS(mol, functionalGroups.carboxylicAcid.smarts); // true

// List all groups present
const present = Object.entries(functionalGroups)
  .filter(([, fg]) => matchesSMARTS(mol, fg.smarts))
  .map(([key, fg]) => fg.name);

console.log(present); // ['Carbonyl', 'Carboxylic Acid', ...]
```

Each entry has `name` (display string) and `smarts` (pattern string).

### Available groups (selected)

**Hydrocarbons** — `alkene`, `alkyne`, `allene`, `aromaticRing5`, `aromaticRing6`

**Oxygen** — `alcohol`, `phenol`, `enol`, `ether`, `epoxide`, `carbonyl`, `aldehyde`, `ketone`,
`carboxylicAcid`, `ester`, `lactone`, `anhydride`, `acylHalide`, `hemiacetal`, `acetal`, `peroxide`

**Nitrogen** — `primaryAmine`, `secondaryAmine`, `tertiaryAmine`, `aromaticAmine`,
`quaternaryAmmonium`, `amide`, `primaryAmide`, `secondaryAmide`, `tertiaryAmide`, `lactam`,
`urea`, `thiourea`, `guanidine`, `amidine`, `imine`, `oxime`, `hydrazone`, `nitrile`,
`isocyanate`, `nitro`, `nitroso`, `hydroxylamine`, `hydrazine`, `azide`

**Sulfur** — `thiol`, `sulfide`, `disulfide`, `sulfoxide`, `sulfone`, `sulfonamide`,
`sulfonicAcid`, `thioester`, `thioamide`

**Phosphorus** — `phosphine`, `phosphate`, `phosphateDiester`, `phosphateMonoester`,
`phosphonate`, `phosphoricAcid`

**Boron** — `boronicAcid`, `boronicEster`

**Halogens** — `organofluoride`, `organochloride`, `organobromide`, `organoiodide`,
`organohalide`, `arylHalide`, `vinylHalide`

---

## SMIRKS reaction transforms

SMIRKS extends SMARTS with atom-map numbers and a `>>` separator:

```
reactant-pattern >> product-pattern
```

Numbered atoms (`:1`, `:2`, …) on the left are mapped to the same numbers on the right so the engine knows which atoms survive the transform.

### `applySMIRKS(mol, smirks)` → `Molecule`

Applies a SMIRKS transform to `mol` and returns the product as a new molecule.
Returns `null` if the reactant pattern does not match.

```js
import { parseSMILES, toSMILES, applySMIRKS } from 'molecules';

// Oxidise a primary alcohol to an aldehyde
const ethanol = parseSMILES('CCO');
const product = applySMIRKS(ethanol, '[C;X4;H1,H2:1][OH:2]>>[C:1]=[O:2]');
console.log(toSMILES(product)); // CC=O
```

```js
// Hydrolyse an ester
const ethylAcetate = parseSMILES('CCOC(=O)C');
const product = applySMIRKS(ethylAcetate, '[C:1](=[O:2])[O:3][C;!$(C=O):4]>>[C:1](=[O:2])[OH:3].[C:4]O');
console.log(toSMILES(product)); // CC(=O)O.CCO  (acetic acid + ethanol)
```

### Writing SMIRKS patterns

| Rule                                    | Detail                                   |
| --------------------------------------- | ---------------------------------------- |
| Atoms without map numbers               | Deleted from the product (leaving group) |
| New atoms in product only               | Inserted without a reactant origin       |
| Bond between mapped atoms in product    | Replaces or adds that bond               |
| No bond between mapped atoms in product | Bond is removed                          |

```js
// Deprotonate a carboxylic acid: remove H, set O to charge –1
const smirks = '[C:1](=[O:2])[OH:3]>>[C:1](=[O:2])[OH0-:3]';
const acetic = parseSMILES('CC(=O)O');
const acetate = applySMIRKS(acetic, smirks);
console.log(toSMILES(acetate)); // CC(=O)[O-]
```

---

## Reaction template library

`reactionTemplates` is a named catalog of pre-built SMIRKS transforms.

```js
import { applySMIRKS, reactionTemplates, parseSMILES, toSMILES } from 'molecules';

const propanol = parseSMILES('CCCO');
const product = applySMIRKS(propanol, reactionTemplates.alcoholOxidation.smirks);
console.log(toSMILES(product)); // CCC=O  (propanal)
```

Each entry has `name` and `smirks`.

### Template categories

**Oxidation / reduction**

| Key                           | Description                    |
| ----------------------------- | ------------------------------ |
| `alcoholOxidation`            | Alcohol → aldehyde / ketone    |
| `aldehydeOxidation`           | Aldehyde → carboxylic acid     |
| `carbonylReduction`           | Ketone/aldehyde → alcohol      |
| `imineReduction`              | Imine → amine                  |
| `alkeneHydrogenation`         | Alkene → alkane                |
| `alkynePartialReduction`      | Alkyne → alkene                |
| `alkyneFullReduction`         | Alkyne → alkane                |
| `benzylicOxidation`           | Benzylic methyl → benzaldehyde |
| `nitroReduction`              | Nitro → primary amine          |
| `sulfideOxidationToSulfoxide` | Sulfide → sulfoxide            |
| `sulfoxideOxidationToSulfone` | Sulfoxide → sulfone            |

**Substitution / interconversion**

| Key                           | Description            |
| ----------------------------- | ---------------------- |
| `dehalogenation`              | Remove halide          |
| `halideHydrolysis`            | Alkyl halide → alcohol |
| `arylHalideHydrolysis`        | Aryl halide → phenol   |
| `alcoholHalogenation`         | Alcohol → chloride     |
| `nitrileHydrogenationToImine` | Nitrile → imine        |
| `etherCleavage`               | Ether → two alcohols   |

**Acyl chemistry**

| Key                        | Description                              |
| -------------------------- | ---------------------------------------- |
| `esterHydrolysis`          | Ester → acid + alcohol                   |
| `esterification`           | Acid + alcohol → ester                   |
| `saponification`           | Ester → carboxylate (base)               |
| `anhydrideHydrolysis`      | Anhydride → two acids                    |
| `amideHydrolysis`          | Amide → acid + amine                     |
| `amineAcylation`           | Acid chloride + amine → amide            |
| `amineAlkylation`          | Alkyl chloride + amine → secondary amine |
| `lactoneHydrolysis`        | Lactone → hydroxy acid                   |
| `lactamHydrolysis`         | Lactam → amino acid                      |
| `acidChlorideHydrolysis`   | Acid chloride → carboxylic acid          |
| `nitrileHydrolysisToAmide` | Nitrile → amide                          |
| `nitrileHydrolysisToAcid`  | Nitrile → carboxylic acid                |
| `imineHydrolysis`          | Imine → carbonyl + amine                 |

**Acid/base and other**

| Key                           | Description                    |
| ----------------------------- | ------------------------------ |
| `carboxylicAcidDeprotonation` | Acid → carboxylate             |
| `carboxylateProtonation`      | Carboxylate → acid             |
| `amineProtonation`            | Amine → ammonium               |
| `ammoniumDeprotonation`       | Ammonium → amine               |
| `phenolDeprotonation`         | Phenol → phenolate             |
| `phenolateProtonation`        | Phenolate → phenol             |
| `alcoholDehydration`          | Alcohol → alkene               |
| `alkylChlorideElimination`    | Alkyl chloride → alkene        |
| `alcoholCleavage`             | Alcohol → carbocation fragment |

### Applying templates in bulk

```js
import { reactionTemplates, applySMIRKS, parseSMILES, toSMILES } from 'molecules';

const mol = parseSMILES('CC(=O)O'); // acetic acid

const products = Object.entries(reactionTemplates)
  .map(([key, t]) => ({ key, product: applySMIRKS(mol, t.smirks) }))
  .filter(({ product }) => product !== null);

for (const { key, product } of products) {
  console.log(key, '->', toSMILES(product));
}
```
