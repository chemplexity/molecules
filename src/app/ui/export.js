/** @module app/ui/export */

import { atomRadius } from '../render/helpers.js';

let ctx = {};

/**
 * Inject shared state references.  Call once after g and simulation are created.
 * @param {{ g: object, simulation: object, _mol2d: object }} context - Shared SVG group, force simulation, and 2D molecule state.
 */
export function initExport(context) {
  ctx = context;
}

function _stripSolidBaseFromDashedBondPairs(root) {
  if (!root) {
    return;
  }
  for (const dashed of root.querySelectorAll('line.bond-dashed')) {
    const prev = dashed.previousElementSibling;
    if (!prev || prev.tagName !== 'line') {
      continue;
    }
    if (!prev.classList.contains('bond') || prev.classList.contains('bond-dashed')) {
      continue;
    }
    prev.remove();
  }
}

function _removeInteractionOverlays(root) {
  if (!root) {
    return;
  }
  for (const el of root.querySelectorAll('.atom-hit,.bond-hit,.bond-hover-target')) {
    el.remove();
  }
}

function _removeOffscreenExportArtifacts(root) {
  if (!root) {
    return;
  }
  for (const el of root.querySelectorAll('[transform*="-9999"],[transform*="-9999."]')) {
    el.remove();
  }
}

function _removeInvalidSvgGeometry(root) {
  if (!root) {
    return;
  }
  for (const line of root.querySelectorAll('line')) {
    const hasCoords = line.hasAttribute('x1') && line.hasAttribute('y1') && line.hasAttribute('x2') && line.hasAttribute('y2');
    if (!hasCoords) {
      line.remove();
    }
  }
  for (const circle of root.querySelectorAll('circle')) {
    const hasCoords = circle.hasAttribute('cx') && circle.hasAttribute('cy') && circle.hasAttribute('r');
    if (!hasCoords) {
      circle.remove();
    }
  }
  for (const text of root.querySelectorAll('text')) {
    const hasContent = (text.textContent ?? '').trim().length > 0;
    if (!hasContent) {
      text.remove();
    }
  }
  for (const path of root.querySelectorAll('path')) {
    const d = path.getAttribute('d');
    if (!d || !d.trim()) {
      path.remove();
    }
  }
}

function _replaceForceWhiteSeparatorsForTransparentExport(root) {
  if (!root) {
    return;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const separatorGroups = new Map();
  for (const separator of root.querySelectorAll('line.separator:not(.link)[data-bond-id]')) {
    const bondId = separator.getAttribute('data-bond-id');
    if (!bondId) {
      continue;
    }
    if (!separatorGroups.has(bondId)) {
      separatorGroups.set(bondId, []);
    }
    separatorGroups.get(bondId).push(separator);
  }

  const makeLine = (base, x1, y1, x2, y2, strokeWidth) => {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('class', 'link');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.style.stroke = '#696969';
    line.style.strokeWidth = `${strokeWidth}px`;
    line.style.strokeLinecap = 'round';
    if (base?.parentNode) {
      base.parentNode.insertBefore(line, base);
    }
    return line;
  };

  for (const [bondId, separators] of separatorGroups) {
    const base = root.querySelector(`line.link[data-bond-id="${bondId}"]`);
    if (!base || separators.length === 0) {
      continue;
    }
    const x1 = parseFloat(base.getAttribute('x1'));
    const y1 = parseFloat(base.getAttribute('y1'));
    const x2 = parseFloat(base.getAttribute('x2'));
    const y2 = parseFloat(base.getAttribute('y2'));
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) {
      continue;
    }
    const px = -dy / len;
    const py = dx / len;
    const baseWidth = parseFloat(base.style.strokeWidth || base.getAttribute('stroke-width') || '0');
    const separatorWidth = parseFloat(separators[0].style.strokeWidth || separators[0].getAttribute('stroke-width') || '0');
    const halfBase = baseWidth / 2;
    const halfSep = separatorWidth / 2;

    if (separators.length === 1) {
      const railWidth = Math.max(1, halfBase - halfSep);
      const railOffset = (halfBase + halfSep) / 2;
      makeLine(base, `${x1 + px * railOffset}`, `${y1 + py * railOffset}`, `${x2 + px * railOffset}`, `${y2 + py * railOffset}`, railWidth);
      makeLine(base, `${x1 - px * railOffset}`, `${y1 - py * railOffset}`, `${x2 - px * railOffset}`, `${y2 - py * railOffset}`, railWidth);
    } else if (separators.length === 2) {
      const offsets = separators.map(separator => {
        const sx1 = parseFloat(separator.getAttribute('x1'));
        const sy1 = parseFloat(separator.getAttribute('y1'));
        return (sx1 - x1) * px + (sy1 - y1) * py;
      });
      const d = Math.max(...offsets.map(Math.abs));
      const outerWidth = Math.max(1, halfBase - d - halfSep);
      const middleWidth = Math.max(1, 2 * (d - halfSep));
      const outerOffset = (halfBase + d + halfSep) / 2;
      makeLine(base, `${x1}`, `${y1}`, `${x2}`, `${y2}`, middleWidth);
      makeLine(base, `${x1 + px * outerOffset}`, `${y1 + py * outerOffset}`, `${x2 + px * outerOffset}`, `${y2 + py * outerOffset}`, outerWidth);
      makeLine(base, `${x1 - px * outerOffset}`, `${y1 - py * outerOffset}`, `${x2 - px * outerOffset}`, `${y2 - py * outerOffset}`, outerWidth);
    } else {
      continue;
    }

    base.remove();
    for (const separator of separators) {
      separator.remove();
    }
  }
}

