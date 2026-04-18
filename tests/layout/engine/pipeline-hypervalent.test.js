import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { angleOf, angularDifference, sub } from '../../../src/layout/engine/geometry/vec2.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';

/**
 * Asserts that each monoxo phosphate center in the result sits on an
 * orthogonal cross around its anchored single bond.
 * @param {object} result - Pipeline result.
 * @param {string[]} phosphorusAtomIds - Phosphorus atom ids to validate.
 * @returns {void}
 */
function assertOrthogonalMonoxoPhosphates(result, phosphorusAtomIds) {
  for (const phosphorusAtomId of phosphorusAtomIds) {
    const phosphorusPosition = result.coords.get(phosphorusAtomId);
    const singleAngles = [];
    let multipleAngle = null;
    let anchoredSingleAngle = null;

    for (const bond of result.layoutGraph.bondsByAtomId.get(phosphorusAtomId) ?? []) {
      const neighborAtomId = bond.a === phosphorusAtomId ? bond.b : bond.a;
      const neighborAtom = result.layoutGraph.atoms.get(neighborAtomId);
      const neighborPosition = result.coords.get(neighborAtomId);
      assert.ok(neighborAtom);
      assert.ok(neighborPosition);
      const angle = angleOf(sub(neighborPosition, phosphorusPosition));
      if ((bond.order ?? 1) >= 2) {
        multipleAngle = angle;
      } else {
        singleAngles.push(angle);
        if ((neighborAtom.heavyDegree ?? 0) > 1) {
          anchoredSingleAngle = angle;
        }
      }
    }

    assert.equal(singleAngles.length, 3);
    assert.notEqual(multipleAngle, null);
    assert.notEqual(anchoredSingleAngle, null);
    assert.ok(Math.abs(angularDifference(anchoredSingleAngle, multipleAngle) - Math.PI) < 1e-6);

    const flankAngles = singleAngles.filter(singleAngle => singleAngle !== anchoredSingleAngle);
    assert.equal(flankAngles.length, 2);
    assert.ok(Math.abs(angularDifference(flankAngles[0], flankAngles[1]) - Math.PI) < 1e-6);
    assert.ok(Math.abs(angularDifference(anchoredSingleAngle, flankAngles[0]) - Math.PI / 2) < 1e-6);
    assert.ok(Math.abs(angularDifference(anchoredSingleAngle, flankAngles[1]) - Math.PI / 2) < 1e-6);
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
    assert.equal(result.metadata.stageTelemetry.selectedStage, 'finalHypervalentTouchup');
    assert.equal(phosphorusAtomIds.length, 2);
    assertOrthogonalMonoxoPhosphates(result, phosphorusAtomIds);
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
    assertOrthogonalMonoxoPhosphates(result, phosphorusAtomIds);
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
    assertOrthogonalMonoxoPhosphates(result, phosphorusAtomIds);
  });
});
