import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionSnapshotManager } from '../../../src/app/core/session-snapshot.js';

class FakeMolecule {
  constructor() {
    this.atoms = new Map();
    this.bonds = new Map();
    this.properties = {};
  }

  addAtom(id, name, properties = {}) {
    const atom = { id, name, properties: { ...properties }, visible: true, x: null, y: null };
    this.atoms.set(id, atom);
    return atom;
  }

  addBond(id, atomA, atomB, properties = {}) {
    const bond = { id, atoms: [atomA, atomB], properties: { ...properties } };
    this.bonds.set(id, bond);
    return bond;
  }

  clone() {
    const cloned = new FakeMolecule();
    for (const atom of this.atoms.values()) {
      const next = cloned.addAtom(atom.id, atom.name, JSON.parse(JSON.stringify(atom.properties)));
      next.visible = atom.visible;
      next.x = atom.x;
      next.y = atom.y;
    }
    for (const bond of this.bonds.values()) {
      cloned.addBond(bond.id, bond.atoms[0], bond.atoms[1], JSON.parse(JSON.stringify(bond.properties)));
    }
    cloned.properties = JSON.parse(JSON.stringify(this.properties));
    return cloned;
  }

  setResonanceState(n) {
    const resonance = this.properties.resonance;
    if (!resonance) {
      return;
    }
    resonance.currentState = n;
    for (const bond of this.bonds.values()) {
      const state = bond.properties.resonance?.states?.[n];
      if (!state) {
        continue;
      }
      bond.properties.order = state.order;
      bond.properties.localizedOrder = state.localizedOrder;
      bond.properties.aromatic = state.aromatic;
    }
    for (const atom of this.atoms.values()) {
      const state = atom.properties.resonance?.states?.[n];
      if (!state) {
        continue;
      }
      atom.properties.charge = state.charge;
    }
  }
}

function makeDeps() {
  const calls = [];
  return {
    calls,
    deps: {
      Molecule: FakeMolecule,
      getMode: () => '2d',
      setMode(mode) {
        calls.push(['setMode', mode]);
      },
      updateModeChrome(mode) {
        calls.push(['updateModeChrome', mode]);
      },
      setRotationDeg(value) {
        calls.push(['setRotationDeg', value]);
      },
      setFlipH(value) {
        calls.push(['setFlipH', value]);
      },
      setFlipV(value) {
        calls.push(['setFlipV', value]);
      },
      clearReactionPreviewState() {
        calls.push(['clearReactionPreviewState']);
      },
      clearForceState() {
        calls.push(['clearForceState']);
      },
      clear2dState() {
        calls.push(['clear2dState']);
      },
      setCurrentSmiles(value) {
        calls.push(['setCurrentSmiles', value]);
      },
      setCurrentInchi(value) {
        calls.push(['setCurrentInchi', value]);
      },
      setInputFormat(mode, options) {
        calls.push(['setInputFormat', mode, options]);
      },
      setCurrentMol(value) {
        calls.push(['setCurrentMol', value]);
      },
      setMol2d(value) {
        calls.push(['setMol2d', value]);
      },
      clearAnalysisState() {
        calls.push(['clearAnalysisState']);
      },
      clearHighlightState() {
        calls.push(['clearHighlightState']);
      },
      restorePanelState(panelState, options) {
        calls.push(['restorePanelState', panelState, options]);
      },
      restoreInteractionState(snapshot) {
        calls.push([
          'restoreInteractionState',
          snapshot.toolMode ?? snapshot.interactionState?.toolMode ?? null,
          snapshot.drawBondType ?? snapshot.interactionState?.drawBondType ?? null,
          snapshot.ringTemplateSize ?? snapshot.interactionState?.ringTemplateSize ?? null
        ]);
      },
      restoreZoomTransform(snapshot) {
        calls.push(['restoreZoomTransform', snapshot]);
      },
      restoreReactionPreviewSnapshot(snapshot) {
        calls.push(['restoreReactionPreviewSnapshot', snapshot]);
      },
      restore2dState(displayMol, snap) {
        calls.push(['restore2dState', displayMol.properties, snap.mode, [...displayMol.bonds.values()].map(bond => ({ id: bond.id, properties: { ...bond.properties } }))]);
      },
      restoreForceState(displayMol, snap) {
        calls.push(['restoreForceState', displayMol.properties, snap.mode, [...displayMol.bonds.values()].map(bond => ({ id: bond.id, properties: { ...bond.properties } }))]);
      },
      updateFormula(mol) {
        calls.push(['updateFormula', mol.properties]);
      },
      updateDescriptors(mol) {
        calls.push(['updateDescriptors', mol.properties]);
      },
      updateAnalysisPanels(mol) {
        calls.push(['updateAnalysisPanels', mol.properties]);
      },
      updateReactionTemplatesPanel() {
        calls.push(['updateReactionTemplatesPanel']);
      },
      restorePersistentHighlight() {
        calls.push(['restorePersistentHighlight']);
      },
      reapplyActiveReactionPreview() {
        calls.push(['reapplyActiveReactionPreview']);
        return false;
      },
      restoreResonanceViewSnapshot() {
        calls.push(['restoreResonanceViewSnapshot']);
        return false;
      },
      redrawRestoredResonanceView() {
        calls.push(['redrawRestoredResonanceView']);
      },
      restorePhyschemHighlightSnapshot() {
        calls.push(['restorePhyschemHighlightSnapshot']);
        return false;
      },
      restoreFunctionalGroupHighlightSnapshot() {
        calls.push(['restoreFunctionalGroupHighlightSnapshot']);
        return false;
      },
      syncInputField(mol) {
        calls.push(['syncInputField', mol.properties]);
      }
    }
  };
}

