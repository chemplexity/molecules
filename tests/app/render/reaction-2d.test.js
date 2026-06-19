import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateResonanceStructures } from '../../../src/algorithms/index.js';
import { parseSMILES } from '../../../src/io/index.js';
import { generateAndRefine2dCoords } from '../../../src/layout/index.js';
import { alignReaction2dProductOrientation, buildReaction2dMol, centerReaction2dPairCoords, spreadReaction2dProductComponents } from '../../../src/layout/reaction2d.js';
import {
  _applyReactionPreviewDisplayGeometry,
  _captureReactionPreviewSnapshot,
  _forceInitialPatchFromAnchorCoords,
  _paintReactionPreviewReactantSource,
  _reactionPreviewSkipsFunctionalGroupRefresh,
  _restoreReactionPreviewSnapshot,
  _restoreReactionPreviewSource,
  initReaction2d
} from '../../../src/app/render/reaction-2d.js';
import { findSMARTSRaw } from '../../../src/smarts/search.js';
import { reactionTemplates } from '../../../src/smirks/index.js';

function serializePreviewMol(mol) {
  if (!mol) {
    return null;
  }
  const atoms = [];
  for (const [id, atom] of mol.atoms) {
    atoms.push({
      id,
      name: atom.name,
      x: atom.x,
      y: atom.y,
      visible: atom.visible,
      properties: JSON.parse(JSON.stringify(atom.properties))
    });
  }
  const bonds = [];
  for (const [id, bond] of mol.bonds) {
    bonds.push({
      id,
      atoms: [...bond.atoms],
      properties: JSON.parse(JSON.stringify(bond.properties))
    });
  }
  return {
    atoms,
    bonds,
    name: mol.name ?? '',
    tags: JSON.parse(JSON.stringify(mol.tags ?? [])),
    moleculeProperties: JSON.parse(JSON.stringify(mol.properties ?? {}))
  };
}

function makeReaction2dContext({ mode = '2d' } = {}) {
  const renderCalls = [];
  const zoomRestores = [];
  const forcePositionRestores = [];
  const forceRestarts = [];
  const context = {
    mode,
    currentMol: null,
    _mol2d: parseSMILES('CCO'),
    renderMol(mol, options = {}) {
      context._mol2d = mol;
      renderCalls.push({ mol, options });
    },
    restoreZoomTransform(transform) {
      zoomRestores.push(transform);
    },
    restoreForceNodePositions(positions) {
      forcePositionRestores.push(positions);
    },
    restartForceSimulation() {
      forceRestarts.push(true);
    }
  };
  initReaction2d(context);
  return { context, renderCalls, zoomRestores, forcePositionRestores, forceRestarts };
}

function makePreviewSnapshot({ sourceMol, entryDisplayMol, entryZoomTransform = null }) {
  return {
    sourceMol: serializePreviewMol(sourceMol),
    displayMol: serializePreviewMol(parseSMILES('CC(O)')),
    activeReactionSmirks: '[C:1]=[O:2]>>[C:1][O:2]',
    activeReactionMatchIndex: 0,
    reactionPreviewLocked: true,
    reactantAtomIds: ['A1'],
    productAtomIds: ['A2'],
    productComponentAtomIdSets: [],
    mappedAtomPairs: [],
    editedProductAtomIds: [],
    preservedReactantStereoByCenter: [],
    preservedReactantStereoBondTypes: [],
    preservedProductStereoByCenter: [],
    preservedProductStereoBondTypes: [],
    forcedStereoByCenter: [],
    forcedStereoBondTypes: [],
    forcedStereoBondCenters: [],
    reactantReferenceCoords: [],
    reactionPreviewHighlightMappings: [],
    entryZoomTransform,
    entryDisplayMol: serializePreviewMol(entryDisplayMol),
    entryMode: '2d',
    entryForceNodePositions: null
  };
}

function maxPairDistanceDelta(molA, molB, atomIds) {
  const ids = [...atomIds].filter(id => molA.atoms.get(id)?.name !== 'H' && molB.atoms.get(id)?.name !== 'H');
  let maxDelta = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a1 = molA.atoms.get(ids[i]);
      const b1 = molA.atoms.get(ids[j]);
      const a2 = molB.atoms.get(ids[i]);
      const b2 = molB.atoms.get(ids[j]);
      const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
      const d2 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      maxDelta = Math.max(maxDelta, Math.abs(d1 - d2));
    }
  }
  return maxDelta;
}

afterEach(() => {
  _restoreReactionPreviewSnapshot(null);
});

