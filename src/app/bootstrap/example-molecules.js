/** @module app/bootstrap/example-molecules */

export const exampleMolecules = [
  {
    name: 'ethanol',
    smiles: 'CCO',
    inchi: 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3'
  },
  {
    name: 'glucose',
    smiles: 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O',
    inchi: 'InChI=1S/C6H12O6/c1(2-3(4(5(6(11)12-2)10)9)8)7/h2-11H,1H2/t2-,3-,4+,5-/m1/s1'
  },
  {
    name: 'GHK-Cu',
    smiles: 'C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN',
    inchi: 'InChI=1S/C14H24N6O4/c15-4-2-1-3-10(14(23)24)20-13(22)11(19-12(21)6-16)5-9-7-17-8-18-9/h7-8,10-11H,1-6,15-16H2,(H,17,18)(H,19,21)(H,20,22)(H,23,24)/t10-,11?/m0/s1'
  },
  {
    name: 'aspirin',
    smiles: 'CC(=O)Oc1ccccc1C(=O)O',
    inchi: 'InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)'
  },
  {
    name: 'serotonin',
    smiles: 'C1=CC2=C(C=C1O)C(=CN2)CCN',
    inchi: 'InChI=1S/C10H12N2O/c11-4-3-7-6-12-10-2-1-8(13)5-9(7)10/h1-2,5-6,12-13H,3-4,11H2'
  },
  {
    name: 'dopamine',
    smiles: 'C1=CC(=C(C=C1CCN)O)O',
    inchi: 'InChI=1S/C8H11NO2/c9-4-3-6-1-2-7(10)8(11)5-6/h1-2,5,10-11H,3-4,9H2'
  },
  {
    name: 'anthracene',
    smiles: 'C1=CC2=CC3=CC=CC=C3C=C2C=C1',
    inchi: 'InChI=1S/C14H10/c1-2-6-12-10-14-8-4-3-7-13(14)9-11(12)5-1/h1-10H'
  },
  {
    name: 'LSD',
    smiles: 'CCN(CC)C(=O)C1CN(C2CC3=CNC4=CC=CC(=C34)C2=C1)C',
    inchi: 'InChI=1S/C20H25N3O/c1-4-23(5-2)20(24)14-9-16-15-7-6-8-17-19(15)13(11-21-17)10-18(16)22(3)12-14/h6-9,11,14,18H,4-5,10,12H2,1-3H3'
  }
];
