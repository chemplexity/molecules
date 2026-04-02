/** @module data/catalog/polycyclic-aromatic-hydrocarbons */

const polycyclicAromaticHydrocarbonsCatalog = {
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
};

export default polycyclicAromaticHydrocarbonsCatalog;