describe('reaction preview restore', () => {
  it('keeps acid/base previews off the full functional-group refresh path', () => {
    assert.equal(_reactionPreviewSkipsFunctionalGroupRefresh(reactionTemplates.amineProtonation), true);
    assert.equal(_reactionPreviewSkipsFunctionalGroupRefresh(reactionTemplates.carboxylicAcidDeprotonation), true);
    assert.equal(_reactionPreviewSkipsFunctionalGroupRefresh(reactionTemplates.carbonylReduction), false);
  });

  it('seeds force-preview reactant and product atoms in one shared preview frame', () => {
    const mol = parseSMILES('CC');
    const [c1Id, c2Id] = [...mol.atoms.keys()];
    mol.atoms.get(c1Id).x = 0;
    mol.atoms.get(c1Id).y = 0;
    mol.atoms.get(c2Id).x = 1.5;
    mol.atoms.get(c2Id).y = 0;
    const productC1 = mol.addAtom(`__rxn_product__0:${c1Id}`, 'C');
    const productC2 = mol.addAtom(`__rxn_product__0:${c2Id}`, 'C');
    productC1.x = 4.5;
    productC1.y = 0;
    productC2.x = 6;
    productC2.y = 0;
    const anchorLayout = new Map([
      [c1Id, { x: 0, y: 0 }],
      [c2Id, { x: 1.5, y: 0 }],
      [productC1.id, { x: 4.5, y: 0 }],
      [productC2.id, { x: 6, y: 0 }]
    ]);

    const patch = _forceInitialPatchFromAnchorCoords(mol, anchorLayout, { width: 600, height: 400 });

    assert.ok(patch instanceof Map);
    assert.ok(patch.get(productC1.id).x > patch.get(c2Id).x + 60);
    assert.ok(patch.get(productC2.id).x > patch.get(productC1.id).x);
    assert.equal(patch.get(c1Id).y, patch.get(productC1.id).y);
    assert.equal(patch.size, 4);
  });

  it('seeds new force-preview product atoms without source coordinates near their placed parent', () => {
    const mol = parseSMILES('CC');
    const productRingCarbon = mol.addAtom('__rxn_product__0:C2', 'C');
    const productCarbonyl = mol.addAtom('__rxn_product__0:C1', 'C');
    const oxo = mol.addAtom('__rxn_product__0:0', 'O');
    productRingCarbon.x = 3;
    productRingCarbon.y = 0;
    productCarbonyl.x = 4.5;
    productCarbonyl.y = 0;
    oxo.x = null;
    oxo.y = null;
    mol.addBond('__rxn_product__0:b1', productRingCarbon.id, productCarbonyl.id, { order: 1 }, false);
    mol.addBond('__rxn_product__0:b2', productCarbonyl.id, oxo.id, { order: 2 }, false);
    const anchorLayout = new Map([
      [productRingCarbon.id, { x: productRingCarbon.x, y: productRingCarbon.y }],
      [productCarbonyl.id, { x: productCarbonyl.x, y: productCarbonyl.y }]
    ]);

    const patch = _forceInitialPatchFromAnchorCoords(mol, anchorLayout, { width: 600, height: 400 });
    const carbonylPos = patch.get(productCarbonyl.id);
    const ringPos = patch.get(productRingCarbon.id);
    const oxoPos = patch.get(oxo.id);

    assert.ok(Number.isFinite(oxoPos?.x));
    assert.ok(Number.isFinite(oxoPos?.y));
    assert.ok(oxoPos.x > carbonylPos.x, 'expected oxo oxygen to seed away from the ring neighbor');
    assert.ok(Math.hypot(oxoPos.x - carbonylPos.x, oxoPos.y - carbonylPos.y) < Math.hypot(oxoPos.x - ringPos.x, oxoPos.y - ringPos.y));
  });

  it('applies line-mode product geometry before force reaction preview seeding', () => {
    const smiles = '[H][C@]1(CO[C@]2([H])[C@]([H])(CO[C@]12[H])OC1=CC=C(C=C1)C(N)=N)OC1=CC=C(C=C1)C(N)=N';
    const smirks = reactionTemplates.etherCleavage.smirks;
    const sourceMol = parseSMILES(smiles);
    generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });
    const mapping = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])][1];
    assert.ok(mapping, 'expected second ether-cleavage mapping for the bridged ether example');
    const preview = buildReaction2dMol(sourceMol, smirks, mapping);
    assert.ok(preview, 'expected ether-cleavage preview to build');

    _restoreReactionPreviewSnapshot({
      sourceMol: serializePreviewMol(sourceMol),
      displayMol: serializePreviewMol(preview.mol),
      activeReactionSmirks: smirks,
      activeReactionMatchIndex: 1,
      reactionPreviewLocked: true,
      reactantAtomIds: [...preview.reactantAtomIds],
      productAtomIds: [...preview.productAtomIds],
      productComponentAtomIdSets: preview.productComponentAtomIdSets.map(atomIds => [...atomIds]),
      mappedAtomPairs: preview.mappedAtomPairs,
      editedProductAtomIds: [...preview.editedProductAtomIds],
      preservedReactantStereoByCenter: [...preview.preservedReactantStereoByCenter],
      preservedReactantStereoBondTypes: [...preview.preservedReactantStereoBondTypes],
      preservedProductStereoByCenter: [...preview.preservedProductStereoByCenter],
      preservedProductStereoBondTypes: [...preview.preservedProductStereoBondTypes],
      forcedStereoByCenter: [...preview.forcedStereoByCenter],
      forcedStereoBondTypes: [...preview.forcedStereoBondTypes],
      forcedStereoBondCenters: [...preview.forcedStereoBondCenters],
      reactantReferenceCoords: [...preview.reactantReferenceCoords],
      reactionPreviewHighlightMappings: [],
      entryZoomTransform: null,
      entryDisplayMol: serializePreviewMol(sourceMol),
      entryMode: 'force',
      entryForceNodePositions: null
    });

    const expected = preview.mol.clone();
    alignReaction2dProductOrientation(expected, preview, 1.5);
    spreadReaction2dProductComponents(expected, preview, 1.5);
    centerReaction2dPairCoords(expected, preview, 1.5);

    const actual = preview.mol.clone();
    _applyReactionPreviewDisplayGeometry(actual);
    const drift = maxPairDistanceDelta(actual, expected, preview.productAtomIds);

    assert.ok(drift < 1e-6, `expected force preview product geometry to match line display geometry, got ${drift.toExponential(3)} Å`);
  });

  it('keeps the live source molecule properties when restoring the saved 2d entry display', () => {
    const { context, renderCalls, zoomRestores } = makeReaction2dContext();
    const sourceMol = parseSMILES('CC=O');
    generateResonanceStructures(sourceMol);
    sourceMol.properties.previewMarker = { kept: true };

    const entryDisplayMol = parseSMILES('CC=O');
    let coord = 100;
    for (const atom of entryDisplayMol.atoms.values()) {
      atom.x = coord;
      atom.y = -coord;
      coord += 25;
    }
    const firstAtomId = entryDisplayMol.atoms.keys().next().value;

    _restoreReactionPreviewSnapshot(
      makePreviewSnapshot({
        sourceMol,
        entryDisplayMol,
        entryZoomTransform: { x: 12, y: -8, k: 1.75 }
      })
    );

    const restored = _restoreReactionPreviewSource({ restoreEntryZoom: true, restoreEntryDisplay: true });

    assert.equal(restored, true);
    assert.equal(renderCalls.length, 1);
    assert.equal(zoomRestores.length, 1);
    assert.deepEqual(renderCalls[0].options, {
      preserveHistory: true,
      preserveView: true,
      preserveGeometry: true
    });
    assert.deepEqual(context._mol2d.properties.resonance, sourceMol.properties.resonance);
    assert.deepEqual(context._mol2d.properties.previewMarker, { kept: true });
    assert.equal(context._mol2d.atoms.get(firstAtomId).x, entryDisplayMol.atoms.get(firstAtomId).x);
    assert.equal(context._mol2d.atoms.get(firstAtomId).y, entryDisplayMol.atoms.get(firstAtomId).y);

    const restoredCarbonyl = [...context._mol2d.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(context._mol2d);
      return (a1.name === 'C' && a2.name === 'O') || (a1.name === 'O' && a2.name === 'C');
    });
    const restoredOxygen = [...context._mol2d.atoms.values()].find(atom => atom.name === 'O');
    assert.ok(restoredCarbonyl?.properties?.resonance);
    assert.ok(restoredOxygen?.properties?.resonance);

    context._mol2d.setResonanceState(2);

    assert.equal(restoredCarbonyl.properties.order, 1);
    assert.equal(restoredOxygen.properties.charge, -1);
  });

  it('preserves source molecule properties when serializing reaction preview history', () => {
    makeReaction2dContext();
    const sourceMol = parseSMILES('CC=O');
    generateResonanceStructures(sourceMol);
    sourceMol.properties.previewMarker = { kept: true };

    _restoreReactionPreviewSnapshot(
      makePreviewSnapshot({
        sourceMol,
        entryDisplayMol: parseSMILES('CC=O')
      })
    );

    const snapshot = _captureReactionPreviewSnapshot();

    assert.deepEqual(snapshot?.sourceMol?.moleculeProperties?.previewMarker, { kept: true });
    assert.ok(snapshot?.sourceMol?.moleculeProperties?.resonance);
  });

  it('restores force previews without forcing a fresh force layout', () => {
    const { renderCalls, zoomRestores, forcePositionRestores, forceRestarts } = makeReaction2dContext({ mode: 'force' });
    const sourceMol = parseSMILES('CC=O');
    for (const [index, atom] of [...sourceMol.atoms.values()].entries()) {
      atom.x = index * 1.5;
      atom.y = 0;
    }
    const entryDisplayMol = sourceMol.clone();
    const forcePositions = new Map([
      ['a1', { x: 100, y: 120 }],
      ['a2', { x: 140, y: 120 }]
    ]);

    _restoreReactionPreviewSnapshot({
      ...makePreviewSnapshot({
        sourceMol,
        entryDisplayMol,
        entryZoomTransform: { x: 3, y: 4, k: 1.25 }
      }),
      entryMode: 'force',
      entryForceNodePositions: [...forcePositions]
    });

    const restored = _restoreReactionPreviewSource({ restoreEntryZoom: true, restoreEntryDisplay: true });

    assert.equal(restored, true);
    assert.equal(renderCalls.length, 1);
    assert.equal(renderCalls[0].options.forcePreservePositions, true);
    assert.equal(renderCalls[0].options.preserveView, true);
    assert.ok(renderCalls[0].options.forceAnchorLayout instanceof Map);
    assert.ok(renderCalls[0].options.forceAnchorLayout.size > 0);
    assert.deepEqual(forcePositionRestores, [forcePositions]);
    assert.deepEqual(forceRestarts, [true]);
    assert.deepEqual(zoomRestores, [{ x: 3, y: 4, k: 1.25 }]);
  });

  it('persists reactant paint edits into the stored reaction preview source', () => {
    makeReaction2dContext();
    const sourceMol = parseSMILES('C1CCCCC1');
    const atomIds = [...sourceMol.atoms.keys()];
    const ringAtomIds = sourceMol.getRings()[0];
    const storedRingAtomIds = [...ringAtomIds].sort();
    const bondId = sourceMol.bonds.keys().next().value;
    const productAtomId = `__rxn_product__0:${atomIds[0]}`;
    const productBondId = `__rxn_product__0:${bondId}`;

    _restoreReactionPreviewSnapshot({
      ...makePreviewSnapshot({
        sourceMol,
        entryDisplayMol: sourceMol
      }),
      reactantAtomIds: atomIds,
      productAtomIds: [productAtomId]
    });

    const result = _paintReactionPreviewReactantSource({
      atomIds: [atomIds[0], productAtomId],
      bondIds: [bondId, productBondId],
      style: { color: '#ff6633', opacity: 0.45 },
      ringAtomIds: [...ringAtomIds, productAtomId],
      ringFillStyle: { color: '#ffcc00', opacity: 0.35 }
    });
    const snapshot = _captureReactionPreviewSnapshot();
    const styledAtom = snapshot.sourceMol.atoms.find(atom => atom.id === atomIds[0]);
    const styledBond = snapshot.sourceMol.bonds.find(bond => bond.id === bondId);

    assert.deepEqual(result, {
      atomIds: [atomIds[0]],
      bondIds: [bondId],
      ringAtomIds
    });
    assert.deepEqual(styledAtom.properties.style, { color: '#ff6633', opacity: 0.45 });
    assert.deepEqual(styledBond.properties.style, { color: '#ff6633', opacity: 0.45 });
    assert.deepEqual(snapshot.sourceMol.moleculeProperties.style.ringFills, [
      {
        id: `ring-fill:${storedRingAtomIds.join('\0')}`,
        atomIds: storedRingAtomIds,
        color: '#ffcc00',
        opacity: 0.35
      }
    ]);

    const clearResult = _paintReactionPreviewReactantSource({
      atomIds: [atomIds[0]],
      bondIds: [bondId],
      style: null,
      ringAtomIds,
      ringFillStyle: null
    });
    const clearedSnapshot = _captureReactionPreviewSnapshot();
    const clearedAtom = clearedSnapshot.sourceMol.atoms.find(atom => atom.id === atomIds[0]);
    const clearedBond = clearedSnapshot.sourceMol.bonds.find(bond => bond.id === bondId);

    assert.deepEqual(clearResult, {
      atomIds: [atomIds[0]],
      bondIds: [bondId],
      ringAtomIds
    });
    assert.equal(clearedAtom.properties.style, undefined);
    assert.equal(clearedBond.properties.style, undefined);
    assert.equal(clearedSnapshot.sourceMol.moleculeProperties.style, undefined);
  });
});
