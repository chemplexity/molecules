/** @module app/ui/export */

let ctx = {};

/**
 * Inject shared state references.  Call once after g and simulation are created.
 * @param {{ g, simulation, atomRadius, _mol2d }} context
 */
export function initExport(context) {
    ctx = context;
}

function _stripSolidBaseFromDashedBondPairs(root) {
    if (!root) return;
    for (const dashed of root.querySelectorAll('line.bond-dashed')) {
        const prev = dashed.previousElementSibling;
        if (!prev || prev.tagName !== 'line') continue;
        if (!prev.classList.contains('bond') || prev.classList.contains('bond-dashed')) continue;
        prev.remove();
    }
}

function _removeInteractionOverlays(root) {
    if (!root) return;
    for (const el of root.querySelectorAll('.atom-hit,.bond-hit,.bond-hover-target')) {
        el.remove();
    }
}

function _svgToPngBlob(svgEl, scale = 2) {
    const w = parseFloat(svgEl.getAttribute('width'));
    const h = parseFloat(svgEl.getAttribute('height'));
    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }));
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = w * scale;
            canvas.height = h * scale;
            const c = canvas.getContext('2d');
            c.scale(scale, scale);
            c.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob')), 'image/png');
        };
        img.onerror = reject;
        img.src = url;
    });
}

function _buildMolSvg(withWhiteBg, { atomBgFill = withWhiteBg ? 'white' : 'none' } = {}) {
    const { g } = ctx;
    const PAD  = 30;
    const bbox = g.node().getBBox();
    if (!bbox.width && !bbox.height) return null;

    const vbX = bbox.x - PAD,  vbY = bbox.y - PAD;
    const vbW = bbox.width  + PAD * 2;
    const vbH = bbox.height + PAD * 2;

    const ns    = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(ns, 'svg');
    svgEl.setAttribute('xmlns', ns);
    svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    svgEl.setAttribute('width',  vbW);
    svgEl.setAttribute('height', vbH);

    if (withWhiteBg) {
        const bgRect = document.createElementNS(ns, 'rect');
        bgRect.setAttribute('x', vbX);       bgRect.setAttribute('y', vbY);
        bgRect.setAttribute('width', vbW);   bgRect.setAttribute('height', vbH);
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
        '.atom-charge{font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold}',
    ].join(' ');
    svgEl.appendChild(styleEl);

    const gClone = g.node().cloneNode(true);
    gClone.removeAttribute('transform');
    _removeInteractionOverlays(gClone);
    _stripSolidBaseFromDashedBondPairs(gClone);
    svgEl.appendChild(gClone);

    return svgEl;
}

function _flashBtn(btn, resetLabel) {
    const reset = () => { btn.textContent = resetLabel; btn.style.fontSize = ''; btn.style.fontWeight = ''; };
    return {
        ok:   () => { btn.textContent = '✓'; btn.style.fontSize = '16px'; btn.style.fontWeight = 'normal'; setTimeout(reset, 1500); },
        fail: () => { btn.textContent = '✗'; btn.style.fontSize = '16px'; btn.style.fontWeight = 'normal'; setTimeout(reset, 1500); },
    };
}

export function copyForcePng() {
    const { simulation, g, atomRadius } = ctx;
    const PAD   = 30;
    const nodes = simulation.nodes();
    if (!nodes.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
        const r = atomRadius(n.protons);
        if (n.x - r < minX) minX = n.x - r;
        if (n.x + r > maxX) maxX = n.x + r;
        if (n.y - r < minY) minY = n.y - r;
        if (n.y + r > maxY) maxY = n.y + r;
    }

    const vbX = minX - PAD, vbY = minY - PAD;
    const vbW = (maxX - minX) + PAD * 2;
    const vbH = (maxY - minY) + PAD * 2;

    const ns    = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(ns, 'svg');
    svgEl.setAttribute('xmlns', ns);
    svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    svgEl.setAttribute('width',  vbW);
    svgEl.setAttribute('height', vbH);

    const bgRect = document.createElementNS(ns, 'rect');
    bgRect.setAttribute('x', vbX); bgRect.setAttribute('y', vbY);
    bgRect.setAttribute('width', vbW); bgRect.setAttribute('height', vbH);
    bgRect.setAttribute('fill', 'white');
    svgEl.appendChild(bgRect);

    const styleEl = document.createElementNS(ns, 'style');
    styleEl.textContent = [
        '.link{stroke:#696969;stroke-linecap:round;fill:none}',
        '.atom-symbol,.charge-label{font-family:Arial,Helvetica,sans-serif;font-weight:bold}',
        '.atom-symbol{font-size:9px;text-anchor:middle;dominant-baseline:central}',
        '.charge-label{font-size:11px}',
    ].join(' ');
    svgEl.appendChild(styleEl);

    const gClone = g.node().cloneNode(true);
    gClone.removeAttribute('transform');
    if (document.querySelector('.svg-plot').classList.contains('labels-hidden')) {
        gClone.querySelectorAll('.atom-symbol, .charge-label').forEach(el => el.remove());
    }
    svgEl.appendChild(gClone);

    const btn   = document.getElementById('copy-force-png-btn');
    const flash = _flashBtn(btn, 'PNG');
    navigator.clipboard.write([new ClipboardItem({ 'image/png': _svgToPngBlob(svgEl) })])
        .then(flash.ok).catch(flash.fail);
}

export function copySvg2d() {
    if (!ctx._mol2d) return;
    const svgEl = _buildMolSvg(true, { atomBgFill: 'none' });
    if (!svgEl) return;

    const btn   = document.getElementById('copy-svg-btn');
    const flash = _flashBtn(btn, 'SVG');
    navigator.clipboard.write([new ClipboardItem({ 'image/png': _svgToPngBlob(svgEl) })])
        .then(flash.ok).catch(flash.fail);
}

export function savePng2d() {
    if (!ctx._mol2d) return;
    const svgEl = _buildMolSvg(false);
    if (!svgEl) return;

    const btn   = document.getElementById('save-png-btn');
    const flash = _flashBtn(btn, 'PNG');
    navigator.clipboard.write([new ClipboardItem({ 'image/png': _svgToPngBlob(svgEl) })])
        .then(flash.ok).catch(flash.fail);
}
