/** @module app/render/selection-overlay */

import { labelHalfW, getAtomLabel } from '../../layout/mol2d-helpers.js';

const SELECTION_BOUNDS_PAD = 6;
const SELECTION_BOUNDS_STROKE = 'rgb(80, 140, 255)';
const SELECTION_BOUNDS_DASH = '5,3';
const SELECTION_BOUNDS_STROKE_WIDTH = 1.5;
const SELECTION_BOUNDS_OPACITY = 0.4;
const SELECTION_ROTATE_HANDLE_OFFSET = 28;
const SELECTION_ROTATE_HANDLE_HIT_RADIUS = 16;
const SELECTION_PIVOT_HIT_RADIUS = 16;
const SELECTION_PIVOT_ARM = 8;
const SELECTION_PIVOT_STROKE = '#666666';
const SELECTION_PIVOT_OPACITY = 0.58;

function emptyBounds() {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
}

function expandBounds(bounds, minX, minY, maxX, maxY) {
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return bounds;
  }
  bounds.minX = Math.min(bounds.minX, minX);
  bounds.minY = Math.min(bounds.minY, minY);
  bounds.maxX = Math.max(bounds.maxX, maxX);
  bounds.maxY = Math.max(bounds.maxY, maxY);
  return bounds;
}

function finalizeBounds(bounds, pad = SELECTION_BOUNDS_PAD) {
  if (!Number.isFinite(bounds?.minX) || !Number.isFinite(bounds?.minY) || !Number.isFinite(bounds?.maxX) || !Number.isFinite(bounds?.maxY)) {
    return null;
  }
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    width: Math.max(0, bounds.maxX - bounds.minX + pad * 2),
    height: Math.max(0, bounds.maxY - bounds.minY + pad * 2)
  };
}

