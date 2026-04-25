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

  const delta = (key, fallback = 0) =>
    (candidateAudit[key] ?? fallback) - (incumbentAudit[key] ?? fallback);

  const fmt = (a, b) => `${a} → ${b}`;

  const dOverlaps = delta('severeOverlapCount');
  const dFail     = delta('bondLengthFailureCount');
  const dDev      = delta('meanBondLengthDeviation');
  const dRead     = delta('ringSubstituentReadabilityFailureCount');
  const dInward   = delta('inwardRingSubstituentCount');
  const dLabel    = delta('labelOverlapCount');

  const worse = [];
  const better = [];

  if (dOverlaps > 0) worse.push(`+${dOverlaps} overlap${dOverlaps !== 1 ? 's' : ''} (${fmt(incumbentAudit.severeOverlapCount ?? 0, candidateAudit.severeOverlapCount ?? 0)})`);
  else if (dOverlaps < 0) better.push(`overlaps ${fmt(incumbentAudit.severeOverlapCount ?? 0, candidateAudit.severeOverlapCount ?? 0)}`);

  if (dFail > 0) worse.push(`+${dFail} bond failure${dFail !== 1 ? 's' : ''} (${fmt(incumbentAudit.bondLengthFailureCount ?? 0, candidateAudit.bondLengthFailureCount ?? 0)})`);
  else if (dFail < 0) better.push(`bond fails ${fmt(incumbentAudit.bondLengthFailureCount ?? 0, candidateAudit.bondLengthFailureCount ?? 0)}`);

  if (dRead > 0) worse.push(`+${dRead} ring readability failure${dRead !== 1 ? 's' : ''} (${fmt(incumbentAudit.ringSubstituentReadabilityFailureCount ?? 0, candidateAudit.ringSubstituentReadabilityFailureCount ?? 0)})`);
  else if (dRead < 0) better.push(`ring readability ${fmt(incumbentAudit.ringSubstituentReadabilityFailureCount ?? 0, candidateAudit.ringSubstituentReadabilityFailureCount ?? 0)}`);

  if (dInward > 0) worse.push(`+${dInward} inward substituent${dInward !== 1 ? 's' : ''} (${fmt(incumbentAudit.inwardRingSubstituentCount ?? 0, candidateAudit.inwardRingSubstituentCount ?? 0)})`);
  else if (dInward < 0) better.push(`inward sub. ${fmt(incumbentAudit.inwardRingSubstituentCount ?? 0, candidateAudit.inwardRingSubstituentCount ?? 0)}`);

  if (dLabel > 0) worse.push(`+${dLabel} label overlap${dLabel !== 1 ? 's' : ''} (${fmt(incumbentAudit.labelOverlapCount ?? 0, candidateAudit.labelOverlapCount ?? 0)})`);
  else if (dLabel < 0) better.push(`label overlaps ${fmt(incumbentAudit.labelOverlapCount ?? 0, candidateAudit.labelOverlapCount ?? 0)}`);

  if (worse.length === 0) {
    if (dDev > 0.001) {
      worse.push(`bond deviation +${(dDev * 100).toFixed(1)}% (${(incumbentAudit.meanBondLengthDeviation * 100).toFixed(1)}% → ${(candidateAudit.meanBondLengthDeviation * 100).toFixed(1)}%)`);
    } else if (dDev < -0.001) {
      better.push(`bond deviation ${(incumbentAudit.meanBondLengthDeviation * 100).toFixed(1)}% → ${(candidateAudit.meanBondLengthDeviation * 100).toFixed(1)}%`);
    }
  }

  if (worse.length === 0 && better.length === 0) {
    return 'Layout cost did not improve (tie-break favoured incumbent).';
  }
  if (worse.length === 0) {
    return `Improved (${better.join(', ')}) but layout cost did not improve overall.`;
  }
  const msg = worse.join(' · ');
  return better.length > 0 ? `${msg}  (offset by: ${better.join(', ')})` : msg;
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
    let lastStepMs = performance.now();

    const result = runPipeline(mol, {
      suppressH: true,
      bondLength: 1.5,
      maxCleanupPasses: 6,
      finalLandscapeOrientation: true,
      debug: {
        onStep: (label, description, coords, stepMetadata) => {
          const now = performance.now();
          const stepTimeMs = now - lastStepMs;
          lastStepMs = now;
          snapshots.push({ label, description, coords: copyCoords(coords), prevCoords: prevCoords ? copyCoords(prevCoords) : null, stepMetadata, stepTimeMs });
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
      // For reverted steps, also render the incumbent (prevCoords) so the viewer can toggle.
      let incumbentSvg = null;
      let incumbentGhostData = null;
      if (!accepted && snap.prevCoords) {
        const incumbentRendered = renderStep(mol, snap.prevCoords, null);
        incumbentSvg = incumbentRendered?.svg ?? null;
        incumbentGhostData = incumbentRendered?.ghostData ?? null;
        // Restore mol to candidate coords so subsequent diffs are computed correctly.
        renderStep(mol, snap.coords, null);
      }
      // Strip internal fields (prefixed _) before sending to client.
      const stepMetadata = snap.stepMetadata
        ? Object.fromEntries(Object.entries(snap.stepMetadata).filter(([k]) => !k.startsWith('_')))
        : {};
      const meta = result.metadata;
      steps.push({
        label: snap.label,
        description: snap.description,
        stepTimeMs: snap.stepTimeMs,
        svg: rendered.svg,
        cellW: rendered.cellW,
        cellH: rendered.cellH,
        movedAtomCount: rendered.movedAtomCount,
        ghostData: rendered.ghostData ?? null,
        accepted,
        rejectReason,
        stepAudit,
        incumbentAudit: acceptance?.incumbentAudit ?? null,
        incumbentSvg,
        incumbentGhostData,
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
            meanBondLengthDeviation: meta.audit?.meanBondLengthDeviation ?? 0,
            fallback: meta.audit?.fallback ?? null
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
