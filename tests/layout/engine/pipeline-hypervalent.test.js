import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { angleOf, angularDifference, sub } from '../../../src/layout/engine/geometry/vec2.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';

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
  });
});
