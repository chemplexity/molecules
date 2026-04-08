/** @module app/interactions/drag-gestures */

/**
 * Creates drag gesture action factories for force-layout atoms, force-layout bonds, 2D bonds, and 2D atoms.
 * @param {object} context - Dependency context providing d3, state, history, selection, force, molecule, view accessors.
 * @returns {object} Object with `createForceAtomDrag`, `createForceBondDrag`, `create2dBondDrag`, and `create2dAtomDrag`.
 */
export function createDragGestureActions(context) {
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

  function createForceAtomDrag(simulation) {
    return context.d3
      .createDrag()
      .filter(_event => !context.state.getDrawBondMode() && !context.state.getEraseMode() && !context.state.getChargeTool?.())
      .on('start', (event, datum) => {
        if (context.state.getDrawBondMode()) {
          return;
        }
        if (!event.active) {
          simulation.alphaTarget(0.3).restart();
        }
        context.force.setAutoFitEnabled(false);
        context.force.disableKeepInView();
        const selectedDragAtomIds = context.selection.getSelectedDragAtomIds(context.molecule.getCurrent(), [datum.id], []);
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
        if (!event.active) {
          simulation.alphaTarget(0);
        }
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
        }
        datum._dragState = null;
      });
  }

  function createForceBondDrag(simulation, molecule) {
    return context.d3
      .createDrag()
      .filter(_event => !context.state.getDrawBondMode() && !context.state.getChargeTool?.())
      .on('start', function startForceBondDrag(event, datum) {
        if (context.state.getDrawBondMode()) {
          return;
        }
        const selectedDragAtomIds = context.selection.getSelectedDragAtomIds(molecule, [], [datum.id]);
        if (!selectedDragAtomIds) {
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
          if (!selectedDragAtomIds.has(node.id)) {
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
        }
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        this._dragState = null;
        context.view.setElementCursor(this, 'grab');
      });
  }

  function apply2dDragDelta(molecule, state, event, options) {
    const [svgX, svgY] = options.pointer(event.sourceEvent);
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
      .filter(_event => !context.state.getDrawBondMode() && !context.state.getEraseMode() && !context.state.getChargeTool?.())
      .on('start', function start2dBondDrag(event) {
        if (context.state.getDrawBondMode()) {
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
          options.draw();
        }
      });
  }

  function create2dAtomDrag(molecule, atomId, options = {}) {
    return context.d3
      .createDrag()
      .filter(_event => !context.state.getDrawBondMode() && !context.state.getEraseMode() && !context.state.getChargeTool?.())
      .on('start', function start2dAtomDrag(event) {
        if (context.state.getDrawBondMode()) {
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
