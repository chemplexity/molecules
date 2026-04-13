import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCoords, refineCoords } from '../../src/layoutv2/api.js';
import { Molecule } from '../../src/core/Molecule.js';
import { parseSMILES } from '../../src/io/smiles.js';
import { makeDisconnectedEthanes, makeEthane } from './support/molecules.js';

function minNonBondedDistance(molecule, coords) {
  const bondedPairs = new Set(
    [...molecule.bonds.values()].flatMap(bond => [
      `${bond.atoms[0]}:${bond.atoms[1]}`,
      `${bond.atoms[1]}:${bond.atoms[0]}`
    ])
  );
  const entries = [...coords.entries()].filter(([atomId]) => molecule.atoms.get(atomId)?.name !== 'H');
  let minDistance = Number.POSITIVE_INFINITY;

  for (let firstIndex = 0; firstIndex < entries.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex++) {
      const [firstAtomId, firstPosition] = entries[firstIndex];
      const [secondAtomId, secondPosition] = entries[secondIndex];
      if (bondedPairs.has(`${firstAtomId}:${secondAtomId}`)) {
        continue;
      }
      minDistance = Math.min(
        minDistance,
        Math.hypot(firstPosition.x - secondPosition.x, firstPosition.y - secondPosition.y)
      );
    }
  }

  return minDistance;
}

function sortedAngleSeparations(centerPosition, neighborPositions) {
  const angles = neighborPositions
    .map(position => Math.atan2(position.y - centerPosition.y, position.x - centerPosition.x))
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = [];
  for (let index = 0; index < angles.length; index++) {
    const currentAngle = angles[index];
    const nextAngle = angles[(index + 1) % angles.length];
    const rawSeparation = nextAngle - currentAngle;
    separations.push(rawSeparation > 0 ? rawSeparation : rawSeparation + (Math.PI * 2));
  }
  return separations;
}

function assertApproxTrigonal(coords, centerAtomId, neighborAtomIds, tolerance = 0.5) {
  const centerPosition = coords.get(centerAtomId);
  const neighborPositions = neighborAtomIds.map(atomId => coords.get(atomId));
  assert.ok(centerPosition);
  for (const neighborPosition of neighborPositions) {
    assert.ok(neighborPosition);
  }
  const separations = sortedAngleSeparations(centerPosition, neighborPositions);
  const idealSeparation = (Math.PI * 2) / 3;
  for (const separation of separations) {
    assert.ok(Math.abs(separation - idealSeparation) < tolerance);
  }
}

function assertApproxTetrahedralSpread(coords, centerAtomId, neighborAtomIds, tolerance = 0.4) {
  const centerPosition = coords.get(centerAtomId);
  const neighborPositions = neighborAtomIds.map(atomId => coords.get(atomId));
  assert.ok(centerPosition);
  for (const neighborPosition of neighborPositions) {
    assert.ok(neighborPosition);
  }
  const separations = sortedAngleSeparations(centerPosition, neighborPositions);
  const idealSeparation = Math.PI / 2;
  for (const separation of separations) {
    assert.ok(Math.abs(separation - idealSeparation) < tolerance);
  }
}

function signedTriangleArea(coords, firstAtomId, secondAtomId, thirdAtomId) {
  const first = coords.get(firstAtomId);
  const second = coords.get(secondAtomId);
  const third = coords.get(thirdAtomId);
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);
  return ((second.x - first.x) * (third.y - first.y)) - ((second.y - first.y) * (third.x - first.x));
}

