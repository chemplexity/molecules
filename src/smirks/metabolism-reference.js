/** @module smirks/metabolism-reference */

/**
 * Catalogue of xenobiotic/endogenous biotransformation motifs mapped to SMIRKS strings.
 *
 * Like `reference.js`, these are intentionally conservative, structural templates —
 * they enumerate *plausible* metabolic transformations for a `MetabolicNetwork` to apply,
 * not a site-of-metabolism likelihood model. A template firing on a given substrate is not
 * a claim that the transformation is the major (or even a real) metabolic route for that
 * substrate; it is a claim that the substructure is present.
 *
 * Each entry preserves:
 *   `name`         — human-readable display name
 *   `smirks`       — SMIRKS transform for use with `parseSMIRKS` / `applySMIRKS`
 *   `phase`        — `'I'` (oxidative/reductive/hydrolytic) or `'II'` (conjugative)
 *   `enzymeFamily` — representative enzyme family responsible in vivo
 *   `summary`      — short transformation summary
 *   `cofactor`     — cofactor(s) net-consumed by the enzyme in vivo (not modeled structurally)
 *   `byproducts`   — cofactor-derived byproduct(s) released in vivo (not modeled structurally)
 *   `notes`        — general template notes
 *   `limitations`  — known scope/selectivity limitations
 *
 * A few entries deliberately reuse SMIRKS strings already defined in `reference.js`
 * (dehalogenation, ester/amide hydrolysis, nitro reduction, sulfide oxidation) rather than
 * duplicating the pattern, since those generic organic transforms are also valid
 * biotransformations.
 * @example
 * import { metabolismTemplates } from './src/smirks/metabolism-reference.js';
 * import { applySMIRKS } from './src/smirks/index.js';
 * import { parseSMILES } from './src/io/smiles.js';
 *
 * const mol = parseSMILES('COc1ccccc1'); // anisole
 * const product = applySMIRKS(mol, metabolismTemplates.oDemethylation.smirks);
 */

import { reactionTemplates } from './reference.js';

export const METABOLISM_PHASE = Object.freeze({
  I: 'I',
  II: 'II'
});

export const ENZYME_FAMILY = Object.freeze({
  CYP450: 'CYP450',
  MAO: 'MAO',
  ESTERASE: 'esterase',
  AMIDASE: 'amidase',
  GUT_FLORA: 'gut flora/CYP450',
  UGT: 'UGT',
  SULT: 'SULT',
  NAT: 'NAT',
  COMT: 'COMT',
  GLYCINE_N_ACYLTRANSFERASE: 'acyl-CoA:glycine N-acyltransferase'
});

/**
 * @typedef {object} BiotransformationTemplateEntry
 * @property {string} name - Human-readable display name.
 * @property {string} smirks - SMIRKS transform.
 * @property {'I'|'II'} phase - Metabolism phase.
 * @property {string} enzymeFamily - Representative enzyme family.
 * @property {string} summary - Short transformation summary.
 * @property {string[]} cofactor - Cofactor(s) net-consumed by the enzyme in vivo.
 * @property {string[]} byproducts - Cofactor-derived byproduct(s) released in vivo.
 * @property {string[]} notes - General template notes.
 * @property {string[]} limitations - Known scope/selectivity limitations.
 */

