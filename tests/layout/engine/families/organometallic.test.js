import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutOrganometallicFamily } from '../../../../src/layout/engine/families/organometallic.js';
import {
  makeBisLigatedOrganometallic,
  makeFourCoordinateNickelComplex,
  makeOrganometallic,
  makeProjectedOctahedralCobaltComplex,
  makeProjectedTetrahedralZincComplex,
  makeSquarePlanarPlatinumComplex
} from '../support/molecules.js';

describe('layout/engine/families/organometallic', () => {
  it('lays out a simple metal-ligand fragment through the ligand-first path', () => {
    const graph = createLayoutGraph(makeOrganometallic());
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    assert.equal(result.placementMode, 'ligand-first');
    assert.equal(result.coords.size, 3);
    assert.notDeepEqual(result.coords.get('ru'), result.coords.get('n1'));
  });

  it('spreads multiple ligands around the metal center deterministically', () => {
    const graph = createLayoutGraph(makeBisLigatedOrganometallic());
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    assert.equal(result.coords.size, 5);
    const metal = result.coords.get('ru');
    const firstLigand = result.coords.get('n1');
    const secondLigand = result.coords.get('n2');
    assert.ok(firstLigand.x > metal.x || secondLigand.x > metal.x);
    assert.ok(firstLigand.x < metal.x || secondLigand.x < metal.x);
  });

  it('uses an explicit square-planar cross for four-coordinate platinum centers', () => {
    const graph = createLayoutGraph(makeSquarePlanarPlatinumComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const metal = result.coords.get('Pt1');
    const ligandIds = ['N4', 'N5', 'Cl2', 'Cl3'];
    const vectors = ligandIds.map(atomId => ({
      x: result.coords.get(atomId).x - metal.x,
      y: result.coords.get(atomId).y - metal.y
    }));

    assert.ok(result.coords.size >= 5);
    for (const vector of vectors) {
      assert.ok(Math.abs(vector.x) < 1e-6 || Math.abs(vector.y) < 1e-6);
    }

    const ammineDot = vectors[0].x * vectors[1].x + vectors[0].y * vectors[1].y;
    const chlorideDot = vectors[2].x * vectors[3].x + vectors[2].y * vectors[3].y;
    assert.ok(Math.abs(ammineDot) < 1e-6);
    assert.ok(Math.abs(chlorideDot) < 1e-6);
  });

  it('keeps generic four-coordinate metals on a neutral diamond fallback', () => {
    const graph = createLayoutGraph(makeFourCoordinateNickelComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const metal = result.coords.get('Ni1');
    const ligandIds = ['N4', 'N5', 'Cl2', 'Cl3'];

    assert.ok(result.coords.size >= 5);
    for (const atomId of ligandIds) {
      const ligand = result.coords.get(atomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;
      assert.ok(Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6);
      assert.ok(Math.abs(dx) > 1e-6);
      assert.ok(Math.abs(dy) > 1e-6);
    }
  });

  it('adds projected wedge and dash hints for safe tetrahedral four-coordinate zinc centers', () => {
    const graph = createLayoutGraph(makeProjectedTetrahedralZincComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);

    assert.ok(result.coords.size >= 5);
    assert.equal(result.displayAssignments.length, 2);
    assert.deepEqual([...new Set(result.displayAssignments.map(assignment => assignment.type))].sort(), ['dash', 'wedge']);
    for (const assignment of result.displayAssignments) {
      assert.equal(assignment.centerId, 'Zn1');
      const bond = graph.sourceMolecule.bonds.get(assignment.bondId);
      assert.ok(bond);
      assert.ok(bond.atoms.includes('Zn1'));
    }
  });

  it('adds projected wedge and dash hints for safe octahedral six-coordinate cobalt centers', () => {
    const graph = createLayoutGraph(makeProjectedOctahedralCobaltComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const metal = result.coords.get('Co1');
    const projectedBondIds = new Set(result.displayAssignments.map(assignment => assignment.bondId));
    let projectedLigandCount = 0;
    let planarLigandCount = 0;

    assert.ok(result.coords.size >= 7);
    assert.equal(result.displayAssignments.length, 2);
    assert.deepEqual([...new Set(result.displayAssignments.map(assignment => assignment.type))].sort(), ['dash', 'wedge']);

    for (const bond of graph.sourceMolecule.bonds.values()) {
      if (!bond.atoms.includes('Co1')) {
        continue;
      }
      const ligandAtomId = bond.atoms[0] === 'Co1' ? bond.atoms[1] : bond.atoms[0];
      const ligand = result.coords.get(ligandAtomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;
      if (projectedBondIds.has(bond.id)) {
        projectedLigandCount++;
        assert.ok(Math.abs(dx) > 1e-6);
        assert.ok(Math.abs(dy) > 1e-6);
      } else {
        planarLigandCount++;
        assert.ok(Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6);
      }
    }

    assert.equal(projectedLigandCount, 2);
    assert.equal(planarLigandCount, 4);
  });
});
