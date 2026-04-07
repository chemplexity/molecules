import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { VALENCE_WARNING_FILL, createRuntimeState } from '../../../src/app/bootstrap/runtime-state.js';

describe('runtime-state bootstrap helpers', () => {
  it('initializes the shared runtime defaults', () => {
    const runtimeState = createRuntimeState({
      getRenderOptions: () => ({ twoDAtomFontSize: 18, showValenceWarnings: true }),
      validateValence: () => []
    });

    assert.equal(runtimeState.mode, '2d');
    assert.equal(runtimeState.fontSize, 18);
    assert.equal(runtimeState.currentMol, null);
    assert.equal(runtimeState.mol2d, null);
    assert.deepEqual([...runtimeState.selectedAtomIds], []);
    assert.deepEqual([...runtimeState.selectedBondIds], []);
    assert.equal(runtimeState.selectMode, false);
    assert.equal(runtimeState.drawBondElement, 'C');
    assert.equal(runtimeState.drawBondType, 'single');
    assert.equal(runtimeState.forceAutoFitEnabled, true);
    assert.deepEqual([...runtimeState.activeValenceWarningMap.entries()], []);
    assert.equal(VALENCE_WARNING_FILL, 'rgba(214, 48, 49, 0.3)');
  });

  it('builds valence warnings only when enabled and can clear them', () => {
    let showValenceWarnings = true;
    const runtimeState = createRuntimeState({
      getRenderOptions: () => ({ twoDAtomFontSize: 16, showValenceWarnings }),
      validateValence: () => [
        { atomId: 2, message: 'too many bonds' },
        { atomId: 5, message: 'bad valence' }
      ]
    });

    const warnings = runtimeState.valenceWarningMapFor({ id: 'mol' });
    assert.equal(warnings.get(2).message, 'too many bonds');
    assert.equal(warnings.get(5).message, 'bad valence');

    showValenceWarnings = false;
    assert.deepEqual([...runtimeState.valenceWarningMapFor({ id: 'mol' }).entries()], []);

    runtimeState.activeValenceWarningMap = warnings;
    runtimeState.selectionValenceTooltipAtomId = 2;
    runtimeState.resetValenceWarnings();
    assert.deepEqual([...runtimeState.activeValenceWarningMap.entries()], []);
    assert.equal(runtimeState.selectionValenceTooltipAtomId, null);
  });
});
