import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppStateBridge } from '../../../src/app/core/app-state-bridge.js';

describe('createAppStateBridge', () => {
  it('routes document state getters and setters through the provided bridge', () => {
    let currentMol = 'force-mol';
    let mol2d = '2d-mol';
    let mode = 'force';
    const bridge = createAppStateBridge({
      documentState: {
        getCurrentMol: () => currentMol,
        setCurrentMol: value => {
          currentMol = value;
        },
        getMol2d: () => mol2d,
        setMol2d: value => {
          mol2d = value;
        },
        getCurrentSmiles: () => 'CCO',
        getCurrentInchi: () => 'InChI=1S/...',
        getActiveMolecule: () => (mode === 'force' ? currentMol : mol2d),
        setActiveMolecule: value => {
          if (mode === 'force') {
            currentMol = value;
          } else {
            mol2d = value;
          }
        }
      },
      viewState: {},
      overlayState: {}
    });

    assert.equal(bridge.documentState.getActiveMolecule(), 'force-mol');
    bridge.documentState.setActiveMolecule('edited-force');
    assert.equal(currentMol, 'edited-force');

    mode = '2d';
    bridge.documentState.setActiveMolecule('edited-2d');
    assert.equal(mol2d, 'edited-2d');
  });

  it('preserves view and overlay state callbacks', () => {
    const records = [];
    const bridge = createAppStateBridge({
      documentState: {},
      viewState: {
        getMode: () => '2d',
        setMode: value => {
          records.push(['setMode', value]);
        },
        getRotationDeg: () => 15,
        setRotationDeg: value => {
          records.push(['setRotationDeg', value]);
        },
        getFlipH: () => false,
        setFlipH: value => {
          records.push(['setFlipH', value]);
        },
        getFlipV: () => true,
        setFlipV: value => {
          records.push(['setFlipV', value]);
        },
        setCx2d: value => {
          records.push(['setCx2d', value]);
        },
        setCy2d: value => {
          records.push(['setCy2d', value]);
        },
        captureZoomTransform: () => ({ x: 1, y: 2, k: 3 }),
        restore2dEditViewport: (snapshot, options) => {
          records.push(['restore2dEditViewport', snapshot, options]);
        },
        sync2dDerivedState: mol => `sync:${mol}`,
        syncStereoMap2d: mol => {
          records.push(['syncStereoMap2d', mol]);
        },
        clearPrimitiveHover: () => {
          records.push(['clearPrimitiveHover']);
        },
        suppressDrawBondHover: () => {
          records.push(['suppressDrawBondHover']);
        },
        setPrimitiveHoverSuppressed: value => {
          records.push(['setPrimitiveHoverSuppressed', value]);
        },
        setDrawBondHoverSuppressed: value => {
          records.push(['setDrawBondHoverSuppressed', value]);
        },
        restorePersistentHighlight: () => {
          records.push(['restorePersistentHighlight']);
        },
        fitCurrent2dView: () => {
          records.push(['fitCurrent2dView']);
        },
        enableForceKeepInView: () => {
          records.push(['enableForceKeepInView']);
        },
        getZoomTransform: () => ({ x: 4, y: 5, k: 6 }),
        setZoomTransform: transform => {
          records.push(['setZoomTransform', transform]);
        },
        makeZoomIdentity: (x, y, k) => ({ x, y, k }),
        setPreserveSelectionOnNextRender: value => {
          records.push(['setPreserveSelectionOnNextRender', value]);
        },
        scale: 60
      },
      overlayState: {
        getSelectedAtomIds: () => new Set(['a1']),
        getSelectedBondIds: () => new Set(['b1']),
        getHoveredAtomIds: () => new Set(['a2']),
        getHoveredBondIds: () => new Set(['b2']),
        getSelectionModifierActive: () => false,
        setSelectionModifierActive: value => {
          records.push(['setSelectionModifierActive', value]);
        },
        getSelectMode: () => true,
        setSelectMode: value => {
          records.push(['setSelectMode', value]);
        },
        getDrawBondMode: () => false,
        setDrawBondMode: value => {
          records.push(['setDrawBondMode', value]);
        },
        getEraseMode: () => false,
        setEraseMode: value => {
          records.push(['setEraseMode', value]);
        },
        getErasePainting: () => false,
        getDrawBondElement: () => 'N',
        setDrawBondElement: value => {
          records.push(['setDrawBondElement', value]);
        },
        setErasePainting: value => {
          records.push(['setErasePainting', value]);
        }
      }
    });

    assert.equal(bridge.viewState.getMode(), '2d');
    assert.deepEqual(bridge.viewState.captureZoomTransform(), { x: 1, y: 2, k: 3 });
    assert.equal(bridge.overlayState.getDrawBondElement(), 'N');
    bridge.viewState.restore2dEditViewport('zoom', { zoomToFit: true });
    bridge.overlayState.setDrawBondElement('O');

    assert.deepEqual(records, [
      ['restore2dEditViewport', 'zoom', { zoomToFit: true }],
      ['setDrawBondElement', 'O']
    ]);
  });
});
