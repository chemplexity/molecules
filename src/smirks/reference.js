/** @module smirks/reference */

/**
 * Catalogue of common reaction-template motifs mapped to SMIRKS strings.
 *
 * These are intentionally conservative templates that fit the current phase-1
 * SMIRKS engine. They are useful as named starting points, not as fully
 * balanced mechanistic reaction rules.
 *
 * Each entry preserves:
 *   `name`   — human-readable display name
 *   `smirks` — SMIRKS transform for use with `parseSMIRKS` / `applySMIRKS`
 *
 * Each entry also includes descriptive chemistry metadata. Metadata is intended
 * for API consumers and documentation; it is not used by the SMIRKS engine.
 * @example
 * import { reactionTemplates } from './src/smirks/reference.js';
 * import { applySMIRKS } from './src/smirks/index.js';
 * import { parseSMILES } from './src/io/smiles.js';
 *
 * const mol = parseSMILES('CCl');
 * const product = applySMIRKS(mol, reactionTemplates.halideHydrolysis.smirks);
 */

/**
 * @typedef {object} ReactionConditions
 * @property {string} [temperature] - Temperature guidance.
 * @property {string} [pressure] - Pressure guidance.
 * @property {string} [time] - Typical reaction time.
 * @property {string} [atmosphere] - Atmosphere guidance.
 * @property {string} [pH] - pH or acid/base environment.
 * @property {string} [workup] - Typical workup note.
 */

/**
 * @typedef {object} ReactionConditionVariant
 * @property {string} id - Stable variant identifier.
 * @property {string} label - Short reagent/condition label.
 * @property {string} role - Variant role such as `common` or `alternative`.
 * @property {string[]} reagents - Stoichiometric reagents.
 * @property {string[]} catalysts - Catalysts or promoters.
 * @property {string[]} solvents - Typical solvents.
 * @property {ReactionConditions} conditions - Non-executable condition notes.
 * @property {string[]} byproducts - Expected non-target products or reagent-derived products.
 * @property {string[]} notes - Variant-specific notes.
 * @property {string[]} limitations - Variant-specific limitations.
 */

/**
 * @typedef {object} ReactionSelectivity
 * @property {string} regioselectivity - Regioselectivity guidance.
 * @property {string} stereochemistry - Stereochemical outcome guidance.
 * @property {string} chemoselectivity - Chemoselectivity guidance.
 */

/**
 * @typedef {object} ReactionTemplateReference
 * @property {string} [label] - Human-readable source label.
 * @property {string} [url] - Optional source URL.
 */

/**
 * @typedef {object} ReactionTemplateEntry
 * @property {string} name - Human-readable display name.
 * @property {string} smirks - SMIRKS transform.
 * @property {string} category - Stable category key.
 * @property {string} summary - Short transformation summary.
 * @property {ReactionConditionVariant[]} variants - Reagent/condition variants.
 * @property {string[]} byproducts - Template-level formal or common byproducts.
 * @property {ReactionSelectivity} selectivity - Non-executable selectivity notes.
 * @property {string[]} notes - General template notes.
 * @property {string[]} limitations - General template limitations.
 * @property {ReactionTemplateReference[]} references - Citation placeholders.
 */
const CATEGORY = Object.freeze({
  oxidationReduction: 'oxidationReduction',
  substitution: 'substitution',
  acylChemistry: 'acylChemistry',
  acidBase: 'acidBase',
  bondConstruction: 'bondConstruction',
  cycloaddition: 'cycloaddition'
});

const DEFAULT_SELECTIVITY = Object.freeze({
  regioselectivity: 'not encoded',
  stereochemistry: 'not encoded',
  chemoselectivity: 'substrate-dependent'
});

function selectivity({ regioselectivity, stereochemistry, chemoselectivity } = {}) {
  return {
    regioselectivity: regioselectivity ?? DEFAULT_SELECTIVITY.regioselectivity,
    stereochemistry: stereochemistry ?? DEFAULT_SELECTIVITY.stereochemistry,
    chemoselectivity: chemoselectivity ?? DEFAULT_SELECTIVITY.chemoselectivity
  };
}

function variant({ id, label, role = 'common', reagents = [], catalysts = [], solvents = [], conditions = {}, byproducts = [], notes = [], limitations = [] }) {
  return {
    id,
    label,
    role,
    reagents,
    catalysts,
    solvents,
    conditions,
    byproducts,
    notes,
    limitations
  };
}

const BASE_REACTION_TEMPLATES = {
  // ---------------------------------------------------------------------------
  // Oxidation / reduction motifs
  // ---------------------------------------------------------------------------

  alcoholOxidation: {
    name: 'Alcohol Oxidation',
    smirks: '[C;X4&(H1,H2):1][OH:2]>>[C:1]=[O:2]'
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
    smirks: '[C;X4:1][OH:2]>>[C:1][Cl:2]'
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
    smirks: '[C;X4&(H2,H3):1][Cl:2].[N+0;!H0;!$([N]-[C](=O)):3]>>[C:1][N+0:3].[ClH0-:2]'
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
    smirks: '[C:2][S;X2:1][C:3]>>[C:2][S:1](=O)[C:3]'
  },
  sulfoxideOxidationToSulfone: {
    name: 'Sulfoxide Oxidation To Sulfone',
    smirks: '[C:2][S;X3:1](=[O:4])[C:3]>>[C:2][S:1](=[O:4])(=O)[C:3]'
  },
  amineProtonation: { name: 'Amine Protonation', smirks: '[N+0;!$([N]-[C](=O)):1]>>[N+:1]' },
  aromaticAzaProtonation: { name: 'Aromatic Aza Protonation', smirks: '[n+0X2:1]>>[nH+:1]' },
  ammoniumDeprotonation: { name: 'Ammonium Deprotonation', smirks: '[N+;!H0:1]>>[N+0:1]' },
  phenolDeprotonation: { name: 'Phenol Deprotonation', smirks: '[c:1][OH:2]>>[c:1][OH0-:2]' },
  phenolateProtonation: { name: 'Phenolate Protonation', smirks: '[c:1][OH0-:2]>>[c:1][OH+0:2]' },
  nitroReduction: { name: 'Nitro Reduction', smirks: '[N+:1](=[O:2])[O-:3]>>[N+0:1].[OH2+0:2].[OH2+0:3]' },

  // ---------------------------------------------------------------------------
  // Cycloadditions
  // ---------------------------------------------------------------------------

  dielsAlder: {
    name: 'Diels-Alder [4+2]',
    smirks: '[C:1]=[C:2]-[C:3]=[C:4].[C:5]=[C:6]>>[C:1]1[C:2]=[C:3][C:4][C:5][C:6]1'
  }
};