describe('layoutv2/api', () => {
  it('gracefully returns an unsupported result for null and atom-less molecules', () => {
    const emptyMolecule = new Molecule();
    const nullResult = generateCoords(null);
    const emptyResult = generateCoords(emptyMolecule);

    assert.equal(nullResult.metadata.stage, 'unsupported');
    assert.equal(nullResult.metadata.primaryFamily, 'empty');
    assert.equal(nullResult.metadata.audit.ok, false);
    assert.equal(nullResult.metadata.audit.reason, 'invalid-molecule');
    assert.equal(nullResult.coords.size, 0);
    assert.equal(nullResult.layoutGraph, null);

    assert.equal(emptyResult.metadata.stage, 'unsupported');
    assert.equal(emptyResult.metadata.primaryFamily, 'empty');
    assert.equal(emptyResult.metadata.audit.ok, false);
    assert.equal(emptyResult.metadata.audit.reason, 'empty-molecule');
    assert.equal(emptyResult.coords.size, 0);
    assert.equal(emptyResult.layoutGraph, null);
  });

  it('generateCoords returns coordinates for supported simple families', () => {
    const result = generateCoords(makeEthane());
    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.primaryFamily, 'acyclic');
    const xs = [...result.coords.values()].map(position => position.x).sort((firstValue, secondValue) => firstValue - secondValue);
    assert.deepEqual(xs, [0, 1.5]);
    assert.deepEqual([...new Set([...result.coords.values()].map(position => position.y))], [0]);
  });

  it('refineCoords carries touched-atom metadata for partial relayout entry', () => {
    const result = refineCoords(makeEthane(), {
      existingCoords: new Map([['a0', { x: 0, y: 0 }]]),
      touchedAtoms: new Set(['a0']),
      touchedBonds: new Set(['b0'])
    });
    assert.equal(result.metadata.refine, true);
    assert.equal(result.metadata.touchedAtomCount, 1);
    assert.equal(result.metadata.touchedBondCount, 1);
    assert.equal(result.metadata.existingCoordCount, 1);
    assert.equal(result.metadata.stage, 'coordinates-ready');
  });

  it('refineCoords preserves untouched disconnected components from existing coordinates', () => {
    const result = refineCoords(makeDisconnectedEthanes(), {
      existingCoords: new Map([
        ['a0', { x: 0, y: 0 }],
        ['a1', { x: 1.5, y: 0 }],
        ['c0', { x: 10, y: 3 }],
        ['c1', { x: 11.5, y: 3 }]
      ]),
      touchedAtoms: new Set(['a0'])
    });

    assert.equal(result.metadata.refine, true);
    assert.equal(result.metadata.preservedComponentCount, 1);
    assert.deepEqual(result.coords.get('c0'), { x: 10, y: 3 });
    assert.deepEqual(result.coords.get('c1'), { x: 11.5, y: 3 });
  });

  it('refineCoords re-idealizes a fully specified acyclic component when no touched hints are provided', () => {
    const seed = generateCoords(parseSMILES('CC(C)C'), { suppressH: true });
    const existingCoords = new Map(
      [...seed.coords.entries()].map(([atomId, position]) => [
        atomId,
        atomId === 'C3'
          ? { x: position.x + 0.18, y: position.y + 0.09 }
          : { ...position }
      ])
    );
    const result = refineCoords(parseSMILES('CC(C)C'), {
      existingCoords,
      suppressH: true
    });

    assert.equal(result.metadata.refine, true);
    assert.equal(result.metadata.preservedComponentCount, 0);
    assertApproxTrigonal(result.coords, 'C2', ['C1', 'C3', 'C4'], 1e-6);
  });

  it('refineCoords keeps the existing handedness of an unconstrained acyclic bend', () => {
    const seed = generateCoords(parseSMILES('CCO'), { suppressH: true });
    const existingCoords = new Map(
      [...seed.coords.entries()].map(([atomId, position]) => [
        atomId,
        atomId === 'O3' ? { x: position.x, y: -position.y } : { ...position }
      ])
    );
    const existingArea = signedTriangleArea(existingCoords, 'C1', 'C2', 'O3');
    const result = refineCoords(parseSMILES('CCO'), {
      existingCoords,
      suppressH: true
    });

    assert.equal(Math.sign(signedTriangleArea(result.coords, 'C1', 'C2', 'O3')), Math.sign(existingArea));
  });

  it('keeps previously failing real-world structures from collapsing or stacking branches', () => {
    const cases = [
      {
        smiles: 'C1=CC=C(C=C1)C(C(=O)O)(N)P(=O)(O)O',
        minDistance: 0.5,
        extraCheck(result) {
          const carbonylCarbon = result.coords.get('C8');
          const phosphorus = result.coords.get('P12');
          assert.ok(carbonylCarbon);
          assert.ok(phosphorus);
          assert.ok(Math.hypot(carbonylCarbon.x - phosphorus.x, carbonylCarbon.y - phosphorus.y) > 1);
          assertApproxTetrahedralSpread(result.coords, 'C7', ['C4', 'C8', 'N11', 'P12']);
          assertApproxTrigonal(result.coords, 'C8', ['C7', 'O9', 'O10']);
        }
      },
      {
        smiles: 'CC(C)(C1=CC(=CC(=C1O)C(C)(C)C)O)C(C)(C)C',
        minDistance: 0.75
      },
      {
        smiles: 'N#CC(C#N)=C(C#N)C#N',
        minDistance: 1.5,
        extraCheck(result) {
          assertApproxTrigonal(result.coords, 'C3', ['C2', 'C4', 'C6']);
          assertApproxTrigonal(result.coords, 'C6', ['C3', 'C7', 'C9']);
        }
      },
      {
        smiles: 'CN1C2CCC1C(C(OC)=O)C(OC(c3ccccc3)=O)C2',
        minDistance: 0.75
      }
    ];

    for (const testCase of cases) {
      const molecule = parseSMILES(testCase.smiles);
      const result = generateCoords(molecule, { suppressH: true });

      assert.equal(result.metadata.stage, 'coordinates-ready');
      assert.ok(minNonBondedDistance(molecule, result.coords) > testCase.minDistance);
      testCase.extraCheck?.(result);
    }
  });

  it('preserves configured Z geometry for long conjugated polyenes', () => {
    const molecule = parseSMILES(String.raw`CC\C=C/C\C=C/C\C=C/C\C=C/C\C=C/CCCC(=O)O`);
    const result = generateCoords(molecule, { suppressH: true });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.stereo.ezCheckedBondCount, 5);
    assert.equal(result.metadata.stereo.ezViolationCount, 0);
    assert.equal(result.metadata.audit.stereoContradiction, false);
    assert.equal(typeof result.metadata.cleanupStereoReflections, 'number');
    for (const check of result.metadata.stereo.ezChecks) {
      assert.equal(check.target, 'Z');
      assert.equal(check.actual, 'Z');
      assert.equal(check.ok, true);
    }
  });

  it('lays out a previously crashing fused-plus-spiro macrolide scaffold', () => {
    const molecule = parseSMILES(String.raw`COC[C@H]1O[C@@H](O[C@@H]2OC[C@@H]3O[C@@]4(OC[C@@H](OC(=O)c5c(C)cc(O)cc5O)[C@@H]6OCO[C@@H]46)O[C@H]3[C@H]2OCCN=[N+]=[N-])[C@@H](OC)[C@@H](O)[C@@H]1O[C@@H]7O[C@H](C)[C@H](OC)[C@H](O[C@@H]8O[C@H](C)[C@H]9O[C@]%10(C[C@@H](O)[C@H](O[C@H]%11C[C@@H](O[C@H]%12C[C@@](C)([C@@H](OC)[C@H](C)O%12)[N+](=O)[O-])[C@H](OC(=O)c%13c(C)c(Cl)c(O)c(Cl)c%13OC)[C@@H](C)O%11)[C@@H](C)O%10)O[C@]9(C)[C@@H]8O)[C@@]7(C)O`);
    const result = generateCoords(molecule, { suppressH: true });
    const visibleAtomCount = [...result.layoutGraph.atoms.values()].filter(atom =>
      !(result.layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible)
    ).length;

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.placedComponentCount, 1);
    assert.equal(result.metadata.unplacedComponentCount, 0);
    assert.equal(result.coords.size, visibleAtomCount);
  });
});
