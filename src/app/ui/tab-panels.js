/** @module app/ui/tab-panels */

function initTabGroup(buttons, panelsByTab) {
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(other => other.classList.remove('active'));
      panelsByTab.forEach(panel => {
        panel.style.display = 'none';
      });
      btn.classList.add('active');
      const panel = panelsByTab.get(btn.dataset.tab);
      if (panel) {
        panel.style.display = '';
      }
    });
  });
}

/**
 * Initialises all tab-group panels in the descriptor and SMARTS sections of the UI.
 * @param {object} [options] - Optional configuration.
 * @param {Document} [options.doc] - Document used for querying tab buttons and panels.
 */
export function initTabPanels({ doc = document } = {}) {
  const descButtons = [...doc.querySelectorAll('.desc-tab')];
  const descPanels = new Map(
    [...doc.querySelectorAll('.desc-tab-panel')].map(panel => [panel.id.replace(/^tab-/, ''), panel])
  );
  initTabGroup(descButtons, descPanels);

  const smartsButtons = [...doc.querySelectorAll('.smarts-tab')];
  const smartsPanels = new Map(
    [...doc.querySelectorAll('.smarts-tab-panel')].map(panel => [panel.id.replace(/^tab-/, ''), panel])
  );
  initTabGroup(smartsButtons, smartsPanels);
}
