/** @module data/catalog/vitamins */

const vitaminsCatalog = {
  id: 'vitamins',
  name: 'Vitamins',
  description:
    'Essential organic micronutrients required in small amounts for normal physiological function, spanning fat-soluble (A, D, E, K) and water-soluble (B-complex, C) classes.',
  tags: ['vitamins', 'micronutrients', 'biomolecules', 'cofactors'],
  molecules: [
    {
      id: 'retinol',
      name: 'Retinol',
      smiles: 'CC1=C(C(CCC1)(C)C)/C=C/C(\\C)=C/C=C/C(\\C)=C/CO',
      inchi: 'InChI=1S/C20H30O/c1-16(8-6-9-17(2)13-15-21)11-12-19-18(3)10-7-14-20(19,4)5/h6,8-9,11-13,21H,7,10,14-15H2,1-5H3/b6-9+,8-16+,11-12+,13-17+/m0/s1',
      tags: ['vitamin', 'fat-soluble', 'vitamin-a', 'carotenoid'],
      aliases: ['Vitamin A', 'Vitamin A1', 'axerophthol']
    },
    {
      id: 'thiamine',
      name: 'Thiamine',
      smiles: 'CC1=C(CCO)SC=[N+]1Cc1cnc(N)nc1C',
      inchi: 'InChI=1S/C12H17N4OS/c1-8-10(5-16(9)7-18-11(3-4-17)9-2)6-14-12(13)15-8/h6-7,17H,3-5,13H2,1-2H3/q+1',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b1', 'thiazolium', 'cofactor'],
      aliases: ['Vitamin B1', 'aneurine']
    },
    {
      id: 'riboflavin',
      name: 'Riboflavin',
      smiles: 'CC1=CC2=C(C=C1C)N(C3=NC(=O)NC(=O)C3=N2)CC(C(C(CO)O)O)O',
      inchi: 'InChI=1S/C17H20N4O6/c1-12-5-14-15(6-13(12)2)21(3-7(9(8(4-22)24)25)23)17-16(10(18-11(19-17)27)26)20-14/h5-9,18,22-25H,3-4H2,1-2H3',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b2', 'isoalloxazine', 'flavin', 'cofactor'],
      aliases: ['Vitamin B2', 'lactoflavin']
    },
    {
      id: 'niacin',
      name: 'Niacin',
      smiles: 'C1=CC(=CN=C1)C(=O)O',
      inchi: 'InChI=1S/C6H5NO2/c1-2-6(4-7-3-1)5(8)9/h1-4,9H',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b3', 'pyridine'],
      aliases: ['Vitamin B3', 'nicotinic acid', 'pyridine-3-carboxylic acid']
    },
    {
      id: 'nicotinamide',
      name: 'Nicotinamide',
      smiles: 'C1=CN=CC(=C1)C(=O)N',
      inchi: 'InChI=1S/C6H6N2O/c1-2-6(4-8-3-1)5(7)9/h1-4H,7H2',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b3', 'pyridine', 'cofactor'],
      aliases: ['Vitamin B3 (amide)', 'niacinamide', 'pyridine-3-carboxamide']
    },
    {
      id: 'pantothenic-acid',
      name: 'Pantothenic Acid',
      smiles: 'CC(C)(CO)C(C(=O)NCCC(=O)O)O',
      inchi: 'InChI=1S/C9H17NO5/c1-9(2,5-11)7(8(10-4-3-6(12)13)15)14/h7,10-11,13-14H,3-5H2,1-2H3',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b5', 'cofactor'],
      aliases: ['Vitamin B5', 'pantothenate']
    },
    {
      id: 'pyridoxine',
      name: 'Pyridoxine',
      smiles: 'CC1=NC=C(C(=C1O)CO)CO',
      inchi: 'InChI=1S/C8H11NO3/c1-5-8(7(3-11)6(2-10)4-9-5)12/h4,10-12H,2-3H2,1H3',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b6', 'pyridine', 'cofactor'],
      aliases: ['Vitamin B6', 'pyridoxol', 'adermine']
    },
    {
      id: 'biotin',
      name: 'Biotin',
      smiles: 'C1C2C(C(S1)CCCCC(=O)O)NC(=O)N2',
      inchi: 'InChI=1S/C10H16N2O3S/c1(2-4-8(13)14)3-7-9-6(5-16-7)11-10(12-9)15/h6-7,9,11-12,14H,1-5H2',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b7', 'cofactor', 'carboxylase'],
      aliases: ['Vitamin B7', 'Vitamin H', 'coenzyme R']
    },
    {
      id: 'folic-acid',
      name: 'Folic Acid',
      smiles: 'C1=CC(=CC=C1C(=O)NC(CCC(=O)O)C(=O)O)NCC2=CN=C3NC(=O)C(=N3)N=C2',
      inchi: 'InChI=1S/C19H18N6O6/c1(2-12(26)27)11(15(29)30)23-16(18(7)6-8-19(9-7)22-5-10(4)3-20-13-14(25-17(21-4)24-13)28)31/h3-4,6-9,11,22-23,25,27,30H,1-2,5H2',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b9', 'pterin', 'cofactor', 'folate'],
      aliases: ['Vitamin B9', 'folate', 'pteroylglutamic acid', 'vitamin Bc']
    },
    {
      id: 'ascorbic-acid',
      name: 'Ascorbic Acid',
      smiles: 'C(C(C1C(=C(C(=O)O1)O)O)O)O',
      inchi: 'InChI=1S/C6H8O6/c1(2(5-3(4(6(11)12-5)10)9)8)7/h2,5,7-10H,1H2',
      tags: ['vitamin', 'water-soluble', 'vitamin-c', 'antioxidant', 'lactone'],
      aliases: ['Vitamin C', 'L-ascorbic acid', 'ascorbate']
    },
    {
      id: 'cholecalciferol',
      name: 'Cholecalciferol',
      smiles: 'CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C',
      inchi: 'InChI=1S/C27H44O/c1-19(2)8-6-9-21(4)25-15-16-26-22(10-7-17-27(25,26)5)12-13-23(20)18-24(14-11-20-3)28/h12-13,19,21,24-26,28H,3,6-11,14-18H2,1-2,4-5H3',
      tags: ['vitamin', 'fat-soluble', 'vitamin-d', 'vitamin-d3', 'seco-steroid', 'hormone'],
      aliases: ['Vitamin D3', 'calciol', '(3β)-cholesta-5,7-dien-3-ol']
    },
    {
      id: 'alpha-tocopherol',
      name: 'Alpha-Tocopherol',
      smiles: 'CC1=C(C2=C(CCC(O2)(C)CCCC(C)CCCC(C)CCCC(C)C)C(=C1O)C)C',
      inchi: 'InChI=1S/C29H50O2/c1-20(2)12-9-13-21(3)14-10-15-22(4)16-11-18-29(8)19-17-26-25(7)27(23(5)24(6)28(26)31-29)30/h20-22,30H,9-19H2,1-8H3',
      tags: ['vitamin', 'fat-soluble', 'vitamin-e', 'tocopherol', 'antioxidant', 'chromanol'],
      aliases: ['Vitamin E', 'α-tocopherol']
    },
    {
      id: 'phylloquinone',
      name: 'Phylloquinone',
      smiles: 'CC1=C(C(=O)C2=CC=CC=C2C1=O)CC=C(C)CCCC(C)CCCC(C)CCCC(C)C',
      inchi: 'InChI=1S/C31H46O2/c1-22(2)10-7-11-23(3)12-8-13-24(4)14-9-15-25(5)16-17-27-26(6)28(30-20-18-19-21-31(30)29(27)33)32/h16,18-24H,7-15,17H2,1-6H3',
      tags: ['vitamin', 'fat-soluble', 'vitamin-k', 'vitamin-k1', 'naphthoquinone', 'coagulation'],
      aliases: ['Vitamin K1', 'phytomenadione', 'phytonadione']
    }
  ]
};

export default vitaminsCatalog;
