/** @module app/render/2d-helpers */

import { renderBondOrder, addLine } from './helpers.js';
import { labelHalfW, labelHalfH, labelTextOffset, getAtomLabel } from '../../layout/mol2d-helpers.js';

/**
 * Creates 2D render helper functions for SVG point conversion, bond drawing, viewport fitting, and derived state synchronization.
 * @param {object} ctx - Dependency context providing plotEl, state, constants, geometry, stereo, d3, svg, and zoom.
 * @returns {object} Object with `toSVGPt2d`, `drawBond`, `zoomToFitIf2d`, and `sync2dDerivedState`.
 */
export function create2DRenderHelpers(ctx) {
  /**
   * Hides all hydrogens in the current 2D molecule without requiring a full
   * coordinate regeneration pass.
   * @param {object|null|undefined} mol - Molecule whose hydrogen visibility should be reset.
   * @returns {void}
   */
  function hideHydrogensFor2dSync(mol) {
    if (!mol) {
      return;
    }
    if (typeof mol.hideHydrogens === 'function') {
      mol.hideHydrogens();
      return;
    }
    for (const atom of mol.atoms?.values?.() ?? []) {
      if (atom?.name === 'H') {
        atom.visible = false;
      }
    }
  }

  /**
   * Reapplies renderer-facing stereo-hydrogen visibility after a local 2D edit.
   * This keeps draw-only updates in sync with the same hydrogen-display policy
   * used by the full `render2d()` path.
   * @param {object|null|undefined} mol - Molecule being synchronized.
   * @param {Map<string, number>} hCounts - Heavy-atom hydrogen counts used for labels.
   * @param {Map<string, string>|null|undefined} stereoMap - Current stereo display map.
   * @returns {void}
   */
  function syncStereoHydrogenVisibility(mol, hCounts, stereoMap) {
    hideHydrogensFor2dSync(mol);
    for (const [bondId] of stereoMap ?? new Map()) {
      const bond = mol?.bonds?.get?.(bondId) ?? null;
      if (!bond || typeof bond.getAtomObjects !== 'function') {
        continue;
      }
      const [atom1, atom2] = bond.getAtomObjects(mol);
      const hydrogen = atom1?.visible === false && atom1.name === 'H' ? atom1 : atom2?.visible === false && atom2.name === 'H' ? atom2 : null;
      if (hydrogen) {
        hydrogen.visible = true;
        continue;
      }
      const heavyAtom = atom1?.visible === false ? (atom2 ?? null) : atom2?.visible === false ? (atom1 ?? null) : null;
      if (!heavyAtom) {
        continue;
      }
      const remainingCount = (hCounts.get(heavyAtom.id) ?? 0) - 1;
      if (remainingCount <= 0) {
        hCounts.delete(heavyAtom.id);
      } else {
        hCounts.set(heavyAtom.id, remainingCount);
      }
    }
  }

  function toSVGPt2d(atom) {
    const width = ctx.plotEl.clientWidth || 600;
    const height = ctx.plotEl.clientHeight || 400;
    return {
      x: width / 2 + (atom.x - ctx.state.getCenterX()) * ctx.constants.scale,
      y: height / 2 - (atom.y - ctx.state.getCenterY()) * ctx.constants.scale
    };
  }

  /**
   * Computes how far a bond segment should be trimmed to clear the rendered atom label box.
   * @param {object} atom - Atom whose label clearance is being measured.
   * @param {{x: number, y: number}} otherSVGPt - Opposite endpoint of the segment in SVG coordinates.
   * @param {function(object): {x: number, y: number}} toSVGPt - Atom-to-SVG projection function.
   * @returns {number} Clearance distance in SVG pixels.
   */
  function labelClearance(atom, otherSVGPt, toSVGPt) {
    const label = getAtomLabel(atom, ctx.state.getHCounts(), toSVGPt, ctx.state.getMol());
    if (!label) {
      return 0;
    }

    const { x, y } = toSVGPt(atom);
    const dx = otherSVGPt.x - x;
    const dy = otherSVGPt.y - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const prefixHydrogenMatch = label.match(/^(H\d*)([A-Z][a-z]?)$/);
    const suffixHydrogenMatch = label.match(/^([A-Z][a-z]?)(H\d*)$/);
    const elementLabel = prefixHydrogenMatch?.[2] ?? suffixHydrogenMatch?.[1] ?? null;
    const heavyNeighbors = atom.getNeighbors(ctx.state.getMol()).filter(neighbor => neighbor?.name !== 'H');
    const isCarbonylAdjacentHydroxyl =
      atom.name === 'O' &&
      !!elementLabel &&
      heavyNeighbors.length === 1 &&
      heavyNeighbors[0].name === 'C' &&
      heavyNeighbors[0].getNeighbors(ctx.state.getMol()).some(neighbor => {
        if (!neighbor || neighbor.id === atom.id || neighbor.name !== 'O') {
          return false;
        }
        const bond = ctx.state.getMol().getBond(heavyNeighbors[0].id, neighbor.id);
        return (bond?.properties.order ?? 1) >= 2;
      });
    const useElementAnchorBox = isCarbonylAdjacentHydroxyl;
    const cx = useElementAnchorBox ? 0 : labelTextOffset(label, ctx.constants.getFontSize());
    const hw = useElementAnchorBox ? (ctx.constants.getFontSize() * 0.38 * elementLabel.length + 4) / 2 + 7 : labelHalfW(label, ctx.constants.getFontSize()) + 1;
    const hh = labelHalfH(label, ctx.constants.getFontSize()) + 1;
    const dirX = dx / len;
    const dirY = dy / len;

    const txCandidates = [];
    if (Math.abs(dirX) > 1e-9) {
      txCandidates.push((cx + hw) / dirX);
      txCandidates.push((cx - hw) / dirX);
    }
    const tyCandidates = [];
    if (Math.abs(dirY) > 1e-9) {
      tyCandidates.push(hh / dirY);
      tyCandidates.push(-hh / dirY);
    }

    let best = Infinity;
    for (const t of [...txCandidates, ...tyCandidates]) {
      if (!(t > 0)) {
        continue;
      }
      const px = dirX * t;
      const py = dirY * t;
      if (px < cx - hw - 1e-6 || px > cx + hw + 1e-6) {
        continue;
      }
      if (py < -hh - 1e-6 || py > hh + 1e-6) {
        continue;
      }
      best = Math.min(best, t);
    }
    return Number.isFinite(best) ? best : Math.max(hw, hh);
  }

  /**
   * Shortens a bond segment using label clearance measured along that exact segment.
   * @param {object} atom1 - Bond start atom.
   * @param {object} atom2 - Bond end atom.
   * @param {{x: number, y: number}} start - Segment start point in SVG coordinates.
   * @param {{x: number, y: number}} end - Segment end point in SVG coordinates.
   * @param {function(object): {x: number, y: number}} toSVGPt - Atom-to-SVG projection function.
   * @param {number} [minimumClearance] - Minimum trim to apply at each endpoint.
   * @returns {{x1: number, y1: number, x2: number, y2: number}} Shortened segment.
   */
  function shortenBondLineWithLabelClearance(atom1, atom2, start, end, toSVGPt, minimumClearance = 0) {
    const c1 = Math.max(labelClearance(atom1, end, toSVGPt), minimumClearance);
    const c2 = Math.max(labelClearance(atom2, start, toSVGPt), minimumClearance);
    return ctx.geometry.shortenLine(start.x, start.y, end.x, end.y, c1, c2);
  }

  function drawBond(container, bond, atom1, atom2, mol, toSVGPt, stereoType = null) {
    if (stereoType === 'wedge' || stereoType === 'dash') {
      const startOriginal = toSVGPt(atom1);
      const endOriginal = toSVGPt(atom2);
      const { nx, ny } = ctx.geometry.perpUnit(endOriginal.x - startOriginal.x, endOriginal.y - startOriginal.y);
      const c1 = labelClearance(atom1, endOriginal, toSVGPt);
      const c2 = labelClearance(atom2, startOriginal, toSVGPt);
      const bondLength = Math.sqrt((endOriginal.x - startOriginal.x) ** 2 + (endOriginal.y - startOriginal.y) ** 2) || 1;
      const start = {
        x: startOriginal.x + ((endOriginal.x - startOriginal.x) / bondLength) * c1,
        y: startOriginal.y + ((endOriginal.y - startOriginal.y) / bondLength) * c1
      };
      const end = {
        x: endOriginal.x - ((endOriginal.x - startOriginal.x) / bondLength) * c2,
        y: endOriginal.y - ((endOriginal.y - startOriginal.y) / bondLength) * c2
      };
      const drawableLength = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2) || 1;
      if (stereoType === 'wedge') {
        const sourceTrim = Math.min(ctx.constants.wedgeHalfWidth * 0.5, Math.max(0.8, drawableLength * 0.35));
        const tip = {
          x: start.x + ((end.x - start.x) / drawableLength) * sourceTrim,
          y: start.y + ((end.y - start.y) / drawableLength) * sourceTrim
        };
        container
          .append('polygon')
          .attr('class', 'bond bond-wedge')
          .attr(
            'points',
            `${tip.x},${tip.y} ` +
              `${end.x - nx * ctx.constants.wedgeHalfWidth},${end.y - ny * ctx.constants.wedgeHalfWidth} ` +
              `${end.x + nx * ctx.constants.wedgeHalfWidth},${end.y + ny * ctx.constants.wedgeHalfWidth}`
          )
          .style('fill', '#111')
          .style('stroke', 'none');
      } else {
        for (let i = 1; i <= ctx.constants.wedgeDashes; i++) {
          const t = i / (ctx.constants.wedgeDashes + 1);
          const px = start.x + t * (end.x - start.x);
          const py = start.y + t * (end.y - start.y);
          const hw = ctx.constants.wedgeHalfWidth * t;
          container
            .append('line')
            .attr('class', 'bond bond-hash')
            .attr('x1', px - nx * hw)
            .attr('y1', py - ny * hw)
            .attr('x2', px + nx * hw)
            .attr('y2', py + ny * hw)
            .style('stroke', '#111')
            .style('stroke-width', '1.2px')
            .style('stroke-linecap', 'round');
        }
      }
      return;
    }

    const order = renderBondOrder(bond);
    const start = toSVGPt(atom1);
    const end = toSVGPt(atom2);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const { nx, ny } = ctx.geometry.perpUnit(dx, dy);

    if (order === 1) {
      const line = shortenBondLineWithLabelClearance(atom1, atom2, start, end, toSVGPt);
      addLine(container, line.x1, line.y1, line.x2, line.y2);
    } else if (order === 2) {
      const dir = ctx.geometry.secondaryDir(atom1, atom2, mol, toSVGPt);
      const primary = shortenBondLineWithLabelClearance(atom1, atom2, start, end, toSVGPt);
      addLine(container, primary.x1, primary.y1, primary.x2, primary.y2);
      const ox = nx * ctx.constants.bondOffset2d * dir;
      const oy = ny * ctx.constants.bondOffset2d * dir;
      const secondary = shortenBondLineWithLabelClearance(atom1, atom2, { x: start.x + ox, y: start.y + oy }, { x: end.x + ox, y: end.y + oy }, toSVGPt, 4);
      addLine(container, secondary.x1, secondary.y1, secondary.x2, secondary.y2);
    } else if (order === 3) {
      for (const d of [-ctx.constants.bondOffset2d, 0, ctx.constants.bondOffset2d]) {
        const ox = nx * d;
        const oy = ny * d;
        const tripleLine = shortenBondLineWithLabelClearance(atom1, atom2, { x: start.x + ox, y: start.y + oy }, { x: end.x + ox, y: end.y + oy }, toSVGPt, d !== 0 ? 4 : 0);
        addLine(container, tripleLine.x1, tripleLine.y1, tripleLine.x2, tripleLine.y2);
      }
    } else if (order === 1.5) {
      const dir = ctx.geometry.secondaryDir(atom1, atom2, mol, toSVGPt);
      const primary = shortenBondLineWithLabelClearance(atom1, atom2, start, end, toSVGPt);
      addLine(container, primary.x1, primary.y1, primary.x2, primary.y2);
      const ox = nx * ctx.constants.bondOffset2d * dir;
      const oy = ny * ctx.constants.bondOffset2d * dir;
      const dashed = shortenBondLineWithLabelClearance(atom1, atom2, { x: start.x + ox, y: start.y + oy }, { x: end.x + ox, y: end.y + oy }, toSVGPt, 5);
      addLine(container, dashed.x1, dashed.y1, dashed.x2, dashed.y2, 'bond-dashed');
    }
  }

  function zoomToFitIf2d() {
    const mol = ctx.state.getMol();
    if (!mol) {
      return;
    }
    const atoms = [...mol.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
    if (atoms.length === 0) {
      return;
    }
    const width = ctx.plotEl.clientWidth || 600;
    const height = ctx.plotEl.clientHeight || 400;
    const pad = 40;
    const transform = ctx.d3.zoomTransform(ctx.svg.node());
    let anyOut = false;
    let minGX = Infinity;
    let maxGX = -Infinity;
    let minGY = Infinity;
    let maxGY = -Infinity;
    for (const atom of atoms) {
      const { x: gX, y: gY } = toSVGPt2d(atom);
      const sx = transform.applyX(gX);
      const sy = transform.applyY(gY);
      if (sx < pad || sx > width - pad || sy < pad || sy > height - pad) {
        anyOut = true;
      }
      if (gX < minGX) {
        minGX = gX;
      }
      if (gX > maxGX) {
        maxGX = gX;
      }
      if (gY < minGY) {
        minGY = gY;
      }
      if (gY > maxGY) {
        maxGY = gY;
      }
    }
    if (!anyOut) {
      return;
    }
    const gW = maxGX - minGX || 1;
    const gH = maxGY - minGY || 1;
    const scale = Math.min((width - pad * 2) / gW, (height - pad * 2) / gH, 1);
    const tx = width / 2 - ((minGX + maxGX) / 2) * scale;
    const ty = height / 2 - ((minGY + maxGY) / 2) * scale;
    ctx.svg.call(ctx.zoom.transform, ctx.d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  function sync2dDerivedState(mol) {
    const hCounts = new Map();
    for (const [, atom] of mol.atoms) {
      if (atom.name === 'H') {
        continue;
      }
      const count = atom.getNeighbors(mol).filter(neighbor => neighbor.name === 'H').length;
      if (count > 0) {
        hCounts.set(atom.id, count);
      }
    }
    const stereoMap = ctx.stereo.pickStereoMap(mol);
    syncStereoHydrogenVisibility(mol, hCounts, stereoMap);
    ctx.state.setDerivedState({ hCounts, stereoMap });
  }

  return {
    toSVGPt2d,
    drawBond,
    zoomToFitIf2d,
    sync2dDerivedState
  };
}
