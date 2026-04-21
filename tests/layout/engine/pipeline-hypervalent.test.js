import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { angleOf, sub } from '../../../src/layout/engine/geometry/vec2.js';
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
      ['selectedGeometryStereo', 'finalHypervalentTouchup', 'finalAttachedRingRotationTouchup'].includes(result.metadata.stageTelemetry.selectedStage)
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
});
