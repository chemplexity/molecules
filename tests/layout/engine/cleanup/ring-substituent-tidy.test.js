import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { measureRingSubstituentPresentationPenalty, runRingSubstituentTidy } from '../../../../src/layout/engine/cleanup/presentation/ring-substituent.js';
import { computeIncidentRingOutwardAngles } from '../../../../src/layout/engine/geometry/ring-direction.js';
import { add, angleOf, angularDifference, centroid, fromAngle, rotate, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { createLayoutGraph, createLayoutGraphFromNormalized } from '../../../../src/layout/engine/model/layout-graph.js';
import { normalizeOptions } from '../../../../src/layout/engine/options.js';
import { layoutSupportedComponents } from '../../../../src/layout/engine/placement/component-layout.js';
import { classifyFamily, runPipeline } from '../../../../src/layout/engine/pipeline.js';
import { resolveProfile } from '../../../../src/layout/engine/profile.js';
import { resolvePolicy } from '../../../../src/layout/engine/standards/profile-policy.js';

function bondAngle(coords, firstAtomId, centerAtomId, secondAtomId) {
  const first = coords.get(firstAtomId);
  const center = coords.get(centerAtomId);
  const second = coords.get(secondAtomId);
  assert.ok(first);
  assert.ok(center);
  assert.ok(second);
  return angularDifference(
    angleOf(sub(first, center)),
    angleOf(sub(second, center))
  );
}

function signedTurn(coords, firstAtomId, centerAtomId, secondAtomId) {
  const first = coords.get(firstAtomId);
  const center = coords.get(centerAtomId);
  const second = coords.get(secondAtomId);
  assert.ok(first);
  assert.ok(center);
  assert.ok(second);
  return ((first.x - center.x) * (second.y - center.y)) - ((first.y - center.y) * (second.x - center.x));
}

function ringOutwardDeviation(graph, coords, anchorAtomId, childAtomId) {
  const anchor = coords.get(anchorAtomId);
  const child = coords.get(childAtomId);
  assert.ok(anchor);
  assert.ok(child);
  const outwardAngles = computeIncidentRingOutwardAngles(graph, anchorAtomId, atomId => coords.get(atomId) ?? null);
  assert.ok(outwardAngles.length > 0);
  return angularDifference(
    angleOf(sub(child, anchor)),
    outwardAngles[0]
  );
}

function preferredRingAttachmentAngle(graph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  assert.ok(anchorPosition);
  const anchorRingCount = graph.atomToRings.get(anchorAtomId)?.length ?? 0;
  if (anchorRingCount > 1) {
    const ringSystem = graph.ringSystems.find(candidateRingSystem => candidateRingSystem.atomIds.includes(anchorAtomId));
    const positions = ringSystem?.atomIds.map(atomId => coords.get(atomId)).filter(Boolean) ?? [];
    assert.ok(positions.length >= 3);
    return angleOf(sub(anchorPosition, centroid(positions)));
  }
  const outwardAngles = computeIncidentRingOutwardAngles(graph, anchorAtomId, atomId => coords.get(atomId) ?? null);
  assert.equal(outwardAngles.length, 1);
  return outwardAngles[0];
}

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

    assert.equal(beforeAudit.severeOverlapCount, 0);
    assert.equal(beforeAudit.ok, true);
    assert.equal(tidied.nudges, 0);
    assert.equal(afterAudit.severeOverlapCount, 0);
    assert.equal(afterAudit.bondLengthFailureCount, 0);
    assert.equal(afterAudit.ok, true);
  });

  it('keeps later post-hook cleanup from worsening a borderline ring-substituent readability case', () => {
    const result = runPipeline(
      parseSMILES('Cc1cc(NC(=O)CCSc2nc(cc(n2)C(F)(F)F)c3occc3)n(n1)c4ccccc4'),
      { suppressH: true, auditTelemetry: true }
    );
    const presentationCleanupAudit = result.metadata.stageTelemetry.stageAudits.presentationCleanup;

    assert.ok(
      result.metadata.audit.ringSubstituentReadabilityFailureCount
      <= presentationCleanupAudit.ringSubstituentReadabilityFailureCount
    );
    assert.ok(result.metadata.audit.severeOverlapCount <= presentationCleanupAudit.severeOverlapCount);
    assert.equal(result.metadata.audit.bondLengthFailureCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('does not rotate an attached anisole ring into a reverse-side outward readability failure', () => {
    const result = runPipeline(
      parseSMILES('CCOC(=O)C1C(CC2=NC(=C(C(C2=C1O)c3ccccn3)C(=O)OCC)C)c4ccc(OC)cc4'),
      { suppressH: true, auditTelemetry: true }
    );
    const presentationCleanupAudit = result.metadata.stageTelemetry.stageAudits.presentationCleanup;

    assert.equal(presentationCleanupAudit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(presentationCleanupAudit.outwardAxisRingSubstituentFailureCount, 0);
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('does not rotate already-clean linked subtrees purely for ideal outward presentation', () => {
    const smiles = 'CC([NH3+])C1=CC=C(CC(=O)NC2CC(NC3=CC(Cl)=CC(Cl)=C23)C([O-])=O)C=C1';
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
    const beforeAngle = bondAngle(placement.coords, 'C10', 'N12', 'C13');

    const tidied = runRingSubstituentTidy(graph, placement.coords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds
    });
    const afterAngle = bondAngle(tidied.coords, 'C10', 'N12', 'C13');

    assert.equal(beforeAudit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(beforeAudit.severeOverlapCount, 0);
    assert.equal(tidied.nudges, 0);
    assert.ok(Math.abs(beforeAngle - afterAngle) < 1e-6);
  });

  it('assigns a continuous soft penalty to aromatic substituents even below the hard readability cutoff', () => {
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
    for (const atomId of [oxygenAtomId, methylAtomId]) {
      coords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), 0.35)));
    }

    const displacedAudit = auditLayout(graph, coords, { bondLength: graph.options.bondLength });
    const displacedPenalty = measureRingSubstituentPresentationPenalty(graph, coords);
    const tidied = runRingSubstituentTidy(graph, coords, { bondLength: graph.options.bondLength });
    const tidiedPenalty = measureRingSubstituentPresentationPenalty(graph, tidied.coords);

    assert.equal(displacedAudit.ringSubstituentReadabilityFailureCount, 0);
    assert.ok(displacedPenalty > 0.3);
    assert.ok(tidiedPenalty < displacedPenalty - 0.1);
  });

  it('scores attached-ring exits on non-aromatic ring anchors and keeps them outward in mixed placement', () => {
    const smiles = 'CC1CCC(O)(C#N)C(C1)C1=NC=CS1';
    const molecule = parseSMILES(smiles);
    const graph = createLayoutGraph(molecule, { suppressH: true });
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });

    const presentationPenalty = measureRingSubstituentPresentationPenalty(graph, result.coords);
    const cyclohexaneDeviation = ringOutwardDeviation(graph, result.coords, 'C9', 'C11');
    const thiazoleDeviation = ringOutwardDeviation(graph, result.coords, 'C11', 'C9');

    assert.ok(presentationPenalty < 0.2);
    assert.ok(cyclohexaneDeviation < 0.2);
    assert.ok(thiazoleDeviation < 0.2);
  });

  it('skips late ring touchups when the incumbent layout is already ring-clean', () => {
    const result = runPipeline(
      parseSMILES('CC([NH3+])C1=CC=C(CC(=O)NC2CC(NC3=CC(Cl)=CC(Cl)=C23)C([O-])=O)C=C1'),
      { suppressH: true, auditTelemetry: true }
    );

    assert.equal(result.metadata.stageTelemetry.selectedGeometryStage, 'placement');
    assert.equal(result.metadata.stageTelemetry.selectedStage, 'selectedGeometryCheckpoint');
    assert.equal(result.metadata.cleanupTelemetry.stages.presentationCleanup?.ran, false);
    assert.ok(!('presentationCleanup' in result.metadata.stageTelemetry.stageAudits));
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
  });

  it('keeps aromatic attached-ring layouts on the late ring-touchup evaluation path even when placement remains selected', () => {
    const result = runPipeline(
      parseSMILES('CC(C1=NN=C2C=CC(=NN12)C1=CC=C2N=CSC2=C1)C1=CC=C2N=CC=CC2=C1'),
      { suppressH: true, auditTelemetry: true }
    );

    assert.ok('presentationCleanup' in result.metadata.stageTelemetry.stageAudits);
    assert.equal(result.metadata.cleanupTelemetry?.stages?.presentationCleanup?.ran, true);
    assert.equal(result.metadata.stageTelemetry.selectedGeometryStage, 'placement');
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.severeOverlapCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });

  it('re-snaps linked diaryl-ether exits exactly even when the fused anchor also carries a phenol leaf', () => {
    const smiles = 'Oc1ccc(cc1)C2=CC(=O)c3c(O)c(Oc4ccc(cc4)C5=CC(=O)c6c(O)cc(O)cc6O5)c(O)cc3O2';
    const normalizedOptions = normalizeOptions({ suppressH: true });
    const graph = createLayoutGraphFromNormalized(parseSMILES(smiles), normalizedOptions);
    const familySummary = classifyFamily(graph);
    const policy = resolvePolicy(resolveProfile(normalizedOptions.profile), {
      ...graph.traits,
      ...familySummary
    });
    const placement = layoutSupportedComponents(graph, policy);

    const tidied = runRingSubstituentTidy(graph, placement.coords, {
      bondLength: normalizedOptions.bondLength,
      frozenAtomIds: placement.frozenAtomIds
    });
    const afterAudit = auditLayout(graph, tidied.coords, {
      bondLength: normalizedOptions.bondLength,
      bondValidationClasses: placement.bondValidationClasses
    });
    const leftDeviation = angularDifference(
      angleOf(sub(tidied.coords.get('O16'), tidied.coords.get('C15'))),
      preferredRingAttachmentAngle(graph, tidied.coords, 'C15')
    );
    const rightDeviation = angularDifference(
      angleOf(sub(tidied.coords.get('O16'), tidied.coords.get('C17'))),
      preferredRingAttachmentAngle(graph, tidied.coords, 'C17')
    );

    assert.ok(leftDeviation < 1e-6, `expected the left diaryl-ether exit to become exact, got ${leftDeviation}`);
    assert.ok(rightDeviation < 1e-6, `expected the right diaryl-ether exit to stay exact, got ${rightDeviation}`);
    assert.equal(afterAudit.ok, true);
  });

  it('re-snaps lone terminal multiple-bond leaves on ring trigonal centers to the exact outward angle', () => {
    const smiles = 'O=C1CCCCC1';
    const graph = createLayoutGraph(parseSMILES(smiles), { suppressH: true });
    const result = runPipeline(parseSMILES(smiles), { suppressH: true });
    const coords = new Map([...result.coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
    const leafBond = [...graph.bonds.values()].find(bond => {
      if (bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) < 2) {
        return false;
      }
      const firstRingCount = graph.atomToRings.get(bond.a)?.length ?? 0;
      const secondRingCount = graph.atomToRings.get(bond.b)?.length ?? 0;
      return firstRingCount !== secondRingCount
        && graph.atoms.get(bond.a)?.element !== 'H'
        && graph.atoms.get(bond.b)?.element !== 'H';
    });
    assert.ok(leafBond);
    const anchorAtomId = (graph.atomToRings.get(leafBond.a)?.length ?? 0) > 0 ? leafBond.a : leafBond.b;
    const leafAtomId = leafBond.a === anchorAtomId ? leafBond.b : leafBond.a;
    const anchorPosition = coords.get(anchorAtomId);
    const ring = (graph.atomToRings.get(anchorAtomId) ?? [])[0];
    const preferredAngle = angleOf(sub(anchorPosition, centroid(ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))));
    const badAngle = preferredAngle + (Math.PI / 3);
    coords.set(leafAtomId, add(anchorPosition, fromAngle(badAngle, graph.options.bondLength)));

    const beforeDeviation = angularDifference(angleOf(sub(coords.get(leafAtomId), anchorPosition)), preferredAngle);
    const tidied = runRingSubstituentTidy(graph, coords, { bondLength: graph.options.bondLength });
    const afterDeviation = angularDifference(
      angleOf(sub(tidied.coords.get(leafAtomId), tidied.coords.get(anchorAtomId))),
      preferredAngle
    );
    const afterAudit = auditLayout(graph, tidied.coords, { bondLength: graph.options.bondLength });

    assert.ok(beforeDeviation > 0.5, `expected the seeded terminal leaf to start off-angle, got ${beforeDeviation.toFixed(6)} rad`);
    assert.ok(tidied.nudges > 0);
    assert.ok(afterDeviation < 1e-6, `expected the terminal leaf to return to the exact outward angle, got ${afterDeviation.toFixed(6)} rad`);
    assert.equal(afterAudit.bondLengthFailureCount, 0);
    assert.equal(afterAudit.ok, true);
  });

  it('keeps the representative multi-methoxy fused-ring readability case outward and audit-clean in the full pipeline', () => {
    const result = runPipeline(
      parseSMILES('[H][C@]12C[C@@H](OC(=O)C3=CC(OC)=C(OC)C(OC)=C3)[C@H](OC)[C@@H](C(=O)OC)[C@@]1([H])C[C@@]1([H])N(CCC3=C1NC1=C3C=CC(OC)=C1)C2'),
      { suppressH: true }
    );

    const attachedRingDeviation = ringOutwardDeviation(result.layoutGraph, result.coords, 'C9', 'C7');

    assert.ok(
      attachedRingDeviation < 1e-6,
      `expected the anisole-linked carbonyl root to stay on the exact outward axis, got ${attachedRingDeviation}`
    );
    assert.ok(
      signedTurn(result.coords, 'C4', 'O6', 'C7') > 0,
      'expected the ester subtree to keep the preferred swung-down mirror at O6'
    );
    assert.equal(result.metadata.audit.ringSubstituentReadabilityFailureCount, 0);
    assert.equal(result.metadata.audit.ok, true);
  });
});
