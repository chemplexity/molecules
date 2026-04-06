import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => {
    throw error;
  });
});

async function loadSmiles(page, smiles) {
  const input = page.locator('#smiles-input');
  await input.fill(smiles);
  await input.press('Enter');
}

async function loadInchi(page, inchi) {
  const input = page.locator('#smiles-input');
  await input.fill(inchi);
  await input.press('Enter');
}

async function bondSignature(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('line.bond-hit')).map(line => ({
      x1: Number(line.getAttribute('x1') ?? 0).toFixed(2),
      y1: Number(line.getAttribute('y1') ?? 0).toFixed(2),
      x2: Number(line.getAttribute('x2') ?? 0).toFixed(2),
      y2: Number(line.getAttribute('y2') ?? 0).toFixed(2)
    }))
  );
}

async function stereoGlyphState(page) {
  return await page.evaluate(() => ({
    wedgeCount: document.querySelectorAll('polygon.bond-wedge').length,
    hashCount: document.querySelectorAll('line.bond-hash').length
  }));
}

async function rootTransform(page) {
  return await page.evaluate(() => document.querySelector('.svg-plot > g')?.getAttribute('transform') ?? null);
}

async function forceNodesWithinPlot(page, padding = 4) {
  return await page.evaluate(pad => {
    const plot = document.querySelector('.svg-plot');
    if (!plot) {
      return false;
    }
    const plotRect = plot.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll('circle.node'));
    if (nodes.length === 0) {
      return false;
    }
    return nodes.every(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= plotRect.left + pad &&
        rect.top >= plotRect.top + pad &&
        rect.right <= plotRect.right - pad &&
        rect.bottom <= plotRect.bottom - pad;
    });
  }, padding);
}

test('input changes participate in undo/redo through the real browser UI', async ({ page }) => {
  await page.goto('/index.html');

  const input = page.locator('#smiles-input');
  await loadSmiles(page, 'CCO');
  await expect(input).toHaveValue('CCO');

  await loadSmiles(page, 'CCC');
  await expect(input).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(input).toHaveValue('CCO');
});

test('undo restores the prior InChI text after switching input format', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#inchi-mode-btn').click();

  const ethanolInchi = 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3';
  await expect(page.locator('#smiles-input')).toHaveValue(ethanolInchi);

  const propaneInchi = 'InChI=1S/C3H8/c1-3-2/h3H2,1-2H3';
  await loadInchi(page, propaneInchi);
  await expect(page.locator('#smiles-input')).toHaveValue(propaneInchi);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue(ethanolInchi);
});

test('input format toggle participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);

  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#inchi-mode-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#redo-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');
});

test('undo restores pasted SMILES correctly after auto-switching out of InChI mode', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  const input = page.locator('#smiles-input');
  await input.fill('CCC');
  await input.evaluate(element => {
    element.dispatchEvent(new Event('paste', { bubbles: true }));
  });
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(input).toHaveValue('CCC');

  await loadSmiles(page, 'CCN');
  await expect(input).toHaveValue('CCN');

  await page.locator('#undo-btn').click();
  await expect(input).toHaveValue('CCC');
});

