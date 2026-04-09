/** @module data/catalog/vitamins */

const vitaminsCatalog = {
  id: 'vitamins',
  name: 'Vitamins',
  description: 'Essential organic micronutrients required in small amounts for normal physiological function, spanning fat-soluble (A, D, E, K) and water-soluble (B-complex, C) classes.',
  tags: ['vitamins', 'micronutrients', 'biomolecules', 'cofactors'],
  molecules: [
    {
      id: 'retinol',
      name: 'Retinol',
      smiles: 'CC1=C(C(CCC1)(C)C)/C=C/C(\\C)=C/C=C/C(\\C)=C/CO',
      inchi: 'InChI=1S/C20H30O/c1-16(8-6-9-17(2)13-15-21)11-12-19-18(3)10-7-14-20(19,4)5/h6,8-9,11-13,21H,7,10,14-15H2,1-5H3/b9-6+,12-11+,16-8+,17-13+',
      tags: ['vitamin', 'fat-soluble', 'vitamin-a', 'carotenoid'],
      aliases: ['Vitamin A', 'Vitamin A1', 'axerophthol']
    },
    {
      id: 'thiamine',
      name: 'Thiamine',
      smiles: 'CC1=C(SC=[N+]1CC2=CN=C(N=C2N)C)CCO',
      inchi: 'InChI=1S/C12H17N4OS/c1-8-11(3-4-17)18-7-16(8)6-10-5-14-9(2)15-12(10)13/h5,7,17H,3-4,6H2,1-2H3,(H2,13,14,15)/q+1',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b1', 'thiazolium', 'cofactor'],
      aliases: ['Vitamin B1', 'aneurine']
    },
    {
      id: 'riboflavin',
      name: 'Riboflavin',
      smiles: 'CC1=CC2=C(C=C1C)N(C3=NC(=O)NC(=O)C3=N2)CC(C(C(CO)O)O)O',
      inchi: 'InChI=1S/C17H20N4O6/c1-7-3-9-10(4-8(7)2)21(5-11(23)14(25)12(24)6-22)15-13(18-9)16(26)20-17(27)19-15/h3-4,11-12,14,22-25H,5-6H2,1-2H3,(H,20,26,27)/t11-,12+,14-/m0/s1',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b2', 'isoalloxazine', 'flavin', 'cofactor'],
      aliases: ['Vitamin B2', 'lactoflavin']
    },
    {
      id: 'niacin',
      name: 'Niacin',
      smiles: 'C1=CC(=CN=C1)C(=O)O',
      inchi: 'InChI=1S/C6H5NO2/c8-6(9)5-2-1-3-7-4-5/h1-4H,(H,8,9)',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b3', 'pyridine'],
      aliases: ['Vitamin B3', 'nicotinic acid', 'pyridine-3-carboxylic acid']
    },
    {
      id: 'nicotinamide',
      name: 'Nicotinamide',
      smiles: 'C1=CC(=CN=C1)C(=O)N',
      inchi: 'InChI=1S/C6H6N2O/c7-6(9)5-2-1-3-8-4-5/h1-4H,(H2,7,9)',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b3', 'pyridine', 'cofactor'],
      aliases: ['Vitamin B3 (amide)', 'niacinamide', 'pyridine-3-carboxamide']
    },
    {
      id: 'pantothenic-acid',
      name: 'Pantothenic Acid',
      smiles: 'CC(C)(CO)C(C(=O)NCCC(=O)O)O',
      inchi: 'InChI=1S/C9H17NO5/c1-9(2,5-11)7(14)8(15)10-4-3-6(12)13/h7,11,14H,3-5H2,1-2H3,(H,10,15)(H,12,13)/t7-/m0/s1',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b5', 'cofactor'],
      aliases: ['Vitamin B5', 'pantothenate']
    },
    {
      id: 'pyridoxine',
      name: 'Pyridoxine',
      smiles: 'CC1=NC=C(C(=C1O)CO)CO',
      inchi: 'InChI=1S/C8H11NO3/c1-5-8(12)7(4-11)6(3-10)2-9-5/h2,10-12H,3-4H2,1H3',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b6', 'pyridine', 'cofactor'],
      aliases: ['Vitamin B6', 'pyridoxol', 'adermine']
    },
    {
      id: 'biotin',
      name: 'Biotin',
      smiles: 'C1C2C(C(S1)CCCCC(=O)O)NC(=O)N2',
      inchi: 'InChI=1S/C10H16N2O3S/c13-8(14)4-2-1-3-7-9-6(5-16-7)11-10(15)12-9/h6-7,9H,1-5H2,(H,13,14)(H2,11,12,15)/t6-,7-,9-/m0/s1',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b7', 'cofactor', 'carboxylase'],
      aliases: ['Vitamin B7', 'Vitamin H', 'coenzyme R']
    },
    {
      id: 'folic-acid',
      name: 'Folic Acid',
      smiles: 'C1=CC(=CC=C1C(=O)NC(CCC(=O)O)C(=O)O)NCC2=CN=C3C(=N2)C(=O)NC(=N3)N',
      inchi: 'InChI=1S/C19H19N7O6/c20-19-25-15-14(17(30)26-19)23-11(8-22-15)7-21-10-3-1-9(2-4-10)16(29)24-12(18(31)32)5-6-13(27)28/h1-4,8,12,21H,5-7H2,(H,24,29)(H,27,28)(H,31,32)(H3,20,22,25,26,30)/t12-/m0/s1',
      tags: ['vitamin', 'water-soluble', 'vitamin-b', 'vitamin-b9', 'pterin', 'cofactor', 'folate'],
      aliases: ['Vitamin B9', 'folate', 'pteroylglutamic acid', 'vitamin Bc']
    },
    {
      id: 'ascorbic-acid',
      name: 'Ascorbic Acid',
      smiles: 'C(C(C1C(=C(C(=O)O1)O)O)O)O',
      inchi: 'InChI=1S/C6H8O6/c7-1-2(8)5-3(9)4(10)6(11)12-5/h2,5,7-10H,1H2/t2-,5+/m0/s1',
      tags: ['vitamin', 'water-soluble', 'vitamin-c', 'antioxidant', 'lactone'],
      aliases: ['Vitamin C', 'L-ascorbic acid', 'ascorbate']
    },
    {
      id: 'cholecalciferol',
      name: 'Cholecalciferol',
      smiles: 'CC(C)CCCC(C)C1CCC2C1(CCCC2=CC=C3CC(CCC3=C)O)C',
      inchi: 'InChI=1S/C27H44O/c1-19(2)8-6-9-21(4)25-15-16-26-22(10-7-17-27(25,26)5)12-13-23-18-24(28)14-11-20(23)3/h12-13,19,21,24-26,28H,3,6-11,14-18H2,1-2,4-5H3/b22-12+,23-13-/t21-,24+,25-,26+,27-/m1/s1',
      tags: ['vitamin', 'fat-soluble', 'vitamin-d', 'vitamin-d3', 'seco-steroid', 'hormone'],
      aliases: ['Vitamin D3', 'calciol', '(3β)-cholesta-5,7-dien-3-ol']
    },
    {
      id: 'alpha-tocopherol',
      name: 'Alpha-Tocopherol',
      smiles: 'CC1=C(C2=C(CCC(O2)(C)CCCC(C)CCCC(C)CCCC(C)C)C(=C1O)C)C',
      inchi: 'InChI=1S/C29H50O2/c1-20(2)12-9-13-21(3)14-10-15-22(4)16-11-18-29(8)19-17-26-25(7)27(30)23(5)24(6)28(26)31-29/h20-22,30H,9-19H2,1-8H3/t21-,22-,29-/m1/s1',
      tags: ['vitamin', 'fat-soluble', 'vitamin-e', 'tocopherol', 'antioxidant', 'chromanol'],
      aliases: ['Vitamin E', 'α-tocopherol']
    },
    {
      id: 'phylloquinone',
      name: 'Phylloquinone',
      smiles: 'CC1=C(C(=O)C2=CC=CC=C2C1=O)CC=C(C)CCCC(C)CCCC(C)CCCC(C)C',
      inchi: 'InChI=1S/C31H46O2/c1-22(2)12-9-13-23(3)14-10-15-24(4)16-11-17-25(5)20-21-27-26(6)30(32)28-18-7-8-19-29(28)31(27)33/h7-8,18-20,22-24H,9-17,21H2,1-6H3/b25-20+/t23-,24-/m1/s1',
      tags: ['vitamin', 'fat-soluble', 'vitamin-k', 'vitamin-k1', 'naphthoquinone', 'coagulation'],
      aliases: ['Vitamin K1', 'phytomenadione', 'phytonadione']
    }
  ]
};

export default vitaminsCatalog;
