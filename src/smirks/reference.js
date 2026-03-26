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

  alcoholOxidation: { name: 'Alcohol Oxidation', smirks: '[C:1][OH:2]>>[C:1]=[O:2]' },
  carbonylReduction: { name: 'Carbonyl Reduction', smirks: '[C:1]=[O:2]>>[C:1][OH:2]' },
  alkeneHydrogenation: { name: 'Alkene Hydrogenation', smirks: '[C:1]=[C:2]>>[C:1][C:2]' },
  alkynePartialReduction: { name: 'Alkyne Partial Reduction', smirks: '[C:1]#[C:2]>>[C:1]=[C:2]' },

  // ---------------------------------------------------------------------------
  // Substitution / functional-group interconversion
  // ---------------------------------------------------------------------------

  dehalogenation: { name: 'Dehalogenation', smirks: '[C:1][F,Cl,Br,I]>>[C:1]' },
  halideHydrolysis: { name: 'Halide Hydrolysis', smirks: '[C:1][Cl,Br,I:2]>>[C:1][OH:2]' },
  alcoholHalogenation: { name: 'Alcohol Halogenation', smirks: '[C:1][OH:2]>>[C:1][Cl:2]' },
  nitrileHydrogenationToImine: { name: 'Nitrile Hydrogenation To Imine', smirks: '[C:1]#[N:2]>>[CH:1]=[NH:2]' },

  // ---------------------------------------------------------------------------
  // Acyl chemistry
  // ---------------------------------------------------------------------------

  esterHydrolysis: { name: 'Ester Hydrolysis', smirks: '[C:1](=[O:2])[O:3][C:4]>>[C:1](=[O:2])[OH:3].[C:4]' },
  amideHydrolysis: { name: 'Amide Hydrolysis', smirks: '[C:1](=[O:2])[N:3]>>[C:1](=[O:2])O.[NH2:3]' },
  acidChlorideHydrolysis: { name: 'Acid Chloride Hydrolysis', smirks: '[C:1](=[O:2])[Cl:3]>>[C:1](=[O:2])[OH:3]' },
  carboxylicAcidDeprotonation: { name: 'Carboxylic Acid Deprotonation', smirks: '[C:1](=[O:2])[OH:3]>>[C:1](=[O:2])[O-:3]' },

  // ---------------------------------------------------------------------------
  // Bond construction / cleavage
  // ---------------------------------------------------------------------------

  alcoholCleavage: { name: 'Alcohol Cleavage', smirks: '[C:1][O:2]>>[C:1].[OH:2]' },
  carbonCarbonCoupling: { name: 'Carbon-Carbon Coupling', smirks: '[C:1].[C:2]>>[C:1][C:2]' }

};
