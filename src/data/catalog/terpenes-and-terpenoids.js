/** @module data/catalog/terpenes-and-terpenoids */

const terpenesAndTerpenoidsCatalog = {
  id: 'terpenes-and-terpenoids',
  name: 'Terpenes and Terpenoids',
  description: 'Representative terpenes and oxygenated terpenoids built from isoprene units.',
  tags: ['terpenes', 'terpenoids', 'natural-products', 'isoprenoids'],
  molecules: [
    {
      id: 'limonene',
      name: 'Limonene',
      smiles: 'CC1=CCC(CC1)C(=C)C',
      inchi: 'InChI=1S/C10H16/c1-8(2)10(7)6-4-9(3)5-7/h5,10H,1,4,6-7H2,2-3H3',
      tags: ['terpene', 'monoterpene', 'cyclic'],
      aliases: ['d-limonene', 'dipentene']
    },
    {
      id: 'myrcene',
      name: 'Myrcene',
      smiles: 'CC(=CCCC(=C)C=C)C',
      inchi: 'InChI=1S/C10H16/c1-5-10(4)8-6-7-9(2)3/h5,7H,1,4,6,8H2,2-3H3',
      tags: ['terpene', 'monoterpene', 'acyclic'],
      aliases: ['beta-myrcene', 'myrcene']
    },
    {
      id: 'menthol',
      name: 'Menthol',
      smiles: 'CC(C)C1CCC(C(C1)O)C',
      inchi: 'InChI=1S/C10H20O/c1-7(2)9(6)5-4-8(3)10(6)11/h7-11H,4-6H2,1-3H3',
      tags: ['terpenoid', 'monoterpenoid', 'alcohol'],
      aliases: ['menthol', 'mint alcohol']
    },
    {
      id: 'camphor',
      name: 'Camphor',
      smiles: 'CC1(C)C2CCC1(C(=O)C2)C',
      inchi: 'InChI=1S/C10H16O/c1-9(2)7(6)4-5-10(9,3)8(6)11/h7H,4-6H2,1-3H3',
      tags: ['terpenoid', 'monoterpenoid', 'ketone'],
      aliases: ['camphor', 'bornan-2-one']
    },
    {
      id: 'geraniol',
      name: 'Geraniol',
      smiles: 'CC(=CCC/C(=C/CO)/C)C',
      inchi: 'InChI=1S/C10H18O/c1-9(2)5-4-6-10(3)7-8-11/h5,7,11H,4,6,8H2,1-3H3/b7-10-/m0/s1',
      tags: ['terpenoid', 'monoterpenoid', 'alcohol'],
      aliases: ['geraniol', 'trans-3,7-dimethyl-2,6-octadien-1-ol']
    },
    {
      id: 'beta-pinene',
      name: 'Beta-Pinene',
      smiles: 'CC1(C2CCC(=C)C1C2)C',
      inchi: 'InChI=1S/C10H16/c1-7-4-5-8-6-9(7)10(8,2)3/h8-9H,1,4-6H2,2-3H3',
      tags: ['terpene', 'monoterpene', 'bicyclic'],
      aliases: ['β-pinene', 'beta-pinene']
    }
  ]
};

export default terpenesAndTerpenoidsCatalog;
