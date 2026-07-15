/** @module app/bootstrap/dom-elements */

/**
 * Queries all application DOM elements from the document and returns accessor functions for each.
 * @param {object} params - DOM bootstrap parameters.
 * @param {Document} params.document - The browser document used for querying elements.
 * @param {Element} params.plotEl - The SVG plot container element.
 * @param {HTMLInputElement} params.inputEl - The chemical-string input element.
 * @param {HTMLSelectElement} params.collectionSelectEl - The molecule-collection picker element.
 * @returns {object} Accessor object containing getters and setters for every application DOM element.
 */
export function createBootstrapDom({ document, plotEl, inputEl, collectionSelectEl }) {
  const toggleButton = document.getElementById('toggle-btn');
  const rotateControls = document.getElementById('rotate-controls');
  const cleanControls = document.getElementById('clean-controls');
  const clean2dButton = document.getElementById('clean-2d-btn');
  const cleanForceButton = document.getElementById('clean-force-btn');
  const drawTools = document.getElementById('draw-tools');
  const forceControls = document.getElementById('force-controls');
  const panButton = document.getElementById('pan-mode-btn');
  const selectButton = document.getElementById('select-mode-btn');
  const drawBondButton = document.getElementById('draw-bond-btn');
  const ringTemplateButton = document.getElementById('ring-template-btn');
  const styleBrushButton = document.getElementById('style-brush-btn');
  const forceStyleBrushButton = document.getElementById('force-style-brush-btn');
  const paintColorSelector = document.getElementById('paint-color-selector');
  const forcePaintColorSelector = document.getElementById('force-paint-color-selector');
  const paintBrushSizeSelector = document.getElementById('paint-brush-size-selector');
  const forcePaintBrushSizeSelector = document.getElementById('force-paint-brush-size-selector');
  const paintOpacitySelector = document.getElementById('paint-opacity-selector');
  const forcePaintOpacitySelector = document.getElementById('force-paint-opacity-selector');
  const periodicTableButton = document.getElementById('periodic-table-btn');
  const periodicTablePopover = document.getElementById('periodic-table-popover');
  const periodicTableGrid = document.getElementById('periodic-table-grid');
  const positiveChargeButton = document.getElementById('charge-positive-btn');
  const negativeChargeButton = document.getElementById('charge-negative-btn');
  const bondDrawTypeButtons = new Map([...document.querySelectorAll('[data-bond-draw-type]')].map(button => [button.dataset.bondDrawType, button]));
  const ringTemplateKey = value => (/^\d+$/.test(String(value)) ? Number(value) : String(value));
  const ringTemplateSizeButtons = new Map([...document.querySelectorAll('[data-ring-template-size]')].map(button => [ringTemplateKey(button.dataset.ringTemplateSize), button]));
  const paintToolButtons = new Map();
  for (const button of document.querySelectorAll('[data-paint-tool]')) {
    const list = paintToolButtons.get(button.dataset.paintTool) ?? [];
    list.push(button);
    paintToolButtons.set(button.dataset.paintTool, list);
  }
  const eraseButton = document.getElementById('erase-btn');
  const molecularFormula = document.getElementById('molecularFormula');
  const molecularWeight = document.getElementById('molecularWeight');
  const descriptorBody = document.getElementById('descriptor-body');
  const fgBody = document.getElementById('fg-body');
  const smilesModeButton = document.getElementById('smiles-mode-btn');
  const inchiModeButton = document.getElementById('inchi-mode-btn');
  const inputLabel = document.getElementById('input-label');
  const examplesElement = document.getElementById('examples-list');
  const optionsOverlay = document.getElementById('options-overlay');
  const showValenceWarnings = document.getElementById('options-show-valence-warnings');
  const showAtomTooltips = document.getElementById('options-show-atom-tooltips');
  const layoutBondLength = document.getElementById('options-layout-bond-length');
  const selectionHighlightColor = document.getElementById('options-selection-highlight-color');
  const functionalGroupHighlightColor = document.getElementById('options-functional-group-highlight-color');
  const physicochemicalHighlightColor = document.getElementById('options-physicochemical-highlight-color');
  const atomColoring2d = document.getElementById('options-2d-color-style');
  const atomFontSize2d = document.getElementById('options-2d-atom-font-size');
  const atomNumberingFontSize = document.getElementById('options-atom-numbering-font-size');
  const bondEnFontSize = document.getElementById('options-bond-en-font-size');
  const bondLengthFontSize = document.getElementById('options-bond-length-font-size');
  const bondThickness2d = document.getElementById('options-2d-bond-thickness');
  const forceAtomSize = document.getElementById('options-force-atom-size');
  const forceBondThickness = document.getElementById('options-force-bond-thickness');
  const showReactionReagents = document.getElementById('options-show-reaction-reagents');
  const showReactionConditions = document.getElementById('options-show-reaction-conditions');
  const reactionFontSize = document.getElementById('options-reaction-font-size');
  const optionsResetButton = document.getElementById('options-reset-btn');
  const optionsCancelButton = document.getElementById('options-cancel-btn');
  const optionsApplyButton = document.getElementById('options-apply-btn');
  const physchemTable = document.getElementById('pc-table');
  const svgPlot = document.querySelector('.svg-plot');
  const labelToggle = document.getElementById('label-toggle');
  const eraseCursor = document.getElementById('erase-cursor');
  const contentMain = document.getElementById('content-main');
  const sidebar = document.getElementById('sidebar');
  const mainSidebarSplitter = document.getElementById('main-sidebar-splitter');

  function clearFormula() {
    molecularFormula.innerHTML = '';
  }

  function clearWeight() {
    molecularWeight.textContent = '';
  }

  function clearDescriptors() {
    descriptorBody.innerHTML = '';
  }

  function clearFunctionalGroups() {
    fgBody.innerHTML = '';
  }

  function clearSummary() {
    clearFormula();
    clearWeight();
    clearDescriptors();
  }

  return {
    getDocument: () => document,
    getPlotElement: () => plotEl,
    getInputElement: () => inputEl,
    getCollectionSelectElement: () => collectionSelectEl,
    getToggleButtonElement: () => toggleButton,
    getRotateControlsElement: () => rotateControls,
    getCleanControlsElement: () => cleanControls,
    getClean2dButtonElement: () => clean2dButton,
    getCleanForceButtonElement: () => cleanForceButton,
    getDrawToolsElement: () => drawTools,
    getForceControlsElement: () => forceControls,
    getPanButtonElement: () => panButton,
    getSelectButtonElement: () => selectButton,
    getDrawBondButtonElement: () => drawBondButton,
    getRingTemplateButtonElement: () => ringTemplateButton,
    getStyleBrushButtonElement: () => styleBrushButton,
    getForceStyleBrushButtonElement: () => forceStyleBrushButton,
    getStyleBrushButtonElements: () => [styleBrushButton, forceStyleBrushButton].filter(Boolean),
    getPaintColorSelectorElements: () => [paintColorSelector, forcePaintColorSelector].filter(Boolean),
    getPaintBrushSizeSelectorElements: () => [paintBrushSizeSelector, forcePaintBrushSizeSelector].filter(Boolean),
    getPaintOpacitySelectorElements: () => [paintOpacitySelector, forcePaintOpacitySelector].filter(Boolean),
    getPaintToolButtonElements: tool => paintToolButtons.get(tool) ?? [],
    getPeriodicTableButtonElement: () => periodicTableButton,
    getPeriodicTablePopoverElement: () => periodicTablePopover,
    getPeriodicTableGridElement: () => periodicTableGrid,
    getPositiveChargeButtonElement: () => positiveChargeButton,
    getNegativeChargeButtonElement: () => negativeChargeButton,
    getBondDrawTypeButtonElement: type => bondDrawTypeButtons.get(type) ?? null,
    getRingTemplateSizeButtonElement: size => ringTemplateSizeButtons.get(ringTemplateKey(size)) ?? null,
    getEraseButtonElement: () => eraseButton,
    getElementButtonElement: element => document.getElementById(`elem-btn-${element}`),
    getElementButtonElements: element => [document.getElementById(`elem-btn-${element}`), ...document.querySelectorAll(`[data-periodic-element="${element}"]`)].filter(Boolean),
    getMolecularFormulaElement: () => molecularFormula,
    getMolecularWeightElement: () => molecularWeight,
    getDescriptorBodyElement: () => descriptorBody,
    getFunctionalGroupBodyElement: () => fgBody,
    getSmilesModeButtonElement: () => smilesModeButton,
    getInchiModeButtonElement: () => inchiModeButton,
    getInputLabelElement: () => inputLabel,
    getExamplesElement: () => examplesElement,
    getOptionsOverlayElement: () => optionsOverlay,
    getShowValenceWarningsElement: () => showValenceWarnings,
    getShowAtomTooltipsElement: () => showAtomTooltips,
    getLayoutBondLengthElement: () => layoutBondLength,
    getSelectionHighlightColorElement: () => selectionHighlightColor,
    getFunctionalGroupHighlightColorElement: () => functionalGroupHighlightColor,
    getPhysicochemicalHighlightColorElement: () => physicochemicalHighlightColor,
    get2DAtomColoringElement: () => atomColoring2d,
    get2DAtomFontSizeElement: () => atomFontSize2d,
    getAtomNumberingFontSizeElement: () => atomNumberingFontSize,
    getBondEnFontSizeElement: () => bondEnFontSize,
    getBondLengthFontSizeElement: () => bondLengthFontSize,
    get2DBondThicknessElement: () => bondThickness2d,
    getForceAtomSizeElement: () => forceAtomSize,
    getForceBondThicknessElement: () => forceBondThickness,
    getShowReactionReagentsElement: () => showReactionReagents,
    getShowReactionConditionsElement: () => showReactionConditions,
    getReactionFontSizeElement: () => reactionFontSize,
    getOptionsResetButtonElement: () => optionsResetButton,
    getOptionsCancelButtonElement: () => optionsCancelButton,
    getOptionsApplyButtonElement: () => optionsApplyButton,
    getPhyschemTableElement: () => physchemTable,
    getSvgPlotElement: () => svgPlot,
    getLabelToggleElement: () => labelToggle,
    getEraseCursorElement: () => eraseCursor,
    getContentMainElement: () => contentMain,
    getSidebarElement: () => sidebar,
    getMainSidebarSplitterElement: () => mainSidebarSplitter,
    setInputValue: value => {
      inputEl.value = value;
    },
    setInputFormatButtons: fmt => {
      smilesModeButton.classList.toggle('active', fmt === 'smiles');
      inchiModeButton.classList.toggle('active', fmt === 'inchi');
    },
    setInputLabel: text => {
      inputLabel.textContent = text;
    },
    clearFormula,
    clearWeight,
    clearDescriptors,
    clearFunctionalGroups,
    clearSummary
  };
}
