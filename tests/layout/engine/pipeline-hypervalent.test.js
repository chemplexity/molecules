import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { angleOf, angularDifference, distance, sub } from '../../../src/layout/engine/geometry/vec2.js';
import { pointInPolygon } from '../../../src/layout/engine/geometry/polygon.js';
import { computeIncidentRingOutwardAngles } from '../../../src/layout/engine/geometry/ring-direction.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';
import {
  hasHypervalentAngleTidyNeed,
  measureOrthogonalHypervalentDeviation
} from '../../../src/layout/engine/cleanup/hypervalent-angle-tidy.js';
import {
  measureTerminalMultipleBondLeafFanPenalty
} from '../../../src/layout/engine/cleanup/presentation/ring-terminal-hetero.js';

function assertOrthogonalCross(result, centerAtomIds) {
  for (const centerAtomId of centerAtomIds) {
    const centerPosition = result.coords.get(centerAtomId);
    const angles = [];

    for (const bond of result.layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
      const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      const neighborAtom = result.layoutGraph.atoms.get(neighborAtomId);
      const neighborPosition = result.coords.get(neighborAtomId);
      assert.ok(neighborAtom);
      assert.ok(neighborPosition);
      if (neighborAtom.element === 'H') {
        continue;
      }
      angles.push(angleOf(sub(neighborPosition, centerPosition)));
    }

    assert.equal(angles.length, 4);
    const sortedAngles = [...angles]
      .map(angle => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
      .sort((first, second) => first - second);
    const deltas = sortedAngles.map(
      (angle, index) => ((sortedAngles[(index + 1) % sortedAngles.length] - angle) + Math.PI * 2) % (Math.PI * 2)
    );
    for (const delta of deltas) {
      assert.ok(Math.abs(delta - Math.PI / 2) < 1e-6);
    }
  }
}

function assertOppositePair(result, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const centerPosition = result.coords.get(centerAtomId);
  const firstAngle = angleOf(sub(result.coords.get(firstNeighborAtomId), centerPosition));
  const secondAngle = angleOf(sub(result.coords.get(secondNeighborAtomId), centerPosition));
  const rawSeparation = ((Math.abs(firstAngle - secondAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const separation = Math.min(rawSeparation, Math.PI * 2 - rawSeparation);
  assert.ok(Math.abs(separation - Math.PI) < 1e-6);
}

function assertBondAngle(result, firstAtomId, centerAtomId, secondAtomId, expectedAngle) {
  const foldedSeparation = measureBondAngle(result, firstAtomId, centerAtomId, secondAtomId);
  assert.ok(Math.abs(foldedSeparation - expectedAngle) < 1e-6);
}

function measureBondAngle(result, firstAtomId, centerAtomId, secondAtomId) {
  const centerPosition = result.coords.get(centerAtomId);
  const firstAngle = angleOf(sub(result.coords.get(firstAtomId), centerPosition));
  const secondAngle = angleOf(sub(result.coords.get(secondAtomId), centerPosition));
  const separation = ((Math.abs(firstAngle - secondAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const foldedSeparation = Math.min(separation, Math.PI * 2 - separation);
  return foldedSeparation;
}

function assertExteriorOxoV(result, centerAtomId, oxoAtomIds, expectedSpread) {
  const centerPosition = result.coords.get(centerAtomId);
  const outwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, centerAtomId, atomId => result.coords.get(atomId) ?? null);
  assert.equal(outwardAngles.length, 1);
  const outwardAngle = outwardAngles[0];
  const oxoAngles = oxoAtomIds.map(oxoAtomId => angleOf(sub(result.coords.get(oxoAtomId), centerPosition)));

  assert.ok(Math.abs(angularDifference(oxoAngles[0], oxoAngles[1]) - expectedSpread) < 1e-6);
  for (const oxoAngle of oxoAngles) {
    assert.ok(Math.abs(angularDifference(oxoAngle, outwardAngle) - expectedSpread / 2) < 1e-6);
  }
}

function assertIncidentRingOutwardBond(result, centerAtomId, neighborAtomId) {
  const centerPosition = result.coords.get(centerAtomId);
  const neighborPosition = result.coords.get(neighborAtomId);
  assert.ok(centerPosition);
  assert.ok(neighborPosition);

  const outwardAngles = computeIncidentRingOutwardAngles(result.layoutGraph, centerAtomId, atomId => result.coords.get(atomId) ?? null);
  assert.equal(outwardAngles.length, 1);

  const bondAngle = angleOf(sub(neighborPosition, centerPosition));
  assert.ok(
    outwardAngles.some(outwardAngle => angularDifference(bondAngle, outwardAngle) < 1e-6)
  );
}

function assertOxoLigandsOutsideIncidentRings(result, centerAtomId, oxoAtomIds) {
  const incidentRings = result.layoutGraph.atomToRings.get(centerAtomId) ?? [];
  assert.ok(incidentRings.length > 0);
  for (const ring of incidentRings) {
    const polygon = ring.atomIds.map(atomId => result.coords.get(atomId));
    for (const oxoAtomId of oxoAtomIds) {
      assert.equal(pointInPolygon(result.coords.get(oxoAtomId), polygon), false);
    }
  }
}

describe('layout/engine/pipeline — hypervalent cleanup', () => {
  it('keeps nitro-style sulfonamide oxo leaves on a trigonal nitrogen fan', () => {
    const result = runPipeline(parseSMILES('CCCCOC1=CC=CC=C1SN(=O)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assertBondAngle(result, 'S12', 'N13', 'O14', (2 * Math.PI) / 3);
    assertBondAngle(result, 'S12', 'N13', 'O15', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O14', 'N13', 'O15', (2 * Math.PI) / 3);
  });

  it('keeps charged sulfoxide linkers on a trigonal three-heavy fan', () => {
    const result = runPipeline(parseSMILES('COc1nc(C[S+]([O-])c2nc3ccccc3[nH]2)nc4scc(c5ccccc5)c14'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assertBondAngle(result, 'C6', 'S7', 'O8', (2 * Math.PI) / 3);
    assertBondAngle(result, 'C6', 'S7', 'C9', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O8', 'S7', 'C9', (2 * Math.PI) / 3);
    assertIncidentRingOutwardBond(result, 'C9', 'S7');
  });

  it('keeps crowded aryl nitro groups with two terminal oxo leaves on trigonal nitrogen fans', () => {
    const smiles = 'FC(F)(F)C1=NN=C([N-]C2=C(C=C(C=C2N(=O)=O)C(F)(F)F)N(=O)=O)S1';

    for (const suppressH of [false, true]) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.stage, 'coordinates-ready');
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assertBondAngle(result, 'O17', 'N16', 'O18', (2 * Math.PI) / 3);
      assertBondAngle(result, 'O17', 'N16', 'C15', (2 * Math.PI) / 3);
      assertBondAngle(result, 'O18', 'N16', 'C15', (2 * Math.PI) / 3);
      assertBondAngle(result, 'C11', 'N23', 'O24', (2 * Math.PI) / 3);
      assertBondAngle(result, 'C11', 'N23', 'O25', (2 * Math.PI) / 3);
      assertBondAngle(result, 'O24', 'N23', 'O25', (2 * Math.PI) / 3);
    }
  });

  it('keeps aryl nitro oxo leaves trigonal when a neighboring carbonyl blocks the exact slot', () => {
    const result = runPipeline(
      parseSMILES('CC(=O)C1=CC=CC(=C1N(CC1=CC=C(C=C1)C1=CC=CC=C1C1=NN=NN1CC1=CC=CC=C1)C(=O)OC(C)(C)C)N(=O)=O'),
      {
        suppressH: true,
        auditTelemetry: true
      }
    );

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assertBondAngle(result, 'C8', 'N43', 'O44', (2 * Math.PI) / 3);
    assertBondAngle(result, 'C8', 'N43', 'O45', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O44', 'N43', 'O45', (2 * Math.PI) / 3);
    assertBondAngle(result, 'N10', 'C36', 'O37', (2 * Math.PI) / 3);
    assertBondAngle(result, 'N10', 'C36', 'O38', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O37', 'C36', 'O38', (2 * Math.PI) / 3);
    assert.ok(measureTerminalMultipleBondLeafFanPenalty(result.layoutGraph, result.coords).maxDeviation < 0.65);
  });

  it('orthogonalizes monoxo phosphonate leaf ligands in mixed fused layouts', () => {
    const result = runPipeline(parseSMILES('OC(CC1=CC(=CC=C1)C1=CC=CC2=C1OC1=C2C=CC=C1)(P(O)(O)=O)P(O)(O)=O'), {
      suppressH: true,
      auditTelemetry: true
    });
    const phosphorusAtomIds = [...result.layoutGraph.atoms.values()].filter(atom => atom.element === 'P').map(atom => atom.id);

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.ok(
      ['checkpoint', 'presentation', 'specialist'].includes(result.metadata.cleanupTelemetry.selectedStageCategory)
    );
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(phosphorusAtomIds.length, 2);
    assertOrthogonalCross(result, phosphorusAtomIds);
  });

  it('re-orthogonalizes linked sugar phosphates after the final overlap-clearing ring-substituent touchup', () => {
    const result = runPipeline(
      parseSMILES('O[C@H]1[C@H](OP(O)(O)=O)[C@H](OP(O)(O)=O)[C@@H](OP(O)(O)=O)[C@@H](OP(O)(O)=O)[C@@H]1OP(O)(O)=O'),
      {
        suppressH: true,
        auditTelemetry: true
      }
    );
    const phosphorusAtomIds = [...result.layoutGraph.atoms.values()].filter(atom => atom.element === 'P').map(atom => atom.id);

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(phosphorusAtomIds.length, 5);
    assertOrthogonalCross(result, phosphorusAtomIds);
  });

  it('keeps aryl phosphate monoesters orthogonal after a late overlap-clearing linker rotation', () => {
    const result = runPipeline(parseSMILES('CC1=CC(C=O)=C(OP(O)(O)=O)C(C=O)=C1'), {
      suppressH: true,
      auditTelemetry: true
    });
    const phosphorusAtomIds = [...result.layoutGraph.atoms.values()].filter(atom => atom.element === 'P').map(atom => atom.id);

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.ok(result.metadata.policy.postCleanupHooks.includes('ring-substituent-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(phosphorusAtomIds.length, 1);
    assertOrthogonalCross(result, phosphorusAtomIds);
  });

  it('keeps condensed nucleotide triphosphates on strict phosphate crosses', () => {
    const result = runPipeline(
      parseSMILES('NC1=NC2=C(C(C[NH3+])=CN2C2CC(OCN=[N+]=[N-])C(COP([O-])(=O)OP([O-])(=O)OP([O-])([O-])=O)O2)C(=O)N1'),
      {
        suppressH: true,
        auditTelemetry: true
      }
    );
    const phosphorusAtomIds = [...result.layoutGraph.atoms.values()].filter(atom => atom.element === 'P').map(atom => atom.id);

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(phosphorusAtomIds.length, 3);
    assertOrthogonalCross(result, phosphorusAtomIds);
  });

  it('keeps phosphoramidate phosphorus centers on an exact cross even when alkoxy and carbon ligand subtrees must rotate together', () => {
    const result = runPipeline(parseSMILES('CCOP(=O)(OCC)[C@@H](C)NC(=O)N(CCCl)N=O'), {
      suppressH: true,
      auditTelemetry: true
    });
    const phosphorusAtomIds = [...result.layoutGraph.atoms.values()].filter(atom => atom.element === 'P').map(atom => atom.id);

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(['specialist', 'stabilization'].includes(result.metadata.cleanupTelemetry.selectedStageCategory));
    assert.equal(phosphorusAtomIds.length, 1);
    assertOrthogonalCross(result, phosphorusAtomIds);
  });

  it('keeps explicit-hydrogen monoxo phosphonate centers on a heavy-atom trigonal spread', () => {
    const smiles = '[H][C@](O)(C(=O)NCCC(=O)NCCSC(=O)CCCCCC)C(C)(C)CO[P@]([H])(O)=O';

    for (const suppressH of [false, true]) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH,
        auditTelemetry: true
      });
      const phosphorusAtomIds = [...result.layoutGraph.atoms.values()].filter(atom => atom.element === 'P').map(atom => atom.id);

      assert.deepEqual(phosphorusAtomIds, ['P28']);
      const heavyNeighborIds = (result.layoutGraph.bondsByAtomId.get('P28') ?? [])
        .map(bond => (bond.a === 'P28' ? bond.b : bond.a))
        .filter(atomId => result.layoutGraph.atoms.get(atomId)?.element !== 'H' && result.coords.has(atomId));

      assert.equal(heavyNeighborIds.length, 3);
      for (let firstIndex = 0; firstIndex < heavyNeighborIds.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < heavyNeighborIds.length; secondIndex++) {
          assertBondAngle(
            result,
            heavyNeighborIds[firstIndex],
            'P28',
            heavyNeighborIds[secondIndex],
            (2 * Math.PI) / 3
          );
        }
      }
      assert.equal(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['P28']) }), 0);
      assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    }
  });

  it('keeps carbon-bound explicit-hydrogen monoxo phosphonate chains on a heavy-atom trigonal spread', () => {
    const smiles = '[H][P@@](=O)(CCCCCCCCCCC)OCCCC';

    for (const suppressH of [false, true]) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      });

      assert.equal(result.metadata.stage, 'coordinates-ready');
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assertBondAngle(result, 'O3', 'P2', 'C4', (2 * Math.PI) / 3);
      assertBondAngle(result, 'O3', 'P2', 'O15', (2 * Math.PI) / 3);
      assertBondAngle(result, 'C4', 'P2', 'O15', (2 * Math.PI) / 3);
      assertBondAngle(result, 'P2', 'C4', 'C5', (2 * Math.PI) / 3);
    }
  });

  it('keeps suppressed-h bis-oxo sulfones on a visible trigonal spread', () => {
    const result = runPipeline(parseSMILES('CC1(CCC(=O)NCCSSCCC(=O)ON2C(=O)C[C-](C2=O)S(=O)=O)N=N1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S24']) }) < 1e-9);
    assertBondAngle(result, 'C21', 'S24', 'O25', (2 * Math.PI) / 3);
    assertBondAngle(result, 'C21', 'S24', 'O26', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O25', 'S24', 'O26', (2 * Math.PI) / 3);
  });

  it('keeps bis-oxo sulfones with aryl and amine single-bond ligands on the correct opposite axis', () => {
    const result = runPipeline(parseSMILES('Clc1ccccc1CCNC(=O)Cn2ccc3cc(ccc23)S(=O)(=O)N4CCCCCC4'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertOppositePair(result, 'S23', 'C19', 'N26');
    assertOppositePair(result, 'S23', 'O24', 'O25');
    assertBondAngle(result, 'C18', 'C19', 'S23', (2 * Math.PI) / 3);
    assertBondAngle(result, 'C20', 'C19', 'S23', (2 * Math.PI) / 3);
  });

  it('keeps aryl sulfonyl chlorides orthogonal when a neighboring alkoxy chain crowds the oxo slot', () => {
    const result = runPipeline(parseSMILES('CCCOC1=C(C=CC=C1S(Cl)(=O)=O)C1=NN2C(CCC)=NC(C)=C2C(=O)N1'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S11']) }) < 1e-9);
    assertOrthogonalCross(result, ['S11']);
    assertOppositePair(result, 'S11', 'C10', 'Cl12');
    assertOppositePair(result, 'S11', 'O13', 'O14');
  });

  it('keeps bulky aryl sulfonamide ligands on an exact sulfur cross', () => {
    const result = runPipeline(parseSMILES('CN1N=C(C=C1C1=CC=C(S1)S(=O)(=O)N1CCN(CC1)C1=C(OCC2(C)CC2)C(=O)N(N=C1)C1=CC=CC(Cl)=C1)C(F)(F)F'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S12']) }) < 1e-9);
    assertOrthogonalCross(result, ['S12']);
    assertOppositePair(result, 'S12', 'C10', 'N15');
    assertOppositePair(result, 'S12', 'O13', 'O14');
  });

  it('keeps aryl sulfonamide oxo ligands opposed after overlap cleanup clears neighboring ester oxygen', () => {
    const result = runPipeline(parseSMILES('COC(=O)c1cc(F)ccc1NS(=O)(=O)c2cc(Cl)ccc2Cl'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S13']) }) < 1e-9);
    assertBondAngle(result, 'O4', 'C3', 'C5', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O4', 'C3', 'O2', (2 * Math.PI) / 3);
    assertBondAngle(result, 'C5', 'C3', 'O2', (2 * Math.PI) / 3);
    assertOrthogonalCross(result, ['S13']);
    assertOppositePair(result, 'S13', 'C16', 'N12');
    assertOppositePair(result, 'S13', 'O14', 'O15');
  });

  it('keeps constrained diaryl sulfone oxo ligands opposed without rotating bulky rings together', () => {
    const result = runPipeline(parseSMILES('Cc1cc(C)cc(c1)S(=O)(=O)c2c([nH]c3ccc(Cl)cc23)C(=O)NCc4ccccc4F'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S9']) }) < 1e-9);
    assertOppositePair(result, 'S9', 'O10', 'O11');
    assert.ok(measureBondAngle(result, 'C7', 'S9', 'O10') > Math.PI / 4);
    assert.ok(measureBondAngle(result, 'C12', 'S9', 'O10') > Math.PI / 4);
  });

  it('keeps crowded bridged aryl sulfones nearly orthogonal without stacking an oxo onto the cage', () => {
    const result = runPipeline(parseSMILES('COC1=CC=C(Cl)C=C1CC1CN2C(=O)CC2(C1=O)S(=O)(=O)C1=CC(=CC=C1OC)C(F)(F)F'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S20']) }) < (Math.PI / 12) ** 2);
    assertOppositePair(result, 'S20', 'C17', 'C23');
    assert.ok(measureBondAngle(result, 'O21', 'S20', 'O22') > Math.PI - 1e-6);
    assert.ok(Math.abs(measureBondAngle(result, 'C17', 'S20', 'O21') - Math.PI / 2) < Math.PI / 32);
    assert.ok(Math.abs(measureBondAngle(result, 'C17', 'S20', 'O22') - Math.PI / 2) < Math.PI / 32);
    assert.ok(Math.abs(measureBondAngle(result, 'C23', 'S20', 'O21') - Math.PI / 2) < Math.PI / 32);
    assert.ok(Math.abs(measureBondAngle(result, 'C23', 'S20', 'O22') - Math.PI / 2) < Math.PI / 32);
    assert.ok(distance(result.coords.get('C16'), result.coords.get('O22')) > result.layoutGraph.options.bondLength * 0.55);
  });

  it('uses the exact sulfone cross when one ring-linked aryl side can rotate cleanly', () => {
    const result = runPipeline(parseSMILES('NC(=O)C1=CC(=CC=C1OCC1=CC=CC=C1)S(=O)(=O)C1=CC=C(CC[NH+](<CC(O)C2=CC=C(Cl)N=C2>)CC2=CC=CC=C2)C=C1'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S18']) }) < 1e-9);
    assertOrthogonalCross(result, ['S18']);
    assertOppositePair(result, 'S18', 'C6', 'C21');
    assertOppositePair(result, 'S18', 'O19', 'O20');
  });

  it('keeps terminal-aryl sulfone and sulfonamide centers on exact crosses after compact branch relief', () => {
    const smiles = 'FC(F)(F)c1ccc(cc1S(=O)(=O)NC2CCN(CC2)S(=O)(=O)c3ccccc3)S(=O)(=O)c4ccccc4';

    for (const finalLandscapeOrientation of [false, true]) {
      const result = runPipeline(parseSMILES(smiles), {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation
      });

      assert.equal(result.metadata.stage, 'coordinates-ready');
      assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
      assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
      assert.equal(result.metadata.audit.ok, true);
      assert.equal(result.metadata.audit.severeOverlapCount, 0);
      assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
      assert.equal(result.metadata.audit.labelOverlapCount, 0);
      assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
      assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, {
        focusAtomIds: new Set(['S11', 'S21', 'S30'])
      }) < 1e-9);
      assertOrthogonalCross(result, ['S11', 'S21', 'S30']);
      assertOppositePair(result, 'S11', 'C10', 'N14');
      assertOppositePair(result, 'S11', 'O12', 'O13');
      assertOppositePair(result, 'S21', 'N18', 'C24');
      assertOppositePair(result, 'S21', 'O22', 'O23');
      assertOppositePair(result, 'S30', 'C8', 'C33');
      assertOppositePair(result, 'S30', 'O31', 'O32');
      assertBondAngle(result, 'C2', 'C5', 'C6', (2 * Math.PI) / 3);
      assertBondAngle(result, 'C2', 'C5', 'C10', (2 * Math.PI) / 3);
    }
  });

  it('keeps neighboring sulfonyl centers orthogonal around planar bis-sulfonamide nitrogens', () => {
    const result = runPipeline(parseSMILES('CC(C)N(S(C)(=O)=O)S(C)(=O)=O'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertBondAngle(result, 'C2', 'N4', 'S5', (2 * Math.PI) / 3);
    assertBondAngle(result, 'C2', 'N4', 'S9', (2 * Math.PI) / 3);
    assertBondAngle(result, 'S5', 'N4', 'S9', (2 * Math.PI) / 3);
    assertOrthogonalCross(result, ['S5', 'S9']);
  });

  it('keeps macrocycle sulfonamide aryl linkers on the orthogonal sulfone axes', () => {
    const result = runPipeline(parseSMILES('CN(C)c1cccc2c(cccc12)S(=O)(=O)N3CCCN(CC4CCCCC4)CCCN(CC(=C)C3)S(=O)(=O)c5ccc(C)cc5'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S14', 'S37']) }) < 1e-9);
    assertOrthogonalCross(result, ['S14', 'S37']);
    assertOppositePair(result, 'S14', 'C9', 'N17');
    assertOppositePair(result, 'S14', 'O15', 'O16');
    assertOppositePair(result, 'S37', 'N32', 'C40');
    assertOppositePair(result, 'S37', 'O38', 'O39');
  });

  it('keeps bis-sulfonyl imine carbon heavy neighbors trigonal while preserving sulfur crosses', () => {
    const result = runPipeline(parseSMILES('CC=CC=CC=NC(S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertBondAngle(result, 'N7', 'C8', 'S9', (2 * Math.PI) / 3);
    assertBondAngle(result, 'N7', 'C8', 'S16', (2 * Math.PI) / 3);
    assertBondAngle(result, 'S9', 'C8', 'S16', (2 * Math.PI) / 3);
    assertOrthogonalCross(result, ['S9', 'S16']);
  });

  it('keeps suppressed terminal sulfonyl sulfur hydrogens from distorting the visible heavy-atom fan', () => {
    const result = runPipeline(parseSMILES('FC1=CC=CC(CC2C(CC3=CC=C(CC4(CCC4)NS(=O)=O)C=C23)[NH+]2CCC2)=C1'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertBondAngle(result, 'N20', 'S21', 'O22', (2 * Math.PI) / 3);
    assertBondAngle(result, 'N20', 'S21', 'O23', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O22', 'S21', 'O23', (2 * Math.PI) / 3);
    assert.ok(measureTerminalMultipleBondLeafFanPenalty(result.layoutGraph, result.coords).maxDeviation < 1e-9);
  });

  it('keeps bulky suppressed-h terminal sulfonyl visible ligands trigonal', () => {
    const result = runPipeline(parseSMILES('CN1C(=O)N(C2=CC=C(CC(NC(=O)C3=CC=C(C=C3F)N(C3=CC=NC=C3)S(=O)=O)C([O-])=O)C=C2)C(=O)C2=CC=NC=C12'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assertBondAngle(result, 'N22', 'S29', 'O30', (2 * Math.PI) / 3);
    assertBondAngle(result, 'N22', 'S29', 'O31', (2 * Math.PI) / 3);
    assertBondAngle(result, 'O30', 'S29', 'O31', (2 * Math.PI) / 3);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S29']) }) < 1e-9);
    assert.ok(measureTerminalMultipleBondLeafFanPenalty(result.layoutGraph, result.coords).maxDeviation < 1e-9);
  });

  it('rotates compact diaryl sulfonyl ligands so ring sulfonamides keep an exact sulfur cross', () => {
    const result = runPipeline(parseSMILES('ONC(=O)[C@H]1C[C@@H](CN1S(=O)(=O)c2ccc(Oc3ccccc3)cc2)N4CCCCC4'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertOppositePair(result, 'S12', 'O13', 'O14');
    assertOppositePair(result, 'S12', 'N11', 'C15');
  });

  it('keeps ring-anchored sulfonyl exits and adjacent trifluoromethyl leaves exact', () => {
    const result = runPipeline(parseSMILES('CC(C)(O)C(=O)NNC(=O)CC1CCC2=CC(=CC=C2N1S(=O)(=O)C1=CC=C(F)C=C1)C(O)(C(F)(F)F)C(F)(F)F'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertBondAngle(result, 'C12', 'N21', 'S22', (2 * Math.PI) / 3);
    assertBondAngle(result, 'C20', 'N21', 'S22', (2 * Math.PI) / 3);
    assertOppositePair(result, 'S22', 'N21', 'C25');
    assertOppositePair(result, 'S22', 'O23', 'O24');
    assertBondAngle(result, 'C32', 'C34', 'F35', Math.PI / 2);
    assertOppositePair(result, 'C34', 'F35', 'F37');
    assertBondAngle(result, 'C32', 'C38', 'F41', Math.PI / 2);
    assertOppositePair(result, 'C38', 'F39', 'F41');
  });

  it('places ring-embedded sulfone oxo ligands together outside the ring', () => {
    const result = runPipeline(parseSMILES('CN(C1CCS(=O)(=O)C1)C(=O)CNC(=O)c2cc3cc(Cl)ccc3[nH]2'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertExteriorOxoV(result, 'S6', ['O7', 'O8'], Math.PI / 2);
  });

  it('keeps fused aromatic sulfone oxo leaves outside while preserving the adjacent divalent nitrogen angle', () => {
    const result = runPipeline(parseSMILES('Brc1ccccc1C(=O)N(CCC#N)NC2=NS(=O)(=O)c3ccccc23'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S18']) }) < 1e-9);
    assertExteriorOxoV(result, 'S18', ['O19', 'O20'], Math.PI / 2);
    assertBondAngle(result, 'C16', 'N15', 'N10', (2 * Math.PI) / 3);
  });

  it('uses a compact exterior sulfone V when the full ring-embedded spread would overlap a fused neighbor', () => {
    const result = runPipeline(parseSMILES('CC1C2NC3(COC12C=O)C(C)NCS3(=O)=O'), {
      suppressH: true,
      auditTelemetry: true
    });
    const centerPosition = result.coords.get('S15');
    const oxoAngles = ['O16', 'O17'].map(oxoAtomId => angleOf(sub(result.coords.get(oxoAtomId), centerPosition)));
    const outwardAngle = computeIncidentRingOutwardAngles(result.layoutGraph, 'S15', atomId => result.coords.get(atomId) ?? null)[0];

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(result.metadata.cleanupPostHookNudges > 0);
    assertOxoLigandsOutsideIncidentRings(result, 'S15', ['O16', 'O17']);
    assert.ok(angularDifference(oxoAngles[0], oxoAngles[1]) > Math.PI / 3);
    for (const oxoAngle of oxoAngles) {
      assert.ok(angularDifference(oxoAngle, outwardAngle) < Math.PI / 2);
    }
  });

  it('slides crowded bridged ring-embedded sulfone oxo ligands onto the exterior side', () => {
    const result = runPipeline(parseSMILES('CC1CS(=O)(=O)C2(O)C(=O)C1C=C2C#C'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assertOxoLigandsOutsideIncidentRings(result, 'S4', ['O5', 'O6']);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S4']) }) < 1e-9);
  });

  it('places macrocycle-embedded sulfone oxo ligands before macrocycle branch budgets filter candidates', () => {
    const result = runPipeline(parseSMILES('CN(C1CCCCCCCCCS(=O)(=O)C1)C(=O)CNC(=O)c2cc3cc(Cl)ccc3[nH]2'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertExteriorOxoV(result, 'S13', ['O14', 'O15'], Math.PI / 2);
  });

  it('keeps longer macrocycle-embedded sulfone oxo ligands from being clipped by asymmetric budgets', () => {
    const result = runPipeline(parseSMILES('CN(C1CCCCCCCCCCCCCS(=O)(=O)C1)C(=O)CNC(=O)c2cc3cc(Cl)ccc3[nH]2'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertExteriorOxoV(result, 'S17', ['O18', 'O19'], Math.PI / 2);
  });

  it('keeps exocyclic macrocycle sulfones orthogonal without pushing oxos into nearby carbonyls', () => {
    const result = runPipeline(parseSMILES('CO[C@H]1CCCCCCCCC[C@@H](C)OC(=O)C(CC1=O)S(=O)(=O)c2ccccc2'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.ok(['specialist', 'stabilization'].includes(result.metadata.cleanupTelemetry.selectedStageCategory));
    assert.equal(result.metadata.cleanupTelemetry.stages.specialistCleanup.ran, true);
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S24']) }) < 1e-9);
    assertOrthogonalCross(result, ['S24']);
    assertOppositePair(result, 'S24', 'C20', 'C27');
    assertOppositePair(result, 'S24', 'O25', 'O26');
    assert.ok(distance(result.coords.get('O19'), result.coords.get('O25')) > result.layoutGraph.options.bondLength * 0.55);
    assert.ok(distance(result.coords.get('O19'), result.coords.get('O26')) > result.layoutGraph.options.bondLength * 0.55);
  });

  it('keeps crowded acyclic sulfonic acid centers exact by compressing only the terminal oxo leaf', () => {
    const result = runPipeline(parseSMILES('CC(CC#N)(NCC#CS(N)(=O)=O)S(O)(=O)=O'), {
      suppressH: true,
      auditTelemetry: true
    });
    const compressedOxoLength = distance(result.coords.get('S14'), result.coords.get('O16'));

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.cleanupPostHookNudges, 1);
    assertOppositePair(result, 'S14', 'C2', 'O15');
    assertOppositePair(result, 'S14', 'O16', 'O17');
    assertBondAngle(result, 'C2', 'S14', 'O16', Math.PI / 2);
    assertBondAngle(result, 'C2', 'S14', 'O17', Math.PI / 2);
    assert.ok(compressedOxoLength < result.layoutGraph.options.bondLength * 0.98);
    assert.ok(compressedOxoLength >= result.layoutGraph.options.bondLength * 0.95);
  });

  it('keeps ring-attached sulfonic acid centers orthogonal while rotating nearby branches aside', () => {
    const result = runPipeline(parseSMILES('CC(C)C1(CN(C)C=C1C(=O)C#C)S(O)(=O)=O'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S14']) }) < 1e-9);
    assertOppositePair(result, 'S14', 'C4', 'O15');
    assertOppositePair(result, 'S14', 'O16', 'O17');
    assertBondAngle(result, 'C4', 'S14', 'O16', Math.PI / 2);
    assertBondAngle(result, 'C4', 'S14', 'O17', Math.PI / 2);
  });

  it('keeps acyclic sulfonamide oxo ligands orthogonal while moving a nearby pendant ring', () => {
    const result = runPipeline(
      parseSMILES('CN1CCN(CC1)C(=O)N[C@H](CC1=CC=CC=C1)C(=O)N[C@H](CCC1=CC=CC=C1)CCS(=O)(=O)NOCC1=CC=CC=C1'),
      {
        suppressH: true,
        auditTelemetry: true,
        finalLandscapeOrientation: true
      }
    );

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.ok(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['S35']) }) < 1e-9);
    assertOppositePair(result, 'S35', 'C34', 'N38');
    assertOppositePair(result, 'S35', 'O36', 'O37');
    assertBondAngle(result, 'C34', 'S35', 'O36', Math.PI / 2);
    assertBondAngle(result, 'N38', 'S35', 'O36', Math.PI / 2);
    assert.ok(distance(result.coords.get('C19'), result.coords.get('O37')) > result.layoutGraph.options.bondLength * 0.55);
  });

  it('keeps phosphorothioate lipids orthogonal while clearing neighboring carbonyl leaves', () => {
    const result = runPipeline(parseSMILES('CCCCC(=O)OC[C@H](CO[P@@]([S-])(=S)OCC[N+](C)(C)C)OC(=O)CCCC'), {
      suppressH: true,
      auditTelemetry: true,
      finalLandscapeOrientation: true
    });
    const bondLength = result.layoutGraph.options.bondLength;
    const firstCarbonylAngle = measureBondAngle(result, 'O23', 'C24', 'O25');
    const secondCarbonylAngle = measureBondAngle(result, 'O25', 'C24', 'C26');

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.labelOverlapCount, 0);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(hasHypervalentAngleTidyNeed(result.layoutGraph, result.coords), false);
    assert.equal(measureOrthogonalHypervalentDeviation(result.layoutGraph, result.coords, { focusAtomIds: new Set(['P13']) }), 0);
    assertOrthogonalCross(result, ['P13']);
    assertOppositePair(result, 'P13', 'S14', 'S15');
    assertOppositePair(result, 'P13', 'O12', 'O16');
    assert.ok(distance(result.coords.get('S15'), result.coords.get('O25')) > bondLength * 0.57);
    assert.ok(firstCarbonylAngle > (11 * Math.PI) / 20);
    assert.ok(secondCarbonylAngle > (11 * Math.PI) / 20);
  });
});