const REACTION_TEMPLATE_METADATA = {
  alcoholOxidation: {
    category: CATEGORY.oxidationReduction,
    summary: 'Alcohol -> carbonyl',
    variants: [
      variant({
        id: 'pcc',
        label: 'PCC',
        reagents: ['PCC'],
        solvents: ['CH2Cl2'],
        conditions: { temperature: '25 °C' },
        byproducts: ['reduced chromium salts'],
        notes: ['Common mild oxidation for primary alcohols to aldehydes and secondary alcohols to ketones.']
      }),
      variant({ id: 'dess-martin', label: 'Dess-Martin periodinane', role: 'alternative', reagents: ['Dess-Martin periodinane'], solvents: ['CH2Cl2'], conditions: { temperature: '25 °C' } }),
      variant({
        id: 'swern',
        label: 'Swern oxidation',
        role: 'alternative',
        reagents: ['DMSO', 'oxalyl chloride', 'Et3N'],
        solvents: ['CH2Cl2'],
        conditions: { temperature: '-78 °C to 25 °C', atmosphere: 'dry inert atmosphere' },
        byproducts: ['Me2S', 'CO', 'CO2', 'Et3NHCl']
      })
    ],
    byproducts: ['oxidant-derived reduced species'],
    selectivity: selectivity({ chemoselectivity: 'primary and secondary alcohols; tertiary alcohols excluded' }),
    notes: ['The template abstracts alcohol oxidation to a carbonyl without representing oxidant byproducts.'],
    limitations: ['Does not distinguish aldehyde overoxidation conditions.', 'Tertiary alcohols are intentionally outside the transform scope.']
  },
  aldehydeOxidation: {
    category: CATEGORY.oxidationReduction,
    summary: 'Aldehyde -> carboxylic acid',
    variants: [
      variant({ id: 'jones', label: 'Jones oxidation', reagents: ['CrO3', 'H2SO4'], solvents: ['acetone', 'water'], conditions: { temperature: '0 °C to 25 °C' } }),
      variant({
        id: 'pinnick',
        label: 'NaClO2 (Pinnick)',
        role: 'alternative',
        reagents: ['NaClO2', 'NaH2PO4', '2-methyl-2-butene'],
        solvents: ['t-BuOH', 'water'],
        conditions: { temperature: '25 °C', pH: 'buffered acidic' }
      }),
      variant({ id: 'kmno4', label: 'KMnO4', role: 'alternative', reagents: ['KMnO4'], solvents: ['water'], conditions: { temperature: '25 °C to heat' } })
    ],
    notes: ['The template represents formal oxidation of aldehydes to acids.'],
    limitations: ['Does not model hydrate formation or oxidant stoichiometry.']
  },
  carbonylReduction: {
    category: CATEGORY.oxidationReduction,
    summary: 'Carbonyl -> alcohol',
    variants: [
      variant({ id: 'nabh4', label: 'NaBH4', reagents: ['NaBH4'], solvents: ['MeOH', 'EtOH'], conditions: { temperature: '0 °C to 25 °C' } }),
      variant({ id: 'lialh4', label: 'LiAlH4', role: 'alternative', reagents: ['LiAlH4'], solvents: ['Et2O', 'THF'], conditions: { temperature: '0 °C to 25 °C', workup: 'aqueous workup' } }),
      variant({ id: 'h2-pd-c', label: 'H2, Pd/C', role: 'alternative', reagents: ['H2'], catalysts: ['Pd/C'], solvents: ['EtOH'], conditions: { temperature: '25 °C', pressure: '1 atm H2' } })
    ],
    notes: ['The template reduces aldehydes and ketones to alcohols.'],
    limitations: ['Acyl derivatives are excluded by the SMARTS guard.', 'Chemoselectivity depends on substrate and reagent.']
  },
  imineReduction: {
    category: CATEGORY.oxidationReduction,
    summary: 'Imine -> amine',
    variants: [
      variant({ id: 'nabh3cn', label: 'NaBH3CN', reagents: ['NaBH3CN'], solvents: ['MeOH'], conditions: { pH: 'mildly acidic', temperature: '25 °C' } }),
      variant({ id: 'nabh-oac3', label: 'NaBH(OAc)3', role: 'alternative', reagents: ['NaBH(OAc)3'], solvents: ['CH2Cl2', 'DCE'], conditions: { temperature: '25 °C' } }),
      variant({ id: 'h2-pd-c', label: 'H2, Pd/C', role: 'alternative', reagents: ['H2'], catalysts: ['Pd/C'], solvents: ['EtOH'], conditions: { temperature: '25 °C', pressure: '1 atm H2' } })
    ],
    notes: ['Useful for reductive amination-style imine reduction.'],
    limitations: ['The template does not represent imine formation or equilibrium with carbonyl precursors.']
  },
  alkeneHydrogenation: {
    category: CATEGORY.oxidationReduction,
    summary: 'Alkene -> alkane',
    variants: [
      variant({ id: 'h2-pd-c', label: 'H2, Pd/C', reagents: ['H2'], catalysts: ['Pd/C'], solvents: ['EtOH', 'EtOAc'], conditions: { temperature: '25 °C', pressure: '1 atm H2' } }),
      variant({ id: 'h2-pt', label: 'H2, PtO2', role: 'alternative', reagents: ['H2'], catalysts: ['PtO2'], solvents: ['EtOH'], conditions: { temperature: '25 °C', pressure: '1 atm H2' } }),
      variant({
        id: 'h2-raney-ni',
        label: 'H2, Raney Ni',
        role: 'alternative',
        reagents: ['H2'],
        catalysts: ['Raney Ni'],
        solvents: ['EtOH'],
        conditions: { temperature: '25 °C to heat', pressure: 'H2' }
      })
    ],
    byproducts: [],
    selectivity: selectivity({ stereochemistry: 'syn addition is common experimentally, but not encoded by this template' }),
    notes: ['The template represents catalytic addition of hydrogen across a neutral alkene.'],
    limitations: ['Does not encode stereochemical delivery or catalyst poisoning effects.']
  },
  alkynePartialReduction: {
    category: CATEGORY.oxidationReduction,
    summary: 'Alkyne -> alkene',
    variants: [
      variant({
        id: 'lindlar',
        label: 'H2, Lindlar catalyst',
        reagents: ['H2'],
        catalysts: ['Lindlar catalyst'],
        solvents: ['EtOH', 'quinoline'],
        conditions: { temperature: '25 °C', pressure: '1 atm H2' },
        notes: ['Typically gives cis alkenes; the current template does not encode alkene stereochemistry.']
      }),
      variant({
        id: 'dissolving-metal',
        label: 'Na, NH3(l)',
        role: 'alternative',
        reagents: ['Na'],
        solvents: ['NH3(l)'],
        conditions: { temperature: '-78 °C' },
        notes: ['Typically gives trans alkenes; the current template does not encode alkene stereochemistry.']
      })
    ],
    byproducts: [],
    selectivity: selectivity({ stereochemistry: 'Lindlar gives Z (cis), dissolving metal gives E (trans); E/Z outcome not encoded in product SMIRKS' }),
    notes: ['The template stops at the alkene oxidation state.'],
    limitations: ['No E/Z stereochemical outcome is represented.']
  },
  alkyneFullReduction: {
    category: CATEGORY.oxidationReduction,
    summary: 'Alkyne -> alkane',
    variants: [
      variant({ id: 'h2-pd-c-excess', label: 'excess H2, Pd/C', reagents: ['H2'], catalysts: ['Pd/C'], solvents: ['EtOH'], conditions: { temperature: '25 °C', pressure: 'H2' } }),
      variant({ id: 'h2-pt', label: 'H2, Pt', role: 'alternative', reagents: ['H2'], catalysts: ['Pt'], solvents: ['EtOH'], conditions: { temperature: '25 °C', pressure: 'H2' } })
    ],
    notes: ['Represents complete catalytic hydrogenation of an alkyne.'],
    limitations: ['Does not model intermediate alkene accumulation.']
  },
  benzylicOxidation: {
    category: CATEGORY.oxidationReduction,
    summary: 'Benzylic methyl -> benzaldehyde',
    variants: [
      variant({ id: 'etard', label: 'CrO2Cl2', reagents: ['CrO2Cl2'], solvents: ['CS2', 'CH2Cl2'], conditions: { temperature: '0 °C to 25 °C', workup: 'aqueous workup' } }),
      variant({ id: 'seo2', label: 'SeO2', role: 'alternative', reagents: ['SeO2'], solvents: ['dioxane', 'water'], conditions: { temperature: 'heat' } })
    ],
    notes: ['The template is intentionally aldehyde-directed rather than the stronger oxidation to benzoic acid.'],
    limitations: ['Common benzylic oxidants such as hot KMnO4 often proceed to acids, not this template product.']
  },
  dehalogenation: {
    category: CATEGORY.substitution,
    summary: 'Alkyl halide -> alkane',
    variants: [
      variant({ id: 'h2-pd-c', label: 'H2, Pd/C', reagents: ['H2'], catalysts: ['Pd/C'], solvents: ['EtOH'], conditions: { temperature: '25 °C', pressure: '1 atm H2' } }),
      variant({
        id: 'lialh4',
        label: 'LiAlH4',
        role: 'alternative',
        reagents: ['LiAlH4'],
        solvents: ['Et2O', 'THF'],
        conditions: { temperature: '0 °C to 25 °C', workup: 'aqueous workup' },
        byproducts: ['aluminum salts', 'halide salts']
      }),
      variant({
        id: 'bu3snh-aibn',
        label: 'Bu3SnH, AIBN',
        role: 'alternative',
        reagents: ['Bu3SnH'],
        catalysts: ['AIBN'],
        solvents: ['benzene', 'toluene'],
        conditions: { temperature: 'heat', atmosphere: 'inert atmosphere' },
        byproducts: ['Bu3SnX']
      })
    ],
    byproducts: ['halide-containing reagent products'],
    selectivity: selectivity({ chemoselectivity: 'strongly substrate- and halide-dependent' }),
    notes: ['The template removes F, Cl, Br, or I from carbon and replaces it implicitly with hydrogen.'],
    limitations: ['Actual reactivity varies strongly by halide, substrate class, and competing elimination.']
  },
  halideHydrolysis: {
    category: CATEGORY.substitution,
    summary: 'Alkyl halide -> alcohol',
    variants: [
      variant({ id: 'aqueous-hydroxide', label: 'aq. NaOH', reagents: ['NaOH'], solvents: ['water', 'ethanol'], conditions: { temperature: '25 °C to reflux' } }),
      variant({ id: 'silver-water', label: 'AgNO3, H2O', role: 'alternative', reagents: ['AgNO3', 'H2O'], solvents: ['acetone', 'water'], conditions: { temperature: '25 °C to heat' } })
    ],
    selectivity: selectivity({ stereochemistry: 'SN2 substrates invert; SN1 substrates racemize; not encoded' }),
    notes: ['Represents substitution of Cl, Br, or I by OH.'],
    limitations: ['Does not distinguish SN1/SN2 substrate classes or elimination side reactions.']
  },
  arylHalideHydrolysis: {
    category: CATEGORY.substitution,
    summary: 'Aryl halide -> phenol',
    variants: [
      variant({ id: 'dow-process', label: 'NaOH, heat', reagents: ['NaOH'], solvents: ['water'], conditions: { temperature: 'heat', pressure: 'pressure' } }),
      variant({
        id: 'copper-hydroxylation',
        label: 'Cu-catalyzed hydroxylation',
        role: 'alternative',
        reagents: ['base'],
        catalysts: ['Cu catalyst'],
        solvents: ['DMSO', 'water'],
        conditions: { temperature: 'heat' }
      }),
      variant({
        id: 'palladium-hydroxylation',
        label: 'Pd-catalyzed hydroxylation',
        role: 'alternative',
        reagents: ['base'],
        catalysts: ['Pd catalyst'],
        solvents: ['dioxane', 'water'],
        conditions: { temperature: 'heat' }
      })
    ],
    notes: ['The template is a formal aryl halide to phenol conversion.'],
    limitations: ['Unactivated aryl chlorides typically require forcing or catalyzed conditions.']
  },
  alcoholHalogenation: {
    category: CATEGORY.substitution,
    summary: 'Alcohol -> alkyl chloride',
    variants: [
      variant({ id: 'socl2', label: 'SOCl2', reagents: ['SOCl2'], solvents: ['CH2Cl2'], conditions: { temperature: '0 °C to 25 °C' }, byproducts: ['SO2', 'HCl'] }),
      variant({ id: 'pcl3', label: 'PCl3', role: 'alternative', reagents: ['PCl3'], solvents: ['Et2O'], conditions: { temperature: '0 °C to 25 °C' }, byproducts: ['H3PO3'] }),
      variant({ id: 'lucas', label: 'HCl, ZnCl2', role: 'alternative', reagents: ['HCl'], catalysts: ['ZnCl2'], solvents: ['water'], conditions: { temperature: '25 °C' } })
    ],
    byproducts: ['reagent-derived oxygen byproducts'],
    selectivity: selectivity({ stereochemistry: 'inversion, retention, or racemization depends on reagent and substrate; not encoded' }),
    notes: ['The current template specifically forms chlorides.'],
    limitations: ['Stereochemical inversion/retention is not represented.']
  },
  nitrileHydrogenationToImine: {
    category: CATEGORY.oxidationReduction,
    summary: 'Nitrile -> imine',
    variants: [
      variant({ id: 'dibal-low-temp', label: 'DIBAL-H, low temperature', reagents: ['DIBAL-H'], solvents: ['toluene', 'CH2Cl2'], conditions: { temperature: '-78 °C', workup: 'controlled quench' } }),
      variant({
        id: 'partial-hydrogenation',
        label: 'partial catalytic hydrogenation',
        role: 'alternative',
        reagents: ['H2'],
        catalysts: ['poisoned metal catalyst'],
        solvents: ['EtOH'],
        conditions: { temperature: '25 °C', pressure: 'H2' }
      })
    ],
    notes: ['Represents partial reduction at the nitrile carbon-nitrogen bond.'],
    limitations: ['Many practical conditions continue to aldehydes or amines after workup; the imine product is a formal template product.']
  },
  etherCleavage: {
    category: CATEGORY.substitution,
    summary: 'Ether -> alcohol fragments',
    variants: [
      variant({ id: 'hi-heat', label: 'HI, heat', reagents: ['HI'], solvents: [], conditions: { temperature: 'heat' } }),
      variant({ id: 'hbr-heat', label: 'HBr, heat', role: 'alternative', reagents: ['HBr'], solvents: [], conditions: { temperature: 'heat' } })
    ],
    notes: ['The template depicts C-O cleavage and alcohol formation.'],
    limitations: ['Regioselectivity depends on substrate class; aryl methyl ether demethylation is not separately encoded.']
  },
  esterHydrolysis: {
    category: CATEGORY.acylChemistry,
    summary: 'Ester -> carboxylic acid + alcohol',
    variants: [
      variant({ id: 'acid-hydrolysis', label: 'H3O+, heat', reagents: ['H2O'], catalysts: ['acid'], solvents: ['water'], conditions: { temperature: 'heat', pH: 'acidic' } }),
      variant({
        id: 'base-hydrolysis-workup',
        label: 'NaOH, then acid workup',
        role: 'alternative',
        reagents: ['NaOH', 'H3O+'],
        solvents: ['water', 'ethanol'],
        conditions: { temperature: '25 °C to heat', workup: 'acid workup' }
      })
    ],
    notes: ['The template returns the neutral acid and alcohol products.'],
    limitations: ['Base-promoted saponification has a separate carboxylate template.']
  },
  esterification: {
    category: CATEGORY.acylChemistry,
    summary: 'Carboxylic acid + alcohol -> ester',
    variants: [
      variant({ id: 'fischer', label: 'cat. H2SO4, heat', reagents: ['alcohol'], catalysts: ['H2SO4'], solvents: [], conditions: { temperature: 'reflux', pH: 'acidic' } }),
      variant({
        id: 'ptsoh-dean-stark',
        label: 'p-TsOH, Dean-Stark',
        role: 'alternative',
        reagents: ['alcohol'],
        catalysts: ['p-TsOH'],
        solvents: ['toluene'],
        conditions: { temperature: 'reflux', workup: 'remove water' }
      })
    ],
    byproducts: ['H2O'],
    selectivity: selectivity({ chemoselectivity: 'acid/alcohol condensation; other nucleophilic functional groups not distinguished' }),
    notes: ['Represents Fischer-style esterification with water as the leaving fragment.'],
    limitations: ['Coupling reagents such as DCC/DMAP are not byproduct-balanced by this template.', 'Competing transesterification under Fischer conditions is not modeled.']
  },
  saponification: {
    category: CATEGORY.acylChemistry,
    summary: 'Ester -> carboxylate + alcohol',
    variants: [
      variant({ id: 'naoh-aq', label: 'NaOH, H2O/EtOH', reagents: ['NaOH'], solvents: ['water', 'ethanol'], conditions: { temperature: '25 °C to reflux', pH: 'basic' } }),
      variant({ id: 'koh-meoh', label: 'KOH, MeOH', role: 'alternative', reagents: ['KOH'], solvents: ['MeOH'], conditions: { temperature: '25 °C to reflux', pH: 'basic' } })
    ],
    notes: ['The template gives the carboxylate salt form.'],
    limitations: ['Counterions are not represented explicitly.']
  },
  anhydrideHydrolysis: {
    category: CATEGORY.acylChemistry,
    summary: 'Anhydride -> carboxylic acids',
    variants: [
      variant({ id: 'water', label: 'H2O', reagents: ['H2O'], solvents: ['water'], conditions: { temperature: '25 °C' } }),
      variant({ id: 'acid-or-base', label: 'aq. acid or base', role: 'alternative', reagents: ['H2O'], catalysts: ['acid or base'], solvents: ['water'], conditions: { temperature: '25 °C to heat' } })
    ],
    notes: ['Represents hydrolytic cleavage of an anhydride.'],
    limitations: ['Mixed anhydrides may produce regioisomeric product sets not distinguished here.']
  },
  amideHydrolysis: {
    category: CATEGORY.acylChemistry,
    summary: 'Amide -> carboxylic acid + amine',
    variants: [
      variant({ id: 'acid-heat', label: 'H3O+, heat', reagents: ['H2O'], catalysts: ['acid'], solvents: ['water'], conditions: { temperature: 'heat', pH: 'acidic' } }),
      variant({
        id: 'base-heat-workup',
        label: 'NaOH, heat; acid workup',
        role: 'alternative',
        reagents: ['NaOH', 'H3O+'],
        solvents: ['water'],
        conditions: { temperature: 'heat', pH: 'basic then acidic', workup: 'acid workup' }
      })
    ],
    notes: ['The neutral product template abstracts acid/base speciation after workup.'],
    limitations: ['Amide hydrolysis often requires forcing conditions.']
  },
  amineAcylation: {
    category: CATEGORY.acylChemistry,
    summary: 'Acid chloride + amine -> amide',
    variants: [
      variant({ id: 'amine-base', label: 'acid chloride, amine base', reagents: ['acid chloride', 'amine'], solvents: ['CH2Cl2'], conditions: { temperature: '0 °C to 25 °C' } }),
      variant({ id: 'pyridine', label: 'pyridine', role: 'alternative', reagents: ['acid chloride', 'amine'], solvents: ['pyridine'], conditions: { temperature: '0 °C to 25 °C' } }),
      variant({
        id: 'schotten-baumann',
        label: 'Schotten-Baumann',
        role: 'alternative',
        reagents: ['acid chloride', 'amine', 'NaOH'],
        solvents: ['water', 'organic cosolvent'],
        conditions: { temperature: '0 °C to 25 °C', pH: 'basic' }
      })
    ],
    byproducts: ['Cl- or HCl salt'],
    selectivity: selectivity({ chemoselectivity: 'primary and secondary amines; amide nitrogens excluded' }),
    notes: ['Represents N-acylation by acid chloride.'],
    limitations: ['The template excludes amide nitrogens and requires at least one N-H.']
  },
  amineAlkylation: {
    category: CATEGORY.substitution,
    summary: 'Alkyl chloride + amine -> alkylated amine',
    variants: [
      variant({ id: 'k2co3-mecn', label: 'K2CO3, MeCN', reagents: ['K2CO3'], solvents: ['MeCN'], conditions: { temperature: '25 °C to reflux' } }),
      variant({ id: 'excess-amine', label: 'excess amine', role: 'alternative', reagents: ['amine'], solvents: ['EtOH'], conditions: { temperature: 'heat' } }),
      variant({ id: 'nai-finkelstein', label: 'NaI, base', role: 'alternative', reagents: ['NaI', 'base'], solvents: ['acetone', 'MeCN'], conditions: { temperature: '25 °C to heat' } })
    ],
    notes: ['Represents substitution of a primary alkyl chloride by a neutral amine.'],
    limitations: ['Overalkylation and elimination are not modeled.']
  },
  imineHydrolysis: {
    category: CATEGORY.substitution,
    summary: 'Imine -> carbonyl + amine',
    variants: [
      variant({ id: 'aqueous-acid', label: 'aq. acid', reagents: ['H2O'], catalysts: ['acid'], solvents: ['water'], conditions: { temperature: '25 °C to heat', pH: 'acidic' } }),
      variant({ id: 'water', label: 'H2O', role: 'alternative', reagents: ['H2O'], solvents: ['water'], conditions: { temperature: '25 °C' } })
    ],
    notes: ['Represents hydrolysis of an imine C=N bond.'],
    limitations: ['Equilibrium and amine protonation states are not modeled.']
  },
  nitrileHydrolysisToAmide: {
    category: CATEGORY.acylChemistry,
    summary: 'Nitrile -> amide',
    variants: [
      variant({ id: 'acid-controlled', label: 'controlled aq. acid', reagents: ['H2O'], catalysts: ['acid'], solvents: ['water'], conditions: { temperature: '25 °C to heat', pH: 'acidic' } }),
      variant({ id: 'h2o2-base', label: 'H2O2, base', role: 'alternative', reagents: ['H2O2', 'NaOH'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'basic' } })
    ],
    notes: ['Represents partial hydrolysis of a nitrile to an amide.'],
    limitations: ['Further hydrolysis to acid competes under stronger conditions.']
  },
  nitrileHydrolysisToAcid: {
    category: CATEGORY.acylChemistry,
    summary: 'Nitrile -> carboxylic acid',
    variants: [
      variant({ id: 'acid-heat', label: 'H3O+, heat', reagents: ['H2O'], catalysts: ['acid'], solvents: ['water'], conditions: { temperature: 'heat', pH: 'acidic' } }),
      variant({
        id: 'base-heat-workup',
        label: 'NaOH, heat; acid workup',
        role: 'alternative',
        reagents: ['NaOH', 'H3O+'],
        solvents: ['water'],
        conditions: { temperature: 'heat', pH: 'basic then acidic', workup: 'acid workup' }
      })
    ],
    notes: ['Represents complete hydrolysis of a nitrile to the acid oxidation state.'],
    limitations: ['Amide intermediates and salt forms are not represented.']
  },
  lactoneHydrolysis: {
    category: CATEGORY.acylChemistry,
    summary: 'Lactone -> hydroxy acid',
    variants: [
      variant({ id: 'base-opening', label: 'NaOH, H2O', reagents: ['NaOH'], solvents: ['water'], conditions: { temperature: '25 °C to heat', pH: 'basic', workup: 'acid workup for neutral acid' } }),
      variant({ id: 'acid-opening', label: 'H3O+', role: 'alternative', reagents: ['H2O'], catalysts: ['acid'], solvents: ['water'], conditions: { temperature: 'heat', pH: 'acidic' } })
    ],
    notes: ['Represents ring-opening hydrolysis of a lactone.'],
    limitations: ['Ring strain and reversible lactonization are not modeled.']
  },
  lactamHydrolysis: {
    category: CATEGORY.acylChemistry,
    summary: 'Lactam -> amino acid',
    variants: [
      variant({ id: 'acid-heat', label: 'H3O+, heat', reagents: ['H2O'], catalysts: ['acid'], solvents: ['water'], conditions: { temperature: 'heat', pH: 'acidic' } }),
      variant({
        id: 'base-heat-workup',
        label: 'NaOH, heat; acid workup',
        role: 'alternative',
        reagents: ['NaOH', 'H3O+'],
        solvents: ['water'],
        conditions: { temperature: 'heat', pH: 'basic then acidic', workup: 'acid workup' }
      })
    ],
    notes: ['Represents ring-opening hydrolysis of a lactam.'],
    limitations: ['Many lactams require forcing conditions.']
  },
  acidChlorideHydrolysis: {
    category: CATEGORY.acylChemistry,
    summary: 'Acid chloride -> carboxylic acid',
    variants: [
      variant({ id: 'water', label: 'H2O', reagents: ['H2O'], solvents: ['water'], conditions: { temperature: '0 °C to 25 °C' } }),
      variant({
        id: 'aqueous-base',
        label: 'aq. base then acid workup',
        role: 'alternative',
        reagents: ['NaOH', 'H3O+'],
        solvents: ['water'],
        conditions: { temperature: '0 °C to 25 °C', workup: 'acid workup' }
      })
    ],
    notes: ['Represents rapid hydrolysis of acid chlorides.'],
    limitations: ['HCl and salt byproducts are not represented.']
  },
  carboxylicAcidDeprotonation: {
    category: CATEGORY.acidBase,
    summary: 'Carboxylic acid -> carboxylate',
    variants: [
      variant({ id: 'nahco3', label: 'NaHCO3', reagents: ['NaHCO3'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'basic' } }),
      variant({ id: 'naoh', label: 'NaOH', role: 'alternative', reagents: ['NaOH'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'basic' } })
    ],
    notes: ['Represents acid-base deprotonation of a carboxylic acid.'],
    limitations: ['Counterions are not represented.']
  },
  carboxylateProtonation: {
    category: CATEGORY.acidBase,
    summary: 'Carboxylate -> carboxylic acid',
    variants: [
      variant({ id: 'hcl', label: 'HCl', reagents: ['HCl'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'acidic' } }),
      variant({ id: 'h3o', label: 'H3O+', role: 'alternative', reagents: ['H3O+'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'acidic' } })
    ],
    notes: ['Represents protonation of a carboxylate.'],
    limitations: ['Does not represent salts or buffers explicitly.']
  },
  alcoholDehydration: {
    category: CATEGORY.bondConstruction,
    summary: 'Alcohol -> alkene',
    variants: [
      variant({ id: 'h2so4-heat', label: 'conc. H2SO4, heat', reagents: ['H2SO4'], solvents: [], conditions: { temperature: 'heat', pH: 'strongly acidic' } }),
      variant({ id: 'h3po4-heat', label: 'H3PO4, heat', role: 'alternative', reagents: ['H3PO4'], solvents: [], conditions: { temperature: 'heat', pH: 'acidic' } }),
      variant({ id: 'pocl3-pyridine', label: 'POCl3, pyridine', role: 'alternative', reagents: ['POCl3', 'pyridine'], solvents: ['CH2Cl2'], conditions: { temperature: '0 °C to 25 °C' } })
    ],
    byproducts: ['H2O'],
    selectivity: selectivity({ regioselectivity: 'Zaitsev/Hofmann outcome not encoded', stereochemistry: 'alkene E/Z outcome not encoded' }),
    notes: ['The template forms an alkene and water from a beta-hydroxy alkane motif.'],
    limitations: ['Regioselectivity, rearrangements, and stereochemical alkene outcomes are not encoded.']
  },
  alkylChlorideElimination: {
    category: CATEGORY.bondConstruction,
    summary: 'Alkyl chloride -> alkene',
    variants: [
      variant({ id: 'koh-ethanol-heat', label: 'KOH, EtOH, heat', reagents: ['KOH'], solvents: ['EtOH'], conditions: { temperature: 'heat', pH: 'basic' } }),
      variant({ id: 'tbuok', label: 'KOt-Bu', role: 'alternative', reagents: ['KOt-Bu'], solvents: ['t-BuOH', 'THF'], conditions: { temperature: '25 °C to heat', pH: 'basic' } }),
      variant({ id: 'dbu', label: 'DBU', role: 'alternative', reagents: ['DBU'], solvents: ['toluene', 'MeCN'], conditions: { temperature: '25 °C to heat' } })
    ],
    byproducts: ['HCl or chloride salt'],
    selectivity: selectivity({ regioselectivity: 'Zaitsev/Hofmann outcome not encoded', stereochemistry: 'E/Z outcome not encoded' }),
    notes: ['Represents formal dehydrohalogenation to an alkene.'],
    limitations: ['E1/E2 pathway, regioselectivity, and E/Z outcome are not modeled.']
  },
  sulfideOxidationToSulfoxide: {
    category: CATEGORY.oxidationReduction,
    summary: 'Sulfide -> sulfoxide',
    variants: [
      variant({ id: 'mcpba-one-equiv', label: 'mCPBA', reagents: ['mCPBA'], solvents: ['CH2Cl2'], conditions: { temperature: '0 °C to 25 °C' } }),
      variant({ id: 'h2o2', label: 'H2O2', role: 'alternative', reagents: ['H2O2'], solvents: ['MeOH', 'water'], conditions: { temperature: '25 °C' } }),
      variant({ id: 'naio4', label: 'NaIO4', role: 'alternative', reagents: ['NaIO4'], solvents: ['MeOH', 'water'], conditions: { temperature: '25 °C' } })
    ],
    selectivity: selectivity({ stereochemistry: 'chiral sulfoxide stereocenter formed; asymmetric oxidation variants not encoded' }),
    notes: ['Represents one oxygen transfer to sulfur.'],
    limitations: ['Overoxidation to sulfone depends on reagent equivalents and substrate.']
  },
  sulfoxideOxidationToSulfone: {
    category: CATEGORY.oxidationReduction,
    summary: 'Sulfoxide -> sulfone',
    variants: [
      variant({ id: 'mcpba-excess', label: 'mCPBA', reagents: ['mCPBA'], solvents: ['CH2Cl2'], conditions: { temperature: '0 °C to 25 °C' } }),
      variant({ id: 'h2o2', label: 'H2O2', role: 'alternative', reagents: ['H2O2'], solvents: ['AcOH', 'water'], conditions: { temperature: '25 °C to heat' } }),
      variant({ id: 'oxone', label: 'Oxone', role: 'alternative', reagents: ['Oxone'], solvents: ['MeOH', 'water'], conditions: { temperature: '25 °C' } })
    ],
    notes: ['Represents oxidation from sulfoxide to sulfone.'],
    limitations: ['Does not encode oxidant equivalents.']
  },
  amineProtonation: {
    category: CATEGORY.acidBase,
    summary: 'Amine -> ammonium',
    variants: [
      variant({ id: 'hcl', label: 'HCl', reagents: ['HCl'], solvents: ['Et2O', 'water'], conditions: { temperature: '25 °C', pH: 'acidic' } }),
      variant({ id: 'tfa', label: 'TFA', role: 'alternative', reagents: ['TFA'], solvents: ['CH2Cl2'], conditions: { temperature: '25 °C', pH: 'acidic' } })
    ],
    notes: ['Represents protonation of a neutral amine.'],
    limitations: ['Counterions and pKa equilibria are not represented.']
  },
  aromaticAzaProtonation: {
    category: CATEGORY.acidBase,
    summary: 'Aromatic aza nitrogen -> pyridinium-like cation',
    variants: [
      variant({ id: 'hcl', label: 'HCl', reagents: ['HCl'], solvents: ['water', 'Et2O'], conditions: { temperature: '25 °C', pH: 'acidic' } }),
      variant({ id: 'tfa', label: 'TFA', role: 'alternative', reagents: ['TFA'], solvents: ['CH2Cl2'], conditions: { temperature: '25 °C', pH: 'acidic' } })
    ],
    notes: ['Represents protonation of pyridine-like aromatic nitrogens.'],
    limitations: ['Does not model tautomeric or multi-site protonation equilibria.']
  },
  ammoniumDeprotonation: {
    category: CATEGORY.acidBase,
    summary: 'Ammonium -> amine',
    variants: [
      variant({ id: 'naoh', label: 'NaOH', reagents: ['NaOH'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'basic' } }),
      variant({ id: 'triethylamine', label: 'Et3N', role: 'alternative', reagents: ['Et3N'], solvents: ['CH2Cl2'], conditions: { temperature: '25 °C', pH: 'basic' } })
    ],
    notes: ['Represents deprotonation of an ammonium N-H site.'],
    limitations: ['Quaternary ammonium centers without N-H are excluded.']
  },
  phenolDeprotonation: {
    category: CATEGORY.acidBase,
    summary: 'Phenol -> phenolate',
    variants: [
      variant({ id: 'naoh', label: 'NaOH', reagents: ['NaOH'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'basic' } }),
      variant({ id: 'k2co3', label: 'K2CO3', role: 'alternative', reagents: ['K2CO3'], solvents: ['acetone', 'DMF'], conditions: { temperature: '25 °C to heat', pH: 'basic' } }),
      variant({ id: 'nah', label: 'NaH', role: 'alternative', reagents: ['NaH'], solvents: ['THF', 'DMF'], conditions: { temperature: '0 °C to 25 °C', atmosphere: 'dry inert atmosphere' } })
    ],
    notes: ['Represents phenol deprotonation to phenolate.'],
    limitations: ['Counterions and competing functional-group deprotonation are not represented.']
  },
  phenolateProtonation: {
    category: CATEGORY.acidBase,
    summary: 'Phenolate -> phenol',
    variants: [
      variant({ id: 'hcl', label: 'HCl', reagents: ['HCl'], solvents: ['water'], conditions: { temperature: '25 °C', pH: 'acidic' } }),
      variant({ id: 'nh4cl', label: 'NH4Cl', role: 'alternative', reagents: ['NH4Cl'], solvents: ['water'], conditions: { temperature: '25 °C' } })
    ],
    notes: ['Represents protonation of phenolate oxygen.'],
    limitations: ['Does not represent buffer equilibria.']
  },
  nitroReduction: {
    category: CATEGORY.oxidationReduction,
    summary: 'Nitro group -> amine',
    variants: [
      variant({ id: 'fe-hcl', label: 'Fe, HCl', reagents: ['Fe', 'HCl'], solvents: ['water', 'ethanol'], conditions: { temperature: 'heat', pH: 'acidic' } }),
      variant({ id: 'sn-hcl', label: 'Sn, HCl', role: 'alternative', reagents: ['Sn', 'HCl'], solvents: ['water', 'ethanol'], conditions: { temperature: 'heat', pH: 'acidic' } }),
      variant({ id: 'h2-pd-c', label: 'H2, Pd/C', role: 'alternative', reagents: ['H2'], catalysts: ['Pd/C'], solvents: ['EtOH'], conditions: { temperature: '25 °C', pressure: 'H2' } })
    ],
    notes: ['The template abstracts multi-electron nitro reduction to neutral nitrogen plus water fragments.'],
    limitations: ['Partial reduction products are not modeled.']
  },
  dielsAlder: {
    category: CATEGORY.cycloaddition,
    summary: 'Diene + alkene -> cyclohexene',
    variants: [
      variant({ id: 'thermal', label: 'heat', reagents: [], solvents: ['toluene', 'xylene'], conditions: { temperature: 'heat' } }),
      variant({
        id: 'lewis-acid',
        label: 'Lewis acid catalysis',
        role: 'alternative',
        reagents: [],
        catalysts: ['BF3.Et2O', 'AlCl3', 'TiCl4'],
        solvents: ['CH2Cl2'],
        conditions: { temperature: '-78 °C to 25 °C' }
      }),
      variant({ id: 'high-pressure', label: 'high pressure', role: 'alternative', reagents: [], solvents: [], conditions: { temperature: '25 °C to heat', pressure: 'high pressure' } })
    ],
    byproducts: [],
    selectivity: selectivity({
      regioselectivity: 'dienophile/diene substitution effects not encoded',
      stereochemistry: 'endo/exo and relative stereochemistry not encoded',
      chemoselectivity: 'requires an eligible diene and dienophile match'
    }),
    notes: ['Represents a formal [4+2] cycloaddition between a diene and dienophile.'],
    limitations: ['Regioselectivity, endo/exo selectivity, and stereochemistry are not encoded.']
  }
};

function withTemplateMetadata(templates, metadataByKey) {
  const result = {};
  for (const [key, entry] of Object.entries(templates)) {
    const metadata = metadataByKey[key];
    if (!metadata) {
      throw new Error(`reactionTemplates metadata missing for '${key}'`);
    }
    result[key] = {
      ...entry,
      ...metadata,
      byproducts: metadata.byproducts ?? [],
      selectivity: selectivity(metadata.selectivity),
      references: metadata.references ?? []
    };
  }
  return result;
}

/** @type {Record<string, ReactionTemplateEntry>} */
export const reactionTemplates = withTemplateMetadata(BASE_REACTION_TEMPLATES, REACTION_TEMPLATE_METADATA);
