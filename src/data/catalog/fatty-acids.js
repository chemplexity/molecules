/** @module data/catalog/fatty-acids */

const fattyAcidsCatalog = {
  id: 'fatty-acids',
  name: 'Fatty Acids',
  description: 'Common saturated and unsaturated fatty acids.',
  tags: ['fatty-acids', 'lipids', 'carboxylic-acids'],
  molecules: [
    {
      id: 'lauric-acid',
      name: 'Lauric Acid',
      smiles: 'CCCCCCCCCCCC(=O)O',
      inchi:
        'InChI=1S/C12H24O2/c1-2-3-4-5-6-7-8-9-10-11-12(13)14/h14H,2-11H2,1H3',
      tags: ['fatty-acid', 'saturated', 'medium-chain'],
      aliases: ['dodecanoic acid', 'C12:0']
    },
    {
      id: 'myristic-acid',
      name: 'Myristic Acid',
      smiles: 'CCCCCCCCCCCCCC(=O)O',
      inchi:
        'InChI=1S/C14H28O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14(15)16/h16H,2-13H2,1H3',
      tags: ['fatty-acid', 'saturated', 'long-chain'],
      aliases: ['tetradecanoic acid', 'C14:0']
    },
    {
      id: 'palmitic-acid',
      name: 'Palmitic Acid',
      smiles: 'CCCCCCCCCCCCCCCC(=O)O',
      inchi:
        'InChI=1S/C16H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16(17)18/h18H,2-15H2,1H3',
      tags: ['fatty-acid', 'saturated', 'long-chain'],
      aliases: ['hexadecanoic acid', 'C16:0']
    },
    {
      id: 'stearic-acid',
      name: 'Stearic Acid',
      smiles: 'CCCCCCCCCCCCCCCCCC(=O)O',
      inchi:
        'InChI=1S/C18H36O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h20H,2-17H2,1H3',
      tags: ['fatty-acid', 'saturated', 'long-chain'],
      aliases: ['octadecanoic acid', 'C18:0']
    },
    {
      id: 'oleic-acid',
      name: 'Oleic Acid',
      smiles: 'CCCCCCCC/C=C\\CCCCCCCC(=O)O',
      inchi:
        'InChI=1S/C18H34O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h9-10,20H,2-8,11-17H2,1H3/b9-10-/m0/s1',
      tags: ['fatty-acid', 'monounsaturated', 'omega-9'],
      aliases: ['cis-9-octadecenoic acid', 'C18:1']
    },
    {
      id: 'linoleic-acid',
      name: 'Linoleic Acid',
      smiles: 'CCCCC/C=C\\C/C=C\\CCCCCCCC(=O)O',
      inchi:
        'InChI=1S/C18H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h6-7,9-10,20H,2-5,8,11-17H2,1H3/b6-7-,9-10-/m0/s1',
      tags: ['fatty-acid', 'polyunsaturated', 'omega-6'],
      aliases: ['cis,cis-9,12-octadecadienoic acid', 'C18:2']
    },
    {
      id: 'alpha-linolenic-acid',
      name: 'Alpha-Linolenic Acid',
      smiles: 'CC/C=C\\C/C=C\\C/C=C\\CCCCCCCC(=O)O',
      inchi:
        'InChI=1S/C18H30O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18(19)20/h3-4,6-7,9-10,20H,2,5,8,11-17H2,1H3/b3-4-,6-7-,9-10-/m0/s1',
      tags: ['fatty-acid', 'polyunsaturated', 'omega-3'],
      aliases: ['ALA', 'cis,cis,cis-9,12,15-octadecatrienoic acid', 'C18:3']
    },
    {
      id: 'arachidonic-acid',
      name: 'Arachidonic Acid',
      smiles: 'CCCCC\\C=C/C\\C=C/C\\C=C/C\\C=C/CCCC(=O)O',
      inchi:
        'InChI=1S/C20H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20(21)22/h6-7,9-10,12-13,15-16,22H,2-5,8,11,14,17-19H2,1H3/b6-7-,9-10-,12-13-,15-16-/m0/s1',
      tags: ['fatty-acid', 'polyunsaturated', 'omega-6'],
      aliases: ['AA', 'all-cis-5,8,11,14-eicosatetraenoic acid', 'C20:4']
    },
    {
      id: 'eicosapentaenoic-acid',
      name: 'Eicosapentaenoic Acid',
      smiles: 'CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCCC(=O)O',
      inchi:
        'InChI=1S/C20H30O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20(21)22/h3-4,6-7,9-10,12-13,15-16,22H,2,5,8,11,14,17-19H2,1H3/b3-4-,6-7-,9-10-,12-13-,15-16-/m0/s1',
      tags: ['fatty-acid', 'polyunsaturated', 'omega-3'],
      aliases: ['EPA', 'icosapentaenoic acid', 'C20:5']
    },
    {
      id: 'docosahexaenoic-acid',
      name: 'Docosahexaenoic Acid',
      smiles: 'CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCC(=O)O',
      inchi:
        'InChI=1S/C22H32O2/c1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18-19-20-21-22(23)24/h3-4,6-7,9-10,12-13,15-16,18-19,24H,2,5,8,11,14,17,20-21H2,1H3/b3-4-,6-7-,9-10-,12-13-,15-16-,18-19-/m0/s1',
      tags: ['fatty-acid', 'polyunsaturated', 'omega-3'],
      aliases: ['DHA', 'docosahexaenoic acid', 'C22:6']
    }
  ]
};

export default fattyAcidsCatalog;
