/** @module data/catalog/psychoactive-compounds */

const psychoactiveCompoundsCatalog = {
  id: 'psychoactive-compounds',
  name: 'Psychoactive Compounds',
  description: 'Representative psychoactive compounds including psychedelics, opioids, and stimulants.',
  tags: ['psychoactive', 'alkaloids', 'tryptamines', 'phenethylamines', 'opioids'],
  molecules: [
    {
      id: '2c-b',
      name: '2C-B',
      smiles: 'COc1cc(CCN)c(OC)cc1Br',
      inchi: 'InChI=1S/C10H14BrNO2/c1-13-8(7)6-10(9(5-7-3-4-12)14-2)11/h5-6H,3-4,12H2,1-2H3',
      tags: ['psychedelic', 'phenethylamine', 'substituted-phenethylamine', 'brominated'],
      aliases: ['2cb', '4-bromo-2,5-dimethoxyphenethylamine', 'nexus']
    },
    {
      id: '5-meo-dmt',
      name: '5-MeO-DMT',
      smiles: 'COc2ccc1[nH]cc(CCN(C)C)c1c2',
      inchi: 'InChI=1S/C13H18N2O/c1-15(2)5-4-10-9-14-13(12)7-6-11(8-12-10)16-3/h6-9,14H,4-5H2,1-3H3',
      tags: ['psychedelic', 'tryptamine', 'methoxy'],
      aliases: ['5-methoxy-dmt', '5-methoxy-n,n-dimethyltryptamine']
    },
    {
      id: 'amphetamine',
      name: 'Amphetamine',
      smiles: 'NC(C)Cc1ccccc1',
      inchi: 'InChI=1S/C9H13N/c1-8(2-9(7)6-4-3-5-7)10/h3-8H,2,10H2,1H3',
      tags: ['stimulant', 'phenethylamine', 'amphetamine'],
      aliases: ['alpha-methylphenethylamine', 'speed']
    },
    {
      id: 'caffeine',
      name: 'Caffeine',
      smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C',
      inchi: 'InChI=1S/C8H10N4O2/c1-10(6)5(7-8(9-4-12(7)3)11(2)6-14)13/h4H,1-3H3',
      tags: ['stimulant', 'xanthine', 'alkaloid'],
      aliases: ['1,3,7-trimethylxanthine', 'guaranine']
    },
    {
      id: 'cbd',
      name: 'CBD',
      smiles: 'Oc1c(c(O)cc(c1)CCCCC)C2C=C(/CCC2C(=C)C)C',
      inchi: 'InChI=1S/C21H30O2/c1-5-6-7-10-18(13)12-19(21(17(16)11-15(4)8-9-16-14(2)3)20(13)23)22/h11-13,16-17,22-23H,2,5-10H2,1,3-4H3',
      tags: ['cannabinoid', 'terpenophenol', 'phytocannabinoid'],
      aliases: ['cannabidiol']
    },
    {
      id: 'cocaine',
      name: 'Cocaine',
      smiles: 'CN1C2CCC1C(C(OC)=O)C(OC(c3ccccc3)=O)C2',
      inchi: 'InChI=1S/C17H21NO4/c1-18(12)11(5)3-4-12-14(13(5)22-16(17(10)9-7-6-8-10)20)15(19)21-2/h6-14H,3-5H2,1-2H3',
      tags: ['stimulant', 'tropane', 'alkaloid'],
      aliases: ['benzoylmethylecgonine']
    },
    {
      id: 'dmt',
      name: 'DMT',
      smiles: 'CN(C)CCC1=CNC2=CC=CC=C12',
      inchi: 'InChI=1S/C12H16N2/c1-14(2)4-3-10-9-13-12(11)8-6-5-7-11-10/h5-9,13H,3-4H2,1-2H3',
      tags: ['psychedelic', 'tryptamine', 'indole'],
      aliases: ['n,n-dimethyltryptamine', 'dimethyltryptamine']
    },
    {
      id: 'ethanol',
      name: 'Ethanol',
      smiles: 'CCO',
      inchi: 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3',
      tags: ['depressant', 'alcohol', 'small-molecule'],
      aliases: ['ethyl alcohol', 'alcohol']
    },
    {
      id: 'fentanyl',
      name: 'Fentanyl',
      smiles: 'CCC(=O)N(c1ccccc1)C1CCN(CCc2ccccc2)CC1',
      inchi: 'InChI=1S/C22H28N2O/c1-2-20(24(19(4)3-6-23(7-4)8-5-21(16)15-11-9-12-16)22(18)17-13-10-14-18)25/h9-19H,2-8H2,1H3',
      tags: ['opioid', 'anilidopiperidine', 'analgesic'],
      aliases: ['fentenyl', 'n-phenyl-n-[1-(2-phenylethyl)piperidin-4-yl]propanamide']
    },
    {
      id: 'ketamine',
      name: 'Ketamine',
      smiles: 'Clc1ccccc1C2(NC)CCCCC2=O',
      inchi: 'InChI=1S/C13H16ClNO/c1-15-13(10,5-3-2-4-10-16)11-8-6-7-9-12(11)14/h6-9,15H,2-5H2,1H3',
      tags: ['dissociative', 'arylcyclohexylamine', 'anesthetic'],
      aliases: ['2-(2-chlorophenyl)-2-(methylamino)cyclohexan-1-one']
    },
    {
      id: 'lsd',
      name: 'LSD',
      smiles: 'CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C',
      inchi: 'InChI=1S/C20H25N3O/c1-4-23(5-2)16(13(8)6-14-15(7-17-12-21-19-11-9-10-18(14)20(17)19)22(3)8)24/h6,9-13,15,21H,4-5,7-8H2,1-3H3',
      tags: ['psychedelic', 'ergoline', 'lysergamide'],
      aliases: ['lysergic acid diethylamide', 'acid']
    },
    {
      id: 'mdma',
      name: 'MDMA',
      smiles: 'CC(NC)CC1=CC=C(OCO2)C2=C1',
      inchi: 'InChI=1S/C11H15NO2/c1-8(3-9(7)5-6-10-11(7)14-4-13-10)12-2/h5-8,12H,3-4H2,1-2H3',
      tags: ['empathogen', 'phenethylamine', 'methylenedioxy'],
      aliases: ['3,4-methylenedioxymethamphetamine', 'ecstasy']
    },
    {
      id: 'mescaline',
      name: 'Mescaline',
      smiles: 'O(c1cc(cc(OC)c1OC)CCN)C',
      inchi: 'InChI=1S/C11H17NO3/c1-13-9-6-8(4-5-12)7-10(11(9)15-3)14-2/h6-7H,4-5,12H2,1-3H3',
      tags: ['psychedelic', 'phenethylamine', 'methoxy'],
      aliases: ['3,4,5-trimethoxyphenethylamine']
    },
    {
      id: 'methamphetamine',
      name: 'Methamphetamine',
      smiles: 'CC(CC1=CC=CC=C1)NC',
      inchi: 'InChI=1S/C10H15N/c1-9(3-10(8)7-5-4-6-8)11-2/h4-9,11H,3H2,1-2H3',
      tags: ['stimulant', 'phenethylamine', 'amphetamine'],
      aliases: ['n-methylamphetamine', 'meth']
    },
    {
      id: 'nicotine',
      name: 'Nicotine',
      smiles: 'c1ncccc1C2CCCN2C',
      inchi: 'InChI=1S/C10H14N2/c1-12(9)4-2-3-9-10(8)6-5-7-11-8/h5-9H,2-4H2,1H3',
      tags: ['stimulant', 'alkaloid', 'nicotinic'],
      aliases: ['(S)-nicotine']
    },
    {
      id: 'psilocin',
      name: 'Psilocin',
      smiles: 'CN(C)CCc1c[nH]c2cccc(O)c12',
      inchi: 'InChI=1S/C12H16N2O/c1-14(2)4-3-9-8-13-10-6-5-7-11(12(9)10)15/h5-8,13,15H,3-4H2,1-2H3',
      tags: ['psychedelic', 'tryptamine', 'indole'],
      aliases: ['4-hydroxy-dmt', '4-hydroxy-n,n-dimethyltryptamine']
    },
    {
      id: 'psilocybin',
      name: 'Psilocybin',
      smiles: 'CN(C)CCC1=CNC2=C1C(=CC=C2)OP(=O)(O)O',
      inchi: 'InChI=1S/C12H17N2O4P/c1-14(2)4-3-9-8-13-10-6-5-7-11(12(9)10)18-19(15,16)17/h5-8,13,16-17H,3-4H2,1-2H3',
      tags: ['psychedelic', 'tryptamine', 'phosphate'],
      aliases: ['4-phosphoryloxy-dmt', '4-phosphoryloxy-n,n-dimethyltryptamine']
    },
    {
      id: 'thc',
      name: 'THC',
      smiles: 'CCCCCC1=CC(=C2C3C=C(CCC3C(OC2=C1)(C)C)C)O',
      inchi: 'InChI=1S/C21H30O2/c1-5-6-7-10-17(13)12-18(20(19)15-11-14(2)8-9-16(15)21(3,4)23-19-13)22/h11-13,15-16,22H,5-10H2,1-4H3',
      tags: ['cannabinoid', 'terpenophenol', 'phytocannabinoid'],
      aliases: ['delta-9-thc', 'tetrahydrocannabinol']
    }
  ]
};

export default psychoactiveCompoundsCatalog;