/** @type {Record<string, BiotransformationTemplateEntry>} */
export const metabolismTemplates = {
  benzylicHydroxylation: {
    name: 'Benzylic Hydroxylation',
    smirks: '[c:2][CH3:1]>>[c:2][CH2:1]O',
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'Aromatic methyl -> benzylic alcohol',
    cofactor: ['O2', 'NADPH'],
    byproducts: ['H2O', 'NADP+'],
    notes: ['Represents CYP450 hydroxylation of an aromatic ring methyl substituent.'],
    limitations: ['Limited to unsubstituted aromatic methyl groups.', 'Does not model further oxidation to the aldehyde/acid oxidation state.']
  },
  nDemethylation: {
    name: 'N-Demethylation',
    smirks: '[CH3:1][N:2]>>[N:2].[CH2:1]=O',
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'N-methyl amine -> amine + formaldehyde',
    cofactor: ['O2', 'NADPH'],
    byproducts: ['H2O', 'NADP+'],
    notes: ['Represents oxidative N-demethylation via an unstable carbinolamine intermediate, abstracted directly to the amine and formaldehyde products.'],
    limitations: ['Does not distinguish primary/secondary/tertiary amine substitution, amide nitrogens, or aromatic ring nitrogens.', 'Fires once per N-methyl group present.']
  },
  aromaticHydroxylation: {
    name: 'Aromatic Hydroxylation',
    smirks: '[cH:1]>>[c:1]O',
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'Aromatic C-H -> phenol',
    cofactor: ['O2', 'NADPH'],
    byproducts: ['H2O', 'NADP+'],
    notes: ['Represents CYP450 arene oxidation collapsed directly to the phenol product, without an explicit arene-oxide intermediate.'],
    limitations: ['Fires on every aromatic C-H position with no regioselectivity encoded; real CYP450 site-of-metabolism preference is not modeled.']
  },
  oDemethylation: {
    name: 'O-Demethylation',
    smirks: '[CH3:1][O:2][c:3]>>[OH:2][c:3].[CH2:1]=O',
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'Aryl methyl ether -> phenol + formaldehyde',
    cofactor: ['O2', 'NADPH'],
    byproducts: ['H2O', 'NADP+'],
    notes: ['Restricted to aryl methyl ethers (e.g. anisole-type substrates).'],
    limitations: ['Aliphatic methyl ethers are intentionally out of scope for this template (see the generic `etherCleavage` template for those).']
  },
  oxidativeDeamination: {
    name: 'Oxidative Deamination',
    smirks: '[CH2;X4:1][NH2:2]>>[CH1:1]=O.[NH3:2]',
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.MAO,
    summary: 'Primary aliphatic amine -> aldehyde + ammonia',
    cofactor: ['O2'],
    byproducts: ['H2O2'],
    notes: ['Represents monoamine-oxidase-style oxidative deamination of a primary amine on a CH2 carbon.'],
    limitations: ['Limited to primary amines on an unbranched (CH2) carbon.', 'Does not represent the imine intermediate or further aldehyde oxidation.']
  },
  tertiaryAmineNOxidation: {
    name: 'Tertiary Amine N-Oxidation',
    smirks: '[N;X3;+0;!$(N-[#6]=[O,N,S]):1]>>[N+:1][O-]',
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'Tertiary amine -> N-oxide',
    cofactor: ['O2', 'NADPH'],
    byproducts: ['H2O', 'NADP+'],
    notes: ['Represents CYP450/flavin monooxygenase oxidation of a tertiary amine to the N-oxide.'],
    limitations: ['Excludes amide/carbamate nitrogens via a structural guard, but does not otherwise rank substrate preference.']
  },
  epoxidation: {
    name: 'Alkene Epoxidation',
    smirks: '[C:1]=[C:2]>>[C:1]1O[C:2]1',
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'Alkene -> epoxide',
    cofactor: ['O2', 'NADPH'],
    byproducts: ['H2O', 'NADP+'],
    notes: ['Represents CYP450 epoxidation of a non-aromatic alkene.'],
    limitations: ['Limited to neutral alkene carbons (aromatic ring bonds are not matched).', 'Does not encode regio- or stereoselectivity of the resulting epoxide.']
  },
  sulfoxidation: {
    name: 'Sulfoxidation',
    smirks: reactionTemplates.sulfideOxidationToSulfoxide.smirks,
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'Sulfide -> sulfoxide',
    cofactor: ['O2', 'NADPH'],
    byproducts: ['H2O', 'NADP+'],
    notes: ['Reuses the generic `sulfideOxidationToSulfoxide` organic-chemistry template; CYP450/flavin monooxygenase perform the same net transformation in vivo.'],
    limitations: ['Does not model further oxidation to the sulfone.']
  },
  esterHydrolysis: {
    name: 'Ester Hydrolysis',
    smirks: reactionTemplates.esterHydrolysis.smirks,
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.ESTERASE,
    summary: 'Ester -> carboxylic acid + alcohol',
    cofactor: ['H2O'],
    byproducts: [],
    notes: ['Reuses the generic `esterHydrolysis` organic-chemistry template.'],
    limitations: ['Does not distinguish esterase isoform specificity.']
  },
  amideHydrolysis: {
    name: 'Amide Hydrolysis',
    smirks: reactionTemplates.amideHydrolysis.smirks,
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.AMIDASE,
    summary: 'Amide -> carboxylic acid + amine',
    cofactor: ['H2O'],
    byproducts: [],
    notes: ['Reuses the generic `amideHydrolysis` organic-chemistry template.'],
    limitations: ['Amide hydrolysis in vivo is often slower/more selective than the unrestricted structural match suggests.']
  },
  reductiveDehalogenation: {
    name: 'Reductive Dehalogenation',
    smirks: reactionTemplates.dehalogenation.smirks,
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.CYP450,
    summary: 'Alkyl halide -> alkane',
    cofactor: ['NADPH'],
    byproducts: ['NADP+'],
    notes: ['Reuses the generic `dehalogenation` organic-chemistry template.'],
    limitations: ['Real reductive dehalogenation is substrate- and halide-dependent.']
  },
  nitroReduction: {
    name: 'Nitro Reduction',
    smirks: reactionTemplates.nitroReduction.smirks,
    phase: METABOLISM_PHASE.I,
    enzymeFamily: ENZYME_FAMILY.GUT_FLORA,
    summary: 'Nitro group -> amine',
    cofactor: ['NAD(P)H'],
    byproducts: ['H2O'],
    notes: ['Reuses the generic `nitroReduction` organic-chemistry template; in vivo this is frequently gut-flora-mediated.'],
    limitations: ['Does not model partial reduction intermediates (nitroso, hydroxylamino).']
  },
  glucuronidation: {
    name: 'Glucuronidation',
    smirks: '[OH:1]>>[O:1]C1OC(C(=O)O)C(O)C(O)C1O',
    phase: METABOLISM_PHASE.II,
    enzymeFamily: ENZYME_FAMILY.UGT,
    summary: 'Hydroxyl -> O-glucuronide',
    cofactor: ['UDP-glucuronic acid (UDPGA)'],
    byproducts: ['UDP'],
    notes: ['Appends a glucuronic acid unit via an O-glycosidic bond.'],
    limitations: [
      'Fires on any hydroxyl, including carboxylic acid -OH (forming an acyl glucuronide) and non-phenolic aliphatic alcohols; real UGT substrate selectivity is not encoded.',
      'The appended sugar ring is written without stereochemistry.'
    ]
  },
  sulfation: {
    name: 'Sulfation',
    smirks: '[OH:1]>>[O:1]S(=O)(=O)O',
    phase: METABOLISM_PHASE.II,
    enzymeFamily: ENZYME_FAMILY.SULT,
    summary: 'Hydroxyl -> O-sulfate',
    cofactor: ["PAPS (3'-phosphoadenosine-5'-phosphosulfate)"],
    byproducts: ["PAP (3'-phosphoadenosine-5'-phosphate)"],
    notes: ['Appends a sulfate ester.'],
    limitations: ['Fires on any hydroxyl, including carboxylic acid -OH; real SULT substrate selectivity (favoring phenols) is not encoded.']
  },
  acetylation: {
    name: 'N-Acetylation',
    smirks: '[NH2:1]>>[NH:1]C(C)=O',
    phase: METABOLISM_PHASE.II,
    enzymeFamily: ENZYME_FAMILY.NAT,
    summary: 'Primary amine -> acetamide',
    cofactor: ['acetyl-CoA'],
    byproducts: ['CoA-SH'],
    notes: ['Appends an acetyl group.'],
    limitations: ['Does not distinguish aromatic (arylamine, the typical NAT substrate) from aliphatic primary amines.']
  },
  methylation: {
    name: 'O-Methylation',
    smirks: '[c:2][OH:1]>>[c:2][O:1]C',
    phase: METABOLISM_PHASE.II,
    enzymeFamily: ENZYME_FAMILY.COMT,
    summary: 'Phenol -> methyl ether',
    cofactor: ['SAM (S-adenosylmethionine)'],
    byproducts: ['SAH (S-adenosylhomocysteine)'],
    notes: ['Appends a methyl group.'],
    limitations: ['COMT specifically requires a catechol (ortho-dihydroxy) motif in vivo; this template fires on any phenolic -OH.']
  },
  glycineConjugation: {
    name: 'Glycine Conjugation',
    smirks: '[C:1](=O)[OH:2]>>[C:1](=O)NCC(=O)O.[OH2:2]',
    phase: METABOLISM_PHASE.II,
    enzymeFamily: ENZYME_FAMILY.GLYCINE_N_ACYLTRANSFERASE,
    summary: 'Carboxylic acid -> glycine amide conjugate + water',
    cofactor: ['ATP'],
    byproducts: ['AMP', 'PPi'],
    notes: [
      'Represents the two-step acyl-CoA-mediated glycine conjugation abstracted to a single acid-to-amide transform.',
      'CoA-SH is used to form the intermediate acyl-CoA thioester and is regenerated (not net-consumed) once glycine displaces it, so it is omitted from `cofactor`/`byproducts`.'
    ],
    limitations: ['Real glycine conjugation favors small aromatic/aralkyl acids; this template fires on any carboxylic acid.']
  }
};