test('undo after pasting SMILES in InChI mode restores the prior InChI-backed molecule text', async ({ page }) => {
  await page.goto('/index.html');

  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  await page.evaluate(() => {
    const entries = window.randomMolecule.filter(entry => entry.inchi);
    window.parseInput(entries[0].inchi);
    window.parseInput(entries[1].inchi);
  });

  const beforePaste = await page.locator('#smiles-input').inputValue();
  expect(beforePaste.startsWith('InChI=')).toBeTruthy();

  await page.evaluate(() => {
    const input = document.getElementById('smiles-input');
    input.focus();
    input.setSelectionRange(0, input.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', 'CCC');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue(beforePaste);
});

test('undo restores pasted SMILES after editing a pasted molecule that auto-switched out of InChI mode', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCN');
  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  const input = page.locator('#smiles-input');
  await input.fill('CCO');
  await input.evaluate(element => {
    element.dispatchEvent(new Event('paste', { bubbles: true }));
  });
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(input).toHaveValue('CCO');

  await page.locator('#erase-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');
  await expect(input).toHaveValue('CC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(input).toHaveValue('CCO');
});

test('undo restores pasted SMILES after an immediate molecule change from InChI paste mode', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  await page.evaluate(() => {
    const input = document.getElementById('smiles-input');
    input.focus();
    input.setSelectionRange(0, input.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', 'CCC');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    window.parseInput('CCN');
  });

  await expect(page.locator('#smiles-input')).toHaveValue('CCN');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');
});

test('undo preserves localized aromatic rendering for anthracene after loading another molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=CC2=CC3=CC=CC=C3C=C2C=C1');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length,
        hits: document.querySelectorAll('line.bond-hit').length
      }))
    )
    .toEqual({ dashed: 0, hits: 16 });

  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('C1=CC2=CC3=CC=CC=C3C=C2C=C1');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length,
        hits: document.querySelectorAll('line.bond-hit').length
      }))
    )
    .toEqual({ dashed: 0, hits: 16 });
});

test('undo preserves localized aromatic rendering for rotated aza-aromatic ring systems', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length
      }))
    )
    .toEqual({ dashed: 0 });

  await page.locator('#force-rotate-cw').click();
  await page.locator('#undo-btn').click();

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length
      }))
    )
    .toEqual({ dashed: 0 });
});

test('undo restores selection mode and selected atoms as part of the app session', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  const selectedCircleCount = await page.locator('g.atom-selection circle').count();
  expect(selectedCircleCount).toBeGreaterThan(0);

  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(selectedCircleCount);
});

test('undo after hovered delete in selection mode does not restore a sticky synthetic selection', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');
  await expect(page.locator('#smiles-input')).toHaveValue('CC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
});

test('undo after deleting a real selection restores the atoms without restoring the old selection', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.keyboard.press('Delete');
  await expect(page.locator('#smiles-input')).toHaveValue('CC');
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
});

test('drawing a new 2d bond clears an existing 2d selection highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.locator('#draw-bond-btn').click();
  const oxygen = page.locator('g[data-atom-id="O3"] .atom-hit');
  const box = await oxygen.boundingBox();
  expect(box).toBeTruthy();

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY - 50, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('#smiles-input')).toHaveValue('CCOC');
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
});

test('editing a 2d atom clears selection and immediately restores the hovered highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('N');

  await expect(page.locator('#smiles-input')).toHaveValue('CCN');
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
});

test('changing a 2d bond immediately restores the hovered highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  const targetBond = page.locator('line.bond-hit').nth(1);
  await targetBond.hover();
  await targetBond.click();

  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
  await expect(page.locator('g.atom-selection line')).not.toHaveCount(0);
});

test('2d line mode increases the atom hit target radius', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');

  const atomHit = page.locator('g[data-atom-id="O3"] .atom-hit');
  const baseRadius = Number(await atomHit.getAttribute('r'));
  expect(Number.isFinite(baseRadius)).toBeTruthy();

  await page.locator('#draw-bond-btn').click();

  const drawModeRadius = Number(await page.locator('g[data-atom-id="O3"] .atom-hit').getAttribute('r'));
  expect(drawModeRadius).toBeGreaterThan(baseRadius);
});

test('physicochemical row locks do not persist through undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Physicochemical' }).click();

  const fsp3Row = page.locator('#pc-body tr').filter({ hasText: 'Fsp3 (carbons)' }).first();
  await expect(fsp3Row).toBeVisible();
  await fsp3Row.click();
  await expect(fsp3Row).toHaveClass(/pc-hover/);

  await loadSmiles(page, 'CCC');
  await page.locator('#undo-btn').click();
  await expect(fsp3Row).not.toHaveClass(/pc-hover/);

  await page.locator('#redo-btn').click();
  await page.locator('#undo-btn').click();
  await expect(fsp3Row).not.toHaveClass(/pc-hover/);
});

