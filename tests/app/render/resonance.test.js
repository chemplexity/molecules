import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/index.js';
import { generateResonanceStructures } from '../../../src/algorithms/index.js';
import {
  captureResonanceViewSnapshot,
  initResonancePanel,
  prepareResonanceStateForStructuralEdit,
  prepareResonanceUndoSnapshot,
  restoreResonanceViewSnapshot,
  shouldPreserveResonanceForClickTarget
} from '../../../src/app/render/resonance.js';

function makeMockElement(tagName = 'div') {
  let _textContent = '';
  let _innerHTML = '';
  const classes = new Set();
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
    addEventListener() {}
  };
}

function collectText(node) {
  let text = node?.textContent ?? '';
  for (const child of node?.children ?? []) {
    text += collectText(child);
  }
  return text;
}

function mockTarget(matches = new Set()) {
  return {
    closest(selector) {
      return selector
        .split(',')
        .map(part => part.trim())
        .some(part => matches.has(part))
        ? {}
        : null;
    }
  };
}

describe('shouldPreserveResonanceForClickTarget', () => {
  it('preserves resonance view for toolbar mode controls like pan/select/erase', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#clean-controls']))), true);
  });

  it('preserves resonance view for plot interactions like selecting atoms or regions', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#plot']))), true);
  });

  it('preserves resonance view for draw tools and atom palette clicks', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#draw-tools']))), true);
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#atom-selector']))), true);
  });

  it('preserves resonance view for clicks inside the resonance table itself', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget(new Set(['#resonance-table']))), true);
  });

  it('allows ordinary outside clicks to reset the active resonance view', () => {
    assert.equal(shouldPreserveResonanceForClickTarget(mockTarget()), false);
  });
});

describe('prepareResonanceStateForStructuralEdit', () => {
  it('clears stale resonance tables before a structural edit starts', () => {
    const mol = parseSMILES('CC=O');
    generateResonanceStructures(mol);
    mol.setResonanceState(2);

    const result = prepareResonanceStateForStructuralEdit(mol);

    assert.equal(result.resonanceCleared, true);
    assert.equal(!!mol.properties.resonance, false);

    const carbonyl = [...mol.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(mol);
      return (a1.name === 'C' && a2.name === 'O') || (a1.name === 'O' && a2.name === 'C');
    });
    assert.ok(carbonyl);
    assert.equal(carbonyl.properties.order, 2);
  });
});

describe('resonance undo snapshots', () => {
  it('stores canonical contributor data while preserving the active contributor view separately', () => {
    const mol = parseSMILES('CC=O');
    generateResonanceStructures(mol);
    restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

    const viewSnapshot = captureResonanceViewSnapshot(mol);
    const prepared = prepareResonanceUndoSnapshot(mol);
    const carbonyl = [...prepared.mol.bonds.values()].find(bond => {
      const [a1, a2] = bond.getAtomObjects(prepared.mol);
      return (a1.name === 'C' && a2.name === 'O') || (a1.name === 'O' && a2.name === 'C');
    });

    assert.deepEqual(viewSnapshot, { locked: true, activeState: 2 });
    assert.deepEqual(prepared.resonanceView, { locked: true, activeState: 2 });
    assert.equal(carbonyl.properties.order, 2);
  });

  it('rerenders the resonance row label when a locked contributor view is restored', () => {
    const previousDocument = globalThis.document;
    const resonanceBody = makeMockElement('tbody');
    globalThis.document = {
      getElementById(id) {
        return id === 'resonance-body' ? resonanceBody : null;
      },
      createElement(tagName) {
        return makeMockElement(tagName);
      }
    };

    try {
      const mol = parseSMILES('CC=O');
      generateResonanceStructures(mol);

      const restored = restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

      assert.equal(restored, true);
      assert.equal(resonanceBody.children.length, 1);
      assert.match(collectText(resonanceBody.children[0]), /2\/2/);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it('rerenders the resonance row as unlocked when no locked contributor view is restored', () => {
    const previousDocument = globalThis.document;
    const resonanceBody = makeMockElement('tbody');
    globalThis.document = {
      getElementById(id) {
        return id === 'resonance-body' ? resonanceBody : null;
      },
      createElement(tagName) {
        return makeMockElement(tagName);
      }
    };

    try {
      const mol = parseSMILES('CC=O');
      generateResonanceStructures(mol);
      restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

      const restored = restoreResonanceViewSnapshot(mol, null);
      const row = resonanceBody.children[0];

      assert.equal(restored, false);
      assert.equal(resonanceBody.children.length, 1);
      assert.equal(row.classList.contains('resonance-active'), false);
      assert.doesNotMatch(collectText(row), /2\/2/);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it('does not collapse reaction preview while capturing an undo snapshot', () => {
    const mol = parseSMILES('CC=O');
    generateResonanceStructures(mol);
    restoreResonanceViewSnapshot(mol, { locked: true, activeState: 2 });

    let restoreCalls = 0;
    initResonancePanel({
      mode: '2d',
      _mol2d: mol,
      currentMol: null,
      draw2d() {},
      updateForce() {},
      hasReactionPreview: () => true,
      restoreReactionPreviewSource: () => {
        restoreCalls += 1;
        return true;
      }
    });

    const prepared = prepareResonanceUndoSnapshot(mol);

    assert.equal(restoreCalls, 0);
    assert.equal(prepared.mol, mol);
    assert.equal(prepared.resonanceView, null);
  });
});
