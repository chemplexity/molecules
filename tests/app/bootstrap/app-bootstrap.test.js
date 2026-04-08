import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { finalizeAppBootstrap } from '../../../src/app/bootstrap/app-bootstrap.js';

describe('finalizeAppBootstrap', () => {
  it('wires charge-tool state into plot interactions and the app shell', () => {
    const records = [];
    let capturedPlotInteractionDeps = null;
    let capturedAppShellDeps = null;

    const ctx = {
      factories: {
        createAppDelegates() {
          return {
            changeAtomElements() {},
            draw2d() {},
            captureZoomTransformSnapshot() {
              return null;
            },
            restoreZoomTransformSnapshot() {},
            commitDrawBond() {},
            render2d() {}
          };
        },
        createReaction2dDeps: value => value,
        createResonancePanelDeps: value => value,
        createBondEnPanelDeps: value => value,
        createAtomNumberingPanelDeps: value => value,
        createOptionsModalDeps: value => value,
        createPhyschemPanelDeps: value => value,
        createAppShellDeps(value) {
          capturedAppShellDeps = value;
          return value;
        },
        initUndo() {},
        initHighlights() {},
        initExport() {},
        initReaction2d() {},
        initResonancePanel() {},
        initBondEnPanel() {},
        initAtomNumberingPanel() {},
        initNavigationInteractions() {},
        initKeyboardInteractions() {},
        initGestureInteractions() {},
        initOptionsModal() {
          return { open() {} };
        },
        initPlotInteractions(deps) {
          capturedPlotInteractionDeps = deps;
        },
        initTabPanels() {},
        initPhyschemPanel() {
          return {
            captureSnapshot() {
              return null;
            },
            restoreSnapshot() {
              return false;
            }
          };
        },
        initAppShell(deps) {
          return {
            deps,
            bootstrap() {}
          };
        }
      },
      setDelegates() {},
      controller: {
        captureAppSnapshot() {
          return null;
        },
        restoreAppSnapshot() {},
        performViewAction() {}
      },
      state: {
        getMode: () => '2d',
        getCurrentMol: () => null,
        setCurrentMol() {},
        getMol2d: () => null,
        setMol2d() {},
        clear2dDerivedState() {},
        getStereoMap2d: () => new Map(),
        appState: {},
        hasDrawBondState: () => false,
        setDrawBondHoverSuppressed() {},
        getSelectMode: () => false,
        getDrawBondMode: () => false,
        getEraseMode: () => false,
        getChargeTool: () => 'positive',
        isRenderableMode: () => true,
        getActiveMolecule: () => null,
        getTooltipMode: () => '2d',
        getSelectionValenceTooltipAtomId: () => null,
        setSelectionValenceTooltipAtomId() {},
        setCapturePhyschemHighlightSnapshot() {},
        setRestorePhyschemHighlightSnapshot() {},
        hasLoadedInput: () => false,
        getCurrentSmiles: () => 'CCO',
        getCurrentInchi: () => null,
        setFontSize() {},
        getInitialSmiles: () => 'CCO'
      },
      actions: {
        primitiveSelection: {},
        structuralEditActions: {},
        drawBondPreviewActions: {
          cancel() {},
          start() {},
          markDragged() {},
          update() {}
        },
        drawBondCommitActions: {},
        editingActions: {
          deleteSelection() {},
          deleteTargets() {},
          eraseItem() {}
        },
        selectionActions: {
          togglePanMode() {},
          toggleSelectMode() {},
          toggleDrawBondMode() {},
          handleDrawBondButtonClick() {},
          openDrawBondDrawer() {},
          closeDrawBondDrawer() {},
          toggleEraseMode() {},
          setChargeTool(tool) {
            records.push(['setChargeTool', tool]);
          },
          setDrawElement() {},
          setDrawBondType() {}
        }
      },
      render: {
        render2DHelpers: {
          toSVGPt2d(atom) {
            return atom;
          }
        },
        highlight2DRenderer: {},
        scene2DRenderer: {
          fitCurrent2dView() {}
        },
        zoomTransformHelpers: {},
        renderRuntime: {
          renderMol() {},
          updateForce() {}
        },
        applyForceHighlights() {},
        refreshSelectionOverlay() {},
        applySelectionOverlay() {},
        updateForce() {}
      },
      stereo: {
        syncDisplayStereo() {}
      },
      overlays: {
        clearReactionPreviewState() {},
        restoreReactionPreviewSource() {},
        reapplyActiveReactionPreview() {
          return false;
        },
        hasReactionPreview() {
          return false;
        },
        isReactionPreviewEditableAtomId() {
          return true;
        },
        getReactionPreviewSourceMol() {
          return null;
        },
        getReactionPreviewMappedAtomPairs() {
          return [];
        },
        getReactionPreviewReactantAtomIds() {
          return [];
        }
      },
      history: {
        takeSnapshot() {},
        undoAction() {},
        redoAction() {}
      },
      dom: {
        g: {},
        svg: {},
        d3: {},
        simulation: {},
        plotEl: {},
        document: {},
        window: {},
        tooltip: {},
        getEraseCursorElement() {
          return {};
        },
        getOptionsOverlayElement() {
          return {};
        },
        getShowValenceWarningsElement() {
          return {};
        },
        getShowAtomTooltipsElement() {
          return {};
        },
        get2DAtomColoringElement() {
          return {};
        },
        get2DAtomFontSizeElement() {
          return {};
        },
        getAtomNumberingFontSizeElement() {
          return {};
        },
        get2DBondThicknessElement() {
          return {};
        },
        getForceAtomSizeElement() {
          return {};
        },
        getForceBondThicknessElement() {
          return {};
        },
        getOptionsResetButtonElement() {
          return {};
        },
        getOptionsCancelButtonElement() {
          return {};
        },
        getOptionsApplyButtonElement() {
          return {};
        },
        getPhyschemTableElement() {
          return {};
        },
        getSvgPlotElement() {
          return {};
        },
        getLabelToggleElement() {
          return {};
        }
      },
      view: {
        clearPrimitiveHover() {},
        showPrimitiveHover() {},
        getZoomTransform() {
          return {};
        },
        setZoomTransform() {},
        makeZoomIdentity() {
          return {};
        },
        hideTooltip() {},
        showTooltip() {},
        handleForceResize() {},
        resetOrientation() {}
      },
      analysis: {
        getActiveValenceWarningMap: () => new Map(),
        updatePanels() {}
      },
      highlights: {
        prepare2dExportHighlightState() {},
        setHighlight() {},
        restorePersistentHighlight() {},
        setPersistentHighlightFallback() {}
      },
      options: {
        renderOptionLimits: {},
        getRenderOptions: () => ({ showAtomTooltips: true }),
        getDefaultRenderOptions: () => ({}),
        updateRenderOptions() {}
      },
      input: {
        inputControls: {
          bind() {},
          renderExamples() {}
        },
        inputFlowManager: {
          parseAndRenderSmiles() {},
          parseAndRenderInchi() {},
          parseInput() {},
          setInputFormat() {}
        }
      },
      parsers: {
        parseSMILES() {
          return {};
        },
        parseINCHI() {
          return {};
        }
      },
      export: {
        copyForcePng() {},
        copyForceSvg() {},
        copySvg2d() {},
        savePng2d() {}
      },
      helpers: {
        getDatum() {
          return null;
        },
        pointer() {
          return [0, 0];
        },
        schedule() {},
        getNodeDatum() {
          return null;
        }
      },
      molecule: {
        getAtomById() {
          return null;
        }
      },
      formatters: {
        atomTooltipHtml() {
          return '';
        }
      },
      io: {
        toSMILES() {
          return '';
        },
        toInChI() {
          return '';
        }
      }
    };

    finalizeAppBootstrap(ctx);

    assert.equal(capturedPlotInteractionDeps.state.getChargeTool(), 'positive');
    capturedAppShellDeps.selection.setChargeTool('negative');
    assert.deepEqual(records, [['setChargeTool', 'negative']]);
  });
});
