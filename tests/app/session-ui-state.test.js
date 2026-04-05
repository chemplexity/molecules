import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionUiStateBridge } from '../../src/app/core/session-ui-state.js';

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
    getDrawBondElement: () => 'C',
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
    setDrawBondElement() {},
    setSelectMode() {},
    setDrawBondMode() {},
    setEraseMode() {},
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

  it('captures and restores interaction state through one helper', () => {
    let selectedAtomIds = new Set(['a1']);
    let selectedBondIds = new Set(['b1']);
    let selectMode = true;
    let drawBondMode = false;
    let eraseMode = false;
    let drawBondElement = 'N';
    let forceAutoFitEnabled = false;
    let forceKeepInView = true;
    let forceKeepInViewTicks = 4;
    const calls = [];

    const bridge = makeSessionUiStateBridge({
      getSelectedAtomIds: () => selectedAtomIds,
      getSelectedBondIds: () => selectedBondIds,
      getSelectMode: () => selectMode,
      getDrawBondMode: () => drawBondMode,
      getEraseMode: () => eraseMode,
      getDrawBondElement: () => drawBondElement,
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
      setDrawBondElement(value) {
        drawBondElement = value;
      },
      setSelectMode(value) {
        selectMode = value;
      },
      setDrawBondMode(value) {
        drawBondMode = value;
      },
      setEraseMode(value) {
        eraseMode = value;
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
      drawBondElement: 'N',
      forceAutoFitEnabled: false,
      forceKeepInView: true,
      forceKeepInViewTicks: 4
    });

    bridge.restoreInteractionState({
      selectedAtomIds: ['a2'],
      selectedBondIds: ['b2'],
      toolMode: 'draw-bond',
      drawBondElement: 'O',
      forceAutoFitEnabled: true,
      forceKeepInView: false,
      forceKeepInViewTicks: 1
    });

    assert.deepEqual([...selectedAtomIds], ['a2']);
    assert.deepEqual([...selectedBondIds], ['b2']);
    assert.equal(selectMode, false);
    assert.equal(drawBondMode, true);
    assert.equal(eraseMode, false);
    assert.equal(drawBondElement, 'O');
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
  });
});
