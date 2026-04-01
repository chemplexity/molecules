/** @module data/catalog/steroids */

const steroidsCatalog = {
  id: 'steroids',
  name: 'Steroids',
  description: 'Common steroid hydrocarbons, hormones, and sterols.',
  tags: ['steroids', 'sterols', 'hormones', 'polycyclic'],
  molecules: [
    {
      id: 'cholestane',
      name: 'Cholestane',
      smiles: 'CC(C)CCCC(C)C1CCC2C3CCC4CCCCC4(C)C3CCC12C',
      inchi:
        'InChI=1S/C27H48/c1-19(2)9-8-10-20(3)23-14-15-24-22-13-12-21-11-6-7-17-26(21,4)25(22)16-18-27(23,24)5/h19-25H,6-18H2,1-5H3',
      tags: ['steroid', 'hydrocarbon', 'sterane'],
      aliases: ['5alpha-cholestane', 'cholestane']
    },
    {
      id: 'cholesterol',
      name: 'Cholesterol',
      smiles: 'CC(C)CCCC(C)C3CCC4C2CC=C1CC(CCC1(C)C2CCC34C)O',
      inchi:
        'InChI=1S/C27H46O/c1-18(2)7-6-8-19(3)23-11-12-24-22-10-9-20-17-21(13-15-26(20,4)25(22)14-16-27(23,24)5)28/h9,18-19,21-25,28H,6-8,10-17H2,1-5H3',
      tags: ['steroid', 'sterol', 'lipid'],
      aliases: ['cholesterol']
    },
    {
      id: 'testosterone',
      name: 'Testosterone',
      smiles: 'CC14CCC(=O)C=C1CCC3C2CCC(O)C2(C)CCC34',
      inchi:
        'InChI=1S/C19H28O2/c1-18(12,16)9-7-13(11-12-3-4-14-15-5-6-17(19(15,2)10-8-16-14)21)20/h11,14-17,21H,3-10H2,1-2H3',
      tags: ['steroid', 'hormone', 'androgen'],
      aliases: ['testosterone']
    },
    {
      id: 'estradiol',
      name: 'Estradiol',
      smiles: 'CC34CCC2c1ccc(O)cc1CCC2C3CCC4O',
      inchi:
        'InChI=1S/C18H24O2/c1-18(13,14)7-5-12-11(4-6-15-10-16(8-9-17(12)15)20)13-2-3-14-19/h8-14,19-20H,2-7H2,1H3',
      tags: ['steroid', 'hormone', 'estrogen'],
      aliases: ['17beta-estradiol', 'estradiol']
    },
    {
      id: 'progesterone',
      name: 'Progesterone',
      smiles: 'CC(C3CCC4C2CCC1=CC(CCC1(C)C2CCC34C)=O)=O',
      inchi:
        'InChI=1S/C21H30O2/c1-13(17-6-7-18-16-5-4-14-12-15(8-10-20(14,2)19(16)9-11-21(17,18)3)23)22/h12,16-19H,4-11H2,1-3H3',
      tags: ['steroid', 'hormone', 'progestogen'],
      aliases: ['progesterone']
    },
    {
      id: 'cortisol',
      name: 'Cortisol',
      smiles: 'CC13C(=CC(CC1)=O)CCC4C2CCC(C(CO)=O)(C2(C)CC(C34)O)O',
      inchi:
        'InChI=1S/C21H30O5/c1-19(12,18)7-5-13(9-12-3-4-14-15-6-8-21(17(11-22)25,20(15,2)10-16(18-14)24)26)23/h9,14-16,18,22,24,26H,3-8,10-11H2,1-2H3',
      tags: ['steroid', 'hormone', 'glucocorticoid'],
      aliases: ['hydrocortisone', 'cortisol']
    }
  ]
};

export default steroidsCatalog;
