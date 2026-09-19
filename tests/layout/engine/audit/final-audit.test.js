import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditCandidateSafety, auditFinalLayout, auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { createQualityReport } from '../../../../src/layout/engine/model/quality-report.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { makeEthane } from '../support/molecules.js';

describe('final coordinate validation', () => {
  for (const count of [0, 1]) {
    it(`rejects an incomplete final map with ${count} positions but allows partial probes`, () => {
      const graph = createLayoutGraph(makeEthane());
      const coords = new Map(count ? [['a0', { x: 0, y: 0 }]] : []);
      assert.equal(auditLayout(graph, coords).ok, true);
      assert.equal(auditCandidateSafety(graph, coords).ok, true);
      const audit = auditFinalLayout(graph, coords);
      assert.equal(audit.ok, false);
      assert.equal(audit.missingCoordinateCount, 2 - count);
      assert.ok(audit.fallback.reasons.includes('missing-coordinates'));
      assert.equal(createQualityReport({ audit, cleanup: {} }).ok, false);
    });
  }

  for (const value of [NaN, Infinity, -Infinity, undefined, '0']) {
    for (const axis of ['x', 'y']) {
      it(`rejects ${String(value)} in ${axis} without contaminating geometry metrics`, () => {
        const graph = createLayoutGraph(makeEthane());
        const coords = new Map([
          ['a0', { x: 0, y: 0, [axis]: value }],
          ['a1', { x: 1.5, y: 0 }]
        ]);
        const before = structuredClone(coords);
        const audit = auditFinalLayout(graph, coords);
        assert.equal(audit.ok, false);
        assert.equal(audit.nonfiniteCoordinateCount, 1);
        assert.equal(audit.missingCoordinateCount, 0);
        assert.ok(audit.fallback.reasons.includes('nonfinite-coordinates'));
        assert.ok(Number.isFinite(audit.maxBondLengthDeviation));
        assert.ok(Number.isFinite(audit.meanBondLengthDeviation));
        assert.deepEqual(coords, before);
      });
    }
  }

  it('rejects both NaN positions even with a cached passing audit', () => {
    const graph = createLayoutGraph(makeEthane());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }]
    ]);
    const cached = auditLayout(graph, coords);
    const before = structuredClone(cached);
    for (const id of coords.keys()) {
      coords.set(id, { x: NaN, y: NaN });
    }
    const audit = auditFinalLayout(graph, coords, {}, cached);
    assert.equal(audit.ok, false);
    assert.equal(audit.nonfiniteCoordinateCount, 2);
    assert.deepEqual(cached, before);
  });

  it('rejects unknown coordinate keys', () => {
    const graph = createLayoutGraph(makeEthane());
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }],
      ['unknown', { x: 3, y: 0 }]
    ]);
    const audit = auditFinalLayout(graph, coords);
    assert.equal(audit.ok, false);
    assert.equal(audit.unknownCoordinateCount, 1);
    assert.ok(audit.fallback.reasons.includes('unknown-coordinate-atoms'));
  });

  it('does not report pipeline success for an unknown existing-coordinate key', () => {
    const result = runPipeline(makeEthane(), {
      existingCoords: new Map([['unknown', { x: 10, y: 10 }]])
    });
    assert.equal(result.metadata.audit.ok, false);
    assert.equal(result.metadata.qualityReport.ok, false);
    assert.equal(result.metadata.audit.unknownCoordinateCount, 1);
  });

  it('allows omitted hidden hydrogen positions but validates supplied ones', () => {
    const molecule = makeEthane();
    molecule.addAtom('h', 'H');
    molecule.atoms.get('h').visible = false;
    molecule.addBond('ch', 'a0', 'h', {}, false);
    const graph = createLayoutGraph(molecule);
    const coords = new Map([
      ['a0', { x: 0, y: 0 }],
      ['a1', { x: 1.5, y: 0 }]
    ]);
    assert.equal(auditFinalLayout(graph, coords).ok, true);
    coords.set('h', null);
    assert.equal(auditFinalLayout(graph, coords).nonfiniteCoordinateCount, 1);
    assert.equal(auditFinalLayout(graph, coords).ok, false);
    coords.delete('h');
    graph.atoms.get('h').visible = true;
    assert.equal(auditFinalLayout(graph, coords).missingCoordinateCount, 1);
  });

  for (const suppressH of [false, true]) {
    it(`validates pipeline results with suppressH=${suppressH}`, () => {
      const result = runPipeline(parseSMILES('CC'), { suppressH });
      const audit = result.metadata.audit;
      assert.equal(audit.ok, true);
      assert.equal(audit.missingCoordinateCount, 0);
      assert.equal(audit.nonfiniteCoordinateCount, 0);
      assert.equal(audit.unknownCoordinateCount, 0);
      assert.equal(result.metadata.qualityReport.ok, true);
      assert.equal(result.metadata.qualityReport.audit, audit);
    });
  }
});
