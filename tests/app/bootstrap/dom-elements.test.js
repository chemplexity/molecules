import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createBootstrapDom } from '../../../src/app/bootstrap/dom-elements.js';

function createElement(initial = {}) {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    classList: {
      toggled: new Map(),
      toggle(name, value) {
        this.toggled.set(name, value);
      }
    },
    ...initial
  };
}

describe('dom-elements bootstrap helpers', () => {
  it('updates the input format UI through cached handles', () => {
    const plotEl = createElement();
    const inputEl = createElement({ value: 'CCO' });
    const collectionSelectEl = createElement();
    const smilesModeButton = createElement();
    const inchiModeButton = createElement();
    const inputLabel = createElement();
    const examplesList = createElement();
    const svgPlot = createElement();
    const elements = {
      'toggle-btn': createElement(),
      'rotate-controls': createElement(),
      'clean-controls': createElement(),
      'clean-2d-btn': createElement(),
      'clean-force-btn': createElement(),
      'draw-tools': createElement(),
      'force-controls': createElement(),
      'pan-mode-btn': createElement(),
      'select-mode-btn': createElement(),
      'draw-bond-btn': createElement(),
      'charge-positive-btn': createElement(),
      'charge-negative-btn': createElement(),
      'erase-btn': createElement(),
      molecularFormula: createElement(),
      molecularWeight: createElement(),
      'descriptor-body': createElement(),
      'fg-body': createElement(),
      'smiles-mode-btn': smilesModeButton,
      'inchi-mode-btn': inchiModeButton,
      'input-label': inputLabel,
      'examples-list': examplesList,
      'options-overlay': createElement(),
      'options-show-valence-warnings': createElement(),
      'options-show-atom-tooltips': createElement(),
      'options-2d-atom-coloring': createElement(),
      'options-2d-atom-font-size': createElement(),
      'options-atom-numbering-font-size': createElement(),
      'options-2d-bond-thickness': createElement(),
      'options-force-atom-size': createElement(),
      'options-force-bond-thickness': createElement(),
      'options-reset-btn': createElement(),
      'options-cancel-btn': createElement(),
      'options-apply-btn': createElement(),
      'pc-table': createElement(),
      'label-toggle': createElement(),
      'erase-cursor': createElement(),
      'elem-btn-C': createElement()
    };
    const document = {
      getElementById(id) {
        return elements[id] ?? null;
      },
      querySelector(selector) {
        return selector === '.svg-plot' ? svgPlot : null;
      },
      querySelectorAll() {
        return [];
      }
    };

    const dom = createBootstrapDom({
      document,
      plotEl,
      inputEl,
      collectionSelectEl
    });

    dom.setInputFormatButtons('inchi');
    dom.setInputLabel('Input InChI notation...');
    dom.setInputValue('InChI=1S/CH4/h1H4');

    assert.equal(smilesModeButton.classList.toggled.get('active'), false);
    assert.equal(inchiModeButton.classList.toggled.get('active'), true);
    assert.equal(inputLabel.textContent, 'Input InChI notation...');
    assert.equal(inputEl.value, 'InChI=1S/CH4/h1H4');
    assert.equal(dom.getExamplesElement(), examplesList);
    assert.equal(dom.getSvgPlotElement(), svgPlot);
    assert.equal(dom.getElementButtonElement('C'), elements['elem-btn-C']);
    assert.equal(dom.getPositiveChargeButtonElement(), elements['charge-positive-btn']);
    assert.equal(dom.getNegativeChargeButtonElement(), elements['charge-negative-btn']);
  });

  it('clears the summary fields through shared helpers', () => {
    const plotEl = createElement();
    const inputEl = createElement();
    const collectionSelectEl = createElement();
    const molecularFormula = createElement({ innerHTML: '<span>C2H6O</span>' });
    const molecularWeight = createElement({ textContent: '46.07 g/mol' });
    const descriptorBody = createElement({ innerHTML: '<tr></tr>' });
    const fgBody = createElement({ innerHTML: '<tr></tr>' });
    const elements = {
      'toggle-btn': createElement(),
      'rotate-controls': createElement(),
      'clean-controls': createElement(),
      'clean-2d-btn': createElement(),
      'clean-force-btn': createElement(),
      'draw-tools': createElement(),
      'force-controls': createElement(),
      'pan-mode-btn': createElement(),
      'select-mode-btn': createElement(),
      'draw-bond-btn': createElement(),
      'charge-positive-btn': createElement(),
      'charge-negative-btn': createElement(),
      'erase-btn': createElement(),
      molecularFormula,
      molecularWeight,
      'descriptor-body': descriptorBody,
      'fg-body': fgBody,
      'smiles-mode-btn': createElement(),
      'inchi-mode-btn': createElement(),
      'input-label': createElement(),
      'examples-list': createElement(),
      'options-overlay': createElement(),
      'options-show-valence-warnings': createElement(),
      'options-show-atom-tooltips': createElement(),
      'options-2d-atom-coloring': createElement(),
      'options-2d-atom-font-size': createElement(),
      'options-atom-numbering-font-size': createElement(),
      'options-2d-bond-thickness': createElement(),
      'options-force-atom-size': createElement(),
      'options-force-bond-thickness': createElement(),
      'options-reset-btn': createElement(),
      'options-cancel-btn': createElement(),
      'options-apply-btn': createElement(),
      'pc-table': createElement(),
      'label-toggle': createElement(),
      'erase-cursor': createElement()
    };
    const document = {
      getElementById(id) {
        return elements[id] ?? null;
      },
      querySelector(selector) {
        return selector === '.svg-plot' ? createElement() : null;
      },
      querySelectorAll() {
        return [];
      }
    };

    const dom = createBootstrapDom({
      document,
      plotEl,
      inputEl,
      collectionSelectEl
    });

    dom.clearSummary();
    dom.clearFunctionalGroups();

    assert.equal(molecularFormula.innerHTML, '');
    assert.equal(molecularWeight.textContent, '');
    assert.equal(descriptorBody.innerHTML, '');
    assert.equal(fgBody.innerHTML, '');
  });
});
