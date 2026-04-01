/** @module data/catalog/amino-acids */

const aminoAcidsCatalog = {
  id: 'amino-acids',
  name: 'Amino Acids',
  description: 'The 20 proteinogenic amino acids.',
  tags: ['amino-acids', 'proteinogenic', 'biomolecules'],
  molecules: [
    {
      id: 'alanine',
      name: 'Alanine',
      smiles: 'N[C@@H](C)C(=O)O',
      inchi: 'InChI=1S/C3H7NO2/c1-2(3(5)6)4/h2,6H,4H2,1H3/t2-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'aliphatic'],
      aliases: ['Ala', 'A', 'L-alanine']
    },
    {
      id: 'arginine',
      name: 'Arginine',
      smiles: 'N[C@@H](CCCNC(N)=N)C(=O)O',
      inchi:
        'InChI=1S/C6H14N4O2/c1(2-4(5(11)12)7)3-10-6(8)9/h4,9-10,12H,1-3,7-8H2/t4-/m0/s1',
      tags: ['proteinogenic', 'basic', 'polar'],
      aliases: ['Arg', 'R', 'L-arginine']
    },
    {
      id: 'asparagine',
      name: 'Asparagine',
      smiles: 'N[C@@H](CC(N)=O)C(=O)O',
      inchi: 'InChI=1S/C4H8N2O3/c1(2(4(8)9)5)3(6)7/h2,9H,1,5-6H2/t2-/m0/s1',
      tags: ['proteinogenic', 'polar', 'amide'],
      aliases: ['Asn', 'N', 'L-asparagine']
    },
    {
      id: 'aspartic-acid',
      name: 'Aspartic Acid',
      smiles: 'N[C@@H](CC(=O)O)C(=O)O',
      inchi: 'InChI=1S/C4H7NO4/c1(2(4(8)9)5)3(6)7/h2,7,9H,1,5H2/t2-/m0/s1',
      tags: ['proteinogenic', 'acidic', 'polar'],
      aliases: ['Asp', 'D', 'L-aspartic acid']
    },
    {
      id: 'cysteine',
      name: 'Cysteine',
      smiles: 'N[C@H](CS)C(=O)O',
      inchi: 'InChI=1S/C3H7NO2S/c1(2(3(5)6)4)7/h2,6-7H,1,4H2/t2-/m1/s1',
      tags: ['proteinogenic', 'polar', 'sulfur'],
      aliases: ['Cys', 'C', 'L-cysteine']
    },
    {
      id: 'glutamic-acid',
      name: 'Glutamic Acid',
      smiles: 'N[C@@H](CCC(=O)O)C(=O)O',
      inchi:
        'InChI=1S/C5H9NO4/c1(2-4(7)8)3(5(9)10)6/h3,8,10H,1-2,6H2/t3-/m0/s1',
      tags: ['proteinogenic', 'acidic', 'polar'],
      aliases: ['Glu', 'E', 'L-glutamic acid']
    },
    {
      id: 'glutamine',
      name: 'Glutamine',
      smiles: 'N[C@@H](CCC(N)=O)C(=O)O',
      inchi:
        'InChI=1S/C5H10N2O3/c1(2-4(7)8)3(5(9)10)6/h3,10H,1-2,6-7H2/t3-/m0/s1',
      tags: ['proteinogenic', 'polar', 'amide'],
      aliases: ['Gln', 'Q', 'L-glutamine']
    },
    {
      id: 'glycine',
      name: 'Glycine',
      smiles: 'NCC(=O)O',
      inchi: 'InChI=1S/C2H5NO2/c1(2(4)5)3/h5H,1,3H2',
      tags: ['proteinogenic', 'nonpolar', 'small'],
      aliases: ['Gly', 'G', 'glycine']
    },
    {
      id: 'histidine',
      name: 'Histidine',
      smiles: 'N[C@@H](CC1=CNC=N1)C(=O)O',
      inchi:
        'InChI=1S/C6H9N3O2/c1(4(5(10)11)7)6-2-8-3-9-6/h2-4,8,11H,1,7H2/t4-/m0/s1',
      tags: ['proteinogenic', 'basic', 'aromatic'],
      aliases: ['His', 'H', 'L-histidine']
    },
    {
      id: 'isoleucine',
      name: 'Isoleucine',
      smiles: 'N[C@@H]([C@H](CC)C)C(=O)O',
      inchi:
        'InChI=1S/C6H13NO2/c1-3-4(2)5(6(8)9)7/h4-5,9H,3,7H2,1-2H3/t4-,5-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'branched-chain'],
      aliases: ['Ile', 'I', 'L-isoleucine']
    },
    {
      id: 'leucine',
      name: 'Leucine',
      smiles: 'N[C@@H](CC(C)C)C(=O)O',
      inchi:
        'InChI=1S/C6H13NO2/c1-4(2)3-5(6(8)9)7/h4-5,9H,3,7H2,1-2H3/t5-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'branched-chain'],
      aliases: ['Leu', 'L', 'L-leucine']
    },
    {
      id: 'lysine',
      name: 'Lysine',
      smiles: 'N[C@@H](CCCCN)C(=O)O',
      inchi:
        'InChI=1S/C6H14N2O2/c1(2-4-7)3-5(6(9)10)8/h5,10H,1-4,7-8H2/t5-/m0/s1',
      tags: ['proteinogenic', 'basic', 'polar'],
      aliases: ['Lys', 'K', 'L-lysine']
    },
    {
      id: 'methionine',
      name: 'Methionine',
      smiles: 'N[C@@H](CCSC)C(=O)O',
      inchi:
        'InChI=1S/C5H11NO2S/c1-9-3-2-4(5(7)8)6/h4,8H,2-3,6H2,1H3/t4-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'sulfur'],
      aliases: ['Met', 'M', 'L-methionine']
    },
    {
      id: 'phenylalanine',
      name: 'Phenylalanine',
      smiles: 'N[C@@H](Cc1ccccc1)C(=O)O',
      inchi:
        'InChI=1S/C9H11NO2/c1(7(8(11)12)10)9(6)5-3-2-4-6/h2-7,12H,1,10H2/t7-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'aromatic'],
      aliases: ['Phe', 'F', 'L-phenylalanine']
    },
    {
      id: 'proline',
      name: 'Proline',
      smiles: 'O=C(O)[C@@H]1CCCN1',
      inchi: 'InChI=1S/C5H9NO2/c1-2-4(5(7)8)6-3-1/h4,6,8H,1-3H2/t4-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'cyclic'],
      aliases: ['Pro', 'P', 'L-proline']
    },
    {
      id: 'serine',
      name: 'Serine',
      smiles: 'N[C@@H](CO)C(=O)O',
      inchi: 'InChI=1S/C3H7NO3/c1(2(3(6)7)4)5/h2,5,7H,1,4H2/t2-/m0/s1',
      tags: ['proteinogenic', 'polar', 'hydroxyl'],
      aliases: ['Ser', 'S', 'L-serine']
    },
    {
      id: 'threonine',
      name: 'Threonine',
      smiles: 'N[C@@H]([C@H](O)C)C(=O)O',
      inchi: 'InChI=1S/C4H9NO3/c1-2(3(4(7)8)5)6/h2-3,6,8H,5H2,1H3/t2+,3-/m0/s1',
      tags: ['proteinogenic', 'polar', 'hydroxyl'],
      aliases: ['Thr', 'T', 'L-threonine']
    },
    {
      id: 'tryptophan',
      name: 'Tryptophan',
      smiles: 'N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O',
      inchi:
        'InChI=1S/C11H12N2O2/c1(7(8(14)15)12)9-6-13-11(10)5-3-2-4-10-9/h2-7,13,15H,1,12H2/t7-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'aromatic'],
      aliases: ['Trp', 'W', 'L-tryptophan']
    },
    {
      id: 'tyrosine',
      name: 'Tyrosine',
      smiles: 'N[C@@H](Cc1ccc(O)cc1)C(=O)O',
      inchi:
        'InChI=1S/C9H11NO3/c1(6(7(11)12)10)8(3)2-4-9(5-3)13/h2-6,12-13H,1,10H2/t6-/m0/s1',
      tags: ['proteinogenic', 'polar', 'aromatic'],
      aliases: ['Tyr', 'Y', 'L-tyrosine']
    },
    {
      id: 'valine',
      name: 'Valine',
      smiles: 'N[C@@H](C(C)C)C(=O)O',
      inchi: 'InChI=1S/C5H11NO2/c1-3(2)4(5(7)8)6/h3-4,8H,6H2,1-2H3/t4-/m0/s1',
      tags: ['proteinogenic', 'nonpolar', 'branched-chain'],
      aliases: ['Val', 'V', 'L-valine']
    }
  ]
};

export default aminoAcidsCatalog;
