/** @module app/bootstrap/plot-bootstrap */

export function atomBBoxFallback(atoms) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const atom of atoms) {
    if (atom.x < minX) {
      minX = atom.x;
    }
    if (atom.x > maxX) {
      maxX = atom.x;
    }
    if (atom.y < minY) {
      minY = atom.y;
    }
    if (atom.y > maxY) {
      maxY = atom.y;
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };
}

export function enLabelColor(t) {
  const f = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(50 + 180 * f)},${Math.round(50 - 30 * f)},${Math.round(50 - 40 * f)})`;
}

export function initPlotBootstrap({ d3, document, getInteractionModeActive, onForceManualZoom }) {
  const plotEl = document.getElementById('plot');
  const tooltip = d3.select('#atom-tooltip');
  const inputEl = document.getElementById('smiles-input');
  const collectionSelectEl = document.getElementById('collection-select');

  const svg = d3.select('#plot').append('svg').attr('class', 'svg-plot labels-hidden');
  svg.append('rect').attr('fill', 'white').attr('width', '100%').attr('height', '100%');

  const g = svg.append('g');

  const zoom = d3
    .zoom()
    .scaleExtent([0.05, 30])
    .filter(event => {
      if (event.type === 'wheel') {
        return true;
      }
      if (getInteractionModeActive(event)) {
        return false;
      }
      return !event.ctrlKey && !event.button;
    })
    .on('zoom', event => {
      if (event.sourceEvent) {
        onForceManualZoom?.();
      }
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  return {
    plotEl,
    tooltip,
    inputEl,
    collectionSelectEl,
    svg,
    g,
    zoom
  };
}

export function initForceSimulation({
  d3,
  isHydrogenNode,
  forceLinkDistance,
  createForceAnchorRadiusForce,
  createForceHydrogenRepulsionForce,
  constants
}) {
  return d3
    .forceSimulation()
    .force(
      'charge',
      d3
        .forceManyBody()
        .strength(node => (isHydrogenNode(node) ? constants.forceLayoutHRepulsion : constants.forceLayoutHeavyRepulsion))
        .distanceMax(180)
    )
    .force(
      'link',
      d3
        .forceLink()
        .strength(link => (isHydrogenNode(link.source) || isHydrogenNode(link.target) ? 0.8 : 0.9))
        .distance(forceLinkDistance)
    )
    .force('anchor', createForceAnchorRadiusForce())
    .force('hRepel', createForceHydrogenRepulsionForce())
    .velocityDecay(0.35)
    .alphaDecay(0.02)
    .stop();
}
