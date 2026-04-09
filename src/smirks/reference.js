/** @module smirks/reference */

/**
 * Catalogue of common reaction-template motifs mapped to SMIRKS strings.
 *
 * These are intentionally conservative templates that fit the current phase-1
 * SMIRKS engine. They are useful as named starting points, not as fully
 * balanced mechanistic reaction rules.
 *
 * Each entry has:
 *   `name`   — human-readable display name
 *   `smirks` — SMIRKS transform for use with `parseSMIRKS` / `applySMIRKS`
 * @example
 * import { reactionTemplates } from './src/smirks/reference.js';
 * import { applySMIRKS } from './src/smirks/index.js';
 * import { parseSMILES } from './src/io/smiles.js';
 *
 * const mol = parseSMILES('CCl');
 * const product = applySMIRKS(mol, reactionTemplates.halideHydrolysis.smirks);
 */
export const reactionTemplates = {
  // ---------------------------------------------------------------------------
  // Oxidation / reduction motifs
  // ---------------------------------------------------------------------------

  alcoholOxidation: {
    name: 'Alcohol Oxidation',
    smirks: '[C;X4;H1,H2:1][OH:2]>>[C:1]=[O:2]',
    excludeOverlaps: ['[C:1](=[O:2])[OH:3]', '[C:1](=[O:2])[O:3][C:4]', '[C:1](=[O:2])[N:3]']
  },
  aldehydeOxidation: {
    name: 'Aldehyde Oxidation',
    smirks: '[CH;X3;H1:1]=[O:2]>>[C:1](=[O:2])O'
  },
  carbonylReduction: {
    name: 'Carbonyl Reduction',
    smirks: '[C;X3;!$([C](=[O])[O,N,S,F,Cl,Br,I]):1]=[O:2]>>[C:1][OH:2]'
  },
  imineReduction: {
    name: 'Imine Reduction',
    smirks: '[C;!$([C](=[N])[N,O,S]):1]=[N;!$([N]-[N,O,S]):2]>>[C:1][N:2]'
  },
  alkeneHydrogenation: {
    name: 'Alkene Hydrogenation',
    smirks: '[C+0;!$([C]-[*+,-]):1]=[C+0;!$([C]-[*+,-]):2]>>[C:1][C:2]'
  },
  alkynePartialReduction: { name: 'Alkyne Partial Reduction', smirks: '[C:1]#[C:2]>>[C:1]=[C:2]' },
  alkyneFullReduction: { name: 'Alkyne Full Reduction', smirks: '[C:1]#[C:2]>>[C:1][C:2]' },
  benzylicOxidation: { name: 'Benzylic Oxidation', smirks: '[c:2][CH3:1]>>[c:2][C:1]=O' },

  // ---------------------------------------------------------------------------
  // Substitution / functional-group interconversion
  // ---------------------------------------------------------------------------

  dehalogenation: { name: 'Dehalogenation', smirks: '[C:1][F,Cl,Br,I]>>[C:1]' },
  halideHydrolysis: { name: 'Halide Hydrolysis', smirks: '[C:1][Cl,Br,I:2]>>[C:1][OH:2]' },
  arylHalideHydrolysis: { name: 'Aryl Halide Hydrolysis', smirks: '[c:1][Cl,Br,I:2]>>[c:1][OH:2]' },
  alcoholHalogenation: {
    name: 'Alcohol Halogenation',
    smirks: '[C;X4:1][OH:2]>>[C:1][Cl:2]',
    excludeOverlaps: ['[C:1](=[O:2])[OH:3]', '[C:1](=[O:2])[O:3][C:4]', '[C:1](=[O:2])[N:3]']
  },
  nitrileHydrogenationToImine: { name: 'Nitrile Hydrogenation To Imine', smirks: '[C:1]#[N:2]>>[C:1]=[N:2]' },
  etherCleavage: { name: 'Ether Cleavage', smirks: '[C;X4;!$(C=O):1][O:2][C;X4;!$(C=O):3]>>[C:1][OH:2].[C:3]O' },

  // ---------------------------------------------------------------------------
  // Acyl chemistry
  // ---------------------------------------------------------------------------

  esterHydrolysis: { name: 'Ester Hydrolysis', smirks: '[C:1](=[O:2])[O:3][C;!$(C=O):4]>>[C:1](=[O:2])[OH:3].[C:4]O' },
  esterification: {
    name: 'Esterification',
    smirks: '[C:1](=[O:2])[OH:3].[C;X4;!$(C=O):4][OH:5]>>[C:1](=[O:2])[OH0+0:5][C:4].[OH2:3]'
  },
  saponification: { name: 'Saponification', smirks: '[C:1](=[O:2])[O:3][C;!$(C=O):4]>>[C:1](=[O:2])[OH0-:3].[C:4]O' },
  anhydrideHydrolysis: {
    name: 'Anhydride Hydrolysis',
    smirks: '[C:1](=[O:2])[O:3][C:4](=[O:5])>>[C:1](=[O:2])[OH:3].[C:4](=[O:5])O'
  },
  amideHydrolysis: { name: 'Amide Hydrolysis', smirks: '[C:1](=[O:2])[N:3]>>[C:1](=[O:2])O.[N:3]' },
  amineAcylation: {
    name: 'Amine Acylation',
    smirks: '[C:1](=[O:2])[Cl:3].[N+0;!H0;!$([N]-[C](=O)):4]>>[C:1](=[O:2])[N+0:4].[ClH0-:3]'
  },
  amineAlkylation: {
    name: 'Amine Alkylation',
    smirks: '[C;X4;H2,H3:1][Cl:2].[N+0;!H0;!$([N]-[C](=O)):3]>>[C:1][N+0:3].[ClH0-:2]'
  },
  imineHydrolysis: { name: 'Imine Hydrolysis', smirks: '[C:1]=[N:2]>>[C:1]=O.[N:2]' },
  nitrileHydrolysisToAmide: { name: 'Nitrile Hydrolysis To Amide', smirks: '[C:1]#[N:2]>>[C:1](=O)[N:2]' },
  nitrileHydrolysisToAcid: { name: 'Nitrile Hydrolysis To Acid', smirks: '[C:1]#[N:2]>>[C:1](=O)O.[N:2]' },
  lactoneHydrolysis: { name: 'Lactone Hydrolysis', smirks: '[C;r:1](=[O:2])[O;r:3][C:4]>>[C:1](=[O:2])[OH:3].[C:4]O' },
  lactamHydrolysis: { name: 'Lactam Hydrolysis', smirks: '[C;r:1](=[O:2])[N;r:3]>>[C:1](=[O:2])O.[N:3]' },
  acidChlorideHydrolysis: { name: 'Acid Chloride Hydrolysis', smirks: '[C:1](=[O:2])[Cl:3]>>[C:1](=[O:2])[OH:3]' },
  carboxylicAcidDeprotonation: {
    name: 'Carboxylic Acid Deprotonation',
    smirks: '[C:1](=[O:2])[OH:3]>>[C:1](=[O:2])[OH0-:3]'
  },
  carboxylateProtonation: { name: 'Carboxylate Protonation', smirks: '[C:1](=[O:2])[OH0-:3]>>[C:1](=[O:2])[OH+0:3]' },

  // ---------------------------------------------------------------------------
  // Bond construction / cleavage
  // ---------------------------------------------------------------------------

  alcoholDehydration: { name: 'Alcohol Dehydration', smirks: '[C;X4;!H0:1][C;X4:2][OH:3]>>[C:1]=[C:2].[OH2:3]' },
  alkylChlorideElimination: {
    name: 'Alkyl Chloride Elimination',
    smirks: '[C;X4;!H0:1][C;X4:2][Cl:3]>>[C:1]=[C:2].[ClH:3]'
  },
  sulfideOxidationToSulfoxide: {
    name: 'Sulfide Oxidation To Sulfoxide',
    smirks: '[C:2][S:1][C:3]>>[C:2][S:1](=O)[C:3]'
  },
  sulfoxideOxidationToSulfone: {
    name: 'Sulfoxide Oxidation To Sulfone',
    smirks: '[C:2][S:1](=[O:4])[C:3]>>[C:2][S:1](=[O:4])(=O)[C:3]'
  },
  amineProtonation: { name: 'Amine Protonation', smirks: '[N+0;!$([N]-[C](=O)):1]>>[N+:1]' },
  ammoniumDeprotonation: { name: 'Ammonium Deprotonation', smirks: '[N+;!H0:1]>>[N+0:1]' },
  phenolDeprotonation: { name: 'Phenol Deprotonation', smirks: '[c:1][OH:2]>>[c:1][OH0-:2]' },
  phenolateProtonation: { name: 'Phenolate Protonation', smirks: '[c:1][OH0-:2]>>[c:1][OH+0:2]' },
  nitroReduction: { name: 'Nitro Reduction', smirks: '[N+:1](=[O:2])[O-:3]>>[N+0:1].[OH2+0:2].[OH2+0:3]' }
};
