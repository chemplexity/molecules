/** @module app/interactions/navigation */

import { FORCE_LAYOUT_BOND_LENGTH } from '../render/force-helpers.js';

const DEFAULT_LAYOUT_BOND_LENGTH = 1.5;

/**
 * Seeds molecule atom coordinates from the live force-simulation node positions.
 * @param {object} molecule - Molecule clone that will receive temporary 2D coordinates.
 * @param {Array<object>} nodes - Force-simulation nodes with finite `x`/`y` positions.
 * @param {number} [bondLength] - Target 2D bond length used to normalize force pixels.
 * @returns {Map<string, {x: number, y: number}>} Centered 2D coordinates keyed by atom id.
 */
function seedMoleculeFromForcePositions(molecule, nodes, bondLength = DEFAULT_LAYOUT_BOND_LENGTH) {
  const placedCoords = new Map();
  if (!molecule?.atoms || !Array.isArray(nodes) || nodes.length === 0) {
    return placedCoords;
  }

  const finiteNodes = nodes.filter(node => Number.isFinite(node?.x) && Number.isFinite(node?.y) && molecule.atoms.has(node.id));
  if (finiteNodes.length === 0) {
    return placedCoords;
  }

  let cx = 0;
  let cy = 0;
  for (const node of finiteNodes) {
    cx += node.x;
    cy += node.y;
  }
  cx /= finiteNodes.length;
  cy /= finiteNodes.length;

  const scale = bondLength / FORCE_LAYOUT_BOND_LENGTH;
  for (const node of finiteNodes) {
    const atom = molecule.atoms.get(node.id);
    const x = (node.x - cx) * scale;
    const y = (cy - node.y) * scale;
    atom.x = x;
    atom.y = y;
    placedCoords.set(node.id, { x, y });
  }

  return placedCoords;
}

/**
 * Builds a force anchor-layout map from the currently placed molecule coordinates.
 * @param {object} molecule - Molecule whose placed coordinates should anchor force layout.
 * @returns {Map<string, {x: number, y: number}>} Non-hydrogen anchor coordinates keyed by atom id.
 */
function buildForceAnchorLayoutFromPlacedCoords(molecule) {
  const anchorLayout = new Map();
  if (!molecule?.atoms) {
    return anchorLayout;
  }

  for (const [id, atom] of molecule.atoms) {
    if (atom.name === 'H' || atom.visible === false) {
      continue;
    }
    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y)) {
      continue;
    }
    anchorLayout.set(id, { x: atom.x, y: atom.y });
  }

  return anchorLayout;
}

/**
 * Creates navigation action handlers for mode toggling, layout cleaning, rotation, and flipping in both 2D and force-layout modes.
 * @param {object} context - Dependency context providing state, history, view, renderers, dom, simulation, force, helpers, overlays, parsers, and actions.
 * @returns {object} Object with `cleanLayout2d`, `cleanLayoutForce`, `toggleMode`, `startRotate`, `stopRotate`, and `flip`.
 */
