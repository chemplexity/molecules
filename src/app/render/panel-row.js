/** @module app/render/panel-row */

/**
 * Builds a togglable On/Off panel row used by overlay panels (bond EN,
 * bond lengths, atom numbering).
 * @param {object} options - Panel row options.
 * @param {string} options.label - Row label text.
 * @param {string} options.title - Tooltip title.
 * @param {boolean} options.active - Whether the row is currently active.
 * @param {(event: MouseEvent) => void} options.onClick - Click handler; receives the raw event.
 * @returns {HTMLTableRowElement} Configured overlay panel row.
 */
export function createOverlayPanelRow({ label, title, active, onClick }) {
  const tr = document.createElement('tr');
  tr.classList.add('resonance-clickable');
  tr.title = title;
  if (active) {
    tr.classList.add('resonance-active');
  }

  const nameCell = document.createElement('td');
  const countCell = document.createElement('td');
  countCell.className = 'reaction-count';
  countCell.textContent = active ? 'On' : 'Off';

  const name = document.createElement('div');
  name.className = 'reaction-name';
  name.textContent = label;
  nameCell.appendChild(name);

  tr.appendChild(nameCell);
  tr.appendChild(countCell);
  tr.addEventListener('click', onClick);
  return tr;
}

/**
 * Builds a circular navigation button (‹ / ›) used in functional-group and
 * resonance panels. Mousedown triggers the action; click is suppressed to
 * prevent double-firing on the parent row.
 * @param {string} label - Button text (e.g. '‹' or '›').
 * @param {string} title - Tooltip title.
 * @param {() => void} onActivate - Callback invoked on mousedown.
 * @returns {HTMLButtonElement} Configured navigation button.
 */
export function createNavButton(label, title, onActivate) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reaction-nav-btn';
  btn.title = title;
  btn.textContent = label;
  btn.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  });
  btn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  return btn;
}
