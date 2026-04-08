/** @module app/render/2d-helpers */

import { renderBondOrder, addLine } from './helpers.js';
import { labelHalfW, labelHalfH, labelTextOffset, getAtomLabel } from '../../layout/mol2d-helpers.js';

/**
 * Creates 2D render helper functions for SVG point conversion, bond drawing, viewport fitting, and derived state synchronization.
 * @param {object} ctx - Dependency context providing plotEl, state, constants, geometry, stereo, d3, svg, and zoom.
 * @returns {object} Object with `toSVGPt2d`, `drawBond`, `zoomToFitIf2d`, and `sync2dDerivedState`.
 */
export function create2DRenderHelpers(ctx) {
  function toSVGPt2d(atom) {
    const width = ctx.plotEl.clientWidth || 600;
    const height = ctx.plotEl.clientHeight || 400;
    return {
      x: width / 2 + (atom.x - ctx.state.getCenterX()) * ctx.constants.scale,
      y: height / 2 - (atom.y - ctx.state.getCenterY()) * ctx.constants.scale
    };
  }

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

  function drawBond(container, bond, atom1, atom2, mol, toSVGPt, stereoType = null) {
    if (stereoType === 'wedge' || stereoType === 'dash') {
      const start = toSVGPt(atom1);
      const endOriginal = toSVGPt(atom2);
      const { nx, ny } = ctx.geometry.perpUnit(endOriginal.x - start.x, endOriginal.y - start.y);
      const c2 = labelClearance(atom2, start, toSVGPt);
      const bondLength = Math.sqrt((endOriginal.x - start.x) ** 2 + (endOriginal.y - start.y) ** 2) || 1;
      const end = {
        x: endOriginal.x - ((endOriginal.x - start.x) / bondLength) * c2,
        y: endOriginal.y - ((endOriginal.y - start.y) / bondLength) * c2
      };
      if (stereoType === 'wedge') {
        container
          .append('polygon')
          .attr('class', 'bond bond-wedge')
          .attr(
            'points',
            `${start.x},${start.y} ` +
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
    const c1 = labelClearance(atom1, end, toSVGPt);
    const c2 = labelClearance(atom2, start, toSVGPt);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const { nx, ny } = ctx.geometry.perpUnit(dx, dy);

    if (order === 1) {
      const line = ctx.geometry.shortenLine(start.x, start.y, end.x, end.y, c1, c2);
      addLine(container, line.x1, line.y1, line.x2, line.y2);
    } else if (order === 2) {
      const dir = ctx.geometry.secondaryDir(atom1, atom2, mol, toSVGPt);
      const primary = ctx.geometry.shortenLine(start.x, start.y, end.x, end.y, c1, c2);
      addLine(container, primary.x1, primary.y1, primary.x2, primary.y2);
      const ox = nx * ctx.constants.bondOffset2d * dir;
      const oy = ny * ctx.constants.bondOffset2d * dir;
      const secondary = ctx.geometry.shortenLine(start.x + ox, start.y + oy, end.x + ox, end.y + oy, Math.max(c1, 4), Math.max(c2, 4));
      addLine(container, secondary.x1, secondary.y1, secondary.x2, secondary.y2);
    } else if (order === 3) {
      for (const d of [-ctx.constants.bondOffset2d, 0, ctx.constants.bondOffset2d]) {
        const ox = nx * d;
        const oy = ny * d;
        const tripleLine = ctx.geometry.shortenLine(
          start.x + ox,
          start.y + oy,
          end.x + ox,
          end.y + oy,
          d !== 0 ? Math.max(c1, 4) : c1,
          d !== 0 ? Math.max(c2, 4) : c2
        );
        addLine(container, tripleLine.x1, tripleLine.y1, tripleLine.x2, tripleLine.y2);
      }
    } else if (order === 1.5) {
      const dir = ctx.geometry.secondaryDir(atom1, atom2, mol, toSVGPt);
      const primary = ctx.geometry.shortenLine(start.x, start.y, end.x, end.y, c1, c2);
      addLine(container, primary.x1, primary.y1, primary.x2, primary.y2);
      const ox = nx * ctx.constants.bondOffset2d * dir;
      const oy = ny * ctx.constants.bondOffset2d * dir;
      const dashed = ctx.geometry.shortenLine(start.x + ox, start.y + oy, end.x + ox, end.y + oy, Math.max(c1, 5), Math.max(c2, 5));
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
      if (gX < minGX) {minGX = gX;}
      if (gX > maxGX) {maxGX = gX;}
      if (gY < minGY) {minGY = gY;}
      if (gY > maxGY) {maxGY = gY;}
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
    ctx.state.setDerivedState({ hCounts, stereoMap });
  }

  return {
    toSVGPt2d,
    drawBond,
    zoomToFitIf2d,
    sync2dDerivedState
  };
}
