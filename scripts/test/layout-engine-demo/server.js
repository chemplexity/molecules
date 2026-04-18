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
import { applyCoords } from '../../../src/layout/engine/apply.js';
import { renderMolSVG, SCALE } from '../../../src/layout/render2d.js';
import { exampleMoleculeComplex } from '../../../examples/example-molecules-complex.js';

const PORT = 3738;

// Shuffled-bag random picker — avoids repeating recent picks.
const randomBag = { indices: [], recentLimit: Math.min(Math.ceil(Math.sqrt(exampleMoleculeComplex.length)), 24) };
function pickRandomSmiles() {
  if (randomBag.indices.length === 0) {
    randomBag.indices = Array.from({ length: exampleMoleculeComplex.length }, (_, i) => i).sort(() => Math.random() - 0.5);
  }
  return exampleMoleculeComplex[randomBag.indices.pop()];
}

// Deep-copy a coords map.
function copyCoords(coords) {
  return new Map([...coords].map(([k, v]) => [k, { x: v.x, y: v.y }]));
}

// Compute bounding box center from the visible (non-H) atoms in mol — must be
// called after renderMolSVG since that calls mol.hideHydrogens() internally.
// This matches the exact atom set used by renderMolSVG for its own bbox/transform.
function visibleAtomBboxCenter(mol) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
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
// Receives the already-filtered movedVisibleIds (no H atoms).
function injectDiffHighlights(svgContent, cellW, cellH, cx, cy, mol, coords, movedVisibleIds, prevCoords) {
  if (!movedVisibleIds || movedVisibleIds.size === 0) return { svgContent, visibleCount: 0 };
  const circles = [];
  for (const atomId of movedVisibleIds) {
    const pos = coords.get(atomId);
    if (!pos) continue;
    const { x, y } = molToSVG(pos.x, pos.y, cx, cy, cellW, cellH);
    const prev = prevCoords?.get(atomId);
    const dist = prev ? Math.sqrt((pos.x - prev.x) ** 2 + (pos.y - prev.y) ** 2) : 0;
    const tooltip = `${atomId}: moved ${dist.toFixed(2)} Å`;
    const prevPos = prev ? molToSVG(prev.x, prev.y, cx, cy, cellW, cellH) : null;
    const prevAttrs = prevPos ? ` data-px="${prevPos.x.toFixed(1)}" data-py="${prevPos.y.toFixed(1)}"` : '';
    circles.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="rgba(251,146,60,0.3)" stroke="#f97316" stroke-width="1.5"${prevAttrs}><title>${tooltip}</title></circle>`
    );
  }
  return { svgContent: svgContent + (circles.length ? '\n' + circles.join('\n') : ''), visibleCount: circles.length };
}

// Build the ghost-overlay data: previous-position circles for all moved visible atoms
// and previous-position lines for every bond that involves at least one moved atom.
function buildGhostData(mol, movedVisibleIds, prevCoords, cx, cy, cellW, cellH) {
  if (!movedVisibleIds || movedVisibleIds.size === 0) return null;

  const atoms = [];
  for (const atomId of movedVisibleIds) {
    const prev = prevCoords?.get(atomId);
    if (!prev) continue;
    const { x: px, y: py } = molToSVG(prev.x, prev.y, cx, cy, cellW, cellH);
    atoms.push({ px: +px.toFixed(1), py: +py.toFixed(1) });
  }

  const bonds = [];
  for (const bond of mol.bonds.values()) {
    const [aId, bId] = bond.atoms;
    const aAtom = mol.atoms.get(aId);
    const bAtom = mol.atoms.get(bId);
    if (!aAtom || aAtom.visible === false || !bAtom || bAtom.visible === false) continue;
    if (!movedVisibleIds.has(aId) && !movedVisibleIds.has(bId)) continue;
    const aPrev = prevCoords?.get(aId);
    const bPrev = prevCoords?.get(bId);
    if (!aPrev || !bPrev) continue;
    const { x: x1, y: y1 } = molToSVG(aPrev.x, aPrev.y, cx, cy, cellW, cellH);
    const { x: x2, y: y2 } = molToSVG(bPrev.x, bPrev.y, cx, cy, cellW, cellH);
    bonds.push({ x1: +x1.toFixed(1), y1: +y1.toFixed(1), x2: +x2.toFixed(1), y2: +y2.toFixed(1) });
  }

  return atoms.length > 0 ? { atoms, bonds } : null;
}

// Build a human-readable reason why a stage was rejected.
function buildRejectReason(candidateAudit, incumbentAudit) {
  if (!candidateAudit || !incumbentAudit) return 'Did not improve over current best.';
  const reasons = [];
  const dOverlaps = (candidateAudit.severeOverlapCount ?? 0) - (incumbentAudit.severeOverlapCount ?? 0);
  const dFail = (candidateAudit.bondLengthFailureCount ?? 0) - (incumbentAudit.bondLengthFailureCount ?? 0);
  const dDev = (candidateAudit.meanBondLengthDeviation ?? 0) - (incumbentAudit.meanBondLengthDeviation ?? 0);
  if (dOverlaps > 0) reasons.push(`+${dOverlaps} overlap${dOverlaps !== 1 ? 's' : ''} (was ${incumbentAudit.severeOverlapCount ?? 0})`);
  if (dFail > 0) reasons.push(`+${dFail} bond failure${dFail !== 1 ? 's' : ''}`);
  if (reasons.length === 0) {
    if (dDev > 0.001) reasons.push(`bond deviation +${(dDev * 100).toFixed(1)}%`);
    else reasons.push('Score did not improve.');
  }
  return reasons.join(' · ');
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

// Render a molecule with pre-applied coords and return the full SVG string + ghost data.
function renderStep(mol, coords, prevCoords) {
  applyCoords(mol, coords, { hiddenHydrogenMode: 'coincident', syncStereoDisplay: true });
  const rendered = renderMolSVG(mol, { skipLayout: true });
  if (!rendered) return null;
  const { cellW: rCellW, cellH: rCellH } = rendered;
  const { cx, cy } = visibleAtomBboxCenter(mol);
  const allMovedIds = computeMovedAtomIds(prevCoords, coords);
  // Only highlight visible (non-H) atoms — mol.hideHydrogens() has already run inside renderMolSVG.
  const movedVisibleIds = new Set(
    [...allMovedIds].filter(id => {
      const a = mol.atoms.get(id);
      return a && a.visible !== false;
    })
  );
  const { svgContent, visibleCount } = injectDiffHighlights(rendered.svgContent, rCellW, rCellH, cx, cy, mol, coords, movedVisibleIds, prevCoords);
  const ghostData = buildGhostData(mol, movedVisibleIds, prevCoords, cx, cy, rCellW, rCellH);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rCellW} ${rCellH}" width="${rCellW}" height="${rCellH}">${svgContent}</svg>`;
  return { svg, cellW: rCellW, cellH: rCellH, movedAtomCount: visibleCount, ghostData };
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
    mol.hideHydrogens();

    const snapshots = [];
    let prevCoords = null;
    const stageAcceptance = new Map();

    const result = runPipeline(mol, {
      suppressH: true,
      bondLength: 1.5,
      maxCleanupPasses: 6,
      debug: {
        onStep: (label, description, coords, stepMetadata) => {
          snapshots.push({ label, description, coords: copyCoords(coords), prevCoords: prevCoords ? copyCoords(prevCoords) : null, stepMetadata });
          prevCoords = coords;
        },
        onStageAcceptance: (name, accepted, cAudit, iAudit) => stageAcceptance.set(name, { accepted, candidateAudit: cAudit, incumbentAudit: iAudit })
      }
    });

    // Render each snapshot.
    const steps = [];
    for (const snap of snapshots) {
      const rendered = renderStep(mol, snap.coords, snap.prevCoords);
      if (!rendered) continue;
      const stageName = snap.stepMetadata?._stageName ?? null;
      const acceptance = stageName ? stageAcceptance.get(stageName) : null;
      const accepted = acceptance ? acceptance.accepted : true;
      const rejectReason = !accepted ? buildRejectReason(acceptance.candidateAudit, acceptance.incumbentAudit) : null;
      const stepAudit = acceptance?.candidateAudit ?? null;
      // Strip internal fields (prefixed _) before sending to client.
      const stepMetadata = snap.stepMetadata
        ? Object.fromEntries(Object.entries(snap.stepMetadata).filter(([k]) => !k.startsWith('_')))
        : {};
      const meta = result.metadata;
      steps.push({
        label: snap.label,
        description: snap.description,
        svg: rendered.svg,
        cellW: rendered.cellW,
        cellH: rendered.cellH,
        movedAtomCount: rendered.movedAtomCount,
        ghostData: rendered.ghostData ?? null,
        accepted,
        rejectReason,
        stepAudit,
        stepMetadata,
        layoutMetadata: {
          primaryFamily: meta.primaryFamily,
          mixedMode: meta.mixedMode,
          componentCount: meta.componentCount,
          ringCount: meta.ringCount,
          ringSystemCount: meta.ringSystemCount,
          cleanupPasses: meta.cleanupPasses,
          placedFamilies: meta.placedFamilies,
          audit: {
            ok: meta.audit?.ok,
            severeOverlapCount: meta.audit?.severeOverlapCount ?? 0,
            meanBondLengthDeviation: meta.audit?.meanBondLengthDeviation ?? 0
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
