import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createClipboardActions } from '../../../src/app/interactions/clipboard.js';
import { parseSMILES } from '../../../src/io/smiles.js';

function createSelectionStub(textValues = [], elements = [], options = {}) {
  function rectForNode(node) {
    const className = String(node?.attrs?.get('class') ?? '');
    return className.split(/\s+/).includes('paste-preview-layer') ? options.previewRect : null;
  }

  function makeNodeSelection(tagName = null, existingNode = null) {
    const node =
      existingNode ??
      (tagName == null
        ? null
        : {
            tagName,
            attrs: new Map(),
            styles: new Map(),
            text: '',
            getBoundingClientRect() {
              return rectForNode(this) ?? { left: 0, right: 0, top: 0, bottom: 0 };
            }
          });
    if (node && !existingNode) {
      elements.push(node);
    }
    return {
      select(selector) {
        if (selector === 'g.paste-preview-layer') {
          const found = elements
            .slice()
            .reverse()
            .find(element => element.tagName === 'g' && String(element.attrs.get('class') ?? '').split(/\s+/).includes('paste-preview-layer'));
          return makeNodeSelection(null, found ?? null);
        }
        return makeNodeSelection();
      },
      append(tag) {
        return makeNodeSelection(tag);
      },
      attr(name, value) {
        if (!node) {
          return value === undefined ? undefined : this;
        }
        if (value === undefined) {
          return node.attrs.get(name);
        }
        node.attrs.set(name, value);
        return this;
      },
      style(name, value) {
        if (node) {
          node.styles.set(name, value);
        }
        return this;
      },
      text(value) {
        if (arguments.length > 0) {
          textValues.push(String(value));
          if (node) {
            node.text = String(value);
          }
        }
        return this;
      },
      remove() {
        return this;
      },
      node() {
        return node;
      }
    };
  }
  return {
    select(selector) {
      if (selector === 'g.paste-preview-layer') {
        const found = elements
          .slice()
          .reverse()
          .find(element => element.tagName === 'g' && String(element.attrs.get('class') ?? '').split(/\s+/).includes('paste-preview-layer'));
        return makeNodeSelection(null, found ?? null);
      }
      return makeNodeSelection();
    },
    append(tag) {
      return makeNodeSelection(tag);
    },
    attr() {
      return this;
    },
    style() {
      return this;
    },
    text(value) {
      if (arguments.length > 0) {
        textValues.push(String(value));
      }
      return this;
    },
    remove() {
      return this;
    },
    node() {
      return options.rootNode ?? null;
    }
  };
}

function createClipboardHarness({
  mol,
  selectedAtomIds,
  selectedBondIds = new Set(),
  mode = '2d',
  forceNodes = null,
  twoDAtomPoints = null,
  textValues = [],
  elements = [],
  previewRect = null,
  plotRect = null
}) {
  const records = [];
  let currentMode = mode;
  const plotElement = plotRect
    ? {
        getBoundingClientRect: () => plotRect
      }
    : null;
  const clipboard = createClipboardActions({
    state: {
      getMode: () => currentMode
    },
    molecule: {
      getActive: () => mol
    },
    force: {
      getNodes: () => forceNodes ?? [...mol.atoms.values()].map(atom => ({ id: atom.id, x: atom.x, y: atom.y }))
    },
    selection: {
      getSelectedAtomIds: () => selectedAtomIds,
      getSelectedBondIds: () => selectedBondIds,
      clear: () => {
        records.push(['clearSelection']);
        selectedAtomIds.clear();
        selectedBondIds.clear();
      }
    },
    overlays: {
      hasReactionPreview: () => false,
      hasActiveResonanceView: () => false
    },
    history: {
      takeSnapshot: () => records.push(['snapshot'])
    },
    renderers: {
      draw2d: () => records.push(['draw2d']),
      renderMol: (renderedMol, options = {}) => records.push(['render', renderedMol, options]),
      refreshSelectionOverlay: () => records.push(['refreshSelection'])
    },
    analysis: {
      syncInputField: syncedMol => records.push(['syncInput', syncedMol]),
      updateFormula: formulaMol => records.push(['formula', formulaMol]),
      updateDescriptors: descriptorMol => records.push(['descriptors', descriptorMol]),
      updatePanels: panelMol => records.push(['panels', panelMol])
    },
    view: {
      clearPrimitiveHover: () => {},
      setPreserveSelectionOnNextRender: () => {},
      captureZoomTransform: () => {
        records.push(['captureZoom']);
        return { x: 1, y: 2, k: 3 };
      },
      restore2dEditViewport: (snapshot, options = {}) => records.push(['restore2dEditViewport', snapshot, options]),
      get2DAtomPoint: atom => twoDAtomPoints?.get(atom.id) ?? { x: atom.x, y: atom.y },
      get2DCenterX: () => 0,
      get2DCenterY: () => 0,
      scale: 40,
      forceScale: 25
    },
    plot: {
      getSize: () => ({ width: 200, height: 120 })
    },
    view2D: {
      syncDerivedState: syncedMol => records.push(['syncDerived2d', syncedMol])
    },
    dom: {
      g: createSelectionStub(textValues, elements, { previewRect }),
      plotElement
    },
    pointer: () => [100, 60]
  });
  return {
    clipboard,
    records,
    textValues,
    elements,
    setMode(value) {
      currentMode = value;
    }
  };
}

