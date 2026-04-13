/**
 * layoutv2 performance benchmarks.
 *
 * Expected median targets with `suppressH: true`:
 * - 50-atom linear chain: < 5ms
 * - 100-atom branched chain: < 15ms
 * - 200-atom branched chain: < 50ms
 * - Cholesterol: < 20ms
 * - Erythromycin: < 30ms
 *
 * Run normally for an informational report:
 *   npm run bench:layout
 *
 * Enforce the targets by setting:
 *   PERF_ASSERT=1 npm run bench:layout
 */

import { performance } from 'node:perf_hooks';

import { Molecule } from '../src/core/index.js';
import { parseSMILES } from '../src/io/smiles.js';
import { generateCoords } from '../src/layoutv2/api.js';

const BENCHMARK_RUNS = 5;
const ASSERT_TARGETS = process.env.PERF_ASSERT === '1';
const SHOW_BREAKDOWN = process.argv.includes('--breakdown');

/**
 * Creates a linear alkane-like chain molecule.
 * @param {number} atomCount - Number of carbon atoms.
 * @returns {Molecule} Linear chain molecule.
 */
function makeLinearChain(atomCount) {
  const molecule = new Molecule();
  for (let index = 0; index < atomCount; index++) {
    molecule.addAtom(`a${index}`, 'C');
    if (index > 0) {
      molecule.addBond(`b${index - 1}`, `a${index - 1}`, `a${index}`, {}, false);
    }
  }
  return molecule;
}

/**
 * Creates a deterministic branched alkane-like molecule with the requested atom count.
 * @param {number} atomCount - Total atom count.
 * @returns {Molecule} Branched chain molecule.
 */
function makeBranchedChain(atomCount) {
  const trunkLength = Math.max(2, Math.ceil(atomCount * 0.55));
  const molecule = makeLinearChain(Math.min(trunkLength, atomCount));
  let nextAtomIndex = trunkLength;
  let nextBondIndex = trunkLength - 1;
  let branchSite = 1;

  while (nextAtomIndex < atomCount) {
    const anchorAtomId = `a${branchSite}`;
    const branchLength = nextAtomIndex + 1 < atomCount && branchSite % 3 === 0 ? 2 : 1;
    let previousAtomId = anchorAtomId;

    for (let branchIndex = 0; branchIndex < branchLength && nextAtomIndex < atomCount; branchIndex++) {
      const atomId = `a${nextAtomIndex}`;
      molecule.addAtom(atomId, 'C');
      molecule.addBond(`b${nextBondIndex}`, previousAtomId, atomId, {}, false);
      previousAtomId = atomId;
      nextAtomIndex++;
      nextBondIndex++;
    }

    branchSite++;
    if (branchSite >= trunkLength - 1) {
      branchSite = 1;
    }
  }

  return molecule;
}

/**
 * Returns the median benchmark duration after discarding the fastest and slowest runs.
 * @param {number[]} timings - Raw run durations in milliseconds.
 * @returns {number} Filtered median timing.
 */
function trimmedMedian(timings) {
  const sorted = [...timings].sort((firstValue, secondValue) => firstValue - secondValue);
  const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  return trimmed[Math.floor(trimmed.length / 2)];
}

/**
 * Returns the median timing object after discarding the fastest and slowest total runs.
 * @param {Array<{totalMs: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}>} timingRuns - Raw timing runs.
 * @returns {{totalMs: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null} Trimmed-median timing object.
 */
function trimmedMedianTiming(timingRuns) {
  if (timingRuns.length === 0) {
    return null;
  }
  const sorted = [...timingRuns].sort((firstRun, secondRun) => firstRun.totalMs - secondRun.totalMs);
  const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  const medianIndex = Math.floor(trimmed.length / 2);
  return trimmed[medianIndex] ?? null;
}

