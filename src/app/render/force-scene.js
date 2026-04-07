/** @module app/render/force-scene */

import { getRenderOptions, atomColor, strokeColor, singleBondWidth, prepareAromaticBondRendering, atomRadius, xOffset, yOffset, PI_STROKE, ARO_STROKE } from './helpers.js';
import { formatChargeLabel, chargeBadgeMetrics, computeChargeBadgePlacement, computeLonePairDotPositions, secondaryDir } from '../../layout/mol2d-helpers.js';
import { getBondEnOverlayData } from './bond-en-polarity.js';
import { atomNumberingLabelDistance, getAtomNumberMap, multipleBondSideBlockerAngle, pickAtomAnnotationAngle } from './atom-numbering.js';

function _capturePreviousNodePositions(simulation) {
  return new Map(
    simulation.nodes().map(node => [
      node.id,
      {
        x: node.x,
        y: node.y,
        vx: node.vx,
        vy: node.vy,
        fx: node.fx,
        fy: node.fy,
        anchorX: node.anchorX,
        anchorY: node.anchorY
      }
    ])
  );
}

export function createForceSceneRenderer(ctx) {
  function updateForce(molecule, { preservePositions = false, preserveView = preservePositions, initialPatchPos = null } = {}) {
    prepareAromaticBondRendering(molecule);
    const { showLonePairs } = getRenderOptions();
    const valenceWarningMap = ctx.helpers.valenceWarningMapFor(molecule);
    ctx.state.setActiveValenceWarningMap(valenceWarningMap);
    ctx.state.setForceAutoFitEnabled(!preserveView);
    ctx.state.disableKeepInView();

    const previousNodePositions = preservePositions ? _capturePreviousNodePositions(ctx.simulation) : null;
    const previousZoomTransform = preserveView ? ctx.d3.zoomTransform(ctx.svg.node()) : null;

    const anchorLayout = ctx.helpers.buildForceAnchorLayout(molecule);
    if (ctx.state.getPreserveSelectionOnNextRender()) {
      ctx.state.syncSelectionToMolecule(molecule);
    } else {
      ctx.state.clearSelection();
    }
    ctx.state.setPreserveSelectionOnNextRender(false);

    const graph = ctx.helpers.convertMolecule(molecule);
    ctx.g.selectAll('*').remove();
    ctx.cache.reset();

    if (!preserveView) {
      ctx.svg.call(ctx.zoom.transform, ctx.d3.zoomIdentity);
    }

    const bondEnter = ctx.g
      .selectAll('line.link-base')
      .data(graph.links, d => d.id)
      .enter();

    const valenceWarningNodes = graph.nodes.filter(node => valenceWarningMap.has(node.id));
    const valenceWarningCircles = ctx.g
      .append('g')
      .attr('class', 'valence-warning-layer')
      .style('pointer-events', 'none')
      .selectAll('circle.valence-warning')
      .data(valenceWarningNodes, d => d.id)
      .enter()
      .append('circle')
      .attr('class', 'valence-warning')
      .attr('r', d => atomRadius(d.protons) + 6)
      .attr('fill', ctx.constants.valenceWarningFill)
      .attr('stroke', 'none');
    ctx.cache.setValenceWarningCircles(valenceWarningCircles);

    const singleBond = bondEnter
      .append('line')
      .filter(d => d.order === 1 || d.order === 2 || d.order === 3)
      .attr('class', 'link')
      .attr('data-bond-id', d => d.id)
      .style('stroke-width', d => singleBondWidth(d.order));

    const doubleSep = bondEnter
      .append('line')
      .filter(d => d.order === 2)
      .attr('class', 'separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', PI_STROKE.stroke)
      .style('stroke-width', PI_STROKE.width);

    const aroBond1 = bondEnter
      .append('line')
      .filter(d => d.order === 1.5)
      .attr('class', 'link separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', ARO_STROKE.stroke)
      .style('stroke-width', ARO_STROKE.width);

    const aroBond2 = bondEnter
      .append('line')
      .filter(d => d.order === 1.5)
      .attr('class', 'link separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', ARO_STROKE.stroke)
      .style('stroke-width', ARO_STROKE.width)
      .style('stroke-dasharray', ARO_STROKE.dashArray);

    const tripleSep1 = bondEnter
      .append('line')
      .filter(d => d.order === 3)
      .attr('class', 'separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', PI_STROKE.stroke)
      .style('stroke-width', PI_STROKE.width);

    const tripleSep2 = bondEnter
      .append('line')
      .filter(d => d.order === 3)
      .attr('class', 'separator')
      .attr('data-bond-id', d => d.id)
      .style('stroke', PI_STROKE.stroke)
      .style('stroke-width', PI_STROKE.width);

    const bondHoverTarget = bondEnter
      .append('line')
      .attr('class', 'bond-hover-target')
      .style('stroke', 'transparent')
      .style('stroke-width', '14px')
      .style('pointer-events', 'stroke')
      .style('cursor', 'grab')
      .on('click', (event, d) => {
        ctx.events.handleForceBondClick(event, d.id, molecule);
      })
      .on('dblclick', (event, d) => {
        const bond = molecule.bonds.get(d.id);
        if (!bond) {
          return;
        }
        ctx.events.handleForceBondDblClick(event, bond.atoms);
      })
      .on('mouseover', (event, d) => {
        ctx.events.handleForceBondMouseOver(event, d.id, molecule);
      })
      .on('mousemove', event => ctx.events.handleForceBondMouseMove(event))
      .on('mouseout', () => {
        ctx.events.handleForceBondMouseOut();
      })
      .call(ctx.drag.createForceBondDrag(ctx.simulation, molecule));

    const atom = ctx.g
      .selectAll('circle.node')
      .data(graph.nodes, d => d.id)
      .enter()
      .append('circle')
      .attr('class', 'node')
      .attr('r', d => atomRadius(d.protons))
      .attr('fill', d => atomColor(d.name, 'force'))
      .attr('stroke', d => strokeColor(d.name))
      .attr('stroke-width', 1)
      .call(ctx.drag.createForceAtomDrag(ctx.simulation))
      .on('mousedown.drawbond', (event, d) => {
        ctx.events.handleForceAtomMouseDownDrawBond(event, d);
      })
      .on('click', (event, d) => {
        ctx.events.handleForceAtomClick(event, d, molecule);
      })
      .on('dblclick', (event, d) => {
        ctx.events.handleForceAtomDblClick(event, d.id);
      })
      .on('mouseover', (event, d) => {
        ctx.events.handleForceAtomMouseOver(event, d, molecule, valenceWarningMap.get(d.id) ?? null);
      })
      .on('mousemove', event => ctx.events.handleForceAtomMouseMove(event))
      .on('mouseout', (event, d) => {
        ctx.events.handleForceAtomMouseOut(d.id);
      });

    const atomSymbol = ctx.g
      .selectAll('text.atom-symbol')
      .data(graph.nodes, d => d.id)
      .enter()
      .append('text')
      .attr('class', 'atom-symbol')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-family', 'Arial, Helvetica, sans-serif')
      .attr('font-weight', 'bold')
      .attr('font-size', d => (d.name.length > 1 ? '7px' : '9px'))
      .attr('fill', d => {
        if (d.name === 'H') {
          return '#111';
        }
        const hex = atomColor(d.name, 'force');
        const cr = parseInt(hex.slice(1, 3), 16);
        const cg = parseInt(hex.slice(3, 5), 16);
        const cb = parseInt(hex.slice(5, 7), 16);
        return cr * 0.299 + cg * 0.587 + cb * 0.114 > 140 ? '#333' : '#fff';
      })
      .text(d => d.name);

    const forceLonePairLayer = showLonePairs ? ctx.g.append('g').attr('class', 'force-lone-pairs').style('pointer-events', 'none') : null;

    const forceChargeFontSize = 11;
    const chargeLabel = ctx.g
      .selectAll('g.charge-label')
      .data(
        graph.nodes.filter(d => d.charge !== 0),
        d => d.id
      )
      .enter()
      .append('g')
      .attr('class', 'charge-label')
      .attr('pointer-events', 'none');
    chargeLabel
      .append('circle')
      .attr('class', 'charge-label-ring')
      .attr('r', d => chargeBadgeMetrics(formatChargeLabel(d.charge), forceChargeFontSize).radius)
      .attr('fill', 'white')
      .attr('stroke', '#111')
      .attr('stroke-width', 0.9);
    chargeLabel
      .append('text')
      .attr('class', 'charge-label-text')
      .attr('font-family', 'Arial, Helvetica, sans-serif')
      .attr('font-size', d => `${chargeBadgeMetrics(formatChargeLabel(d.charge), forceChargeFontSize).fontSize}px`)
      .attr('font-weight', '700')
      .attr('fill', '#111')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .text(d => formatChargeLabel(d.charge));

    const forceNodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const forceLonePairDotsByAtomId = new Map();
    const forceChargeAngleByAtomId = new Map();
    const pointForForceAtom = atom => {
      const node = forceNodeById.get(atom?.id);
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        return null;
      }
      return { x: node.x, y: node.y };
    };
    const orientationPointForForceAtom = atom => {
      const node = forceNodeById.get(atom?.id);
      if (!node) {
        return null;
      }
      if (Number.isFinite(node.anchorX) && Number.isFinite(node.anchorY)) {
        return { x: node.anchorX, y: node.anchorY };
      }
      if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
        return { x: node.x, y: node.y };
      }
      return null;
    };

    function _forceLonePairDotsForAtom(atom) {
      if (!showLonePairs || atom.name === 'H') {
        return [];
      }
      const cached = forceLonePairDotsByAtomId.get(atom.id);
      if (cached) {
        return cached;
      }
      const node = forceNodeById.get(atom.id);
      if (!node) {
        return [];
      }
      const dots = computeLonePairDotPositions(atom, molecule, {
        pointForAtom: pointForForceAtom,
        orientationPointForAtom: orientationPointForForceAtom,
        baseRadius: atomRadius(node.protons, 'force'),
        offsetFromBoundary: 7,
        dotSpacing: 6
      });
      forceLonePairDotsByAtomId.set(atom.id, dots);
      return dots;
    }

    function _updateForceLonePairs() {
      if (!forceLonePairLayer) {
        return;
      }
      forceLonePairDotsByAtomId.clear();
      const dots = [];
      for (const atom of molecule.atoms.values()) {
        const atomDots = _forceLonePairDotsForAtom(atom);
        for (let i = 0; i < atomDots.length; i++) {
          dots.push({ id: `${atom.id}:${i}`, ...atomDots[i] });
        }
      }

      const lonePairDots = forceLonePairLayer.selectAll('circle.force-lone-pair').data(dots, d => d.id);
      lonePairDots
        .enter()
        .append('circle')
        .attr('class', 'force-lone-pair')
        .attr('r', 2.1)
        .attr('fill', '#f0d84d')
        .attr('stroke', '#111111')
        .attr('stroke-width', 0.7)
        .merge(lonePairDots)
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
      lonePairDots.exit().remove();
    }

    function _updateForceChargeLabels() {
      chargeLabel.attr('transform', d => {
        const atom = molecule.atoms.get(d.id);
        if (!atom) {
          return 'translate(-9999,-9999)';
        }
        const center = pointForForceAtom(atom);
        if (!center) {
          return 'translate(-9999,-9999)';
        }
        const placement = computeChargeBadgePlacement(atom, molecule, {
          pointForAtom: pointForForceAtom,
          orientationPointForAtom: orientationPointForForceAtom,
          baseRadius: atomRadius(d.protons, 'force'),
          fontSize: forceChargeFontSize,
          chargeLabel: formatChargeLabel(d.charge),
          stickyAngle: forceChargeAngleByAtomId.get(atom.id) ?? null,
          extraOccupiedAngles: _forceLonePairDotsForAtom(atom)
            .map(dot => Math.atan2(dot.y - center.y, dot.x - center.x))
            .filter(Number.isFinite)
        });
        if (placement) {
          forceChargeAngleByAtomId.set(atom.id, placement.angle);
        }
        return placement ? `translate(${placement.x},${placement.y})` : 'translate(-9999,-9999)';
      });
    }

    ctx.helpers.seedForceNodePositions(graph, molecule, anchorLayout, {
      previousNodePositions
    });

    ctx.simulation.nodes(graph.nodes);
    ctx.simulation.force('link').links(graph.links);
    ctx.simulation
      .force('charge')
      .strength(node => (ctx.helpers.isHydrogenNode(node) ? ctx.constants.forceLayoutHRepulsion : ctx.constants.forceLayoutHeavyRepulsion))
      .distanceMax(180);
    ctx.simulation
      .force('link')
      .strength(link => (ctx.helpers.isHydrogenNode(link.source) || ctx.helpers.isHydrogenNode(link.target) ? 0.8 : 0.9))
      .distance(ctx.helpers.forceLinkDistance);
    ctx.simulation.force('anchor', ctx.helpers.forceAnchorRadius());
    ctx.simulation.force('hRepel', ctx.helpers.forceHydrogenRepulsion());
    if (initialPatchPos?.size) {
      // Apply edit-driven force patches before the first restarted tick so
      // newly-added hydrogens do not animate in from the temporary seed layout.
      ctx.helpers.patchForceNodePositions(initialPatchPos, { alpha: 0, restart: false });
      ctx.helpers.reseatHydrogensAroundPatched(initialPatchPos, { resetVelocity: true });
    }
    ctx.simulation.alpha(preservePositions ? 0.2 : 1).restart();
    _updateForceLonePairs();
    _updateForceChargeLabels();

    const forceEnData = getBondEnOverlayData(molecule);
    const forceLinkById = new Map(graph.links.map(link => [link.id, link]));
    let forceBondEnLabels = null;
    if (forceEnData) {
      const enLayer = ctx.g.append('g').attr('class', 'force-bond-en').style('pointer-events', 'none');
      const labelData = forceEnData.map(({ bondId, label, t }) => ({ link: forceLinkById.get(bondId), label, t })).filter(d => d.link);
      forceBondEnLabels = enLayer
        .selectAll('text.force-bond-en-label')
        .data(labelData)
        .enter()
        .append('text')
        .attr('class', 'force-bond-en-label')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', `${getRenderOptions().atomNumberingFontSize}px`)
        .attr('pointer-events', 'none')
        .attr('fill', d => ctx.helpers.enLabelColor(d.t))
        .text(d => d.label);
    }

    function _updateForceBondEnLabels() {
      if (!forceBondEnLabels) {
        return;
      }
      forceBondEnLabels.attr('transform', d => {
        const dx = d.link.target.x - d.link.source.x;
        const dy = d.link.target.y - d.link.source.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const x = (d.link.source.x + d.link.target.x) / 2 + (-dy / len) * 13;
        const y = (d.link.source.y + d.link.target.y) / 2 + (dx / len) * 13;
        return `translate(${x},${y})`;
      });
    }
    _updateForceBondEnLabels();

    const forceNumberMap = getAtomNumberMap(molecule);
    const forceNodeById2 = new Map(graph.nodes.map(node => [node.id, node]));
    let forceAtomNumberLabels = null;
    if (forceNumberMap) {
      const nodeNeighbors = new Map(graph.nodes.map(n => [n.id, []]));
      const nodeLinks = new Map(graph.nodes.map(n => [n.id, []]));
      for (const link of graph.links) {
        nodeNeighbors.get(link.source.id)?.push(link.target);
        nodeNeighbors.get(link.target.id)?.push(link.source);
        nodeLinks.get(link.source.id)?.push(link);
        nodeLinks.get(link.target.id)?.push(link);
      }
      const numLayer = ctx.g.append('g').attr('class', 'force-atom-numbering').style('pointer-events', 'none');
      const numData = [...forceNumberMap.entries()]
        .map(([id, num]) => ({
          node: forceNodeById2.get(id),
          label: String(num),
          neighbors: nodeNeighbors.get(id) ?? [],
          links: nodeLinks.get(id) ?? []
        }))
        .filter(d => d.node);
      forceAtomNumberLabels = numLayer
        .selectAll('text.force-atom-num')
        .data(numData)
        .enter()
        .append('text')
        .attr('class', 'force-atom-num')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', `${getRenderOptions().atomNumberingFontSize}px`)
        .attr('pointer-events', 'none')
        .attr('fill', '#444')
        .text(d => d.label);
    }
    function _updateForceAtomNumberLabels() {
      if (!forceAtomNumberLabels) {
        return;
      }
      forceAtomNumberLabels.attr('transform', d => {
        const { node, neighbors, links, label } = d;
        const blockedSectors = neighbors.map(nb => {
          const angle = Math.atan2(nb.y - node.y, nb.x - node.x);
          const link = links.find(candidate => candidate.source.id === nb.id || candidate.target.id === nb.id);
          const spread = (link?.order ?? 1) >= 2 ? 0.52 : 0.4;
          return { angle, spread };
        });
        const chargeAngle = forceChargeAngleByAtomId.get(node.id) ?? null;
        if (chargeAngle != null) {
          blockedSectors.push({ angle: chargeAngle, spread: 0.3 });
        }
        const atom = molecule.atoms.get(node.id);
        if (atom && showLonePairs) {
          const lp = _forceLonePairDotsForAtom(atom);
          for (const dot of lp) {
            blockedSectors.push({ angle: Math.atan2(dot.y - node.y, dot.x - node.x), spread: 0.32 });
          }
        }
        if (atom) {
          for (const link of links) {
            if (link.order !== 2 && link.order !== 1.5) {
              continue;
            }
            const otherNode = link.source.id === node.id ? link.target : link.source;
            const otherAtom = molecule.atoms.get(otherNode.id);
            if (!otherAtom) {
              continue;
            }
            const dir = secondaryDir(atom, otherAtom, molecule, pointForForceAtom);
            const sideAngle = multipleBondSideBlockerAngle(node, otherNode, dir);
            if (sideAngle != null) {
              blockedSectors.push({ angle: sideAngle, spread: 0.5 });
            }
          }
        }
        const angle = pickAtomAnnotationAngle(blockedSectors);
        const labelDistance = atomNumberingLabelDistance(getRenderOptions().atomNumberingFontSize, label);
        return `translate(${node.x + Math.cos(angle) * labelDistance},${node.y + Math.sin(angle) * labelDistance})`;
      });
    }
    _updateForceAtomNumberLabels();

    ctx.simulation.on('tick', () => {
      ctx.helpers.renderReactionPreviewArrowForce(graph.nodes);

      singleBond
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      doubleSep
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      aroBond1
        .attr('x1', d => d.source.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(ctx.constants.bondOffset, d.source, d.target));

      aroBond2
        .attr('x1', d => d.source.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(-ctx.constants.bondOffset, d.source, d.target));

      tripleSep1
        .attr('x1', d => d.source.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(ctx.constants.bondOffset, d.source, d.target));

      tripleSep2
        .attr('x1', d => d.source.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y1', d => d.source.y - yOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('x2', d => d.target.x - xOffset(-ctx.constants.bondOffset, d.source, d.target))
        .attr('y2', d => d.target.y - yOffset(-ctx.constants.bondOffset, d.source, d.target));

      bondHoverTarget
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      atom.attr('cx', d => d.x).attr('cy', d => d.y);
      atomSymbol.attr('x', d => d.x).attr('y', d => d.y);

      const forceValenceWarningCircles = ctx.cache.getValenceWarningCircles();
      if (forceValenceWarningCircles) {
        forceValenceWarningCircles.attr('cx', d => d.x).attr('cy', d => d.y);
      }

      _updateForceLonePairs();
      _updateForceChargeLabels();
      _updateForceBondEnLabels();
      _updateForceAtomNumberLabels();

      const highlightLines = ctx.cache.getHighlightLines();
      const highlightCircles = ctx.cache.getHighlightCircles();
      if (highlightLines) {
        highlightLines
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        highlightCircles?.attr('cx', d => d.x).attr('cy', d => d.y);
      }
      const selectionLines = ctx.cache.getSelectionLines();
      const selectionCircles = ctx.cache.getSelectionCircles();
      if (selectionLines) {
        selectionLines
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        selectionCircles?.attr('cx', d => d.x).attr('cy', d => d.y);
      }

      if (ctx.state.isForceAutoFitEnabled()) {
        const fitTransform = ctx.helpers.forceFitTransform(graph.nodes, ctx.constants.forceLayoutInitialFitPad, {
          hydrogenRadiusScale: ctx.constants.forceLayoutInitialHRadiusScale,
          scaleMultiplier: ctx.constants.forceLayoutInitialZoomMultiplier
        });
        if (fitTransform) {
          ctx.svg.call(ctx.zoom.transform, fitTransform);
          ctx.state.setForceAutoFitEnabled(false);
          ctx.state.enableKeepInView(ctx.constants.forceLayoutInitialKeepInViewTicks);
        }
      } else if (ctx.state.isKeepInViewEnabled()) {
        if (ctx.state.getKeepInViewTicks() > 0) {
          ctx.state.setKeepInViewTicks(ctx.state.getKeepInViewTicks() - 1);
          if (ctx.state.getKeepInViewTicks() <= 0) {
            ctx.state.disableKeepInView();
            return;
          }
        }
        if (ctx.simulation.alpha() < ctx.constants.forceLayoutKeepInViewAlphaMin) {
          ctx.state.disableKeepInView();
          return;
        }
        const width = ctx.plotEl.clientWidth;
        const height = ctx.plotEl.clientHeight;
        const pad = ctx.constants.forceLayoutFitPad;
        const transform = ctx.d3.zoomTransform(ctx.svg.node());
        let anyOut = false;
        for (const node of graph.nodes) {
          const radius = atomRadius(node.protons);
          const sx1 = transform.x + (node.x - radius) * transform.k;
          const sy1 = transform.y + (node.y - radius) * transform.k;
          const sx2 = transform.x + (node.x + radius) * transform.k;
          const sy2 = transform.y + (node.y + radius) * transform.k;
          if (sx1 < pad || sx2 > width - pad || sy1 < pad || sy2 > height - pad) {
            anyOut = true;
          }
        }
        if (anyOut) {
          const fitTransform = ctx.helpers.forceFitTransform(graph.nodes, ctx.constants.forceLayoutFitPad);
          if (fitTransform) {
            ctx.svg.call(ctx.zoom.transform, fitTransform);
          }
          ctx.state.disableKeepInView();
        }
      }
    });

    if (preserveView && previousZoomTransform) {
      ctx.svg.call(ctx.zoom.transform, previousZoomTransform);
    }

    if (ctx.callbacks.hasHighlights()) {
      ctx.callbacks.applyForceHighlights();
    }
    if (ctx.callbacks.hasSelection()) {
      ctx.callbacks.applyForceSelection();
    }
  }

  return {
    updateForce
  };
}
