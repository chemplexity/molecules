/**
 * Layout Engine Step Visualizer Server
 *
 * Accepts GET /layout?smiles=...
 * Returns a JSON array of pipeline step snapshots, each with a rendered SVG
 * and diff highlights for atoms that moved since the previous step.
 *
 * Usage:
 *   node scripts/test/layout-engine-demo/server.js
 *   Then open scripts/test/layout-engine-demo/viewer.html in a browser.
 */

import http from 'http';
import { parseSMILES } from '../../../src/io/index.js';
import { runPipeline } from '../../../src/layout/engine/pipeline.js';
import { renderMolSVG, SCALE } from '../../../src/layout/render2d.js';
import { exampleMoleculeComplex } from '../../../examples/example-molecules-complex.js';

const PORT = 3738;

// Shuffled-bag random picker — avoids repeating recent picks.
const randomBag = { indices: [], recentLimit: Math.min(Math.ceil(Math.sqrt(exampleMoleculeComplex.length)), 24) };
function pickRandomSmiles() {
  if (randomBag.indices.length === 0) {
    randomBag.indices = Array.from({ length: exampleMoleculeComplex.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5);
  }
  return exampleMoleculeComplex[randomBag.indices.pop()];
}

// Deep-copy a coords map.
function copyCoords(coords) {
  return new Map([...coords].map(([k, v]) => [k, { x: v.x, y: v.y }]));
}

// Write snapshot coords onto molecule atoms for rendering.
function applyCoords(mol, coords) {
  for (const [atomId, pos] of coords) {
    const atom = mol.atoms.get(atomId);
    if (atom) {
      atom.x = pos.x;
      atom.y = pos.y;
    }
  }
}

// Compute bounding box center from the visible (non-H) atoms in mol — must be
// called after renderMolSVG since that calls mol.hideHydrogens() internally.
// This matches the exact atom set used by renderMolSVG for its own bbox/transform.
function visibleAtomBboxCenter(mol) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const atom of mol.atoms.values()) {
    if (atom.x == null || atom.visible === false) continue;
    if (atom.x < minX) minX = atom.x;
    if (atom.x > maxX) maxX = atom.x;
    if (atom.y < minY) minY = atom.y;
    if (atom.y > maxY) maxY = atom.y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// Convert a molecular coordinate to an SVG pixel position.
function molToSVG(molX, molY, cx, cy, cellW, cellH) {
  return {
    x: cellW / 2 + (molX - cx) * SCALE,
    y: cellH / 2 - (molY - cy) * SCALE
  };
}

// Append diff-highlight circles to an SVG content string.
// Only highlights visible (non-H) atoms. Adds <title> tooltips with atom + distance info.
function injectDiffHighlights(svgContent, cellW, cellH, cx, cy, mol, coords, movedAtomIds, prevCoords) {
  if (!movedAtomIds || movedAtomIds.size === 0) return { svgContent, visibleCount: 0 };
  const circles = [];
  for (const atomId of movedAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.visible === false) continue; // skip hidden (H) atoms
    const pos = coords.get(atomId);
    if (!pos) continue;
    const { x, y } = molToSVG(pos.x, pos.y, cx, cy, cellW, cellH);
    const prev = prevCoords?.get(atomId);
    const dist = prev ? Math.sqrt((pos.x - prev.x) ** 2 + (pos.y - prev.y) ** 2) : 0;
    const tooltip = `${atomId}: moved ${dist.toFixed(2)} Å`;
    circles.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="rgba(251,146,60,0.3)" stroke="#f97316" stroke-width="1.5"><title>${tooltip}</title></circle>`
    );
  }
  return { svgContent: svgContent + (circles.length ? '\n' + circles.join('\n') : ''), visibleCount: circles.length };
}

// Compute which atom IDs moved by more than threshold Å between two snapshots.
function computeMovedAtomIds(prev, curr, threshold = 0.005) {
  if (!prev) return new Set();
  const moved = new Set();
  for (const [atomId, pos] of curr) {
    const p = prev.get(atomId);
    if (!p) continue;
    const dx = pos.x - p.x;
    const dy = pos.y - p.y;
    if (dx * dx + dy * dy > threshold * threshold) {
      moved.add(atomId);
    }
  }
  return moved;
}

// Render a molecule with pre-applied coords and return the full SVG string.
function renderStep(mol, coords, prevCoords) {
  applyCoords(mol, coords);
  const rendered = renderMolSVG(mol, { skipLayout: true });
  if (!rendered) return null;
  const { cellW: rCellW, cellH: rCellH } = rendered;
  // Use the same bbox center that renderMolSVG used (visible non-H atoms only).
  // mol.hideHydrogens() was already called inside renderMolSVG, so atom.visible is up to date.
  const { cx, cy } = visibleAtomBboxCenter(mol);
  const movedAtomIds = computeMovedAtomIds(prevCoords, coords);
  const { svgContent, visibleCount } = injectDiffHighlights(rendered.svgContent, rCellW, rCellH, cx, cy, mol, coords, movedAtomIds, prevCoords);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rCellW} ${rCellH}" width="${rCellW}" height="${rCellH}">${svgContent}</svg>`;
  return { svg, cellW: rCellW, cellH: rCellH, movedAtomCount: visibleCount };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/random') {
    const smiles = pickRandomSmiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ smiles }));
    return;
  }

  if (url.pathname !== '/layout') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use GET /layout?smiles=...' }));
    return;
  }

  const smiles = url.searchParams.get('smiles') || 'CCO';
  console.log(`[→] Layout: smiles=${smiles}`);

  try {
    const mol = parseSMILES(smiles);

    // Collect snapshots during the pipeline run.
    const snapshots = [];
    let prevCoords = null;

    const onStep = (label, description, coords, stepMetadata) => {
      snapshots.push({ label, description, coords: copyCoords(coords), prevCoords: prevCoords ? copyCoords(prevCoords) : null, stepMetadata });
      prevCoords = coords;
    };

    const result = runPipeline(mol, { debug: { onStep } });

    // Render each snapshot.
    const steps = [];
    for (const snap of snapshots) {
      const rendered = renderStep(mol, snap.coords, snap.prevCoords);
      if (!rendered) continue;
      steps.push({
        label: snap.label,
        description: snap.description,
        svg: rendered.svg,
        cellW: rendered.cellW,
        cellH: rendered.cellH,
        movedAtomCount: rendered.movedAtomCount,
        stepMetadata: snap.stepMetadata,
        layoutMetadata: {
          primaryFamily: result.metadata.primaryFamily,
          mixedMode: result.metadata.mixedMode,
          componentCount: result.metadata.componentCount,
          ringCount: result.metadata.ringCount,
          ringSystemCount: result.metadata.ringSystemCount,
          cleanupPasses: result.metadata.cleanupPasses,
          placedFamilies: result.metadata.placedFamilies,
          audit: {
            ok: result.metadata.audit?.ok,
            severeOverlapCount: result.metadata.audit?.severeOverlapCount ?? 0,
            meanBondLengthDeviation: result.metadata.audit?.meanBondLengthDeviation ?? 0
          }
        }
      });
    }

    console.log(`[✓] Done: ${steps.length} steps`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ steps, smiles }));
  } catch (e) {
    console.error(`[✗] Error:`, e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Layout Engine Demo running at http://localhost:${PORT}`);
  console.log(`Open scripts/test/layout-engine-demo/viewer.html in your browser.`);
});