/**
 * Benchmarks one molecule factory by running layout several times.
 * @param {{name: string, targetMs: number, createMolecule: () => Molecule}} benchmark - Benchmark descriptor.
 * @returns {{name: string, targetMs: number, timings: number[], medianMs: number, passed: boolean, timingBreakdown: {totalMs: number, placementMs: number, cleanupMs: number, labelClearanceMs: number, stereoMs: number, auditMs: number}|null}} Benchmark result.
 */
function runBenchmark(benchmark) {
  const timings = [];
  const timingRuns = [];
  for (let runIndex = 0; runIndex < BENCHMARK_RUNS; runIndex++) {
    const molecule = benchmark.createMolecule();
    const startTime = performance.now();
    const result = generateCoords(molecule, { suppressH: true, timing: SHOW_BREAKDOWN });
    timings.push(performance.now() - startTime);
    if (SHOW_BREAKDOWN && result.metadata.timing) {
      timingRuns.push(result.metadata.timing);
    }
  }

  const medianMs = trimmedMedian(timings);
  return {
    name: benchmark.name,
    targetMs: benchmark.targetMs,
    timings,
    medianMs,
    passed: medianMs <= benchmark.targetMs,
    timingBreakdown: SHOW_BREAKDOWN ? trimmedMedianTiming(timingRuns) : null
  };
}

/**
 * Formats one benchmark result line for terminal output.
 * @param {{name: string, targetMs: number, timings: number[], medianMs: number, passed: boolean}} result - Benchmark result.
 * @returns {string} Human-readable result line.
 */
function formatBenchmarkResult(result) {
  const status = result.passed ? 'PASS' : 'FAIL';
  const timings = result.timings.map(value => value.toFixed(2)).join(', ');
  const breakdown = result.timingBreakdown
    ? `\n      breakdown placement=${result.timingBreakdown.placementMs.toFixed(2)} cleanup=${result.timingBreakdown.cleanupMs.toFixed(2)} label=${result.timingBreakdown.labelClearanceMs.toFixed(2)} stereo=${result.timingBreakdown.stereoMs.toFixed(2)} audit=${result.timingBreakdown.auditMs.toFixed(2)} total=${result.timingBreakdown.totalMs.toFixed(2)}`
    : '';
  return `${status}  ${result.name.padEnd(24)} median=${result.medianMs.toFixed(2)}ms  target<${result.targetMs}ms  runs=[${timings}]${breakdown}`;
}

const BENCHMARKS = Object.freeze([
  {
    name: '50-atom linear chain',
    targetMs: 5,
    createMolecule: () => makeLinearChain(50)
  },
  {
    name: '100-atom branched chain',
    targetMs: 15,
    createMolecule: () => makeBranchedChain(100)
  },
  {
    name: '200-atom branched chain',
    targetMs: 50,
    createMolecule: () => makeBranchedChain(200)
  },
  {
    name: 'Cholesterol',
    targetMs: 20,
    createMolecule: () => parseSMILES('C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C')
  },
  {
    name: 'Erythromycin',
    targetMs: 30,
    createMolecule: () => parseSMILES('CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O')
  },
  {
    name: 'Naphthalene',
    targetMs: 3,
    createMolecule: () => parseSMILES('c1ccc2ccccc2c1')
  },
  {
    name: 'Caffeine',
    targetMs: 5,
    createMolecule: () => parseSMILES('Cn1c(=O)c2c(ncn2C)n(C)c1=O')
  },
  {
    name: 'Ibuprofen',
    targetMs: 8,
    createMolecule: () => parseSMILES('CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O')
  }
]);

const results = BENCHMARKS.map(runBenchmark);
for (const result of results) {
  process.stdout.write(`${formatBenchmarkResult(result)}\n`);
}

const failingResults = results.filter(result => !result.passed);
if (ASSERT_TARGETS && failingResults.length > 0) {
  process.stderr.write(`\nPerformance assertions failed for ${failingResults.length} benchmark(s).\n`);
  process.exitCode = 1;
}
