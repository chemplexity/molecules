import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as molecules from 'molecules';
import * as core from 'molecules/core';
import * as io from 'molecules/io';

test('every package subpath loads and shares overlapping exports with the root', async () => {
  const manifest = JSON.parse(await readFile(new URL(import.meta.resolve('molecules/package.json')), 'utf8'));
  for (const path of Object.keys(manifest.exports).filter(path => path !== '.' && path !== './package.json')) {
    const module = await import(`molecules/${path.slice(2)}`);
    assert(Object.keys(module).length > 0, `${path} has no exports`);
    for (const [name, value] of Object.entries(module)) {
      if (name in molecules) {
        assert.strictEqual(value, molecules[name], `${path} duplicates ${name}`);
      }
    }
  }
});

test('molecular graphs created by root and subpath imports share all core classes', () => {
  for (const parse of [molecules.parseSMILES, io.parseSMILES]) {
    const mol = parse('CC(=O)Oc1ccccc1C(=O)O');
    assert(mol instanceof core.Molecule);
    assert(mol instanceof molecules.Molecule);
    for (const atom of mol.atoms.values()) {
      assert(atom instanceof core.Atom);
    }
    for (const bond of mol.bonds.values()) {
      assert(bond instanceof core.Bond);
    }
  }
});

test('installed package supports the README workflow and molecule SMARTS methods', () => {
  const mol = io.parseSMILES('CC(=O)Oc1ccccc1C(=O)O');
  molecules.generateCoords(mol);
  assert.equal(molecules.tpsa(mol), 63.6);
  const acid = '[CX3](=O)[OX2H1]';
  assert.equal([...molecules.findSMARTS(mol, acid)].length, 1);
  assert.equal(mol.matchesSMARTS(acid), true);
  assert.equal([...mol.findSMARTS(acid)].length, 1);
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'H') {
      assert(Number.isFinite(atom.x) && Number.isFinite(atom.y));
    }
  }
});

test('both standalone distribution bundles are included and usable', async () => {
  const root = new URL('./', import.meta.resolve('molecules/package.json'));
  for (const file of ['dist/molecules.js', 'dist/molecules.min.js']) {
    const module = await import(new URL(file, root));
    const mol = module.parseSMILES('CC(=O)Oc1ccccc1C(=O)O');
    assert.equal(module.tpsa(mol), 63.6);
    assert.equal(mol.matchesSMARTS('[CX3](=O)[OX2H1]'), true);
  }
});