function _svgToPngBlob(svgEl, scale = 2) {
  const w = parseFloat(svgEl.getAttribute('width'));
  const h = parseFloat(svgEl.getAttribute('height'));
  const svgStr = _serializeSvg(svgEl);
  const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const c = canvas.getContext('2d');
      c.scale(scale, scale);
      c.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
}

function _serializeSvg(svgEl) {
  return new XMLSerializer().serializeToString(svgEl);
}

function _measureClonedSvgBBox(gClone) {
  if (!gClone) {
    return null;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const probeSvg = document.createElementNS(ns, 'svg');
  probeSvg.setAttribute('xmlns', ns);
  probeSvg.setAttribute('width', '0');
  probeSvg.setAttribute('height', '0');
  probeSvg.style.position = 'fixed';
  probeSvg.style.left = '-9999px';
  probeSvg.style.top = '-9999px';
  probeSvg.style.opacity = '0';
  probeSvg.style.pointerEvents = 'none';
  probeSvg.style.overflow = 'visible';
  const probeClone = gClone.cloneNode(true);
  probeSvg.appendChild(probeClone);
  document.body.appendChild(probeSvg);
  try {
    const bbox = probeClone.getBBox();
    if (!Number.isFinite(bbox?.x) || !Number.isFinite(bbox?.y) || !Number.isFinite(bbox?.width) || !Number.isFinite(bbox?.height)) {
      return null;
    }
    return bbox;
  } catch {
    return null;
  } finally {
    probeSvg.remove();
  }
}

function _svgToDataUrl(svgStr) {
  const bytes = new TextEncoder().encode(svgStr);
  let binary = '';
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function _legacyCopyHtml(html, plainText = '') {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    host.contentEditable = 'true';
    host.setAttribute('aria-hidden', 'true');
    host.style.position = 'fixed';
    host.style.left = '-9999px';
    host.style.top = '0';
    host.style.opacity = '0';
    host.innerHTML = html;
    document.body.appendChild(host);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(host);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const onCopy = event => {
      event.preventDefault();
      event.clipboardData?.setData('text/html', html);
      if (plainText) {
        event.clipboardData?.setData('text/plain', plainText);
      }
    };

    document.addEventListener('copy', onCopy, { once: true });
    try {
      const ok = document.execCommand('copy');
      document.removeEventListener('copy', onCopy);
      selection?.removeAllRanges();
      host.remove();
      if (!ok) {
        reject(new Error('execCommand copy failed'));
        return;
      }
      resolve();
    } catch (error) {
      document.removeEventListener('copy', onCopy);
      selection?.removeAllRanges();
      host.remove();
      reject(error);
    }
  });
}

