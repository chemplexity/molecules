/** @module app/bootstrap/plot-bootstrap */

/**
 * Computes the bounding box and centroid of an array of atoms using their x/y coordinates.
 * @param {Array<{x: number, y: number}>} atoms - Array of atom objects with numeric x and y positions.
 * @returns {{minX: number, maxX: number, minY: number, maxY: number, cx: number, cy: number}} Bounding box and centroid.
 */
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

/**
 * Returns an RGB color string interpolated from red (low) to warm orange/brown (high) for electronegativity labels.
 * @param {number} t - Normalized value between 0 and 1.
 * @returns {string} CSS `rgb(...)` color string.
 */
export function enLabelColor(t) {
  const f = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(50 + 180 * f)},${Math.round(50 - 30 * f)},${Math.round(50 - 40 * f)})`;
}

/**
 * Creates the SVG plot, tooltip, input elements, and D3 zoom behavior that form the visual shell of the application.
 * @param {object} params - Plot bootstrap parameters.
 * @param {object} params.d3 - D3 library instance.
 * @param {Document} params.document - Browser document used for querying elements.
 * @param {(event: Event) => boolean} params.getInteractionModeActive - Returns true when a custom interaction mode should block zoom pan gestures.
 * @param {() => void} [params.onForceManualZoom] - Optional callback invoked when the user manually zooms in force-layout mode.
 * @returns {{plotEl: Element, tooltip: object, inputEl: HTMLInputElement, collectionSelectEl: HTMLSelectElement, svg: object, g: object, zoom: object}} D3-wrapped plot elements and zoom behavior.
 */
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

/**
 * Creates and configures the D3 force simulation used in force-layout mode.
 * @param {object} params - Force simulation parameters.
 * @param {object} params.d3 - D3 library instance.
 * @param {(node: object) => boolean} params.isHydrogenNode - Returns true if the given node represents a hydrogen atom.
 * @param {(link: object) => number} params.forceLinkDistance - Returns the desired link distance for a given link.
 * @param {(nodes: object[]) => object} params.createForceAnchorRadiusForce - Factory that creates the anchor-radius custom force.
 * @param {(nodes: object[]) => object} params.createForceHydrogenRepulsionForce - Factory that creates the hydrogen-repulsion custom force.
 * @param {object} params.constants - Numeric constants including `forceLayoutHRepulsion` and `forceLayoutHeavyRepulsion`.
 * @returns {object} Configured (but stopped) D3 force simulation instance.
 */
export function initForceSimulation({ d3, isHydrogenNode, forceLinkDistance, createForceAnchorRadiusForce, createForceHydrogenRepulsionForce, constants }) {
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
