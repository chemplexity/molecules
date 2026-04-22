import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateResonanceStructures } from '../../../src/algorithms/index.js';
import { parseSMILES } from '../../../src/io/index.js';
import {
  _captureReactionPreviewSnapshot,
  _restoreReactionPreviewSnapshot,
  _restoreReactionPreviewSource,
  initReaction2d
} from '../../../src/app/render/reaction-2d.js';

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

function makeReaction2dContext() {
  const renderCalls = [];
  const zoomRestores = [];
  const context = {
    mode: '2d',
    currentMol: null,
    _mol2d: parseSMILES('CCO'),
    renderMol(mol, options = {}) {
      context._mol2d = mol;
      renderCalls.push({ mol, options });
    },
    restoreZoomTransform(transform) {
      zoomRestores.push(transform);
    }
  };
  initReaction2d(context);
  return { context, renderCalls, zoomRestores };
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

afterEach(() => {
  _restoreReactionPreviewSnapshot(null);
});

describe('reaction preview restore', () => {
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
});