async function _copySvgToClipboard(svgEl) {
  const svgStr = _serializeSvg(svgEl);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });
  const html = `<img src="${_svgToDataUrl(svgStr)}" alt="molecule" width="${svgEl.getAttribute('width')}" height="${svgEl.getAttribute('height')}">`;
  const htmlBlob = new Blob([html], { type: 'text/html' });
  const pngBlobPromise = _svgToPngBlob(svgEl);
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/svg+xml': svgBlob,
          'image/png': pngBlobPromise,
          'text/html': htmlBlob
        })
      ]);
      return;
    } catch {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': pngBlobPromise,
            'text/html': htmlBlob
          })
        ]);
        return;
      } catch {
        // Fall back to legacy HTML copy / plain-text clipboard write below.
      }
    }
  }
  try {
    await _legacyCopyHtml(html, svgStr);
    return;
  } catch {
    // Final fallback below.
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(svgStr);
    return;
  }
  throw new Error('Clipboard SVG export is not supported in this browser');
}

function _buildMolSvg(withWhiteBg, { atomBgFill = withWhiteBg ? 'white' : 'none' } = {}) {
  const { g } = ctx;
  const cleanup = typeof ctx.prepare2dExport === 'function' ? ctx.prepare2dExport() : null;
  try {
    const PAD = 30;
    const bbox = g.node().getBBox();
    if (!bbox.width && !bbox.height) {
      return null;
    }

    const vbX = bbox.x - PAD,
      vbY = bbox.y - PAD;
    const vbW = bbox.width + PAD * 2;
    const vbH = bbox.height + PAD * 2;

    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(ns, 'svg');
    svgEl.setAttribute('xmlns', ns);
    svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    svgEl.setAttribute('width', vbW);
    svgEl.setAttribute('height', vbH);

    if (withWhiteBg) {
      const bgRect = document.createElementNS(ns, 'rect');
      bgRect.setAttribute('x', vbX);
      bgRect.setAttribute('y', vbY);
      bgRect.setAttribute('width', vbW);
      bgRect.setAttribute('height', vbH);
      bgRect.setAttribute('fill', 'white');
      svgEl.appendChild(bgRect);
    }

    const styleEl = document.createElementNS(ns, 'style');
    styleEl.textContent = [
      '.bond{stroke:#333;stroke-linecap:round;fill:none}',
      '.bond-dashed{stroke-dasharray:5,3}',
      `.atom-bg{fill:${atomBgFill};stroke:none}`,
      '.atom-hit,.bond-hit,.bond-hover-target{display:none}',
      '.atom-label{font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold}',
      '.atom-charge{font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold}'
    ].join(' ');
    svgEl.appendChild(styleEl);

    const gClone = g.node().cloneNode(true);
    gClone.removeAttribute('transform');
    _removeInteractionOverlays(gClone);
    _stripSolidBaseFromDashedBondPairs(gClone);
    if (atomBgFill === 'none') {
      for (const el of gClone.querySelectorAll('.atom-bg')) {
        el.remove();
      }
    } else {
      for (const el of gClone.querySelectorAll('.atom-bg')) {
        el.setAttribute('fill', atomBgFill);
        el.style.fill = atomBgFill;
        el.setAttribute('stroke', 'none');
        el.style.stroke = 'none';
      }
    }
    svgEl.appendChild(gClone);
    return svgEl;
  } finally {
    cleanup?.();
  }
}

