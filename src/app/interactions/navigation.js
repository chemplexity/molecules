/** @module app/interactions/navigation */

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
    const hasStrictRelayout = typeof context.helpers.generateAndRefine2dCoords === 'function';
    if (hasStrictRelayout) {
      context.helpers.generateAndRefine2dCoords(relayoutMol, {
        suppressH: true,
        bondLength: 1.5,
        maxPasses: 12,
        freezeRings: true,
        freezeChiralCenters: false,
        allowBranchReflect: true
      });
    }
    context.view.setPreserveSelectionOnNextRender(true);
    context.renderers.renderMol(relayoutMol, {
      preserveHistory: true,
      preserveAnalysis: true,
      preserveGeometry: hasStrictRelayout
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
    context.renderers.updateForce(context.state.documentState.getCurrentMol());
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

    const mol =
      resonanceResetMol
        ? resonanceResetMol.clone()
        : currentInchi
          ? context.parsers.parseINCHI(currentInchi)
          : context.parsers.parseSMILES(currentSmiles);
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
      context.helpers.flipDisplayStereo?.(mol);
      context.renderers.updateForce(mol, { preservePositions: true, preserveView: true });
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