export function createNavigationActions(context) {
  let rotateInterval = null;
  let clean2dBtnTimer = null;
  let cleanForceBtnTimer = null;

  function stopRotate() {
    if (rotateInterval !== null) {
      clearInterval(rotateInterval);
      rotateInterval = null;
    }
  }

  function cleanLayout2d() {
    if (context.state.viewState.getMode() !== '2d' || !context.state.documentState.getMol2d()) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    const mol = context.state.documentState.getMol2d();
    const relayoutMol = mol.clone();
    const hasRefinementRelayout = typeof context.helpers.refineExistingCoords === 'function';
    const refinedCoords = hasRefinementRelayout
      ? context.helpers.refineExistingCoords(relayoutMol, {
        suppressH: true,
        bondLength: 1.5,
        maxPasses: 12
      })
      : null;
    const preserveGeometry = refinedCoords instanceof Map ? refinedCoords.size > 0 : hasRefinementRelayout;
    context.view.setPreserveSelectionOnNextRender(true);
    context.renderers.renderMol(relayoutMol, {
      preserveHistory: true,
      preserveAnalysis: true,
      preserveGeometry
    });
    const btn = context.dom.clean2dButton;
    if (btn) {
      btn.textContent = '✓';
      clearTimeout(clean2dBtnTimer);
      clean2dBtnTimer = setTimeout(() => {
        btn.textContent = '🧹';
      }, 1500);
    }
  }

  function cleanLayoutForce() {
    if (context.state.viewState.getMode() !== 'force' || !context.state.documentState.getCurrentMol()) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    const mol = context.state.documentState.getCurrentMol();
    const relayoutMol = mol.clone();
    seedMoleculeFromForcePositions(relayoutMol, context.simulation.nodes?.(), DEFAULT_LAYOUT_BOND_LENGTH);
    if (typeof context.helpers.refineExistingCoords === 'function') {
      context.helpers.refineExistingCoords(relayoutMol, {
        suppressH: true,
        bondLength: DEFAULT_LAYOUT_BOND_LENGTH,
        maxPasses: 12
      });
    }
    const forceAnchorLayout = buildForceAnchorLayoutFromPlacedCoords(relayoutMol);
    context.view.setPreserveSelectionOnNextRender(true);
    context.renderers.renderMol(relayoutMol, {
      preserveHistory: true,
      preserveAnalysis: true,
      preserveView: true,
      forceAnchorLayout: forceAnchorLayout.size > 0 ? forceAnchorLayout : null
    });
    const btn = context.dom.cleanForceButton;
    if (btn) {
      btn.textContent = '✓';
      clearTimeout(cleanForceBtnTimer);
      cleanForceBtnTimer = setTimeout(() => {
        btn.textContent = '🧹';
      }, 1500);
    }
  }

  function toggleMode() {
    context.view.clearPrimitiveHover();
    const previousMode = context.state.viewState.getMode();
    const currentMol = context.state.documentState.getCurrentMol();
    const currentSmiles = context.state.documentState.getCurrentSmiles();
    const currentInchi = context.state.documentState.getCurrentInchi();
    if (!currentMol && !currentSmiles && !currentInchi) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });

    const resonanceResetMol = previousMode === 'force' ? context.state.documentState.getCurrentMol() : context.state.documentState.getMol2d();
    const hadReactionPreview = context.overlays.hasReactionPreview();
    const nextMode = previousMode === 'force' ? '2d' : 'force';
    context.state.viewState.setMode(nextMode);
    context.dom.updateModeChrome(nextMode);

    if (!hadReactionPreview) {
      context.overlays.resetActiveResonanceView(resonanceResetMol);
    }
    context.simulation.stop();
    context.state.viewState.setRotationDeg(0);
    context.state.viewState.setFlipH(false);
    context.state.viewState.setFlipV(false);
    context.view.setPreserveSelectionOnNextRender(true);

    if (hadReactionPreview && context.overlays.reapplyActiveReactionPreview()) {
      context.view.setPreserveSelectionOnNextRender(false);
      return;
    }

    const mol = resonanceResetMol ? resonanceResetMol.clone() : currentInchi ? context.parsers.parseINCHI(currentInchi) : context.parsers.parseSMILES(currentSmiles);
    context.renderers.renderMol(mol, { preserveHistory: true });
  }

  function startRotate(delta) {
    stopRotate();
    const mode = context.state.viewState.getMode();
    if (mode === 'force') {
      const mol = context.state.documentState.getCurrentMol();
      if (!mol) {
        return;
      }
      context.history.takeSnapshot({ clearReactionPreview: false });
      const forceDelta = -delta;
      const step = () => {
        const nodes = context.simulation.nodes().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
        if (!nodes.length) {
          return;
        }
        let cx = 0;
        let cy = 0;
        for (const node of nodes) {
          cx += node.x;
          cy += node.y;
        }
        cx /= nodes.length;
        cy /= nodes.length;
        const rad = (forceDelta * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const patchPos = new Map();
        for (const node of nodes) {
          const dx = node.x - cx;
          const dy = node.y - cy;
          node.x = cx + dx * cosR - dy * sinR;
          node.y = cy + dx * sinR + dy * cosR;
          node.vx = 0;
          node.vy = 0;
          patchPos.set(node.id, { x: node.x, y: node.y });
        }
        context.force.patchForceNodePositions(patchPos, { setAnchors: true, alpha: 0 });
        const fitTransform = context.force.forceFitTransform(nodes, context.force.fitPad, {
          scaleMultiplier: context.force.initialZoomMultiplier
        });
        if (fitTransform) {
          const currentTransform = context.view.getZoomTransform();
          if (context.force.zoomTransformsDiffer(fitTransform, currentTransform)) {
            context.view.setZoomTransform(fitTransform);
          }
        }
      };
      step();
      rotateInterval = setInterval(step, 40);
      return;
    }

    const mol = context.state.documentState.getMol2d();
    if (mode !== '2d' || !mol) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    context.view.restorePersistentHighlight();
    const step = () => {
      const allAtoms = [...mol.atoms.values()].filter(atom => atom.x != null);
      if (!allAtoms.length) {
        return;
      }
      let mx = 0;
      let my = 0;
      for (const atom of allAtoms) {
        mx += atom.x;
        my += atom.y;
      }
      mx /= allAtoms.length;
      my /= allAtoms.length;
      const rad = (delta * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      for (const atom of allAtoms) {
        const dx = atom.x - mx;
        const dy = atom.y - my;
        atom.x = mx + dx * cosR - dy * sinR;
        atom.y = my + dx * sinR + dy * cosR;
      }
      context.state.viewState.setRotationDeg((context.state.viewState.getRotationDeg() + delta) % 360);

      const bbox = context.helpers.atomBBox(allAtoms);
      context.state.viewState.setCx2d(bbox.cx);
      context.state.viewState.setCy2d(bbox.cy);

      const W = context.dom.plotEl.clientWidth || 600;
      const H = context.dom.plotEl.clientHeight || 400;
      const PAD = context.overlays.hasReactionPreview() ? 12 : 18;
      const pads = context.overlays.viewportFitPadding(PAD);
      const horizontalPad = Math.max(PAD, (pads.left + pads.right) / 2);
      const verticalPad = Math.max(PAD, (pads.top + pads.bottom) / 2);
      const molSVGW = (bbox.maxX - bbox.minX) * context.view.scale || 1;
      const molSVGH = (bbox.maxY - bbox.minY) * context.view.scale || 1;
      const fitCap = context.overlays.hasReactionPreview() ? 1.28 : 1;
      const neededScale = Math.min(Math.max(1, W - horizontalPad * 2) / molSVGW, Math.max(1, H - verticalPad * 2) / molSVGH, fitCap);
      const currentScale = context.view.getZoomTransform().k;
      if (Math.abs(neededScale - currentScale) > 0.001) {
        context.view.setZoomTransform(context.view.makeZoomIdentity(W / 2 - (W / 2) * neededScale, H / 2 - (H / 2) * neededScale, neededScale));
      }
      context.renderers.draw2d();
    };
    step();
    rotateInterval = setInterval(step, 40);
  }

  function flip(axis) {
    const mode = context.state.viewState.getMode();
    if (mode === 'force') {
      const mol = context.state.documentState.getCurrentMol();
      if (!mol) {
        return;
      }
      context.history.takeSnapshot({ clearReactionPreview: false });
      const nodes = context.simulation.nodes().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
      if (!nodes.length) {
        return;
      }
      let cx = 0;
      let cy = 0;
      for (const node of nodes) {
        cx += node.x;
        cy += node.y;
      }
      cx /= nodes.length;
      cy /= nodes.length;
      const isFlipH = axis === 'h';
      const patchPos = new Map();
      for (const node of nodes) {
        if (isFlipH) {
          node.x = 2 * cx - node.x;
        } else {
          node.y = 2 * cy - node.y;
        }
        node.vx = 0;
        node.vy = 0;
        patchPos.set(node.id, { x: node.x, y: node.y });
      }
      context.force.patchForceNodePositions(patchPos, { setAnchors: true, alpha: 0 });
      const flipResult = context.helpers.flipDisplayStereo?.(mol);
      if (flipResult?.size && mol?.__reactionPreview) {
        // Flip every stereo-type entry in all reaction-preview Maps.
        // These Map objects are the same references as the module-level
        // _reactionPreview* variables in reaction-2d.js (passed by reference
        // via _alignReaction2dProductOrientation → preserveReaction2dStereoDisplay).
        // preserveReaction2dStereoDisplay rebuilds forcedStereoByCenter /
        // forcedStereoBondTypes from the preserved* maps every render, so ALL
        // maps must be flipped here to prevent the next render from undoing it.
        const flipType = t => (t === 'wedge' ? 'dash' : t === 'dash' ? 'wedge' : t);
        const preview = mol.__reactionPreview;
        for (const [k, v] of preview.forcedStereoBondTypes ?? new Map()) {
          preview.forcedStereoBondTypes.set(k, flipType(v));
        }
        for (const [k, v] of preview.preservedReactantStereoBondTypes ?? new Map()) {
          preview.preservedReactantStereoBondTypes.set(k, flipType(v));
        }
        for (const [k, v] of preview.preservedProductStereoBondTypes ?? new Map()) {
          preview.preservedProductStereoBondTypes.set(k, flipType(v));
        }
        for (const [k, v] of preview.forcedStereoByCenter ?? new Map()) {
          if (v?.type) {
            preview.forcedStereoByCenter.set(k, { ...v, type: flipType(v.type) });
          }
        }
        for (const [k, v] of preview.preservedReactantStereoByCenter ?? new Map()) {
          if (v?.type) {
            preview.preservedReactantStereoByCenter.set(k, { ...v, type: flipType(v.type) });
          }
        }
        for (const [k, v] of preview.preservedProductStereoByCenter ?? new Map()) {
          if (v?.type) {
            preview.preservedProductStereoByCenter.set(k, { ...v, type: flipType(v.type) });
          }
        }
      }
      context.renderers.updateForce(mol, { preservePositions: true, preserveView: true });
      if (context.overlays.hasReactionPreview()) {
        const renderedNodes = context.simulation.nodes().filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
        const fitTransform = context.force.forceFitTransform(renderedNodes, context.force.fitPad, {
          scaleMultiplier: context.force.initialZoomMultiplier
        });
        if (fitTransform) {
          const currentTransform = context.view.getZoomTransform();
          if (context.force.zoomTransformsDiffer(fitTransform, currentTransform)) {
            context.view.setZoomTransform(fitTransform);
          }
        }
      }
      context.view.restorePersistentHighlight();
      return;
    }

    const mol = context.state.documentState.getMol2d();
    if (mode !== '2d' || !mol) {
      return;
    }
    context.history.takeSnapshot({ clearReactionPreview: false });
    context.view.restorePersistentHighlight();
    if (axis === 'h') {
      context.state.viewState.setFlipH(!context.state.viewState.getFlipH());
    } else {
      context.state.viewState.setFlipV(!context.state.viewState.getFlipV());
    }

    const allAtoms = [...mol.atoms.values()].filter(atom => atom.x != null);
    let mx = 0;
    let my = 0;
    for (const atom of allAtoms) {
      mx += atom.x;
      my += atom.y;
    }
    mx /= allAtoms.length;
    my /= allAtoms.length;
    if (axis === 'h') {
      for (const atom of allAtoms) {
        atom.x = 2 * mx - atom.x;
      }
    } else {
      for (const atom of allAtoms) {
        atom.y = 2 * my - atom.y;
      }
    }

    const bbox = context.helpers.atomBBox(allAtoms);
    context.state.viewState.setCx2d(bbox.cx);
    context.state.viewState.setCy2d(bbox.cy);
    context.view.flipStereoMap2d?.(mol);
    context.renderers.draw2d();
  }

  return {
    cleanLayout2d,
    cleanLayoutForce,
    toggleMode,
    startRotate,
    stopRotate,
    flip
  };
}

/**
 * Attaches document-level mouse event listeners for rotate and flip button interactions.
 * @param {object} params - Navigation interaction parameters.
 * @param {Document} [params.doc] - Document to attach listeners to (defaults to globalThis.document).
 * @param {object} params.controller - App controller with `performViewAction` for dispatching navigation actions.
 */
export function initNavigationInteractions({ doc = document, controller }) {
  doc.addEventListener('mousedown', event => {
    const btn = event.target.closest('#rotate-ccw, #rotate-cw, #force-rotate-ccw, #force-rotate-cw');
    if (!btn) {
      return;
    }
    controller.performViewAction('start-rotate', {
      delta: btn.id === 'rotate-cw' || btn.id === 'force-rotate-cw' ? -5 : 5
    });
  });
  doc.addEventListener('mouseup', () => {
    controller.performViewAction('stop-rotate');
  });
  doc.addEventListener('mouseleave', () => {
    controller.performViewAction('stop-rotate');
  });
  doc.addEventListener('click', event => {
    const btn = event.target.closest('#flip-h, #flip-v, #force-flip-h, #force-flip-v');
    if (!btn) {
      return;
    }
    controller.performViewAction('flip', {
      axis: btn.id === 'flip-h' || btn.id === 'force-flip-h' ? 'h' : 'v'
    });
  });
}
