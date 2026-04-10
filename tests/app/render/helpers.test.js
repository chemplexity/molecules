import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDefaultRenderOptions,
  getRenderOptions,
  updateRenderOptions
} from '../../../src/app/render/helpers.js';

afterEach(() => {
  updateRenderOptions(getDefaultRenderOptions());
});

describe('app/render/helpers', () => {
  it('defaults the 2d renderer version to v2', () => {
    assert.equal(getDefaultRenderOptions().twoDRendererVersion, 'v2');
    assert.equal(getRenderOptions().twoDRendererVersion, 'v2');
  });

  it('accepts only supported 2d renderer versions', () => {
    assert.equal(updateRenderOptions({ twoDRendererVersion: 'v2' }).twoDRendererVersion, 'v2');
    assert.equal(updateRenderOptions({ twoDRendererVersion: 'invalid' }).twoDRendererVersion, 'v2');
    assert.equal(updateRenderOptions({ twoDRendererVersion: 'v1' }).twoDRendererVersion, 'v1');
  });
});