test('the resonance tab does not persist through undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=CC=CC=C1');
  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.getByRole('button', { name: 'Other' })).toHaveClass(/active/);

  await loadSmiles(page, 'CCO');
  await page.locator('#undo-btn').click();

  await expect(page.getByRole('button', { name: 'Functional Groups' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Other' })).not.toHaveClass(/active/);
});

test('functional group rows stay visible when selecting one during reaction preview', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const reactionRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await reactionRow.click();
  await expect(reactionRow).toHaveClass(/reaction-active/);

  await page.getByRole('button', { name: 'Functional Groups' }).click();
  const beforeCount = await page.locator('#fg-body tr').count();
  expect(beforeCount).toBeGreaterThan(0);

  const alcoholRow = page.locator('#fg-body tr').filter({ hasText: 'Alcohol' }).first();
  await alcoholRow.click();

  await expect(page.locator('#fg-body tr')).toHaveCount(beforeCount);
});

test('delete key removes a hovered atom while erase mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#erase-btn').click();
  await expect(page.locator('#erase-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue('CC');
});

test('delete key removes a hovered atom while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue('CC');
});

test('delete key removes a hovered bond while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('line.bond-hit')).toHaveCount(2);

  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  await page.locator('line.bond-hit').nth(1).hover();
  await page.keyboard.press('Delete');

  await expect(page.locator('line.bond-hit')).toHaveCount(1);
});

test('delete key is a no-op for a hovered force hydrogen while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.locator('#draw-bond-btn').click();

  const beforeAttempt = await page.locator('#smiles-input').inputValue();
  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const hydrogenTarget = [...forceAtoms].find(atom => atom.label === 'H');
  expect(hydrogenTarget).toBeTruthy();

  await page.mouse.move(hydrogenTarget.cx, hydrogenTarget.cy);
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue(beforeAttempt);
});

test('delete key is a no-op for a hovered force C-H bond while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.locator('#draw-bond-btn').click();

  const beforeAttempt = await page.locator('#smiles-input').inputValue();
  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const hydrogenTarget = forceAtoms.find(atom => atom.label === 'H') ?? null;
  expect(hydrogenTarget).toBeTruthy();
  const nearestCarbon = forceAtoms
    .filter(atom => atom.label === 'C')
    .sort((a, b) => Math.hypot(a.cx - hydrogenTarget.cx, a.cy - hydrogenTarget.cy) - Math.hypot(b.cx - hydrogenTarget.cx, b.cy - hydrogenTarget.cy))[0];
  expect(nearestCarbon).toBeTruthy();

  await page.mouse.move((hydrogenTarget.cx + nearestCarbon.cx) / 2, (hydrogenTarget.cy + nearestCarbon.cy) / 2);
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue(beforeAttempt);
});

test('drawing a new force bond keeps the force scene visible', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(9);

  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const carbonSource = [...forceAtoms].filter(atom => atom.label === 'C').sort((a, b) => a.cx - b.cx)[0] ?? null;
  expect(carbonSource).toBeTruthy();

  await page.mouse.move(carbonSource.cx, carbonSource.cy);
  await page.mouse.down();
  await page.mouse.move(carbonSource.cx - 70, carbonSource.cy - 35, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('circle.node')).toHaveCount(12);
  await expect(page.locator('.svg-plot > g')).toBeVisible();
  await expect(page.locator('#smiles-input')).toHaveValue(/C/);
});

