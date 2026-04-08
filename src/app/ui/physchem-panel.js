/** @module app/ui/physchem-panel */

/**
 * Initialises the physicochemical properties panel with row hover, tooltip, and lock interactions.
 * @param {object} context - Flat app context providing DOM accessors, tooltip, and configuration values.
 * @returns {void}
 */
export function initPhyschemPanel(context) {
  const pcTable = context.dom.getTableElement();
  const tooltip = context.tooltip;
  const tooltipDelayMs = context.tooltipDelayMs ?? 2000;

  let tipTimer = null;
  let highlightRow = null;
  let lockedRow = null;
  let tooltipRow = null;
  let tooltipCell = null;
  let tooltipPoint = null;

  const physchemRowSnapshotKey = tr =>
    tr
      ? {
          label: tr.cells?.[0]?.textContent ?? '',
          desc: tr.dataset.desc ?? '',
          highlight: tr.dataset.highlight ?? ''
        }
      : null;

  const findRowFromSnapshot = key => {
    if (!key) {
      return null;
    }
    return (
      [...pcTable.querySelectorAll('tr[data-highlight]')].find(
        row => (row.cells?.[0]?.textContent ?? '') === key.label && (row.dataset.desc ?? '') === key.desc && (row.dataset.highlight ?? '') === key.highlight
      ) ?? null
    );
  };

  const setRowHighlight = tr => {
    pcTable.querySelectorAll('tr.pc-hover').forEach(row => row.classList.remove('pc-hover'));
    if (tr) {
      tr.classList.add('pc-hover');
    }
  };

  const syncLockedRow = () => {
    if (lockedRow && !lockedRow.isConnected) {
      lockedRow = null;
    }
  };

  const hideTooltip = () => {
    clearTimeout(tipTimer);
    tipTimer = null;
    tooltipRow = null;
    tooltipCell = null;
    tooltipPoint = null;
    tooltip.style('opacity', 0);
  };

  const showTooltip = () => {
    if (!tooltipRow?.dataset.desc || !tooltipPoint) {
      return;
    }
    tooltip
      .html(`<div style="max-width:220px;white-space:normal;line-height:1.4">${tooltipRow.dataset.desc}</div>`)
      .style('left', `${tooltipPoint.x + 14}px`)
      .style('top', `${tooltipPoint.y - 10}px`)
      .style('opacity', 0.95);
  };

  const applyHighlight = tr => {
    if (!tr?.dataset.highlight) {
      return false;
    }
    try {
      const groups = JSON.parse(tr.dataset.highlight);
      if (!Array.isArray(groups)) {
        return false;
      }
      if (groups.length === 0) {
        context.highlights.setHighlight(null);
        return true;
      }
      context.highlights.setHighlight(
        groups.map(group => new Map(group.map(id => [id, id]))),
        { style: 'physchem' }
      );
      return true;
    } catch {
      return false;
    }
  };

  context.highlights.setPersistentHighlightFallback(
    () => {
      syncLockedRow();
      if (!lockedRow) {
        return false;
      }
      setRowHighlight(lockedRow);
      return applyHighlight(lockedRow);
    },
    {
      key: 'physchem',
      isActive: () => {
        syncLockedRow();
        return !!lockedRow;
      }
    }
  );

  pcTable.addEventListener('mousemove', event => {
    syncLockedRow();
    const tr = event.target.closest('tr[data-desc]');
    if (tr !== highlightRow) {
      highlightRow = tr ?? null;
      if (!lockedRow) {
        setRowHighlight(highlightRow);
        if (!highlightRow || !applyHighlight(highlightRow)) {
          context.highlights.restorePersistentHighlight();
        }
      }
    }
    if (lockedRow) {
      setRowHighlight(lockedRow);
      if (tr !== lockedRow) {
        hideTooltip();
        return;
      }
    }
    const td = event.target.closest('td');
    const onTooltipCell = !!(tr && td && td === tr.cells[0]);
    if (!onTooltipCell) {
      hideTooltip();
      return;
    }
    tooltipPoint = { x: event.clientX, y: event.clientY };
    const tooltipVisible = tooltip.style('opacity') !== '0';
    const tooltipTargetChanged = tr !== tooltipRow || td !== tooltipCell;
    if (tooltipTargetChanged) {
      clearTimeout(tipTimer);
      tooltipRow = tr;
      tooltipCell = td;
    }
    if (tooltipVisible) {
      showTooltip();
      return;
    }
    if (tooltipTargetChanged) {
      tipTimer = setTimeout(() => {
        tipTimer = null;
        showTooltip();
      }, tooltipDelayMs);
    }
  });

  pcTable.addEventListener('click', event => {
    syncLockedRow();
    const tr = event.target.closest('tr[data-highlight]');
    if (!tr) {
      return;
    }
    if (lockedRow === tr) {
      lockedRow = null;
      if (highlightRow?.isConnected) {
        setRowHighlight(highlightRow);
        if (!applyHighlight(highlightRow)) {
          context.highlights.restorePersistentHighlight();
        }
      } else {
        setRowHighlight(null);
        context.highlights.restorePersistentHighlight();
      }
      return;
    }
    lockedRow = tr;
    highlightRow = tr;
    setRowHighlight(tr);
    if (!applyHighlight(tr)) {
      context.highlights.restorePersistentHighlight();
    }
  });

  pcTable.addEventListener('mouseleave', () => {
    syncLockedRow();
    highlightRow = null;
    hideTooltip();
    if (lockedRow) {
      setRowHighlight(lockedRow);
      if (!applyHighlight(lockedRow)) {
        context.highlights.restorePersistentHighlight();
      }
      return;
    }
    setRowHighlight(null);
    context.highlights.restorePersistentHighlight();
  });

  return {
    captureSnapshot: () => ({
      lockedRow: physchemRowSnapshotKey(lockedRow)
    }),
    restoreSnapshot: snapshot => {
      syncLockedRow();
      hideTooltip();
      highlightRow = null;
      lockedRow = null;
      const row = findRowFromSnapshot(snapshot?.lockedRow ?? null);
      if (!row) {
        setRowHighlight(null);
        return false;
      }
      lockedRow = row;
      highlightRow = row;
      setRowHighlight(row);
      return applyHighlight(row);
    }
  };
}
