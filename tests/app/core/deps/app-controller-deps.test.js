import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAppControllerDeps } from '../../../../src/app/core/deps/app-controller-deps.js';

describe('createAppControllerDeps', () => {
  it('groups the app-controller dependency bridges without changing behavior', () => {
    const records = [];
    const deps = createAppControllerDeps({
      state: { id: 'state' },
      renderers: { id: 'renderers' },
      history: {
        takeSnapshot: options => records.push(['takeSnapshot', options]),
        captureSnapshot: options => ({ captured: options })
      },
      panels: { id: 'panels' },
      analysis: {
        syncInputField: mol => records.push(['syncInputField', mol]),
        updateFormula: mol => records.push(['updateFormula', mol]),
        updateDescriptors: mol => records.push(['updateDescriptors', mol]),
        updatePanels: mol => records.push(['updatePanels', mol])
      },
      dom: { plotEl: { id: 'plot' } },
      overlays: {
        hasReactionPreview: () => true,
        prepareReactionPreviewBondEditTarget: id => ({ bondId: id }),
        prepareReactionPreviewEditTargets: payload => ({ payload }),
        prepareResonanceStructuralEdit: mol => ({ mol })
      },
      snapshot: {
        capture: options => ({ snapshot: options }),
        restore: snap => records.push(['restore', snap])
      },
      navigation: { id: 'navigation' }
    });

    assert.equal(deps.state.id, 'state');
    assert.equal(deps.renderers.id, 'renderers');
    assert.equal(deps.panels.id, 'panels');
    assert.equal(deps.dom.plotEl.id, 'plot');
    assert.equal(deps.overlays.hasReactionPreview(), true);
    assert.deepEqual(deps.overlays.prepareReactionPreviewBondEditTarget('b1'), { bondId: 'b1' });
    assert.deepEqual(deps.history.captureSnapshot({ foo: 'bar' }), { captured: { foo: 'bar' } });
    assert.deepEqual(deps.snapshot.capture({ baz: 'qux' }), { snapshot: { baz: 'qux' } });

    deps.analysis.syncInputField('mol');
    deps.snapshot.restore('snap');

    assert.deepEqual(records, [
      ['syncInputField', 'mol'],
      ['restore', 'snap']
    ]);
  });
});
