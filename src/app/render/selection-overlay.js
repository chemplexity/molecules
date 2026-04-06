/** @module app/render/selection-overlay */

import { labelHalfW, getAtomLabel } from '../../layout/mol2d-helpers.js';

export function createSelectionOverlayManager(ctx) {
  let overlayRafId = null;

  function clearPrimitiveHover() {
    ctx.state.getHoveredAtomIds().clear();
    ctx.state.getHoveredBondIds().clear();
  }

  function getRenderableSelectionIds() {
    const mol = ctx.state.getMode() === 'force' ? ctx.molecule.getForceMol() : ctx.molecule.getMol2D();
    const liveHoveredAtomIds = mol ? new Set([...ctx.state.getHoveredAtomIds()].filter(id => mol.atoms.has(id))) : new Set();
    const liveHoveredBondIds = mol ? new Set([...ctx.state.getHoveredBondIds()].filter(id => mol.bonds.has(id))) : new Set();

    if (ctx.state.getSelectedAtomIds().size === 0 && ctx.state.getSelectedBondIds().size === 0) {
      return {
        atomIds: ctx.state.getSelectMode() || ctx.state.getDrawBondMode() || ctx.state.getEraseMode() ? liveHoveredAtomIds : new Set(),
        bondIds: ctx.state.getSelectMode() || ctx.state.getDrawBondMode() || ctx.state.getEraseMode() ? liveHoveredBondIds : new Set()
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

    const selectionLayer = g.insert('g', 'g.bonds').attr('class', 'atom-selection').attr('opacity', 0.45).style('pointer-events', 'none');

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
      if (isHiddenBond && !(ctx.view2D.getStereoMap()?.has(bond.id))) {
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

    const addLines = (stroke, extra) => {
      for (const { point1, point2, width } of matchedBonds) {
        selectionLayer
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
        selectionLayer
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
    if (!ctx.state.getSelectMode() && !ctx.state.getEraseMode()) {
      return;
    }

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
        if (isHiddenBond && !(ctx.view2D.getStereoMap()?.has(bond.id))) {
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
        if (mol.atoms.has(atomId)) {
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

  return {
    clearPrimitiveHover,
    getRenderableSelectionIds,
    redraw2dSelection,
    refreshSelectionOverlay,
    showPrimitiveHover
  };
}
