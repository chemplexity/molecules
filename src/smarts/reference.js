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

  alkene: { name: 'Alkene',              smarts: '[CX3]=[CX3]' },
  alkyne: { name: 'Alkyne',              smarts: '[CX2]#[CX2]' },
  allene: { name: 'Allene',              smarts: '[CX2]=[CX2]=[CX2]' },
  arene: { name: 'Arene',               smarts: '[a]' },

  // ---------------------------------------------------------------------------
  // Oxygen functional groups
  // ---------------------------------------------------------------------------

  alcohol: { name: 'Alcohol',             smarts: '[OX2H][CX4]' },
  phenol: { name: 'Phenol',              smarts: '[OX2H]c' },
  enol: { name: 'Enol',                smarts: '[OX2H][CX3]' },
  ether: { name: 'Ether',               smarts: '[#6][OX2][#6]' },
  epoxide: { name: 'Epoxide',             smarts: '[OX2r3]1[#6r3][#6r3]1' },
  carbonyl: { name: 'Carbonyl',            smarts: '[CX3]=O' },
  aldehyde: { name: 'Aldehyde',            smarts: '[CX3H1]=O' },
  ketone: { name: 'Ketone',              smarts: '[#6][CX3](=O)[#6]' },
  carboxylicAcid: { name: 'Carboxylic acid',     smarts: '[CX3](=O)[OX2H1]' },
  ester: { name: 'Ester',               smarts: '[CX3](=O)[OX2H0][#6]' },
  lactone: { name: 'Lactone',             smarts: '[CX3;r](=O)[OX2;r]' },
  anhydride: { name: 'Anhydride',           smarts: '[CX3](=O)[OX2][CX3]=O' },
  acylHalide: { name: 'Acyl halide',         smarts: '[CX3](=O)[F,Cl,Br,I]' },
  carbonate: { name: 'Carbonate ester',     smarts: '[#6][OX2][CX3](=O)[OX2][#6]' },
  carbamate: { name: 'Carbamate',           smarts: '[NX3][CX3](=O)[OX2]' },
  hemiacetal: { name: 'Hemiacetal',          smarts: '[OX2H][CX4][OX2][#6]' },
  acetal: { name: 'Acetal',              smarts: '[CX4]([OX2][#6])([OX2][#6])[#6]' },
  orthoester: { name: 'Orthoester',          smarts: '[CX4]([OX2][#6])([OX2][#6])[OX2][#6]' },
  peroxide: { name: 'Peroxide',            smarts: '[OX2][OX2]' },

  // ---------------------------------------------------------------------------
  // Nitrogen functional groups
  // ---------------------------------------------------------------------------

  primaryAmine: { name: 'Primary amine',       smarts: '[NX3H2][#6]' },
  secondaryAmine: { name: 'Secondary amine',     smarts: '[NX3H1]([#6])[#6]' },
  tertiaryAmine: { name: 'Tertiary amine',      smarts: '[NX3H0]([#6])([#6])[#6]' },
  aromaticAmine: { name: 'Aromatic amine',      smarts: '[NX3H2]c' },
  quaternaryAmmonium: { name: 'Quaternary ammonium', smarts: '[NX4+]([#6])([#6])([#6])[#6]' },
  amide: { name: 'Amide',               smarts: '[NX3][CX3](=O)' },
  primaryAmide: { name: 'Primary amide',       smarts: '[NX3H2][CX3](=O)' },
  secondaryAmide: { name: 'Secondary amide',     smarts: '[NX3H1][CX3](=O)' },
  lactam: { name: 'Lactam',              smarts: '[NX3;r][CX3;r](=O)' },
  urea: { name: 'Urea',                smarts: '[NX3][CX3](=O)[NX3]' },
  thiourea: { name: 'Thiourea',            smarts: '[NX3][CX3](=S)[NX3]' },
  guanidine: { name: 'Guanidine',           smarts: '[NX3][CX3](=[NX2])[NX3]' },
  amidine: { name: 'Amidine',             smarts: '[CX3](=[NX2])[NX3]' },
  imine: { name: 'Imine',               smarts: '[CX3]=[NX2]' },
  oxime: { name: 'Oxime',               smarts: '[CX3]=[NX2][OX2H]' },
  hydrazone: { name: 'Hydrazone',           smarts: '[CX3]=[NX2][NX3]' },
  semicarbazone: { name: 'Semicarbazone',       smarts: '[CX3]=[NX2][NX3][CX3](=O)[NX3]' },
  nitrile: { name: 'Nitrile',             smarts: '[NX1]#[CX2]' },
  isocyanate: { name: 'Isocyanate',          smarts: '[NX2]=C=O' },
  isothiocyanate: { name: 'Isothiocyanate',      smarts: '[NX2]=C=S' },
  isonitrile: { name: 'Isonitrile',          smarts: '[CX1-]#[NX2+]' },
  nitro: { name: 'Nitro',               smarts: '[$([NX3](=O)=O),$([NX3+](=O)[O-])]' },
  nitroso: { name: 'Nitroso',             smarts: '[NX2](=O)[#6]' },
  hydroxylamine: { name: 'Hydroxylamine',       smarts: '[NX3][OX2H]' },
  hydrazine: { name: 'Hydrazine',           smarts: '[NX3][NX3]' },
  azide: { name: 'Azide',               smarts: '[NX2-]=[NX2+]=[NX1-]' },
  diazo: { name: 'Diazo',               smarts: '[CX3]=[NX2+]=[NX1-]' },
  cyanate: { name: 'Cyanate',             smarts: '[OX2][CX2]#N' },

  // ---------------------------------------------------------------------------
  // Sulfur functional groups
  // ---------------------------------------------------------------------------

  thiol: { name: 'Thiol',               smarts: '[SX2H][#6]' },
  sulfide: { name: 'Sulfide',             smarts: '[SX2]([#6])[#6]' },
  disulfide: { name: 'Disulfide',           smarts: '[SX2][SX2]' },
  sulfoxide: { name: 'Sulfoxide',           smarts: '[SX3](=O)([#6])[#6]' },
  sulfone: { name: 'Sulfone',             smarts: '[SX4](=O)(=O)([#6])[#6]' },
  sulfonamide: { name: 'Sulfonamide',         smarts: '[SX4](=O)(=O)[NX3]' },
  sulfonylChloride: { name: 'Sulfonyl chloride',   smarts: '[SX4](=O)(=O)[Cl]' },
  sulfonicAcid: { name: 'Sulfonic acid',       smarts: '[SX4](=O)(=O)[OX2H]' },
  sulfonateEster: { name: 'Sulfonate ester',     smarts: '[SX4](=O)(=O)[OX2][#6]' },
  thiocarbonyl: { name: 'Thiocarbonyl',        smarts: '[CX3]=S' },
  thioester: { name: 'Thioester',           smarts: '[CX3](=O)[SX2][#6]' },
  thioamide: { name: 'Thioamide',           smarts: '[NX3][CX3]=S' },

  // ---------------------------------------------------------------------------
  // Phosphorus functional groups
  // ---------------------------------------------------------------------------

  phosphine: { name: 'Phosphine',           smarts: '[PX3]([#6])([#6])[#6]' },
  phosphineOxide: { name: 'Phosphine oxide',     smarts: '[PX4](=O)([#6])([#6])[#6]' },
  phosphate: { name: 'Phosphate ester',     smarts: '[PX4](=O)([OX2])[OX2][OX2]' },
  phosphonate: { name: 'Phosphonate',         smarts: '[PX4](=O)([OX2][#6])[OX2]' },
  phosphonamide: { name: 'Phosphonamide',       smarts: '[PX4](=O)([NX3])[#6]' },
  phosphoricAcid: { name: 'Phosphoric acid',     smarts: '[PX4](=O)([OX2H])[OX2H][OX2H]' },

  // ---------------------------------------------------------------------------
  // Boron functional groups
  // ---------------------------------------------------------------------------

  boronicAcid: { name: 'Boronic acid',        smarts: '[BX3](O)O' },
  boronicEster: { name: 'Boronic ester',       smarts: '[BX3]([OX2])[OX2]' },
  borinicAcid: { name: 'Borinic acid',        smarts: '[BX3](O)[#6]' },

  // ---------------------------------------------------------------------------
  // Halogens
  // ---------------------------------------------------------------------------

  organofluoride: { name: 'Organofluoride',      smarts: '[#6][F]' },
  organochloride: { name: 'Organochloride',      smarts: '[#6][Cl]' },
  organobromide: { name: 'Organobromide',       smarts: '[#6][Br]' },
  organoiodide: { name: 'Organoiodide',        smarts: '[#6][I]' },
  organohalide: { name: 'Organohalide',        smarts: '[#6][F,Cl,Br,I]' },
  gemDihalide: { name: 'gem-Dihalide',        smarts: '[CX4]([F,Cl,Br,I])[F,Cl,Br,I]' },
  trihalide: { name: 'Trihalide',           smarts: '[CX4]([F,Cl,Br,I])([F,Cl,Br,I])[F,Cl,Br,I]' },
  vinylHalide: { name: 'Vinyl halide',        smarts: '[CX3]=[CX3][F,Cl,Br,I]' },
  arylHalide: { name: 'Aryl halide',         smarts: 'c[F,Cl,Br,I]' },

  // ---------------------------------------------------------------------------
  // 6-membered aromatic heterocycles
  // ---------------------------------------------------------------------------

  pyridine: { name: 'Pyridine',            smarts: 'n1ccccc1' },
  pyrimidine: { name: 'Pyrimidine',          smarts: 'n1cnccc1' },
  pyrazine: { name: 'Pyrazine',            smarts: 'n1ccncc1' },
  pyridazine: { name: 'Pyridazine',          smarts: 'n1ncccc1' },
  triazine: { name: '1,3,5-Triazine',      smarts: 'n1cncnc1' },

  // ---------------------------------------------------------------------------
  // 5-membered aromatic heterocycles
  // ---------------------------------------------------------------------------

  pyrrole: { name: 'Pyrrole',             smarts: '[nH]1cccc1' },
  furan: { name: 'Furan',               smarts: 'o1cccc1' },
  thiophene: { name: 'Thiophene',           smarts: 's1cccc1' },
  imidazole: { name: 'Imidazole',           smarts: '[nH]1cncc1' },
  pyrazole: { name: 'Pyrazole',            smarts: '[nH]1nccc1' },
  oxazole: { name: 'Oxazole',             smarts: 'o1cncc1' },
  isoxazole: { name: 'Isoxazole',           smarts: 'o1nccc1' },
  thiazole: { name: 'Thiazole',            smarts: 's1cncc1' },
  triazole: { name: '1,2,3-Triazole',      smarts: '[nH]1nncc1' },
  tetrazole: { name: 'Tetrazole',           smarts: '[nH]1nnnc1' },

  // ---------------------------------------------------------------------------
  // Fused aromatic / heteroaromatic ring systems
  // ---------------------------------------------------------------------------

  naphthalene: { name: 'Naphthalene',         smarts: 'c1ccc2ccccc2c1' },
  indole: { name: 'Indole',              smarts: 'c1ccc2[nH]ccc2c1' },
  benzofuran: { name: 'Benzofuran',          smarts: 'c1ccc2occc2c1' },
  benzothiophene: { name: 'Benzothiophene',      smarts: 'c1ccc2sccc2c1' },
  benzimidazole: { name: 'Benzimidazole',       smarts: 'c1ccc2[nH]cnc2c1' },
  benzoxazole: { name: 'Benzoxazole',         smarts: 'c1ccc2ocnc2c1' },
  benzothiazole: { name: 'Benzothiazole',       smarts: 'c1ccc2scnc2c1' },
  indazole: { name: 'Indazole',            smarts: 'c1ccc2[nH]ncc2c1' },
  quinoline: { name: 'Quinoline',           smarts: 'c1ccc2ncccc2c1' },
  isoquinoline: { name: 'Isoquinoline',        smarts: 'c1ccc2cnccc2c1' },
  quinoxaline: { name: 'Quinoxaline',         smarts: 'c1ccc2nccnc2c1' },
  quinazoline: { name: 'Quinazoline',         smarts: 'c1ccc2ncncc2c1' },
  phthalazine: { name: 'Phthalazine',         smarts: 'c1ccc2cnncc2c1' },
  purine: { name: 'Purine',              smarts: 'c1ncnc2[nH]cnc12' }

};
