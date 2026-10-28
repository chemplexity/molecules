import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../src/io/smiles.js';
import { topologicalDescriptorRows, updateDescriptors } from '../../../src/app/ui/descriptors.js';

describe('topologicalDescriptorRows', () => {
  it('includes every available topological index in the panel', () => {
    const rows = topologicalDescriptorRows(parseSMILES('CCCC'));
    const values = new Map(rows);

    for (const label of [
      'Atom-Bond Connectivity (ABC)',
      'Geometric-Arithmetic (GA)',
      'Harmonic Index',
      'Sum-Connectivity (χs)',
      'Eccentric Connectivity (ξ)',
      'Wiener Polarity (Wp)',
      'Schultz Index (MTI)',
      'Gutman Index (Gut)',
      'Forgotten Index (F₃)',
      'Narumi-Katayama (NK)',
      'Hosoya Index (Z)'
    ]) {
      assert.equal(values.has(label), true, `missing ${label}`);
      assert.equal(Number.isFinite(values.get(label)), true, `${label} should be finite`);
    }
  });

  it('skips the exponential Hosoya calculation above the panel safety limit', () => {
    const rows = topologicalDescriptorRows(parseSMILES('C'.repeat(19)));
    assert.equal(new Map(rows).get('Hosoya Index (Z)'), null);
  });
});

function installHosoyaDom() {
  const workers = [];
  const cell = {
    textContent: '',
    button: null,
    set innerHTML(html) {
      this.html = html;
      this.button = { label: />(Compute|Cancel)</.exec(html)?.[1], listeners: [] };
      this.button.addEventListener = (type, handler) => this.button.listeners.push(handler);
    },
    querySelector() {
      return this.button;
    }
  };
  const tbody = {
    isConnected: true,
    innerHTML: '',
    querySelector: () => (tbody.innerHTML.includes('data-hosoya') ? cell : null)
  };
  globalThis.document = { getElementById: id => (id === 'descriptor-body' ? tbody : null) };
  globalThis.Worker = class {
    constructor() {
      this.terminated = false;
      this.messages = [];
      workers.push(this);
    }
    postMessage(data) {
      this.messages.push(data);
    }
    terminate() {
      this.terminated = true;
    }
  };
  const click = () => {
    const button = cell.button;
    cell.button = null;
    button.listeners.forEach(handler => handler());
  };
  return { cell, tbody, workers, click };
}

describe('updateDescriptors Hosoya deferral', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.Worker;
  });

  it('auto-computes Hosoya at or below the limit', () => {
    const { tbody, workers } = installHosoyaDom();
    updateDescriptors(parseSMILES('C'.repeat(18)));
    assert.match(tbody.innerHTML, /Hosoya Index \(Z\)<\/td><td>4181<\/td>/);
    assert.equal(workers.length, 0);
  });

  it('offers a cancellable background computation above the limit', () => {
    const { cell, workers, click } = installHosoyaDom();
    const mol = parseSMILES('C'.repeat(20));
    updateDescriptors(mol);
    assert.equal(cell.button.label, 'Compute');
    assert.match(cell.html, /title="Hosoya Z counts/);

    click();
    assert.equal(workers.length, 1);
    assert.equal(cell.button.label, 'Cancel');

    updateDescriptors(mol);
    assert.equal(cell.button.label, 'Cancel', 're-rendering the same structure keeps the job running');

    click();
    assert.equal(workers[0].terminated, true);
    assert.equal(cell.button.label, 'Compute');
  });

  it('replaces the button with the value when the worker finishes', () => {
    const { cell, workers, click } = installHosoyaDom();
    const mol = parseSMILES('C'.repeat(21));
    updateDescriptors(mol);
    click();
    workers[0].onmessage({ data: 17711 });
    assert.equal(workers[0].terminated, true);
    assert.equal(cell.textContent, 17711);

    cell.textContent = '';
    updateDescriptors(mol);
    assert.equal(cell.textContent, 17711, 'the finished value is reused for the same structure');
  });

  it('cancels a running computation when the structure changes', () => {
    const { cell, workers, click } = installHosoyaDom();
    updateDescriptors(parseSMILES('C'.repeat(22)));
    click();
    updateDescriptors(parseSMILES('C'.repeat(23)));
    assert.equal(workers[0].terminated, true);
    assert.equal(cell.button.label, 'Compute');
  });
});
