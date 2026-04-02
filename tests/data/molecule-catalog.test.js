import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moleculeCatalog, getMoleculeCatalogById, findMolecules } from '../../src/data/molecule-catalog.js';
import { parseSMILES, toInChI } from '../../src/io/index.js';

function atomCounts(smiles) {
  const mol = parseSMILES(smiles);
  const counts = {};
  for (const atom of mol.atoms.values()) {
    counts[atom.name] = (counts[atom.name] ?? 0) + 1;
  }
  return counts;
}

function unsaturatedPositionsFromAcid(smiles) {
  const mol = parseSMILES(smiles);
  const atoms = [...mol.atoms.values()];
  const bonds = [...mol.bonds.values()];
  const atomById = id => mol.atoms.get(id);
  const bondById = id => mol.bonds.get(id);
  const carbonyl = atoms.find(
    atom =>
      atom.name === 'C' &&
      atom.bonds.some(bondId => {
        const currentBond = bondById(bondId);
        const otherId = currentBond.atoms[0] === atom.id ? currentBond.atoms[1] : currentBond.atoms[0];
        return currentBond.properties.order === 2 && atomById(otherId)?.name === 'O';
      })
  );
  const alpha = carbonyl.bonds
    .map(bondById)
    .map(currentBond => atomById(currentBond.atoms[0] === carbonyl.id ? currentBond.atoms[1] : currentBond.atoms[0]))
    .find(atom => atom?.name === 'C');

  const chain = [alpha.id];
  let previousId = carbonyl.id;
  let currentId = alpha.id;
  for (;;) {
    const nextId = atomById(currentId)
      .bonds.map(bondById)
      .map(currentBond => (currentBond.atoms[0] === currentId ? currentBond.atoms[1] : currentBond.atoms[0]))
      .find(id => id !== previousId && atomById(id)?.name === 'C');
    if (!nextId) {
      break;
    }
    chain.push(nextId);
    previousId = currentId;
    currentId = nextId;
  }

  const positions = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const currentBond = bonds.find(bond => bond.atoms.includes(chain[i]) && bond.atoms.includes(chain[i + 1]));
    if (currentBond?.properties.order === 2) {
      positions.push(i + 2);
    }
  }
  return positions;
}

function ccDoubleBondStereoPairs(smiles) {
  const mol = parseSMILES(smiles);
  const atomById = id => mol.atoms.get(id);
  const bondById = id => mol.bonds.get(id);
  const pairs = [];

  for (const bond of mol.bonds.values()) {
    if (bond.properties.order !== 2) {
      continue;
    }
    const [leftId, rightId] = bond.atoms;
    const left = atomById(leftId);
    const right = atomById(rightId);
    if (left?.name !== 'C' || right?.name !== 'C') {
      continue;
    }

    const leftStereo =
      left.bonds
        .filter(id => id !== bond.id)
        .map(bondById)
        .find(currentBond => currentBond.properties.stereo)?.properties.stereo ?? null;
    const rightStereo =
      right.bonds
        .filter(id => id !== bond.id)
        .map(bondById)
        .find(currentBond => currentBond.properties.stereo)?.properties.stereo ?? null;

    pairs.push([leftStereo, rightStereo]);
  }

  return pairs;
}

describe('moleculeCatalog', () => {
  it('contains the expected collections', () => {
    assert.equal(Array.isArray(moleculeCatalog), true);
    assert.equal(moleculeCatalog.length >= 2, true);
    assert.equal(getMoleculeCatalogById('amino-acids')?.molecules.length, 20);
    assert.equal(getMoleculeCatalogById('polycyclic-aromatic-hydrocarbons')?.molecules.length, 11);
    assert.equal(getMoleculeCatalogById('fatty-acids')?.molecules.length, 10);
    assert.equal(getMoleculeCatalogById('steroids')?.molecules.length, 6);
    assert.equal(getMoleculeCatalogById('nucleobases')?.molecules.length, 6);
    assert.equal(getMoleculeCatalogById('terpenes-and-terpenoids')?.molecules.length, 6);
    assert.equal(getMoleculeCatalogById('psychoactive-compounds')?.molecules.length, 18);
  });

  it('keeps collection groups sorted alphabetically by display name', () => {
    assert.deepEqual(
      moleculeCatalog.map(collection => collection.name),
      [...moleculeCatalog.map(collection => collection.name)].sort((a, b) => a.localeCompare(b))
    );
  });

  it('requires id, name, smiles, and inchi for all molecules', () => {
    for (const collection of moleculeCatalog) {
      for (const molecule of collection.molecules) {
        assert.ok(molecule.id);
        assert.ok(molecule.name);
        assert.ok(molecule.smiles);
        assert.ok(molecule.inchi);
      }
    }
  });

  it('keeps smiles and inchi internally consistent', () => {
    for (const collection of moleculeCatalog) {
      for (const molecule of collection.molecules) {
        assert.equal(toInChI(parseSMILES(molecule.smiles)), molecule.inchi, `${collection.id}/${molecule.id}`);
      }
    }
  });
});