function makeCaptureDeps() {
  const activeMol = new FakeMolecule();
  activeMol.addAtom('A1', 'C', {});
  activeMol.properties = { resonance: { count: 2, currentState: 1 } };

  return {
    Molecule: FakeMolecule,
    getMode: () => '2d',
    setMode() {},
    updateModeChrome() {},
    getActiveMolecule: () => activeMol,
    getCurrentMol: () => null,
    setCurrentMol() {},
    getMol2d: () => activeMol,
    setMol2d() {},
    getCurrentSmiles: () => 'C',
    setCurrentSmiles() {},
    getCurrentInchi: () => null,
    setCurrentInchi() {},
    getInputMode: () => 'smiles',
    getInputValue: () => 'C',
    setInputFormat() {},
    syncInputField() {},
    serializeSnapshotMol: mol => ({
      atoms: [...mol.atoms.values()].map(atom => ({
        id: atom.id,
        name: atom.name,
        x: atom.x,
        y: atom.y,
        visible: atom.visible,
        properties: { ...atom.properties }
      })),
      bonds: [],
      moleculeProperties: { ...mol.properties }
    }),
    captureReactionPreviewSnapshot: () => null,
    restoreReactionPreviewSnapshot() {},
    clearReactionPreviewState() {},
    reapplyActiveReactionPreview() {
      return false;
    },
    updateReactionTemplatesPanel() {},
    prepareResonanceUndoSnapshot: mol => ({ mol, resonanceView: { locked: true, activeState: 2 } }),
    restoreResonanceViewSnapshot() {
      return false;
    },
    captureViewState: () => ({
      mode: '2d',
      zoomTransform: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null
    }),
    captureInteractionState: () => ({
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      drawBondType: 'single',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0
    }),
    captureHighlightState: () => null,
    capturePanelState: () => null,
    setRotationDeg() {},
    setFlipH() {},
    setFlipV() {},
    restoreZoomTransform() {},
    clearForceState() {},
    clear2dState() {},
    clearAnalysisState() {},
    restore2dState() {},
    restoreForceState() {},
    restorePanelState() {},
    restoreInteractionState() {},
    clearHighlightState() {},
    restoreFunctionalGroupHighlightSnapshot() {
      return false;
    },
    restorePhyschemHighlightSnapshot() {
      return false;
    },
    restorePersistentHighlight() {},
    updateFormula() {},
    updateDescriptors() {},
    updateAnalysisPanels() {},
    redrawRestoredResonanceView() {}
  };
}

