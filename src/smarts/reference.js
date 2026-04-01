/** @module smarts/reference */

/**
 * Catalogue of common functional groups mapped to SMARTS query strings.
 *
 * Each entry has:
 *   `name`   — human-readable display name
 *   `smarts` — SMARTS pattern for use with `matchesSMARTS`, `findSMARTS`, etc.
 *
 * @example
 * import { functionalGroups } from './src/smarts/reference.js';
 * import { matchesSMARTS } from './src/smarts/index.js';
 *
 * const mol = parseSMILES('CC(=O)O');
 * const isAcid = matchesSMARTS(mol, functionalGroups.carboxylicAcid.smarts);
 */
export const functionalGroups = {
  // ---------------------------------------------------------------------------
  // Hydrocarbons
  // ---------------------------------------------------------------------------

  alkene: { name: 'Alkene', smarts: '[CX3;!a]=[CX3;!a]' },
  alkyne: { name: 'Alkyne', smarts: '[CX2]#[CX2]' },
  allene: { name: 'Allene', smarts: '[#6]=[CX2]=[#6]' },
  aromaticRing5: { name: 'Aromatic Ring (5-membered)', smarts: '[a]1[a][a][a][a]1' },
  aromaticRing6: { name: 'Aromatic Ring (6-membered)', smarts: '[a]1[a][a][a][a][a]1' },

  // ---------------------------------------------------------------------------
  // Oxygen functional groups
  // ---------------------------------------------------------------------------

  alcohol: { name: 'Alcohol', smarts: '[OX2H][CX4;!$([CX4][OX2H0])]' },
  phenol: { name: 'Phenol', smarts: '[OX2H]c' },
  enol: { name: 'Enol', smarts: '[OX2H][CX3;!$([CX3]=O)]=[CX3]' },
  ether: { name: 'Ether', smarts: '[#6;X3,X4,a][OX2;!$([OX2][CX3]=O);!r3][#6;X3,X4,a]' },
  epoxide: { name: 'Epoxide', smarts: '[OX2r3]1[#6r3][#6r3]1' },
  carbonyl: { name: 'Carbonyl', smarts: '[CX3;!$([CX3](=[OX1])[#7,#8,F,Cl,Br,I,S])](=[OX1])' },
  aldehyde: { name: 'Aldehyde', smarts: '[CX3H1]=[OX1]' },
  ketone: { name: 'Ketone', smarts: '[#6][CX3](=O)[#6]' },
  carboxylicAcid: { name: 'Carboxylic Acid', smarts: '[CX3](=O)[OX2H1]' },
  ester: { name: 'Ester', smarts: '[CX3](=O)[OX2H0][#6;!$([CX3]=O)]' },
  lactone: { name: 'Lactone', smarts: '[CX3;r](=O)[OX2;r]' },
  anhydride: { name: 'Anhydride', smarts: '[CX3](=O)[OX2][CX3]=O' },
  aceticAnhydride: { name: 'Acetic Anhydride', smarts: '[CH3][CX3](=O)[OX2][CX3](=O)[CH3]' },
  acylHalide: { name: 'Acyl Halide', smarts: '[CX3](=O)[F,Cl,Br,I]' },
  carbonate: { name: 'Carbonate Ester', smarts: '[#6][OX2][CX3](=O)[OX2][#6]' },
  carbamate: { name: 'Carbamate', smarts: '[NX3][CX3](=O)[OX2]' },
  hemiacetal: { name: 'Hemiacetal', smarts: '[OX2H][CX4][OX2][#6]' },
  acetal: { name: 'Acetal', smarts: '[CX4]([OX2][#6])([OX2][#6])[#6]' },
  orthoester: { name: 'Orthoester', smarts: '[CX4]([OX2][#6])([OX2][#6])[OX2][#6]' },
  peroxide: { name: 'Peroxide', smarts: '[OX2][OX2]' },

  // ---------------------------------------------------------------------------
  // Nitrogen functional groups
  // ---------------------------------------------------------------------------

  primaryAmine: {
    name: 'Primary Amine',
    smarts: '[NX3H2;!$([NX3][CX3](=O));!$([NX3][CX3]=S);!$([NX3][CX3]=[NX2])][#6]'
  },
  secondaryAmine: {
    name: 'Secondary Amine',
    smarts: '[NX3H1;!$([NX3][CX3](=O));!$([NX3][CX3]=S);!$([NX3][CX3]=[NX2])]([#6])[#6]'
  },
  tertiaryAmine: {
    name: 'Tertiary Amine',
    smarts: '[NX3H0;!$([NX3][CX3](=O));!$([NX3][CX3]=S);!$([NX3][CX3]=[NX2])]([#6])([#6])[#6]'
  },
  aromaticAmine: {
    name: 'Aromatic Amine',
    smarts: '[NX3H2;!$([NX3][CX3](=O));!$([NX3][CX3]=S);!$([NX3][CX3]=[NX2])]c'
  },
  quaternaryAmmonium: { name: 'Quaternary Ammonium', smarts: '[NX4+]([#6])([#6])([#6])[#6]' },
  amide: { name: 'Amide', smarts: '[NX3][CX3](=O)' },
  primaryAmide: { name: 'Primary Amide', smarts: '[NX3H2][CX3](=O)' },
  secondaryAmide: { name: 'Secondary Amide', smarts: '[NX3H1][CX3](=O)' },
  tertiaryAmide: { name: 'Tertiary Amide', smarts: '[NX3H0][CX3](=O)' },
  lactam: { name: 'Lactam', smarts: '[NX3;r][CX3;r](=O)' },
  urea: { name: 'Urea', smarts: '[NX3][CX3](=O)[NX3]' },
  thiourea: { name: 'Thiourea', smarts: '[NX3][CX3](=S)[NX3]' },
  guanidine: { name: 'Guanidine', smarts: '[NX3][CX3](=[NX2])[NX3]' },
  amidine: { name: 'Amidine', smarts: '[CX3](=[NX2])[NX3]' },
  imine: { name: 'Imine', smarts: '[CX3]=[NX2]' },
  oxime: { name: 'Oxime', smarts: '[CX3]=[NX2][OX2H]' },
  hydrazone: { name: 'Hydrazone', smarts: '[CX3]=[NX2][NX3]' },
  semicarbazone: { name: 'Semicarbazone', smarts: '[CX3]=[NX2][NX3][CX3](=O)[NX3]' },
  nitrile: { name: 'Nitrile', smarts: '[NX1]#[CX2]' },
  isocyanate: { name: 'Isocyanate', smarts: '[NX2]=C=O' },
  isothiocyanate: { name: 'Isothiocyanate', smarts: '[NX2]=C=S' },
  isonitrile: { name: 'Isonitrile', smarts: '[CX1-]#[NX2+]' },
  nitro: { name: 'Nitro', smarts: '[NX3,NX3+](=[OX1])~[OX1,OX1-]' },
  nitroso: { name: 'Nitroso', smarts: '[NX2](=O)[#6]' },
  hydroxylamine: { name: 'Hydroxylamine', smarts: '[NX3][OX2H]' },
  hydrazine: { name: 'Hydrazine', smarts: '[NX3][NX3]' },
  azide: { name: 'Azide', smarts: '[NX2-]=[NX2+]=[NX1-]' },
  diazo: { name: 'Diazo', smarts: '[CX3]=[NX2+]=[NX1-]' },
  cyanate: { name: 'Cyanate', smarts: '[OX2][CX2]#N' },

  // ---------------------------------------------------------------------------
  // Sulfur functional groups
  // ---------------------------------------------------------------------------

  thiol: { name: 'Thiol', smarts: '[SX2H][#6]' },
  sulfide: { name: 'Sulfide', smarts: '[SX2]([#6])[#6]' },
  disulfide: { name: 'Disulfide', smarts: '[SX2][SX2]' },
  sulfoxide: { name: 'Sulfoxide', smarts: '[SX3](=O)([#6])[#6]' },
  sulfone: { name: 'Sulfone', smarts: '[SX4](=O)(=O)([#6])[#6]' },
  sulfonamide: { name: 'Sulfonamide', smarts: '[SX4](=O)(=O)[NX3]' },
  sulfonylChloride: { name: 'Sulfonyl Chloride', smarts: '[SX4](=O)(=O)[Cl]' },
  sulfonicAcid: { name: 'Sulfonic Acid', smarts: '[SX4](=O)(=O)[OX2H]' },
  sulfonateEster: { name: 'Sulfonate Ester', smarts: '[SX4](=O)(=O)[OX2][#6]' },
  thiocarbonyl: { name: 'Thiocarbonyl', smarts: '[CX3]=S' },
  thioester: { name: 'Thioester', smarts: '[CX3](=O)[SX2][#6]' },
  thioamide: { name: 'Thioamide', smarts: '[NX3][CX3]=S' },

  // ---------------------------------------------------------------------------
  // Phosphorus functional groups
  // ---------------------------------------------------------------------------

  phosphine: { name: 'Phosphine', smarts: '[PX3]([#6])([#6])[#6]' },
  phosphineOxide: { name: 'Phosphine Oxide', smarts: '[(PX4,PX5)](=O)([#6])([#6])[#6]' },
  phosphate: { name: 'Phosphate Triester', smarts: '[(PX4,PX5)](=O)([OX2][#6])([OX2][#6])[OX2][#6]' },
  phosphateDiester: { name: 'Phosphate Diester', smarts: '[(PX4,PX5);$([PX4,PX5][OX2H])](=O)([OX2][#6])[OX2][#6]' },
  phosphateMonoester: { name: 'Phosphate Monoester', smarts: '[(PX4,PX5);$([PX4,PX5]([OX2H])[OX2H])](=O)[OX2][#6]' },
  phosphonate: { name: 'Phosphonate', smarts: '[#6][(PX4,PX5)](=O)[OX2]' },
  phosphonamide: { name: 'Phosphonamide', smarts: '[PX4,PX5](=O)([NX3])[#6]' },
  phosphoricAcid: { name: 'Phosphoric Acid', smarts: '[(PX4,PX5)](=O)([OX2H])([OX2H])[OX2H]' },

  // ---------------------------------------------------------------------------
  // Boron functional groups
  // ---------------------------------------------------------------------------

  boronicAcid: { name: 'Boronic Acid', smarts: '[BX3]([OX2H])[OX2H]' },
  boronicEster: { name: 'Boronic Ester', smarts: '[BX3]([OX2][#6])[OX2][#6]' },
  borinicAcid: { name: 'Borinic Acid', smarts: '[BX3]([OX2H])[#6]' },

  // ---------------------------------------------------------------------------
  // Halogens
  // ---------------------------------------------------------------------------

  organofluoride: { name: 'Organofluoride', smarts: '[#6;!$([CX3](=O)[F])][F]' },
  organochloride: { name: 'Organochloride', smarts: '[#6;!$([CX3](=O)[Cl])][Cl]' },
  organobromide: { name: 'Organobromide', smarts: '[#6;!$([CX3](=O)[Br])][Br]' },
  organoiodide: { name: 'Organoiodide', smarts: '[#6;!$([CX3](=O)[I])][I]' },
  organohalide: { name: 'Organohalide', smarts: '[#6;!$([CX3](=O)[F,Cl,Br,I])][F,Cl,Br,I]' },
  gemDihalide: { name: 'Gem-Dihalide', smarts: '[CX4]([F,Cl,Br,I])[F,Cl,Br,I]' },
  trihalide: { name: 'Trihalide', smarts: '[CX4]([F,Cl,Br,I])([F,Cl,Br,I])[F,Cl,Br,I]' },
  vinylHalide: { name: 'Vinyl Halide', smarts: '[CX3]=[CX3][F,Cl,Br,I]' },
  arylHalide: { name: 'Aryl Halide', smarts: 'c[F,Cl,Br,I]' },

  // ---------------------------------------------------------------------------
  // Carbocyclic rings (3–13 membered)
  // ---------------------------------------------------------------------------

  cyclopropane: { name: 'Cyclopropane', smarts: '[C;r3]1[C;r3][C;r3]1' },
  cyclobutane: { name: 'Cyclobutane', smarts: '[C;r4]1[C;r4][C;r4][C;r4]1' },
  cyclopentane: { name: 'Cyclopentane', smarts: '[C;r5]1[C;r5][C;r5][C;r5][C;r5]1' },
  cyclohexane: { name: 'Cyclohexane', smarts: '[C;r6]1[C;r6][C;r6][C;r6][C;r6][C;r6]1' },
  cycloheptane: { name: 'Cycloheptane', smarts: '[C;r7]1[C;r7][C;r7][C;r7][C;r7][C;r7][C;r7]1' },
  cyclooctane: { name: 'Cyclooctane', smarts: '[C;r8]1[C;r8][C;r8][C;r8][C;r8][C;r8][C;r8][C;r8]1' },
  cyclononane: { name: 'Cyclononane', smarts: '[C;r9]1[C;r9][C;r9][C;r9][C;r9][C;r9][C;r9][C;r9][C;r9]1' },
  cyclodecane: {
    name: 'Cyclodecane',
    smarts: '[C;r10]1[C;r10][C;r10][C;r10][C;r10][C;r10][C;r10][C;r10][C;r10][C;r10]1'
  },
  cycloundecane: {
    name: 'Cycloundecane',
    smarts: '[C;r11]1[C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11]1'
  },
  cyclododecane: {
    name: 'Cyclododecane',
    smarts: '[C;r12]1[C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12]1'
  },
  cyclotridecane: {
    name: 'Cyclotridecane',
    smarts: '[C;r13]1[C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13]1'
  },

  // ---------------------------------------------------------------------------
  // Cycloalkenes (3–13 membered, exactly the ring with ≥1 non-aromatic C=C)
  // ---------------------------------------------------------------------------

  cyclopropene: { name: 'Cyclopropene', smarts: '[CX3;r3;!a]1=[CX3;r3;!a][C;r3]1' },
  cyclobutene: { name: 'Cyclobutene', smarts: '[CX3;r4;!a]1=[CX3;r4;!a][C;r4][C;r4]1' },
  cyclopentene: { name: 'Cyclopentene', smarts: '[CX3;r5;!a]1=[CX3;r5;!a][C;r5][C;r5][C;r5]1' },
  cyclohexene: { name: 'Cyclohexene', smarts: '[CX3;r6;!a]1=[CX3;r6;!a][C;r6][C;r6][C;r6][C;r6]1' },
  cycloheptene: { name: 'Cycloheptene', smarts: '[CX3;r7;!a]1=[CX3;r7;!a][C;r7][C;r7][C;r7][C;r7][C;r7]1' },
  cyclooctene: { name: 'Cyclooctene', smarts: '[CX3;r8;!a]1=[CX3;r8;!a][C;r8][C;r8][C;r8][C;r8][C;r8][C;r8]1' },
  cyclononene: { name: 'Cyclononene', smarts: '[CX3;r9;!a]1=[CX3;r9;!a][C;r9][C;r9][C;r9][C;r9][C;r9][C;r9][C;r9]1' },
  cyclodecene: {
    name: 'Cyclodecene',
    smarts: '[CX3;r10;!a]1=[CX3;r10;!a][C;r10][C;r10][C;r10][C;r10][C;r10][C;r10][C;r10][C;r10]1'
  },
  cycloundecene: {
    name: 'Cycloundecene',
    smarts: '[CX3;r11;!a]1=[CX3;r11;!a][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11]1'
  },
  cyclododecene: {
    name: 'Cyclododecene',
    smarts: '[CX3;r12;!a]1=[CX3;r12;!a][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12]1'
  },
  cyclotridecene: {
    name: 'Cyclotridecene',
    smarts: '[CX3;r13;!a]1=[CX3;r13;!a][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13]1'
  },

  // ---------------------------------------------------------------------------
  // Conjugated cyclodienes (5–13 membered)
  // ---------------------------------------------------------------------------

  cyclopentadiene: { name: 'Cyclopentadiene', smarts: '[CX3;r5;!a]1=[CX3;r5;!a][CX3;r5;!a]=[CX3;r5;!a][C;r5]1' },
  cyclohexadiene: { name: 'Cyclohexadiene', smarts: '[CX3;r6;!a]1=[CX3;r6;!a][CX3;r6;!a]=[CX3;r6;!a][C;r6][C;r6]1' },
  cycloheptadiene: {
    name: 'Cycloheptadiene',
    smarts: '[CX3;r7;!a]1=[CX3;r7;!a][CX3;r7;!a]=[CX3;r7;!a][C;r7][C;r7][C;r7]1'
  },
  cyclooctadiene: {
    name: 'Cyclooctadiene',
    smarts: '[CX3;r8;!a]1=[CX3;r8;!a][CX3;r8;!a]=[CX3;r8;!a][C;r8][C;r8][C;r8][C;r8]1'
  },
  cyclononadiene: {
    name: 'Cyclononadiene',
    smarts: '[CX3;r9;!a]1=[CX3;r9;!a][CX3;r9;!a]=[CX3;r9;!a][C;r9][C;r9][C;r9][C;r9][C;r9]1'
  },
  cyclodecadiene: {
    name: 'Cyclodecadiene',
    smarts: '[CX3;r10;!a]1=[CX3;r10;!a][CX3;r10;!a]=[CX3;r10;!a][C;r10][C;r10][C;r10][C;r10][C;r10][C;r10]1'
  },
  cycloundecadiene: {
    name: 'Cycloundecadiene',
    smarts: '[CX3;r11;!a]1=[CX3;r11;!a][CX3;r11;!a]=[CX3;r11;!a][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11][C;r11]1'
  },
  cyclododecadiene: {
    name: 'Cyclododecadiene',
    smarts:
      '[CX3;r12;!a]1=[CX3;r12;!a][CX3;r12;!a]=[CX3;r12;!a][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12]1'
  },
  cyclotridecadiene: {
    name: 'Cyclotridecadiene',
    smarts:
      '[CX3;r13;!a]1=[CX3;r13;!a][CX3;r13;!a]=[CX3;r13;!a][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13]1'
  },

  // ---------------------------------------------------------------------------
  // Conjugated cyclotrienes (6–13 membered)
  // ---------------------------------------------------------------------------

  cyclohexatriene: {
    name: 'Cyclohexatriene',
    smarts: '[CX3;r6;!a]1=[CX3;r6;!a][CX3;r6;!a]=[CX3;r6;!a][CX3;r6;!a]=[CX3;r6;!a]1'
  },
  cycloheptatriene: {
    name: 'Cycloheptatriene',
    smarts: '[CX3;r7;!a]1=[CX3;r7;!a][CX3;r7;!a]=[CX3;r7;!a][CX3;r7;!a]=[CX3;r7;!a][C;r7]1'
  },
  cyclooctatriene: {
    name: 'Cyclooctatriene',
    smarts: '[CX3;r8;!a]1=[CX3;r8;!a][CX3;r8;!a]=[CX3;r8;!a][CX3;r8;!a]=[CX3;r8;!a][C;r8][C;r8]1'
  },
  cyclononatriene: {
    name: 'Cyclononatriene',
    smarts: '[CX3;r9;!a]1=[CX3;r9;!a][CX3;r9;!a]=[CX3;r9;!a][CX3;r9;!a]=[CX3;r9;!a][C;r9][C;r9][C;r9]1'
  },
  cyclodecatriene: {
    name: 'Cyclodecatriene',
    smarts: '[CX3;r10;!a]1=[CX3;r10;!a][CX3;r10;!a]=[CX3;r10;!a][CX3;r10;!a]=[CX3;r10;!a][C;r10][C;r10][C;r10][C;r10]1'
  },
  cycloundecatriene: {
    name: 'Cycloundecatriene',
    smarts:
      '[CX3;r11;!a]1=[CX3;r11;!a][CX3;r11;!a]=[CX3;r11;!a][CX3;r11;!a]=[CX3;r11;!a][C;r11][C;r11][C;r11][C;r11][C;r11]1'
  },
  cyclododecatriene: {
    name: 'Cyclododecatriene',
    smarts:
      '[CX3;r12;!a]1=[CX3;r12;!a][CX3;r12;!a]=[CX3;r12;!a][CX3;r12;!a]=[CX3;r12;!a][C;r12][C;r12][C;r12][C;r12][C;r12][C;r12]1'
  },
  cyclotridecatriene: {
    name: 'Cyclotridecatriene',
    smarts:
      '[CX3;r13;!a]1=[CX3;r13;!a][CX3;r13;!a]=[CX3;r13;!a][CX3;r13;!a]=[CX3;r13;!a][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13][C;r13]1'
  },

  // ---------------------------------------------------------------------------
  // 6-membered aromatic heterocycles
  // ---------------------------------------------------------------------------

  pyridine: { name: 'Pyridine', smarts: 'n1ccccc1' },
  pyrimidine: { name: 'Pyrimidine', smarts: 'n1cnccc1' },
  pyrazine: { name: 'Pyrazine', smarts: 'n1ccncc1' },
  pyridazine: { name: 'Pyridazine', smarts: 'n1ncccc1' },
  triazine: { name: '1,3,5-Triazine', smarts: 'n1cncnc1' },

  // ---------------------------------------------------------------------------
  // 5-membered aromatic heterocycles
  // ---------------------------------------------------------------------------

  pyrrole: { name: 'Pyrrole', smarts: '[nH]1cccc1' },
  furan: { name: 'Furan', smarts: 'o1cccc1' },
  thiophene: { name: 'Thiophene', smarts: 's1cccc1' },
  imidazole: { name: 'Imidazole', smarts: '[nH]1cncc1' },
  pyrazole: { name: 'Pyrazole', smarts: '[nH]1nccc1' },
  oxazole: { name: 'Oxazole', smarts: 'o1cncc1' },
  isoxazole: { name: 'Isoxazole', smarts: 'o1nccc1' },
  thiazole: { name: 'Thiazole', smarts: 's1cncc1' },
  triazole: { name: '1,2,3-Triazole', smarts: '[nH]1nncc1' },
  tetrazole: { name: 'Tetrazole', smarts: '[nH]1nnnc1' },

  // ---------------------------------------------------------------------------
  // Fused aromatic / heteroaromatic ring systems
  // ---------------------------------------------------------------------------

  indole: { name: 'Indole', smarts: 'c1ccc2[nH]ccc2c1' },
  benzofuran: { name: 'Benzofuran', smarts: 'c1ccc2occc2c1' },
  benzothiophene: { name: 'Benzothiophene', smarts: 'c1ccc2sccc2c1' },
  benzimidazole: { name: 'Benzimidazole', smarts: 'c1ccc2[nH]cnc2c1' },
  benzoxazole: { name: 'Benzoxazole', smarts: 'c1ccc2ocnc2c1' },
  benzothiazole: { name: 'Benzothiazole', smarts: 'c1ccc2scnc2c1' },
  indazole: { name: 'Indazole', smarts: 'c1ccc2[nH]ncc2c1' },
  quinoline: { name: 'Quinoline', smarts: 'c1ccc2ncccc2c1' },
  isoquinoline: { name: 'Isoquinoline', smarts: 'c1ccc2cnccc2c1' },
  quinoxaline: { name: 'Quinoxaline', smarts: 'c1ccc2nccnc2c1' },
  quinazoline: { name: 'Quinazoline', smarts: 'c1ccc2ncncc2c1' },
  phthalazine: { name: 'Phthalazine', smarts: 'c1ccc2cnncc2c1' },
  purine: { name: 'Purine', smarts: 'c1ncnc2[nH]cnc12' }
};