test('editing a force atom updates the implicit hydrogens around the edited atom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(6);
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const oxygenTarget = [...forceAtoms].filter(atom => atom.label === 'O').sort((a, b) => b.cx - a.cx)[0] ?? null;
  expect(oxygenTarget).toBeTruthy();

  await page.mouse.move(oxygenTarget.cx, oxygenTarget.cy);
  await page.keyboard.press('C');

  await expect(page.locator('#smiles-input')).toHaveValue('CC');
  await expect(page.locator('circle.node')).toHaveCount(8);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const circles = Array.from(document.querySelectorAll('circle.node'));
        const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
        const atoms = circles.map((circle, index) => {
          const rect = circle.getBoundingClientRect();
          return {
            label: labels[index]?.textContent?.trim() ?? '',
            cx: rect.left + rect.width / 2,
            cy: rect.top + rect.height / 2
          };
        });
        const carbons = atoms.filter(atom => atom.label === 'C').sort((a, b) => b.cx - a.cx);
        const hydrogens = atoms.filter(atom => atom.label === 'H');
        const editedCarbon = carbons[0] ?? null;
        if (!editedCarbon) {
          return 0;
        }
        return hydrogens.filter(atom => Math.hypot(atom.cx - editedCarbon.cx, atom.cy - editedCarbon.cy) < 45).length;
      })
    )
    .toBeGreaterThanOrEqual(3);
});

test('reaction preview can be entered and toggled back off from the reactions table', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
});

test('reaction preview ignores a disconnected 2d draw after it has been undone', async ({ page }) => {
  await page.goto('/index.html');

  const initialSmiles = 'CC(=O)C(Cl)CC(C(C)C)C=C';
  await expect(page.locator('#smiles-input')).toHaveValue(initialSmiles);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const hydrogenationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alkene Hydrogenation' }).first();
  await expect(hydrogenationRow).toBeVisible();

  await hydrogenationRow.click();
  await expect(hydrogenationRow).toHaveClass(/reaction-active/);
  const baselinePreview = JSON.stringify(await bondSignature(page));

  await hydrogenationRow.click();
  await expect(hydrogenationRow).not.toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  await page.mouse.click(plotBox.x + plotBox.width - 120, plotBox.y + plotBox.height - 120);

  await expect(page.locator('#smiles-input')).not.toHaveValue(initialSmiles);
  await expect(page.locator('#smiles-input')).toHaveValue(/\./);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue(initialSmiles);

  await hydrogenationRow.click();
  await expect(hydrogenationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => JSON.stringify(await bondSignature(page))).toBe(baselinePreview);
});

test('exiting reaction preview restores the prior 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
});

test('exiting reaction preview restores a manually zoomed 2d transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);
  const beforePreviewBonds = await bondSignature(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
  await expect.poll(async () => JSON.stringify(await bondSignature(page))).toBe(JSON.stringify(beforePreviewBonds));
});

test('editing from reaction preview restores the pre-preview 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await page.locator('#draw-bond-btn').click();
  const oxygen = page.locator('g[data-atom-id="O3"] .atom-hit');
  const box = await oxygen.boundingBox();
  expect(box).toBeTruthy();

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY - 50, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
});

test('exiting reaction preview restores the prior force zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('exiting reaction preview after switching from force back to 2d restores the 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  const beforeForcePreview = await rootTransform(page);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforeForcePreview);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('Force');
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforeForcePreview);
});

test('reaction preview entry participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  const beforePreviewBondCount = await page.locator('line.bond-hit').count();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();
  expect(previewBondCount).toBeGreaterThan(beforePreviewBondCount);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(beforePreviewBondCount);

  await page.locator('#redo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);
});

test('reaction preview site navigation updates the active site count label', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'OCCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('#reaction-body tr.reaction-active .reaction-site-label')).toHaveText('1/2');

  await dehydrationRow.locator('button[title="Next reaction site"]').click();
  await expect(page.locator('#reaction-body tr.reaction-active .reaction-site-label')).toHaveText('2/2');

  await page.locator('#reaction-body tr.reaction-active button[title="Previous reaction site"]').click();
  await expect(page.locator('#reaction-body tr.reaction-active .reaction-site-label')).toHaveText('1/2');
});

test('reaction preview does not change the molecular weight summary', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  const beforeWeight = await page.locator('#molecularWeight').textContent();

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('#molecularWeight')).toHaveText(beforeWeight ?? '');
});

test('switching SMILES/InChI format in reaction preview keeps the source molecule input', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');

  await page.locator('#smiles-mode-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
});