describe('getMoleculeCatalogById', () => {
  it('returns a collection by exact id', () => {
    const collection = getMoleculeCatalogById('amino-acids');
    assert.equal(collection?.name, 'Amino Acids');
  });

  it('normalizes surrounding whitespace and case', () => {
    const collection = getMoleculeCatalogById('  Polycyclic-Aromatic-Hydrocarbons  ');
    assert.equal(collection?.name, 'Polycyclic Aromatic Hydrocarbons');
  });

  it('returns null for an unknown collection id', () => {
    assert.equal(getMoleculeCatalogById('not-real'), null);
  });
});

describe('findMolecules', () => {
  it('finds molecules by name', () => {
    const results = findMolecules('alanine');
    assert.equal(
      results.some(result => result.molecule.id === 'alanine'),
      true
    );
    assert.equal(
      results.every(result => result.collectionId === 'amino-acids'),
      true
    );
  });

  it('finds molecules by alias', () => {
    const results = findMolecules('Trp');
    assert.equal(
      results.some(result => result.molecule.id === 'tryptophan'),
      true
    );
  });

  it('finds molecules by tag', () => {
    const results = findMolecules('branched-chain', {
      collectionId: 'amino-acids'
    });
    assert.deepEqual(results.map(result => result.molecule.id).sort(), ['isoleucine', 'leucine', 'valine']);
  });

  it('finds molecules by collection metadata', () => {
    const results = findMolecules('pah');
    assert.equal(results.length, 11);
  });

  it('supports exact matching', () => {
    const results = findMolecules('A', {
      exact: true,
      collectionId: 'amino-acids'
    });
    assert.deepEqual(results.map(result => result.molecule.id).sort(), ['alanine']);
  });

  it('supports result limits', () => {
    const results = findMolecules('aromatic', { limit: 2 });
    assert.equal(results.length, 2);
  });

  it('returns an empty array for an empty query', () => {
    assert.deepEqual(findMolecules('   '), []);
  });
});

describe('moleculeCatalog structural validation', () => {
  it('stores the correct fatty-acid chain lengths and unsaturation positions', () => {
    const expected = {
      'oleic-acid': { C: 18, positions: [9] },
      'linoleic-acid': { C: 18, positions: [9, 12] },
      'alpha-linolenic-acid': { C: 18, positions: [9, 12, 15] },
      'arachidonic-acid': { C: 20, positions: [5, 8, 11, 14] },
      'eicosapentaenoic-acid': { C: 20, positions: [5, 8, 11, 14, 17] },
      'docosahexaenoic-acid': { C: 22, positions: [4, 7, 10, 13, 16, 19] }
    };

    const collection = getMoleculeCatalogById('fatty-acids');
    for (const molecule of collection.molecules) {
      if (!expected[molecule.id]) {
        continue;
      }
      const counts = atomCounts(molecule.smiles);
      assert.equal(counts.C, expected[molecule.id].C, molecule.id);
      assert.deepEqual(unsaturatedPositionsFromAcid(molecule.smiles), expected[molecule.id].positions, molecule.id);
    }
  });

  it('keeps the curated polyunsaturated fatty-acid double bonds cis in runtime SMILES', () => {
    const expectedIds = [
      'linoleic-acid',
      'alpha-linolenic-acid',
      'arachidonic-acid',
      'eicosapentaenoic-acid',
      'docosahexaenoic-acid'
    ];

    const collection = getMoleculeCatalogById('fatty-acids');
    for (const molecule of collection.molecules) {
      if (!expectedIds.includes(molecule.id)) {
        continue;
      }
      for (const [leftStereo, rightStereo] of ccDoubleBondStereoPairs(molecule.smiles)) {
        assert.equal(leftStereo !== null && rightStereo !== null, true, `${molecule.id} should encode alkene stereo`);
        assert.notEqual(leftStereo, rightStereo, `${molecule.id} should remain cis (Z)`);
      }
    }
  });

  it('stores the corrected PAH and steroid formulas for curated entries', () => {
    const expected = {
      fluorene: { C: 13, H: 10 },
      acenaphthylene: { C: 12, H: 8 },
      acenaphthene: { C: 12, H: 10 },
      fluoranthene: { C: 16, H: 10 },
      'benzo-a-pyrene': { C: 20, H: 12 },
      perylene: { C: 20, H: 12 },
      coronene: { C: 24, H: 12 },
      cholestane: { C: 27, H: 48 },
      cholesterol: { C: 27, H: 46, O: 1 },
      testosterone: { C: 19, H: 28, O: 2 },
      estradiol: { C: 18, H: 24, O: 2 },
      progesterone: { C: 21, H: 30, O: 2 },
      cortisol: { C: 21, H: 30, O: 5 }
    };

    for (const collection of moleculeCatalog) {
      for (const molecule of collection.molecules) {
        if (!expected[molecule.id]) {
          continue;
        }
        assert.deepEqual(atomCounts(molecule.smiles), expected[molecule.id], molecule.id);
      }
    }
  });

  it('stores steroids without explicit stereochemistry', () => {
    const collection = getMoleculeCatalogById('steroids');
    for (const molecule of collection.molecules) {
      assert.equal(molecule.smiles.includes('@'), false, `${molecule.id} should not include atom stereochemistry`);
      assert.equal(
        /\/t|\/m\d|\/s\d/.test(molecule.inchi),
        false,
        `${molecule.id} should not include InChI stereolayers`
      );
    }
  });
});
