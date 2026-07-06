/** @module app/interactions/drag-gestures */

/**
 * Creates drag gesture action factories for force-layout atoms, force-layout bonds, 2D bonds, and 2D atoms.
 * @param {object} context - Dependency context providing d3, state, history, selection, force, molecule, view accessors.
 * @returns {object} Object with `createForceAtomDrag`, `createForceBondDrag`, `create2dBondDrag`,
 * and `create2dAtomDrag`.
 */
export function createDragGestureActions(context) {
  function isPaintModeActive() {
    return context.state.getPaintMode?.() ?? false;
  }

  function isRingTemplateModeActive() {
    return context.state.getRingTemplateMode?.() ?? false;
  }

  function takePendingSnapshot(state) {
    if (!state || state._snapped) {
      return;
    }
    context.history.takeSnapshot({
      clearReactionPreview: false,
      snapshot: state.previousSnapshot ?? context.history.captureSnapshot()
    });
    state._snapped = true;
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function translateSelectionPivot(dx, dy) {
    const pivot = context.state.getSelectionPivot?.() ?? null;
    const pivotX = finiteNumber(pivot?.x);
    const pivotY = finiteNumber(pivot?.y);
    if (pivotX == null || pivotY == null) {
      return;
    }
    context.state.setSelectionPivot?.({ x: pivotX + dx, y: pivotY + dy });
  }

  function settleForceDragSimulation(simulation, event) {
    if (event.active) {
      return;
    }
    simulation.alphaTarget(0);
    simulation.alpha?.(0);
    simulation.stop?.();
  }

  function createForceAtomDrag(simulation) {
    return context.d3
      .createDrag()
      .filter(_event => !context.state.getDrawBondMode() && !isRingTemplateModeActive() && !context.state.getEraseMode() && !isPaintModeActive() && !context.state.getChargeTool?.())
      .on('start', (event, datum) => {
        if (context.state.getDrawBondMode() || isRingTemplateModeActive() || isPaintModeActive()) {
          return;
        }
        if (!event.active) {
          simulation.alphaTarget(0.3).restart();
        }
        context.force.setAutoFitEnabled(false);
        context.force.disableKeepInView();
        const selectedDragAtomIds = context.selection.getSelectedDragAtomIds(context.molecule.getCurrent(), [datum.id], []);
        const movesSelectionPivot = selectedDragAtomIds != null;
        const dragNodes = selectedDragAtomIds ? simulation.nodes().filter(node => selectedDragAtomIds.has(node.id)) : [datum];
        const positions = new Map();
        for (const node of dragNodes) {
          positions.set(node.id, { x: node.x, y: node.y });
          node.fx = node.x;
          node.fy = node.y;
        }
        datum._dragState = {
          startX: event.x,
          startY: event.y,
          lastDx: 0,
          lastDy: 0,
          movesSelectionPivot,
          nodeIds: new Set(dragNodes.map(node => node.id)),
          positions,
          _snapped: false,
          previousSnapshot: context.history.captureSnapshot()
        };
      })
      .on('drag', (event, datum) => {
        const state = datum._dragState;
        if (!state) {
          return;
        }
        takePendingSnapshot(state);
        const dx = event.x - state.startX;
        const dy = event.y - state.startY;
        if (state.movesSelectionPivot) {
          translateSelectionPivot(dx - state.lastDx, dy - state.lastDy);
        }
        state.lastDx = dx;
        state.lastDy = dy;
        for (const node of simulation.nodes()) {
          if (!state.nodeIds.has(node.id)) {
            continue;
          }
          const pos = state.positions.get(node.id);
          if (!pos) {
            continue;
          }
          node.fx = pos.x + dx;
          node.fy = pos.y + dy;
          node.x = node.fx;
          node.y = node.fy;
        }
      })
      .on('end', (event, datum) => {
        settleForceDragSimulation(simulation, event);
        const state = datum._dragState;
        if (state) {
          for (const node of simulation.nodes()) {
            if (!state.nodeIds.has(node.id)) {
              continue;
            }
            if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
              node.anchorX = node.x;
              node.anchorY = node.y;
            }
            node.fx = null;
            node.fy = null;
          }
          if (state.movesSelectionPivot && state._snapped) {
            context.view.fitTransformedSelectionIfNeeded?.(state.nodeIds);
          }
        }
        datum._dragState = null;
      });
  }

  function createForceBondDrag(simulation, molecule) {
    return context.d3
      .createDrag()
      .filter(_event => !context.state.getDrawBondMode() && !isRingTemplateModeActive() && !isPaintModeActive() && !context.state.getChargeTool?.())
      .on('start', function startForceBondDrag(event, datum) {
        if (context.state.getDrawBondMode() || isRingTemplateModeActive() || isPaintModeActive()) {
          return;
        }
        const selectedDragAtomIds = context.selection.getSelectedDragAtomIds(molecule, [], [datum.id]);
        const movesSelectionPivot = selectedDragAtomIds != null;
        const bondAtomIds = selectedDragAtomIds ?? new Set((molecule?.bonds?.get?.(datum.id)?.atoms ?? []).filter(atomId => molecule?.atoms?.has?.(atomId)));
        if (bondAtomIds.size === 0) {
          this._dragState = null;
          return;
        }
        context.force.setAutoFitEnabled(false);
        context.force.disableKeepInView();
        event.sourceEvent.stopPropagation();
        context.view.hideTooltip();
        context.view.setElementCursor(this, 'grabbing');
        if (!event.active) {
          simulation.alphaTarget(0.3).restart();
        }
        const positions = new Map();
        const nodeIds = new Set();
        for (const node of simulation.nodes()) {
          if (!bondAtomIds.has(node.id)) {
            continue;
          }
          positions.set(node.id, { x: node.x, y: node.y });
          nodeIds.add(node.id);
          node.fx = node.x;
          node.fy = node.y;
        }
        this._dragState = {
          startX: event.x,
          startY: event.y,
          lastDx: 0,
          lastDy: 0,
          movesSelectionPivot,
          nodeIds,
          positions,
          _snapped: false,
          previousSnapshot: context.history.captureSnapshot()
        };
      })
      .on('drag', function dragForceBond(event) {
        const state = this._dragState;
        if (!state) {
          return;
        }
        takePendingSnapshot(state);
        const dx = event.x - state.startX;
        const dy = event.y - state.startY;
        if (state.movesSelectionPivot) {
          translateSelectionPivot(dx - state.lastDx, dy - state.lastDy);
        }
        state.lastDx = dx;
        state.lastDy = dy;
        for (const node of simulation.nodes()) {
          if (!state.nodeIds.has(node.id)) {
            continue;
          }
          const pos = state.positions.get(node.id);
          if (!pos) {
            continue;
          }
          node.fx = pos.x + dx;
          node.fy = pos.y + dy;
          node.x = node.fx;
          node.y = node.fy;
        }
      })
      .on('end', function endForceBondDrag(event) {
        const state = this._dragState;
        if (state) {
          for (const node of simulation.nodes()) {
            if (!state.nodeIds.has(node.id)) {
              continue;
            }
            if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
              node.anchorX = node.x;
              node.anchorY = node.y;
            }
            node.fx = null;
            node.fy = null;
          }
          if (state.movesSelectionPivot && state._snapped) {
            context.view.fitTransformedSelectionIfNeeded?.(state.nodeIds);
          }
        }
        settleForceDragSimulation(simulation, event);
        this._dragState = null;
        context.view.setElementCursor(this, 'grab');
      });
  }

  function apply2dDragDelta(molecule, state, event, options) {
    const [svgX, svgY] = options.pointer(event.sourceEvent);
    state.lastPX ??= state.pX;
    state.lastPY ??= state.pY;
    if (state.movesSelectionPivot) {
      translateSelectionPivot(svgX - state.lastPX, svgY - state.lastPY);
    }
    state.lastPX = svgX;
    state.lastPY = svgY;
    const dx = (svgX - state.pX) / options.scale;
    const dy = -(svgY - state.pY) / options.scale;
    for (const [atomId, pos] of state.atomPositions) {
      const movedAtom = molecule.atoms.get(atomId);
      if (!movedAtom) {
        continue;
      }
      movedAtom.x = pos.x + dx;
      movedAtom.y = pos.y + dy;
    }
  }

  function create2dBondDrag(molecule, bondId, options) {
    return context.d3
      .createDrag()
      .filter(_event => !context.state.getDrawBondMode() && !isRingTemplateModeActive() && !context.state.getEraseMode() && !isPaintModeActive() && !context.state.getChargeTool?.())
      .on('start', function start2dBondDrag(event) {
        if (context.state.getDrawBondMode() || isRingTemplateModeActive() || isPaintModeActive()) {
          return;
        }
        event.sourceEvent.stopPropagation();
        context.view.clearPrimitiveHover();
        context.view.refresh2dSelection();
        context.view.hideTooltip();
        context.view.setElementCursor(this, 'grabbing');
        this._dragState = options.captureDragState(event, molecule, [], [bondId]);
        if (this._dragState) {
          this._dragState._snapped = false;
          this._dragState.previousSnapshot = context.history.captureSnapshot();
        }
      })
      .on('drag', function drag2dBond(event) {
        const state = this._dragState;
        if (!state) {
          return;
        }
        takePendingSnapshot(state);
        apply2dDragDelta(molecule, state, event, options);
        options.redrawDragTargets(molecule, state.movedAtomIds);
      })
      .on('end', function end2dBondDrag() {
        const state = this._dragState;
        this._dragState = null;
        context.view.setElementCursor(this, 'grab');
        if (state?._snapped) {
          if (state.movesSelectionPivot) {
            context.view.fitTransformedSelectionIfNeeded?.(state.movedAtomIds);
          }
          options.draw();
        }
      });
  }

  function create2dAtomDrag(molecule, atomId, options = {}) {
    return context.d3
      .createDrag()
      .filter(_event => !context.state.getDrawBondMode() && !isRingTemplateModeActive() && !context.state.getEraseMode() && !isPaintModeActive() && !context.state.getChargeTool?.())
      .on('start', function start2dAtomDrag(event) {
        if (context.state.getDrawBondMode() || isRingTemplateModeActive() || isPaintModeActive()) {
          return;
        }
        event.sourceEvent.stopPropagation();
        context.view.clearPrimitiveHover();
        context.view.refresh2dSelection();
        context.view.hideTooltip();
        options.setDraggingCursor?.();
        this._dragState = options.captureDragState(event, molecule, [atomId], []);
        if (this._dragState) {
          this._dragState._snapped = false;
          this._dragState.previousSnapshot = context.history.captureSnapshot();
        }
      })
      .on('drag', function drag2dAtom(event) {
        const state = this._dragState;
        if (!state) {
          return;
        }
        takePendingSnapshot(state);
        apply2dDragDelta(molecule, state, event, options);
        options.redrawDragTargets(molecule, state.movedAtomIds);
      })
      .on('end', function end2dAtomDrag() {
        const state = this._dragState;
        this._dragState = null;
        options.resetCursor?.();
        if (state?._snapped) {
          if (state.movesSelectionPivot) {
            context.view.fitTransformedSelectionIfNeeded?.(state.movedAtomIds);
          }
          options.draw();
        }
      });
  }

  return {
    createForceAtomDrag,
    createForceBondDrag,
    create2dBondDrag,
    create2dAtomDrag
  };
}
