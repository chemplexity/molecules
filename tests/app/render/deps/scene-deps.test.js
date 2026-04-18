import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  create2DHighlightRendererDeps,
  create2DSceneRendererDeps,
  createForceHighlightRendererDeps,
  createForceSceneRendererDeps,
  createForceSelectionRendererDeps,
  createForceViewportStateDeps,
  createSelectionOverlayManagerDeps
} from '../../../../src/app/render/deps/scene-deps.js';

describe('scene deps builders', () => {
  it('builds highlight and viewport deps with delegated callbacks', () => {
    const records = [];

    const highlight2D = create2DHighlightRendererDeps({
      getGraphSelection: () => ({ id: 'g' }),
      getMol: () => ({ id: 'mol2d' }),
      getHCounts: () => ({ H: 2 }),
      toSVGPt: atom => ({ x: atom.x, y: atom.y }),
      getFontSize: () => 14
    });
    const forceHighlight = createForceHighlightRendererDeps({
      getGraphSelection: () => ({ id: 'g' }),
      getNodes: () => [{ id: 1 }],
      getLinks: () => [{ id: 2 }],
      setHighlightLines: value => records.push(['lines', value]),
      setHighlightCircles: value => records.push(['circles', value]),
      getHighlightRadius: () => 8,
      getOutlineWidth: () => 2,
      atomRadius: atom => atom.r ?? 4
    });
    const viewport = createForceViewportStateDeps({
      setKeepInView: value => records.push(['keep', value]),
      setKeepInViewTicks: value => records.push(['ticks', value]),
      getDefaultKeepInViewTicks: () => 12
    });

    assert.equal(highlight2D.state.getMol().id, 'mol2d');
    assert.deepEqual(highlight2D.helpers.toSVGPt({ x: 1, y: 2 }), { x: 1, y: 2 });
    forceHighlight.cache.setHighlightLines('L');
    forceHighlight.cache.setHighlightCircles('C');
    assert.deepEqual(records, [
      ['lines', 'L'],
      ['circles', 'C']
    ]);
    assert.equal(viewport.constants.getDefaultKeepInViewTicks(), 12);
  });

  it('builds force scene deps without changing callback shape', () => {
    const records = [];
    const deps = createForceSceneRendererDeps({
      d3: { id: 'd3' },
      svg: { id: 'svg' },
      zoom: { id: 'zoom' },
      g: { id: 'g' },
      plotEl: { id: 'plot' },
      simulation: { id: 'sim' },
      bondOffset: 4,
      valenceWarningFill: '#f00',
      forceLayoutHeavyRepulsion: -10,
      forceLayoutHRepulsion: -5,
      forceLayoutInitialFitPad: 20,
      forceLayoutInitialHRadiusScale: 1.2,
      forceLayoutInitialZoomMultiplier: 1.1,
      forceLayoutInitialKeepInViewTicks: 8,
      forceLayoutFitPad: 16,
      forceLayoutKeepInViewAlphaMin: 0.02,
      setActiveValenceWarningMap: map => records.push(['map', map]),
      setForceAutoFitEnabled: value => records.push(['autofit', value]),
      isForceAutoFitEnabled: () => true,
      enableKeepInView: ticks => records.push(['enableKeep', ticks]),
      disableKeepInView: () => records.push(['disableKeep']),
      isKeepInViewEnabled: () => false,
      getKeepInViewTicks: () => 3,
      setKeepInViewTicks: value => records.push(['keepTicks', value]),
      getPreserveSelectionOnNextRender: () => false,
      setPreserveSelectionOnNextRender: value => records.push(['preserve', value]),
      syncSelectionToMolecule: mol => records.push(['syncSelection', mol]),
      clearSelection: () => records.push(['clearSelection']),
      resetCache: () => records.push(['resetCache']),
      setValenceWarningCircles: value => records.push(['warnings', value]),
      getValenceWarningCircles: () => 'warn',
      getHighlightLines: () => 'hl',
      getHighlightCircles: () => 'hc',
      getSelectionLines: () => 'sl',
      getSelectionCircles: () => 'sc',
      valenceWarningMapFor: mol => ({ mol }),
      buildForceAnchorLayout: mol => ({ mol }),
      convertMolecule: mol => ({ mol }),
      seedForceNodePositions: () => records.push(['seed']),
      patchForceNodePositions: () => records.push(['patch']),
      reseatHydrogensAroundPatched: () => records.push(['reseat']),
      forceLinkDistance: link => link.distance,
      forceAnchorRadius: () => 9,
      forceHydrogenRepulsion: () => 4,
      forceFitTransform: () => ({ k: 1 }),
      isHydrogenNode: node => node.name === 'H',
      enLabelColor: value => value,
      renderReactionPreviewArrowForce: nodes => ({ nodes }),
      generate2dCoords: mol => ({ mol }),
      handleForceBondClick: () => records.push(['bondClick']),
      handleForceBondDblClick: () => records.push(['bondDbl']),
      handleForceBondMouseOver: () => records.push(['bondOver']),
      handleForceBondMouseMove: () => records.push(['bondMove']),
      handleForceBondMouseOut: () => records.push(['bondOut']),
      handleForceAtomMouseDownDrawBond: () => records.push(['atomDown']),
      handleForceAtomClick: () => records.push(['atomClick']),
      handleForceAtomContextMenu: () => records.push(['atomContext']),
      handleForceAtomDblClick: () => records.push(['atomDbl']),
      handleForceAtomMouseOver: () => records.push(['atomOver']),
      handleForceAtomMouseMove: () => records.push(['atomMove']),
      handleForceAtomMouseOut: () => records.push(['atomOut']),
      createForceAtomDrag: sim => ({ sim, type: 'atom' }),
      createForceBondDrag: (sim, mol) => ({ sim, mol, type: 'bond' }),
      hasHighlights: () => true,
      hasSelection: () => false,
      applyForceHighlights: () => records.push(['applyHighlights']),
      applyForceSelection: () => records.push(['applySelection'])
    });

    assert.equal(deps.constants.forceLayoutFitPad, 16);
    assert.equal(deps.helpers.forceLinkDistance({ distance: 7 }), 7);
    assert.equal(deps.helpers.forceAnchorRadius(), 9);
    assert.deepEqual(deps.drag.createForceAtomDrag('sim'), { sim: 'sim', type: 'atom' });
    assert.equal(deps.callbacks.hasHighlights(), true);
    deps.events.handleForceAtomContextMenu();
    deps.callbacks.applyForceSelection();
    assert.deepEqual(records, [['atomContext'], ['applySelection']]);
  });

  it('builds 2d scene, selection overlay, and force selection deps', () => {
    const records = [];
    const scene2D = create2DSceneRendererDeps({
      d3: {},
      svg: {},
      zoom: {},
      g: {},
      plotEl: {},
      scale: 60,
      getFontSize: () => 12,
      valenceWarningFill: '#f80',
      getMol: () => ({ id: 'm' }),
      getHCounts: () => ({ H: 1 }),
      getStereoMap: () => new Map(),
      setScene: value => records.push(['scene', value]),
      setCenter: (cx, cy) => records.push(['center', cx, cy]),
      setActiveValenceWarningMap: map => records.push(['warnings', map]),
      getPreserveSelectionOnNextRender: () => false,
      setPreserveSelectionOnNextRender: value => records.push(['preserve', value]),
      resetCache: () => records.push(['reset']),
      syncSelectionToMolecule: mol => records.push(['sync', mol]),
      clearSelection: () => records.push(['clear']),
      getDrawBondMode: () => true,
      valenceWarningMapFor: mol => ({ mol }),
      toSVGPt: atom => atom,
      secondaryDir: () => [1, 0],
      getSelectedDragAtomIds: () => [1, 2],
      drawBond: () => records.push(['drawBond']),
      redrawHighlights: () => records.push(['redrawHighlights']),
      redrawSelection: () => records.push(['redrawSelection']),
      generate2dCoords: mol => ({ mol }),
      alignReaction2dProductOrientation: mol => mol,
      spreadReaction2dProductComponents: mol => mol,
      centerReaction2dPairCoords: mol => mol,
      drawReactionPreviewArrow2d: () => records.push(['arrow']),
      viewportFitPadding: pad => pad,
      hasReactionPreview: () => false,
      enLabelColor: value => value,
      handle2dBondClick: () => records.push(['bondClick']),
      handle2dBondDblClick: () => records.push(['bondDbl']),
      handle2dBondMouseOver: () => records.push(['bondOver']),
      handle2dBondMouseMove: () => records.push(['bondMove']),
      handle2dBondMouseOut: () => records.push(['bondOut']),
      handle2dAtomMouseDownDrawBond: () => records.push(['atomDown']),
      handle2dAtomClick: () => records.push(['atomClick']),
      handle2dAtomContextMenu: () => records.push(['atomContext']),
      handle2dAtomDblClick: () => records.push(['atomDbl']),
      handle2dAtomMouseOver: () => records.push(['atomOver']),
      handle2dAtomMouseMove: () => records.push(['atomMove']),
      handle2dAtomMouseOut: () => records.push(['atomOut']),
      create2dBondDrag: () => ({ type: 'bond' }),
      create2dAtomDrag: () => ({ type: 'atom' }),
      promoteBondOrder: bondId => records.push(['promote', bondId]),
      getOrientation: () => ({ rotationDeg: 0 }),
      updateFormula: mol => records.push(['formula', mol]),
      updateDescriptors: mol => records.push(['descriptors', mol]),
      updatePanels: mol => records.push(['panels', mol])
    });
    const overlay = createSelectionOverlayManagerDeps({
      requestAnimationFrame: callback => callback(),
      getMode: () => '2d',
      getSelectMode: () => true,
      getDrawBondMode: () => false,
      getEraseMode: () => false,
      getChargeTool: () => 'positive',
      getSelectionModifierActive: () => false,
      getSelectedAtomIds: () => new Set([1]),
      getSelectedBondIds: () => new Set([2]),
      getHoveredAtomIds: () => new Set(),
      getHoveredBondIds: () => new Set(),
      getForceMol: () => ({ id: 'force' }),
      getMol2D: () => ({ id: '2d' }),
      getHCounts: () => ({ H: 2 }),
      getStereoMap: () => new Map(),
      toSVGPt: atom => atom,
      getGraphSelection: () => ({ id: 'g' }),
      applyForceSelection: () => records.push(['forceSelection']),
      getFontSize: () => 14
    });
    const forceSelection = createForceSelectionRendererDeps({
      getGraphSelection: () => ({ id: 'g' }),
      getRenderableSelectionIds: () => ({ atomIds: [1], bondIds: [2] }),
      getNodes: () => [{ id: 1 }],
      getLinks: () => [{ id: 2 }],
      setSelectionLines: value => records.push(['selectionLines', value]),
      setSelectionCircles: value => records.push(['selectionCircles', value]),
      getSelectionColor: () => '#abc',
      getSelectionOutline: () => '#def',
      getBondSelectionRadius: () => 6,
      getAtomSelectionRadius: () => 13,
      getOutlineWidth: () => 2,
      atomRadius: atom => atom.r ?? 4
    });

    assert.equal(scene2D.constants.scale, 60);
    assert.equal(scene2D.overlay.getDrawBondMode(), true);
    assert.deepEqual(scene2D.drag.create2dAtomDrag(), { type: 'atom' });
    scene2D.events.handle2dAtomContextMenu();
    assert.equal(overlay.state.getMode(), '2d');
    assert.equal(overlay.state.getChargeTool(), 'positive');
    assert.deepEqual(forceSelection.selection.getRenderableSelectionIds(), { atomIds: [1], bondIds: [2] });
    forceSelection.cache.setSelectionLines('L');
    forceSelection.cache.setSelectionCircles('C');
    assert.deepEqual(records.slice(-3), [['atomContext'], ['selectionLines', 'L'], ['selectionCircles', 'C']]);
  });
});
