import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Molecule } from '../../../src/core/Molecule.js';
import { createSessionUiStateBridge } from '../../../src/app/core/session-ui-state.js';

function makeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(token) {
      classes.add(token);
    },
    remove(token) {
      classes.delete(token);
    },
    toggle(token, force) {
      if (force === undefined) {
        if (classes.has(token)) {
          classes.delete(token);
        } else {
          classes.add(token);
        }
        return;
      }
      if (force) {
        classes.add(token);
      } else {
        classes.delete(token);
      }
    },
    contains(token) {
      return classes.has(token);
    }
  };
}

function makeSessionUiStateBridge(overrides = {}) {
  return createSessionUiStateBridge({
    document: overrides.document ?? {
      getElementById() {
        return { innerHTML: '' };
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    updateFunctionalGroups() {},
    updateReactionTemplatesPanel() {},
    updateResonancePanel() {},
    clearResonancePanelState() {},
    getSelectedAtomIds: () => new Set(),
    getSelectedBondIds: () => new Set(),
    getSelectMode: () => false,
    getDrawBondMode: () => false,
    getEraseMode: () => false,
    getPaintMode: () => false,
    getPaintTool: () => 'brush',
    getChargeTool: () => null,
    getDrawBondElement: () => 'C',
    getDrawBondType: () => 'single',
    getForceAutoFitEnabled: () => true,
    getForceKeepInView: () => false,
    getForceKeepInViewTicks: () => 0,
    setSelectedAtomIds() {},
    setSelectedBondIds() {},
    clearHoveredAtomIds() {},
    clearHoveredBondIds() {},
    setSelectionModifierActive() {},
    setDrawBondState() {},
    setDrawBondHoverSuppressed() {},
    setErasePainting() {},
    setChargeTool() {},
    setPaintTool() {},
    setDrawBondElement() {},
    setDrawBondType() {},
    setSelectMode() {},
    setDrawBondMode() {},
    setEraseMode() {},
    setPaintMode() {},
    setForceAutoFitEnabled() {},
    setForceKeepInView() {},
    setForceKeepInViewTicks() {},
    clearDrawBondArtifacts() {},
    hideTooltip() {},
    clearSelectionValenceTooltip() {},
    syncToolButtonsFromState() {},
    refreshSelectionOverlay() {},
    ...overrides
  });
}

describe('createSessionUiStateBridge', () => {
  it('serializes atom, bond, and molecule visual style metadata for undo snapshots', () => {
    const mol = new Molecule();
    mol.addAtom('a1', 'C', { style: { color: '#3366ff', opacity: 0.8 } });
    mol.addAtom('a2', 'O');
    mol.addBond('b1', 'a1', 'a2', { style: { color: '#ff6633', opacity: 0.4 } }, false);
    mol.setRingFill(['a1', 'a2', 'a3'], { color: '#ffe66d', opacity: 0.25 });

    const bridge = makeSessionUiStateBridge();
    const snapshotMol = bridge.serializeSnapshotMol(mol);

    assert.deepEqual(snapshotMol.atoms.find(atom => atom.id === 'a1').properties.style, { color: '#3366ff', opacity: 0.8 });
    assert.deepEqual(snapshotMol.bonds.find(bond => bond.id === 'b1').properties.style, { color: '#ff6633', opacity: 0.4 });
    assert.deepEqual(snapshotMol.moleculeProperties.style.ringFills, [
      {
        id: 'ring-fill:a1\u0000a2\u0000a3',
        atomIds: ['a1', 'a2', 'a3'],
        color: '#ffe66d',
        opacity: 0.25
      }
    ]);
  });

  it('captures and restores panel tab state', () => {
    const descButtons = [
      { dataset: { tab: 'general' }, classList: makeClassList(['active']) },
      { dataset: { tab: 'smarts' }, classList: makeClassList() }
    ];
    const descPanels = [
      { id: 'tab-general', style: { display: '' } },
      { id: 'tab-smarts', style: { display: 'none' } }
    ];
    const smartsButtons = [
      { dataset: { tab: 'functional-groups' }, classList: makeClassList() },
      { dataset: { tab: 'reactions' }, classList: makeClassList(['active']) }
    ];
    const smartsPanels = [
      { id: 'tab-functional-groups', style: { display: 'none' } },
      { id: 'tab-reactions', style: { display: '' } }
    ];

    const documentMock = {
      querySelector(selector) {
        if (selector === '.desc-tab.active') {
          return descButtons.find(btn => btn.classList.contains('active')) ?? null;
        }
        if (selector === '.smarts-tab.active') {
          return smartsButtons.find(btn => btn.classList.contains('active')) ?? null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.desc-tab') {
          return descButtons;
        }
        if (selector === '.desc-tab-panel') {
          return descPanels;
        }
        if (selector === '.smarts-tab') {
          return smartsButtons;
        }
        if (selector === '.smarts-tab-panel') {
          return smartsPanels;
        }
        return [];
      },
      getElementById() {
        return { innerHTML: '' };
      }
    };

    const bridge = makeSessionUiStateBridge({ document: documentMock });

    assert.deepEqual(bridge.capturePanelState(), {
      descriptorTab: 'general',
      smartsTab: 'reactions'
    });

    bridge.restorePanelState({
      descriptorTab: 'smarts',
      smartsTab: 'functional-groups'
    });

    assert.equal(descButtons[0].classList.contains('active'), false);
    assert.equal(descButtons[1].classList.contains('active'), true);
    assert.equal(descPanels[0].style.display, 'none');
    assert.equal(descPanels[1].style.display, '');
    assert.equal(smartsButtons[0].classList.contains('active'), true);
    assert.equal(smartsButtons[1].classList.contains('active'), false);
    assert.equal(smartsPanels[0].style.display, '');
    assert.equal(smartsPanels[1].style.display, 'none');
  });

  it('treats the resonance/other tab as transient and restores the default SMARTS tab when absent', () => {
    const smartsButtons = [
      { dataset: { tab: 'functional-groups' }, classList: makeClassList() },
      { dataset: { tab: 'reactions' }, classList: makeClassList() },
      { dataset: { tab: 'other' }, classList: makeClassList(['active']) }
    ];
    const smartsPanels = [
      { id: 'tab-functional-groups', style: { display: 'none' } },
      { id: 'tab-reactions', style: { display: 'none' } },
      { id: 'tab-other', style: { display: '' } }
    ];

    const documentMock = {
      querySelector(selector) {
        if (selector === '.smarts-tab.active') {
          return smartsButtons.find(btn => btn.classList.contains('active')) ?? null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.smarts-tab') {
          return smartsButtons;
        }
        if (selector === '.smarts-tab-panel') {
          return smartsPanels;
        }
        return [];
      },
      getElementById() {
        return { innerHTML: '' };
      }
    };

    const bridge = makeSessionUiStateBridge({ document: documentMock });

    assert.deepEqual(bridge.capturePanelState(), {
      descriptorTab: null,
      smartsTab: null
    });

    bridge.restorePanelState({ descriptorTab: null, smartsTab: null });

    assert.equal(smartsButtons[0].classList.contains('active'), true);
    assert.equal(smartsButtons[1].classList.contains('active'), false);
    assert.equal(smartsButtons[2].classList.contains('active'), false);
    assert.equal(smartsPanels[0].style.display, '');
    assert.equal(smartsPanels[1].style.display, 'none');
    assert.equal(smartsPanels[2].style.display, 'none');
  });

  it('can restore descriptor state without changing the active SMARTS tab', () => {
    const descButtons = [
      { dataset: { tab: 'general' }, classList: makeClassList(['active']) },
      { dataset: { tab: 'smarts' }, classList: makeClassList() }
    ];
    const descPanels = [
      { id: 'tab-general', style: { display: '' } },
      { id: 'tab-smarts', style: { display: 'none' } }
    ];
    const smartsButtons = [
      { dataset: { tab: 'functional-groups' }, classList: makeClassList() },
      { dataset: { tab: 'reactions' }, classList: makeClassList() },
      { dataset: { tab: 'other' }, classList: makeClassList(['active']) }
    ];
    const smartsPanels = [
      { id: 'tab-functional-groups', style: { display: 'none' } },
      { id: 'tab-reactions', style: { display: 'none' } },
      { id: 'tab-other', style: { display: '' } }
    ];

    const documentMock = {
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.desc-tab') {
          return descButtons;
        }
        if (selector === '.desc-tab-panel') {
          return descPanels;
        }
        if (selector === '.smarts-tab') {
          return smartsButtons;
        }
        if (selector === '.smarts-tab-panel') {
          return smartsPanels;
        }
        return [];
      },
      getElementById() {
        return { innerHTML: '' };
      }
    };

    const bridge = makeSessionUiStateBridge({ document: documentMock });

    bridge.restorePanelState({ descriptorTab: 'smarts', smartsTab: 'functional-groups' }, { preserveSmartsTab: true });

    assert.equal(descButtons[0].classList.contains('active'), false);
    assert.equal(descButtons[1].classList.contains('active'), true);
    assert.equal(descPanels[0].style.display, 'none');
    assert.equal(descPanels[1].style.display, '');
    assert.equal(smartsButtons[0].classList.contains('active'), false);
    assert.equal(smartsButtons[1].classList.contains('active'), false);
    assert.equal(smartsButtons[2].classList.contains('active'), true);
    assert.equal(smartsPanels[0].style.display, 'none');
    assert.equal(smartsPanels[1].style.display, 'none');
    assert.equal(smartsPanels[2].style.display, '');
  });

  it('captures and restores interaction state through one helper', () => {
    let selectedAtomIds = new Set(['a1']);
    let selectedBondIds = new Set(['b1']);
    let selectMode = true;
    let drawBondMode = false;
    let ringTemplateMode = false;
    let ringTemplateSize = 6;
    let eraseMode = false;
    let paintMode = false;
    let paintTool = 'brush';
    let paintColor = '#3366ff';
    let paintBrushSize = 12;
    let paintOpacity = 1;
    let chargeTool = 'positive';
    let drawBondElement = 'N';
    let drawBondType = 'double';
    let forceAutoFitEnabled = false;
    let forceKeepInView = true;
    let forceKeepInViewTicks = 4;
    const calls = [];

    const bridge = makeSessionUiStateBridge({
      getSelectedAtomIds: () => selectedAtomIds,
      getSelectedBondIds: () => selectedBondIds,
      getSelectMode: () => selectMode,
      getDrawBondMode: () => drawBondMode,
      getRingTemplateMode: () => ringTemplateMode,
      getRingTemplateSize: () => ringTemplateSize,
      getEraseMode: () => eraseMode,
      getPaintMode: () => paintMode,
      getPaintTool: () => paintTool,
      getPaintColor: () => paintColor,
      getPaintBrushSize: () => paintBrushSize,
      getPaintOpacity: () => paintOpacity,
      getChargeTool: () => chargeTool,
      getDrawBondElement: () => drawBondElement,
      getDrawBondType: () => drawBondType,
      getForceAutoFitEnabled: () => forceAutoFitEnabled,
      getForceKeepInView: () => forceKeepInView,
      getForceKeepInViewTicks: () => forceKeepInViewTicks,
      setSelectedAtomIds(value) {
        selectedAtomIds = value;
      },
      setSelectedBondIds(value) {
        selectedBondIds = value;
      },
      clearHoveredAtomIds() {
        calls.push('clearHoveredAtomIds');
      },
      clearHoveredBondIds() {
        calls.push('clearHoveredBondIds');
      },
      setSelectionModifierActive(value) {
        calls.push(['setSelectionModifierActive', value]);
      },
      setDrawBondState(value) {
        calls.push(['setDrawBondState', value]);
      },
      setDrawBondHoverSuppressed(value) {
        calls.push(['setDrawBondHoverSuppressed', value]);
      },
      setErasePainting(value) {
        calls.push(['setErasePainting', value]);
      },
      setChargeTool(value) {
        chargeTool = value;
      },
      setDrawBondElement(value) {
        drawBondElement = value;
      },
      setDrawBondType(value) {
        drawBondType = value;
      },
      setSelectMode(value) {
        selectMode = value;
      },
      setDrawBondMode(value) {
        drawBondMode = value;
      },
      setRingTemplateMode(value) {
        ringTemplateMode = value;
      },
      setRingTemplateSize(value) {
        ringTemplateSize = value;
      },
      setEraseMode(value) {
        eraseMode = value;
      },
      setPaintMode(value) {
        paintMode = value;
      },
      setPaintTool(value) {
        paintTool = value;
      },
      setPaintColor(value) {
        paintColor = value;
      },
      setPaintBrushSize(value) {
        paintBrushSize = value;
      },
      setPaintOpacity(value) {
        paintOpacity = value;
      },
      setForceAutoFitEnabled(value) {
        forceAutoFitEnabled = value;
      },
      setForceKeepInView(value) {
        forceKeepInView = value;
      },
      setForceKeepInViewTicks(value) {
        forceKeepInViewTicks = value;
      },
      clearDrawBondArtifacts() {
        calls.push('clearDrawBondArtifacts');
      },
      hideTooltip() {
        calls.push('hideTooltip');
      },
      clearSelectionValenceTooltip() {
        calls.push('clearSelectionValenceTooltip');
      },
      syncToolButtonsFromState() {
        calls.push('syncToolButtonsFromState');
      },
      refreshSelectionOverlay() {
        calls.push('refreshSelectionOverlay');
      }
    });

    assert.deepEqual(bridge.captureInteractionState(), {
      selectedAtomIds: ['a1'],
      selectedBondIds: ['b1'],
      toolMode: 'select',
      chargeTool: 'positive',
      paintTool: 'brush',
      paintColor: '#3366ff',
      paintBrushSize: 12,
      paintOpacity: 1,
      ringTemplateSize: 6,
      drawBondElement: 'N',
      drawBondType: 'double',
      forceAutoFitEnabled: false,
      forceKeepInView: true,
      forceKeepInViewTicks: 4
    });

    bridge.restoreInteractionState({
      selectedAtomIds: ['a2'],
      selectedBondIds: ['b2'],
      toolMode: 'charge-negative',
      chargeTool: 'negative',
      paintTool: 'bucket',
      paintColor: '#ff6633',
      paintBrushSize: 20,
      paintOpacity: 0.45,
      ringTemplateSize: 5,
      drawBondElement: 'O',
      drawBondType: 'dash',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 1
    });

    assert.deepEqual([...selectedAtomIds], ['a2']);
    assert.deepEqual([...selectedBondIds], ['b2']);
    assert.equal(selectMode, false);
    assert.equal(drawBondMode, false);
    assert.equal(ringTemplateMode, false);
    assert.equal(ringTemplateSize, 5);
    assert.equal(eraseMode, false);
    assert.equal(paintMode, false);
    assert.equal(paintTool, 'brush');
    assert.equal(paintColor, '#3366ff');
    assert.equal(paintBrushSize, 12);
    assert.equal(paintOpacity, 1);
    assert.equal(chargeTool, 'negative');
    assert.equal(drawBondElement, 'O');
    assert.equal(drawBondType, 'dash');
    assert.equal(forceAutoFitEnabled, true);
    assert.equal(forceKeepInView, false);
    assert.equal(forceKeepInViewTicks, 1);
    assert.deepEqual(calls, [
      'clearHoveredAtomIds',
      'clearHoveredBondIds',
      ['setSelectionModifierActive', false],
      ['setDrawBondState', null],
      ['setDrawBondHoverSuppressed', false],
      ['setErasePainting', false],
      'clearDrawBondArtifacts',
      'hideTooltip',
      'clearSelectionValenceTooltip',
      'syncToolButtonsFromState',
      'refreshSelectionOverlay'
    ]);

    calls.length = 0;
    paintMode = true;
    paintTool = 'bucket';
    paintColor = '#ff6633';
    paintBrushSize = 20;
    paintOpacity = 0.45;
    selectMode = false;
    ringTemplateMode = true;
    ringTemplateSize = 7;
    chargeTool = null;
    assert.equal(bridge.captureInteractionState().toolMode, 'ring-template');
    assert.equal(bridge.captureInteractionState().ringTemplateSize, 7);
    ringTemplateMode = false;
    paintMode = true;
    assert.equal(bridge.captureInteractionState().toolMode, 'paint');

    bridge.restoreInteractionState({
      selectedAtomIds: [],
      selectedBondIds: [],
      toolMode: 'paint'
    });
    assert.equal(paintMode, true);
    assert.equal(paintTool, 'bucket');
    assert.equal(paintColor, '#ff6633');
    assert.equal(paintBrushSize, 20);
    assert.equal(paintOpacity, 0.45);
    assert.equal(selectMode, false);
    assert.equal(drawBondMode, false);
    assert.equal(ringTemplateMode, false);
    assert.equal(eraseMode, false);
    assert.equal(calls.includes('syncToolButtonsFromState'), true);
  });
});
