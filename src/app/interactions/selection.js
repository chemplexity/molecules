/** @module app/interactions/selection */

import elements from '../../data/elements.js';
import { atomColor } from '../../layout/mol2d-helpers.js';

const COMMON_DRAW_ELEMENTS = ['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'];
const DRAW_ELEMENTS = Object.keys(elements);
const PERIODIC_TABLE_ELEMENTS = DRAW_ELEMENTS.filter(symbol => symbol !== 'D');
const DRAW_BOND_TYPES = ['single', 'double', 'triple', 'aromatic', 'wedge', 'dash'];
const RING_TEMPLATE_SIZES = [3, 4, 5, 6, 7, 'benzene'];
const CHARGE_TOOLS = ['positive', 'negative'];
const PAINT_TOOLS = ['brush', 'bucket', 'eraser'];
const DEFAULT_PAINT_COLOR = '#3366ff';
const DEFAULT_PAINT_OPACITY = 1;
const DEFAULT_PAINT_BRUSH_SIZE = 12;
const MIN_PAINT_BRUSH_SIZE = 4;
const MAX_PAINT_BRUSH_SIZE = 32;
const PAINT_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const PAINT_SETTINGS_CHANGED_EVENT = 'molecules:paint-settings-changed';
const LANTHANIDES = ['La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'];
const ACTINIDES = ['Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr'];
const ELEMENT_NAMES = {
  H: 'Hydrogen',
  He: 'Helium',
  Li: 'Lithium',
  Be: 'Beryllium',
  B: 'Boron',
  C: 'Carbon',
  N: 'Nitrogen',
  O: 'Oxygen',
  F: 'Fluorine',
  Ne: 'Neon',
  Na: 'Sodium',
  Mg: 'Magnesium',
  Al: 'Aluminum',
  Si: 'Silicon',
  P: 'Phosphorus',
  S: 'Sulfur',
  Cl: 'Chlorine',
  Ar: 'Argon',
  K: 'Potassium',
  Ca: 'Calcium',
  Sc: 'Scandium',
  Ti: 'Titanium',
  V: 'Vanadium',
  Cr: 'Chromium',
  Mn: 'Manganese',
  Fe: 'Iron',
  Co: 'Cobalt',
  Ni: 'Nickel',
  Cu: 'Copper',
  Zn: 'Zinc',
  Ga: 'Gallium',
  Ge: 'Germanium',
  As: 'Arsenic',
  Se: 'Selenium',
  Br: 'Bromine',
  Kr: 'Krypton',
  Rb: 'Rubidium',
  Sr: 'Strontium',
  Y: 'Yttrium',
  Zr: 'Zirconium',
  Nb: 'Niobium',
  Mo: 'Molybdenum',
  Tc: 'Technetium',
  Ru: 'Ruthenium',
  Rh: 'Rhodium',
  Pd: 'Palladium',
  Ag: 'Silver',
  Cd: 'Cadmium',
  In: 'Indium',
  Sn: 'Tin',
  Sb: 'Antimony',
  Te: 'Tellurium',
  I: 'Iodine',
  Xe: 'Xenon',
  Cs: 'Cesium',
  Ba: 'Barium',
  La: 'Lanthanum',
  Ce: 'Cerium',
  Pr: 'Praseodymium',
  Nd: 'Neodymium',
  Pm: 'Promethium',
  Sm: 'Samarium',
  Eu: 'Europium',
  Gd: 'Gadolinium',
  Tb: 'Terbium',
  Dy: 'Dysprosium',
  Ho: 'Holmium',
  Er: 'Erbium',
  Tm: 'Thulium',
  Yb: 'Ytterbium',
  Lu: 'Lutetium',
  Hf: 'Hafnium',
  Ta: 'Tantalum',
  W: 'Tungsten',
  Re: 'Rhenium',
  Os: 'Osmium',
  Ir: 'Iridium',
  Pt: 'Platinum',
  Au: 'Gold',
  Hg: 'Mercury',
  Tl: 'Thallium',
  Pb: 'Lead',
  Bi: 'Bismuth',
  Po: 'Polonium',
  At: 'Astatine',
  Rn: 'Radon',
  Fr: 'Francium',
  Ra: 'Radium',
  Ac: 'Actinium',
  Th: 'Thorium',
  Pa: 'Protactinium',
  U: 'Uranium',
  Np: 'Neptunium',
  Pu: 'Plutonium',
  Am: 'Americium',
  Cm: 'Curium',
  Bk: 'Berkelium',
  Cf: 'Californium',
  Es: 'Einsteinium',
  Fm: 'Fermium',
  Md: 'Mendelevium',
  No: 'Nobelium',
  Lr: 'Lawrencium',
  Rf: 'Rutherfordium',
  Db: 'Dubnium',
  Sg: 'Seaborgium',
  Bh: 'Bohrium',
  Hs: 'Hassium',
  Mt: 'Meitnerium',
  Ds: 'Darmstadtium',
  Rg: 'Roentgenium',
  Cn: 'Copernicium',
  Nh: 'Nihonium',
  Fl: 'Flerovium',
  Mc: 'Moscovium',
  Lv: 'Livermorium',
  Ts: 'Tennessine',
  Og: 'Oganesson'
};

function colorChannelFromHex(hex, start) {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

function readableTextColor(background) {
  if (!/^#[0-9a-f]{6}$/i.test(background)) {
    return '#111827';
  }
  const red = colorChannelFromHex(background, 1);
  const green = colorChannelFromHex(background, 3);
  const blue = colorChannelFromHex(background, 5);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.56 ? '#ffffff' : '#111827';
}

function rgbaFromHex(hex, alpha) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    return `rgba(255, 255, 255, ${alpha})`;
  }
  const red = colorChannelFromHex(hex, 1);
  const green = colorChannelFromHex(hex, 3);
  const blue = colorChannelFromHex(hex, 5);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function elementTooltip(symbol) {
  return `${symbol} (${ELEMENT_NAMES[symbol] ?? symbol})`;
}

