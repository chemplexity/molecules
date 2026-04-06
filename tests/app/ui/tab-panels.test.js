import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initTabPanels } from '../../../src/app/ui/tab-panels.js';

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    has(value) {
      return values.has(value);
    }
  };
}

function makeButton(tab, active = false) {
  let clickHandler = null;
  return {
    dataset: { tab },
    classList: makeClassList(active ? ['active'] : []),
    addEventListener(type, handler) {
      if (type === 'click') {
        clickHandler = handler;
      }
    },
    click() {
      clickHandler?.();
    }
  };
}

function makePanel(id, visible = false) {
  return {
    id,
    style: { display: visible ? '' : 'none' }
  };
}

describe('initTabPanels', () => {
  it('switches descriptor and SMARTS tabs independently', () => {
    const descTop = makeButton('topological', true);
    const descPhys = makeButton('physicochemical');
    const descTopPanel = makePanel('tab-topological', true);
    const descPhysPanel = makePanel('tab-physicochemical');

    const smartsFg = makeButton('functional-groups', true);
    const smartsRxn = makeButton('reactions');
    const smartsOther = makeButton('other');
    const fgPanel = makePanel('tab-functional-groups', true);
    const rxnPanel = makePanel('tab-reactions');
    const otherPanel = makePanel('tab-other');

    initTabPanels({
      doc: {
        querySelectorAll(selector) {
          if (selector === '.desc-tab') {
            return [descTop, descPhys];
          }
          if (selector === '.desc-tab-panel') {
            return [descTopPanel, descPhysPanel];
          }
          if (selector === '.smarts-tab') {
            return [smartsFg, smartsRxn, smartsOther];
          }
          if (selector === '.smarts-tab-panel') {
            return [fgPanel, rxnPanel, otherPanel];
          }
          return [];
        }
      }
    });

    descPhys.click();
    assert.equal(descTop.classList.has('active'), false);
    assert.equal(descPhys.classList.has('active'), true);
    assert.equal(descTopPanel.style.display, 'none');
    assert.equal(descPhysPanel.style.display, '');

    smartsOther.click();
    assert.equal(smartsFg.classList.has('active'), false);
    assert.equal(smartsOther.classList.has('active'), true);
    assert.equal(fgPanel.style.display, 'none');
    assert.equal(otherPanel.style.display, '');
  });
});