function finitePivotPoint(pivot = null) {
  const x = Number(pivot?.x);
  const y = Number(pivot?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function boundsIncludingPivot(bounds, pivot = null) {
  if (!bounds) {
    return null;
  }
  const point = finitePivotPoint(pivot);
  if (!point) {
    return bounds;
  }
  const pad = SELECTION_PIVOT_ARM + 2;
  const minX = Math.min(bounds.x, point.x - pad);
  const minY = Math.min(bounds.y, point.y - pad);
  const maxX = Math.max(bounds.x + bounds.width, point.x + pad);
  const maxY = Math.max(bounds.y + bounds.height, point.y + pad);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function selectionBoundsGeometry(bounds) {
  if (!bounds) {
    return null;
  }
  const cx = bounds.x + bounds.width / 2;
  const topY = bounds.y - SELECTION_ROTATE_HANDLE_OFFSET;
  return {
    cx,
    cy: bounds.y + bounds.height / 2,
    rotateHandle: { x: cx, y: topY }
  };
}

function normalizedSelectionPivot(bounds, pivot = null) {
  const geometry = selectionBoundsGeometry(bounds);
  if (!geometry) {
    return null;
  }
  const point = finitePivotPoint(pivot);
  if (!point) {
    return { x: geometry.cx, y: geometry.cy };
  }
  return point;
}

function appendSelectionRotateHandle(handleLayer) {
  const handle = handleLayer
    .append('g')
    .attr('class', 'selection-rotate-handle')
    .attr('data-selection-rotate-handle', 'rotate')
    .attr('role', 'button')
    .attr('aria-label', 'Rotate selection')
    .style('cursor', 'grab')
    .style('pointer-events', 'none');
  handle
    .append('circle')
    .attr('class', 'selection-rotate-handle-hit')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', SELECTION_ROTATE_HANDLE_HIT_RADIUS)
    .attr('fill', '#ffffff')
    .attr('opacity', 0.001)
    .style('pointer-events', 'all');
  handle
    .append('path')
    .attr('class', 'selection-rotate-handle-icon')
    .attr('d', 'M 20 11 A 8 8 0 0 0 4.5 8.5 M 4 4 V 8.5 H 8.5 M 4 13 A 8 8 0 0 0 19.5 15.5 M 20 20 V 15.5 H 15.5')
    .attr('transform', 'translate(-12 -12) scale(0.9)')
    .attr('fill', 'none')
    .attr('stroke', SELECTION_BOUNDS_STROKE)
    .attr('stroke-width', 2.4)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round')
    .attr('opacity', 0.72);
  return handle;
}

function appendSelectionPivotHandle(handleLayer) {
  const handle = handleLayer
    .append('g')
    .attr('class', 'selection-pivot-handle')
    .attr('data-selection-pivot-handle', 'pivot')
    .attr('role', 'button')
    .attr('aria-label', 'Move rotation pivot')
    .style('cursor', 'move')
    .style('pointer-events', 'none');
  handle
    .append('circle')
    .attr('class', 'selection-pivot-handle-hit')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', SELECTION_PIVOT_HIT_RADIUS)
    .attr('fill', '#ffffff')
    .attr('opacity', 0.001)
    .style('pointer-events', 'none');
  handle
    .append('line')
    .attr('class', 'selection-pivot-cross selection-pivot-cross-h')
    .attr('x1', -SELECTION_PIVOT_ARM)
    .attr('y1', 0)
    .attr('x2', SELECTION_PIVOT_ARM)
    .attr('y2', 0)
    .attr('stroke', SELECTION_PIVOT_STROKE)
    .attr('stroke-width', 1.8)
    .attr('stroke-linecap', 'round')
    .attr('opacity', SELECTION_PIVOT_OPACITY);
  handle
    .append('line')
    .attr('class', 'selection-pivot-cross selection-pivot-cross-v')
    .attr('x1', 0)
    .attr('y1', -SELECTION_PIVOT_ARM)
    .attr('x2', 0)
    .attr('y2', SELECTION_PIVOT_ARM)
    .attr('stroke', SELECTION_PIVOT_STROKE)
    .attr('stroke-width', 1.8)
    .attr('stroke-linecap', 'round')
    .attr('opacity', SELECTION_PIVOT_OPACITY);
  return handle;
}

/**
 * Repositions a persistent selection-bounds control group around the latest bounds.
 * @param {object} controls - D3 selection for the bounds controls group.
 * @param {{x: number, y: number, width: number, height: number}|null} bounds - Current selection bounds.
 * @param {{x: number, y: number}|null} [pivot] - Optional persisted pivot point.
 * @returns {object} The provided controls selection.
 */
export function updateSelectionBoundsControls(controls, bounds, pivot = null) {
  const persistedPivot = pivot ?? controls.datum?.()?.getPivot?.() ?? null;
  const displayBounds = boundsIncludingPivot(bounds, persistedPivot);
  const geometry = selectionBoundsGeometry(displayBounds);
  controls.style('display', displayBounds && geometry ? null : 'none');
  if (!displayBounds || !geometry) {
    return controls;
  }
  const pivotPoint = normalizedSelectionPivot(displayBounds, persistedPivot);
  controls.select('rect.selection-bounds-drag-hit').attr('x', displayBounds.x).attr('y', displayBounds.y).attr('width', displayBounds.width).attr('height', displayBounds.height);
  controls.select('rect.selection-bounds-rect').attr('x', displayBounds.x).attr('y', displayBounds.y).attr('width', displayBounds.width).attr('height', displayBounds.height);
  controls.select('g.selection-rotate-handle').attr('transform', `translate(${geometry.rotateHandle.x},${geometry.rotateHandle.y})`);
  controls.select('g.selection-pivot-handle').attr('transform', `translate(${pivotPoint.x},${pivotPoint.y})`);
  return controls;
}

function drawSelectionBoundsControls(selectionLayer, bounds, pivot = null) {
  if (!bounds) {
    return null;
  }
  const controls = selectionLayer.append('g').attr('class', 'selection-bounds-controls').style('pointer-events', 'none');
  controls
    .append('rect')
    .attr('class', 'selection-bounds-drag-hit')
    .attr('fill', 'none')
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 14)
    .attr('opacity', 0.001)
    .attr('pointer-events', 'stroke')
    .style('cursor', 'move');
  controls
    .append('rect')
    .attr('class', 'selection-bounds-rect')
    .attr('fill', 'none')
    .attr('stroke', SELECTION_BOUNDS_STROKE)
    .attr('stroke-width', SELECTION_BOUNDS_STROKE_WIDTH)
    .attr('stroke-dasharray', SELECTION_BOUNDS_DASH)
    .attr('opacity', SELECTION_BOUNDS_OPACITY)
    .attr('pointer-events', 'none');
  const handleLayer = controls.append('g').attr('class', 'selection-rotate-handles');
  appendSelectionRotateHandle(handleLayer);
  appendSelectionPivotHandle(handleLayer);
  return updateSelectionBoundsControls(controls, bounds, pivot);
}

/**
 * Creates the selection overlay manager, coordinating hover and selection highlight rendering across both 2D and force layout modes.
 * @param {object} ctx - Context providing `state`, `molecule`, `view`, `view2D`, `constants`, `renderers`, `selection`, and `scheduler`.
 * @returns {object} Object with `clearPrimitiveHover`, `setPrimitiveHover`, `getRenderableSelectionIds`, `redraw2dSelection`, `refreshSelectionOverlay`, and `showPrimitiveHover` functions.
 */
export function createSelectionOverlayManager(ctx) {
  let overlayRafId = null;

  function isRenderableForceAtom(atom) {
    return atom && (atom.visible !== false || atom.name === 'H');
  }

  function clearPrimitiveHover() {
    ctx.state.getHoveredAtomIds().clear();
    ctx.state.getHoveredBondIds().clear();
    ctx.state.getPlacementRedirectedHoverAtomIds?.().clear();
    ctx.state.getPlacementRedirectedHoverBondIds?.().clear();
  }

  function setPrimitiveHover(atomIds = [], bondIds = []) {
    clearPrimitiveHover();

    if (ctx.state.getMode() === '2d') {
      const mol = ctx.molecule.getMol2D();
      if (!mol) {
        return;
      }
      for (const atomId of atomIds) {
        const atom = mol.atoms.get(atomId);
        if (!atom || atom.x == null || atom.visible === false) {
          continue;
        }
        ctx.state.getHoveredAtomIds().add(atomId);
      }
      for (const bondId of bondIds) {
        const bond = mol.bonds.get(bondId);
        if (!bond) {
          continue;
        }
        const [atom1, atom2] = bond.getAtomObjects(mol);
        if (!atom1 || !atom2 || atom1.x == null || atom2.x == null) {
          continue;
        }
        const isHiddenBond = atom1.visible === false || atom2.visible === false;
        if (isHiddenBond && !ctx.view2D.getStereoMap()?.has(bond.id)) {
          continue;
        }
        ctx.state.getHoveredBondIds().add(bondId);
      }
      refreshSelectionOverlay();
      return;
    }

    if (ctx.state.getMode() === 'force') {
      const mol = ctx.molecule.getForceMol();
      if (!mol) {
        return;
      }
      for (const atomId of atomIds) {
        const atom = mol.atoms.get(atomId);
        if (isRenderableForceAtom(atom)) {
          ctx.state.getHoveredAtomIds().add(atomId);
        }
      }
      for (const bondId of bondIds) {
        if (mol.bonds.has(bondId)) {
          ctx.state.getHoveredBondIds().add(bondId);
        }
      }
      refreshSelectionOverlay();
    }
  }

  function getRenderableSelectionIds() {
    const mode = ctx.state.getMode();
    const mol = mode === 'force' ? ctx.molecule.getForceMol() : ctx.molecule.getMol2D();
    const liveHoveredAtomIds = mol
      ? new Set(
          [...ctx.state.getHoveredAtomIds()].filter(id => {
            const atom = mol.atoms.get(id);
            return mode === 'force' ? isRenderableForceAtom(atom) : atom && atom.visible !== false;
          })
        )
      : new Set();
    const liveHoveredBondIds = mol ? new Set([...ctx.state.getHoveredBondIds()].filter(id => mol.bonds.has(id))) : new Set();
    const chargeTool = ctx.state.getChargeTool?.() ?? null;

    if (chargeTool) {
      return {
        atomIds: liveHoveredAtomIds,
        bondIds: liveHoveredBondIds
      };
    }

    if (ctx.state.getSelectedAtomIds().size === 0 && ctx.state.getSelectedBondIds().size === 0) {
      return {
        atomIds: ctx.state.getSelectMode() || ctx.state.getDrawBondMode() || ctx.state.getRingTemplateMode?.() || ctx.state.getEraseMode() ? liveHoveredAtomIds : new Set(),
        bondIds: ctx.state.getSelectMode() || ctx.state.getDrawBondMode() || ctx.state.getRingTemplateMode?.() || ctx.state.getEraseMode() ? liveHoveredBondIds : new Set()
      };
    }

    if (!ctx.state.getSelectionModifierActive()) {
      return {
        atomIds: ctx.state.getSelectedAtomIds(),
        bondIds: ctx.state.getSelectedBondIds()
      };
    }

    return {
      atomIds: new Set([...ctx.state.getSelectedAtomIds(), ...liveHoveredAtomIds]),
      bondIds: new Set([...ctx.state.getSelectedBondIds(), ...liveHoveredBondIds])
    };
  }

  function redraw2dSelection() {
    const g = ctx.view.getGraphSelection();
    g.select('g.atom-selection').remove();
    g.selectAll('g.selection-bounds-control-layer').remove();

    const { atomIds: activeAtomIds, bondIds: activeBondIds } = getRenderableSelectionIds();
    const mol = ctx.molecule.getMol2D();
    if ((activeAtomIds.size === 0 && activeBondIds.size === 0) || !mol) {
      return;
    }

    const hCounts = ctx.view2D.getHCounts();
    const toSVGPt = ctx.view2D.toSVGPt;
    const atoms = [...mol.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
    const fontSize = ctx.constants.getFontSize();

    const selectionColor = 'rgb(150, 200, 255)';
    const selectionOutline = 'rgb(40,  100, 210)';
    const outlineWidth = 2;
    const bondSelectionPad = 5;
    const atomSelectionPad = 12;

    const selectionLayer = g.insert('g', 'g.bonds').attr('class', 'atom-selection').style('pointer-events', 'none');
    const highlightLayer = selectionLayer.append('g').attr('class', 'selection-highlight-layer').attr('opacity', 0.45);

    const matchedBonds = [];
    for (const bond of mol.bonds.values()) {
      if (!activeBondIds.has(bond.id)) {
        continue;
      }
      const [atom1, atom2] = bond.getAtomObjects(mol);
      if (!atom1 || !atom2 || atom1.x == null || atom2.x == null) {
        continue;
      }
      const isHiddenBond = atom1.visible === false || atom2.visible === false;
      if (isHiddenBond && !ctx.view2D.getStereoMap()?.has(bond.id)) {
        continue;
      }
      const point1 = toSVGPt(atom1);
      const point2 = toSVGPt(atom2);
      const r1 = Math.max(labelHalfW(getAtomLabel(atom1, hCounts, toSVGPt, mol) || atom1.name, fontSize), 10) + bondSelectionPad;
      const r2 = Math.max(labelHalfW(getAtomLabel(atom2, hCounts, toSVGPt, mol) || atom2.name, fontSize), 10) + bondSelectionPad;
      matchedBonds.push({ point1, point2, width: Math.min(r1, r2) * 2 });
    }

    const matchedAtoms = [];
    for (const atom of atoms) {
      if (!activeAtomIds.has(atom.id)) {
        continue;
      }
      const { x, y } = toSVGPt(atom);
      const radius = Math.max(labelHalfW(getAtomLabel(atom, hCounts, toSVGPt, mol) || atom.name, fontSize), 10) + atomSelectionPad;
      matchedAtoms.push({ x, y, radius });
    }

    const selectedBounds = emptyBounds();
    for (const { point1, point2, width } of matchedBonds) {
      const pad = width / 2;
      expandBounds(selectedBounds, Math.min(point1.x, point2.x) - pad, Math.min(point1.y, point2.y) - pad, Math.max(point1.x, point2.x) + pad, Math.max(point1.y, point2.y) + pad);
    }
    for (const { x, y, radius } of matchedAtoms) {
      expandBounds(selectedBounds, x - radius, y - radius, x + radius, y + radius);
    }
    if ((ctx.state.getSelectedAtomIds().size > 0 || ctx.state.getSelectedBondIds().size > 0) && !ctx.state.getSelectionDragActive?.() && !ctx.state.getSelectionRotationActive?.()) {
      const controlsLayer = g.append('g').attr('class', 'selection-bounds-control-layer').style('pointer-events', 'none');
      drawSelectionBoundsControls(controlsLayer, finalizeBounds(selectedBounds), ctx.state.getSelectionPivot?.() ?? null);
    }

    const addLines = (stroke, extra) => {
      for (const { point1, point2, width } of matchedBonds) {
        highlightLayer
          .append('line')
          .attr('x1', point1.x)
          .attr('y1', point1.y)
          .attr('x2', point2.x)
          .attr('y2', point2.y)
          .attr('stroke', stroke)
          .attr('stroke-width', width + extra * 2)
          .attr('stroke-linecap', 'round');
      }
    };

    const addCircles = (fill, extra) => {
      for (const { x, y, radius } of matchedAtoms) {
        highlightLayer
          .append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', radius + extra)
          .attr('fill', fill)
          .attr('stroke', 'none');
      }
    };

    addLines(selectionOutline, outlineWidth);
    addCircles(selectionOutline, outlineWidth);
    addLines(selectionColor, 0);
    addCircles(selectionColor, 0);
  }

  function refreshSelectionOverlay() {
    if (overlayRafId !== null) {
      return;
    }
    overlayRafId = ctx.scheduler.requestAnimationFrame(() => {
      overlayRafId = null;
      if (ctx.state.getMode() === 'force') {
        ctx.renderers.applyForceSelection();
      } else if (ctx.molecule.getMol2D()) {
        redraw2dSelection();
      }
    });
  }

  function showPrimitiveHover(atomIds = [], bondIds = []) {
    if (!ctx.state.getSelectMode() && !ctx.state.getDrawBondMode() && !ctx.state.getRingTemplateMode?.() && !ctx.state.getEraseMode() && !ctx.state.getChargeTool?.()) {
      return;
    }
    setPrimitiveHover(atomIds, bondIds);
  }

  return {
    clearPrimitiveHover,
    setPrimitiveHover,
    getRenderableSelectionIds,
    redraw2dSelection,
    refreshSelectionOverlay,
    showPrimitiveHover
  };
}

/**
 * Creates the force-layout selection renderer that draws selection overlays on the force graph.
 * @param {object} ctx - Context providing `view`, `cache`, `constants`, `helpers`, `force`, and `selection`.
 * @returns {object} Object with an `applyForceSelection` function.
 */
export function createForceSelectionRenderer(ctx) {
  function applyForceSelection() {
    const graphSelection = ctx.view.getGraphSelection();
    graphSelection.selectAll('g.force-selection-layer').remove();
    graphSelection.selectAll('g.selection-bounds-control-layer').remove();
    ctx.cache.setSelectionLines(null);
    ctx.cache.setSelectionCircles(null);
    ctx.cache.setSelectionBounds?.(null);

    const { atomIds: activeAtomIds, bondIds: activeBondIds } = ctx.selection.getRenderableSelectionIds();
    if (activeAtomIds.size === 0 && activeBondIds.size === 0) {
      return;
    }

    const selectionColor = ctx.constants.getSelectionColor();
    const selectionOutline = ctx.constants.getSelectionOutline();
    const bondSelectionRadius = ctx.constants.getBondSelectionRadius();
    const atomSelectionRadius = ctx.constants.getAtomSelectionRadius();
    const outlineWidth = ctx.constants.getOutlineWidth();
    const selectionLayer = graphSelection.insert('g', ':first-child').attr('class', 'force-selection-layer').style('pointer-events', 'none');
    const highlightLayer = selectionLayer.append('g').attr('class', 'selection-highlight-layer').attr('opacity', 0.45);

    const selectedNodes = ctx.force.getNodes().filter(node => activeAtomIds.has(node.id));
    const selectedLinks = ctx.force.getLinks().filter(link => activeBondIds.has(link.id));

    const forceSelectionBounds = () => {
      const bounds = emptyBounds();
      for (const link of selectedLinks) {
        const sourceRadius = ctx.helpers.atomRadius(link.source.protons);
        const targetRadius = ctx.helpers.atomRadius(link.target.protons);
        const pad = Math.min(sourceRadius, targetRadius) + bondSelectionRadius + outlineWidth;
        expandBounds(
          bounds,
          Math.min(link.source.x, link.target.x) - pad,
          Math.min(link.source.y, link.target.y) - pad,
          Math.max(link.source.x, link.target.x) + pad,
          Math.max(link.source.y, link.target.y) + pad
        );
      }
      for (const node of selectedNodes) {
        const radius = ctx.helpers.atomRadius(node.protons) + atomSelectionRadius + outlineWidth;
        expandBounds(bounds, node.x - radius, node.y - radius, node.x + radius, node.y + radius);
      }
      return finalizeBounds(bounds);
    };

    let selectionBoundsRect = null;
    if ((ctx.selection.hasExplicitSelection?.() ?? true) && !ctx.selection.getSelectionRotationActive?.()) {
      const bounds = forceSelectionBounds();
      const controlsLayer = graphSelection.append('g').attr('class', 'selection-bounds-control-layer').style('pointer-events', 'none');
      selectionBoundsRect = drawSelectionBoundsControls(controlsLayer, bounds, ctx.selection.getSelectionPivot?.() ?? null);
      selectionBoundsRect?.datum({ bounds: forceSelectionBounds, getPivot: () => ctx.selection.getSelectionPivot?.() ?? null });
    }

    const addLines = (stroke, extra) => {
      highlightLayer
        .selectAll(null)
        .data(selectedLinks)
        .enter()
        .append('line')
        .datum(d => d)
        .attr('stroke', stroke)
        .attr('stroke-width', d => Math.min(ctx.helpers.atomRadius(d.source.protons), ctx.helpers.atomRadius(d.target.protons)) * 2 + bondSelectionRadius * 2 + extra * 2)
        .attr('stroke-linecap', 'round')
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    };

    const addCircles = (fill, extra) => {
      highlightLayer
        .selectAll(null)
        .data(selectedNodes)
        .enter()
        .append('circle')
        .datum(d => d)
        .attr('r', d => ctx.helpers.atomRadius(d.protons) + atomSelectionRadius + extra)
        .attr('fill', fill)
        .attr('stroke', 'none')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
    };

    addLines(selectionOutline, outlineWidth);
    addCircles(selectionOutline, outlineWidth);
    addLines(selectionColor, 0);
    addCircles(selectionColor, 0);
    ctx.cache.setSelectionLines(highlightLayer.selectAll('line'));
    ctx.cache.setSelectionCircles(highlightLayer.selectAll('circle'));
    ctx.cache.setSelectionBounds?.(selectionBoundsRect);
  }

  return {
    applyForceSelection
  };
}