function averageAtomicWeight(symbol) {
  const data = elements[symbol];
  if (!data) {
    return null;
  }
  const weight = data.protons + data.neutrons;
  return Number.isFinite(weight) ? weight : null;
}

function previewElementNameFontSize(name) {
  if (name.length >= 12) {
    return '7.6px';
  }
  if (name.length >= 10) {
    return '8.5px';
  }
  return '9px';
}

function periodicTablePosition(symbol) {
  const data = elements[symbol];
  if (!data) {
    return null;
  }
  const lanthanideIndex = LANTHANIDES.indexOf(symbol);
  if (lanthanideIndex >= 0) {
    return { row: 10, column: lanthanideIndex + 5 };
  }
  const actinideIndex = ACTINIDES.indexOf(symbol);
  if (actinideIndex >= 0) {
    return { row: 11, column: actinideIndex + 5 };
  }
  return { row: data.period + 1, column: data.group + 1 };
}

function normalizePaintColor(value) {
  return PAINT_COLOR_PATTERN.test(value ?? '') ? value.toLowerCase() : DEFAULT_PAINT_COLOR;
}

function normalizePaintOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) {
    return DEFAULT_PAINT_OPACITY;
  }
  return Math.round(Math.min(1, Math.max(0, opacity)) * 100) / 100;
}

function normalizePaintBrushSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return DEFAULT_PAINT_BRUSH_SIZE;
  }
  return Math.round(Math.min(MAX_PAINT_BRUSH_SIZE, Math.max(MIN_PAINT_BRUSH_SIZE, size)));
}

function paintSwatchColor(color, opacity = DEFAULT_PAINT_OPACITY) {
  const normalizedColor = normalizePaintColor(color);
  const normalizedOpacity = normalizePaintOpacity(opacity);
  const red = Number.parseInt(normalizedColor.slice(1, 3), 16);
  const green = Number.parseInt(normalizedColor.slice(3, 5), 16);
  const blue = Number.parseInt(normalizedColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${normalizedOpacity})`;
}

function paintCursorValue(color, opacity = DEFAULT_PAINT_OPACITY, tool = 'brush', brushSize = DEFAULT_PAINT_BRUSH_SIZE) {
  const radius = normalizePaintBrushSize(brushSize);
  const cursorSize = radius * 2;
  const cursorCenter = radius;
  const cursorRadius = Math.max(1, radius - 1);
  const fill = tool === 'eraser' ? 'none' : encodeURIComponent(normalizePaintColor(color));
  const fillOpacity = tool === 'eraser' ? '' : ` fill-opacity='${normalizePaintOpacity(opacity)}'`;
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${cursorSize}' height='${cursorSize}' viewBox='0 0 ${cursorSize} ${cursorSize}'%3E%3Ccircle cx='${cursorCenter}' cy='${cursorCenter}' r='${cursorRadius}' fill='${fill}'${fillOpacity} stroke='black' stroke-width='2'/%3E%3C/svg%3E") ${cursorCenter} ${cursorCenter}, crosshair`;
}

function normalizeRingTemplateSelection(value) {
  if (value === 'benzene') {
    return value;
  }
  const normalizedSize = Number(value);
  return Number.isInteger(normalizedSize) ? normalizedSize : null;
}

/**
 * Creates a small active-button synchronizer for toolbar controls.
 * @param {string[]} items - Supported toolbar item values.
 * @param {(item: string) => HTMLElement|HTMLElement[]|null} getButton - Button lookup callback.
 * @returns {{sync: (activeValue: string) => void, clear: () => void}} Synchronizer helpers.
 */
function createButtonSynchronizer(items, getButton) {
  function forEachButton(item, callback) {
    const buttons = getButton(item);
    const list = Array.isArray(buttons) ? buttons : [buttons];
    for (const button of list) {
      if (button) {
        callback(button);
      }
    }
  }

  return {
    sync(activeValue) {
      for (const item of items) {
        forEachButton(item, button => {
          button.classList.toggle('active', item === activeValue);
        });
      }
    },
    clear() {
      for (const item of items) {
        forEachButton(item, button => {
          button.classList.remove('active');
        });
      }
    }
  };
}

/**
 * Creates selection action handlers for tool-mode toggling, element/bond-type
 * switching, and toolbar button synchronization.
 * @param {object} context - Dependency context providing state, view, DOM, renderers, and actions.
 * @returns {object} Selection action API and sync/clear button helpers.
 */
