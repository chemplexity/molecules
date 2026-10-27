// Diagnostic snapshots for layout-engine-review.md, reviewed at b7ad456.
// These assertions document CURRENT defects, not the desired behavior.
// Run from any directory: node docs/reviews/layout-engine-repros.mjs
// After fixing a defect, replace its snapshot with a regression test asserting
// the intended contract. No production source files or input files are changed.
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { parseSMILES } from '../../src/io/smiles.js';
import { generateCoords, refineCoords } from '../../src/layout/engine/api.js';
import { applyCoords } from '../../src/layout/engine/apply.js';
import { runPipeline } from '../../src/layout/engine/pipeline.js';
import { createLayoutGraph } from '../../src/layout/engine/model/layout-graph.js';
import { auditLayout, auditCandidateSafety } from '../../src/layout/engine/audit/audit.js';
import { enforceAcyclicEZStereo } from '../../src/layout/engine/stereo/enforcement.js';
import { generateCoords as publicGenerateCoords } from '../../src/layout/public-api.js';

function chain(n) {
  const molecule = new Molecule();
  for (let i = 0; i < n; i++) molecule.addAtom(`a${i}`, 'C');
  for (let i = 0; i < n - 1; i++) molecule.addBond(`b${i}`, `a${i}`, `a${i + 1}`, {}, false);
  return molecule;
}

function record(id, observed) {
  console.log(JSON.stringify({ id, observed }));
}

const existing = new Map([
  ['a0', { x: 0, y: 0 }],
  ['a1', { x: 1.5, y: 0 }]
]);
const target = { x: 10, y: 10 };
const refined = refineCoords(chain(2), {
  existingCoords: existing,
  fixedCoords: new Map([['a0', target]]),
  touchedAtoms: new Set(['a1'])
});
assert.deepEqual(refined.coords.get('a0'), existing.get('a0'));
assert.equal(refined.metadata.audit.ok, true);
record('F1-existing-overrides-fixed', { requested: target, actual: refined.coords.get('a0'), auditOk: refined.metadata.audit.ok });

const ring = chain(6);
ring.addBond('closure', 'a5', 'a0', {}, false);
const ringSeed = generateCoords(ring);
const ringRefined = refineCoords(ring, { existingCoords: ringSeed.coords, fixedCoords: new Map([['a0', target]]) });
assert.deepEqual(ringRefined.coords.get('a0'), ringSeed.coords.get('a0'));
assert.equal(ringRefined.metadata.preservedComponentCount, 1);
record('F1-preserved-ring-ignores-fixed', { requested: target, actual: ringRefined.coords.get('a0') });

const threeFixed = new Map([
  ['a0', { x: 0, y: 0 }],
  ['a1', { x: 1.5, y: 0 }],
  ['a2', { x: 1.5, y: 1.5 }]
]);
const threeResult = generateCoords(chain(3), { fixedCoords: threeFixed });
assert.ok(Math.hypot(threeResult.coords.get('a1').x - 1.5, threeResult.coords.get('a1').y) > 0.4);
record('F1-three-anchors-approximate', { requested: threeFixed.get('a1'), actual: threeResult.coords.get('a1') });

const stereoMolecule = parseSMILES('F/C=C/F');
const stereoFixed = new Map([
  ['F1', { x: -0.75, y: 1.299038105676658 }],
  ['C2', { x: 0, y: 0 }],
  ['C3', { x: 1.5, y: 0 }],
  ['F4', { x: 2.25, y: 1.299038105676658 }]
]);
const stereoGraph = createLayoutGraph(stereoMolecule, { suppressH: true, fixedCoords: stereoFixed });
const enforced = enforceAcyclicEZStereo(stereoGraph, stereoFixed);
assert.equal(enforced.reflections, 1);
assert.notDeepEqual(enforced.coords.get('F1'), stereoFixed.get('F1'));
record('F1-stereo-helper-moves-fixed', { before: stereoFixed.get('F1'), after: enforced.coords.get('F1') });

const ethaneGraph = createLayoutGraph(chain(2));
for (const [validationClass, ratio] of [
  ['bridged', 0.65],
  ['haptic', 0]
]) {
  const coords = new Map([
    ['a0', { x: 0, y: 0 }],
    ['a1', { x: 1.5 * ratio, y: 0 }]
  ]);
  const audit = auditLayout(ethaneGraph, coords, { bondValidationClasses: new Map([['b0', validationClass]]) });
  assert.equal(audit.bondLengthFailureCount, 0);
  assert.equal(audit.ok, true);
  record('F2-bond-minimum', { validationClass, ratio, auditOk: audit.ok });
}

