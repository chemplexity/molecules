#!/usr/bin/env node

import { parseSMILES } from '../../src/io/smiles.js';
import { runPipeline } from '../../src/layout/engine/pipeline.js';
import { AUDIT_CORPUS } from '../../tests/layout/engine/support/audit-corpus.js';
import { PLAN_CORPUS } from '../../tests/layout/engine/support/plan-corpus.js';

const CORPORA = Object.freeze({
  audit: AUDIT_CORPUS.map(entry => ({
    name: entry.name,
    smiles: entry.smiles
  })),
  plan: PLAN_CORPUS
});

/**
 * Formats one floating-point value for terminal summaries.
 * @param {number} value - Numeric value.
 * @returns {string} Rounded string.
 */
function formatMs(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/**
 * Writes one line to stdout.
 * @param {string} line - Line to print.
 */
function writeLine(line) {
  process.stdout.write(`${line}\n`);
}

/**
 * Builds an ordered list of corpus names from CLI arguments.
 * @param {string[]} args - CLI arguments after the script path.
 * @returns {Array<'audit'|'plan'>} Selected corpora.
 */
function selectCorpora(args) {
  if (args.length === 0 || args.includes('all')) {
    return ['audit', 'plan'];
  }
  const selected = args.filter(name => Object.hasOwn(CORPORA, name));
  if (selected.length === 0) {
    throw new Error(`Unknown corpus selection: ${args.join(', ')}. Use audit, plan, or all.`);
  }
  return [...new Set(selected)];
}

/**
 * Returns a mutable stage accumulator.
 * @param {string} stageName - Stage name.
 * @param {object} stage - Cleanup telemetry stage entry.
 * @returns {{stageName: string, targetStage: string|null, category: string|null, ran: number, materialized: number, returnedNull: number, won: number, elapsedMs: number}} Stage accumulator.
 */
function createStageAccumulator(stageName, stage) {
  return {
    stageName,
    targetStage: stage.targetStage ?? null,
    category: stage.category ?? null,
    ran: 0,
    materialized: 0,
    returnedNull: 0,
    won: 0,
    elapsedMs: 0,
    maxElapsedMs: 0,
    maxElapsedEntryName: null
  };
}

function topStageTimings(cleanupTelemetry, limit = 3) {
  return Object.entries(cleanupTelemetry.stages ?? {})
    .filter(([, stage]) => stage.ran === true && Number.isFinite(stage.elapsedMs) && stage.elapsedMs > 0)
    .sort((left, right) => (right[1].elapsedMs ?? 0) - (left[1].elapsedMs ?? 0))
    .slice(0, limit)
    .map(([stageName, stage]) => `${stageName} ${formatMs(stage.elapsedMs ?? 0)}ms`);
}

/**
 * Captures telemetry for one corpus and returns aggregate metrics.
 * @param {'audit'|'plan'} corpusName - Corpus selector.
 * @returns {{corpusName: string, size: number, timing: object, counts: object, stages: object[]}} Aggregate summary.
 */
function summarizeCorpus(corpusName) {
  const corpus = CORPORA[corpusName] ?? [];
  const stageAccumulators = new Map();
  const timing = {
    totalMs: 0,
    placementMs: 0,
    cleanupMs: 0,
    labelClearanceMs: 0,
    stereoMs: 0,
    auditMs: 0
  };
  const counts = {
    stabilizationRequests: 0,
    presentationFallbackEscalations: 0
  };
  const entries = [];

  for (const entry of corpus) {
    const result = runPipeline(parseSMILES(entry.smiles), {
      suppressH: true,
      timing: true,
      auditTelemetry: true
    });
    const resultTiming = result.metadata.timing ?? {};
    const cleanupTelemetry = result.metadata.cleanupTelemetry ?? {};

    timing.totalMs += resultTiming.totalMs ?? 0;
    timing.placementMs += resultTiming.placementMs ?? 0;
    timing.cleanupMs += resultTiming.cleanupMs ?? 0;
    timing.labelClearanceMs += resultTiming.labelClearanceMs ?? 0;
    timing.stereoMs += resultTiming.stereoMs ?? 0;
    timing.auditMs += resultTiming.auditMs ?? 0;
    counts.stabilizationRequests += cleanupTelemetry.counts?.stabilizationRequestCount ?? 0;
    counts.presentationFallbackEscalations += cleanupTelemetry.counts?.presentationFallbackEscalationCount ?? 0;
    entries.push({
      name: entry.name,
      totalMs: resultTiming.totalMs ?? 0,
      placementMs: resultTiming.placementMs ?? 0,
      cleanupMs: resultTiming.cleanupMs ?? 0,
      selectedStage: cleanupTelemetry.selectedStage ?? null,
      topStages: topStageTimings(cleanupTelemetry)
    });

    for (const [stageName, stage] of Object.entries(cleanupTelemetry.stages ?? {})) {
      const accumulator = stageAccumulators.get(stageName) ?? createStageAccumulator(stageName, stage);
      accumulator.ran += stage.ran ? 1 : 0;
      accumulator.materialized += stage.materialized ? 1 : 0;
      accumulator.returnedNull += stage.returnedNull ? 1 : 0;
      accumulator.won += stage.won ? 1 : 0;
      accumulator.elapsedMs += stage.elapsedMs ?? 0;
      if ((stage.elapsedMs ?? 0) > accumulator.maxElapsedMs) {
        accumulator.maxElapsedMs = stage.elapsedMs ?? 0;
        accumulator.maxElapsedEntryName = entry.name;
      }
      stageAccumulators.set(stageName, accumulator);
    }
  }

  return {
    corpusName,
    size: corpus.length,
    timing: Object.fromEntries(
      Object.entries(timing).map(([key, value]) => [key, corpus.length > 0 ? value / corpus.length : 0])
    ),
    counts,
    stages: [...stageAccumulators.values()].sort((left, right) => right.elapsedMs - left.elapsedMs),
    slowestEntries: entries.sort((left, right) => right.totalMs - left.totalMs).slice(0, 5)
  };
}

/**
 * Writes one corpus summary to stdout.
 * @param {{corpusName: string, size: number, timing: object, counts: object, stages: object[]}} summary - Aggregate summary.
 */
function printSummary(summary) {
  writeLine(`${summary.corpusName} corpus (${summary.size} molecules)`);
  writeLine(
    `  avg timing: total ${formatMs(summary.timing.totalMs)} ms | placement ${formatMs(summary.timing.placementMs)} ms | cleanup ${formatMs(summary.timing.cleanupMs)} ms | label ${formatMs(summary.timing.labelClearanceMs)} ms | stereo ${formatMs(summary.timing.stereoMs)} ms | audit ${formatMs(summary.timing.auditMs)} ms`
  );
  writeLine(
    `  fallback counts: stabilization ${summary.counts.stabilizationRequests} | presentation ${summary.counts.presentationFallbackEscalations}`
  );
  writeLine('  stages:');
  for (const stage of summary.stages) {
    const averageStageMs = summary.size > 0 ? stage.elapsedMs / summary.size : 0;
    writeLine(
      `    ${stage.stageName} -> ${stage.targetStage ?? 'n/a'} [${stage.category ?? 'uncategorized'}]: ran ${stage.ran}, materialized ${stage.materialized}, returnedNull ${stage.returnedNull}, won ${stage.won}, avg ${formatMs(averageStageMs)} ms, max ${formatMs(stage.maxElapsedMs)} ms${stage.maxElapsedEntryName ? ` (${stage.maxElapsedEntryName})` : ''}`
    );
  }
  writeLine('  slowest molecules:');
  for (const entry of summary.slowestEntries ?? []) {
    writeLine(
      `    ${entry.name}: total ${formatMs(entry.totalMs)} ms | placement ${formatMs(entry.placementMs)} ms | cleanup ${formatMs(entry.cleanupMs)} ms | selected ${entry.selectedStage ?? 'n/a'} | top stages ${entry.topStages.join(', ') || 'n/a'}`
    );
  }
}

const selectedCorpora = selectCorpora(process.argv.slice(2));
for (const corpusName of selectedCorpora) {
  printSummary(summarizeCorpus(corpusName));
}
