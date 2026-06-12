import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { atomBBoxFallback, enLabelColor, initPlotBootstrap } from '../../../src/app/bootstrap/plot-bootstrap.js';

function createSelection(name, records) {
  return {
    name,
    children: [],
    attrs: new Map(),
    append(tagName) {
      const child = createSelection(tagName, records);
      this.children.push(child);
      records.push(['append', name, tagName]);
      return child;
    },
    attr(attrName, value) {
      this.attrs.set(attrName, value);
      return this;
    },
    call(value) {
      records.push(['call', name, value]);
      return this;
    }
  };
}

function createD3BootstrapStub(records) {
  const selections = new Map([
    ['#plot', createSelection('plot', records)],
    ['#atom-tooltip', createSelection('tooltip', records)]
  ]);
  return {
    select(selector) {
      return selections.get(selector);
    },
    zoom() {
      const zoom = {
        scaleExtent(value) {
          zoom.scaleExtentValue = value;
          return zoom;
        },
        filter(fn) {
          zoom.filterFn = fn;
          return zoom;
        },
        on(name, fn) {
          zoom[name] = fn;
          return zoom;
        }
      };
      records.push(['zoom', zoom]);
      return zoom;
    }
  };
}

describe('plot-bootstrap helpers', () => {
  it('computes an atom bounding box fallback', () => {
    const bbox = atomBBoxFallback([
      { x: -2, y: 5 },
      { x: 4, y: -1 },
      { x: 0, y: 3 }
    ]);

    assert.deepEqual(bbox, {
      minX: -2,
      maxX: 4,
      minY: -1,
      maxY: 5,
      cx: 1,
      cy: 2
    });
  });

  it('maps EN values to clamped label colors', () => {
    assert.equal(enLabelColor(-1), 'rgb(50,50,50)');
    assert.equal(enLabelColor(0), 'rgb(50,50,50)');
    assert.equal(enLabelColor(1), 'rgb(230,20,10)');
    assert.equal(enLabelColor(2), 'rgb(230,20,10)');
  });

  it('blocks primary-button pan gestures while a custom interaction mode is active', () => {
    const records = [];
    let interactionModeActive = true;
    const d3 = createD3BootstrapStub(records);
    const result = initPlotBootstrap({
      d3,
      document: {
        getElementById: id => ({ id })
      },
      getInteractionModeActive: () => interactionModeActive
    });

    assert.equal(result.zoom.filterFn({ type: 'wheel', button: 0 }), true);
    assert.equal(result.zoom.filterFn({ type: 'mousedown', button: 0, ctrlKey: false }), false);

    interactionModeActive = false;
    assert.equal(result.zoom.filterFn({ type: 'mousedown', button: 0, ctrlKey: false }), true);
    assert.equal(result.zoom.filterFn({ type: 'mousedown', button: 2, ctrlKey: false }), false);
    assert.deepEqual(result.zoom.scaleExtentValue, [0.05, 30]);
  });
});