export function createSelectionActions(context) {
  function setDrawBondDrawerHoverSuppressed(value) {
    context.dom.drawTools?.classList?.toggle?.('drawer-hover-suppressed', value);
  }

  function setRingTemplateDrawerHoverSuppressed(value) {
    context.dom.drawTools?.classList?.toggle?.('drawer-hover-suppressed', value);
  }

  const doc = context.document ?? globalThis.document ?? null;

  if (context.dom.drawTools && typeof context.dom.drawTools.addEventListener === 'function' && !context.dom.drawTools.__bondDrawerHoverSuppressBound) {
    context.dom.drawTools.addEventListener('mouseleave', () => {
      setDrawBondDrawerHoverSuppressed(false);
    });
    context.dom.drawTools.__bondDrawerHoverSuppressBound = true;
  }

  if (doc && context.dom.drawTools && typeof doc.addEventListener === 'function' && !context.dom.drawTools.__bondDrawerOutsideCloseBound) {
    doc.addEventListener(
      'pointerdown',
      event => {
        const hasOpenDrawer =
          context.dom.drawTools?.classList?.contains?.('drawer-open') || context.dom.drawTools?.classList?.contains?.('ring-template-drawer-open');
        if (!hasOpenDrawer) {
          return;
        }
        if (typeof event?.target?.closest === 'function' && event.target.closest('#draw-tools')) {
          return;
        }
        closeDrawBondDrawer();
        closeRingTemplateDrawer();
      },
      true
    );
    context.dom.drawTools.__bondDrawerOutsideCloseBound = true;
  }

  if (
    doc &&
    context.dom &&
    typeof doc.addEventListener === 'function' &&
    typeof context.dom.getPeriodicTablePopover === 'function' &&
    !context.dom.__periodicTableOutsideCloseBound
  ) {
    doc.addEventListener(
      'pointerdown',
      event => {
        const popover = context.dom.getPeriodicTablePopover?.();
        if (!popover || popover.hidden) {
          return;
        }
        const button = context.dom.getPeriodicTableButton?.();
        const target = event?.target ?? null;
        if (target === button || target === popover) {
          return;
        }
        if (typeof button?.contains === 'function' && button.contains(target)) {
          return;
        }
        if (typeof popover.contains === 'function' && popover.contains(target)) {
          return;
        }
        closePeriodicTablePicker();
      },
      true
    );
    context.dom.__periodicTableOutsideCloseBound = true;
  }

  function setPeriodicTableDragOffset(popover, x, y) {
    popover.__periodicTableDragX = x;
    popover.__periodicTableDragY = y;
    popover.style?.setProperty?.('--periodic-table-drag-x', `${x}px`);
    popover.style?.setProperty?.('--periodic-table-drag-y', `${y}px`);
  }

  function anchorPeriodicTablePopover(popover) {
    const button = context.dom.getPeriodicTableButton?.();
    const buttonRect = button?.getBoundingClientRect?.();
    const win = doc?.defaultView ?? (typeof window !== 'undefined' ? window : null);
    const viewportWidth = win?.innerWidth;
    if (!buttonRect || !Number.isFinite(buttonRect.top) || !Number.isFinite(buttonRect.left) || !Number.isFinite(viewportWidth)) {
      return;
    }
    const wasHidden = popover.hidden === true;
    const previousVisibility = popover.style?.visibility ?? '';
    if (wasHidden) {
      popover.hidden = false;
      if (popover.style) {
        popover.style.visibility = 'hidden';
      }
    }
    const popoverRect = popover.getBoundingClientRect?.();
    if (wasHidden) {
      popover.hidden = true;
      if (popover.style) {
        popover.style.visibility = previousVisibility;
      }
    }
    const popoverWidth = Number.isFinite(popoverRect?.width) && popoverRect.width > 0 ? popoverRect.width : 497;
    const popoverHeight = Number.isFinite(popoverRect?.height) && popoverRect.height > 0 ? popoverRect.height : 297;
    const viewportHeight = win?.innerHeight;
    const buttonWidth = Number.isFinite(buttonRect.width) ? buttonRect.width : 32;
    const buttonCenterX = buttonRect.left + buttonWidth / 2;
    const centeredLeft = buttonCenterX - popoverWidth / 2;
    const left = Math.max(8, Math.min(centeredLeft, viewportWidth - popoverWidth - 8));
    const preferredTop = buttonRect.top - popoverHeight - 8;
    const top = Number.isFinite(viewportHeight)
      ? Math.max(8, Math.min(preferredTop, viewportHeight - popoverHeight - 8))
      : Math.max(8, preferredTop);
    popover.style?.setProperty?.('--periodic-table-popover-top', `${top}px`);
    popover.style?.setProperty?.('--periodic-table-popover-left', `${left}px`);
  }

  if (doc && typeof doc.addEventListener === 'function' && typeof context.dom.getPeriodicTablePopover === 'function') {
    const popover = context.dom.getPeriodicTablePopover?.();
    if (popover && typeof popover.addEventListener === 'function' && !popover.__periodicTableDragBound) {
      popover.addEventListener(
        'click',
        event => {
          if (!popover.__periodicTableSuppressClick) {
            return;
          }
          popover.__periodicTableSuppressClick = false;
          event.preventDefault?.();
          event.stopPropagation?.();
        },
        true
      );
      popover.addEventListener('pointerdown', event => {
        if (popover.hidden) {
          return;
        }
        const startX = event.clientX ?? 0;
        const startY = event.clientY ?? 0;
        const baseX = popover.__periodicTableDragX ?? 0;
        const baseY = popover.__periodicTableDragY ?? 0;
        let moved = false;

        const handlePointerMove = moveEvent => {
          const deltaX = (moveEvent.clientX ?? startX) - startX;
          const deltaY = (moveEvent.clientY ?? startY) - startY;
          if (!moved && Math.hypot(deltaX, deltaY) < 3) {
            return;
          }
          moved = true;
          popover.classList?.add?.('periodic-table-dragging');
          moveEvent.preventDefault?.();
          const nextX = baseX + deltaX;
          const nextY = baseY + deltaY;
          setPeriodicTableDragOffset(popover, nextX, nextY);
        };
        const handlePointerUp = () => {
          if (moved) {
            popover.__periodicTableSuppressClick = true;
          }
          popover.classList?.remove?.('periodic-table-dragging');
          doc.removeEventListener?.('pointermove', handlePointerMove);
          doc.removeEventListener?.('pointerup', handlePointerUp);
          doc.removeEventListener?.('pointercancel', handlePointerUp);
        };

        doc.addEventListener('pointermove', handlePointerMove);
        doc.addEventListener('pointerup', handlePointerUp);
        doc.addEventListener('pointercancel', handlePointerUp);
      });
      popover.__periodicTableDragBound = true;
    }
  }

  function syncDrawBondButtonIcon() {
    const activeType = context.state.overlayState.getDrawBondType?.() ?? 'single';
    const sourceButton = context.dom.getBondDrawTypeButton?.(activeType);
    const drawBondButton = context.dom.drawBondButton;
    if (!sourceButton || !drawBondButton || typeof sourceButton.innerHTML !== 'string') {
      return;
    }
    drawBondButton.innerHTML = sourceButton.innerHTML;
  }

  function syncRingTemplateButtonIcon() {
    const activeSize = context.state.overlayState.getRingTemplateSize?.() ?? 6;
    const sourceButton = context.dom.getRingTemplateSizeButton?.(activeSize);
    const ringTemplateButton = context.dom.ringTemplateButton;
    if (!sourceButton || !ringTemplateButton || typeof sourceButton.innerHTML !== 'string') {
      return;
    }
    ringTemplateButton.innerHTML = sourceButton.innerHTML;
  }

  function openDrawBondDrawer() {
    setDrawBondDrawerHoverSuppressed(false);
    context.dom.drawTools?.classList?.add('drawer-open');
  }

  function closeDrawBondDrawer() {
    context.dom.drawTools?.classList?.remove('drawer-open');
    setDrawBondDrawerHoverSuppressed(false);
  }

  function openRingTemplateDrawer() {
    setRingTemplateDrawerHoverSuppressed(false);
    context.dom.drawTools?.classList?.add('ring-template-drawer-open');
  }

  function closeRingTemplateDrawer() {
    context.dom.drawTools?.classList?.remove('ring-template-drawer-open');
    setRingTemplateDrawerHoverSuppressed(false);
  }

  function toggleRingTemplateDrawer() {
    if (!context.dom.drawTools?.classList) {
      return;
    }
    context.dom.drawTools.classList.toggle('ring-template-drawer-open');
  }

  function toggleDrawBondDrawer() {
    if (!context.dom.drawTools?.classList) {
      return;
    }
    context.dom.drawTools.classList.toggle('drawer-open');
  }

  function syncPeriodicTableButton() {
    const button = context.dom.getPeriodicTableButton?.();
    if (!button?.classList) {
      return;
    }
    const activeElement = context.state.overlayState.getDrawBondElement?.() ?? null;
    const drawBondMode = context.state.overlayState.getDrawBondMode?.() ?? false;
    const popover = context.dom.getPeriodicTablePopover?.();
    const pickerOpen = Boolean(popover && !popover.hidden);
    button.classList.toggle('active', pickerOpen || (drawBondMode && activeElement != null && !COMMON_DRAW_ELEMENTS.includes(activeElement)));
  }

  function setPeriodicTablePickerOpen(open) {
    const popover = context.dom.getPeriodicTablePopover?.();
    if (!popover) {
      return;
    }
    if (!open) {
      hidePeriodicTablePreview();
    }
    popover.hidden = !open;
    syncPeriodicTableButton();
  }

  function closePeriodicTablePicker() {
    setPeriodicTablePickerOpen(false);
  }

  function hidePeriodicTablePreview() {
    const grid = context.dom.getPeriodicTableGrid?.();
    const preview = grid?.__periodicTablePreview;
    if (!preview) {
      return;
    }
    preview.hidden = true;
    preview.dataset.periodicElement = '';
  }

  function showPeriodicTablePreview(symbol) {
    const grid = context.dom.getPeriodicTableGrid?.();
    const preview = grid?.__periodicTablePreview;
    const data = elements[symbol];
    if (!preview || !data) {
      return;
    }
    const color = atomColor(symbol);
    const weight = averageAtomicWeight(symbol);
    const name = ELEMENT_NAMES[symbol] ?? symbol;
    preview.hidden = false;
    preview.dataset.periodicElement = symbol;
    preview.style.backgroundColor = rgbaFromHex(color, 0.72);
    preview.style.color = readableTextColor(color);
    preview.__periodicPreviewNumber.textContent = String(data.protons);
    preview.__periodicPreviewSymbol.textContent = symbol;
    preview.__periodicPreviewName.textContent = name;
    preview.__periodicPreviewName.style.fontSize = previewElementNameFontSize(name);
    preview.__periodicPreviewWeight.textContent = weight == null ? '' : weight.toFixed(3);
  }

  function createPeriodicTablePreview(createElement) {
    const preview = createElement('div');
    preview.className = 'periodic-element-preview';
    preview.hidden = true;
    preview.setAttribute?.('aria-hidden', 'true');
    preview.style.gridRow = '2 / span 3';
    preview.style.gridColumn = '8 / span 3';

    const atomicNumber = createElement('div');
    atomicNumber.className = 'periodic-preview-number';
    const symbol = createElement('div');
    symbol.className = 'periodic-preview-symbol';
    const name = createElement('div');
    name.className = 'periodic-preview-name';
    const weight = createElement('div');
    weight.className = 'periodic-preview-weight';

    preview.appendChild(atomicNumber);
    preview.appendChild(symbol);
    preview.appendChild(name);
    preview.appendChild(weight);
    preview.__periodicPreviewNumber = atomicNumber;
    preview.__periodicPreviewSymbol = symbol;
    preview.__periodicPreviewName = name;
    preview.__periodicPreviewWeight = weight;
    return preview;
  }

  function ensurePeriodicTablePicker() {
    const grid = context.dom.getPeriodicTableGrid?.();
    if (!grid || grid.__periodicTablePickerReady) {
      return;
    }
    const createElement = doc?.createElement?.bind(doc);
    if (typeof createElement !== 'function') {
      return;
    }
    for (let column = 1; column <= 18; column++) {
      const label = createElement('div');
      label.className = 'periodic-table-column-label';
      label.textContent = String(column);
      label.style.gridRow = '1';
      label.style.gridColumn = String(column + 1);
      grid.appendChild(label);
    }
    for (let period = 1; period <= 7; period++) {
      const label = createElement('div');
      label.className = 'periodic-table-row-label';
      label.textContent = String(period);
      label.style.gridRow = String(period + 1);
      label.style.gridColumn = '1';
      grid.appendChild(label);
    }
    const preview = createPeriodicTablePreview(createElement);
    grid.__periodicTablePreview = preview;
    grid.appendChild(preview);
    for (const symbol of PERIODIC_TABLE_ELEMENTS) {
      const position = periodicTablePosition(symbol);
      if (!position) {
        continue;
      }
      const color = atomColor(symbol);
      const button = createElement('button');
      button.type = 'button';
      button.className = 'periodic-element-cell';
      button.textContent = symbol;
      button.title = elementTooltip(symbol);
      button.dataset.periodicElement = symbol;
      if (position.row >= 9) {
        button.classList.add('periodic-f-block-cell');
      }
      button.style.backgroundColor = color;
      button.style.color = readableTextColor(color);
      button.style.gridRow = String(position.row);
      button.style.gridColumn = String(position.column);
      button.addEventListener('mouseenter', () => {
        showPeriodicTablePreview(symbol);
      });
      button.addEventListener('focus', () => {
        showPeriodicTablePreview(symbol);
      });
      button.addEventListener('mouseleave', () => {
        hidePeriodicTablePreview();
      });
      button.addEventListener('blur', () => {
        hidePeriodicTablePreview();
      });
      button.addEventListener('click', () => {
        selectPeriodicElement(symbol);
      });
      grid.appendChild(button);
    }
    grid.__periodicTablePickerReady = true;
  }

  function openPeriodicTablePicker() {
    ensurePeriodicTablePicker();
    const popover = context.dom.getPeriodicTablePopover?.();
    if (popover) {
      anchorPeriodicTablePopover(popover);
    }
    setPeriodicTablePickerOpen(true);
    syncElementButtons();
  }

  function togglePeriodicTablePicker() {
    const popover = context.dom.getPeriodicTablePopover?.();
    if (!popover) {
      return;
    }
    if (popover.hidden) {
      openPeriodicTablePicker();
    } else {
      closePeriodicTablePicker();
    }
  }

  function selectPeriodicElement(element) {
    setDrawElement(element);
    closePeriodicTablePicker();
  }

  function syncToolButtonsFromState() {
    const selectMode = context.state.overlayState.getSelectMode();
    const drawBondMode = context.state.overlayState.getDrawBondMode();
    const ringTemplateMode = context.state.overlayState.getRingTemplateMode?.() ?? false;
    const eraseMode = context.state.overlayState.getEraseMode();
    const paintMode = context.state.overlayState.getPaintMode?.() ?? false;
    const chargeTool = context.state.overlayState.getChargeTool?.() ?? null;
    const panMode = !selectMode && !drawBondMode && !ringTemplateMode && !eraseMode && !paintMode && chargeTool == null;

    context.dom.panButton.classList.toggle('active', panMode);
    context.dom.selectButton.classList.toggle('active', selectMode);
    context.dom.drawBondButton.classList.toggle('active', drawBondMode);
    context.dom.ringTemplateButton?.classList?.toggle('active', ringTemplateMode);
    context.dom.plotElement?.classList?.toggle?.('ring-template-hover-expanded', ringTemplateMode);
    context.dom.eraseButton.classList.toggle('active', eraseMode);
    syncPaintButtons(paintMode);
    syncPaintCursor(paintMode);
    syncPaintButtonIcon();
    syncPaintToolButtons(paintMode);
    syncPaintToolStyles();
    syncPaintColorSelectors();
    syncPaintBrushSizeSelectors();
    syncPaintOpacitySelectors();
    syncChargeButtons();

    if (drawBondMode) {
      syncElementButtons();
      syncBondDrawTypeButtons();
      syncDrawBondButtonIcon();
    } else {
      clearElementButtons();
      clearBondDrawTypeButtons();
      closeDrawBondDrawer();
    }

    if (ringTemplateMode) {
      syncRingTemplateSizeButtons();
      syncRingTemplateButtonIcon();
    } else {
      clearRingTemplateSizeButtons();
      closeRingTemplateDrawer();
    }
  }

  const chargeSync = createButtonSynchronizer(CHARGE_TOOLS, tool => context.dom.getChargeToolButton?.(tool));
  const elementSync = createButtonSynchronizer(DRAW_ELEMENTS, element => context.dom.getElementButton(element));
  const bondTypeSync = createButtonSynchronizer(DRAW_BOND_TYPES, type => context.dom.getBondDrawTypeButton?.(type));
  const ringTemplateSizeSync = createButtonSynchronizer(RING_TEMPLATE_SIZES, size => context.dom.getRingTemplateSizeButton?.(size));
  const paintToolSync = createButtonSynchronizer(PAINT_TOOLS, tool => context.dom.getPaintToolButtons?.(tool) ?? []);
  bindPaintColorSelectors();
  bindPaintBrushSizeSelectors();
  bindPaintOpacitySelectors();

  function syncChargeButtons() {
    chargeSync.sync(context.state.overlayState.getChargeTool?.() ?? null);
  }
  function clearChargeButtons() {
    chargeSync.clear();
  }
  function syncPaintButtons(active = context.state.overlayState.getPaintMode?.() ?? false) {
    for (const button of context.dom.getStyleBrushButtons?.() ?? []) {
      button?.classList?.toggle?.('active', active);
    }
  }
  function syncPaintCursor(
    active = context.state.overlayState.getPaintMode?.() ?? false,
    color = context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR,
    opacity = context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY,
    tool = context.state.overlayState.getPaintTool?.() ?? 'brush',
    brushSize = context.state.overlayState.getPaintBrushSize?.() ?? DEFAULT_PAINT_BRUSH_SIZE
  ) {
    context.dom.plotElement?.style?.setProperty?.('--paint-mode-cursor', paintCursorValue(color, opacity, tool, brushSize));
    context.dom.plotElement?.classList?.toggle?.('paint-mode-cursor', active);
  }
  function notifyPaintSettingsChanged() {
    const EventCtor = context.document?.defaultView?.Event ?? globalThis.Event;
    if (typeof EventCtor !== 'function' || typeof context.dom.plotElement?.dispatchEvent !== 'function') {
      return;
    }
    context.dom.plotElement.dispatchEvent(new EventCtor(PAINT_SETTINGS_CHANGED_EVENT, { bubbles: true }));
  }
  function syncPaintButtonIcon(tool = context.state.overlayState.getPaintTool?.() ?? 'brush') {
    const sourceButtons = context.dom.getPaintToolButtons?.(tool) ?? [];
    const sourceButton = Array.isArray(sourceButtons) ? sourceButtons.find(button => typeof button?.innerHTML === 'string') : sourceButtons;
    if (!sourceButton || typeof sourceButton.innerHTML !== 'string') {
      return;
    }
    for (const button of context.dom.getStyleBrushButtons?.() ?? []) {
      if (button && typeof button.innerHTML === 'string') {
        button.innerHTML = sourceButton.innerHTML;
      }
    }
  }
  function syncPaintToolStyles(tool = context.state.overlayState.getPaintTool?.() ?? 'brush') {
    const eraserTool = tool === 'eraser';
    for (const button of context.dom.getStyleBrushButtons?.() ?? []) {
      button?.classList?.toggle?.('paint-eraser-tool', eraserTool);
    }
    syncPaintCursor(
      context.state.overlayState.getPaintMode?.() ?? false,
      context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR,
      context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY,
      tool,
      context.state.overlayState.getPaintBrushSize?.() ?? DEFAULT_PAINT_BRUSH_SIZE
    );
  }
  function syncPaintColorSelectors(color = normalizePaintColor(context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR)) {
    const normalizedColor = normalizePaintColor(color);
    const normalizedOpacity = normalizePaintOpacity(context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY);
    const swatchColor = paintSwatchColor(normalizedColor, normalizedOpacity);
    for (const selector of context.dom.getPaintColorSelectors?.() ?? []) {
      if (!selector) {
        continue;
      }
      if ('value' in selector) {
        selector.value = normalizedColor;
      }
      selector.style?.setProperty?.('--paint-color', normalizedColor);
      selector.style?.setProperty?.('--paint-opacity', String(normalizedOpacity));
      selector.style?.setProperty?.('--paint-swatch-color', swatchColor);
      if (selector.style) {
        selector.style.backgroundColor = swatchColor;
      }
    }
    for (const selector of context.dom.getPaintOpacitySelectors?.() ?? []) {
      selector?.style?.setProperty?.('--paint-color', normalizedColor);
    }
    syncPaintCursor(
      context.state.overlayState.getPaintMode?.() ?? false,
      normalizedColor,
      context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY,
      context.state.overlayState.getPaintTool?.() ?? 'brush',
      context.state.overlayState.getPaintBrushSize?.() ?? DEFAULT_PAINT_BRUSH_SIZE
    );
  }
  function setPaintColor(color) {
    const normalizedColor = normalizePaintColor(color);
    context.state.overlayState.setPaintColor?.(normalizedColor);
    syncPaintColorSelectors(normalizedColor);
    notifyPaintSettingsChanged();
  }
  function syncPaintBrushSizeSelectors(size = normalizePaintBrushSize(context.state.overlayState.getPaintBrushSize?.() ?? DEFAULT_PAINT_BRUSH_SIZE)) {
    const normalizedSize = normalizePaintBrushSize(size);
    for (const selector of context.dom.getPaintBrushSizeSelectors?.() ?? []) {
      if (!selector) {
        continue;
      }
      if ('value' in selector) {
        selector.value = String(normalizedSize);
      }
    }
    syncPaintCursor(
      context.state.overlayState.getPaintMode?.() ?? false,
      context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR,
      context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY,
      context.state.overlayState.getPaintTool?.() ?? 'brush',
      normalizedSize
    );
  }
  function setPaintBrushSize(size) {
    const normalizedSize = normalizePaintBrushSize(size);
    context.state.overlayState.setPaintBrushSize?.(normalizedSize);
    syncPaintBrushSizeSelectors(normalizedSize);
    notifyPaintSettingsChanged();
  }
  function syncPaintOpacitySelectors(opacity = normalizePaintOpacity(context.state.overlayState.getPaintOpacity?.() ?? DEFAULT_PAINT_OPACITY)) {
    const normalizedOpacity = normalizePaintOpacity(opacity);
    const normalizedColor = normalizePaintColor(context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR);
    const swatchColor = paintSwatchColor(normalizedColor, normalizedOpacity);
    for (const selector of context.dom.getPaintOpacitySelectors?.() ?? []) {
      if (!selector) {
        continue;
      }
      if ('value' in selector) {
        selector.value = String(normalizedOpacity);
      }
      selector.style?.setProperty?.('--paint-opacity', String(normalizedOpacity));
      selector.style?.setProperty?.('--paint-color', normalizedColor);
    }
    for (const selector of context.dom.getPaintColorSelectors?.() ?? []) {
      selector?.style?.setProperty?.('--paint-opacity', String(normalizedOpacity));
      selector?.style?.setProperty?.('--paint-swatch-color', swatchColor);
      if (selector?.style) {
        selector.style.backgroundColor = swatchColor;
      }
    }
    syncPaintCursor(
      context.state.overlayState.getPaintMode?.() ?? false,
      context.state.overlayState.getPaintColor?.() ?? DEFAULT_PAINT_COLOR,
      normalizedOpacity,
      context.state.overlayState.getPaintTool?.() ?? 'brush',
      context.state.overlayState.getPaintBrushSize?.() ?? DEFAULT_PAINT_BRUSH_SIZE
    );
  }
  function setPaintOpacity(opacity) {
    const normalizedOpacity = normalizePaintOpacity(opacity);
    context.state.overlayState.setPaintOpacity?.(normalizedOpacity);
    syncPaintOpacitySelectors(normalizedOpacity);
    notifyPaintSettingsChanged();
  }
  function bindPaintColorSelectors() {
    for (const selector of context.dom.getPaintColorSelectors?.() ?? []) {
      if (!selector || typeof selector.addEventListener !== 'function' || selector.__paintColorSyncBound) {
        continue;
      }
      const handleColorInput = () => {
        setPaintColor(selector.value);
      };
      selector.addEventListener('input', handleColorInput);
      selector.addEventListener('change', handleColorInput);
      selector.__paintColorSyncBound = true;
    }
  }
  function bindPaintBrushSizeSelectors() {
    for (const selector of context.dom.getPaintBrushSizeSelectors?.() ?? []) {
      if (!selector || typeof selector.addEventListener !== 'function' || selector.__paintBrushSizeSyncBound) {
        continue;
      }
      const handleBrushSizeInput = () => {
        setPaintBrushSize(selector.value);
      };
      selector.addEventListener('input', handleBrushSizeInput);
      selector.addEventListener('change', handleBrushSizeInput);
      selector.__paintBrushSizeSyncBound = true;
    }
  }
  function bindPaintOpacitySelectors() {
    for (const selector of context.dom.getPaintOpacitySelectors?.() ?? []) {
      if (!selector || typeof selector.addEventListener !== 'function' || selector.__paintOpacitySyncBound) {
        continue;
      }
      const handleOpacityInput = () => {
        setPaintOpacity(selector.value);
      };
      selector.addEventListener('input', handleOpacityInput);
      selector.addEventListener('change', handleOpacityInput);
      selector.__paintOpacitySyncBound = true;
    }
  }
  function setPaintMode(value) {
    context.state.overlayState.setPaintMode?.(value);
    syncPaintButtons(value);
    syncPaintCursor(value);
    syncPaintButtonIcon();
    syncPaintToolButtons(value);
    syncPaintToolStyles();
    syncPaintColorSelectors();
    syncPaintBrushSizeSelectors();
    syncPaintOpacitySelectors();
  }
  function syncPaintToolButtons(active = context.state.overlayState.getPaintMode?.() ?? false) {
    if (active) {
      paintToolSync.sync(context.state.overlayState.getPaintTool?.() ?? 'brush');
    } else {
      paintToolSync.clear();
    }
  }
  function syncElementButtons() {
    elementSync.sync(context.state.overlayState.getDrawBondElement());
    syncPeriodicTableButton();
  }
  function clearElementButtons() {
    elementSync.clear();
    closePeriodicTablePicker();
    syncPeriodicTableButton();
  }
  function syncBondDrawTypeButtons() {
    bondTypeSync.sync(context.state.overlayState.getDrawBondType?.() ?? 'single');
  }
  function clearBondDrawTypeButtons() {
    bondTypeSync.clear();
  }
  function syncRingTemplateSizeButtons() {
    ringTemplateSizeSync.sync(context.state.overlayState.getRingTemplateSize?.() ?? 6);
  }
  function clearRingTemplateSizeButtons() {
    ringTemplateSizeSync.clear();
  }

  function rerenderToolOverlay() {
    if (context.state.viewState.getMode() === 'force') {
      context.renderers.applyForceSelection();
    } else if (context.state.documentState.getMol2d()) {
      context.renderers.draw2d();
    }
  }

  function enterPaintMode() {
    setPaintMode(true);
    context.state.overlayState.setSelectMode(false);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    context.state.overlayState.setErasePainting(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.panButton.classList.remove('active');
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
  }

  function togglePanMode() {
    if (
      !context.state.overlayState.getSelectMode() &&
      !context.state.overlayState.getDrawBondMode() &&
      !(context.state.overlayState.getRingTemplateMode?.() ?? false) &&
      !context.state.overlayState.getEraseMode() &&
      !(context.state.overlayState.getPaintMode?.() ?? false) &&
      (context.state.overlayState.getChargeTool?.() ?? null) == null
    ) {
      return;
    }
    context.state.overlayState.setSelectMode(false);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    setPaintMode(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.panButton.classList.add('active');
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
    rerenderToolOverlay();
  }

  function toggleSelectMode() {
    if (context.state.overlayState.getSelectMode()) {
      return;
    }
    context.state.overlayState.setSelectMode(true);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    setPaintMode(false);
    context.state.overlayState.setChargeTool?.(null);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    clearChargeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.selectButton.classList.add('active');
    context.dom.panButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
  }

  function togglePaintMode() {
    const next = !(context.state.overlayState.getPaintMode?.() ?? false);
    if (next) {
      enterPaintMode();
    } else {
      setPaintMode(false);
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      clearChargeButtons();
    }
    rerenderToolOverlay();
  }

  function setPaintTool(tool) {
    if (!PAINT_TOOLS.includes(tool)) {
      return;
    }
    context.state.overlayState.setPaintTool?.(tool);
    if (!(context.state.overlayState.getPaintMode?.() ?? false)) {
      enterPaintMode();
      rerenderToolOverlay();
      return;
    }
    syncPaintButtonIcon(tool);
    syncPaintToolButtons(true);
    syncPaintToolStyles(tool);
    syncPaintColorSelectors();
    syncPaintOpacitySelectors();
    notifyPaintSettingsChanged();
  }

  function toggleDrawBondMode() {
    const next = !context.state.overlayState.getDrawBondMode();
    context.state.overlayState.setDrawBondMode(next);
    const btn = context.dom.drawBondButton;
    if (next) {
      context.state.overlayState.setSelectMode(false);
      context.state.overlayState.setRingTemplateMode?.(false);
      context.state.overlayState.setEraseMode(false);
      setPaintMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.eraseButton.classList.remove('active');
      clearChargeButtons();
      clearRingTemplateSizeButtons();
      closeRingTemplateDrawer();
      context.dom.ringTemplateButton?.classList?.remove('active');
      btn.classList.add('active');
      syncElementButtons();
      syncBondDrawTypeButtons();
      syncDrawBondButtonIcon();
    } else {
      context.drawBond.cancelDrawBond();
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      btn.classList.remove('active');
      clearElementButtons();
      clearBondDrawTypeButtons();
      clearChargeButtons();
      closeDrawBondDrawer();
      closeRingTemplateDrawer();
    }
    rerenderToolOverlay();
  }

  function toggleRingTemplateMode() {
    const next = !(context.state.overlayState.getRingTemplateMode?.() ?? false);
    context.state.overlayState.setRingTemplateMode?.(next);
    const btn = context.dom.ringTemplateButton;
    if (next) {
      context.state.overlayState.setSelectMode(false);
      context.state.overlayState.setDrawBondMode(false);
      context.state.overlayState.setEraseMode(false);
      setPaintMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.drawBondButton.classList.remove('active');
      context.dom.eraseButton.classList.remove('active');
      clearElementButtons();
      clearBondDrawTypeButtons();
      clearChargeButtons();
      closeDrawBondDrawer();
      btn?.classList?.add('active');
      syncRingTemplateSizeButtons();
      syncRingTemplateButtonIcon();
    } else {
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      btn?.classList?.remove('active');
      clearRingTemplateSizeButtons();
      clearChargeButtons();
      closeRingTemplateDrawer();
    }
    rerenderToolOverlay();
  }

  function toggleEraseMode() {
    const next = !context.state.overlayState.getEraseMode();
    context.state.overlayState.setEraseMode(next);
    const btn = context.dom.eraseButton;
    if (next) {
      context.state.overlayState.setSelectMode(false);
      context.state.overlayState.setDrawBondMode(false);
      context.state.overlayState.setRingTemplateMode?.(false);
      setPaintMode(false);
      context.state.overlayState.setChargeTool?.(null);
      context.drawBond.cancelDrawBond();
      clearElementButtons();
      clearBondDrawTypeButtons();
      clearChargeButtons();
      closeDrawBondDrawer();
      closeRingTemplateDrawer();
      context.dom.panButton.classList.remove('active');
      context.dom.selectButton.classList.remove('active');
      context.dom.drawBondButton.classList.remove('active');
      context.dom.ringTemplateButton?.classList?.remove('active');
      btn.classList.add('active');
      if (context.state.overlayState.getSelectedAtomIds().size > 0 || context.state.overlayState.getSelectedBondIds().size > 0) {
        context.actions.deleteSelection();
        return;
      }
      context.view.clearPrimitiveHover();
    } else {
      context.state.overlayState.setErasePainting(false);
      context.view.clearPrimitiveHover();
      context.dom.panButton.classList.add('active');
      btn.classList.remove('active');
      clearChargeButtons();
    }
    rerenderToolOverlay();
  }

  function setChargeTool(tool) {
    if (!CHARGE_TOOLS.includes(tool)) {
      return;
    }
    const currentTool = context.state.overlayState.getChargeTool?.() ?? null;
    const nextTool = currentTool === tool ? null : tool;
    context.state.overlayState.setChargeTool?.(nextTool);
    context.state.overlayState.setSelectMode(false);
    context.state.overlayState.setDrawBondMode(false);
    context.state.overlayState.setRingTemplateMode?.(false);
    context.state.overlayState.setEraseMode(false);
    setPaintMode(false);
    context.drawBond.cancelDrawBond();
    context.view.clearPrimitiveHover();
    clearElementButtons();
    clearBondDrawTypeButtons();
    closeDrawBondDrawer();
    closeRingTemplateDrawer();
    context.dom.selectButton.classList.remove('active');
    context.dom.drawBondButton.classList.remove('active');
    context.dom.ringTemplateButton?.classList?.remove('active');
    context.dom.eraseButton.classList.remove('active');
    context.dom.panButton.classList.toggle('active', nextTool == null);
    syncChargeButtons();
    rerenderToolOverlay();
  }

  function setRingTemplateSize(size) {
    const normalizedSize = normalizeRingTemplateSelection(size);
    if (!RING_TEMPLATE_SIZES.includes(normalizedSize)) {
      return;
    }
    context.state.overlayState.setRingTemplateSize?.(normalizedSize);
    if (!(context.state.overlayState.getRingTemplateMode?.() ?? false)) {
      toggleRingTemplateMode();
    } else {
      syncRingTemplateSizeButtons();
    }
    syncRingTemplateButtonIcon();
    context.state.ringTemplateDrag?.refreshFreePreview?.();
    context.state.ringTemplateDrag?.refreshAnchoredPreview?.();
    closeRingTemplateDrawer();
    setRingTemplateDrawerHoverSuppressed(true);
  }

  function setDrawElement(element) {
    if (!elements[element]) {
      return;
    }
    context.state.overlayState.setDrawBondElement(element);
    if (!context.state.overlayState.getDrawBondMode()) {
      toggleDrawBondMode();
    } else {
      syncElementButtons();
    }
  }

  function setDrawBondType(type) {
    if (!DRAW_BOND_TYPES.includes(type)) {
      return;
    }
    context.state.overlayState.setDrawBondType?.(type);
    if (!context.state.overlayState.getDrawBondMode()) {
      toggleDrawBondMode();
    } else {
      syncBondDrawTypeButtons();
    }
    syncDrawBondButtonIcon();
    closeDrawBondDrawer();
    setDrawBondDrawerHoverSuppressed(true);
  }

  function handleDrawBondButtonClick() {
    toggleDrawBondMode();
  }

  function handleRingTemplateButtonClick() {
    toggleRingTemplateMode();
  }

  return {
    togglePanMode,
    toggleSelectMode,
    togglePaintMode,
    setPaintTool,
    setPaintColor,
    setPaintBrushSize,
    setPaintOpacity,
    toggleDrawBondMode,
    toggleRingTemplateMode,
    setRingTemplateSize,
    toggleEraseMode,
    setChargeTool,
    setDrawElement,
    setDrawBondType,
    handleDrawBondButtonClick,
    handleRingTemplateButtonClick,
    openDrawBondDrawer,
    closeDrawBondDrawer,
    openRingTemplateDrawer,
    closeRingTemplateDrawer,
    toggleDrawBondDrawer,
    toggleRingTemplateDrawer,
    openPeriodicTablePicker,
    closePeriodicTablePicker,
    togglePeriodicTablePicker,
    selectPeriodicElement,
    syncToolButtonsFromState,
    syncElementButtons,
    clearElementButtons,
    syncBondDrawTypeButtons,
    clearBondDrawTypeButtons,
    syncRingTemplateSizeButtons,
    clearRingTemplateSizeButtons,
    syncRingTemplateButtonIcon,
    syncChargeButtons,
    clearChargeButtons,
    syncDrawBondButtonIcon
  };
}
