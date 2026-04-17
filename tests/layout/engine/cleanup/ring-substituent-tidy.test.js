import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { runRingSubstituentTidy } from '../../../../src/layout/engine/cleanup/ring-substituent-tidy.js';
import { add, centroid, rotate, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph, createLayoutGraphFromNormalized } from '../../../../src/layout/engine/model/layout-graph.js';
import { normalizeOptions } from '../../../../src/layout/engine/options.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';
import { classifyFamily, runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { resolveProfile } from '../../../../src/layout/engine/profile.js';
import { resolvePolicy } from '../../../../src/layout/engine/standards/profile-policy.js';

describe('layout/engine/cleanup/ring-substituent-tidy', () => {
  it('rotates tangential anisole methoxy substituents back toward an outward ring direction', () => {
    const smiles = 'COc1ccccc1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const coords = new Map([...result.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const oxygenAtomId = [...graph.atoms.values()].find(atom => atom.element === 'O' && (graph.atomToRings.get(atom.id)?.length ?? 0) === 0)?.id;
    assert.ok(oxygenAtomId);
    const oxygenNeighbors = (graph.bondsByAtomId.get(oxygenAtomId) ?? []).map(bond => (bond.a === oxygenAtomId ? bond.b : bond.a));
    const anchorAtomId = oxygenNeighbors.find(atomId => (graph.atomToRings.get(atomId)?.length ?? 0) > 0);
    const methylAtomId = oxygenNeighbors.find(atomId => atomId !== anchorAtomId);
    assert.ok(anchorAtomId);
    assert.ok(methylAtomId);

    const anchorPosition = coords.get(anchorAtomId);
    const oxygenPosition = coords.get(oxygenAtomId);
    const ringPolygon = (graph.atomToRings.get(anchorAtomId) ?? [])[0].atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    const outwardVector = sub(anchorPosition, centroid(ringPolygon));
    const currentVector = sub(oxygenPosition, anchorPosition);
    const rotation = Math.atan2(outwardVector.y, outwardVector.x) + Math.PI / 2 - Math.atan2(currentVector.y, currentVector.x);
    for (const atomId of [oxygenAtomId, methylAtomId]) {
      coords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), rotation)));
    }

    const beforeAudit = auditLayout(graph, coords);
    const tidied = runRingSubstituentTidy(graph, coords, { bondLength: graph.options.bondLength });
    const afterAudit = auditLayout(graph, tidied.coords);

    assert.ok(beforeAudit.ringSubstituentReadabilityFailureCount > 0);
    assert.ok(tidied.nudges > 0);
    assert.equal(afterAudit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(afterAudit.bondLengthFailureCount, 0);
  });

  it('rotates tangential biaryl substituents back toward an outward ring direction', () => {
    const smiles = 'c1ccccc1-c1ccccc1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const coords = new Map([...result.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const linkBond = [...graph.bonds.values()].find(bond => (graph.atomToRings.get(bond.a)?.length ?? 0) > 0 && (graph.atomToRings.get(bond.b)?.length ?? 0) > 0 && !bond.inRing);
    assert.ok(linkBond);
    const anchorAtomId = linkBond.a;
    const childAtomId = linkBond.b;
    const anchorPosition = coords.get(anchorAtomId);
    const anchorRingPolygon = (graph.atomToRings.get(anchorAtomId) ?? [])[0].atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    const childRingSystemAtomIds = graph.ringSystems.find(ringSystem => ringSystem.id === graph.atomToRingSystemId.get(childAtomId))?.atomIds ?? [];
    const childCentroid = centroid(childRingSystemAtomIds.map(atomId => coords.get(atomId)).filter(Boolean));
    const outwardVector = sub(anchorPosition, centroid(anchorRingPolygon));
    const rotation = Math.atan2(outwardVector.y, outwardVector.x) + Math.PI / 2 - Math.atan2(childCentroid.y - anchorPosition.y, childCentroid.x - anchorPosition.x);
    for (const atomId of childRingSystemAtomIds) {
      coords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), rotation)));
    }

    const beforeAudit = auditLayout(graph, coords);
    const tidied = runRingSubstituentTidy(graph, coords, { bondLength: graph.options.bondLength });
    const afterAudit = auditLayout(graph, tidied.coords);

    assert.ok(beforeAudit.ringSubstituentReadabilityFailureCount > 0);
    assert.ok(tidied.nudges > 0);
    assert.equal(afterAudit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(afterAudit.bondLengthFailureCount, 0);
  });

  it('rotates linked phosphate subtrees around their linker oxygens to clear severe sugar-ring clashes', () => {
    const smiles = 'O[C@H]1[C@H](OP(O)(O)=O)[C@H](OP(O)(O)=O)[C@@H](OP(O)(O)=O)[C@@H](OP(O)(O)=O)[C@@H]1OP(O)(O)=O';
    const normalizedOptions = normalizeOptions({ suppressH: true });
    const graph = createLayoutGraphFromNormalized(parseSMILES(smiles), normalizedOptions);
    const familySummary = classifyFamily(graph);
    const policy = resolvePolicy(resolveProfile(normalizedOptions.profile), {
      ...graph.traits,
      ...familySummary
    });
    const placement = layoutSupportedComponents(graph, policy);
    const beforeAudit = auditLayout(graph, placement.coords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });

    const tidied = runRingSubstituentTidy(graph, placement.coords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds
    });
    const afterAudit = auditLayout(graph, tidied.coords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });

    assert.equal(beforeAudit.severeOverlapCount, 4);
    assert.ok(tidied.nudges > 0);
    assert.equal(afterAudit.severeOverlapCount, 0);
    assert.equal(afterAudit.bondLengthFailureCount, 0);
    assert.equal(afterAudit.ok, true);
  });

  it('keeps later post-hook cleanup from worsening a borderline ring-substituent readability case', () => {
    const result = runPipeline(
      parseSMILES('Cc1cc(NC(=O)CCSc2nc(cc(n2)C(F)(F)F)c3occc3)n(n1)c4ccccc4'),
      { suppressH: true, auditTelemetry: true }
    );

    assert.ok(result.metadata.stageTelemetry.stageAudits.postCleanup.ringSubstituentReadabilityFailureCount > 0);
    assert.notEqual(result.metadata.stageTelemetry.selectedGeometryStage, 'postCleanup');
    assert.notEqual(result.metadata.stageTelemetry.selectedGeometryStage, 'postHookCleanup');
    assert.ok(
      result.metadata.audit.ringSubstituentReadabilityFailureCount
      <= result.metadata.stageTelemetry.stageAudits.postCleanup.ringSubstituentReadabilityFailureCount
    );
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('cleans the representative multi-methoxy fused-ring readability case in the full pipeline', () => {
    const result = runPipeline(
      parseSMILES('[H][C@]12C[C@@H](OC(=O)C3=CC(OC)=C(OC)C(OC)=C3)[C@H](OC)[C@@H](C(=O)OC)[C@@]1([H])C[C@@]1([H])N(CCC3=C1NC1=C3C=CC(OC)=C1)C2'),
      { suppressH: true }
    );

    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });
});
