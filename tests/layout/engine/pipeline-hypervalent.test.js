import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { angleOf, distance, sub } from '../../../src/layout/engine/geometry/vec2.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';

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
  const centerPosition = result.coords.get(centerAtomId);
  const firstAngle = angleOf(sub(result.coords.get(firstAtomId), centerPosition));
  const secondAngle = angleOf(sub(result.coords.get(secondAtomId), centerPosition));
  const separation = ((Math.abs(firstAngle - secondAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const foldedSeparation = Math.min(separation, Math.PI * 2 - separation);
  assert.ok(Math.abs(foldedSeparation - expectedAngle) < 1e-6);
}

describe('layout/engine/pipeline — hypervalent cleanup', () => {
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
    assert.equal(result.metadata.cleanupTelemetry.selectedStageCategory, 'specialist');
    assert.equal(phosphorusAtomIds.length, 1);
    assertOrthogonalCross(result, phosphorusAtomIds);
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

  it('keeps terminal sulfonyl sulfur hydrogens opposite the amine ligand in fused layouts', () => {
    const result = runPipeline(parseSMILES('FC1=CC=CC(CC2C(CC3=CC=C(CC4(CCC4)NS(=O)=O)C=C23)[NH+]2CCC2)=C1'), {
      suppressH: true,
      auditTelemetry: true
    });

    assert.equal(result.metadata.stage, 'coordinates-ready');
    assert.ok(result.metadata.policy.postCleanupHooks.includes('hypervalent-angle-tidy'));
    assert.equal(result.metadata.audit.ok, true);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assertOppositePair(result, 'S21', 'O22', 'O23');
    assertOppositePair(result, 'S21', 'N20', 'H52');
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
});
