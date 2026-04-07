import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySMIRKS, parseSMILES, parseSMIRKS, toSMILES } from '../../src/index.js';

function sortDotSmiles(smiles) {
  return smiles.split('.').sort().join('.');
}

describe('parseSMIRKS', () => {
  it('parses mapped reactant and product graphs', () => {
    const transform = parseSMIRKS('[C:1][O:2]>>[C:1]=[O:2]');
    assert.equal(transform.reactant.atoms.size, 2);
    assert.equal(transform.product.atoms.size, 2);
    assert.equal(transform.reactantMaps.size, 2);
    assert.equal(transform.productMaps.size, 2);
  });

  it('rejects product maps that are absent from the reactant', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>[C:1][O:2]'), /product atom map :2 is not present in the reactant/);
  });

  it('rejects disconnected product fragments without a shared mapped atom', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>[C:1].Cl'), /does not support disconnected product fragments without a shared mapped atom/);
  });

  it('allows disconnected product fragments when each component retains a shared mapped atom', () => {
    const transform = parseSMIRKS('[C:1][O:2]>>[C:1].[O:2]');
    const components = transform.product.getComponents();
    assert.equal(components.length, 2);
    assert.ok(components.every(component => [...component.atoms.values()].some(atom => atom.getAtomMap() != null)));
  });

  it('rejects product templates ending with a dangling bond token', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>[C:1]='), /product template cannot end with a bond token/);
  });

  it('parses product chirality primitives and resolves them to stored chirality', () => {
    const transform = parseSMIRKS('[F:1][C:2]([Cl:3])[Br:4]>>[F:1][C@@H:2]([Cl:3])[Br:4]');
    const templateCenter = [...transform.product.atoms.values()].find(atom => atom.name === 'C');
    const reference = parseSMILES('F[C@@H](Cl)Br');
    const referenceCenter = [...reference.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    assert.equal(templateCenter.properties.reaction.template.chiralitySpecified, true);
    assert.equal(templateCenter.getChirality(), referenceCenter.getChirality());
  });

  it('parses explicit product bond stereo tokens', () => {
    const transform = parseSMIRKS('[F:1][C:2]=[C:3][F:4]>>[F:1]/[C:2]=[C:3]/[F:4]');
    const stereoBonds = [...transform.product.bonds.values()].filter(bond => bond.getStereo() !== null);
    assert.equal(stereoBonds.length, 2);
    assert.ok(stereoBonds.every(bond => bond.getStereo() === '/'));
  });

  it('rejects duplicate product chirality primitives', () => {
    assert.throws(() => parseSMIRKS('[F:1][C:2]([Cl:3])[Br:4]>>[F:1][C@H@@:2]([Cl:3])[Br:4]'), /duplicate chirality primitive in product atom/);
  });

  it('rejects chiral product atoms with more than one bracket hydrogen', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>[C@@H2:1]'), /chiral product atom '\[C\]' cannot specify H2/);
  });

  it('parses explicit product hydrogen counts, including H0', () => {
    const transform = parseSMIRKS('[C:1]>>[CH3:1]');
    const atom = transform.product.atoms.get('p0');
    assert.equal(atom.properties.reaction.template.hydrogenCountSpecified, true);
    assert.equal(atom.properties.reaction.template.hydrogenCount, 3);

    const zeroTransform = parseSMIRKS('[N:1]>>[NH0:1]');
    const zeroAtom = zeroTransform.product.atoms.get('p0');
    assert.equal(zeroAtom.properties.reaction.template.hydrogenCountSpecified, true);
    assert.equal(zeroAtom.properties.reaction.template.hydrogenCount, 0);
  });

  it('rejects duplicate explicit product hydrogen counts', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>[CH2H:1]'), /duplicate hydrogen count in product atom/);
  });

  it('rejects malformed disconnected product syntax', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>.C'), /unexpected '\.' at pos 0/);
    assert.throws(() => parseSMIRKS('[C:1]>>[C:1].'), /product template cannot end with a disconnected-component separator/);
  });

  it('rejects unclosed product ring closures', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>C1CC'), /unclosed ring closure in product template/);
  });

  it('rejects unsupported product bond tokens', () => {
    assert.throws(() => parseSMIRKS('[C:1]>>C~C'), /unsupported product bond token '~'/);
  });
});

