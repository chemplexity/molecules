/** @module data/catalog/nucleobases */

const nucleobasesCatalog = {
  id: 'nucleobases',
  name: 'Nucleobases',
  description: 'Canonical purine and pyrimidine nucleobases found in DNA, RNA, and related metabolites.',
  tags: ['nucleobases', 'purines', 'pyrimidines', 'biomolecules'],
  molecules: [
    {
      id: 'adenine',
      name: 'Adenine',
      smiles: 'C1=NC2=NC=NC(=C2N1)N',
      inchi: 'InChI=1S/C5H5N5/c1-7-3-4(6)8-2-10-5(3)9-1/h1-2,7H,6H2',
      tags: ['nucleobase', 'purine', 'dna', 'rna'],
      aliases: ['Ade', 'A', '6-aminopurine']
    },
    {
      id: 'guanine',
      name: 'Guanine',
      smiles: 'O=C1C2=C(N=CN2)N=C(N)N1',
      inchi: 'InChI=1S/C5H5N5O/c1-9-4-2(7-3(6)8-5(4)10-1)11/h1,7,9H,6H2',
      tags: ['nucleobase', 'purine', 'dna', 'rna'],
      aliases: ['Gua', 'G', '2-aminohypoxanthine']
    },
    {
      id: 'cytosine',
      name: 'Cytosine',
      smiles: 'NC1=NC(=O)NC=C1',
      inchi: 'InChI=1S/C4H5N3O/c1-2-6-4(7-3(1)5)8/h1-2,6H,5H2',
      tags: ['nucleobase', 'pyrimidine', 'dna', 'rna'],
      aliases: ['Cyt', 'C', '4-aminopyrimidin-2-one']
    },
    {
      id: 'uracil',
      name: 'Uracil',
      smiles: 'O=C1NC=CC(=O)N1',
      inchi: 'InChI=1S/C4H4N2O2/c1-2-5-4(6-3(1)7)8/h1-2,5-6H',
      tags: ['nucleobase', 'pyrimidine', 'rna'],
      aliases: ['Ura', 'U']
    },
    {
      id: 'thymine',
      name: 'Thymine',
      smiles: 'O=C1NC=C(C)C(=O)N1',
      inchi: 'InChI=1S/C5H6N2O2/c1-3-2-6-5(7-4(3)8)9/h2,6-7H,1H3',
      tags: ['nucleobase', 'pyrimidine', 'dna'],
      aliases: ['Thy', 'T', '5-methyluracil']
    },
    {
      id: 'hypoxanthine',
      name: 'Hypoxanthine',
      smiles: 'O=c1nc[nH]c2[nH]cnc12',
      inchi: 'InChI=1S/C5H4N4O/c1-6-3-4(7-1)8-2-9-5(3)10/h1-2,7-8H',
      tags: ['nucleobase', 'purine', 'metabolite'],
      aliases: ['inosine base', '6-hydroxypurine']
    }
  ]
};

export default nucleobasesCatalog;
