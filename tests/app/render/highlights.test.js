import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/index.js';
import {
  _restorePersistentHighlight,
  _setHighlight,
  clearHighlightState,
  getHighlightedAtomIds,
  hasPersistentHighlightFallback,
  initHighlights,
  setPersistentHighlightFallback,
  updateFunctionalGroups
} from '../../../src/app/render/highlights.js';

function makeMockElement(tagName = 'div') {
  let _innerHTML = '';
  let _textContent = '';
  const listeners = new Map();
  const classes = new Set();
  return {
    tagName,
    children: [],
    dataset: {},
    cells: [],
    isConnected: true,
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
      this.cells = [];
      _textContent = '';
    },
    classList: {
      add(...tokens) {
        for (const token of tokens) {
          classes.add(token);
        }
      },
      remove(...tokens) {
        for (const token of tokens) {
          classes.delete(token);
        }
      },
      contains(token) {
        return classes.has(token);
      }
    },
    appendChild(child) {
      this.children.push(child);
      if (this.tagName === 'tr' && child.tagName === 'td') {
        this.cells.push(child);
      }
      return child;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      const handler = listeners.get(type);
      if (handler) {
        handler(event);
      }
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const results = [];
      const walk = node => {
        for (const child of node.children ?? []) {
          if (selector === 'tr.fg-active' && child.tagName === 'tr' && child.classList.contains('fg-active')) {
            results.push(child);
          }
          walk(child);
        }
      };
      walk(this);
      return results;
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

test('persistent highlight fallbacks are composable and prefer the most recent active lock', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector() {
      return null;
    }
  };

  const calls = [];
  try {
    setPersistentHighlightFallback(null, { key: 'reaction-preview' });
    setPersistentHighlightFallback(null, { key: 'physchem' });

    setPersistentHighlightFallback(
      () => {
        calls.push('reaction');
        return true;
      },
      { key: 'reaction-preview', isActive: () => true }
    );

    assert.equal(hasPersistentHighlightFallback(), true);
    assert.equal(_restorePersistentHighlight(), true);
    assert.deepEqual(calls, ['reaction']);

    calls.length = 0;
    setPersistentHighlightFallback(
      () => {
        calls.push('physchem');
        return true;
      },
      { key: 'physchem', isActive: () => true }
    );

    assert.equal(hasPersistentHighlightFallback(), true);
    assert.equal(_restorePersistentHighlight(), true);
    assert.deepEqual(calls, ['physchem']);
  } finally {
    setPersistentHighlightFallback(null, { key: 'reaction-preview' });
    setPersistentHighlightFallback(null, { key: 'physchem' });
    globalThis.document = previousDocument;
  }
});

test('functional-group hover temporarily overrides a locked physchem highlight and restores it on leave', () => {
  const previousDocument = globalThis.document;
  const fgBody = makeMockElement('tbody');
  globalThis.document = {
    getElementById(id) {
      return id === 'fg-body' ? fgBody : null;
    },
    querySelector() {
      return null;
    },
    createElement(tagName) {
      return makeMockElement(tagName);
    }
  };

  initHighlights({
    applyForceHighlights() {}
  });

  try {
    const mol = parseSMILES('CCO');
    updateFunctionalGroups(mol);

    setPersistentHighlightFallback(
      () => {
        _setHighlight([new Map([[1, 1]])], { style: 'physchem' });
        return true;
      },
      { key: 'physchem', isActive: () => true }
    );

    assert.equal(_restorePersistentHighlight(), true);
    assert.deepEqual([...getHighlightedAtomIds()], [1]);

    const alcoholRow = fgBody.children.find(child => collectText(child).includes('Alcohol'));
    assert.ok(alcoholRow);

    alcoholRow.dispatch('mouseenter');
    assert.notDeepEqual([...getHighlightedAtomIds()], [1]);
    assert.ok(getHighlightedAtomIds().size > 1);

    alcoholRow.dispatch('mouseleave');
    assert.deepEqual([...getHighlightedAtomIds()], [1]);
  } finally {
    setPersistentHighlightFallback(null, { key: 'physchem' });
    clearHighlightState();
    globalThis.document = previousDocument;
  }
});
