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
 *
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
  carbonylReduction: {
    name: 'Carbonyl Reduction',
    smirks: '[C;X3;!$([C](=[O])[O,N,S,F,Cl,Br,I]):1]=[O:2]>>[C:1][OH:2]'
  },
  alkeneHydrogenation: {
    name: 'Alkene Hydrogenation',
    smirks: '[C+0;!$([C]-[*+,-]):1]=[C+0;!$([C]-[*+,-]):2]>>[C:1][C:2]'
  },
  alkynePartialReduction: { name: 'Alkyne Partial Reduction', smirks: '[C:1]#[C:2]>>[C:1]=[C:2]' },

  // ---------------------------------------------------------------------------
  // Substitution / functional-group interconversion
  // ---------------------------------------------------------------------------

  dehalogenation: { name: 'Dehalogenation', smirks: '[C:1][F,Cl,Br,I]>>[C:1]' },
  halideHydrolysis: { name: 'Halide Hydrolysis', smirks: '[C:1][Cl,Br,I:2]>>[C:1][OH:2]' },
  alcoholHalogenation: {
    name: 'Alcohol Halogenation',
    smirks: '[C;X4:1][OH:2]>>[C:1][Cl:2]',
    excludeOverlaps: ['[C:1](=[O:2])[OH:3]', '[C:1](=[O:2])[O:3][C:4]', '[C:1](=[O:2])[N:3]']
  },
  nitrileHydrogenationToImine: { name: 'Nitrile Hydrogenation To Imine', smirks: '[C:1]#[N:2]>>[CH:1]=[NH:2]' },

  // ---------------------------------------------------------------------------
  // Acyl chemistry
  // ---------------------------------------------------------------------------

  esterHydrolysis: { name: 'Ester Hydrolysis', smirks: '[C:1](=[O:2])[O:3][C;!$(C=O):4]>>[C:1](=[O:2])[OH:3].[C:4]O' },
  saponification: { name: 'Saponification', smirks: '[C:1](=[O:2])[O:3][C;!$(C=O):4]>>[C:1](=[O:2])[OH0-:3].[C:4]O' },
  anhydrideHydrolysis: { name: 'Anhydride Hydrolysis', smirks: '[C:1](=[O:2])[O:3][C:4](=[O:5])>>[C:1](=[O:2])[OH:3].[C:4](=[O:5])O' },
  amideHydrolysis: { name: 'Amide Hydrolysis', smirks: '[C:1](=[O:2])[N:3]>>[C:1](=[O:2])O.[N:3]' },
  imineHydrolysis: { name: 'Imine Hydrolysis', smirks: '[C:1]=[N:2]>>[C:1]=O.[N:2]' },
  nitrileHydrolysisToAmide: { name: 'Nitrile Hydrolysis To Amide', smirks: '[C:1]#[N:2]>>[C:1](=O)[N:2]' },
  nitrileHydrolysisToAcid: { name: 'Nitrile Hydrolysis To Acid', smirks: '[C:1]#[N:2]>>[C:1](=O)O.[N:2]' },
  lactoneHydrolysis: { name: 'Lactone Hydrolysis', smirks: '[C;r:1](=[O:2])[O;r:3][C:4]>>[C:1](=[O:2])[OH:3].[C:4]O' },
  lactamHydrolysis: { name: 'Lactam Hydrolysis', smirks: '[C;r:1](=[O:2])[N;r:3]>>[C:1](=[O:2])O.[N:3]' },
  acidChlorideHydrolysis: { name: 'Acid Chloride Hydrolysis', smirks: '[C:1](=[O:2])[Cl:3]>>[C:1](=[O:2])[OH:3]' },
  carboxylicAcidDeprotonation: { name: 'Carboxylic Acid Deprotonation', smirks: '[C:1](=[O:2])[OH:3]>>[C:1](=[O:2])[OH0-:3]' },
  carboxylateProtonation: { name: 'Carboxylate Protonation', smirks: '[C:1](=[O:2])[OH0-:3]>>[C:1](=[O:2])[OH+0:3]' },

  // ---------------------------------------------------------------------------
  // Bond construction / cleavage
  // ---------------------------------------------------------------------------

  alcoholCleavage: {
    name: 'Alcohol Cleavage',
    smirks: '[C;X4;H1,H2:1][OH:2]>>[C:1].[OH:2]',
    excludeOverlaps: ['[C:1](=[O:2])[OH:3]', '[C:1](=[O:2])[O:3][C:4]', '[C:1](=[O:2])[N:3]']
  },
  alcoholDehydration: { name: 'Alcohol Dehydration', smirks: '[C;X4:1][CH2:2][OH:3]>>[C:1]=[CH:2].[OH2:3]' },
  alkylChlorideElimination: { name: 'Alkyl Chloride Elimination', smirks: '[C;X4:1][CH2:2][Cl:3]>>[C:1]=[CH:2].[Cl-:3]' },
  sulfideOxidationToSulfoxide: { name: 'Sulfide Oxidation To Sulfoxide', smirks: '[C:2][S:1][C:3]>>[C:2][S:1](=O)[C:3]' },
  sulfoxideOxidationToSulfone: { name: 'Sulfoxide Oxidation To Sulfone', smirks: '[C:2][S:1](=[O:4])[C:3]>>[C:2][S:1](=[O:4])(=O)[C:3]' },
  amineProtonation: { name: 'Amine Protonation', smirks: '[NH2+0;!$([N]-[C](=O)):1]>>[NH3+:1]' },
  ammoniumDeprotonation: { name: 'Ammonium Deprotonation', smirks: '[N+;!H0:1]>>[N+0:1]' },
  phenolDeprotonation: { name: 'Phenol Deprotonation', smirks: '[c:1][OH:2]>>[c:1][OH0-:2]' },
  phenolateProtonation: { name: 'Phenolate Protonation', smirks: '[c:1][OH0-:2]>>[c:1][OH+0:2]' },
  nitroReduction: { name: 'Nitro Reduction', smirks: '[N+:1](=[O:2])[O-:3]>>[NH2+0:1]' }

};
