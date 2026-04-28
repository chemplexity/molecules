import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutOrganometallicFamily } from '../../../../src/layout/engine/families/organometallic.js';
import { angleOf, angularDifference, distance, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import {
  makeBisLigatedOrganometallic,
  makeFourCoordinateNickelComplex,
  makeOrganometallic,
  makeProjectedOctahedralCobaltComplex,
  makeProjectedSquarePyramidalRhodiumComplex,
  makeProjectedTetrahedralZincComplex,
  makeProjectedTrigonalBipyramidalIronComplex,
  makeSquarePlanarPlatinumComplex,
  makeTrigonalPlanarCopperComplex
} from '../support/molecules.js';

/**
 * Returns the smaller angle at a center atom between two neighbors.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstAtomId - First neighbor atom ID.
 * @param {string} secondAtomId - Second neighbor atom ID.
 * @returns {number} Smaller bond angle in radians.
 */
function bondAngleAt(coords, centerAtomId, firstAtomId, secondAtomId) {
  return angularDifference(
    angleOf(sub(coords.get(firstAtomId), coords.get(centerAtomId))),
    angleOf(sub(coords.get(secondAtomId), coords.get(centerAtomId)))
  );
}

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
    const metal = result.coords.get('Zn1');
    const wedgeAssignment = result.displayAssignments.find(assignment => assignment.type === 'wedge');
    const dashAssignment = result.displayAssignments.find(assignment => assignment.type === 'dash');

    assert.ok(result.coords.size >= 5);
    assert.equal(result.displayAssignments.length, 2);
    assert.deepEqual([...new Set(result.displayAssignments.map(assignment => assignment.type))].sort(), ['dash', 'wedge']);
    for (const assignment of result.displayAssignments) {
      assert.equal(assignment.centerId, 'Zn1');
      const bond = graph.sourceMolecule.bonds.get(assignment.bondId);
      assert.ok(bond);
      assert.ok(bond.atoms.includes('Zn1'));
    }
    assert.ok(wedgeAssignment, 'expected one projected wedge assignment');
    assert.ok(dashAssignment, 'expected one projected dash assignment');
    const wedgeBond = graph.sourceMolecule.bonds.get(wedgeAssignment.bondId);
    const dashBond = graph.sourceMolecule.bonds.get(dashAssignment.bondId);
    const wedgeLigandId = wedgeBond.atoms[0] === 'Zn1' ? wedgeBond.atoms[1] : wedgeBond.atoms[0];
    const dashLigandId = dashBond.atoms[0] === 'Zn1' ? dashBond.atoms[1] : dashBond.atoms[0];
    const wedgeLigand = result.coords.get(wedgeLigandId);
    const dashLigand = result.coords.get(dashLigandId);
    assert.ok(wedgeLigand.x < metal.x, 'expected tetrahedral wedge ligand to project to the left of zinc');
    assert.ok(wedgeLigand.y < metal.y, 'expected tetrahedral wedge ligand to project above zinc');
    assert.ok(dashLigand.x > metal.x, 'expected tetrahedral dash ligand to project to the right of zinc');
    assert.ok(dashLigand.y < metal.y, 'expected tetrahedral dash ligand to project above zinc');
  });

  it('uses an explicit trigonal-planar spread for supported three-coordinate copper centers', () => {
    const graph = createLayoutGraph(makeTrigonalPlanarCopperComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const metal = result.coords.get('Cu1');
    const angles = [...graph.sourceMolecule.bonds.values()]
      .filter(bond => bond.atoms.includes('Cu1'))
      .map(bond => {
        const ligandAtomId = bond.atoms[0] === 'Cu1' ? bond.atoms[1] : bond.atoms[0];
        const ligand = result.coords.get(ligandAtomId);
        return Math.atan2(ligand.y - metal.y, ligand.x - metal.x);
      })
      .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    const wrappedAngles = [...angles, angles[0] + Math.PI * 2];

    assert.ok(result.coords.size >= 4);
    assert.equal(result.displayAssignments.length, 0);
    for (let index = 0; index < angles.length; index++) {
      assert.ok(Math.abs(wrappedAngles[index + 1] - wrappedAngles[index] - (2 * Math.PI) / 3) < 1e-6);
    }
  });

  it('adds projected wedge and dash hints for safe trigonal-bipyramidal five-coordinate iron centers', () => {
    const graph = createLayoutGraph(makeProjectedTrigonalBipyramidalIronComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const metal = result.coords.get('Fe1');
    const projectedBondIds = new Set(result.displayAssignments.map(assignment => assignment.bondId));
    const wedgeBondIds = new Set(result.displayAssignments.filter(assignment => assignment.type === 'wedge').map(assignment => assignment.bondId));
    const dashBondIds = new Set(result.displayAssignments.filter(assignment => assignment.type === 'dash').map(assignment => assignment.bondId));
    const projectedOffsets = [];
    const planarOffsets = [];

    assert.ok(result.coords.size >= 6);
    assert.equal(result.displayAssignments.length, 2);
    assert.deepEqual([...new Set(result.displayAssignments.map(assignment => assignment.type))].sort(), ['dash', 'wedge']);

    for (const bond of graph.sourceMolecule.bonds.values()) {
      if (!bond.atoms.includes('Fe1')) {
        continue;
      }
      const ligandAtomId = bond.atoms[0] === 'Fe1' ? bond.atoms[1] : bond.atoms[0];
      const ligand = result.coords.get(ligandAtomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;

      if (projectedBondIds.has(bond.id)) {
        projectedOffsets.push({ bondId: bond.id, dx, dy });
        assert.ok(dx < 0, 'expected trigonal-bipyramidal projected ligands on the left side of iron');
        assert.ok(Math.abs(dx) > 1e-6);
        assert.ok(Math.abs(dy) > 1e-6);
        if (dashBondIds.has(bond.id)) {
          assert.ok(dy > 0, 'expected trigonal-bipyramidal dash ligand above the iron center');
        }
        if (wedgeBondIds.has(bond.id)) {
          assert.ok(dy < 0, 'expected trigonal-bipyramidal wedge ligand below the iron center');
        }
      } else {
        planarOffsets.push({ dx, dy });
      }
    }

    assert.equal(projectedOffsets.length, 2);
    assert.equal(planarOffsets.length, 3);

    const axialOffsets = planarOffsets.filter(offset => Math.abs(offset.dy) > 1e-6);
    const equatorialOffsets = planarOffsets.filter(offset => Math.abs(offset.dy) <= 1e-6);

    assert.equal(axialOffsets.length, 2);
    assert.equal(equatorialOffsets.length, 1);
    assert.ok(axialOffsets.every(offset => Math.abs(offset.dx) < 1e-6));
    assert.ok(Math.abs(axialOffsets[0].dy + axialOffsets[1].dy) < 1e-6);
    assert.ok(equatorialOffsets[0].dx > 0);
  });

  it('adds octahedral-style front/back ligands for safe square-pyramidal five-coordinate rhodium centers', () => {
    const graph = createLayoutGraph(makeProjectedSquarePyramidalRhodiumComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const metal = result.coords.get('Rh1');
    const projectedBondIds = new Set(result.displayAssignments.map(assignment => assignment.bondId));
    const wedgeBondIds = new Set(result.displayAssignments.filter(assignment => assignment.type === 'wedge').map(assignment => assignment.bondId));
    const dashBondIds = new Set(result.displayAssignments.filter(assignment => assignment.type === 'dash').map(assignment => assignment.bondId));
    let planarLigandCount = 0;
    let upperDashCount = 0;
    let lowerWedgeCount = 0;

    assert.ok(result.coords.size >= 6);
    assert.equal(result.displayAssignments.length, 4);
    assert.deepEqual([...new Set(result.displayAssignments.map(assignment => assignment.type))].sort(), ['dash', 'wedge']);
    assert.equal(wedgeBondIds.size, 2);
    assert.equal(dashBondIds.size, 2);

    for (const bond of graph.sourceMolecule.bonds.values()) {
      if (!bond.atoms.includes('Rh1')) {
        continue;
      }
      const ligandAtomId = bond.atoms[0] === 'Rh1' ? bond.atoms[1] : bond.atoms[0];
      const ligand = result.coords.get(ligandAtomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;
      if (projectedBondIds.has(bond.id)) {
        assert.ok(Math.abs(dx) > 1e-6);
        assert.ok(Math.abs(dy) > 1e-6);
        assert.ok(Math.abs(dx) > Math.abs(dy), 'expected square-pyramidal projected ligands to fan out laterally while staying clearly angled');
        if (dashBondIds.has(bond.id)) {
          assert.ok(dy > 0, 'expected square-pyramidal dash ligands above the rhodium center');
          upperDashCount++;
        }
        if (wedgeBondIds.has(bond.id)) {
          assert.ok(dy < 0, 'expected square-pyramidal wedge ligands below the rhodium center');
          lowerWedgeCount++;
        }
      } else {
        planarLigandCount++;
        assert.ok(Math.abs(dx) < 1e-6, 'expected the remaining square-pyramidal ligand on the vertical axis');
        assert.ok(dy > 0, 'expected the remaining square-pyramidal ligand above the rhodium center');
      }
    }

    assert.equal(upperDashCount, 2);
    assert.equal(lowerWedgeCount, 2);
    assert.equal(planarLigandCount, 1);
  });

  it('adds projected wedge and dash hints for safe octahedral six-coordinate cobalt centers', () => {
    const graph = createLayoutGraph(makeProjectedOctahedralCobaltComplex(), { suppressH: true });
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const metal = result.coords.get('Co1');
    const projectedBondIds = new Set(result.displayAssignments.map(assignment => assignment.bondId));
    const wedgeBondIds = new Set(result.displayAssignments.filter(assignment => assignment.type === 'wedge').map(assignment => assignment.bondId));
    const dashBondIds = new Set(result.displayAssignments.filter(assignment => assignment.type === 'dash').map(assignment => assignment.bondId));
    let planarLigandCount = 0;
    let upperDashCount = 0;
    let lowerWedgeCount = 0;

    assert.ok(result.coords.size >= 7);
    assert.equal(result.displayAssignments.length, 4);
    assert.deepEqual([...new Set(result.displayAssignments.map(assignment => assignment.type))].sort(), ['dash', 'wedge']);
    assert.equal(wedgeBondIds.size, 2);
    assert.equal(dashBondIds.size, 2);

    for (const bond of graph.sourceMolecule.bonds.values()) {
      if (!bond.atoms.includes('Co1')) {
        continue;
      }
      const ligandAtomId = bond.atoms[0] === 'Co1' ? bond.atoms[1] : bond.atoms[0];
      const ligand = result.coords.get(ligandAtomId);
      const dx = ligand.x - metal.x;
      const dy = ligand.y - metal.y;
      if (projectedBondIds.has(bond.id)) {
        assert.ok(Math.abs(dx) > 1e-6);
        assert.ok(Math.abs(dy) > 1e-6);
        assert.ok(Math.abs(dx) > Math.abs(dy), 'expected projected octahedral ligands to fan out laterally while still staying clearly angled');
        if (dashBondIds.has(bond.id)) {
          assert.ok(dy > 0, 'expected projected dash ligands above the cobalt center');
          upperDashCount++;
        }
        if (wedgeBondIds.has(bond.id)) {
          assert.ok(dy < 0, 'expected projected wedge ligands below the cobalt center');
          lowerWedgeCount++;
        }
      } else {
        planarLigandCount++;
        assert.ok(Math.abs(dx) < 1e-6, 'expected planar octahedral ligands to stay on the vertical axis');
      }
    }

    assert.equal(upperDashCount, 2);
    assert.equal(lowerWedgeCount, 2);
    assert.equal(planarLigandCount, 2);
  });

  it('rescues multi-metal halide clusters by laying out the metal framework before placing bridging ligands', () => {
    const graph = createLayoutGraph(
      parseSMILES('[Ta]12([Ta]3([Br])[Ta]([Ta]([Br])([Br])[Ta]1([Br])([Br])[Ta]([Br])([Br])3([Br])[Br])([Br])[Br])([Br])[Br]2'),
      { suppressH: true }
    );
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.placementMode, 'metal-framework-rescue');
    assert.equal(result.displayAssignments.length, 0);
    assert.ok(audit.bondLengthFailureCount <= 2);
    assert.ok(audit.maxBondLengthDeviation < 0.5);
  });

  it('rescues polyoxometalate cages by laying out an inferred metal framework before placing oxo bridges', () => {
    const graph = createLayoutGraph(
      parseSMILES('[O-][V](=O)[O+]([V](=O)O[V](=O)(=O)O[V](=O)(=O)[O+]([V]([O-])=O)[V](=O)(=O)=O)[V](=O)(=O)=O'),
      { suppressH: true }
    );
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.placementMode, 'polyoxo-framework-rescue');
    assert.equal(result.displayAssignments.length, 0);
    assert.ok(audit.severeOverlapCount <= 5);
    assert.ok(audit.bondLengthFailureCount <= 3);
    assert.ok(audit.maxBondLengthDeviation < 0.8);
  });

  it('keeps cyclic polyoxovanadates on the dedicated polyoxo rescue instead of the direct metal-framework path', () => {
    const graph = createLayoutGraph(
      parseSMILES('[O-][V]1(=O)O[V]([O-])(=O)O[V]([O-])(=O)O[V]([O-])(=O)O1'),
      { suppressH: true }
    );
    const result = layoutOrganometallicFamily(graph, graph.components[0], graph.options.bondLength);
    const audit = auditLayout(graph, result.coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: result.bondValidationClasses
    });

    assert.equal(result.placementMode, 'polyoxo-framework-rescue');
    assert.equal(result.displayAssignments.length, 0);
    assert.ok(audit.severeOverlapCount <= 6);
    assert.ok(audit.bondLengthFailureCount <= 2);
    assert.ok(audit.maxBondLengthDeviation < 0.7);
  });

  it('places terminal metal ligands on the exact trigonal slot of unsaturated organic anchors', () => {
    const smiles = 'CC1=CC=C(C2CCC(CC2)C2CCC(CC=C[Re])CC2)C(F)=C1F';
    const visibleHydrogenResult = generateCoords(parseSMILES(smiles), {
      suppressH: true,
      auditTelemetry: true
    });
    const hiddenHydrogenMolecule = parseSMILES(smiles);
    hiddenHydrogenMolecule.hideHydrogens();
    const hiddenHydrogenResult = generateCoords(hiddenHydrogenMolecule, {
      suppressH: true,
      auditTelemetry: true
    });

    for (const [label, result] of [
      ['visible-H layout', visibleHydrogenResult],
      ['hidden-H app layout', hiddenHydrogenResult]
    ]) {
      assert.equal(result.metadata.primaryFamily, 'organometallic');
      assert.equal(result.metadata.audit.ok, true);
      assert.ok(
        Math.abs(bondAngleAt(result.coords, 'C18', 'C17', 'Re19') - (2 * Math.PI) / 3) < 1e-6,
        `expected ${label} C17-C18-Re19 to stay at 120 degrees`
      );
      assert.ok(
        Math.abs(distance(result.coords.get('C18'), result.coords.get('Re19')) - result.layoutGraph.options.bondLength) < 1e-6,
        `expected ${label} Re19-C18 bond length to stay normalized`
      );
      if (result.coords.has('H50')) {
        assert.ok(
          Math.abs(bondAngleAt(result.coords, 'C18', 'C17', 'H50') - (2 * Math.PI) / 3) < 1e-6,
          `expected ${label} C17-C18-H50 to share the companion trigonal slot`
        );
      }
    }
  });
});
