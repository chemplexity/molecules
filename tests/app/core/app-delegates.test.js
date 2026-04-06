import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppDelegates } from '../../../src/app/core/app-delegates.js';

describe('createAppDelegates', () => {
  it('routes wrapper calls through the provided runtime collaborators', () => {
    const records = [];
    let currentMol = null;
    let mol2d = null;
    const stereoMap2d = new Map([['a', 'b']]);

    const delegates = createAppDelegates({
      state: {
        getMode: () => '2d',
        getCurrentMol: () => currentMol,
        setCurrentMol: value => {
          currentMol = value;
        },
        getMol2d: () => mol2d,
        setMol2d: value => {
          mol2d = value;
        },
        clear2dDerivedState: () => {
          records.push(['clear2dDerivedState']);
        },
        getStereoMap2d: () => stereoMap2d
      },
      primitiveSelection: {
        handle2dPrimitiveClick: (...args) => records.push(['handle2dPrimitiveClick', ...args]),
        handle2dComponentDblClick: (...args) => records.push(['handle2dComponentDblClick', ...args]),
        handleForcePrimitiveClick: (...args) => records.push(['handleForcePrimitiveClick', ...args]),
        handleForceComponentDblClick: (...args) => records.push(['handleForceComponentDblClick', ...args])
      },
      render2DHelpers: {
        drawBond: (...args) => ['drawBond', ...args]
      },
      highlight2DRenderer: {
        redraw2dHighlights: () => 'redraw2dHighlights'
      },
      structuralEditActions: {
        restore2dEditViewport: (...args) => ['restore2dEditViewport', ...args],
        prepareResonanceStructuralEdit: mol => ['prepareResonanceStructuralEdit', mol],
        promoteBondOrder: (...args) => ['promoteBondOrder', ...args],
        changeAtomElements: (...args) => ['changeAtomElements', ...args],
        replaceForceHydrogenWithDrawElement: (...args) => ['replaceForceHydrogenWithDrawElement', ...args]
      },
      drawBondPreviewActions: {
        start: (...args) => ['start', ...args],
        update: point => ['update', point],
        resetHover: () => 'resetHover',
        cancel: () => 'cancel'
      },
      drawBondCommitActions: {
        autoPlaceBond: (...args) => ['autoPlaceBond', ...args],
        commit: () => 'commit'
      },
      scene2DRenderer: {
        draw2d: () => 'draw2d',
        render2d: (...args) => ['render2d', ...args],
        fitCurrent2dView: () => 'fitCurrent2dView'
      },
      editingActions: {
        eraseItem: (...args) => ['eraseItem', ...args]
      },
      zoomTransformHelpers: {
        captureZoomTransformSnapshot: () => 'captureZoomTransformSnapshot',
        restoreZoomTransformSnapshot: snapshot => ['restoreZoomTransformSnapshot', snapshot]
      },
      stereo: {
        syncDisplayStereo: (...args) => ['syncDisplayStereo', ...args]
      },
      renderRuntime: {
        renderMol: (...args) => ['renderMol', ...args]
      },
      inputFlowManager: {
        clearMolecule: () => 'clearMolecule',
        parseAndRenderSmiles: smiles => ['parseAndRenderSmiles', smiles],
        parseAndRenderInchi: inchi => ['parseAndRenderInchi', inchi]
      }
    });

    delegates.handle2dPrimitiveClick('event', [1], [2]);
    delegates.handleForceComponentDblClick('event2', [3]);

    assert.deepEqual(delegates.drawBond('c', 'b', 'a1', 'a2', 'mol', 'toSVGPt'), ['drawBond', 'c', 'b', 'a1', 'a2', 'mol', 'toSVGPt', null]);
    assert.equal(delegates.redraw2dHighlights(), 'redraw2dHighlights');
    assert.deepEqual(delegates.restore2dEditViewport('snap', { zoomToFit: true }), ['restore2dEditViewport', 'snap', { zoomToFit: true }]);
    assert.deepEqual(delegates.prepareResonanceStructuralEdit('mol'), ['prepareResonanceStructuralEdit', 'mol']);
    assert.deepEqual(delegates.promoteBondOrder(7, { foo: 'bar' }), ['promoteBondOrder', 7, { foo: 'bar' }]);
    assert.deepEqual(delegates.changeAtomElements([1], 'N', { baz: 'qux' }), ['changeAtomElements', [1], 'N', { baz: 'qux' }]);
    assert.deepEqual(delegates.replaceForceHydrogenWithDrawElement(5, 'molX'), ['replaceForceHydrogenWithDrawElement', 5, 'molX']);
    assert.deepEqual(delegates.startDrawBond(1, 2, 3), ['start', 1, 2, 3]);
    assert.deepEqual(delegates.updateDrawBondPreview([4, 5]), ['update', [4, 5]]);
    assert.equal(delegates.resetDrawBondHover(), 'resetHover');
    assert.equal(delegates.cancelDrawBond(), 'cancel');
    assert.equal(delegates.ensureMol(), mol2d);
    assert.equal(mol2d?.constructor?.name, 'Molecule');
    assert.deepEqual(delegates.autoPlaceBond(1, 2, 3), ['autoPlaceBond', 1, 2, 3]);
    assert.equal(delegates.commitDrawBond(), 'commit');
    assert.equal(delegates.draw2d(), 'draw2d');
    assert.deepEqual(delegates.render2d('mol', { a: 1 }), ['render2d', 'mol', { a: 1 }]);
    assert.equal(delegates.fitCurrent2dView(), 'fitCurrent2dView');
    assert.deepEqual(delegates.eraseItem([1], [2]), ['eraseItem', [1], [2]]);
    assert.equal(delegates.captureZoomTransformSnapshot(), 'captureZoomTransformSnapshot');
    assert.deepEqual(delegates.restoreZoomTransformSnapshot('snap2'), ['restoreZoomTransformSnapshot', 'snap2']);
    assert.deepEqual(delegates.pickStereoWedgesPreserving2dChoice('molY'), ['syncDisplayStereo', 'molY', stereoMap2d]);
    assert.deepEqual(delegates.renderMol('molZ', { preserveView: true }), ['renderMol', 'molZ', { preserveView: true }]);
    assert.equal(delegates.clearMolecule(), 'clearMolecule');
    assert.deepEqual(delegates.parseAndRender('CCO'), ['parseAndRenderSmiles', 'CCO']);
    assert.deepEqual(delegates.parseAndRenderInchi('InChI=1S/CH4/h1H4'), ['parseAndRenderInchi', 'InChI=1S/CH4/h1H4']);

    assert.deepEqual(records, [
      ['handle2dPrimitiveClick', 'event', [1], [2]],
      ['handleForceComponentDblClick', 'event2', [3]],
      ['clear2dDerivedState']
    ]);
  });

  it('creates the active molecule in force mode when needed', () => {
    let currentMol = null;
    const delegates = createAppDelegates({
      state: {
        getMode: () => 'force',
        getCurrentMol: () => currentMol,
        setCurrentMol: value => {
          currentMol = value;
        },
        getMol2d: () => null,
        setMol2d() {},
        clear2dDerivedState() {},
        getStereoMap2d: () => new Map()
      },
      primitiveSelection: {},
      render2DHelpers: {},
      highlight2DRenderer: {},
      structuralEditActions: {},
      drawBondPreviewActions: {},
      drawBondCommitActions: {},
      scene2DRenderer: {},
      editingActions: {},
      zoomTransformHelpers: {},
      stereo: {
        syncDisplayStereo() {}
      },
      renderRuntime: {},
      inputFlowManager: {}
    });

    const mol = delegates.ensureMol();
    assert.equal(mol, currentMol);
    assert.equal(mol?.constructor?.name, 'Molecule');
  });
});
