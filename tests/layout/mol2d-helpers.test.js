import test from 'node:test';
import assert from 'node:assert/strict';

import { labelHalfH } from '../../src/layout/mol2d-helpers.js';

test('labelHalfH reserves extra descent for subscripted atom labels', () => {
  assert.ok(labelHalfH('NH2', 11) > labelHalfH('NH', 11));
  assert.ok(labelHalfH('CH3', 14) > labelHalfH('CH', 14));
});
