import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initPhyschemPanel } from '../../../src/app/ui/physchem-panel.js';

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    contains(value) {
      return values.has(value);
    }
  };
}

function makeCell(textContent, row) {
  return {
    textContent,
    closest(selector) {
      return selector === 'td' ? this : row.closest(selector);
    }
  };
}

function makeRow({ label, desc, highlight }) {
  const row = {
    dataset: { desc, highlight },
    classList: makeClassList(),
    isConnected: true,
    cells: [],
    closest(selector) {
      if (selector === 'tr[data-desc]' && desc) {
        return row;
      }
      if (selector === 'tr[data-highlight]' && highlight) {
        return row;
      }
      return null;
    }
  };
  row.cells = [makeCell(label, row), makeCell('value', row)];
  return row;
}

function makeTooltip() {
  const state = { opacity: '0', html: '', left: '', top: '' };
  return {
    state,
    html(value) {
      state.html = value;
      return this;
    },
    style(name, value) {
      if (value === undefined) {
        return state[name];
      }
      state[name] = String(value);
      return this;
    }
  };
}

describe('initPhyschemPanel', () => {
  it('locks, captures, restores, and clears physicochemical row highlights', () => {
    const row = makeRow({
      label: 'Molar Refractivity',
      desc: 'Tooltip text',
      highlight: JSON.stringify([['a1', 'a2']])
    });
    const rows = [row];
    const listeners = new Map();
    const calls = [];
    const tooltip = makeTooltip();

    const api = initPhyschemPanel({
      dom: {
        getTableElement: () => ({
          querySelectorAll(selector) {
            if (selector === 'tr[data-highlight]') {
              return rows;
            }
            if (selector === 'tr.pc-hover') {
              return rows.filter(candidate => candidate.classList.contains('pc-hover'));
            }
            return [];
          },
          addEventListener(type, handler) {
            listeners.set(type, handler);
          }
        })
      },
      tooltip,
      highlights: {
        setHighlight: (...args) => calls.push(['setHighlight', ...args]),
        restorePersistentHighlight: () => calls.push(['restorePersistentHighlight']),
        setPersistentHighlightFallback: (fn, options) => {
          calls.push(['setPersistentHighlightFallback', options.key, options.isActive()]);
          calls.push(['fallbackResult', fn()]);
        }
      }
    });

    listeners.get('click')({ target: row });
    const snapshot = api.captureSnapshot();
    assert.equal(snapshot.lockedRow.label, 'Molar Refractivity');
    assert.equal(row.classList.contains('pc-hover'), true);

    row.classList.remove('pc-hover');
    const restored = api.restoreSnapshot(snapshot);
    assert.equal(restored, true);
    assert.equal(row.classList.contains('pc-hover'), true);

    listeners.get('mouseleave')();
    assert.equal(tooltip.state.opacity, '0');

    assert.deepEqual(calls.slice(0, 5), [
      ['setPersistentHighlightFallback', 'physchem', false],
      ['fallbackResult', false],
      [
        'setHighlight',
        [
          new Map([
            ['a1', 'a1'],
            ['a2', 'a2']
          ])
        ],
        { style: 'physchem' }
      ],
      [
        'setHighlight',
        [
          new Map([
            ['a1', 'a1'],
            ['a2', 'a2']
          ])
        ],
        { style: 'physchem' }
      ],
      [
        'setHighlight',
        [
          new Map([
            ['a1', 'a1'],
            ['a2', 'a2']
          ])
        ],
        { style: 'physchem' }
      ]
    ]);
  });
});