describe('applySMIRKS', () => {
  it('applies a mapped bond-order change', () => {
    const product = applySMIRKS(parseSMILES('CO'), '[C:1][O:2]>>[C:1]=[O:2]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'C=O');
  });

  it('deletes an unmapped reactant atom that is absent from the product', () => {
    const product = applySMIRKS(parseSMILES('CCl'), '[C:1][Cl]>>[C:1]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'C');
  });

  it('creates a new product atom bonded to a mapped atom', () => {
    const product = applySMIRKS(parseSMILES('C'), '[C:1]>>[C:1]Cl');
    assert.ok(product);
    assert.equal(product.getFormula().Cl, 1);
  });

  it('joins disconnected reactant components already present in one molecule', () => {
    const product = applySMIRKS(parseSMILES('C.O'), '[C:1].[O:2]>>[C:1][O:2]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'CO');
  });

  it('removes a bond between kept mapped atoms when the product splits them into components', () => {
    const product = applySMIRKS(parseSMILES('CO'), '[C:1][O:2]>>[C:1].[O:2]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'C.O');
    assert.equal(product.getComponents().length, 2);
  });

  it('creates a ring-closure bond between kept mapped atoms', () => {
    const product = applySMIRKS(parseSMILES('CCC'), '[C:1][C:2][C:3]>>[C:1]1[C:2][C:3]1');
    assert.ok(product);
    assert.equal(toSMILES(product), 'C1CC1');
  });

  it('returns null when no reactant match is found', () => {
    const product = applySMIRKS(parseSMILES('N'), '[C:1]>>[C:1]Cl');
    assert.equal(product, null);
  });

  it('preserves mapped atom charge when the product does not specify one', () => {
    const product = applySMIRKS(parseSMILES('[CH3+]'), '[C+:1]>>[C:1]');
    assert.ok(product);
    const carbon = [...product.atoms.values()].find(atom => atom.name === 'C');
    assert.equal(carbon.getCharge(), 1);
    assert.equal(toSMILES(product), '[CH3+]');
  });

  it('preserves mapped atom hydrogen count when the product does not specify one', () => {
    const product = applySMIRKS(parseSMILES('[NH4+]'), '[N+:1]>>[N+:1]');
    assert.ok(product);
    assert.equal(toSMILES(product), '[NH4+]');
  });

  it('overwrites mapped atom charge when the product specifies one explicitly', () => {
    const product = applySMIRKS(parseSMILES('[CH3+]'), '[C+:1]>>[C+0:1]');
    assert.ok(product);
    const carbon = [...product.atoms.values()].find(atom => atom.name === 'C');
    assert.equal(carbon.getCharge(), 0);
    assert.equal(toSMILES(product), 'C');
  });

  it('sets mapped atom hydrogen count explicitly when the product specifies one', () => {
    const product = applySMIRKS(parseSMILES('C'), '[C:1]>>[CH3:1]');
    assert.ok(product);
    assert.equal(toSMILES(product), '[CH3]');
  });

  it('supports explicit H0 in the product template', () => {
    const product = applySMIRKS(parseSMILES('[NH4+]'), '[N+:1]>>[NH3+:1]');
    assert.ok(product);
    assert.equal(toSMILES(product), '[NH3+]');

    const dehydrogenated = applySMIRKS(parseSMILES('[NH4+]'), '[N+:1]>>[NH0+:1]');
    assert.ok(dehydrogenated);
    assert.equal(toSMILES(dehydrogenated), '[N+]');
  });

  it('applies explicit hydrogen counts to newly created product atoms', () => {
    const product = applySMIRKS(parseSMILES('C'), '[C:1]>>[C:1][OH2+]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'C[OH2+]');
    const oxygen = [...product.atoms.values()].find(atom => atom.name === 'O');
    assert.ok(oxygen);
    assert.equal(oxygen.getCharge(), 1);
    assert.equal(oxygen.getHydrogenNeighbors(product).length, 2);
  });

  it('preserves chirality when the transform does not edit local topology', () => {
    const source = parseSMILES('F[C@H](Cl)Br');
    const sourceCenter = [...source.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    const product = applySMIRKS(source, '[C:1]>>[C:1]');
    assert.ok(product);
    const productCenter = [...product.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    assert.equal(sourceCenter.getChirality(), 'R');
    assert.equal(productCenter.getChirality(), sourceCenter.getChirality());
    assert.equal(toSMILES(product), 'F[C@H](Cl)Br');
  });

  it('applies explicit product chirality to an achiral matched center', () => {
    const product = applySMIRKS(parseSMILES('FC(Cl)Br'), '[F:1][C:2]([Cl:3])[Br:4]>>[F:1][C@@H:2]([Cl:3])[Br:4]');
    assert.ok(product);
    const productCenter = [...product.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    const reference = parseSMILES('F[C@@H](Cl)Br');
    const referenceCenter = [...reference.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    assert.equal(productCenter.getChirality(), referenceCenter.getChirality());
    assert.equal(toSMILES(product), 'F[C@@H](Cl)Br');
  });

  it('applies explicit product chirality to a newly created atom', () => {
    const product = applySMIRKS(parseSMILES('F'), '[F:1]>>[F:1][C@@H](Cl)Br');
    assert.ok(product);
    const productCenter = [...product.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    const reference = parseSMILES('F[C@@H](Cl)Br');
    const referenceCenter = [...reference.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    assert.equal(productCenter.getChirality(), referenceCenter.getChirality());
    assert.equal(toSMILES(product), 'F[C@@H](Cl)Br');
  });

  it('overwrites existing chirality when the product specifies one explicitly', () => {
    const source = parseSMILES('F[C@H](Cl)Br');
    const sourceCenter = [...source.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    const product = applySMIRKS(source, '[F:1][C:2]([Cl:3])[Br:4]>>[F:1][C@@H:2]([Cl:3])[Br:4]');
    assert.ok(product);
    const productCenter = [...product.atoms.values()].find(atom => atom.name === 'C' && atom.getChirality());
    assert.notEqual(productCenter.getChirality(), sourceCenter.getChirality());
    assert.equal(toSMILES(product), 'F[C@@H](Cl)Br');
  });

  it('clears chirality when local topology changes and the product omits chirality', () => {
    const product = applySMIRKS(parseSMILES('F[C@H](Cl)Br'), '[F:1][C:2]([Cl:3])[Br:4]>>[F:1][C:2]([Cl:3])[I:4]');
    assert.ok(product);
    const productCenter = [...product.atoms.values()].find(atom => atom.name === 'C' && atom.id.startsWith('C'));
    assert.equal(productCenter.getChirality(), null);
    assert.equal(toSMILES(product), 'FC(Cl)I');
  });

  it('preserves a neighboring stereocenter when oxidation edits an adjacent alcohol', () => {
    const product = applySMIRKS(parseSMILES('F[C@H](Cl)CO'), '[C;X4:1][OH:2]>>[C:1]=[O:2]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'F[C@H](Cl)C=O');
  });

  it('applies explicit product bond stereo tokens after local cleanup', () => {
    const product = applySMIRKS(parseSMILES('FC=CF'), '[F:1][C:2]=[C:3][F:4]>>[F:1]/[C:2]=[C:3]/[F:4]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'F/C=C/F');
  });

  it('preserves existing bond stereo when the product omits it and local topology is unchanged', () => {
    const product = applySMIRKS(parseSMILES('F/C=C/F'), '[F:1]/[C:2]=[C:3]/[F:4]>>[F:1][C:2]=[C:3][F:4]');
    assert.ok(product);
    assert.equal(toSMILES(product), 'F/C=C/F');
  });

  it('applies all non-overlapping matches in mode all', () => {
    const product = applySMIRKS(parseSMILES('CCl.CCl'), '[C:1][Cl]>>[C:1]', { mode: 'all' });
    assert.ok(product);
    assert.equal(toSMILES(product), 'C.C');
  });

  it('applies all disconnected reactant-pair matches in mode all', () => {
    const product = applySMIRKS(parseSMILES('C.O.C.O'), '[C:1].[O:2]>>[C:1][O:2]', { mode: 'all' });
    assert.ok(product);
    assert.equal(toSMILES(product), 'CO.CO');
  });

  it('applies explicit hydrogen-count rewrites across all matches in mode all', () => {
    const product = applySMIRKS(parseSMILES('[NH4+].[NH4+]'), '[N+:1]>>[NH3+:1]', { mode: 'all' });
    assert.ok(product);
    assert.equal(toSMILES(product), '[NH3+].[NH3+]');
  });

  it('applies explicit bond-stereo rewrites across all matches in mode all', () => {
    const product = applySMIRKS(parseSMILES('FC=CF.FC=CF'), '[F:1][C:2]=[C:3][F:4]>>[F:1]/[C:2]=[C:3]/[F:4]', {
      mode: 'all'
    });
    assert.ok(product);
    assert.equal(toSMILES(product), 'F/C=C/F.F/C=C/F');
  });

  it('skips overlapping matches in mode all using stable match order', () => {
    const product = applySMIRKS(parseSMILES('CCC'), '[C:1][C:2]>>[C:1]=[C:2]', { mode: 'all' });
    assert.ok(product);
    assert.equal(toSMILES(product), 'C=CC');
    const doubleBonds = [...product.bonds.values()].filter(bond => bond.getOrder() === 2);
    assert.equal(doubleBonds.length, 1);
    assert.deepEqual(doubleBonds[0].atoms, ['C1', 'C2']);
  });

  it('uses a deterministic first match order', () => {
    const product = applySMIRKS(parseSMILES('CCC'), '[C:1][C:2]>>[C:1]=[C:2]', { mode: 'first' });
    assert.ok(product);
    assert.equal(toSMILES(product), 'C=CC');
  });

  it('rejects explicit mapping in mode all', () => {
    const transform = parseSMIRKS('[C:1][O:2]>>[C:1]=[O:2]');
    const mol = parseSMILES('CO');
    const carbon = [...mol.atoms.values()].find(atom => atom.name === 'C' && atom.id.startsWith('C'));
    const oxygen = [...mol.atoms.values()].find(atom => atom.name === 'O' && atom.id.startsWith('O'));
    assert.throws(
      () =>
        applySMIRKS(mol, transform, {
          mode: 'all',
          mapping: new Map([
            ['q0', carbon.id],
            ['q1', oxygen.id]
          ])
        }),
      /explicit mapping can only be used with mode 'first'/
    );
  });

  it('accepts an explicit mapping when it satisfies the reactant SMARTS', () => {
    const transform = parseSMIRKS('[C:1][O:2]>>[C:1]=[O:2]');
    const mol = parseSMILES('CO');
    const carbon = [...mol.atoms.values()].find(atom => atom.name === 'C' && atom.id.startsWith('C'));
    const oxygen = [...mol.atoms.values()].find(atom => atom.name === 'O' && atom.id.startsWith('O'));
    const product = applySMIRKS(mol, transform, {
      mapping: new Map([
        ['q0', carbon.id],
        ['q1', oxygen.id]
      ])
    });
    assert.ok(product);
    assert.equal(toSMILES(product), 'C=O');
  });

  it('rejects an explicit mapping that does not satisfy the reactant SMARTS', () => {
    const transform = parseSMIRKS('[C:1][O:2]>>[C:1]=[O:2]');
    const mol = parseSMILES('CO');
    const carbon = [...mol.atoms.values()].find(atom => atom.name === 'C' && atom.id.startsWith('C'));
    const oxygen = [...mol.atoms.values()].find(atom => atom.name === 'O' && atom.id.startsWith('O'));
    assert.throws(
      () =>
        applySMIRKS(mol, transform, {
          mapping: new Map([
            ['q0', oxygen.id],
            ['q1', carbon.id]
          ])
        }),
      /explicit mapping does not satisfy the reactant SMARTS pattern/
    );
  });

  it('rejects an incomplete explicit mapping', () => {
    const transform = parseSMIRKS('[C:1][O:2]>>[C:1]=[O:2]');
    const mol = parseSMILES('CO');
    const carbon = [...mol.atoms.values()].find(atom => atom.name === 'C' && atom.id.startsWith('C'));
    assert.throws(
      () =>
        applySMIRKS(mol, transform, {
          mapping: new Map([['q0', carbon.id]])
        }),
      /explicit mapping must bind all 2 reactant atoms/
    );
  });

  it('acylates primary and secondary amines but rejects tertiary amines', () => {
    const rxn = '[C:1](=[O:2])[Cl:3].[N+0;!H0;!$([N]-[C](=O)):4]>>[C:1](=[O:2])[N+0:4].[ClH0-:3]';

    const primary = applySMIRKS(parseSMILES('CC(=O)Cl.CN'), rxn);
    assert.ok(primary);
    assert.equal(toSMILES(primary), 'CC(=O)NC.[Cl-]');

    const secondary = applySMIRKS(parseSMILES('CC(=O)Cl.CNC'), rxn);
    assert.ok(secondary);
    assert.equal(toSMILES(secondary), 'CC(=O)N(C)C.[Cl-]');

    const tertiary = applySMIRKS(parseSMILES('CC(=O)Cl.CN(C)C'), rxn);
    assert.equal(tertiary, null);
  });

  it('protonates neutral primary and secondary amines according to the template charge rewrite', () => {
    const rxn = '[N+0;!$([N]-[C](=O)):1]>>[N+:1]';

    const primary = applySMIRKS(parseSMILES('CN'), rxn);
    assert.ok(primary);
    assert.equal(toSMILES(primary), 'C[NH2+]');

    const secondary = applySMIRKS(parseSMILES('CNC'), rxn);
    assert.ok(secondary);
    assert.equal(toSMILES(secondary), 'C[NH+]C');
  });

  it('reduces a nitro group to an aniline plus two water fragments per the template', () => {
    const rxn = '[N+:1](=[O:2])[O-:3]>>[N+0:1].[OH2+0:2].[OH2+0:3]';
    const product = applySMIRKS(parseSMILES('O=[N+]([O-])c1ccccc1'), rxn);
    assert.ok(product);
    assert.equal(sortDotSmiles(toSMILES(product)), 'Nc1ccccc1.O.O');
  });
});