const crossingMolecule = chain(2);
crossingMolecule.addAtom('c0', 'C');
crossingMolecule.addAtom('c1', 'C');
crossingMolecule.addBond('d0', 'c0', 'c1', {}, false);
const crossingCoords = new Map([
  ['a0', { x: -0.75, y: 0 }],
  ['a1', { x: 0.75, y: 0 }],
  ['c0', { x: 0, y: -0.75 }],
  ['c1', { x: 0, y: 0.75 }]
]);
const crossingGraph = createLayoutGraph(crossingMolecule);
const full = auditLayout(crossingGraph, crossingCoords);
const fast = auditCandidateSafety(crossingGraph, crossingCoords);
assert.equal(full.visibleHeavyBondCrossingFailureCount, 1);
assert.equal(full.ok, false);
assert.equal(fast.ok, true);
record('F4-candidate-final-disagreement', { finalOk: full.ok, candidateOk: fast.ok, crossingFailures: full.visibleHeavyBondCrossingFailureCount });

const radius = 1.5 / (2 * Math.sin(Math.PI / 8));
for (let i = 0; i < 8; i++) {
  crossingMolecule.addAtom(`r${i}`, 'C');
  crossingCoords.set(`r${i}`, { x: 20 + radius * Math.cos((i * Math.PI) / 4), y: radius * Math.sin((i * Math.PI) / 4) });
}
for (let i = 0; i < 8; i++) crossingMolecule.addBond(`rb${i}`, `r${i}`, `r${(i + 1) % 8}`, {}, false);
const withMacrocycle = auditLayout(createLayoutGraph(crossingMolecule), crossingCoords);
assert.equal(withMacrocycle.visibleHeavyBondCrossingCount, 1);
assert.equal(withMacrocycle.visibleHeavyBondCrossingFailureCount, 0);
assert.equal(withMacrocycle.ok, true);
record('F3-unrelated-macrocycle-exemption', {
  crossingCount: withMacrocycle.visibleHeavyBondCrossingCount,
  crossingFailures: withMacrocycle.visibleHeavyBondCrossingFailureCount,
  auditOk: withMacrocycle.ok
});

for (const [kind, coords] of [
  ['empty', new Map()],
  [
    'NaN',
    new Map([
      ['a0', { x: NaN, y: NaN }],
      ['a1', { x: NaN, y: NaN }]
    ])
  ]
]) {
  const audit = auditLayout(ethaneGraph, coords);
  assert.equal(audit.ok, true);
  record('F5-invalid-coordinates-pass', { kind, auditOk: audit.ok, bondLengthSampleCount: audit.bondLengthSampleCount, maxDeviationIsFinite: Number.isFinite(audit.maxBondLengthDeviation) });
}

// Simulates budget exhaustion without delaying execution. Both runs have the
// same graph/options; only the cleanup clock changes. Always restore the clock.
function withClock(step, fn) {
  const original = Object.getOwnPropertyDescriptor(performance, 'now');
  let ticks = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => (ticks += step) });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(performance, 'now', original);
    else delete performance.now;
  }
}
const budgetSmiles = '[O-][V](=O)[O+]([V](=O)O[V](=O)(=O)O[V](=O)(=O)[O+]([V]([O-])=O)[V](=O)(=O)=O)[V](=O)(=O)=O';
const budgetRun = () => runPipeline(parseSMILES(budgetSmiles), { suppressH: true, timing: true, auditTelemetry: true });
const unexpired = withClock(0, budgetRun);
const expired = withClock(100000, budgetRun);
let maxDelta = 0;
for (const [id, p] of unexpired.coords) {
  const q = expired.coords.get(id);
  maxDelta = Math.max(maxDelta, Math.hypot(p.x - q.x, p.y - q.y));
}
assert.ok(maxDelta > 0.4);
record('F6-clock-dependent-layout', {
  maxDelta,
  unexpiredOk: unexpired.metadata.audit.ok,
  expiredOk: expired.metadata.audit.ok,
  skippedStages: expired.metadata.timing.cleanupStageBudget.skippedStages
});

for (const [kind, options] of [
  ['default', {}],
  ['explicit', { suppressH: true }]
]) {
  const molecule = parseSMILES('[Fe][H]');
  molecule.atoms.get('H2').visible = false;
  const result = generateCoords(molecule, options);
  assert.equal(result.coords.has('H2'), kind === 'explicit');
  assert.equal(molecule.atoms.get('H2').visible, kind === 'explicit');
  record('F7-hydride-default-and-input-mutation', { kind, hydrogenPlaced: result.coords.has('H2'), inputHydrogenVisible: molecule.atoms.get('H2').visible });
}

const toggleMolecule = parseSMILES('CC');
publicGenerateCoords(toggleMolecule, { suppressH: true });
const toggleCoords = publicGenerateCoords(toggleMolecule, { suppressH: false });
const hydrogens = [...toggleMolecule.atoms.values()].filter(a => a.name === 'H');
assert.equal(hydrogens.length, 6);
assert.equal(hydrogens.filter(a => a.visible).length, 0);
assert.equal(toggleCoords.size, 8);
record('F8-hydrogen-display-toggle', { hydrogenCount: hydrogens.length, visibleHydrogens: hydrogens.filter(a => a.visible).length, placedAtoms: toggleCoords.size });

const applied = applyCoords(toggleMolecule, toggleCoords);
assert.equal(applied.appliedAtomCount, 14);
record('F10-double-counted-hidden-hydrogens', { atomCount: toggleMolecule.atoms.size, appliedAtomCount: applied.appliedAtomCount });
