import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listTemplates } from '../../../src/layoutv2/templates/library.js';
import { validateTemplateGeometry } from '../../../src/layoutv2/templates/validation.js';

describe('layoutv2/templates/validation', () => {
  it('validates coverage and geometry quality for every active template', () => {
    for (const template of listTemplates()) {
      const result = validateTemplateGeometry(template, 1.5);
      assert.equal(
        result.ok,
        true,
        `${template.id} failed geometry validation: ${JSON.stringify({
          summary: {
            severeOverlapCount: result.summary.severeOverlapCount,
            minBondLength: Number.isFinite(result.summary.minBondLength) ? Number(result.summary.minBondLength.toFixed(4)) : result.summary.minBondLength,
            maxBondLength: Number.isFinite(result.summary.maxBondLength) ? Number(result.summary.maxBondLength.toFixed(4)) : result.summary.maxBondLength,
            meanBondLengthDeviation: Number.isFinite(result.summary.meanBondLengthDeviation)
              ? Number(result.summary.meanBondLengthDeviation.toFixed(4))
              : result.summary.meanBondLengthDeviation
          },
          checks: result.checks
        })}`
      );
    }
  });
});