describe('createSessionSnapshotManager', () => {
  it('stores the resonance view snapshot when capturing undo state', () => {
    const manager = createSessionSnapshotManager(makeCaptureDeps());

    const snapshot = manager.capture();

    assert.deepEqual(snapshot.overlayState?.resonanceView, { locked: true, activeState: 2 });
  });

  it('preserves molecule-level properties when syncing input from a reaction-preview source snapshot', () => {
    const { deps, calls } = makeDeps();
    const manager = createSessionSnapshotManager(deps);

    manager.restore({
      mode: '2d',
      atoms: [{ id: 'A1', name: 'C', properties: {}, x: 0, y: 0 }],
      bonds: [],
      moleculeProperties: { base: 'visible' },
      currentSmiles: 'C',
      currentInchi: null,
      inputMode: null,
      inputValue: null,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null,
      zoomTransform: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: {
        sourceMol: {
          atoms: [{ id: 'A1', name: 'C', properties: {}, x: 0, y: 0 }],
          bonds: [],
          moleculeProperties: { sourceTag: 'kept' }
        },
        displayMol: null
      },
      resonanceView: null
    });

    assert.ok(calls.some(call => call[0] === 'syncInputField' && call[1]?.sourceTag === 'kept'));
  });

  it('clears each runtime view state only once when restoring an empty snapshot', () => {
    const { deps, calls } = makeDeps();
    const manager = createSessionSnapshotManager(deps);

    manager.restore({
      empty: true,
      mode: '2d',
      currentSmiles: null,
      currentInchi: null,
      inputMode: 'smiles',
      inputValue: '',
      zoomTransform: { x: 0, y: 0, k: 1 },
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: null,
      resonanceView: null
    });

    assert.equal(calls.filter(call => call[0] === 'clearForceState').length, 1);
    assert.equal(calls.filter(call => call[0] === 'clear2dState').length, 1);
  });

  it('restores non-constructor bond properties such as localized aromatic orders', () => {
    const { deps, calls } = makeDeps();
    const manager = createSessionSnapshotManager(deps);

    manager.restore({
      mode: '2d',
      atoms: [
        { id: 'A1', name: 'C', properties: { aromatic: true }, x: 0, y: 0 },
        { id: 'A2', name: 'N', properties: { aromatic: true }, x: 1, y: 0 }
      ],
      bonds: [
        {
          id: 'B1',
          atoms: ['A1', 'A2'],
          properties: {
            order: 1.5,
            aromatic: true,
            localizedOrder: 2
          }
        }
      ],
      moleculeProperties: {},
      currentSmiles: null,
      currentInchi: null,
      inputMode: null,
      inputValue: null,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null,
      zoomTransform: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: null,
      resonanceView: null
    });

    const restore2dCall = calls.find(call => call[0] === 'restore2dState');
    assert.equal(restore2dCall?.[3]?.[0]?.properties?.localizedOrder, 2);
  });

  it('restores atom, bond, and molecule visual style metadata from undo snapshots', () => {
    const { deps, calls } = makeDeps();
    deps.restore2dState = displayMol => {
      calls.push(['restore2dState', displayMol]);
    };
    deps.syncInputField = mol => {
      calls.push(['syncInputField', mol]);
    };
    const manager = createSessionSnapshotManager(deps);

    manager.restore({
      mode: '2d',
      atoms: [
        { id: 'A1', name: 'C', properties: { style: { color: '#3366ff', opacity: 0.8 } }, x: 0, y: 0 },
        { id: 'A2', name: 'O', properties: {}, x: 1, y: 0 }
      ],
      bonds: [
        {
          id: 'B1',
          atoms: ['A1', 'A2'],
          properties: { order: 1, style: { color: '#ff6633', opacity: 0.4 } }
        }
      ],
      moleculeProperties: {
        style: {
          ringFills: [{ id: 'rf1', atomIds: ['A1', 'A2', 'A3'], color: '#ffe66d', opacity: 0.25 }]
        }
      },
      currentSmiles: null,
      currentInchi: null,
      inputMode: null,
      inputValue: null,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null,
      zoomTransform: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: null,
      resonanceView: null
    });

    const restoredMol = calls.find(call => call[0] === 'restore2dState')?.[1];

    assert.deepEqual(restoredMol.atoms.get('A1').properties.style, { color: '#3366ff', opacity: 0.8 });
    assert.deepEqual(restoredMol.bonds.get('B1').properties.style, { color: '#ff6633', opacity: 0.4 });
    assert.deepEqual(restoredMol.properties.style.ringFills, [{ id: 'rf1', atomIds: ['A1', 'A2', 'A3'], color: '#ffe66d', opacity: 0.25 }]);
  });

  it('reapplies a reaction preview when the restored display molecule is missing product atoms', () => {
    const { deps, calls } = makeDeps();
    deps.reapplyActiveReactionPreview = () => {
      calls.push(['reapplyActiveReactionPreview']);
      return true;
    };
    const manager = createSessionSnapshotManager(deps);
    const sourceMol = {
      atoms: [{ id: 'A1', name: 'C', properties: {}, x: 0, y: 0 }],
      bonds: [],
      moleculeProperties: {}
    };

    manager.restore({
      mode: '2d',
      atoms: sourceMol.atoms,
      bonds: sourceMol.bonds,
      moleculeProperties: sourceMol.moleculeProperties,
      currentSmiles: 'C',
      currentInchi: null,
      inputMode: null,
      inputValue: null,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null,
      zoomTransform: { x: 12, y: 4, k: 1.5 },
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: {
        sourceMol,
        displayMol: sourceMol,
        activeReactionSmirks: '[C:1]>>[C:1].[O:2]',
        activeReactionMatchIndex: 0,
        reactionPreviewLocked: true,
        reactantAtomIds: ['A1'],
        productAtomIds: ['P1'],
        productComponentAtomIdSets: [['P1']],
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
        entryZoomTransform: null,
        entryDisplayMol: sourceMol,
        entryMode: '2d',
        entryForceNodePositions: null
      },
      resonanceView: null
    });

    assert.ok(calls.some(call => call[0] === 'reapplyActiveReactionPreview'));
    assert.ok(calls.some(call => call[0] === 'restoreZoomTransform' && call[1]?.k === 1.5));
  });

  it('does not rebuild a complete reaction preview snapshot during restore', () => {
    const { deps, calls } = makeDeps();
    deps.reapplyActiveReactionPreview = () => {
      calls.push(['reapplyActiveReactionPreview']);
      return true;
    };
    const manager = createSessionSnapshotManager(deps);
    const sourceMol = {
      atoms: [{ id: 'A1', name: 'C', properties: {}, x: 0, y: 0 }],
      bonds: [],
      moleculeProperties: {}
    };
    const displayMol = {
      atoms: [
        { id: 'A1', name: 'C', properties: {}, x: 0, y: 0 },
        { id: 'P1', name: 'O', properties: {}, x: 4, y: 3 }
      ],
      bonds: [{ id: 'B1', atoms: ['A1', 'P1'], properties: { order: 1 } }],
      moleculeProperties: {}
    };

    manager.restore({
      mode: '2d',
      atoms: sourceMol.atoms,
      bonds: sourceMol.bonds,
      moleculeProperties: sourceMol.moleculeProperties,
      currentSmiles: 'C',
      currentInchi: null,
      inputMode: null,
      inputValue: null,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null,
      zoomTransform: { x: 12, y: 4, k: 1.5 },
      rotationDeg: 90,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: {
        sourceMol,
        displayMol,
        activeReactionSmirks: '[C:1]>>[C:1].[O:2]',
        activeReactionMatchIndex: 0,
        reactionPreviewLocked: true,
        reactantAtomIds: ['A1'],
        productAtomIds: ['P1'],
        productComponentAtomIdSets: [['P1']],
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
        entryZoomTransform: null,
        entryDisplayMol: sourceMol,
        entryMode: '2d',
        entryForceNodePositions: null
      },
      resonanceView: null
    });

    assert.equal(calls.filter(call => call[0] === 'restore2dState').length, 2);
    assert.equal(calls.some(call => call[0] === 'reapplyActiveReactionPreview'), false);
    assert.ok(calls.some(call => call[0] === 'restoreZoomTransform' && call[1]?.k === 1.5));
  });

  it('preserves the selected bond draw type when restoring an app snapshot', () => {
    const { deps, calls } = makeDeps();
    const manager = createSessionSnapshotManager(deps);

    manager.restore({
      mode: '2d',
      documentState: {
        mode: '2d',
        molecule: {
          atoms: [{ id: 'A1', name: 'C', properties: {}, x: 0, y: 0 }],
          bonds: [],
          moleculeProperties: {}
        }
      },
      viewState: {
        zoomTransform: null,
        rotationDeg: 0,
        flipH: false,
        flipV: false,
        cx2d: 0,
        cy2d: 0,
        hCounts2d: [],
        stereoMap2d: null
      },
      interactionState: {
        selectedAtomIds: [],
        selectedBondIds: [],
        toolMode: 'draw-bond',
        ringTemplateSize: 5,
        drawBondElement: 'C',
        drawBondType: 'dash',
        forceAutoFitEnabled: true,
        forceKeepInView: false,
        forceKeepInViewTicks: 0
      },
      highlightState: null,
      panelState: null,
      overlayState: {
        reactionPreview: null,
        resonanceView: null
      }
    });

    const restoreInteractionCall = calls.find(call => call[0] === 'restoreInteractionState');
    assert.deepEqual(restoreInteractionCall, ['restoreInteractionState', 'draw-bond', 'dash', 5]);
  });

  it('restores resonance analysis against the same 2D molecule instance shown in the viewport', () => {
    const { deps, calls } = makeDeps();
    deps.restoreResonanceViewSnapshot = mol => {
      calls.push(['restoreResonanceViewSnapshot', mol]);
      return false;
    };
    deps.updateAnalysisPanels = mol => {
      calls.push(['updateAnalysisPanels', mol]);
    };
    deps.restore2dState = (displayMol, snap) => {
      calls.push(['restore2dState', displayMol, snap.mode]);
    };

    const manager = createSessionSnapshotManager(deps);

    manager.restore({
      mode: '2d',
      atoms: [{ id: 'A1', name: 'C', properties: {}, x: 0, y: 0 }],
      bonds: [],
      moleculeProperties: { restored: true },
      currentSmiles: 'C',
      currentInchi: null,
      inputMode: null,
      inputValue: null,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null,
      zoomTransform: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: null,
      resonanceView: null
    });

    const restoredDisplayMol = calls.find(call => call[0] === 'restore2dState')?.[1];
    const analysisMol = calls.find(call => call[0] === 'updateAnalysisPanels')?.[1];
    const resonanceMol = calls.find(call => call[0] === 'restoreResonanceViewSnapshot')?.[1];

    assert.ok(restoredDisplayMol);
    assert.equal(analysisMol, restoredDisplayMol);
    assert.equal(resonanceMol, restoredDisplayMol);
  });

  it('restores functional-group highlights against the base resonance contributor', () => {
    const { deps, calls } = makeDeps();
    let functionalGroupMol = null;
    deps.restoreResonanceViewSnapshot = mol => {
      mol.setResonanceState(2);
      calls.push(['restoreResonanceViewSnapshot', mol.properties.resonance.currentState, mol.bonds.get('B1').properties.order]);
      return true;
    };
    deps.restoreFunctionalGroupHighlightSnapshot = (snapshot, mol) => {
      functionalGroupMol = mol;
      calls.push(['restoreFunctionalGroupHighlightSnapshot', mol.properties.resonance.currentState, mol.bonds.get('B1').properties.order]);
      return false;
    };

    const manager = createSessionSnapshotManager(deps);

    manager.restore({
      mode: '2d',
      atoms: [
        { id: 'A1', name: 'C', properties: {}, x: 0, y: 0 },
        { id: 'A2', name: 'O', properties: {}, x: 1, y: 0 }
      ],
      bonds: [
        {
          id: 'B1',
          atoms: ['A1', 'A2'],
          properties: {
            order: 2,
            resonance: {
              states: {
                1: { order: 2, localizedOrder: null, aromatic: false },
                2: { order: 1, localizedOrder: null, aromatic: false }
              }
            }
          }
        }
      ],
      moleculeProperties: { resonance: { count: 2, currentState: 1, weights: [50, 50] } },
      currentSmiles: 'C=O',
      currentInchi: null,
      inputMode: null,
      inputValue: null,
      cx2d: 0,
      cy2d: 0,
      hCounts2d: [],
      stereoMap2d: null,
      zoomTransform: null,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'pan',
      drawBondElement: 'C',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 0,
      highlightState: null,
      panelState: null,
      reactionPreview: null,
      resonanceView: { locked: true, activeState: 2, activePairIndex: 0, activeDirection: 'forward' }
    });

    assert.ok(functionalGroupMol);
    assert.equal(functionalGroupMol.properties.resonance.currentState, 1);
    assert.equal(functionalGroupMol.bonds.get('B1').properties.order, 2);
    assert.deepEqual(calls.filter(call => call[0] === 'restoreFunctionalGroupHighlightSnapshot'), [['restoreFunctionalGroupHighlightSnapshot', 1, 2]]);
  });
});
