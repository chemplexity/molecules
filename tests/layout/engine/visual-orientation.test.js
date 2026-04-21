import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { computeBounds } from '../../../src/layout/engine/geometry/bounds.js';
import { angleOf, angularDifference, sub } from '../../../src/layout/engine/geometry/vec2.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';
import { pickWedgeAssignments } from '../../../src/layout/engine/stereo/wedge-selection.js';

/**
 * Returns heavy-atom ids from a pipeline result.
 * @param {{layoutGraph: object}} result - Pipeline result.
 * @returns {string[]} Heavy-atom ids.
 */
function heavyAtomIds(result) {
  return [...result.layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').map(atom => atom.id);
}

/**
 * Returns the heavy-atom bounds for a pipeline result.
 * @param {{coords: Map<string, {x: number, y: number}>, layoutGraph: object}} result - Pipeline result.
 * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}} Heavy-atom bounds.
 */
function heavyBounds(result) {
  return computeBounds(result.coords, heavyAtomIds(result));
}

/**
 * Returns the centroid of the requested atom subset.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Atom ids to average.
 * @returns {{x: number, y: number}} Subset centroid.
 */
function subsetCentroid(coords, atomIds) {
  const total = atomIds.reduce(
    (sum, atomId) => ({
      x: sum.x + coords.get(atomId).x,
      y: sum.y + coords.get(atomId).y
    }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / atomIds.length,
    y: total.y / atomIds.length
  };
}

/**
 * Returns the maximum y value across the requested atoms.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Atom ids to inspect.
 * @returns {number} Maximum y coordinate.
 */
function maxY(coords, atomIds) {
  return Math.max(...atomIds.map(atomId => coords.get(atomId).y));
}

/**
 * Returns the minimum y value across the requested atoms.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Atom ids to inspect.
 * @returns {number} Minimum y coordinate.
 */
function minY(coords, atomIds) {
  return Math.min(...atomIds.map(atomId => coords.get(atomId).y));
}

/**
 * Returns unique rounded coordinate values in ascending order.
 * @param {number[]} values - Coordinate values.
 * @returns {number[]} Unique rounded values.
 */
function roundedUniqueValues(values) {
  return [...new Set(values.map(value => Number(value.toFixed(6))))].sort((firstValue, secondValue) => firstValue - secondValue);
}

function sharedRingCount(layoutGraph, firstAtomId, secondAtomId) {
  const firstRings = layoutGraph.atomToRings.get(firstAtomId) ?? [];
  const secondRings = layoutGraph.atomToRings.get(secondAtomId) ?? [];
  return secondRings.filter(ring => firstRings.includes(ring)).length;
}

/**
 * Asserts that a scaffold is wider than it is tall.
 * @param {{coords: Map<string, {x: number, y: number}>, layoutGraph: object}} result - Pipeline result.
 * @returns {void}
 */
function assertHorizontal(result) {
  const bounds = heavyBounds(result);
  assert.ok(bounds.width > bounds.height);
}

/**
 * Asserts that a bond is exactly vertical in the current coordinates.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} firstAtomId - First atom id.
 * @param {string} secondAtomId - Second atom id.
 * @returns {void}
 */
function assertVerticalBond(coords, firstAtomId, secondAtomId) {
  assert.ok(Math.abs(coords.get(firstAtomId).x - coords.get(secondAtomId).x) < 1e-6);
}

describe('layout/engine/visual-orientation', () => {
  it('keeps fused and mixed corpus entries in their expected horizontal orientations', () => {
    const naphthalene = runPipeline(parseSMILES('c1ccc2ccccc2c1'), { suppressH: true });
    assertHorizontal(naphthalene);
    assertVerticalBond(naphthalene.coords, 'C4', 'C9');

    const anthracene = runPipeline(parseSMILES('c1ccc2cc3ccccc3cc2c1'), { suppressH: true });
    assertHorizontal(anthracene);
    assertVerticalBond(anthracene.coords, 'C4', 'C13');
    assertVerticalBond(anthracene.coords, 'C6', 'C11');

    const fluorene = runPipeline(parseSMILES('c1ccc2c(c1)Cc1ccccc1-2'), { suppressH: true });
    assertHorizontal(fluorene);
    assert.equal(fluorene.coords.get('C7').y, maxY(fluorene.coords, heavyAtomIds(fluorene)));

    const indane = runPipeline(parseSMILES('C1Cc2ccccc2C1'), { suppressH: true });
    assertHorizontal(indane);
    assertVerticalBond(indane.coords, 'C3', 'C8');

    const tetralin = runPipeline(parseSMILES('C1CCc2ccccc2C1'), { suppressH: true });
    assertHorizontal(tetralin);
    assertVerticalBond(tetralin.coords, 'C4', 'C9');

    const chromane = runPipeline(parseSMILES('C1CCOc2ccccc21'), { suppressH: true });
    assertHorizontal(chromane);
    assertVerticalBond(chromane.coords, 'C5', 'C10');
    assert.ok(chromane.coords.get('O4').x > chromane.coords.get('C5').x);

  });

  it('keeps aromatic heterocycles in their expected canonical compass orientations', () => {
    const thiophene = runPipeline(parseSMILES('c1ccsc1'), { suppressH: true });
    assert.equal(thiophene.coords.get('S4').y, minY(thiophene.coords, heavyAtomIds(thiophene)));

    const pyridine = runPipeline(parseSMILES('c1ccncc1'), { suppressH: true });
    assert.equal(pyridine.coords.get('N4').y, maxY(pyridine.coords, heavyAtomIds(pyridine)));

    const indole = runPipeline(parseSMILES('c1ccc2[nH]ccc2c1'), { suppressH: true });
    assertHorizontal(indole);
    const indoleFiveRing = subsetCentroid(indole.coords, ['N5', 'C4', 'C7', 'C8', 'C9']);
    const indoleSixRing = subsetCentroid(indole.coords, ['C1', 'C2', 'C3', 'C4', 'C9', 'C10']);
    assert.ok(indoleFiveRing.x < indoleSixRing.x);
    assert.ok(indole.coords.get('N5').x < indoleFiveRing.x);
    assert.ok(indole.coords.get('N5').y > indoleFiveRing.y);

    const quinoline = runPipeline(parseSMILES('c1ccc2ncccc2c1'), { suppressH: true });
    assertHorizontal(quinoline);
    const quinolineRightRingIds = ['C4', 'N5', 'C6', 'C7', 'C8', 'C9'];
    const quinolineLeftRing = subsetCentroid(quinoline.coords, ['C1', 'C2', 'C3', 'C4', 'C9', 'C10']);
    const quinolineRightRing = subsetCentroid(quinoline.coords, quinolineRightRingIds);
    assert.ok(quinolineLeftRing.x < quinolineRightRing.x);
    assert.equal(quinoline.coords.get('N5').y, maxY(quinoline.coords, quinolineRightRingIds));

    const purine = runPipeline(parseSMILES('c1ncc2[nH]cnc2n1'), { suppressH: true });
    assertHorizontal(purine);
    const purineFiveRing = subsetCentroid(purine.coords, ['N5', 'C4', 'C7', 'N8', 'C9']);
    const purineSixRing = subsetCentroid(purine.coords, ['C1', 'N2', 'C3', 'C4', 'C9', 'N10']);
    assert.ok(purineFiveRing.x < purineSixRing.x);
    assert.ok(purine.coords.get('N8').y > purineFiveRing.y);

    const benzimidazole = runPipeline(parseSMILES('c1ccc2[nH]cnc2c1'), { suppressH: true });
    assertHorizontal(benzimidazole);
    const benzimidazoleFiveRing = subsetCentroid(benzimidazole.coords, ['N5', 'C4', 'C7', 'N8', 'C9']);
    const benzimidazoleSixRing = subsetCentroid(benzimidazole.coords, ['C1', 'C2', 'C3', 'C4', 'C9', 'C10']);
    assert.ok(benzimidazoleFiveRing.x < benzimidazoleSixRing.x);
    assert.ok(benzimidazole.coords.get('N8').x < benzimidazoleFiveRing.x);
    assert.ok(benzimidazole.coords.get('N8').y > benzimidazoleFiveRing.y);
  });

  it('keeps pyrene and the bridged cage corpus in their expected projected orientations', () => {
    const pyrene = runPipeline(parseSMILES('c1cc2ccc3cccc4ccc(c1)c2c34'), { suppressH: true });
    assertHorizontal(pyrene);
    const pyreneXs = roundedUniqueValues(heavyAtomIds(pyrene).map(atomId => pyrene.coords.get(atomId).x));
    const pyreneYs = roundedUniqueValues(heavyAtomIds(pyrene).map(atomId => pyrene.coords.get(atomId).y));
    assert.equal(pyreneXs.length, 8);
    assert.equal(pyreneYs.length, 5);

    const norbornane = runPipeline(parseSMILES('C1CC2CCC1C2'), { suppressH: true });
    const norbornaneHeavyAtoms = heavyAtomIds(norbornane);
    assert.equal(norbornane.coords.get('C7').y, maxY(norbornane.coords, norbornaneHeavyAtoms));
    const norbornaneCenter = subsetCentroid(norbornane.coords, norbornaneHeavyAtoms);
    assert.ok(subsetCentroid(norbornane.coords, ['C2', 'C3']).x < norbornaneCenter.x);
    assert.ok(subsetCentroid(norbornane.coords, ['C5', 'C6']).x > norbornaneCenter.x);

    const adamantane = runPipeline(parseSMILES('C1C2CC3CC1CC(C2)C3'), { suppressH: true });
    const adamantaneHeavyAtoms = heavyAtomIds(adamantane);
    const adamantaneCenter = subsetCentroid(adamantane.coords, adamantaneHeavyAtoms);
    assert.equal(adamantane.coords.get('C8').y, maxY(adamantane.coords, adamantaneHeavyAtoms));
    assert.ok(adamantane.coords.get('C3').x < adamantane.coords.get('C4').x);
    assert.ok(adamantane.coords.get('C4').x < adamantane.coords.get('C5').x);
    assert.ok(adamantane.coords.get('C3').y < adamantaneCenter.y);
    assert.ok(adamantane.coords.get('C4').y < adamantaneCenter.y);
    assert.ok(adamantane.coords.get('C5').y < adamantaneCenter.y);

    const bicyclo222 = runPipeline(parseSMILES('C1CC2CCC1CC2'), { suppressH: true });
    const bicycloHeavyAtoms = heavyAtomIds(bicyclo222);
    assert.equal(bicyclo222.coords.get('C4').y, maxY(bicyclo222.coords, bicycloHeavyAtoms));
    assert.ok(bicyclo222.coords.get('C7').x < bicyclo222.coords.get('C6').x);
    assert.ok(bicyclo222.coords.get('C6').x < bicyclo222.coords.get('C1').x);
    assert.ok(bicyclo222.coords.get('C7').y < bicyclo222.coords.get('C6').y);
    assert.ok(bicyclo222.coords.get('C1').y < bicyclo222.coords.get('C6').y);

    const oxabicyclo222 = runPipeline(parseSMILES('C12CCC(CO1)CC2'), { suppressH: true });
    const oxabicyclo222HeavyAtoms = heavyAtomIds(oxabicyclo222);
    assert.equal(oxabicyclo222.coords.get('C8').y, maxY(oxabicyclo222.coords, oxabicyclo222HeavyAtoms));
    assert.ok(oxabicyclo222.coords.get('C3').x < oxabicyclo222.coords.get('C2').x);
    assert.ok(oxabicyclo222.coords.get('C2').x < oxabicyclo222.coords.get('C1').x);
    assert.ok(oxabicyclo222.coords.get('C1').x < oxabicyclo222.coords.get('O6').x);
    assert.ok(oxabicyclo222.coords.get('C4').x < oxabicyclo222.coords.get('C5').x);
    assert.ok(oxabicyclo222.coords.get('C5').x < oxabicyclo222.coords.get('O6').x);
    assert.ok(oxabicyclo222.coords.get('C5').y < oxabicyclo222.coords.get('O6').y);
    assert.ok(oxabicyclo222.coords.get('C4').y < oxabicyclo222.coords.get('C7').y);
    assert.ok(oxabicyclo222.coords.get('C1').y < oxabicyclo222.coords.get('C8').y);

    const quinuclidine = runPipeline(parseSMILES('C1CN2CCC1CC2'), { suppressH: true });
    const quinuclidineHeavyAtoms = heavyAtomIds(quinuclidine);
    assert.equal(quinuclidine.coords.get('C1').y, maxY(quinuclidine.coords, quinuclidineHeavyAtoms));
    assert.ok(Math.abs(quinuclidine.coords.get('N3').x - quinuclidine.coords.get('C2').x) < 1e-6);
    assert.ok(Math.abs(quinuclidine.coords.get('C1').x - quinuclidine.coords.get('C6').x) < 0.15);
    assert.ok(quinuclidine.coords.get('N3').y < quinuclidine.coords.get('C2').y);
    assert.ok(quinuclidine.coords.get('N3').y < quinuclidine.coords.get('C6').y);
    assert.ok(quinuclidine.coords.get('C4').y < quinuclidine.coords.get('N3').y);
    assert.ok(quinuclidine.coords.get('C8').y < quinuclidine.coords.get('N3').y);
    assert.ok(quinuclidine.coords.get('C4').x < quinuclidine.coords.get('C5').x);
    assert.ok(quinuclidine.coords.get('C5').x < quinuclidine.coords.get('N3').x);
    assert.ok(quinuclidine.coords.get('N3').x < quinuclidine.coords.get('C6').x);
    assert.ok(quinuclidine.coords.get('C6').x < quinuclidine.coords.get('C8').x);
    assert.ok(quinuclidine.coords.get('C8').x < quinuclidine.coords.get('C7').x);

    const oxabicyclo311 = runPipeline(parseSMILES('C1OC2CC(C1)C2'), { suppressH: true });
    const oxabicycloHeavyAtoms = heavyAtomIds(oxabicyclo311);
    assert.equal(oxabicyclo311.coords.get('C7').y, maxY(oxabicyclo311.coords, oxabicycloHeavyAtoms));
    assert.equal(oxabicyclo311.coords.get('O2').y, minY(oxabicyclo311.coords, oxabicycloHeavyAtoms));
    assert.ok(oxabicyclo311.coords.get('C1').x < oxabicyclo311.coords.get('O2').x);
    assert.ok(oxabicyclo311.coords.get('O2').x < oxabicyclo311.coords.get('C3').x);
    assert.ok(oxabicyclo311.coords.get('C6').x < oxabicyclo311.coords.get('C5').x);
    assert.ok(oxabicyclo311.coords.get('C5').x < oxabicyclo311.coords.get('C4').x);
    assert.ok(oxabicyclo311.coords.get('C3').y < oxabicyclo311.coords.get('C5').y);
    assert.ok(oxabicyclo311.coords.get('C4').y < oxabicyclo311.coords.get('C5').y);
    assert.ok(oxabicyclo311.coords.get('C5').y < oxabicyclo311.coords.get('C7').y);

    const tropane = runPipeline(parseSMILES('N1C2CCC1CC(C2)'), { suppressH: true });
    assert.equal(tropane.coords.get('N1').y, maxY(tropane.coords, heavyAtomIds(tropane)));
    assert.equal(tropane.coords.get('C7').y, minY(tropane.coords, heavyAtomIds(tropane)));
    assert.ok(Math.abs(tropane.coords.get('N1').x - tropane.coords.get('C5').x) < 1e-6);
    assert.ok(tropane.coords.get('C4').x < tropane.coords.get('C3').x);
    assert.ok(tropane.coords.get('C3').x < tropane.coords.get('C5').x);
    assert.ok(tropane.coords.get('C5').x < tropane.coords.get('C2').x);
    assert.ok(tropane.coords.get('C2').x < tropane.coords.get('C8').x);
    assert.ok(tropane.coords.get('C8').x < tropane.coords.get('C7').x);

    const cubane = runPipeline(parseSMILES('C12C3C4C1C5C4C3C25'), { suppressH: true });
    assertVerticalBond(cubane.coords, 'C1', 'C2');
    assertVerticalBond(cubane.coords, 'C4', 'C3');
    assertVerticalBond(cubane.coords, 'C8', 'C7');
    assertVerticalBond(cubane.coords, 'C5', 'C6');
    const cubaneFrontFace = subsetCentroid(cubane.coords, ['C1', 'C2', 'C3', 'C4']);
    const cubaneBackFace = subsetCentroid(cubane.coords, ['C5', 'C6', 'C7', 'C8']);
    assert.ok(cubaneBackFace.x > cubaneFrontFace.x);
    const cubaneXs = roundedUniqueValues(heavyAtomIds(cubane).map(atomId => cubane.coords.get(atomId).x));
    const cubaneYs = roundedUniqueValues(heavyAtomIds(cubane).map(atomId => cubane.coords.get(atomId).y));
    assert.equal(cubaneXs.length, 4);
    assert.equal(cubaneYs.length, 4);
  });

  it('keeps safe fused-junction stereobonds on the exact continuation of the shared junction bond', () => {
    const fusedSugar = runPipeline(
      parseSMILES('C[C@@]1(C[C@@H](O)[C@@]2(O)C=CO[C@@H](O[C@H]3O[C@@H](CO)[C@@H](O)[C@@H](O)[C@@H]3O)[C@@H]12)OC(=O)\\C=C/c4ccccc4'),
      { suppressH: true }
    );
    const c7Assignment = pickWedgeAssignments(fusedSugar.layoutGraph, fusedSugar.coords).assignments.find(assignment => assignment.centerId === 'C7');
    const ringNeighborIds = fusedSugar.layoutGraph.sourceMolecule.atoms.get('C7')
      .getNeighbors(fusedSugar.layoutGraph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && neighborAtom.id !== 'O8' && (fusedSugar.layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0)
      .map(neighborAtom => neighborAtom.id);
    const sharedJunctionNeighborId = ringNeighborIds.find(neighborAtomId => sharedRingCount(fusedSugar.layoutGraph, 'C7', neighborAtomId) > 1);
    const straightJunctionAngle = angleOf(sub(fusedSugar.coords.get('C7'), fusedSugar.coords.get(sharedJunctionNeighborId)));
    const substituentAngle = angleOf(sub(fusedSugar.coords.get('O8'), fusedSugar.coords.get('C7')));

    assert.equal(c7Assignment?.bondId, '5');
    assert.equal(c7Assignment?.type, 'wedge');
    assert.equal(ringNeighborIds.length, 3);
    assert.equal(sharedJunctionNeighborId, 'C31');
    assert.ok(angularDifference(substituentAngle, straightJunctionAngle) < 1e-6);
  });

  it('does not globally rotate non-junction heavy-atom stereocenters away from the canonical heterocycle frame', () => {
    const histidineLike = runPipeline(parseSMILES('C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN'), { suppressH: true });
    const imidazoleLikeRing = ['C1', 'C2', 'N3', 'C4', 'N5'];
    const c11Assignment = pickWedgeAssignments(histidineLike.layoutGraph, histidineLike.coords).assignments.find(assignment => assignment.centerId === 'C11');

    assert.equal(c11Assignment?.bondId, '9');
    assert.ok(c11Assignment, 'expected the non-junction stereocenter to keep an explicit stereobond assignment');
    assert.equal(histidineLike.coords.get('N5').y, maxY(histidineLike.coords, imidazoleLikeRing));
    assert.ok(Math.abs(histidineLike.coords.get('C1').y - histidineLike.coords.get('C4').y) < 1e-6);
    assert.ok(Math.abs(histidineLike.coords.get('C2').y - histidineLike.coords.get('N3').y) < 1e-6);
  });

});
