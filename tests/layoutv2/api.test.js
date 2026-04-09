import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCoords, refineCoords } from '../../src/layoutv2/api.js';
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

describe('layoutv2/api', () => {
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
});
