import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditFinalLayout, auditLayout, auditCandidateSafety } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { createQualityReport } from '../../../../src/layout/engine/model/quality-report.js';
import { runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { makeEthane } from '../support/molecules.js';

describe('final fixed-coordinate validation', () => {
  for (const cached of [false, true]) {
    it(`rejects displaced anchors with valid bonds (cached=${cached})`, () => {
      const fixedCoords = new Map([['a0', { x: 0, y: 0 }]]);
      const graph = createLayoutGraph(makeEthane(), { fixedCoords });
      const coords = new Map([['a0', { x: 10, y: 10 }], ['a1', { x: 11.5, y: 10 }]]);
      const before = structuredClone(coords);
      const geometry = auditLayout(graph, coords);
      const geometryBefore = structuredClone(geometry);
      assert.equal(geometry.ok, true);
      assert.equal(auditCandidateSafety(graph, coords).ok, true);
      const audit = auditFinalLayout(graph, coords, {}, cached ? geometry : null);
      assert.equal(audit.ok, false);
      assert.equal(audit.fixedCoordinateViolationCount, 1);
      assert.equal(audit.bondLengthFailureCount, 0);
      assert.ok(audit.fallback.reasons.includes('fixed-coordinate-violations'));
      assert.equal(createQualityReport({ audit, cleanup: {} }).ok, false);
      assert.deepEqual(coords, before);
      assert.deepEqual(graph.fixedCoords, fixedCoords);
      assert.deepEqual(geometry, geometryBefore);
    });
  }

  for (const bondLength of [0.5, 1.5, 3]) {
    for (const factor of [0, 0.5e-8, 1e-8, 2e-8]) {
      it(`uses bond-relative tolerance for length=${bondLength}, offset=${factor}`, () => {
        const graph = createLayoutGraph(makeEthane(), { bondLength, fixedCoords: new Map([['a0', { x: 0, y: 0 }]]) });
        const coords = new Map([['a0', { x: bondLength * factor, y: 0 }], ['a1', { x: bondLength * (1 + factor), y: 0 }]]);
        const audit = auditFinalLayout(graph, coords);
        assert.equal(audit.fixedCoordinateViolationCount, factor > 1e-8 ? 1 : 0);
        assert.equal(audit.ok, factor <= 1e-8);
      });
    }
  }

  for (const position of [undefined, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
    it(`counts a missing or nonfinite anchor (${String(position?.y)})`, () => {
      const graph = createLayoutGraph(makeEthane(), { fixedCoords: new Map([['a0', { x: 0, y: 0 }]]) });
      const coords = new Map([['a1', { x: 1.5, y: 0 }]]);
      if (position) {
        coords.set('a0', position);
      }
      const audit = auditFinalLayout(graph, coords);
      assert.equal(audit.ok, false);
      assert.equal(audit.fixedCoordinateViolationCount, 1);
    });
  }

  it('does not enforce anchors with preserveFixed=false or treat existing hints as anchors', () => {
    const targets = new Map([['a0', { x: 0, y: 0 }]]);
    const coords = new Map([['a0', { x: 10, y: 10 }], ['a1', { x: 11.5, y: 10 }]]);
    for (const options of [{ fixedCoords: targets, preserveFixed: false }, { existingCoords: targets }]) {
      const audit = auditFinalLayout(createLayoutGraph(makeEthane(), options), coords);
      assert.equal(audit.ok, true);
      assert.equal(audit.fixedCoordinateViolationCount, 0);
    }
  });

  it('requires explicitly fixed hidden atoms but not ordinary omitted hidden atoms', () => {
    const molecule = makeEthane();
    molecule.addAtom('h', 'H');
    molecule.atoms.get('h').visible = false;
    const coords = new Map([['a0', { x: 0, y: 0 }], ['a1', { x: 1.5, y: 0 }]]);
    const graph = createLayoutGraph(molecule, { fixedCoords: new Map([['h', { x: 0, y: 1.5 }]]) });
    assert.equal(auditFinalLayout(graph, coords).fixedCoordinateViolationCount, 1);
    coords.set('h', { x: 0, y: 1.5 });
    assert.equal(auditFinalLayout(graph, coords).ok, true);
  });

  it('reports zero violations for a pipeline result that preserves its anchor', () => {
    const result = runPipeline(makeEthane(), { fixedCoords: new Map([['a0', { x: 10, y: 10 }]]) });
    assert.equal(result.metadata.audit.fixedCoordinateViolationCount, 0);
    assert.equal(result.metadata.qualityReport.ok, true);
  });
});