function longestPreviewLine(elements) {
  const lengths = elements
    .filter(element => element.tagName === 'line')
    .map(line => {
      const x1 = Number(line.attrs.get('x1'));
      const y1 = Number(line.attrs.get('y1'));
      const x2 = Number(line.attrs.get('x2'));
      const y2 = Number(line.attrs.get('y2'));
      return Math.hypot(x2 - x1, y2 - y1);
    });
  return Math.max(0, ...lengths);
}

function previewElementsByClass(elements, tagName, className) {
  return elements.filter(element => element.tagName === tagName && String(element.attrs.get('class') ?? '').split(/\s+/).includes(className));
}

describe('app/interactions/clipboard', () => {
  it('syncs input and analysis displays after placing a pasted fragment', () => {
    const mol = parseSMILES('CCC');
    const selectedAtomIds = new Set(['C1', 'C2']);
    const { clipboard, records } = createClipboardHarness({ mol, selectedAtomIds });

    assert.equal(clipboard.copySelection(), true);
    assert.equal(clipboard.beginPastePreview(), true);
    assert.equal(clipboard.placePastePreview(), true);

    assert.equal(mol.atoms.has('C4'), true);
    assert.deepEqual(
      records.map(([name]) => name),
      ['captureZoom', 'snapshot', 'clearSelection', 'syncDerived2d', 'draw2d', 'restore2dEditViewport', 'syncInput', 'formula', 'descriptors', 'panels', 'refreshSelection']
    );
    for (const name of ['syncInput', 'formula', 'descriptors', 'panels']) {
      assert.equal(records.find(record => record[0] === name)?.[1], mol);
    }
  });

  it('restores the 2D edit viewport after paste so fitting only happens when clipped', () => {
    const mol = parseSMILES('CCC');
    const selectedAtomIds = new Set(['C1', 'C2']);
    const { clipboard, records } = createClipboardHarness({
      mol,
      selectedAtomIds,
      previewRect: { left: 40, right: 160, top: 30, bottom: 90 },
      plotRect: { left: 0, right: 200, top: 0, bottom: 120 }
    });

    assert.equal(clipboard.copySelection(), true);
    assert.equal(clipboard.beginPastePreview(), true);
    assert.equal(clipboard.placePastePreview(), true);

    assert.deepEqual(records.find(record => record[0] === 'restore2dEditViewport'), ['restore2dEditViewport', { x: 1, y: 2, k: 3 }, { zoomToFit: { pad: 0 } }]);
    assert.equal(records.some(record => record[0] === 'render'), false);
  });

  it('preserves the force viewport when the pasted preview is already inside the plot', () => {
    const mol = parseSMILES('CC');
    const selectedAtomIds = new Set(['C1', 'C2']);
    const { clipboard, records } = createClipboardHarness({
      mol,
      selectedAtomIds,
      mode: 'force',
      previewRect: { left: 50, right: 150, top: 35, bottom: 85 },
      plotRect: { left: 0, right: 200, top: 0, bottom: 120 }
    });

    assert.equal(clipboard.copySelection(), true);
    assert.equal(clipboard.beginPastePreview(), true);
    assert.equal(clipboard.placePastePreview(), true);

    const renderOptions = records.find(record => record[0] === 'render')?.[2];
    assert.equal(renderOptions.preserveView, true);
    assert.equal(renderOptions.forcePreservePositions, true);
    assert.ok(renderOptions.forceInitialPatchPos instanceof Map);
  });

  it('shows copied indole NH and single hydrogens in force paste previews while hiding normal 2D hydrogen atoms', () => {
    const indole = parseSMILES('c1ccc2[nH]ccc2c1');
    indole.atoms.get('N5').x = 0;
    indole.atoms.get('N5').y = 0;
    indole.atoms.get('H6').x = 0;
    indole.atoms.get('H6').y = 1;
    const nhHarness = createClipboardHarness({
      mol: indole,
      selectedAtomIds: new Set(['N5']),
      mode: 'force'
    });

    assert.equal(nhHarness.clipboard.copySelection(), true);
    assert.equal(nhHarness.clipboard.beginPastePreview(), true);
    assert.ok(nhHarness.textValues.includes('NH'));

    const hydrogenHarness = createClipboardHarness({
      mol: indole,
      selectedAtomIds: new Set(['H6']),
      mode: 'force'
    });

    assert.equal(hydrogenHarness.clipboard.copySelection(), true);
    assert.equal(hydrogenHarness.clipboard.beginPastePreview(), true);
    assert.ok(hydrogenHarness.textValues.includes('H'));

    const lineHydrogenHarness = createClipboardHarness({
      mol: indole,
      selectedAtomIds: new Set(['H6']),
      mode: '2d'
    });

    assert.equal(lineHydrogenHarness.clipboard.copySelection(), true);
    assert.equal(lineHydrogenHarness.clipboard.beginPastePreview(), true);
    assert.equal(lineHydrogenHarness.textValues.includes('H'), false);

    const lineNhHarness = createClipboardHarness({
      mol: indole,
      selectedAtomIds: new Set(['N5']),
      mode: '2d'
    });

    assert.equal(lineNhHarness.clipboard.copySelection(), true);
    assert.equal(lineNhHarness.clipboard.beginPastePreview(), true);
    assert.ok(lineNhHarness.textValues.includes('NH'));
  });

  it('previews copied multi-atom fragments with non-collapsed geometry in 2D and force modes', () => {
    const lineMol = parseSMILES('CC');
    lineMol.atoms.get('C1').x = 0;
    lineMol.atoms.get('C1').y = 0;
    lineMol.atoms.get('C2').x = 1.5;
    lineMol.atoms.get('C2').y = 0;
    const lineHarness = createClipboardHarness({
      mol: lineMol,
      selectedAtomIds: new Set(['C1', 'C2']),
      mode: '2d'
    });

    assert.equal(lineHarness.clipboard.copySelection(), true);
    assert.equal(lineHarness.clipboard.beginPastePreview(), true);
    assert.ok(longestPreviewLine(lineHarness.elements) > 20);

    const forceMol = parseSMILES('CC');
    forceMol.atoms.get('C1').x = 0;
    forceMol.atoms.get('C1').y = 0;
    forceMol.atoms.get('C2').x = 30;
    forceMol.atoms.get('C2').y = 0;
    const forceHarness = createClipboardHarness({
      mol: forceMol,
      selectedAtomIds: new Set(['C1', 'C2']),
      mode: 'force'
    });

    assert.equal(forceHarness.clipboard.copySelection(), true);
    assert.equal(forceHarness.clipboard.beginPastePreview(), true);
    assert.ok(longestPreviewLine(forceHarness.elements) > 20);
  });

  it('converts 2D copied fragment geometry to force-scale preview coordinates', () => {
    const mol = parseSMILES('CC');
    mol.atoms.get('C1').x = 0;
    mol.atoms.get('C1').y = 0;
    mol.atoms.get('C2').x = 1.5;
    mol.atoms.get('C2').y = 0;
    const harness = createClipboardHarness({
      mol,
      selectedAtomIds: new Set(['C1', 'C2']),
      mode: '2d',
      forceNodes: [],
      twoDAtomPoints: new Map([
        ['C1', { x: 20, y: 40 }],
        ['C2', { x: 120, y: 40 }]
      ])
    });

    assert.equal(harness.clipboard.copySelection(), true);
    harness.setMode('force');
    assert.equal(harness.clipboard.beginPastePreview(), true);
    assert.ok(Math.abs(longestPreviewLine(harness.elements) - 41) < 1);
  });

  it('shows generated hydrogens when a 2D fragment is previewed in force mode', () => {
    const mol = parseSMILES('CC');
    mol.atoms.get('C1').x = 0;
    mol.atoms.get('C1').y = 0;
    mol.atoms.get('C2').x = 1.5;
    mol.atoms.get('C2').y = 0;
    const harness = createClipboardHarness({
      mol,
      selectedAtomIds: new Set(['C1']),
      mode: '2d',
      forceNodes: []
    });

    assert.equal(harness.clipboard.copySelection(), true);
    harness.setMode('force');
    assert.equal(harness.clipboard.beginPastePreview(), true);
    const previewNodes = previewElementsByClass(harness.elements, 'circle', 'node');
    const previewRadii = previewNodes.map(node => Number(node.attrs.get('r')));
    assert.equal(previewNodes.length, 5);
    assert.equal(previewRadii.filter(radius => radius < 6).length, 4);
    assert.equal(Math.max(...previewRadii) < 9, true);
    assert.equal(previewElementsByClass(harness.elements, 'line', 'link').length, 4);
  });
});