test('mode toggle participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  const toggleButton = page.locator('#toggle-btn');

  await expect(toggleButton).toHaveText('⚡ Force Layout');
  await toggleButton.click();
  await expect(toggleButton).toHaveText('⬡ 2D Structure');

  await page.locator('#undo-btn').click();
  await expect(toggleButton).toHaveText('⚡ Force Layout');

  await page.locator('#redo-btn').click();
  await expect(toggleButton).toHaveText('⬡ 2D Structure');
});

test('undo after mode toggle restores the prior 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);

  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforeToggle = await rootTransform(page);
  const toggleButton = page.locator('#toggle-btn');
  await toggleButton.click();
  await expect(toggleButton).toHaveText('⬡ 2D Structure');

  await page.locator('#undo-btn').click();
  await expect(toggleButton).toHaveText('⚡ Force Layout');
  await expect.poll(async () => rootTransform(page)).toBe(beforeToggle);
});

test('undo and redo preserve 2d zoom after a simple atom edit', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforeEdit = await rootTransform(page);

  await page.locator('#elem-btn-N').click();
  await page.locator('circle.atom-hit').first().click();
  await expect(page.locator('#smiles-input')).not.toHaveValue('CCO');
  const afterEdit = await rootTransform(page);
  await expect(afterEdit).toBe(beforeEdit);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect.poll(async () => rootTransform(page)).toBe(beforeEdit);

  await page.locator('#redo-btn').click();
  await expect(page.locator('#smiles-input')).not.toHaveValue('CCO');
  await expect.poll(async () => rootTransform(page)).toBe(beforeEdit);
});

test('redo restores the fitted 2d zoom for a newly loaded molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforeLoad = await rootTransform(page);

  await loadSmiles(page, 'CCCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCCC');
  const afterLoad = await rootTransform(page);
  await expect(afterLoad).not.toBe(beforeLoad);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect.poll(async () => rootTransform(page)).toBe(beforeLoad);

  await page.locator('#redo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCCC');
  await expect.poll(async () => rootTransform(page)).toBe(afterLoad);
});

test('reaction preview entry refits 2d zoom and redo restores that preview fit', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const previewTransform = await rootTransform(page);
  await expect(previewTransform).not.toBe(beforePreview);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).toBe(beforePreview);

  await page.locator('#redo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).toBe(previewTransform);
});

test('reaction preview entry refits force zoom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).not.toBe(beforePreview);
});

test('undoing a force-mode molecule change still allows switching back to a visible 2d structure', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('line.bond-hit')).toHaveCount(2);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⚡ Force Layout');
  await expect(page.locator('line.bond-hit')).toHaveCount(2);
  await expect(page.locator('circle.atom-hit')).toHaveCount(3);
});

test('reaction preview redo restores the rotated preview geometry', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const beforeRotate = await bondSignature(page);
  await page.locator('#rotate-cw').click();
  const afterRotate = await bondSignature(page);
  await expect(afterRotate).not.toEqual(beforeRotate);

  await page.locator('#undo-btn').click();
  const afterUndo = await bondSignature(page);
  await expect(afterUndo).toEqual(beforeRotate);
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#redo-btn').click();
  const afterRedo = await bondSignature(page);
  await expect(afterRedo).toEqual(afterRotate);
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
});

test('clicking a resonance structure from force reaction preview restores the pre-preview force zoom and keeps the molecule in view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(=O)C(Cl)CC(C(C)C)C=C');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await expect(reductionRow).toBeVisible();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect.poll(async () => rootTransform(page)).toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('clicking a resonance structure from 2d reaction preview restores the pre-preview zoom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await expect(reductionRow).toBeVisible();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect.poll(async () => rootTransform(page)).toBe(beforePreview);
});

test('bond electronegativity toggle does not exit reaction preview', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const bondEnRow = page.locator('#bond-en-body tr').filter({ hasText: 'Bond Electronegativity' }).first();
  await expect(bondEnRow).toBeVisible();
  await bondEnRow.click();
  await expect(bondEnRow).toHaveClass(/resonance-active/);

  await page.getByRole('button', { name: 'Reactions' }).click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);
});

