import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { create2DHighlightRenderer, createForceHighlightRenderer, _setHighlight, clearHighlightState, initHighlights } from '../../../src/app/render/highlights.js';

class FakeSelection {
  constructor(records) {
    this.records = records;
  }

  select(selector) {
    this.records.push(['select', selector]);
    return this;
  }

  remove() {
    this.records.push(['remove']);
    return this;
  }

  insert(tag, before) {
    this.records.push(['insert', tag, before]);
    return new FakeSelection(this.records);
  }

  append(tag) {
    this.records.push(['append', tag]);
    return new FakeSelection(this.records);
  }

  attr(name, value) {
    this.records.push(['attr', name, value]);
    return this;
  }

  selectAll(selector) {
    this.records.push(['selectAll', selector]);
    return this;
  }

  data(value) {
    this.records.push(['data', value]);
    return this;
  }

  enter() {
    this.records.push(['enter']);
    return this;
  }

  datum(value) {
    this.records.push(['datum', value]);
    return this;
  }
}

function makeAtom(id, { x = 0, y = 0, name = 'C', visible = true } = {}) {
  return {
    id,
    x,
    y,
    name,
    visible,
    getCharge() {
      return 0;
    },
    getNeighbors(mol) {
      return [...(this._neighbors ?? [])].map(neighborId => mol.atoms.get(neighborId)).filter(Boolean);
    }
  };
}

function makeBond(id, atom1, atom2) {
  return {
    id,
    getAtomObjects() {
      return [atom1, atom2];
    }
  };
}

describe('create2DHighlightRenderer', () => {
  beforeEach(() => {
    initHighlights({
      mode: 'force',
      applyForceHighlights() {}
    });
    clearHighlightState();
  });

  afterEach(() => {
    clearHighlightState();
  });

  it('clears any existing 2D highlight layer even when there are no active highlights', () => {
    const records = [];
    const renderer = create2DHighlightRenderer({
      view: {
        getGraphSelection: () => new FakeSelection(records)
      },
      state: {
        getMol: () => null,
        getHCounts: () => new Map()
      },
      helpers: {
        toSVGPt: atom => ({ x: atom.x, y: atom.y })
      },
      constants: {
        getFontSize: () => 14
      }
    });

    renderer.redraw2dHighlights();

    assert.ok(records.some(([kind, selector]) => kind === 'select' && selector === 'g.atom-highlights'));
    assert.ok(records.some(([kind]) => kind === 'remove'));
    assert.equal(records.some(([kind]) => kind === 'insert'), false);
  });

  it('renders highlighted atoms and bonds into the extracted 2D highlight layer', () => {
    const records = [];
    const atomA = makeAtom('a1', { x: 10, y: 10 });
    const atomB = makeAtom('a2', { x: 40, y: 10 });
    atomA._neighbors = ['a2'];
    atomB._neighbors = ['a1'];
    const bond = makeBond('b1', atomA, atomB);
    const mol = {
      atoms: new Map([
        ['a1', atomA],
        ['a2', atomB]
      ]),
      bonds: new Map([['b1', bond]])
    };

    _setHighlight([new Map([['a1', 'a1'], ['a2', 'a2']])]);

    const renderer = create2DHighlightRenderer({
      view: {
        getGraphSelection: () => new FakeSelection(records)
      },
      state: {
        getMol: () => mol,
        getHCounts: () => new Map()
      },
      helpers: {
        toSVGPt: atom => ({ x: atom.x, y: atom.y })
      },
      constants: {
        getFontSize: () => 14
      }
    });

    renderer.redraw2dHighlights();

    assert.ok(records.some(([kind, tag]) => kind === 'insert' && tag === 'g'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'line'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'circle'));
  });

  it('renders highlighted atoms and bonds into the extracted force highlight layer', () => {
    const records = [];
    const nodes = [
      { id: 'a1', x: 10, y: 10, protons: 6 },
      { id: 'a2', x: 40, y: 10, protons: 6 }
    ];
    const links = [{ id: 'b1', source: nodes[0], target: nodes[1] }];
    _setHighlight([new Map([['a1', 'a1'], ['a2', 'a2']])]);

    const renderer = createForceHighlightRenderer({
      view: {
        getGraphSelection: () => new FakeSelection(records)
      },
      force: {
        getNodes: () => nodes,
        getLinks: () => links
      },
      cache: {
        setHighlightLines: value => records.push(['setHighlightLines', value]),
        setHighlightCircles: value => records.push(['setHighlightCircles', value])
      },
      constants: {
        getHighlightRadius: () => 8,
        getOutlineWidth: () => 2
      },
      helpers: {
        atomRadius: () => 10
      }
    });

    renderer.applyForceHighlights();

    assert.ok(records.some(([kind, selector]) => kind === 'selectAll' && selector === 'g.fg-highlight-layer'));
    assert.ok(records.some(([kind, tag]) => kind === 'insert' && tag === 'g'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'line'));
    assert.ok(records.some(([kind, tag]) => kind === 'append' && tag === 'circle'));
  });
});
