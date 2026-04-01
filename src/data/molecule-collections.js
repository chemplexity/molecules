/** @module data/molecule-collections */

/**
 * Curated molecule collections.
 *
 * Each collection has:
 * - `id`: stable machine-readable identifier
 * - `name`: human-readable collection name
 * - `description`: short collection summary
 * - `tags`: collection-level categorization tags
 * - `molecules`: array of molecule entries
 *
 * Each molecule entry has:
 * - `id`: stable machine-readable identifier
 * - `name`: human-readable molecule name
 * - `smiles`: canonical-ish input structure
 * - `inchi`: InChI representation
 * - `tags`: molecule-level categorization tags
 * - `aliases`: common short names and symbols
 *
 * @type {Array<{
 *   id: string,
 *   name: string,
 *   description: string,
 *   tags: string[],
 *   molecules: Array<{
 *     id: string,
 *     name: string,
 *     smiles: string,
 *     inchi: string,
 *     tags: string[],
 *     aliases: string[]
 *   }>
 * }>}
 */
export const moleculeCollections = [
  {
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
        inchi: 'InChI=1S/C6H14N4O2/c1(2-4(5(11)12)7)3-10-6(8)9/h4,9-10,12H,1-3,7-8H2/t4-/m0/s1',
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
        inchi: 'InChI=1S/C5H9NO4/c1(2-4(7)8)3(5(9)10)6/h3,8,10H,1-2,6H2/t3-/m0/s1',
        tags: ['proteinogenic', 'acidic', 'polar'],
        aliases: ['Glu', 'E', 'L-glutamic acid']
      },
      {
        id: 'glutamine',
        name: 'Glutamine',
        smiles: 'N[C@@H](CCC(N)=O)C(=O)O',
        inchi: 'InChI=1S/C5H10N2O3/c1(2-4(7)8)3(5(9)10)6/h3,10H,1-2,6-7H2/t3-/m0/s1',
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
        inchi: 'InChI=1S/C6H9N3O2/c1(4(5(10)11)7)6-2-8-3-9-6/h2-4,8,11H,1,7H2/t4-/m0/s1',
        tags: ['proteinogenic', 'basic', 'aromatic'],
        aliases: ['His', 'H', 'L-histidine']
      },
      {
        id: 'isoleucine',
        name: 'Isoleucine',
        smiles: 'N[C@@H]([C@H](CC)C)C(=O)O',
        inchi: 'InChI=1S/C6H13NO2/c1-3-4(2)5(6(8)9)7/h4-5,9H,3,7H2,1-2H3/t4-,5-/m0/s1',
        tags: ['proteinogenic', 'nonpolar', 'branched-chain'],
        aliases: ['Ile', 'I', 'L-isoleucine']
      },
      {
        id: 'leucine',
        name: 'Leucine',
        smiles: 'N[C@@H](CC(C)C)C(=O)O',
        inchi: 'InChI=1S/C6H13NO2/c1-4(2)3-5(6(8)9)7/h4-5,9H,3,7H2,1-2H3/t5-/m0/s1',
        tags: ['proteinogenic', 'nonpolar', 'branched-chain'],
        aliases: ['Leu', 'L', 'L-leucine']
      },
      {
        id: 'lysine',
        name: 'Lysine',
        smiles: 'N[C@@H](CCCCN)C(=O)O',
        inchi: 'InChI=1S/C6H14N2O2/c1(2-4-7)3-5(6(9)10)8/h5,10H,1-4,7-8H2/t5-/m0/s1',
        tags: ['proteinogenic', 'basic', 'polar'],
        aliases: ['Lys', 'K', 'L-lysine']
      },
      {
        id: 'methionine',
        name: 'Methionine',
        smiles: 'N[C@@H](CCSC)C(=O)O',
        inchi: 'InChI=1S/C5H11NO2S/c1-9-3-2-4(5(7)8)6/h4,8H,2-3,6H2,1H3/t4-/m0/s1',
        tags: ['proteinogenic', 'nonpolar', 'sulfur'],
        aliases: ['Met', 'M', 'L-methionine']
      },
      {
        id: 'phenylalanine',
        name: 'Phenylalanine',
        smiles: 'N[C@@H](Cc1ccccc1)C(=O)O',
        inchi: 'InChI=1S/C9H11NO2/c1(7(8(11)12)10)9(6)5-3-2-4-6/h2-7,12H,1,10H2/t7-/m0/s1',
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
        inchi: 'InChI=1S/C11H12N2O2/c1(7(8(14)15)12)9-6-13-11(10)5-3-2-4-10-9/h2-7,13,15H,1,12H2/t7-/m0/s1',
        tags: ['proteinogenic', 'nonpolar', 'aromatic'],
        aliases: ['Trp', 'W', 'L-tryptophan']
      },
      {
        id: 'tyrosine',
        name: 'Tyrosine',
        smiles: 'N[C@@H](Cc1ccc(O)cc1)C(=O)O',
        inchi: 'InChI=1S/C9H11NO3/c1(6(7(11)12)10)8(3)2-4-9(5-3)13/h2-6,12-13H,1,10H2/t6-/m0/s1',
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
  },
  {
    id: 'polycyclic-aromatic-hydrocarbons',
    name: 'Polycyclic Aromatic Hydrocarbons',
    description: 'Common fused-ring polycyclic aromatic hydrocarbons.',
    tags: ['pah', 'polycyclic', 'aromatic-hydrocarbons'],
    molecules: [
      {
        id: 'naphthalene',
        name: 'Naphthalene',
        smiles: 'c1ccc2ccccc2c1',
        inchi: 'InChI=1S/C10H8/c1-2-6-10(9)8-4-3-7-9-5-1/h1-8H',
        tags: ['pah', 'aromatic', 'two-ring'],
        aliases: ['naphthalene']
      },
      {
        id: 'anthracene',
        name: 'Anthracene',
        smiles: 'c1ccc2cc3ccccc3cc2c1',
        inchi: 'InChI=1S/C14H10/c1-2-6-12(11)10-14(13)8-4-3-7-13-9-11-5-1/h1-10H',
        tags: ['pah', 'aromatic', 'three-ring'],
        aliases: ['anthracene']
      },
      {
        id: 'phenanthrene',
        name: 'Phenanthrene',
        smiles: 'c1ccc2c(c1)ccc1ccccc12',
        inchi: 'InChI=1S/C14H10/c1-3-7-13-11(5-1)9-10-12-6-2-4-8-14(12)13/h1-10H',
        tags: ['pah', 'aromatic', 'three-ring'],
        aliases: ['phenanthrene']
      },
      {
        id: 'fluorene',
        name: 'Fluorene',
        smiles: 'C1C2=CC=CC=C2C3=CC=CC=C31',
        inchi: 'InChI=1S/C13H10/c1-10-6-2-4-8-12(10)13(11)9-5-3-7-11-1/h2-9H,1H2',
        tags: ['pah', 'aromatic', 'three-ring'],
        aliases: ['fluorene']
      },
      {
        id: 'acenaphthylene',
        name: 'Acenaphthylene',
        smiles: 'C1=CC2=C3C(=C1)C=CC3=CC=C2',
        inchi: 'InChI=1S/C12H8/c1-2-10-6-4-8-11-7-3-5-9(1)12(10)11/h1-8H',
        tags: ['pah', 'aromatic', 'three-ring'],
        aliases: ['acenaphthylene']
      },
      {
        id: 'acenaphthene',
        name: 'Acenaphthene',
        smiles: 'C1CC2=CC=CC3=C2C1=CC=C3',
        inchi: 'InChI=1S/C12H10/c1-2-10-6-4-8-11-7-3-5-9(1)12(10)11/h3-8H,1-2H2',
        tags: ['pah', 'aromatic', 'three-ring'],
        aliases: ['acenaphthene']
      },
      {
        id: 'pyrene',
        name: 'Pyrene',
        smiles: 'c1cc2ccc3cccc4ccc(c1)c2c34',
        inchi: 'InChI=1S/C16H10/c1-3-11-7-9-13-5-2-6-14-10-8-12(4-1)15(11)16(13)14/h1-10H',
        tags: ['pah', 'aromatic', 'four-ring'],
        aliases: ['pyrene']
      },
      {
        id: 'fluoranthene',
        name: 'Fluoranthene',
        smiles: 'C1=CC=C2C(=C1)C1=CC=CC3=CC=CC2=C13',
        inchi: 'InChI=1S/C16H10/c1-2-8-13-12(7-1)14-9-3-5-11-6-4-10-15(13)16(11)14/h1-10H',
        tags: ['pah', 'aromatic', 'four-ring'],
        aliases: ['fluoranthene']
      },
      {
        id: 'benzo-a-pyrene',
        name: 'Benzo[a]pyrene',
        smiles: 'C1=CC=C2C(=C1)C=C1C=CC3=CC=CC4=CC=C2C1=C34',
        inchi: 'InChI=1S/C20H12/c1-2-7-17-15(4-1)12-16-9-8-13-5-3-6-14-10-11-18(17)20(16)19(13)14/h1-12H',
        tags: ['pah', 'aromatic', 'five-ring'],
        aliases: ['benzo[a]pyrene', 'BaP']
      },
      {
        id: 'perylene',
        name: 'Perylene',
        smiles: 'C1=CC2=C3C(=C1)C4=CC=CC5=C4C(=CC=C5)C3=CC=C2',
        inchi: 'InChI=1S/C20H12/c1-5-13-6-2-11-17-18-12-4-8-14-7-3-10-16(15(9-1)19(13)17)20(14)18/h1-12H',
        tags: ['pah', 'aromatic', 'five-ring'],
        aliases: ['perylene']
      },
      {
        id: 'coronene',
        name: 'Coronene',
        smiles: 'C1=CC2=C3C4=C1C=CC5=C4C6=C(C=C5)C=CC7=C6C3=C(C=C2)C=C7',
        inchi: 'InChI=1S/C24H12/c1-2-14-5-6-16-9-11-18-12-10-17-8-7-15-4-3-13(1)19-20(14)22(16)24(18)23(17)21(15)19/h1-12H',
        tags: ['pah', 'aromatic', 'seven-ring'],
        aliases: ['coronene']
      }
    ]
  },
  {
    id: 'fatty-acids',
    name: 'Fatty Acids',
    description: 'Common saturated and unsaturated fatty acids.',
    tags: ['fatty-acids', 'lipids', 'carboxylic-acids'],
    molecules: [
      {
        id: 'lauric-acid',
        name: 'Lauric Acid',
        smiles: 'CCCCCCCCCCCC(=O)O',
        inchi: 'InChI=1S/C12H24O2/c1-2-3-4-5-6-7-8-9-10-11-12(13)14/h14H,2-11H2,1H3',
        tags: ['fatty-acid', 'saturated', 'medium-chain'],
        aliases: ['dodecanoic acid', 'C12:0']
      },
      {
        id: 'myristic-acid',
        name: 'Myristic Acid',
        smiles: 'CCCCCCCCCCCCCC(=O)O',
        inchi: 'InChI=1S/C14H28O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14(15)16/h16H,2-13H2,1H3',
        tags: ['fatty-acid', 'saturated', 'long-chain'],
        aliases: ['tetradecanoic acid', 'C14:0']
      },
      {
        id: 'palmitic-acid',
        name: 'Palmitic Acid',
        smiles: 'CCCCCCCCCCCCCCCC(=O)O',
        inchi: 'InChI=1S/C16H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16(17)18/h18H,2-15H2,1H3',
        tags: ['fatty-acid', 'saturated', 'long-chain'],
        aliases: ['hexadecanoic acid', 'C16:0']
      },
      {
        id: 'stearic-acid',
        name: 'Stearic Acid',
        smiles: 'CCCCCCCCCCCCCCCCCC(=O)O',
        inchi: 'InChI=1S/C18H36O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h20H,2-17H2,1H3',
        tags: ['fatty-acid', 'saturated', 'long-chain'],
        aliases: ['octadecanoic acid', 'C18:0']
      },
      {
        id: 'oleic-acid',
        name: 'Oleic Acid',
        smiles: 'CCCCCCCC/C=C\\CCCCCCCC(=O)O',
        inchi: 'InChI=1S/C18H34O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h9-10,20H,2-8,11-17H2,1H3/b9-10-/m0/s1',
        tags: ['fatty-acid', 'monounsaturated', 'omega-9'],
        aliases: ['cis-9-octadecenoic acid', 'C18:1']
      },
      {
        id: 'linoleic-acid',
        name: 'Linoleic Acid',
        smiles: 'CCCCC/C=C\\C/C=C\\CCCCCCCC(=O)O',
        inchi: 'InChI=1S/C18H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h6-7,9-10,20H,2-5,8,11-17H2,1H3/b6-7-,9-10-/m0/s1',
        tags: ['fatty-acid', 'polyunsaturated', 'omega-6'],
        aliases: ['cis,cis-9,12-octadecadienoic acid', 'C18:2']
      },
      {
        id: 'alpha-linolenic-acid',
        name: 'Alpha-Linolenic Acid',
        smiles: 'CC/C=C\\C/C=C\\C/C=C\\CCCCCCCC(=O)O',
        inchi: 'InChI=1S/C18H30O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h3-4,6-7,9-10,20H,2,5,8,11-17H2,1H3/b3-4-,6-7-,9-10-/m0/s1',
        tags: ['fatty-acid', 'polyunsaturated', 'omega-3'],
        aliases: ['ALA', 'cis,cis,cis-9,12,15-octadecatrienoic acid', 'C18:3']
      },
      {
        id: 'arachidonic-acid',
        name: 'Arachidonic Acid',
        smiles: 'CCCCC\\C=C/C\\C=C/C\\C=C/C\\C=C/CCCC(=O)O',
        inchi: 'InChI=1S/C20H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20(21)22/h6-7,9-10,12-13,15-16,22H,2-5,8,11,14,17-19H2,1H3/b6-7-,9-10-,12-13-,15-16-/m0/s1',
        tags: ['fatty-acid', 'polyunsaturated', 'omega-6'],
        aliases: ['AA', 'all-cis-5,8,11,14-eicosatetraenoic acid', 'C20:4']
      },
      {
        id: 'eicosapentaenoic-acid',
        name: 'Eicosapentaenoic Acid',
        smiles: 'CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCCC(=O)O',
        inchi: 'InChI=1S/C20H30O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20(21)22/h3-4,6-7,9-10,12-13,15-16,22H,2,5,8,11,14,17-19H2,1H3/b3-4-,6-7-,9-10-,12-13-,15-16-/m0/s1',
        tags: ['fatty-acid', 'polyunsaturated', 'omega-3'],
        aliases: ['EPA', 'icosapentaenoic acid', 'C20:5']
      },
      {
        id: 'docosahexaenoic-acid',
        name: 'Docosahexaenoic Acid',
        smiles: 'CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCC(=O)O',
        inchi: 'InChI=1S/C22H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20-21-22(23)24/h3-4,6-7,9-10,12-13,15-16,18-19,24H,2,5,8,11,14,17,20-21H2,1H3/b3-4-,6-7-,9-10-,12-13-,15-16-,18-19-/m0/s1',
        tags: ['fatty-acid', 'polyunsaturated', 'omega-3'],
        aliases: ['DHA', 'docosahexaenoic acid', 'C22:6']
      }
    ]
  },
  {
    id: 'steroids',
    name: 'Steroids',
    description: 'Common steroid hydrocarbons, hormones, and sterols.',
    tags: ['steroids', 'sterols', 'hormones', 'polycyclic'],
    molecules: [
      {
        id: 'cholestane',
        name: 'Cholestane',
        smiles: 'CC(C)CCCC(C)C1CCC2C3CCC4CCCCC4(C)C3CCC12C',
        inchi: 'InChI=1S/C27H48/c1-19(2)9-8-10-20(3)23-14-15-24-22-13-12-21-11-6-7-17-26(21,4)25(22)16-18-27(23,24)5/h19-25H,6-18H2,1-5H3',
        tags: ['steroid', 'hydrocarbon', 'sterane'],
        aliases: ['5alpha-cholestane', 'cholestane']
      },
      {
        id: 'cholesterol',
        name: 'Cholesterol',
        smiles: 'CC(C)CCCC(C)C3CCC4C2CC=C1CC(CCC1(C)C2CCC34C)O',
        inchi: 'InChI=1S/C27H46O/c1-18(2)7-6-8-19(3)23-11-12-24-22-10-9-20-17-21(13-15-26(20,4)25(22)14-16-27(23,24)5)28/h9,18-19,21-25,28H,6-8,10-17H2,1-5H3',
        tags: ['steroid', 'sterol', 'lipid'],
        aliases: ['cholesterol']
      },
      {
        id: 'testosterone',
        name: 'Testosterone',
        smiles: 'CC14CCC(=O)C=C1CCC3C2CCC(O)C2(C)CCC34',
        inchi: 'InChI=1S/C19H28O2/c1-18(12,16)9-7-13(11-12-3-4-14-15-5-6-17(19(15,2)10-8-16-14)21)20/h11,14-17,21H,3-10H2,1-2H3',
        tags: ['steroid', 'hormone', 'androgen'],
        aliases: ['testosterone']
      },
      {
        id: 'estradiol',
        name: 'Estradiol',
        smiles: 'CC34CCC2c1ccc(O)cc1CCC2C3CCC4O',
        inchi: 'InChI=1S/C18H24O2/c1-18(13,14)7-5-12-11(4-6-15-10-16(8-9-17(12)15)20)13-2-3-14-19/h8-14,19-20H,2-7H2,1H3',
        tags: ['steroid', 'hormone', 'estrogen'],
        aliases: ['17beta-estradiol', 'estradiol']
      },
      {
        id: 'progesterone',
        name: 'Progesterone',
        smiles: 'CC(C3CCC4C2CCC1=CC(CCC1(C)C2CCC34C)=O)=O',
        inchi: 'InChI=1S/C21H30O2/c1-13(17-6-7-18-16-5-4-14-12-15(8-10-20(14,2)19(16)9-11-21(17,18)3)23)22/h12,16-19H,4-11H2,1-3H3',
        tags: ['steroid', 'hormone', 'progestogen'],
        aliases: ['progesterone']
      },
      {
        id: 'cortisol',
        name: 'Cortisol',
        smiles: 'CC13C(=CC(CC1)=O)CCC4C2CCC(C(CO)=O)(C2(C)CC(C34)O)O',
        inchi: 'InChI=1S/C21H30O5/c1-19(12,18)7-5-13(9-12-3-4-14-15-6-8-21(17(11-22)25,20(15,2)10-16(18-14)24)26)23/h9,14-16,18,22,24,26H,3-8,10-11H2,1-2H3',
        tags: ['steroid', 'hormone', 'glucocorticoid'],
        aliases: ['hydrocortisone', 'cortisol']
      }
    ]
  }
];

function normalizeCollectionSearchValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Find a molecule collection by its stable collection id.
 *
 * @param {string} collectionId
 * @returns {object|null}
 */
export function getMoleculeCollectionById(collectionId) {
  const normalizedId = normalizeCollectionSearchValue(collectionId);
  if (!normalizedId) {
    return null;
  }
  return moleculeCollections.find(collection => collection.id === normalizedId) ?? null;
}

/**
 * Search molecule entries across all collections.
 *
 * Matches against molecule `id`, `name`, `aliases`, `tags`, `smiles`, `inchi`,
 * and the parent collection `id`, `name`, and `tags`.
 *
 * @param {string} query
 * @param {{
 *   collectionId?: string,
 *   exact?: boolean,
 *   limit?: number
 * }} [options]
 * @returns {Array<{
 *   collectionId: string,
 *   collectionName: string,
 *   molecule: {
 *     id: string,
 *     name: string,
 *     smiles: string,
 *     inchi: string,
 *     tags: string[],
 *     aliases: string[]
 *   }
 * }>}
 */
export function findMolecules(query, options = {}) {
  const normalizedQuery = normalizeCollectionSearchValue(query);
  if (!normalizedQuery) {
    return [];
  }

  const collectionFilter = options.collectionId
    ? normalizeCollectionSearchValue(options.collectionId)
    : '';
  const exact = options.exact === true;
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : Infinity;

  const results = [];
  for (const collection of moleculeCollections) {
    if (collectionFilter && collection.id !== collectionFilter) {
      continue;
    }

    const collectionFields = [collection.id, collection.name, ...(collection.tags ?? [])];
    for (const molecule of collection.molecules) {
      const haystack = [
        molecule.id,
        molecule.name,
        molecule.smiles,
        molecule.inchi,
        ...(molecule.tags ?? []),
        ...(molecule.aliases ?? []),
        ...collectionFields
      ].map(normalizeCollectionSearchValue);

      const matched = exact
        ? haystack.some(value => value === normalizedQuery)
        : haystack.some(value => value.includes(normalizedQuery));

      if (!matched) {
        continue;
      }
      results.push({
        collectionId: collection.id,
        collectionName: collection.name,
        molecule
      });
      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}

export default moleculeCollections;