test('force SVG export includes charge labels', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/index.html');

  await loadSmiles(page, 'C[NH3+]');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('g.charge-label')).toHaveCount(1);

  await page.locator('#copy-force-svg-btn').click();

  const readForceSvgClipboard = async () =>
    page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (!item.types.includes('image/svg+xml')) {
          continue;
        }
        const blob = await item.getType('image/svg+xml');
        return await blob.text();
      }
      return '';
    });

  await expect.poll(readForceSvgClipboard).not.toBe('');
  const svgText = await readForceSvgClipboard();

  expect(svgText).toContain('charge-label');
  expect(svgText).toContain('charge-label-text');
  expect(svgText).not.toContain('-9999');
  expect(svgText).not.toContain('<line></line>');
});

test('flipping the view swaps wedge and dash stereo display', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C[C@H](F)Cl');
  const beforeFlip = await stereoGlyphState(page);
  expect(beforeFlip.wedgeCount + beforeFlip.hashCount).toBeGreaterThan(0);

  await page.locator('#flip-h').click();
  const afterHorizontalFlip = await stereoGlyphState(page);
  expect(afterHorizontalFlip.wedgeCount).toBe(beforeFlip.hashCount > 0 ? 1 : 0);
  expect(afterHorizontalFlip.hashCount > 0).toBe(beforeFlip.wedgeCount > 0);

  await page.locator('#flip-v').click();
  const afterVerticalFlip = await stereoGlyphState(page);
  expect(afterVerticalFlip).toEqual(beforeFlip);
});

test('undo after editing from reaction preview restores the locked preview state', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
});

test('undo after dragging from reaction preview restores the locked preview state', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const atomHit = page.locator('g[data-atom-id="O3"] .atom-hit').first();
  const beforeDrag = await bondSignature(page);
  const box = await atomHit.boundingBox();
  if (!box) {
    throw new Error('Expected a draggable atom hit target for O3');
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();

  const afterDrag = await bondSignature(page);
  await expect(afterDrag).not.toEqual(beforeDrag);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const afterUndo = await bondSignature(page);
  await expect(afterUndo).toEqual(beforeDrag);
});

test('dragging a bond onto a hydrogen from reaction preview is a no-op', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  const beforeAttempt = await bondSignature(page);
  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const hydrogenTarget = [...forceAtoms].filter(atom => atom.label === 'H').sort((a, b) => a.cx - b.cx)[0] ?? null;
  const carbonSource = [...forceAtoms].filter(atom => atom.label === 'C').sort((a, b) => a.cx - b.cx)[0] ?? null;
  expect(hydrogenTarget).toBeTruthy();
  expect(carbonSource).toBeTruthy();

  await page.mouse.move(carbonSource.cx, carbonSource.cy);
  await page.mouse.down();
  await page.mouse.move(hydrogenTarget.cx, hydrogenTarget.cy, { steps: 8 });
  await page.mouse.up();

  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(await bondSignature(page)).toEqual(beforeAttempt);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
});

test('undo after loading a new molecule from reaction preview restores the locked preview state', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const beforeReplace = await bondSignature(page);
  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');
  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  const afterUndo = await bondSignature(page);
  await expect(afterUndo).toEqual(beforeReplace);
});

test('undo and redo stay coherent when leaving reaction preview through resonance view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await resonanceRow.click();
  await expect(reductionRow).not.toHaveClass(/reaction-active/);
  await expect(resonanceRow).toHaveClass(/resonance-active/);

  await page.locator('#undo-btn').click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);

  await page.locator('#redo-btn').click();
  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' })).toHaveCount(0);
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
});

test('undo after editing from a locked resonance view leaves the resonance row unlocked', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();

  await expect(resonanceRow).toBeVisible();
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('2/2');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(resonanceRow).not.toContainText('2/2');
});

test('redo after editing from a locked resonance view also leaves the resonance row unlocked', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();

  await expect(resonanceRow).toBeVisible();
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(resonanceRow).not.toContainText('2/2');

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(resonanceRow).not.toContainText('2/2');
});
