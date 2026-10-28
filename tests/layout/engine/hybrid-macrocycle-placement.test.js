import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/index.js';
import { generateCoords, refineCoords } from '../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../src/layout/engine/model/layout-graph.js';
import { classifyRingSystemFamily } from '../../../src/layout/engine/model/scaffold-plan.js';

const HYBRID_MACROCYCLES = [
  String.raw`CC[C@H](C)[C@@H]1O[C@]2(CC[C@@H]1C)C[C@H]3C[C@H](C\C=C(/C)\[C@@H](O[C@H]4C[C@H](OC)[C@H](O[C@H]5C[C@H](OC)[C@H](O)[C@H](C)O5)[C@H](C)O4)[C@@H](C)\C=C\C=C6CO[C@@H]7[C@@H](O)C(=C[C@H](C(=O)O3)[C@@]67O)C)O2`,
  'CCCCC(=O)N[C@H]1CC(=O)NCCCC[C@H](NC(=O)[C@H](Cc2c[nH]c3ccccc23)NC(=O)[C@H](CCCN=C(N)N)NC(=O)[C@@H](Cc4ccccc4)NC(=O)[C@@]5(CCc6ccccc6C5)NC1=O)C(=O)N'
];

const BENZYL_CONTROL = 'CCCCC(=O)N[C@H]1CC(=O)NCCCC[C@H](NC(=O)[C@H](Cc2c[nH]c3ccccc23)NC(=O)[C@H](CCCN=C(N)N)NC(=O)[C@@H](Cc4ccccc4)NC(=O)[C@@H](Cc5ccccc5)NC1=O)C(=O)N';

/**
 * Verifies that all visible heavy atoms have finite coordinates.
 * @param {object} result - Layout API result.
 * @returns {void}
 */
function assertCompleteCleanLayout(result) {
  assert.equal(result.metadata.audit.ok, true);
  assert.equal(result.metadata.audit.missingCoordinateCount, 0);
  assert.equal(result.metadata.audit.nonfiniteCoordinateCount, 0);
  assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
  assert.equal(result.metadata.audit.severeOverlapCount, 0);
  assert.equal(result.metadata.audit.visibleHeavyBondCrossingFailureCount, 0);
  for (const [atomId, atom] of result.layoutGraph.atoms) {
    if (!atom.visible || atom.element === 'H') {
      continue;
    }
    const position = result.coords.get(atomId);
    assert.ok(Number.isFinite(position?.x) && Number.isFinite(position?.y), `missing heavy-atom coordinate for ${atomId}`);
  }
}

describe('hybrid macrocycle placement', () => {
  for (const smiles of [...HYBRID_MACROCYCLES, BENZYL_CONTROL]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`keeps generation and refinement complete at ${bondLength}: ${smiles.slice(0, 32)}`, () => {
        const molecule = parseSMILES(smiles);
        const generated = generateCoords(molecule, { bondLength, auditTelemetry: true });
        assertCompleteCleanLayout(generated);

        const existingCoords = structuredClone(generated.coords);
        const refined = refineCoords(molecule, { existingCoords: generated.coords, bondLength, auditTelemetry: true });
        assert.deepEqual(generated.coords, existingCoords);
        assertCompleteCleanLayout(refined);
      });
    }
  }

  it('keeps hybrid macrocycles in their dedicated family before bounded fallback', () => {
    for (const smiles of HYBRID_MACROCYCLES) {
      const graph = createLayoutGraph(parseSMILES(smiles), {});
      const macrocycleSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.some(ringId => graph.ringById.get(ringId).size >= 12));
      assert.ok(macrocycleSystem);
      assert.equal(classifyRingSystemFamily(graph, macrocycleSystem), 'macrocycle');
    }
  });

  it('retains the dedicated family for a simple macrocycle', () => {
    const graph = createLayoutGraph(parseSMILES('C1CCCCCCCCCCC1'), {});
    assert.equal(classifyRingSystemFamily(graph, graph.ringSystems[0]), 'macrocycle');
  });

  it('is deterministic across fresh parses', () => {
    for (const smiles of HYBRID_MACROCYCLES) {
      const first = generateCoords(parseSMILES(smiles));
      const second = generateCoords(parseSMILES(smiles));
      assert.deepEqual(second.coords, first.coords);
      assertCompleteCleanLayout(first);
      assertCompleteCleanLayout(second);
    }
  });
});
