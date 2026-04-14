import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clearBondEnPanel, getBondEnActive, initBondEnPanel, updateBondEnPanel } from '../../../src/app/render/bond-en-overlay.js';
import { clearBondLengthsPanel, getBondLengthsActive, initBondLengthsPanel, updateBondLengthsPanel } from '../../../src/app/render/bond-lengths-overlay.js';

function makeMockElement(tagName = 'div') {
  let _textContent = '';
  let _innerHTML = '';
  const classes = new Set();
  const listeners = new Map();
  return {
    tagName,
    children: [],
    className: '',
    style: {},
    get textContent() {
      return _textContent;
    },
    set textContent(value) {
      _textContent = String(value);
    },
    get innerHTML() {
      return _innerHTML;
    },
    set innerHTML(value) {
      _innerHTML = String(value);
      this.children = [];
      _textContent = '';
    },
    classList: {
      add(...tokens) {
        for (const token of tokens) {
          classes.add(token);
        }
      },
      contains(token) {
        return classes.has(token);
      }
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    click() {
      listeners.get('click')?.({ stopPropagation() {} });
    }
  };
}

function collectText(node) {
  let text = node?.textContent ?? '';
  for (const child of node?.children ?? []) {
    text += collectText(child);
  }
  return text;
}

describe('bond overlay panel toggles', () => {
  it('turning on bond lengths turns off bond electronegativity and refreshes both rows', () => {
    const previousDocument = globalThis.document;
    const bondEnBody = makeMockElement('tbody');
    const bondLengthsBody = makeMockElement('tbody');
    globalThis.document = {
      getElementById(id) {
        if (id === 'bond-en-body') {
          return bondEnBody;
        }
        if (id === 'bond-lengths-body') {
          return bondLengthsBody;
        }
        return null;
      },
      createElement(tagName) {
        return makeMockElement(tagName);
      }
    };

    try {
      clearBondEnPanel();
      clearBondLengthsPanel();
      initBondEnPanel({ mode: '2d', currentMol: null, _mol2d: {}, draw2d() {}, updateForce() {} });
      initBondLengthsPanel({ mode: '2d', currentMol: null, _mol2d: {}, draw2d() {}, updateForce() {} });

      updateBondEnPanel({});
      updateBondLengthsPanel({});

      bondEnBody.children[0].click();
      assert.equal(getBondEnActive(), true);
      assert.equal(getBondLengthsActive(), false);

      bondLengthsBody.children[0].click();

      assert.equal(getBondLengthsActive(), true);
      assert.equal(getBondEnActive(), false);
      assert.match(collectText(bondLengthsBody.children[0]), /On/);
      assert.match(collectText(bondEnBody.children[0]), /Off/);
    } finally {
      clearBondEnPanel();
      clearBondLengthsPanel();
      globalThis.document = previousDocument;
    }
  });

  it('turning on bond electronegativity turns off bond lengths while allowing both to be off', () => {
    const previousDocument = globalThis.document;
    const bondEnBody = makeMockElement('tbody');
    const bondLengthsBody = makeMockElement('tbody');
    globalThis.document = {
      getElementById(id) {
        if (id === 'bond-en-body') {
          return bondEnBody;
        }
        if (id === 'bond-lengths-body') {
          return bondLengthsBody;
        }
        return null;
      },
      createElement(tagName) {
        return makeMockElement(tagName);
      }
    };

    try {
      clearBondEnPanel();
      clearBondLengthsPanel();
      initBondEnPanel({ mode: '2d', currentMol: null, _mol2d: {}, draw2d() {}, updateForce() {} });
      initBondLengthsPanel({ mode: '2d', currentMol: null, _mol2d: {}, draw2d() {}, updateForce() {} });

      updateBondEnPanel({});
      updateBondLengthsPanel({});

      bondLengthsBody.children[0].click();
      assert.equal(getBondLengthsActive(), true);
      assert.equal(getBondEnActive(), false);

      bondEnBody.children[0].click();

      assert.equal(getBondEnActive(), true);
      assert.equal(getBondLengthsActive(), false);
      assert.match(collectText(bondEnBody.children[0]), /On/);
      assert.match(collectText(bondLengthsBody.children[0]), /Off/);

      bondEnBody.children[0].click();

      assert.equal(getBondEnActive(), false);
      assert.equal(getBondLengthsActive(), false);
      assert.match(collectText(bondEnBody.children[0]), /Off/);
      assert.match(collectText(bondLengthsBody.children[0]), /Off/);
    } finally {
      clearBondEnPanel();
      clearBondLengthsPanel();
      globalThis.document = previousDocument;
    }
  });
});