function _buildForceSvg(withWhiteBg = true) {
  const { simulation, g } = ctx;
  const PAD = 30;
  const nodes = simulation.nodes();
  if (!nodes.length) {
    return null;
  }

  const gClone = g.node().cloneNode(true);
  gClone.removeAttribute('transform');
  _removeInteractionOverlays(gClone);
  _removeOffscreenExportArtifacts(gClone);
  _removeInvalidSvgGeometry(gClone);
  if (!withWhiteBg) {
    _replaceForceWhiteSeparatorsForTransparentExport(gClone);
  }
  if (document.querySelector('.svg-plot').classList.contains('labels-hidden')) {
    gClone.querySelectorAll('.atom-symbol').forEach(el => el.remove());
  }

  let contentBBox = _measureClonedSvgBBox(gClone);
  if (!contentBBox || (!contentBBox.width && !contentBBox.height)) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const r = atomRadius(n.protons);
      if (n.x - r < minX) {
        minX = n.x - r;
      }
      if (n.x + r > maxX) {
        maxX = n.x + r;
      }
      if (n.y - r < minY) {
        minY = n.y - r;
      }
      if (n.y + r > maxY) {
        maxY = n.y + r;
      }
    }
    contentBBox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  const vbX = contentBBox.x - PAD;
  const vbY = contentBBox.y - PAD;
  const vbW = contentBBox.width + PAD * 2;
  const vbH = contentBBox.height + PAD * 2;

  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(ns, 'svg');
  svgEl.setAttribute('xmlns', ns);
  svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svgEl.setAttribute('width', vbW);
  svgEl.setAttribute('height', vbH);

  if (withWhiteBg) {
    const bgRect = document.createElementNS(ns, 'rect');
    bgRect.setAttribute('x', vbX);
    bgRect.setAttribute('y', vbY);
    bgRect.setAttribute('width', vbW);
    bgRect.setAttribute('height', vbH);
    bgRect.setAttribute('fill', 'white');
    svgEl.appendChild(bgRect);
  }

  const styleEl = document.createElementNS(ns, 'style');
  styleEl.textContent = [
    '.link{stroke:#696969;stroke-linecap:round;fill:none}',
    '.atom-symbol,.charge-label-text{font-family:Arial,Helvetica,sans-serif;font-weight:bold}',
    '.atom-symbol{font-size:9px;text-anchor:middle;dominant-baseline:central}',
    '.charge-label-text{font-size:11px}',
    '.bond-hover-target{display:none}'
  ].join(' ');
  svgEl.appendChild(styleEl);

  svgEl.appendChild(gClone);
  return svgEl;
}

function _flashBtn(btn, resetLabel) {
  const reset = () => {
    btn.textContent = resetLabel;
    btn.style.fontSize = '';
    btn.style.fontWeight = '';
  };
  return {
    ok: () => {
      btn.textContent = '✓';
      btn.style.fontSize = '16px';
      btn.style.fontWeight = 'normal';
      setTimeout(reset, 1500);
    },
    fail: () => {
      btn.textContent = '✗';
      btn.style.fontSize = '16px';
      btn.style.fontWeight = 'normal';
      setTimeout(reset, 1500);
    }
  };
}

/**
 * Copies the current force-layout view as a PNG image to the clipboard.
 */
export function copyForcePng() {
  const svgEl = _buildForceSvg(false);
  if (!svgEl) {
    return;
  }

  const btn = document.getElementById('copy-force-png-btn');
  const flash = _flashBtn(btn, 'PNG');
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': _svgToPngBlob(svgEl) })])
    .then(flash.ok)
    .catch(flash.fail);
}

/**
 * Copies the current force-layout view as an SVG to the clipboard.
 */
export function copyForceSvg() {
  const svgEl = _buildForceSvg(true);
  if (!svgEl) {
    return;
  }

  const btn = document.getElementById('copy-force-svg-btn');
  const flash = _flashBtn(btn, 'SVG');
  _copySvgToClipboard(svgEl).then(flash.ok).catch(flash.fail);
}

/**
 * Copies the current 2D structure view as an SVG to the clipboard.
 */
export function copySvg2d() {
  if (!ctx._mol2d) {
    return;
  }
  const svgEl = _buildMolSvg(true, { atomBgFill: 'none' });
  if (!svgEl) {
    return;
  }

  const btn = document.getElementById('copy-svg-btn');
  const flash = _flashBtn(btn, 'SVG');
  _copySvgToClipboard(svgEl).then(flash.ok).catch(flash.fail);
}

/**
 * Copies the current 2D structure view as a PNG image to the clipboard.
 */
export function savePng2d() {
  if (!ctx._mol2d) {
    return;
  }
  const svgEl = _buildMolSvg(false);
  if (!svgEl) {
    return;
  }

  const btn = document.getElementById('save-png-btn');
  const flash = _flashBtn(btn, 'PNG');
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': _svgToPngBlob(svgEl) })])
    .then(flash.ok)
    .catch(flash.fail);
}
