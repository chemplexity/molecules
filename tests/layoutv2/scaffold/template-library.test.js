import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getTemplateById, listTemplates } from '../../../src/layoutv2/scaffold/template-library.js';

describe('layoutv2/scaffold/template-library', () => {
  it('re-exports the deterministic template catalog', () => {
    assert.ok(listTemplates().length >= 3);
    assert.equal(getTemplateById('benzene')?.id, 'benzene');
  });
});
