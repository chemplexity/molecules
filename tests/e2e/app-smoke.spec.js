import { test, expect } from '@playwright/test';
import { morganRanks } from '../../src/algorithms/morgan.js';
import { parseSMILES } from '../../src/io/smiles.js';
import { analyzeRings } from '../../src/layout/engine/topology/ring-analysis.js';
import { FORCE_LAYOUT_BOND_LENGTH, FORCE_LAYOUT_REFERENCE_BOND_LENGTH } from '../../src/app/render/force-helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => {
    throw error;
  });
});

test('app boot does not hit unsupported module URLs', async ({ page }) => {
  const failedRequests = [];
  const consoleErrors = [];
  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? ''
    });
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/index.html');
  await expect(page.locator('#smiles-input')).toBeVisible();

  const unsupportedRequests = failedRequests.filter(request => request.url.startsWith('node:'));
  const unsupportedConsoleErrors = consoleErrors.filter(message => /unsupported url|node:perf_hooks/i.test(message));

  expect(unsupportedRequests).toEqual([]);
  expect(unsupportedConsoleErrors).toEqual([]);
});

test('cleaning 2d honors the active Global Bond Length option', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);

  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();

  await expect.poll(async () => await atomDistance(page, 'C1', 'C2')).toBeCloseTo(30, 6);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(async () => await atomDistance(page, 'C1', 'C2')).toBeCloseTo(30, 6);
});

test('blank-space ring preview matches the committed compact bond length', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await ensure2dMode(page);

  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await page.locator('#ring-template-btn').click();

  const { x, y } = await blankSvgPoint(page);

  await page.mouse.move(x, y);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);
  await page.waitForTimeout(100);

  const previewStats = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('g.ring-template-preview-layer line.ring-template-preview-bond:not(.ring-template-preview-double-bond)')];
    const endpoints = lines.flatMap(line => [
      { x: Number(line.getAttribute('x1')), y: Number(line.getAttribute('y1')) },
      { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) }
    ]);
    const center = endpoints.reduce(
      (sum, point) => ({ x: sum.x + point.x / endpoints.length, y: sum.y + point.y / endpoints.length }),
      { x: 0, y: 0 }
    );
    const lengths = lines.map(line => {
      const x1 = Number(line.getAttribute('x1'));
      const y1 = Number(line.getAttribute('y1'));
      const x2 = Number(line.getAttribute('x2'));
      const y2 = Number(line.getAttribute('y2'));
      return Math.hypot(x2 - x1, y2 - y1);
    });
    return { center, lengths };
  });

  expect(previewStats.lengths).toHaveLength(6);
  for (const length of previewStats.lengths) {
    expect(length).toBeCloseTo(30, 6);
  }

  const beforePlacementTransform = await rootTransform(page);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await rootTransform(page)).toBe(beforePlacementTransform);

  const committedLengths = await page.evaluate(center => {
    return [...document.querySelectorAll('line.bond')]
      .map(line => {
        const x1 = Number(line.getAttribute('x1'));
        const y1 = Number(line.getAttribute('y1'));
        const x2 = Number(line.getAttribute('x2'));
        const y2 = Number(line.getAttribute('y2'));
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        return {
          length: Math.hypot(x2 - x1, y2 - y1),
          distance: Math.hypot(midX - center.x, midY - center.y)
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6)
      .map(item => item.length);
  }, previewStats.center);

  expect(committedLengths).toHaveLength(6);
  for (const length of committedLengths) {
    expect(length).toBeCloseTo(30, 6);
  }
});

test('ring drawer selection updates the existing mouse-follow preview immediately', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await ensure2dMode(page);

  await page.locator('#ring-template-btn').click();
  const { x, y } = await blankSvgPoint(page);
  await page.mouse.move(x, y);

  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer line.ring-template-preview-double-bond')).toHaveCount(0);

  await page.evaluate(() => {
    document.querySelector('[data-ring-template-size="benzene"]')?.click();
  });

  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer line.ring-template-preview-double-bond')).toHaveCount(3);
});

test('line-mode blank-space ring placement keeps the viewport when everything stays visible', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);

  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await page.locator('#plot').hover();
  for (let index = 0; index < 6; index++) {
    await page.mouse.wheel(0, 700);
  }
  await page.waitForTimeout(100);
  await expect.poll(async () => await rootTransform(page)).not.toBe('translate(0,0) scale(1)');

  await page.locator('#ring-template-btn').click();
  const point = await blankSvgPoint(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);

  const beforeAtomPoint = await atomScreenPoint2d(page, 'C1');
  expect(beforeAtomPoint).toBeTruthy();
  const beforePlacementTransform = await rootTransform(page);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);

  expect(await rootTransform(page)).toBe(beforePlacementTransform);
  const afterAtomPoint = await atomScreenPoint2d(page, 'C1');
  expect(afterAtomPoint).toBeTruthy();
  expect(afterAtomPoint.cx).toBeCloseTo(beforeAtomPoint.cx, 1);
  expect(afterAtomPoint.cy).toBeCloseTo(beforeAtomPoint.cy, 1);
  await expect.poll(async () => await all2dAtomsWithinPlot(page)).toBe(true);
});

test('line-mode atom-anchored ring placement keeps the viewport when the result stays visible', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await loadSmiles(page, 'C');
  await ensure2dMode(page);

  await page.locator('#ring-template-btn').click();
  const atom = await atomScreenPoint2d(page, 'C1');
  expect(atom).toBeTruthy();

  const beforePlacementTransform = await rootTransform(page);
  await page.mouse.move(atom.cx, atom.cy);
  await page.mouse.down();
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await page.mouse.up();
  await page.waitForTimeout(100);

  expect(await rootTransform(page)).toBe(beforePlacementTransform);
  await expect.poll(async () => await all2dAtomsWithinPlot(page)).toBe(true);
});

test('line-mode blank-space bond placement refits when rendered geometry is clipped', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await ensure2dMode(page);

  const start = await page.evaluate(() => {
    const svg = document.querySelector('.svg-plot');
    const box = svg.getBoundingClientRect();
    return {
      x: box.right - 2,
      y: box.top + box.height / 2
    };
  });
  const beforePlacementTransform = await rootTransform(page);

  await page.locator('#draw-bond-btn').click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 80, start.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePlacementTransform);
  await expect.poll(async () => await plotGeometryWithinPlot(page, 0)).toBe(true);
});

test('force ring-template previews on atoms use the committed force bond length', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await loadSmiles(page, 'CCO');
  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
  const expectedForceRingLength = FORCE_LAYOUT_BOND_LENGTH * (0.5 / FORCE_LAYOUT_REFERENCE_BOND_LENGTH);

  const atom = (await forceAtomScreenPoints(page)).find(point => point.id === 'C1');
  expect(atom).toBeTruthy();
  await page.locator('#ring-template-btn').click();
  await page.mouse.move(atom.cx, atom.cy);
  await page.mouse.down();
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);

  const previewLength = await page.evaluate(() => {
    const line = document.querySelector('g.ring-template-preview line.link');
    if (!line) {
      return null;
    }
    const x1 = Number(line.getAttribute('x1'));
    const y1 = Number(line.getAttribute('y1'));
    const x2 = Number(line.getAttribute('x2'));
    const y2 = Number(line.getAttribute('y2'));
    return Math.hypot(x2 - x1, y2 - y1);
  });
  expect(previewLength).toBeCloseTo(expectedForceRingLength, 1);
  await page.mouse.up();
});

test('force ring-template previews on bonds use the committed force bond length', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await loadSmiles(page, 'CCO');
  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
  const expectedForceRingLength = FORCE_LAYOUT_BOND_LENGTH * (0.5 / FORCE_LAYOUT_REFERENCE_BOND_LENGTH);

  const bondPoint = await page.evaluate(() => {
    const line = [...document.querySelectorAll('line.link')].find(candidate => {
      const datum = candidate.__data__;
      return datum?.source?.name !== 'H' && datum?.target?.name !== 'H';
    });
    if (!line) {
      return null;
    }
    const x1 = Number(line.getAttribute('x1'));
    const y1 = Number(line.getAttribute('y1'));
    const x2 = Number(line.getAttribute('x2'));
    const y2 = Number(line.getAttribute('y2'));
    const matrix = line.getScreenCTM();
    const start = new DOMPoint(x1, y1).matrixTransform(matrix);
    const end = new DOMPoint(x2, y2).matrixTransform(matrix);
    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2
    };
  });
  expect(bondPoint).toBeTruthy();

  await page.locator('#ring-template-btn').click();
  await page.mouse.move(bondPoint.x, bondPoint.y);
  await page.mouse.down();
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);

  const previewLengths = await page.evaluate(() => {
    return [...document.querySelectorAll('g.ring-template-preview line.link')]
      .map(line => {
        const x1 = Number(line.getAttribute('x1'));
        const y1 = Number(line.getAttribute('y1'));
        const x2 = Number(line.getAttribute('x2'));
        const y2 = Number(line.getAttribute('y2'));
        return Math.hypot(x2 - x1, y2 - y1);
      })
      .filter(Number.isFinite);
  });
  expect(previewLengths.length).toBeGreaterThan(0);
  for (const length of previewLengths) {
    expect(length).toBeCloseTo(expectedForceRingLength, 1);
  }
  await page.mouse.up();
});

test('force-mode blank-space ring placement keeps the viewport when everything stays visible', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await loadSmiles(page, 'C1CCCCC1');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);

  await page.locator('#plot').hover();
  for (let index = 0; index < 4; index++) {
    await page.mouse.wheel(0, 700);
  }
  await page.waitForTimeout(100);
  await expect.poll(async () => await rootTransform(page)).not.toBe('translate(0,0) scale(1)');

  await page.locator('#ring-template-btn').click();
  const point = await blankSvgPoint(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);

  const beforeAtomPoint = (await forceAtomScreenPoints(page)).find(atom => atom.id === 'C1');
  expect(beforeAtomPoint).toBeTruthy();
  const beforePlacementTransform = await rootTransform(page);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);

  expect(await rootTransform(page)).toBe(beforePlacementTransform);
  const afterAtomPoint = (await forceAtomScreenPoints(page)).find(atom => atom.id === 'C1');
  expect(afterAtomPoint).toBeTruthy();
  expect(afterAtomPoint.cx).toBeCloseTo(beforeAtomPoint.cx, 1);
  expect(afterAtomPoint.cy).toBeCloseTo(beforeAtomPoint.cy, 1);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('force-mode edge bond placement refits when the rendered endpoint would be clipped', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);
  await loadSmiles(page, 'C');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);

  const pan = await page.evaluate(() => {
    const plot = document.querySelector('.svg-plot');
    const box = plot.getBoundingClientRect();
    return {
      startX: box.left + 60,
      startY: box.top + 60,
      endX: box.left + 510,
      endY: box.top + 60
    };
  });
  await page.mouse.move(pan.startX, pan.startY);
  await page.mouse.down();
  await page.mouse.move(pan.endX, pan.endY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const atom = (await forceAtomScreenPoints(page)).find(point => point.id === 'C1');
  expect(atom).toBeTruthy();
  const beforePlacementTransform = await rootTransform(page);

  await page.locator('#draw-bond-btn').click();
  await page.mouse.click(atom.cx, atom.cy);

  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePlacementTransform);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('hovering an existing 2D bond in ring-template mode shows a visible fused-ring preview', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);
  await page.locator('#ring-template-btn').click();

  const hoverPoint = await page.evaluate(() => {
    const line = document.querySelector('line.bond-hit');
    const plotBox = document.querySelector('#plot').getBoundingClientRect();
    const x1 = Number(line.getAttribute('x1'));
    const y1 = Number(line.getAttribute('y1'));
    const x2 = Number(line.getAttribute('x2'));
    const y2 = Number(line.getAttribute('y2'));
    const strokeWidth = Number(line.getAttribute('stroke-width'));
    const matrix = line.getScreenCTM();
    const start = new DOMPoint(x1, y1).matrixTransform(matrix);
    const end = new DOMPoint(x2, y2).matrixTransform(matrix);
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const center = { x: plotBox.left + plotBox.width / 2, y: plotBox.top + plotBox.height / 2 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    let nx = -dy / length;
    let ny = dx / length;
    if ((midpoint.x - center.x) * nx + (midpoint.y - center.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const offset = strokeWidth / 2 + 5;
    return {
      x: midpoint.x + nx * offset,
      y: midpoint.y + ny * offset
    };
  });
  await page.mouse.move(hoverPoint.x, hoverPoint.y);

  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(0);
  const previewStats = await page.evaluate(() => {
    const preview = document.querySelector('g.ring-template-preview');
    const box = preview.getBoundingClientRect();
    const firstLine = preview.querySelector('line.bond');
    const x1 = Number(firstLine.getAttribute('x1'));
    const y1 = Number(firstLine.getAttribute('y1'));
    const x2 = Number(firstLine.getAttribute('x2'));
    const y2 = Number(firstLine.getAttribute('y2'));
    return {
      box: { width: box.width, height: box.height },
      firstLength: Math.hypot(x2 - x1, y2 - y1)
    };
  });

  expect(previewStats.box.width).toBeGreaterThan(100);
  expect(previewStats.box.height).toBeGreaterThan(100);
  expect(previewStats.firstLength).toBeGreaterThan(40);
});

test('compact ring-template bond hover targets win over expanded atom targets', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC');
  await ensure2dMode(page);

  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await page.locator('#ring-template-btn').click();

  const midpoint = await page.evaluate(() => {
    const line = document.querySelector('line.bond-hit');
    if (!line) {
      throw new Error('Missing bond hit');
    }
    const x1 = Number(line.getAttribute('x1'));
    const y1 = Number(line.getAttribute('y1'));
    const x2 = Number(line.getAttribute('x2'));
    const y2 = Number(line.getAttribute('y2'));
    const matrix = line.getScreenCTM();
    const start = new DOMPoint(x1, y1).matrixTransform(matrix);
    const end = new DOMPoint(x2, y2).matrixTransform(matrix);
    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2
    };
  });

  const hitClass = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return target?.getAttribute?.('class') ?? '';
  }, midpoint);
  expect(hitClass).toContain('ring-template-bond-priority-target');

  await page.mouse.move(midpoint.x, midpoint.y);
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(0);
});

test('hovering an existing 2D atom in ring-template mode shows a visible anchored-ring preview', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);
  await page.locator('#ring-template-btn').click();

  const hoverPoint = await page.evaluate(() => {
    const atomHit = document.querySelector('g[data-atom-id="C1"] .atom-hit');
    const plotBox = document.querySelector('#plot').getBoundingClientRect();
    const hitBox = atomHit.getBoundingClientRect();
    const center = {
      x: hitBox.left + hitBox.width / 2,
      y: hitBox.top + hitBox.height / 2
    };
    const plotCenter = {
      x: plotBox.left + plotBox.width / 2,
      y: plotBox.top + plotBox.height / 2
    };
    const dx = center.x - plotCenter.x;
    const dy = center.y - plotCenter.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = Number(atomHit.getAttribute('r')) + 8;
    return {
      x: center.x + (dx / length) * offset,
      y: center.y + (dy / length) * offset
    };
  });
  await page.mouse.move(hoverPoint.x, hoverPoint.y);

  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(0);
  const previewStats = await page.evaluate(() => {
    const preview = document.querySelector('g.ring-template-preview');
    const box = preview.getBoundingClientRect();
    const firstLine = preview.querySelector('line.bond');
    const x1 = Number(firstLine.getAttribute('x1'));
    const y1 = Number(firstLine.getAttribute('y1'));
    const x2 = Number(firstLine.getAttribute('x2'));
    const y2 = Number(firstLine.getAttribute('y2'));
    return {
      box: { width: box.width, height: box.height },
      firstLength: Math.hypot(x2 - x1, y2 - y1)
    };
  });

  expect(previewStats.box.width).toBeGreaterThan(100);
  expect(previewStats.box.height).toBeGreaterThan(100);
  expect(previewStats.firstLength).toBeGreaterThan(40);
  await page.mouse.down();
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(0);
  await page.mouse.up();
});

test('holding an atom after a blank-space ring preview shows only the atom-anchored preview', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);
  await page.locator('#ring-template-btn').click();

  const blank = await blankSvgPoint(page);
  await page.mouse.move(blank.x, blank.y);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);

  const atomPoint = await page.evaluate(() => {
    const atomHit = document.querySelector('g[data-atom-id="C1"] .atom-hit');
    const atomBox = atomHit.getBoundingClientRect();
    return {
      x: atomBox.left + atomBox.width / 2,
      y: atomBox.top + atomBox.height / 2
    };
  });

  await page.mouse.move(atomPoint.x, atomPoint.y);
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(0);

  await page.mouse.down();
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(0);
  await page.mouse.move(blank.x, blank.y);
  await expect(page.locator('g.ring-template-preview')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(0);
  await page.mouse.up();
});

test('dragging a blank-space ring preview over an atom keeps the original free preview', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);
  await page.locator('#ring-template-btn').click();

  const points = await page.evaluate(() => {
    const blockedSelector = [
      '.atom-hit',
      '.bond-hit',
      '.node',
      '.bond-hover-target',
      '.ring-template-atom-hover-target',
      '.ring-template-bond-hover-target',
      '.link',
      '.separator'
    ].join(', ');
    const svg = document.querySelector('.svg-plot');
    const svgBox = svg.getBoundingClientRect();
    const atomHit = document.querySelector('g[data-atom-id="C1"] .atom-hit');
    const atomBox = atomHit.getBoundingClientRect();
    const candidates = [
      { x: svgBox.left + 48, y: svgBox.top + 48 },
      { x: svgBox.right - 48, y: svgBox.top + 48 },
      { x: svgBox.left + 48, y: svgBox.bottom - 48 },
      { x: svgBox.right - 48, y: svgBox.bottom - 48 },
      { x: svgBox.left + svgBox.width / 2, y: svgBox.top + 42 },
      { x: svgBox.left + svgBox.width / 2, y: svgBox.bottom - 42 }
    ];
    const blank = candidates.find(point => {
      const target = document.elementFromPoint(point.x, point.y);
      return target && svg.contains(target) && !target.closest(blockedSelector);
    });
    if (!blank) {
      throw new Error('Unable to find blank SVG point for ring-template drag test');
    }
    return {
      blank,
      atom: {
        x: atomBox.left + atomBox.width / 2,
        y: atomBox.top + atomBox.height / 2
      }
    };
  });

  await page.mouse.move(points.blank.x, points.blank.y);
  await page.mouse.down();
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);

  await page.mouse.move(points.atom.x, points.atom.y);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);
  await expect(page.locator('g.ring-template-preview')).toHaveCount(0);
  await page.mouse.up();
});

test('switching from 2d to force honors the active Global Bond Length option', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);

  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await expect.poll(async () => await atomDistance(page, 'C1', 'C2')).toBeCloseTo(30, 6);

  await page.locator('#toggle-btn').click();

  await expect.poll(async () => await averageForceHeavyBondDistance(page)).toBeLessThan(25);
});

test('force flip keeps compact Global Bond Length layouts from restarting and spreading', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1CCCCC1');
  await ensure2dMode(page);

  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await page.locator('#toggle-btn').click();
  await expect.poll(async () => await averageForceHeavyBondDistance(page)).toBeLessThan(25);

  await page.locator('#force-flip-h').click();
  await page.waitForTimeout(1200);

  await expect.poll(async () => await averageForceHeavyBondDistance(page)).toBeLessThan(25);
});

test('exiting force reaction preview keeps compact Global Bond Length layouts from restarting and spreading', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');
  await ensure2dMode(page);

  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-apply-btn').click();
  await page.locator('#toggle-btn').click();
  await expect.poll(async () => await averageForceHeavyBondDistance(page)).toBeLessThan(25);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  for (let index = 0; index < 3; index += 1) {
    await dehydrationRow.click();
    await expect(dehydrationRow).toHaveClass(/reaction-active/);
    await dehydrationRow.click();
    await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
    await page.waitForTimeout(1200);
    await expect.poll(async () => await averageForceHeavyBondDistance(page)).toBeLessThan(25);
  }
});

async function loadSmiles(page, smiles) {
  const input = page.locator('#smiles-input');
  await input.fill(smiles);
  await input.press('Enter');
}

async function waitForAppReady(page) {
  await expect(page.locator('#smiles-input')).toBeVisible();
  await page.waitForFunction(() => typeof window.toggleMode === 'function');
}

async function ensure2dMode(page) {
  const toggleButton = page.locator('#toggle-btn');
  await expect(toggleButton).toBeVisible();
  const label = await toggleButton.textContent();
  if (label?.includes('2D Structure')) {
    await toggleButton.click();
  }
  await expect(toggleButton).toHaveText('⚡ Force Layout');
}

async function blankSvgPoint(page) {
  return await page.evaluate(() => {
    const blockedSelector = [
      '.atom-hit',
      '.bond-hit',
      '.node',
      '.bond-hover-target',
      '.ring-template-atom-hover-target',
      '.ring-template-bond-hover-target',
      '.link',
      '.separator'
    ].join(', ');
    const svg = document.querySelector('.svg-plot');
    if (!svg) {
      throw new Error('Missing SVG plot');
    }
    const box = svg.getBoundingClientRect();
    const xSteps = [0.5, 0.25, 0.75, 0.12, 0.88, 0.38, 0.62];
    const ySteps = [0.5, 0.25, 0.75, 0.12, 0.88, 0.38, 0.62];
    for (const yStep of ySteps) {
      for (const xStep of xSteps) {
        const point = {
          x: box.left + box.width * xStep,
          y: box.top + box.height * yStep
        };
        const target = document.elementFromPoint(point.x, point.y);
        if (target && svg.contains(target) && !target.closest(blockedSelector)) {
          return point;
        }
      }
    }
    throw new Error('Unable to find a blank SVG point');
  });
}

async function loadInchi(page, inchi) {
  const input = page.locator('#smiles-input');
  await input.fill(inchi);
  await input.press('Enter');
}

async function computeResonanceContributors(resonanceRow) {
  const computeBtn = resonanceRow.getByRole('button', { name: 'Compute' });
  await expect(computeBtn).toBeVisible();
  await computeBtn.click();
  await expect(resonanceRow).not.toContainText('Compute');
}

async function atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  return await page.evaluate(
    ({ centerAtomId: centerId, firstNeighborAtomId: firstId, secondNeighborAtomId: secondId }) => {
      const parseTranslate = value => {
        const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      };
      const center = parseTranslate(document.querySelector(`g[data-atom-id="${centerId}"]`)?.getAttribute('transform'));
      const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
      const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
      if (!center || !first || !second) {
        return null;
      }
      const firstDx = first.x - center.x;
      const firstDy = first.y - center.y;
      const secondDx = second.x - center.x;
      const secondDy = second.y - center.y;
      const denominator = Math.hypot(firstDx, firstDy) * Math.hypot(secondDx, secondDy);
      if (!(denominator > 0)) {
        return null;
      }
      const cosine = Math.max(-1, Math.min(1, (firstDx * secondDx + firstDy * secondDy) / denominator));
      return (Math.acos(cosine) * 180) / Math.PI;
    },
    { centerAtomId, firstNeighborAtomId, secondNeighborAtomId }
  );
}

async function bondDirectionDegrees(page, firstAtomId, secondAtomId) {
  return await page.evaluate(
    ({ firstAtomId: firstId, secondAtomId: secondId }) => {
      const parseTranslate = value => {
        const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      };
      const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
      const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
      if (!first || !second) {
        return null;
      }
      return (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
    },
    { firstAtomId, secondAtomId }
  );
}

async function atomDistance(page, firstAtomId, secondAtomId) {
  return await page.evaluate(
    ({ firstAtomId: firstId, secondAtomId: secondId }) => {
      const parseTranslate = value => {
        const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      };
      const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
      const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
      if (!first || !second) {
        return null;
      }
      return Math.hypot(second.x - first.x, second.y - first.y);
    },
    { firstAtomId, secondAtomId }
  );
}

async function atomScreenPoint2d(page, atomId) {
  return await page.evaluate(id => {
    const hit = document.querySelector(`g[data-atom-id="${id}"] .atom-hit`);
    if (!hit) {
      return null;
    }
    const rect = hit.getBoundingClientRect();
    return {
      id,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2
    };
  }, atomId);
}

async function averageForceHeavyBondDistance(page) {
  return await page.evaluate(() => {
    const distances = [...document.querySelectorAll('line.link')]
      .map(line => ({
        x1: Number(line.getAttribute('x1')),
        y1: Number(line.getAttribute('y1')),
        x2: Number(line.getAttribute('x2')),
        y2: Number(line.getAttribute('y2'))
      }))
      .filter(line => [line.x1, line.y1, line.x2, line.y2].every(Number.isFinite))
      .map(line => Math.hypot(line.x1 - line.x2, line.y1 - line.y2))
      .filter(distance => distance > 8);
    if (!distances.length) {
      return null;
    }
    const heavyDistances = distances.slice(0, 6);
    return heavyDistances.reduce((sum, distance) => sum + distance, 0) / heavyDistances.length;
  });
}

async function renderedHeavyLayoutAudit(page, smiles) {
  return await page.evaluate(async smilesValue => {
    const { parseSMILES } = await import('/src/io/smiles.js');
    const { auditLayout } = await import('/src/layout/engine/audit/audit.js');
    const { createLayoutGraph } = await import('/src/layout/engine/model/layout-graph.js');
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.eE]+),([-0-9.eE]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const molecule = parseSMILES(smilesValue);
    const coords = new Map(
      Array.from(document.querySelectorAll('g.atom-labels g[data-atom-id]'))
        .map(node => [node.getAttribute('data-atom-id'), parseTranslate(node.getAttribute('transform'))])
        .filter(([, position]) => position && Number.isFinite(position.x) && Number.isFinite(position.y))
    );
    const bondLengths = [...molecule.bonds.values()]
      .map(bond => [coords.get(bond.atoms[0]), coords.get(bond.atoms[1])])
      .filter(([firstPosition, secondPosition]) => firstPosition && secondPosition)
      .map(([firstPosition, secondPosition]) => Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y))
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((firstValue, secondValue) => firstValue - secondValue);
    if (bondLengths.length === 0) {
      return null;
    }
    const medianBondLength = bondLengths[Math.floor(bondLengths.length / 2)];
    const graph = createLayoutGraph(molecule, {
      suppressH: true,
      bondLength: medianBondLength
    });
    const audit = auditLayout(graph, coords, {
      bondLength: medianBondLength
    });
    return {
      ok: audit.ok,
      severeOverlapCount: audit.severeOverlapCount,
      visibleHeavyBondCrossingCount: audit.visibleHeavyBondCrossingCount,
      bondLengthFailureCount: audit.bondLengthFailureCount
    };
  }, smiles);
}

async function renderedHeavyLayoutAspect(page) {
  return await page.evaluate(() => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.eE]+),([-0-9.eE]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const positions = Array.from(document.querySelectorAll('g.atom-labels g[data-atom-id]'))
      .map(node => parseTranslate(node.getAttribute('transform')))
      .filter(position => position && Number.isFinite(position.x) && Number.isFinite(position.y));
    const xs = positions.map(position => position.x);
    const ys = positions.map(position => position.y);
    return (Math.max(...xs) - Math.min(...xs)) / Math.max(Math.max(...ys) - Math.min(...ys), 1e-6);
  });
}

async function renderedRingSystemAspect(page, smiles) {
  return await page.evaluate(async smilesValue => {
    const { parseSMILES } = await import('/src/io/smiles.js');
    const { createLayoutGraph } = await import('/src/layout/engine/model/layout-graph.js');
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.eE]+),([-0-9.eE]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const coords = new Map(
      Array.from(document.querySelectorAll('g.atom-labels g[data-atom-id]'))
        .map(node => [node.getAttribute('data-atom-id'), parseTranslate(node.getAttribute('transform'))])
        .filter(([, position]) => position && Number.isFinite(position.x) && Number.isFinite(position.y))
    );
    const graph = createLayoutGraph(parseSMILES(smilesValue), {
      suppressH: true
    });
    const centers = graph.ringSystems
      .map(ringSystem => {
        const positions = ringSystem.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
        if (positions.length === 0) {
          return null;
        }
        return {
          x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
          y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length
        };
      })
      .filter(Boolean);
    const xs = centers.map(position => position.x);
    const ys = centers.map(position => position.y);
    return (Math.max(...xs) - Math.min(...xs)) / Math.max(Math.max(...ys) - Math.min(...ys), 1e-6);
  }, smiles);
}

async function renderedRingChainLinkerExitDeviation(page, smiles) {
  return await page.evaluate(async smilesValue => {
    const { parseSMILES } = await import('/src/io/smiles.js');
    const { createLayoutGraph } = await import('/src/layout/engine/model/layout-graph.js');
    const { describePathLikeIsolatedRingChain } = await import('/src/layout/engine/topology/isolated-ring-chain.js');
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.eE]+),([-0-9.eE]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const coords = new Map(
      Array.from(document.querySelectorAll('g.atom-labels g[data-atom-id]'))
        .map(node => [node.getAttribute('data-atom-id'), parseTranslate(node.getAttribute('transform'))])
        .filter(([, position]) => position && Number.isFinite(position.x) && Number.isFinite(position.y))
    );
    const graph = createLayoutGraph(parseSMILES(smilesValue), {
      suppressH: true
    });
    const ringChain = describePathLikeIsolatedRingChain(graph, graph.components[0]);
    if (!ringChain) {
      return null;
    }
    const ringSystemById = new Map(ringChain.ringSystems.map(ringSystem => [ringSystem.id, ringSystem]));
    const angleDegrees = (firstPosition, centerPosition, secondPosition) => {
      const firstVector = {
        x: firstPosition.x - centerPosition.x,
        y: firstPosition.y - centerPosition.y
      };
      const secondVector = {
        x: secondPosition.x - centerPosition.x,
        y: secondPosition.y - centerPosition.y
      };
      const denominator = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);
      if (!(denominator > 0)) {
        return null;
      }
      const cosine = Math.max(-1, Math.min(1, (firstVector.x * secondVector.x + firstVector.y * secondVector.y) / denominator));
      return (Math.acos(cosine) * 180) / Math.PI;
    };
    const ringNeighborIds = (ringSystemId, atomId) => {
      const ringAtomIds = new Set(ringSystemById.get(ringSystemId)?.atomIds ?? []);
      return (graph.bondsByAtomId.get(atomId) ?? []).map(bond => (bond.a === atomId ? bond.b : bond.a)).filter(neighborAtomId => ringAtomIds.has(neighborAtomId));
    };
    const edgeBetween = (firstRingSystemId, secondRingSystemId) =>
      ringChain.edges.find(
        edge =>
          (edge.firstRingSystemId === firstRingSystemId && edge.secondRingSystemId === secondRingSystemId) ||
          (edge.firstRingSystemId === secondRingSystemId && edge.secondRingSystemId === firstRingSystemId)
      );
    const orderedEdge = (edge, previousRingSystemId, nextRingSystemId) => {
      if (edge.firstRingSystemId === previousRingSystemId && edge.secondRingSystemId === nextRingSystemId) {
        return {
          linkerAtomId: edge.linkerAtomIds[0],
          previousAttachmentAtomId: edge.firstAttachmentAtomId,
          nextAttachmentAtomId: edge.secondAttachmentAtomId
        };
      }
      return {
        linkerAtomId: edge.linkerAtomIds[0],
        previousAttachmentAtomId: edge.secondAttachmentAtomId,
        nextAttachmentAtomId: edge.firstAttachmentAtomId
      };
    };

    let maxDeviation = 0;
    const orderedRingSystemIds = ringChain.orderedRingSystemIds ?? [];
    for (let index = 1; index < orderedRingSystemIds.length; index++) {
      const previousRingSystemId = orderedRingSystemIds[index - 1];
      const nextRingSystemId = orderedRingSystemIds[index];
      const edge = orderedEdge(edgeBetween(previousRingSystemId, nextRingSystemId), previousRingSystemId, nextRingSystemId);
      for (const [ringSystemId, attachmentAtomId] of [
        [previousRingSystemId, edge.previousAttachmentAtomId],
        [nextRingSystemId, edge.nextAttachmentAtomId]
      ]) {
        const attachmentPosition = coords.get(attachmentAtomId);
        const linkerPosition = coords.get(edge.linkerAtomId);
        if (!attachmentPosition || !linkerPosition) {
          return null;
        }
        for (const neighborAtomId of ringNeighborIds(ringSystemId, attachmentAtomId)) {
          const neighborPosition = coords.get(neighborAtomId);
          if (!neighborPosition) {
            return null;
          }
          const angle = angleDegrees(neighborPosition, attachmentPosition, linkerPosition);
          if (angle == null) {
            return null;
          }
          maxDeviation = Math.max(maxDeviation, Math.abs(angle - 120));
        }
      }
    }
    return maxDeviation;
  }, smiles);
}

async function atomInsideRing(page, atomId, ringAtomIds) {
  return await page.evaluate(
    ({ atomId: targetAtomId, ringAtomIds: targetRingAtomIds }) => {
      const parseTranslate = value => {
        const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      };
      const point = parseTranslate(document.querySelector(`g[data-atom-id="${targetAtomId}"]`)?.getAttribute('transform'));
      const polygon = targetRingAtomIds.map(ringAtomId => parseTranslate(document.querySelector(`g[data-atom-id="${ringAtomId}"]`)?.getAttribute('transform')));
      if (!point || polygon.some(position => !position)) {
        return null;
      }
      let inside = false;
      for (let firstIndex = 0, secondIndex = polygon.length - 1; firstIndex < polygon.length; secondIndex = firstIndex++) {
        const first = polygon[firstIndex];
        const second = polygon[secondIndex];
        const intersects = first.y > point.y !== second.y > point.y && point.x < ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) + first.x;
        if (intersects) {
          inside = !inside;
        }
      }
      return inside;
    },
    { atomId, ringAtomIds }
  );
}

async function signedTurn(page, firstAtomId, centerAtomId, secondAtomId) {
  return await page.evaluate(
    ({ firstAtomId: firstId, centerAtomId: centerId, secondAtomId: secondId }) => {
      const parseTranslate = value => {
        const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      };
      const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
      const center = parseTranslate(document.querySelector(`g[data-atom-id="${centerId}"]`)?.getAttribute('transform'));
      const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
      if (!first || !center || !second) {
        return null;
      }
      return (first.x - center.x) * (second.y - center.y) - (first.y - center.y) * (second.x - center.x);
    },
    { firstAtomId, centerAtomId, secondAtomId }
  );
}

test('loading and cleaning the benzamide bug molecule keeps the aryl amide exit on the exact trigonal slot', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCC1=CC=CC(CC)=C1NC(=O)C1=C(C)N(CC(C)C)C(C)=C(Br)C1=O');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const initialAngle = await atomBondAngleDegrees(page, 'N11', 'C10', 'C12');
  expect(initialAngle).not.toBeNull();
  expect(Math.abs(initialAngle - 120)).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const cleanedAngle = await atomBondAngleDegrees(page, 'N11', 'C10', 'C12');
      return cleanedAngle == null ? null : Math.abs(cleanedAngle - 120);
    })
    .toBeLessThan(1e-6);
});

test('loading the simple chloro ketone bug molecule keeps the chlorine on the exact downward slot', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(=O)C(Cl)CC(C(C)C)C=C');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const chlorineDirection = await bondDirectionDegrees(page, 'C4', 'Cl5');
  expect(chlorineDirection).not.toBeNull();
  expect(Math.abs(chlorineDirection - 90)).toBeLessThan(1e-6);
});

test('loading the crowded phosphine oxide keeps mirrored aryl ethyl branches separated in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCCCP(=O)(C(=O)C1=C(CC)C=C(CC)C=C1CC)C(=O)C1=C(CC)C=C(CC)C=C1CC');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const mirroredEthylDistance = await atomDistance(page, 'C11', 'C33');
  const carbonylClearance = await atomDistance(page, 'C2', 'O8');
  const firstArylEthylAngle = await atomBondAngleDegrees(page, 'C10', 'C9', 'C11');
  const firstArylEthylMirrorAngle = await atomBondAngleDegrees(page, 'C10', 'C11', 'C13');
  const secondArylEthylAngle = await atomBondAngleDegrees(page, 'C32', 'C23', 'C33');
  const secondArylEthylMirrorAngle = await atomBondAngleDegrees(page, 'C32', 'C31', 'C33');
  const secondArylEthylTailToPropylClearance = await atomDistance(page, 'C34', 'C2');
  const secondArylEthylTailToPropylBackboneClearance = await atomDistance(page, 'C34', 'C3');
  const renderedAudit = await renderedHeavyLayoutAudit(page, 'CCCCP(=O)(C(=O)C1=C(CC)C=C(CC)C=C1CC)C(=O)C1=C(CC)C=C(CC)C=C1CC');
  const phosphineOxideAxisAngle = await atomBondAngleDegrees(page, 'P5', 'O6', 'C4');
  const phosphineArylAxisAngle = await atomBondAngleDegrees(page, 'P5', 'C7', 'C21');
  const firstCarbonylFanAngle = await atomBondAngleDegrees(page, 'C7', 'P5', 'O8');
  const secondCarbonylFanAngle = await atomBondAngleDegrees(page, 'C7', 'P5', 'C9');
  const thirdCarbonylFanAngle = await atomBondAngleDegrees(page, 'C7', 'O8', 'C9');
  expect(mirroredEthylDistance).not.toBeNull();
  expect(carbonylClearance).not.toBeNull();
  expect(firstArylEthylAngle).not.toBeNull();
  expect(firstArylEthylMirrorAngle).not.toBeNull();
  expect(secondArylEthylAngle).not.toBeNull();
  expect(secondArylEthylMirrorAngle).not.toBeNull();
  expect(secondArylEthylTailToPropylClearance).not.toBeNull();
  expect(secondArylEthylTailToPropylBackboneClearance).not.toBeNull();
  expect(phosphineOxideAxisAngle).not.toBeNull();
  expect(phosphineArylAxisAngle).not.toBeNull();
  expect(firstCarbonylFanAngle).not.toBeNull();
  expect(secondCarbonylFanAngle).not.toBeNull();
  expect(thirdCarbonylFanAngle).not.toBeNull();
  expect(mirroredEthylDistance).toBeGreaterThan(60);
  expect(carbonylClearance).toBeGreaterThan(45);
  expect(Math.abs(firstArylEthylAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(firstArylEthylMirrorAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(secondArylEthylAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(secondArylEthylMirrorAngle - 120)).toBeLessThan(1e-6);
  expect(secondArylEthylTailToPropylClearance).toBeGreaterThan(90);
  expect(secondArylEthylTailToPropylBackboneClearance).toBeGreaterThan(100);
  expect(renderedAudit).toEqual({
    ok: true,
    severeOverlapCount: 0,
    visibleHeavyBondCrossingCount: 0,
    bondLengthFailureCount: 0
  });
  expect(Math.abs(phosphineOxideAxisAngle - 180)).toBeLessThan(1e-6);
  expect(phosphineArylAxisAngle).toBeGreaterThan(160);
  expect(Math.abs(firstCarbonylFanAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(secondCarbonylFanAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(thirdCarbonylFanAngle - 120)).toBeLessThan(1e-6);
});

test('loading the bulky cyclohexyl ester bug molecule keeps the C22/C24 pocket clear in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(C)(O)C(=O)C1=CC=C(COC(=O)NCC2(C)CC(CC(C)(C)C2)NC(=O)OCC2=CC=C(C=C2)C(=O)C(C)(C)O)C=C1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const esterOxygenToRingHub = await atomDistance(page, 'O12', 'C22');
  const esterOxygenToMethylLeaf = await atomDistance(page, 'O12', 'C24');
  const methylBondLength = await atomDistance(page, 'C22', 'C24');
  expect(esterOxygenToRingHub).not.toBeNull();
  expect(esterOxygenToMethylLeaf).not.toBeNull();
  expect(methylBondLength).not.toBeNull();
  expect(methylBondLength).toBeGreaterThan(80);
  expect(esterOxygenToRingHub).toBeGreaterThan(120);
  expect(esterOxygenToMethylLeaf).toBeGreaterThan(120);
});

test('loading the acyclic sulfonamide bug molecule keeps the sulfur oxo pair opposed in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CN1CCN(CC1)C(=O)N[C@H](CC1=CC=CC=C1)C(=O)N[C@H](CCC1=CC=CC=C1)CCS(=O)(=O)NOCC1=CC=CC=C1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const singleLigandAxis = await atomBondAngleDegrees(page, 'S35', 'C34', 'N38');
  const oxoAxis = await atomBondAngleDegrees(page, 'S35', 'O36', 'O37');
  const carbonToOxo = await atomBondAngleDegrees(page, 'S35', 'C34', 'O36');
  const nitrogenToOxo = await atomBondAngleDegrees(page, 'S35', 'N38', 'O36');
  const benzylContinuation = await atomBondAngleDegrees(page, 'C13', 'C11', 'C14');
  const sulfurOxoLength = await atomDistance(page, 'S35', 'O37');
  const pendantRingClearance = await atomDistance(page, 'C19', 'O37');
  expect(singleLigandAxis).not.toBeNull();
  expect(oxoAxis).not.toBeNull();
  expect(carbonToOxo).not.toBeNull();
  expect(nitrogenToOxo).not.toBeNull();
  expect(benzylContinuation).not.toBeNull();
  expect(sulfurOxoLength).not.toBeNull();
  expect(pendantRingClearance).not.toBeNull();
  expect(Math.abs(singleLigandAxis - 180)).toBeLessThan(1e-6);
  expect(oxoAxis).toBeGreaterThan(174);
  expect(Math.abs(carbonToOxo - 90)).toBeLessThan(1e-6);
  expect(Math.abs(nitrogenToOxo - 90)).toBeLessThan(1e-6);
  expect(Math.abs(benzylContinuation - 120)).toBeLessThan(1e-6);
  expect(pendantRingClearance).toBeGreaterThan(sulfurOxoLength * 0.55);
});

test('loading and cleaning the bridged nitrile bug molecule keeps the terminal nitrile readably linear in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(C)CC1CCC2(CC1(C2)C#N)C(C)C');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const nitrileAngleMaxDeviation = async () => {
    const angle = await atomBondAngleDegrees(page, 'C12', 'C10', 'N13');
    return angle == null ? null : Math.abs(angle - 180);
  };

  await expect.poll(nitrileAngleMaxDeviation).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(nitrileAngleMaxDeviation).toBeLessThan(8);
});

test('loading and cleaning the explicit phosphonate hydrogen bug molecule keeps the visible phosphorus fan trigonal', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, '[H][P@@](=O)(CCCCCCCCCCC)OCCCC');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const maxVisiblePhosphorusFanDeviation = async () => {
    const angles = await Promise.all([
      atomBondAngleDegrees(page, 'P2', 'O3', 'C4'),
      atomBondAngleDegrees(page, 'P2', 'O3', 'O15'),
      atomBondAngleDegrees(page, 'P2', 'C4', 'O15'),
      atomBondAngleDegrees(page, 'C4', 'P2', 'C5')
    ]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };

  await expect.poll(maxVisiblePhosphorusFanDeviation).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(maxVisiblePhosphorusFanDeviation).toBeLessThan(1e-6);
});

test('loading and cleaning the aryl dinitro bug molecule keeps both nitro fans and the C11 root trigonal', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'FC(F)(F)C1=NN=C([N-]C2=C(C=C(C=C2N(=O)=O)C(F)(F)F)N(=O)=O)S1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const maxNitroFanDeviation = async () => {
    const angles = await Promise.all([
      atomBondAngleDegrees(page, 'N16', 'O17', 'O18'),
      atomBondAngleDegrees(page, 'N16', 'O17', 'C15'),
      atomBondAngleDegrees(page, 'N16', 'O18', 'C15'),
      atomBondAngleDegrees(page, 'N23', 'C11', 'O24'),
      atomBondAngleDegrees(page, 'N23', 'C11', 'O25'),
      atomBondAngleDegrees(page, 'N23', 'O24', 'O25'),
      atomBondAngleDegrees(page, 'C11', 'C10', 'N23'),
      atomBondAngleDegrees(page, 'C11', 'C12', 'N23')
    ]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };

  await expect.poll(maxNitroFanDeviation).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(maxNitroFanDeviation).toBeLessThan(1e-6);
});

test('loading and cleaning the macrocycle aryl-glycoside bug molecule keeps fused aryl arcs attached', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'OCC1OC(OC2=CC=C3CCCCC(O)CCC4=CC=C(OC2=C3)C=C4)C(O)C(O)C1O');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const maxFusedArylBondRatio = async () => {
    const distances = await Promise.all([atomDistance(page, 'C7', 'C24'), atomDistance(page, 'C9', 'C10'), atomDistance(page, 'C19', 'C27'), atomDistance(page, 'C22', 'C26')]);
    if (distances.some(distanceValue => distanceValue == null || !(distanceValue > 0))) {
      return null;
    }
    return Math.max(...distances) / Math.min(...distances);
  };
  const maxFusedArylAngleDeviation = async () => {
    const angles = await Promise.all([
      atomBondAngleDegrees(page, 'C27', 'C19', 'C26'),
      atomBondAngleDegrees(page, 'C26', 'C27', 'C22'),
      atomBondAngleDegrees(page, 'C22', 'C26', 'C21'),
      atomBondAngleDegrees(page, 'C21', 'C22', 'C20'),
      atomBondAngleDegrees(page, 'C20', 'C21', 'C19'),
      atomBondAngleDegrees(page, 'C19', 'C20', 'C27'),
      atomBondAngleDegrees(page, 'C24', 'C7', 'C25'),
      atomBondAngleDegrees(page, 'C25', 'C24', 'C10'),
      atomBondAngleDegrees(page, 'C10', 'C25', 'C9'),
      atomBondAngleDegrees(page, 'C9', 'C10', 'C8'),
      atomBondAngleDegrees(page, 'C8', 'C9', 'C7'),
      atomBondAngleDegrees(page, 'C7', 'C8', 'C24')
    ]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };
  const c24ArylEtherAngleDeviation = async () => {
    const angles = await Promise.all([atomBondAngleDegrees(page, 'C24', 'C7', 'O23'), atomBondAngleDegrees(page, 'C24', 'C25', 'O23')]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };
  const glycosideUpperRingClearance = async () => atomDistance(page, 'O6', 'C22');

  await expect.poll(maxFusedArylBondRatio).toBeLessThan(1.08);
  await expect.poll(maxFusedArylAngleDeviation).toBeLessThan(2);
  await expect.poll(c24ArylEtherAngleDeviation).toBeLessThan(5);
  await expect.poll(glycosideUpperRingClearance).toBeGreaterThan(60);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(maxFusedArylBondRatio).toBeLessThan(1.08);
  await expect.poll(maxFusedArylAngleDeviation).toBeLessThan(2);
  await expect.poll(c24ArylEtherAngleDeviation).toBeLessThan(5);
  await expect.poll(glycosideUpperRingClearance).toBeGreaterThan(60);
});

test('loading and cleaning the sulfated glycoside bug molecule keeps browser-rendered heavy geometry clean', { timeout: 120_000 }, async ({ page }) => {
  await page.goto('/index.html');

  const sulfatedGlycosideSmiles =
    'CCCCCCCCCCCCO[C@H]1O[C@H](<COS(=O)(=O)O>)[C@@H](<OS(=O)(=O)O>)[C@H](<OS(=O)(=O)O>)[C@@H]1O[C@H]2O[C@H](<COS(=O)(=O)O>)[C@@H](<OS(=O)(=O)O>)[C@H](<O[C@H]3O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]4O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](O[C@H]5O[C@H](COS(=O)(=O)O)[C@@H](OS(=O)(=O)O)[C@H](OS(=O)(=O)O)[C@@H]5OS(=O)(=O)O)[C@@H]4OS(=O)(=O)O)[C@@H]3OS(=O)(=O)O>)[C@@H]2OS(=O)(=O)O';
  const cleanAudit = {
    ok: true,
    severeOverlapCount: 0,
    visibleHeavyBondCrossingCount: 0,
    bondLengthFailureCount: 0
  };
  const minimumReadableRingChainAspect = 2;

  await loadSmiles(page, sulfatedGlycosideSmiles);
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const maxNamedSugarSideExitDeviation = async () => {
    const angles = await Promise.all([
      atomBondAngleDegrees(page, 'C14', 'C39', 'O13'),
      atomBondAngleDegrees(page, 'C14', 'O13', 'O16'),
      atomBondAngleDegrees(page, 'C25', 'C17', 'O27'),
      atomBondAngleDegrees(page, 'C25', 'O27', 'C32'),
      atomBondAngleDegrees(page, 'C53', 'C45', 'O55'),
      atomBondAngleDegrees(page, 'C53', 'O55', 'C60'),
      atomBondAngleDegrees(page, 'C74', 'C66', 'O76'),
      atomBondAngleDegrees(page, 'C74', 'O76', 'C81'),
      atomBondAngleDegrees(page, 'C95', 'C87', 'O97'),
      atomBondAngleDegrees(page, 'C95', 'O97', 'C102'),
      atomBondAngleDegrees(page, 'O97', 'C95', 'S98'),
      atomBondAngleDegrees(page, 'O139', 'C137', 'S140')
    ]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };

  await expect.poll(async () => await renderedHeavyLayoutAudit(page, sulfatedGlycosideSmiles), { timeout: 60_000 }).toEqual(cleanAudit);
  await expect.poll(async () => await renderedRingSystemAspect(page, sulfatedGlycosideSmiles), { timeout: 60_000 }).toBeGreaterThan(minimumReadableRingChainAspect);
  await expect.poll(async () => await renderedRingChainLinkerExitDeviation(page, sulfatedGlycosideSmiles), { timeout: 60_000 }).toBeLessThan(2);
  await expect.poll(maxNamedSugarSideExitDeviation, { timeout: 60_000 }).toBeLessThan(6);
  await expect.poll(async () => await renderedHeavyLayoutAspect(page), { timeout: 60_000 }).toBeGreaterThan(1);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(async () => await renderedHeavyLayoutAudit(page, sulfatedGlycosideSmiles), { timeout: 60_000 }).toEqual(cleanAudit);
  await expect.poll(async () => await renderedRingSystemAspect(page, sulfatedGlycosideSmiles), { timeout: 60_000 }).toBeGreaterThan(minimumReadableRingChainAspect);
  await expect.poll(async () => await renderedRingChainLinkerExitDeviation(page, sulfatedGlycosideSmiles), { timeout: 60_000 }).toBeLessThan(2);
  await expect.poll(maxNamedSugarSideExitDeviation, { timeout: 60_000 }).toBeLessThan(6);
  await expect.poll(async () => await renderedHeavyLayoutAspect(page), { timeout: 60_000 }).toBeGreaterThan(1);
});

test('loading the ring-rich peptide keeps the WebKit-visible backbone broad and alpha fans bounded', { timeout: 120_000 }, async ({ page }) => {
  await page.goto('/index.html');

  const ringRichPeptideSmiles =
    'NCCCC[C@H](<NC(=O)[C@@H](N)CCCNC(=N)N>)C(=O)N[C@@H](Cc1c[nH]c2ccccc12)C(=O)N[C@@H](Cc3c[nH]c4ccccc34)C(=O)N[C@@H](<CCCNC(=N)N>)C(=O)N[C@@H](Cc5c[nH]c6ccccc56)C(=O)N[C@@H](Cc7c[nH]c8ccccc78)C(=O)N[C@@H](<CCCNC(=N)N>)C(=O)N[C@@H](Cc9c[nH]c%10ccccc9%10)C(=O)O';
  const cleanAudit = {
    ok: true,
    severeOverlapCount: 0,
    visibleHeavyBondCrossingCount: 0,
    bondLengthFailureCount: 0
  };

  await loadSmiles(page, ringRichPeptideSmiles);
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const c40FanDeviation = async () => {
    const angles = await Promise.all([atomBondAngleDegrees(page, 'C40', 'C42', 'C53'), atomBondAngleDegrees(page, 'C40', 'C42', 'N39'), atomBondAngleDegrees(page, 'C40', 'C53', 'N39')]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };

  await expect.poll(async () => await renderedHeavyLayoutAudit(page, ringRichPeptideSmiles), { timeout: 60_000 }).toEqual(cleanAudit);
  await expect.poll(async () => await renderedHeavyLayoutAspect(page), { timeout: 60_000 }).toBeGreaterThan(1.9);
  await expect.poll(c40FanDeviation, { timeout: 60_000 }).toBeLessThan(25);
});

test('loading the benzylic amino-alcohol bug molecule keeps the visible trigonal centers and attached phenyl exit exact', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(COC1=CC=CC=C1)NC(C)C(O)C1=CC=C(O)C=C1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
    ['C2', 'C1', 'N11'],
    ['C2', 'C1', 'C3'],
    ['C2', 'N11', 'C3'],
    ['C12', 'C13', 'N11'],
    ['C12', 'C13', 'C14'],
    ['C12', 'N11', 'C14'],
    ['C14', 'C12', 'O15'],
    ['C14', 'C12', 'C16'],
    ['C14', 'O15', 'C16']
  ]) {
    const angle = await atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
    expect(angle).not.toBeNull();
    expect(Math.abs(angle - 120)).toBeLessThan(1e-6);
  }
  const attachedPhenylExit = await atomBondAngleDegrees(page, 'C16', 'C17', 'C14');
  const attachedPhenylExitMirror = await atomBondAngleDegrees(page, 'C16', 'C22', 'C14');
  expect(attachedPhenylExit).not.toBeNull();
  expect(attachedPhenylExitMirror).not.toBeNull();
  expect(Math.abs(attachedPhenylExit - 120)).toBeLessThan(1e-6);
  expect(Math.abs(attachedPhenylExitMirror - 120)).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angles = await Promise.all([
        atomBondAngleDegrees(page, 'C2', 'C1', 'N11'),
        atomBondAngleDegrees(page, 'C2', 'C1', 'C3'),
        atomBondAngleDegrees(page, 'C2', 'N11', 'C3'),
        atomBondAngleDegrees(page, 'C12', 'C13', 'N11'),
        atomBondAngleDegrees(page, 'C12', 'C13', 'C14'),
        atomBondAngleDegrees(page, 'C12', 'N11', 'C14'),
        atomBondAngleDegrees(page, 'C14', 'C12', 'O15'),
        atomBondAngleDegrees(page, 'C14', 'C12', 'C16'),
        atomBondAngleDegrees(page, 'C14', 'O15', 'C16'),
        atomBondAngleDegrees(page, 'C16', 'C17', 'C14'),
        atomBondAngleDegrees(page, 'C16', 'C22', 'C14')
      ]);
      if (angles.some(angle => angle == null)) {
        return null;
      }
      return Math.max(...angles.map(angle => Math.abs(angle - 120)));
    })
    .toBeLessThan(1e-6);
});

test('loading and cleaning the diaryl amino alcohol bug molecule keeps both phenyl roots exact in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC[C@@H](O)C(C[C@@H](C)N(C)C)(C1=CC=CC=C1)C1=CC=CC=C1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const phenylRootAngleMaxDeviation = async () => {
    const angles = await Promise.all([
      atomBondAngleDegrees(page, 'C14', 'C6', 'C15'),
      atomBondAngleDegrees(page, 'C14', 'C6', 'C19'),
      atomBondAngleDegrees(page, 'C14', 'C15', 'C19'),
      atomBondAngleDegrees(page, 'C20', 'C6', 'C21'),
      atomBondAngleDegrees(page, 'C20', 'C6', 'C25'),
      atomBondAngleDegrees(page, 'C20', 'C21', 'C25')
    ]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };

  await expect.poll(phenylRootAngleMaxDeviation).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(phenylRootAngleMaxDeviation).toBeLessThan(1e-6);
});

test('loading and cleaning the fused indole alkene bug molecule keeps both linker trigonal angles exact in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'Cc1[nH]c2ccccc2c1\\C=C\\c3c[nH]c4ccccc34');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
    ['C12', 'C11', 'C13'],
    ['C13', 'C12', 'C14']
  ]) {
    const angle = await atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
    expect(angle).not.toBeNull();
    expect(Math.abs(angle - 120)).toBeLessThan(1e-6);
  }

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angles = await Promise.all([atomBondAngleDegrees(page, 'C12', 'C11', 'C13'), atomBondAngleDegrees(page, 'C13', 'C12', 'C14')]);
      if (angles.some(angle => angle == null)) {
        return null;
      }
      return Math.max(...angles.map(angle => Math.abs(angle - 120)));
    })
    .toBeLessThan(1e-6);
});

test('loading and cleaning the anisole ester bug molecule keeps the C7 carbonyl center exact in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, '[H][C@]12C[C@@H](OC(=O)C3=CC(OC)=C(OC)C(OC)=C3)[C@H](OC)[C@@H](C(=O)OC)[C@@]1([H])C[C@@]1([H])N(CCC3=C1NC1=C3C=CC(OC)=C1)C2');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [firstNeighborAtomId, secondNeighborAtomId, expectedAngle] of [
    ['O8', 'O6', 120],
    ['O8', 'C9', 120],
    ['O6', 'C9', 120]
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, 'C7', firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - expectedAngle)).toBeLessThan(1e-6);
  }
  const initialTurn = await signedTurn(page, 'C4', 'O6', 'C7');
  expect(initialTurn).not.toBeNull();
  expect(initialTurn).toBeLessThan(0);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angleChecks = await Promise.all([atomBondAngleDegrees(page, 'C7', 'O8', 'O6'), atomBondAngleDegrees(page, 'C7', 'O8', 'C9'), atomBondAngleDegrees(page, 'C7', 'O6', 'C9')]);
      if (angleChecks.some(angle => angle == null)) {
        return null;
      }
      return Math.max(Math.abs(angleChecks[0] - 120), Math.abs(angleChecks[1] - 120), Math.abs(angleChecks[2] - 120));
    })
    .toBeLessThan(1e-6);

  await expect.poll(async () => signedTurn(page, 'C4', 'O6', 'C7')).toBeLessThan(0);
});

test('loading and cleaning the dimethoxybenzyl sulfonamide keeps C8 exact while balancing C3 and C5 in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'COC(=O)C1N(CC2=CC=CC(OC)=C2OC)C(=NC(O)=C1[O-])C1=CSC=C1NC(=O)[N-]S(=O)(=O)C1=CC=CC=C1Cl');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
    ['C8', 'C15', 'C7'],
    ['C8', 'C9', 'C7']
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - 120)).toBeLessThan(1e-6);
  }
  for (const [firstNeighborAtomId, secondNeighborAtomId] of [
    ['O2', 'O4'],
    ['O2', 'C5'],
    ['O4', 'C5']
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, 'C3', firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - 120)).toBeLessThan(12.1);
  }
  for (const [firstNeighborAtomId, secondNeighborAtomId] of [
    ['C3', 'N6'],
    ['C3', 'C22'],
    ['N6', 'C22']
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, 'C5', firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - 120)).toBeLessThan(12.1);
  }

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angles = await Promise.all([
        atomBondAngleDegrees(page, 'C8', 'C15', 'C7'),
        atomBondAngleDegrees(page, 'C8', 'C9', 'C7'),
        atomBondAngleDegrees(page, 'C3', 'O2', 'O4'),
        atomBondAngleDegrees(page, 'C3', 'O2', 'C5'),
        atomBondAngleDegrees(page, 'C3', 'O4', 'C5'),
        atomBondAngleDegrees(page, 'C5', 'C3', 'N6'),
        atomBondAngleDegrees(page, 'C5', 'C3', 'C22'),
        atomBondAngleDegrees(page, 'C5', 'N6', 'C22')
      ]);
      if (angles.some(angle => angle == null)) {
        return null;
      }
      const exactC8Deviation = Math.max(Math.abs(angles[0] - 120), Math.abs(angles[1] - 120));
      const localBalanceDeviation = Math.max(...angles.slice(2).map(angle => Math.abs(angle - 120)));
      return exactC8Deviation <= 1e-6 && localBalanceDeviation < 12.1;
    })
    .toBe(true);
});

test('loading and cleaning the bridgehead ethyl fused-ring bug keeps C3 exiting outside in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCC12CCCC3=C1C(CC[NH2+]C2(C)C)=CO3');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const assertC3ExitOutside = async () => {
    const insideFirstRing = await atomInsideRing(page, 'C2', ['C14', 'N12', 'C11', 'C10', 'C9', 'C8', 'C3']);
    const insideSecondRing = await atomInsideRing(page, 'C2', ['C8', 'C7', 'C6', 'C5', 'C4', 'C3']);
    const c14Gap = await atomBondAngleDegrees(page, 'C3', 'C14', 'C2');
    const c4Gap = await atomBondAngleDegrees(page, 'C3', 'C4', 'C2');
    if (insideFirstRing == null || insideSecondRing == null || c14Gap == null || c4Gap == null) {
      return false;
    }
    return !insideFirstRing && !insideSecondRing && c14Gap > 45 && c4Gap > 45;
  };

  expect(await assertC3ExitOutside()).toBe(true);

  await page.locator('#clean-2d-btn').click();
  await expect.poll(assertC3ExitOutside).toBe(true);
});

function dominantMultiRingBondIds(smiles) {
  const molecule = parseSMILES(smiles);
  const { ringSystems } = analyzeRings(molecule, morganRanks(molecule));
  const multiRingSystems = ringSystems.filter(ringSystem => ringSystem.ringIds.length > 1);
  if (multiRingSystems.length !== 1 || ringSystems.length > 2) {
    return [];
  }

  const dominantAtomIdSet = new Set(multiRingSystems[0].atomIds);
  const bondIds = [];
  for (const bond of molecule.bonds.values()) {
    const [firstAtomId, secondAtomId] = bond.atoms ?? [];
    if (dominantAtomIdSet.has(firstAtomId) && dominantAtomIdSet.has(secondAtomId)) {
      bondIds.push(String(bond.id));
    }
  }
  return bondIds;
}

async function dominantBondAxisDegrees(page, bondIds) {
  return await page.evaluate(ids => {
    const points = [];
    for (const bondId of ids) {
      const line = document.querySelector(`[data-bond-id="${bondId}"] .bond-hit`);
      if (!line) {
        continue;
      }
      points.push({ x: Number(line.getAttribute('x1') ?? 0), y: Number(line.getAttribute('y1') ?? 0) }, { x: Number(line.getAttribute('x2') ?? 0), y: Number(line.getAttribute('y2') ?? 0) });
    }
    if (points.length < 2) {
      return null;
    }

    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    let inertiaXX = 0;
    let inertiaYY = 0;
    let inertiaXY = 0;
    for (const point of points) {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      inertiaXX += dy * dy;
      inertiaYY += dx * dx;
      inertiaXY -= dx * dy;
    }
    const angle0 = 0.5 * Math.atan2(2 * inertiaXY, inertiaXX - inertiaYY);
    const inertia0 = inertiaXX * Math.cos(angle0) ** 2 + inertiaYY * Math.sin(angle0) ** 2 + inertiaXY * Math.sin(2 * angle0);
    const inertia1 = inertiaXX + inertiaYY - inertia0;
    let axis = inertia0 <= inertia1 ? angle0 : angle0 + Math.PI / 2;
    if (axis > Math.PI / 2) {
      axis -= Math.PI;
    }
    if (axis <= -Math.PI / 2) {
      axis += Math.PI;
    }
    return (axis * 180) / Math.PI;
  }, bondIds);
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

async function clickBondHit(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function stereoGlyphState(page) {
  return await page.evaluate(() => ({
    wedgeCount: document.querySelectorAll('polygon.bond-wedge').length,
    hashCount: document.querySelectorAll('line.bond-hash').length
  }));
}

async function forceStereoOverlayCounts(page) {
  return await page.evaluate(() => {
    const root = document.querySelector('.svg-plot > g');
    const stereoGroup = root?.querySelector('g.force-stereo-bonds') ?? null;
    const wedgePolygons = Array.from(stereoGroup?.querySelectorAll('polygon') ?? []);
    const dashLines = Array.from(stereoGroup?.querySelectorAll('line') ?? []);
    return {
      wedgeCount: wedgePolygons.length,
      dashLineCount: dashLines.length,
      bondIds: [...new Set([...wedgePolygons, ...dashLines].map(element => element.getAttribute('data-bond-id')).filter(Boolean))]
    };
  });
}

async function forceBondTargetCenter(page, bondId) {
  return await page.evaluate(targetBondId => {
    const target = Array.from(document.querySelectorAll('line.bond-hover-target')).find(line => {
      const datum = line.__data__;
      return String(line.getAttribute('data-bond-id') ?? datum?.id ?? '') === String(targetBondId);
    });
    const rect = target?.getBoundingClientRect?.();
    return rect
      ? {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          bondId: String(targetBondId)
        }
      : null;
  }, bondId);
}

async function rootTransform(page) {
  return await page.evaluate(() => document.querySelector('.svg-plot > g')?.getAttribute('transform') ?? null);
}

async function all2dAtomsWithinPlot(page, padding = 0) {
  return await page.evaluate(pad => {
    const plot = document.querySelector('.svg-plot');
    if (!plot) {
      return false;
    }
    const plotRect = plot.getBoundingClientRect();
    const atoms = Array.from(document.querySelectorAll('g[data-atom-id]'));
    if (atoms.length === 0) {
      return false;
    }
    return atoms.every(atom => {
      const rect = atom.getBoundingClientRect();
      return rect.left >= plotRect.left + pad && rect.top >= plotRect.top + pad && rect.right <= plotRect.right - pad && rect.bottom <= plotRect.bottom - pad;
    });
  }, padding);
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
      return rect.left >= plotRect.left + pad && rect.top >= plotRect.top + pad && rect.right <= plotRect.right - pad && rect.bottom <= plotRect.bottom - pad;
    });
  }, padding);
}

async function plotGeometryWithinPlot(page, padding = 4) {
  return await page.evaluate(pad => {
    const plot = document.querySelector('.svg-plot');
    if (!plot) {
      return false;
    }
    const plotRect = plot.getBoundingClientRect();
    const geometry = Array.from(document.querySelectorAll('line.bond-hit, circle.atom-hit'));
    if (geometry.length === 0) {
      return false;
    }
    return geometry.every(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= plotRect.left + pad && rect.top >= plotRect.top + pad && rect.right <= plotRect.right - pad && rect.bottom <= plotRect.bottom - pad;
    });
  }, padding);
}

/**
 * Captures the current screen-space centers of rendered force nodes and their labels.
 * @param {import('@playwright/test').Page} page - Playwright page under test.
 * @returns {Promise<Array<{id: string, label: string, cx: number, cy: number}>>} Force-node screen points in DOM order.
 */
async function forceAtomScreenPoints(page) {
  return await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        id: String(circle.__data__?.id ?? ''),
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
}

async function forceResonanceAtomScreenPoint(page, { productSide = false, label = null, horizontal = 'left' } = {}) {
  return await page.evaluate(
    options => {
      const productPrefix = '__resonance_product__';
      const circles = Array.from(document.querySelectorAll('circle.node'));
      const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
      const atoms = circles.map((circle, index) => {
        const rect = circle.getBoundingClientRect();
        return {
          id: String(circle.__data__?.id ?? ''),
          label: labels[index]?.textContent?.trim() ?? '',
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2
        };
      });
      const candidates = atoms.filter(atom => {
        const isProduct = atom.id.startsWith(productPrefix);
        return isProduct === options.productSide && (!options.label || atom.label === options.label);
      });
      candidates.sort((a, b) => (options.horizontal === 'right' ? b.cx - a.cx : a.cx - b.cx));
      return candidates[0] ?? null;
    },
    { productSide, label, horizontal }
  );
}

async function forceResonanceBondScreenPoint(page, { productSide = false, horizontal = 'left' } = {}) {
  return await page.evaluate(
    options => {
      const productPrefix = '__resonance_product__:';
      const lines = Array.from(document.querySelectorAll('line.bond-hover-target'));
      const bonds = lines
        .map(line => {
          const datum = line.__data__ ?? {};
          const id = String(datum.id ?? line.getAttribute('data-bond-id') ?? '');
          const source = datum.source ?? {};
          const target = datum.target ?? {};
          const svg = line.ownerSVGElement;
          const matrix = svg?.getScreenCTM?.();
          if (!svg || !matrix || !Number.isFinite(source.x) || !Number.isFinite(source.y) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
            return null;
          }
          const point = svg.createSVGPoint();
          point.x = (source.x + target.x) / 2;
          point.y = (source.y + target.y) / 2;
          const screenPoint = point.matrixTransform(matrix);
          return {
            id,
            cx: screenPoint.x,
            cy: screenPoint.y
          };
        })
        .filter(Boolean)
        .filter(bond => bond.id.startsWith(productPrefix) === options.productSide);
      bonds.sort((a, b) => (options.horizontal === 'right' ? b.cx - a.cx : a.cx - b.cx));
      return bonds[0] ?? null;
    },
    { productSide, horizontal }
  );
}

async function resonanceBondScreenPoint2d(page, { productSide = false, horizontal = 'left' } = {}) {
  return await page.evaluate(
    options => {
      const productPrefix = '__resonance_product__:';
      const lines = Array.from(document.querySelectorAll('line.bond-hit'));
      const bonds = lines
        .map(line => {
          const group = line.closest?.('[data-bond-id]');
          const id = String(group?.getAttribute?.('data-bond-id') ?? line.__data__?.id ?? '');
          const svg = line.ownerSVGElement;
          const matrix = line.getScreenCTM?.();
          if (!svg || !matrix || !id) {
            return null;
          }
          const point = svg.createSVGPoint();
          point.x = (Number(line.getAttribute('x1') ?? 0) + Number(line.getAttribute('x2') ?? 0)) / 2;
          point.y = (Number(line.getAttribute('y1') ?? 0) + Number(line.getAttribute('y2') ?? 0)) / 2;
          const screenPoint = point.matrixTransform(matrix);
          return {
            id,
            cx: screenPoint.x,
            cy: screenPoint.y
          };
        })
        .filter(Boolean)
        .filter(bond => bond.id.startsWith(productPrefix) === options.productSide);
      bonds.sort((a, b) => (options.horizontal === 'right' ? b.cx - a.cx : a.cx - b.cx));
      return bonds[0] ?? null;
    },
    { productSide, horizontal }
  );
}

async function forceNodeLayoutSignature(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('circle.node'))
      .map(circle => {
        const node = circle.__data__ ?? {};
        return {
          id: String(node.id ?? ''),
          x: Number(node.x ?? 0),
          y: Number(node.y ?? 0)
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

async function forceRenderedNodeLayoutSignature(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('circle.node'))
      .map(circle => {
        const rect = circle.getBoundingClientRect();
        return {
          id: String(circle.__data__?.id ?? ''),
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

function forceNodeLayoutsClose(actual, expected, tolerance = 0.5) {
  if (actual.length !== expected.length) {
    return false;
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i].id !== expected[i].id) {
      return false;
    }
    if (Math.abs(actual[i].x - expected[i].x) > tolerance || Math.abs(actual[i].y - expected[i].y) > tolerance) {
      return false;
    }
  }
  return true;
}

/**
 * Computes the screen-space horizontal separation between reaction-preview
 * reactant and product force nodes.
 * @param {import('@playwright/test').Page} page - Playwright page under test.
 * @returns {Promise<number>} Product-centroid x minus reactant-centroid x.
 */
async function forceReactionPreviewHorizontalDelta(page) {
  return await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const points = circles.map(circle => {
      const rect = circle.getBoundingClientRect();
      return {
        id: String(circle.__data__?.id ?? ''),
        cx: rect.left + rect.width / 2
      };
    });
    const reactant = points.filter(point => !point.id.startsWith('__rxn_product__'));
    const product = points.filter(point => point.id.startsWith('__rxn_product__'));
    if (reactant.length === 0 || product.length === 0) {
      return 0;
    }
    const reactantCx = reactant.reduce((sum, point) => sum + point.cx, 0) / reactant.length;
    const productCx = product.reduce((sum, point) => sum + point.cx, 0) / product.length;
    return productCx - reactantCx;
  });
}

async function resonanceBondSnapshot2d(page) {
  return await page.evaluate(() => {
    const round = value => Math.round(Number(value) * 10) / 10;
    return Array.from(document.querySelectorAll('line.bond-hit')).map(line => ({
      x1: round(line.getAttribute('x1')),
      y1: round(line.getAttribute('y1')),
      x2: round(line.getAttribute('x2')),
      y2: round(line.getAttribute('y2'))
    }));
  });
}

/**
 * Computes the signed area of the triangle formed by the three requested force nodes.
 * @param {Array<{id: string, cx: number, cy: number}>} points - Force-node screen points keyed by atom id.
 * @param {string} firstId - First atom id.
 * @param {string} secondId - Second atom id.
 * @param {string} thirdId - Third atom id.
 * @returns {number} Signed screen-space triangle area.
 */
function signedTriangleArea(points, firstId, secondId, thirdId) {
  const pointById = new Map(points.map(point => [point.id, point]));
  const first = pointById.get(firstId);
  const second = pointById.get(secondId);
  const third = pointById.get(thirdId);
  if (!first || !second || !third) {
    throw new Error(`Missing force-node triangle point(s): ${firstId}, ${secondId}, ${thirdId}`);
  }
  return (second.cx - first.cx) * (third.cy - first.cy) - (second.cy - first.cy) * (third.cx - first.cx);
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

test('browser 2D rendering keeps one clearly dominant multi-ring scaffold level by that scaffold axis', async ({ page }) => {
  const smiles = 'CCCCC1=CC2=C(C=C1C(=CC1=CC=NO1)C(C)C)C(C)(C)CC2(C)C';
  const bondIds = dominantMultiRingBondIds(smiles);

  await page.goto('/index.html');
  await loadSmiles(page, smiles);
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const axisDegrees = await dominantBondAxisDegrees(page, bondIds);

  expect(Math.abs(axisDegrees ?? Infinity)).toBeLessThanOrEqual(1);
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

test('random molecule selection avoids revisiting recent entries before exhausting the current shuffled run', async ({ page }) => {
  await page.goto('/index.html');

  const picks = await page.evaluate(() => {
    Math.random = () => 0;
    const input = document.getElementById('smiles-input');
    const values = [];
    for (let index = 0; index < 4; index++) {
      window.pickRandomMolecule();
      values.push(input?.value ?? '');
    }
    return values;
  });

  expect(new Set(picks).size).toBe(4);
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

test('undo preserves localized aromatic rendering for 2d-rotated aza-aromatic ring systems', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length
      }))
    )
    .toEqual({ dashed: 0 });

  await page.locator('#rotate-cw').click();
  await page.locator('#undo-btn').click();

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length
      }))
    )
    .toEqual({ dashed: 0 });
});

test('undo preserves hidden stereo hydrogen rendering after loading a random molecule', async ({ page }) => {
  await page.goto('/index.html');

  const smiles = 'C1C[C@H]2[C@@H](C1)C=C[C@H]2O';
  await loadSmiles(page, smiles);

  const atomTransforms = async atomIds =>
    await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, document.querySelector(`g[data-atom-id="${id}"]`)?.getAttribute('transform') ?? null])), atomIds);

  const stereoSignature = async () =>
    await page.evaluate(() => ({
      wedges: Array.from(document.querySelectorAll('polygon.bond-wedge')).map(element => element.getAttribute('points')),
      hashes: Array.from(document.querySelectorAll('line.bond-hash')).map(element => [element.getAttribute('x1'), element.getAttribute('y1'), element.getAttribute('x2'), element.getAttribute('y2')])
    }));

  const before = await stereoSignature();
  expect(before.wedges.length + before.hashes.length).toBeGreaterThan(0);
  const beforeTransforms = await atomTransforms(['C3', 'H4', 'C5', 'H6']);
  expect(beforeTransforms.H4).not.toEqual(beforeTransforms.C3);
  expect(beforeTransforms.H6).not.toEqual(beforeTransforms.C5);

  await page.evaluate(() => window.pickRandomMolecule());
  await page.locator('#undo-btn').click();

  const after = await stereoSignature();
  const afterTransforms = await atomTransforms(['C3', 'H4', 'C5', 'H6']);
  expect(after).toEqual(before);
  expect(afterTransforms).toEqual(beforeTransforms);
  await expect(page.locator('#smiles-input')).toHaveValue(smiles);
});

test('renders stereo hydrogens away from their parent carbons on initial 2d load', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const transforms = await page.evaluate(() => ({
    C3: document.querySelector('g[data-atom-id="C3"]')?.getAttribute('transform') ?? null,
    H4: document.querySelector('g[data-atom-id="H4"]')?.getAttribute('transform') ?? null,
    C5: document.querySelector('g[data-atom-id="C5"]')?.getAttribute('transform') ?? null,
    H6: document.querySelector('g[data-atom-id="H6"]')?.getAttribute('transform') ?? null
  }));

  expect(transforms.H4).not.toEqual(transforms.C3);
  expect(transforms.H6).not.toEqual(transforms.C5);
});

test('2D projected bridged stereo hydrogen avoids nearby cage atoms', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, '[Br-].CCCC[N+]1(C)[C@H]2C[C@@H](C[C@@H]1[C@H]1O[C@@H]21)OC(=O)[C@H](CO)C1=CC=CC=C1');

  const geometry = await page.evaluate(() => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const atomPoint = atomId => parseTranslate(document.querySelector(`g[data-atom-id="${atomId}"]`)?.getAttribute('transform'));
    const c14 = atomPoint('C14');
    const h15 = atomPoint('H15');
    const c19 = atomPoint('C19');
    return {
      h15C19Distance: h15 && c19 ? Math.hypot(h15.x - c19.x, h15.y - c19.y) : null,
      h15C14Distance: h15 && c14 ? Math.hypot(h15.x - c14.x, h15.y - c14.y) : null
    };
  });

  expect(geometry.h15C14Distance).toBeGreaterThan(40);
  expect(geometry.h15C19Distance).toBeGreaterThan(30);
});

test('2D atom numbering follows projected stereochemical hydrogens away from parent bonds', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('button.smarts-tab[data-tab="other"]').click();
  await page.locator('#atom-numbering-body tr').filter({ hasText: 'Atom Numbering' }).click();

  await expect(page.locator('g.atom-numbering-overlay text.atom-num[data-atom-id="H4"]')).toHaveCount(1);
  await expect(page.locator('g.atom-numbering-overlay text.atom-num[data-atom-id="H6"]')).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const atomPoint = atomId => parseTranslate(document.querySelector(`g[data-atom-id="${atomId}"]`)?.getAttribute('transform'));
    const numberPoint = atomId => {
      const label = document.querySelector(`g.atom-numbering-overlay text.atom-num[data-atom-id="${atomId}"]`);
      return label
        ? {
            text: label.textContent ?? '',
            x: Number(label.getAttribute('x')),
            y: Number(label.getAttribute('y'))
          }
        : null;
    };
    const distanceToSegment = (point, start, end) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
      return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    };
    const metricsFor = (hydrogenId, parentId) => {
      const hydrogen = atomPoint(hydrogenId);
      const parent = atomPoint(parentId);
      const number = numberPoint(hydrogenId);
      if (!hydrogen || !parent || !number) {
        return null;
      }
      const outwardDot = (number.x - hydrogen.x) * (parent.x - hydrogen.x) + (number.y - hydrogen.y) * (parent.y - hydrogen.y);
      return {
        numberText: number.text,
        numberIsOutward: outwardDot < 0,
        numberCloserToHydrogenThanParent: Math.hypot(number.x - hydrogen.x, number.y - hydrogen.y) < Math.hypot(number.x - parent.x, number.y - parent.y),
        numberDistanceToBond: distanceToSegment(number, parent, hydrogen)
      };
    };
    return {
      visibleAtomCount: document.querySelectorAll('g.atom-labels g[data-atom-id]').length,
      numberCount: document.querySelectorAll('g.atom-numbering-overlay text.atom-num').length,
      H4: metricsFor('H4', 'C3'),
      H6: metricsFor('H6', 'C5')
    };
  });

  expect(geometry.numberCount).toBe(geometry.visibleAtomCount);
  for (const metrics of [geometry.H4, geometry.H6]) {
    expect(metrics).toBeTruthy();
    expect(metrics.numberText).toMatch(/^\d+$/);
    expect(metrics.numberIsOutward).toBe(true);
    expect(metrics.numberCloserToHydrogenThanParent).toBe(true);
    expect(metrics.numberDistanceToBond).toBeGreaterThan(8);
  }
});

test('2D atom numbering clears prefix ammonium atom labels', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC1N=C(NC1=O)C1([NH3+])CC1');
  await page.locator('button.smarts-tab[data-tab="other"]').click();
  await page.locator('#atom-numbering-body tr').filter({ hasText: 'Atom Numbering' }).click();

  await expect(page.locator('g.atom-numbering-overlay text.atom-num[data-atom-id="N9"]')).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const numberLabel = document.querySelector('g.atom-numbering-overlay text.atom-num[data-atom-id="N9"]');
    const atomLabel = document.querySelector('g.atom-labels g[data-atom-id="N9"] text.atom-label');
    const rectFor = node => {
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        text: node.textContent ?? ''
      };
    };
    const numberRect = rectFor(numberLabel);
    const atomRect = rectFor(atomLabel);
    const overlaps = (first, second, padding = 1) =>
      !!first && !!second && first.left < second.right + padding && first.right > second.left - padding && first.top < second.bottom + padding && first.bottom > second.top - padding;
    return {
      atomLabelText: atomRect?.text ?? '',
      numberText: numberRect?.text ?? '',
      overlapsLabel: overlaps(numberRect, atomRect)
    };
  });

  expect(geometry.atomLabelText).toBe('H3N');
  expect(geometry.numberText).toBe('9');
  expect(geometry.overlapsLabel).toBe(false);
});

test('2D atom numbering clears terminal imine and nitrile multiple-bond strokes', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'ClC1=CC=CC(Cl)=C1CC(=N)NC(=S)NC1=CC=C(C=C1)C#N');
  await page.locator('button.smarts-tab[data-tab="other"]').click();
  await page.locator('#atom-numbering-body tr').filter({ hasText: 'Atom Numbering' }).click();

  await expect(page.locator('g.atom-numbering-overlay text.atom-num[data-atom-id="N11"]')).toHaveCount(1);
  await expect(page.locator('g.atom-numbering-overlay text.atom-num[data-atom-id="N23"]')).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const numberPoint = atomId => {
      const label = document.querySelector(`g.atom-numbering-overlay text.atom-num[data-atom-id="${atomId}"]`);
      return label
        ? {
            text: label.textContent ?? '',
            x: Number(label.getAttribute('x')),
            y: Number(label.getAttribute('y'))
          }
        : null;
    };
    const bondLines = bondId =>
      Array.from(document.querySelectorAll(`g.bonds g[data-bond-id="${bondId}"] line:not(.bond-hit)`)).map(line => ({
        start: { x: Number(line.getAttribute('x1')), y: Number(line.getAttribute('y1')) },
        end: { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) }
      }));
    const distanceToSegment = (point, start, end) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
      return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    };
    const nearestLineDistance = (point, lines) => Math.min(...lines.map(line => distanceToSegment(point, line.start, line.end)));
    const n11 = numberPoint('N11');
    const n23 = numberPoint('N23');
    return {
      n11Text: n11?.text ?? '',
      n23Text: n23?.text ?? '',
      n11DoubleBondDistance: nearestLineDistance(n11, bondLines('5')),
      n23TripleBondDistance: nearestLineDistance(n23, bondLines('15'))
    };
  });

  expect(geometry.n11Text).toBe('11');
  expect(geometry.n23Text).toBe('23');
  expect(geometry.n11DoubleBondDistance).toBeGreaterThan(10);
  expect(geometry.n23TripleBondDistance).toBeGreaterThan(10);
});

test('dragging a projected stereo hydrogen follows the mouse in real time', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
  await expect(hydrogenHit).toHaveCount(1);

  const startBox = await hydrogenHit.boundingBox();
  expect(startBox).toBeTruthy();

  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const targetX = startX + 64;
  const targetY = startY - 42;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 10 });

  const duringBox = await hydrogenHit.boundingBox();
  expect(duringBox).toBeTruthy();
  const duringCenterX = duringBox.x + duringBox.width / 2;
  const duringCenterY = duringBox.y + duringBox.height / 2;
  expect(Math.abs(duringCenterX - targetX)).toBeLessThan(18);
  expect(Math.abs(duringCenterY - targetY)).toBeLessThan(18);

  await page.mouse.up();

  const afterBox = await hydrogenHit.boundingBox();
  expect(afterBox).toBeTruthy();
  const afterCenterX = afterBox.x + afterBox.width / 2;
  const afterCenterY = afterBox.y + afterBox.height / 2;
  expect(Math.abs(afterCenterX - targetX)).toBeLessThan(18);
  expect(Math.abs(afterCenterY - targetY)).toBeLessThan(18);
});

test('cleaning 2d after dragging a projected stereo hydrogen restores its default position', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
  await expect(hydrogenHit).toHaveCount(1);

  const getTransform = async atomId => await page.evaluate(id => document.querySelector(`g[data-atom-id="${id}"]`)?.getAttribute('transform') ?? null, atomId);
  const initialTransform = await getTransform('H4');
  expect(initialTransform).not.toBeNull();

  const startBox = await hydrogenHit.boundingBox();
  expect(startBox).toBeTruthy();

  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 64, startY - 42, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => await getTransform('H4')).not.toEqual(initialTransform);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(async () => await getTransform('H4')).toEqual(initialTransform);
});

test('deleting a displayed stereo hydrogen bond also removes the hydrogen in 2d', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  await expect(page.locator('g[data-atom-id="H4"] .atom-hit')).toHaveCount(1);

  const hydrogenBondId = await page.evaluate(() => {
    const hydrogenGroup = document.querySelector('g[data-atom-id="H4"]');
    if (!hydrogenGroup) {
      return null;
    }
    const transform = hydrogenGroup.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!match) {
      return null;
    }
    const hx = Number(match[1]);
    const hy = Number(match[2]);
    let closestBondId = null;
    let closestDistance = Infinity;
    for (const group of document.querySelectorAll('g[data-bond-id]')) {
      const hit = group.querySelector('line.bond-hit');
      if (!hit) {
        continue;
      }
      const x1 = Number(hit.getAttribute('x1') ?? NaN);
      const y1 = Number(hit.getAttribute('y1') ?? NaN);
      const x2 = Number(hit.getAttribute('x2') ?? NaN);
      const y2 = Number(hit.getAttribute('y2') ?? NaN);
      const distance = Math.min(Math.hypot(x1 - hx, y1 - hy), Math.hypot(x2 - hx, y2 - hy));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBondId = group.getAttribute('data-bond-id');
      }
    }
    return closestDistance <= 12 ? closestBondId : null;
  });

  expect(hydrogenBondId).toBeTruthy();

  const hydrogenBondHit = page.locator(`g[data-bond-id="${hydrogenBondId}"] .bond-hit`);
  const bondBox = await hydrogenBondHit.boundingBox();
  expect(bondBox).toBeTruthy();
  await page.mouse.move(bondBox.x + bondBox.width / 2, bondBox.y + bondBox.height / 2);
  await page.keyboard.press('Delete');

  await expect(page.locator('g[data-atom-id="H4"]')).toHaveCount(0);
  await expect(page.locator('circle.valence-warning')).toHaveCount(0);
});

test('changing a dashed stereochemical hydrogen bond back to a single bond hides the hydrogen in 2d', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  await expect(page.locator('g[data-atom-id="H4"] .atom-hit')).toHaveCount(1);

  const hydrogenBondId = await page.evaluate(() => {
    const hydrogenGroup = document.querySelector('g[data-atom-id="H4"]');
    if (!hydrogenGroup) {
      return null;
    }
    const transform = hydrogenGroup.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!match) {
      return null;
    }
    const hx = Number(match[1]);
    const hy = Number(match[2]);
    let closestBondId = null;
    let closestDistance = Infinity;
    for (const group of document.querySelectorAll('g[data-bond-id]')) {
      const hit = group.querySelector('line.bond-hit');
      if (!hit) {
        continue;
      }
      const x1 = Number(hit.getAttribute('x1') ?? NaN);
      const y1 = Number(hit.getAttribute('y1') ?? NaN);
      const x2 = Number(hit.getAttribute('x2') ?? NaN);
      const y2 = Number(hit.getAttribute('y2') ?? NaN);
      const distance = Math.min(Math.hypot(x1 - hx, y1 - hy), Math.hypot(x2 - hx, y2 - hy));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBondId = group.getAttribute('data-bond-id');
      }
    }
    return closestDistance <= 12 ? closestBondId : null;
  });

  expect(hydrogenBondId).toBeTruthy();

  const hydrogenBondHit = page.locator(`g[data-bond-id="${hydrogenBondId}"] .bond-hit`);
  const clickHydrogenBond = async () => {
    const bondBox = await hydrogenBondHit.boundingBox();
    expect(bondBox).toBeTruthy();
    await page.mouse.click(bondBox.x + bondBox.width / 2, bondBox.y + bondBox.height / 2);
  };

  await page.locator('#draw-bond-type-dash').click();
  await clickHydrogenBond();
  await expect.poll(async () => await page.locator(`g[data-bond-id="${hydrogenBondId}"] line.bond-hash`).count()).toBeGreaterThan(0);

  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-single').click();
  await clickHydrogenBond();

  await expect(page.locator('g[data-atom-id="H4"]')).toHaveCount(0);
  await expect(page.locator('circle.valence-warning')).toHaveCount(0);
});

test('2D dash drags from a displayed stereochemical hydrogen keep the hydrogen off the parent atom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();

  const atomCenter = async atomId =>
    await page.evaluate(id => {
      const hit = document.querySelector(`g[data-atom-id="${id}"] .atom-hit`);
      const rect = hit?.getBoundingClientRect?.();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    }, atomId);

  const hydrogenBefore = await atomCenter('H4');
  const parentBefore = await atomCenter('C3');
  expect(hydrogenBefore).toBeTruthy();
  expect(parentBefore).toBeTruthy();

  await page.mouse.move(hydrogenBefore.x, hydrogenBefore.y);
  await page.mouse.down();
  await page.mouse.move(parentBefore.x, parentBefore.y, { steps: 10 });
  await page.mouse.up();

  const hydrogenAfter = await atomCenter('H4');
  const parentAfter = await atomCenter('C3');
  expect(hydrogenAfter).toBeTruthy();
  expect(parentAfter).toBeTruthy();
  expect(Math.hypot(hydrogenAfter.x - parentAfter.x, hydrogenAfter.y - parentAfter.y)).toBeGreaterThan(20);
});

test('incompatible bond orders on a displayed 2D stereochemical hydrogen are a no-op', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  await expect(page.locator('g[data-atom-id="H4"] .atom-hit')).toHaveCount(1);

  const hydrogenBondId = await page.evaluate(() => {
    const hydrogenGroup = document.querySelector('g[data-atom-id="H4"]');
    if (!hydrogenGroup) {
      return null;
    }
    const transform = hydrogenGroup.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!match) {
      return null;
    }
    const hx = Number(match[1]);
    const hy = Number(match[2]);
    let closestBondId = null;
    let closestDistance = Infinity;
    for (const group of document.querySelectorAll('g[data-bond-id]')) {
      const hit = group.querySelector('line.bond-hit');
      if (!hit) {
        continue;
      }
      const x1 = Number(hit.getAttribute('x1') ?? NaN);
      const y1 = Number(hit.getAttribute('y1') ?? NaN);
      const x2 = Number(hit.getAttribute('x2') ?? NaN);
      const y2 = Number(hit.getAttribute('y2') ?? NaN);
      const distance = Math.min(Math.hypot(x1 - hx, y1 - hy), Math.hypot(x2 - hx, y2 - hy));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBondId = group.getAttribute('data-bond-id');
      }
    }
    return closestDistance <= 12 ? closestBondId : null;
  });

  expect(hydrogenBondId).toBeTruthy();

  const hydrogenBondHit = page.locator(`g[data-bond-id="${hydrogenBondId}"] .bond-hit`);
  const clickHydrogenBond = async () => {
    const bondBox = await hydrogenBondHit.boundingBox();
    expect(bondBox).toBeTruthy();
    await page.mouse.click(bondBox.x + bondBox.width / 2, bondBox.y + bondBox.height / 2);
  };

  const captureState = async () =>
    await page.evaluate(() => ({
      smiles: window._getMolSmiles?.() ?? null,
      wedgeCount: document.querySelectorAll('polygon.bond-wedge').length,
      hashCount: document.querySelectorAll('line.bond-hash').length,
      hydrogenCount: document.querySelectorAll('g[data-atom-id="H4"]').length
    }));

  const before = await captureState();

  for (const drawBondType of ['double', 'triple', 'aromatic']) {
    await page.locator('#draw-bond-btn').hover();
    await page.locator(`#draw-bond-type-${drawBondType}`).click();
    await clickHydrogenBond();
    await expect.poll(captureState).toEqual(before);
  }
});

test('clicking a displayed 2D stereochemical hydrogen with carbon, oxygen, or sulfur draw elements keeps the replacement atom off the parent carbon', async ({ page }) => {
  for (const drawElement of ['C', 'O', 'S']) {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    await page.locator('#draw-bond-btn').click();
    if (drawElement !== 'C') {
      await page.locator(`#elem-btn-${drawElement}`).click();
    }

    const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
    await expect(hydrogenHit).toHaveCount(1);
    await hydrogenHit.click();

    const separation = await page.evaluate(() => {
      const atomCenter = atomId => {
        const group = document.querySelector(`g[data-atom-id="${atomId}"]`);
        if (!group) {
          return null;
        }
        const hit = group.querySelector('.atom-hit');
        const rect = hit?.getBoundingClientRect?.() ?? group.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      };
      const replacement = atomCenter('H4');
      const parent = atomCenter('C3');
      if (!replacement || !parent) {
        return null;
      }
      return Math.hypot(replacement.x - parent.x, replacement.y - parent.y);
    });

    expect(separation).not.toBeNull();
    expect(separation).toBeGreaterThan(10);
    if (drawElement !== 'C') {
      await expect.poll(async () => await page.locator('g[data-atom-id="H4"]').evaluate(node => node.textContent?.trim() ?? '')).toContain(drawElement);
    }
    await expect(page.locator('circle.valence-warning')).toHaveCount(0);
  }
});

test('2D draw-bond drags from a displayed stereochemical hydrogen do not create brand-new atoms', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
  await expect(hydrogenHit).toHaveCount(1);

  const hydrogenBox = await hydrogenHit.boundingBox();
  expect(hydrogenBox).toBeTruthy();
  const hx = hydrogenBox.x + hydrogenBox.width / 2;
  const hy = hydrogenBox.y + hydrogenBox.height / 2;
  const atomCountBefore = await page.locator('g[data-atom-id]').count();

  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await expect(page.locator('g.draw-bond-preview line.draw-bond-preview-segment')).toHaveCount(0);
  await page.mouse.move(hx + 80, hy - 20, { steps: 8 });
  await expect(page.locator('g.draw-bond-preview line.draw-bond-preview-segment')).toHaveCount(0);
  await page.mouse.up();

  await expect(page.locator('g[data-atom-id]')).toHaveCount(atomCountBefore);
});

test('cleaning 2d after dragging a carbonyl restores reasonable local carbonyl geometry', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const getAtomCenters = async atomIds =>
    await page.evaluate(
      ids =>
        Object.fromEntries(
          ids.map(id => {
            const rect = document.querySelector(`g[data-atom-id="${id}"] .atom-hit`)?.getBoundingClientRect();
            return [id, rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null];
          })
        ),
      atomIds
    );
  const carbonylMetrics = centers => {
    const dist = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
    const angle = (center, first, second) => {
      const v1x = first.x - center.x;
      const v1y = first.y - center.y;
      const v2x = second.x - center.x;
      const v2y = second.y - center.y;
      const dot = v1x * v2x + v1y * v2y;
      const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
      return Math.acos(Math.min(1, Math.max(-1, dot / mag))) * (180 / Math.PI);
    };
    return {
      C10C12: dist(centers.C10, centers.C12),
      C12O13: dist(centers.C12, centers.O13),
      C12O14: dist(centers.C12, centers.O14),
      O13C12O14: angle(centers.C12, centers.O13, centers.O14)
    };
  };

  const atomIds = ['C10', 'C12', 'O13', 'O14'];
  const initialCenters = await getAtomCenters(atomIds);
  const initialMetrics = carbonylMetrics(initialCenters);
  expect(initialCenters.O13).not.toBeNull();

  const oxygenHit = page.locator('g[data-atom-id="O13"] .atom-hit');
  const startBox = await oxygenHit.boundingBox();
  expect(startBox).toBeTruthy();

  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const targetX = startX + 110;
  const targetY = startY + 75;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();

  const draggedCenters = await getAtomCenters(atomIds);
  expect(Math.hypot(draggedCenters.O13.x - initialCenters.O13.x, draggedCenters.O13.y - initialCenters.O13.y)).toBeGreaterThan(40);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const cleanedMetrics = carbonylMetrics(await getAtomCenters(atomIds));
      return (
        Math.abs(cleanedMetrics.O13C12O14 - initialMetrics.O13C12O14) < 1 &&
        Math.abs(cleanedMetrics.C10C12 - cleanedMetrics.C12O13) < 1.5 &&
        Math.abs(cleanedMetrics.C12O13 - cleanedMetrics.C12O14) < 1.5
      );
    })
    .toBe(true);
});

test('cleaning cocaine twice in 2d keeps the twice-cleaned layout readable and within the plot', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CN1C2CCC1C(C(OC)=O)C(OC(c3ccccc3)=O)C2');

  const layoutMetrics = async () =>
    await page.evaluate(() => {
      const lengths = Array.from(document.querySelectorAll('line.bond-hit'))
        .map(line => {
          const x1 = Number(line.getAttribute('x1') ?? NaN);
          const y1 = Number(line.getAttribute('y1') ?? NaN);
          const x2 = Number(line.getAttribute('x2') ?? NaN);
          const y2 = Number(line.getAttribute('y2') ?? NaN);
          return Math.hypot(x2 - x1, y2 - y1);
        })
        .filter(length => Number.isFinite(length) && length > 0);
      const plotRect = document.getElementById('plot')?.getBoundingClientRect();
      const atomCenters = Array.from(document.querySelectorAll('g[data-atom-id] .atom-hit'))
        .map(element => {
          const atomId = element.parentElement?.getAttribute('data-atom-id') ?? '';
          const rect = element.getBoundingClientRect();
          return {
            atomId,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        })
        .filter(atom => atom.atomId && !atom.atomId.startsWith('H'));
      return {
        atomCount: atomCenters.length,
        bondCount: lengths.length,
        maxBondRatio: lengths.length ? Math.max(...lengths) / Math.min(...lengths) : Number.POSITIVE_INFINITY,
        inPlot: !!plotRect && atomCenters.every(atom => atom.x >= plotRect.left - 4 && atom.x <= plotRect.right + 4 && atom.y >= plotRect.top - 4 && atom.y <= plotRect.bottom + 4)
      };
    });

  await page.locator('#clean-2d-btn').click();
  const firstCleanMetrics = await layoutMetrics();

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const secondCleanMetrics = await layoutMetrics();
      return (
        secondCleanMetrics.atomCount === firstCleanMetrics.atomCount &&
        secondCleanMetrics.bondCount === firstCleanMetrics.bondCount &&
        secondCleanMetrics.inPlot &&
        secondCleanMetrics.maxBondRatio < 2.5 &&
        secondCleanMetrics.maxBondRatio <= firstCleanMetrics.maxBondRatio + 0.5
      );
    })
    .toBe(true);
});

test('dense bridged alkaloids do not render with catastrophic stretched bonds in 2d', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'COC(=O)C1=C2Nc3ccccc3[C@@]24CCN5[C@@H]6O[C@]78[C@H]9C[C@]%10%11CCO[C@H]%10CCN%12CC[C@]7([C@H]%11%12)c%13cccc(OC)c%13N8C[C@]6(C9)[C@@H]%14OCC[C@]%14(C1)[C@@H]45');

  await expect.poll(async () => await page.locator('g[data-atom-id] .atom-hit').count()).toBeGreaterThan(45);

  const bondMetrics = await page.evaluate(() => {
    const lengths = Array.from(document.querySelectorAll('line.bond-hit'))
      .map(line => {
        const x1 = Number(line.getAttribute('x1') ?? NaN);
        const y1 = Number(line.getAttribute('y1') ?? NaN);
        const x2 = Number(line.getAttribute('x2') ?? NaN);
        const y2 = Number(line.getAttribute('y2') ?? NaN);
        return Math.hypot(x2 - x1, y2 - y1);
      })
      .filter(length => Number.isFinite(length) && length > 0);
    return {
      count: lengths.length,
      min: Math.min(...lengths),
      max: Math.max(...lengths)
    };
  });

  expect(bondMetrics.count).toBeGreaterThan(50);
  expect(bondMetrics.max / bondMetrics.min).toBeLessThan(3.5);
  expect(await plotGeometryWithinPlot(page)).toBe(true);

  const bridgedRingAngles = await page.evaluate(() => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const atomPoint = atomId => parseTranslate(document.querySelector(`g[data-atom-id="${atomId}"]`)?.getAttribute('transform'));
    const ringAngles = atomIds =>
      atomIds.map((atomId, index) => {
        const previous = atomPoint(atomIds[(index - 1 + atomIds.length) % atomIds.length]);
        const current = atomPoint(atomId);
        const next = atomPoint(atomIds[(index + 1) % atomIds.length]);
        if (!previous || !current || !next) {
          return null;
        }
        const firstVector = { x: previous.x - current.x, y: previous.y - current.y };
        const secondVector = { x: next.x - current.x, y: next.y - current.y };
        const dot = firstVector.x * secondVector.x + firstVector.y * secondVector.y;
        const firstMagnitude = Math.hypot(firstVector.x, firstVector.y);
        const secondMagnitude = Math.hypot(secondVector.x, secondVector.y);
        return Math.acos(Math.max(-1, Math.min(1, dot / (firstMagnitude * secondMagnitude)))) * (180 / Math.PI);
      });
    const ringBondLengths = atomIds =>
      atomIds.map((atomId, index) => {
        const current = atomPoint(atomId);
        const next = atomPoint(atomIds[(index + 1) % atomIds.length]);
        return current && next ? Math.hypot(next.x - current.x, next.y - current.y) : null;
      });
    return {
      oxolane: ringAngles(['C29', 'O28', 'C27', 'C26', 'C25']),
      centralEther: ringAngles(['C50', 'C22', 'C21', 'O20', 'C18', 'C49']),
      rightAmine: ringAngles(['C37', 'C36', 'C35', 'C34', 'N33']),
      fusedIndoleFive: ringAngles(['C14', 'C13', 'C8', 'N7', 'C6']),
      lowerAromatic: ringAngles(['C9', 'C10', 'C11', 'C12', 'C13', 'C8']),
      rightAromatic: ringAngles(['C46', 'C39', 'C40', 'C41', 'C42', 'C43']),
      centralEtherBonds: ringBondLengths(['C50', 'C22', 'C21', 'O20', 'C18', 'C49']),
      lowerAromaticBonds: ringBondLengths(['C9', 'C10', 'C11', 'C12', 'C13', 'C8']),
      rightAromaticBonds: ringBondLengths(['C46', 'C39', 'C40', 'C41', 'C42', 'C43'])
    };
  });
  const oxolaneAngles = bridgedRingAngles.oxolane;
  expect(Math.min(...oxolaneAngles)).toBeGreaterThan(70);
  expect(Math.max(...oxolaneAngles.map(angle => Math.abs(angle - 108)))).toBeLessThan(13);
  expect(Math.max(...bridgedRingAngles.centralEther.map(angle => Math.abs(angle - 120)))).toBeLessThan(13);
  expect(Math.max(...bridgedRingAngles.rightAmine.map(angle => Math.abs(angle - 108)))).toBeLessThan(13);
  expect(Math.max(...bridgedRingAngles.fusedIndoleFive.map(angle => Math.abs(angle - 108)))).toBeLessThan(13);
  expect(Math.max(...bridgedRingAngles.lowerAromatic.map(angle => Math.abs(angle - 120)))).toBeLessThan(13);
  expect(Math.max(...bridgedRingAngles.rightAromatic.map(angle => Math.abs(angle - 120)))).toBeLessThan(13);
  expect(Math.max(...bridgedRingAngles.centralEtherBonds) / Math.min(...bridgedRingAngles.centralEtherBonds)).toBeLessThan(1.65);
  expect(Math.max(...bridgedRingAngles.lowerAromaticBonds) / Math.min(...bridgedRingAngles.lowerAromaticBonds)).toBeLessThan(1.35);
  expect(Math.max(...bridgedRingAngles.rightAromaticBonds) / Math.min(...bridgedRingAngles.rightAromaticBonds)).toBeLessThan(1.5);
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
  await page.mouse.move(startX + 120, startY + 10, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('#smiles-input')).toHaveValue('CCOC');
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
});

test('copying and pasting a selected 2D atom previews then places a selected copy', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');
  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  await expect(page.locator('g.paste-preview-layer .atom-label')).toHaveAttribute('fill', /^(?!#1f4f9d$).+/);

  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  await page.mouse.move(plotBox.x + plotBox.width - 8, plotBox.y + plotBox.height - 8);
  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  await page.mouse.click(plotBox.x + plotBox.width - 8, plotBox.y + plotBox.height - 8);

  await expect(page.locator('g.paste-preview-layer')).toHaveCount(0);
  await expect(page.locator('g[data-atom-id="O4"] .atom-hit')).toHaveCount(1);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
  await expect.poll(async () => await plotGeometryWithinPlot(page, 2)).toBe(true);

  await page.locator('#undo-btn').click();
  await expect(page.locator('g[data-atom-id="O4"] .atom-hit')).toHaveCount(0);
});

test('copying and pasting a whole 2D molecule preserves preview bond geometry', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();

  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  const blankPoint = await blankSvgPoint(page);
  await page.mouse.click(blankPoint.x, blankPoint.y);
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');

  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  const longestPreviewBond = await page.evaluate(() => {
    const lengths = [...document.querySelectorAll('g.paste-preview-layer line')].map(line => {
      const x1 = Number(line.getAttribute('x1'));
      const y1 = Number(line.getAttribute('y1'));
      const x2 = Number(line.getAttribute('x2'));
      const y2 = Number(line.getAttribute('y2'));
      return Math.hypot(x2 - x1, y2 - y1);
    });
    return Math.max(0, ...lengths);
  });
  expect(longestPreviewBond).toBeGreaterThan(20);
});

test('copying and pasting within the visible 2D plot preserves the viewport', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await ensure2dMode(page);
  await page.locator('#plot').hover();
  for (let index = 0; index < 6; index++) {
    await page.mouse.wheel(0, 700);
  }
  await page.waitForTimeout(100);
  await expect.poll(async () => await rootTransform(page)).not.toBe('translate(0,0) scale(1)');

  await page.locator('#select-mode-btn').click();
  const copyFocusPoint = await blankSvgPoint(page);
  await page.mouse.click(copyFocusPoint.x, copyFocusPoint.y);
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');

  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  const pasteX = plotBox.x + plotBox.width / 2;
  const pasteY = plotBox.y + plotBox.height / 2;
  await page.mouse.move(pasteX, pasteY);
  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  const beforePasteTransform = await rootTransform(page);
  const beforeAtomPoint = await atomScreenPoint2d(page, 'C1');
  expect(beforeAtomPoint).toBeTruthy();
  await page.mouse.click(pasteX, pasteY);
  await page.waitForTimeout(100);

  await expect(page.locator('g.paste-preview-layer')).toHaveCount(0);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePasteTransform);
  const afterAtomPoint = await atomScreenPoint2d(page, 'C1');
  expect(afterAtomPoint).toBeTruthy();
  expect(afterAtomPoint.cx).toBeCloseTo(beforeAtomPoint.cx, 1);
  expect(afterAtomPoint.cy).toBeCloseTo(beforeAtomPoint.cy, 1);
  await expect.poll(async () => await plotGeometryWithinPlot(page, 2)).toBe(true);
});

test('copying in 2D and pasting in force mode preserves preview bond geometry', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await ensure2dMode(page);
  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  const blankPoint = await blankSvgPoint(page);
  await page.mouse.click(blankPoint.x, blankPoint.y);
  await page.keyboard.press('Control+C');

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.keyboard.press('Control+V');

  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  const longestPreviewBond = await page.evaluate(() => {
    const lengths = [...document.querySelectorAll('g.paste-preview-layer line')].map(line => {
      const x1 = Number(line.getAttribute('x1'));
      const y1 = Number(line.getAttribute('y1'));
      const x2 = Number(line.getAttribute('x2'));
      const y2 = Number(line.getAttribute('y2'));
      return Math.hypot(x2 - x1, y2 - y1);
    });
    return Math.max(0, ...lengths);
  });
  expect(longestPreviewBond).toBeCloseTo(FORCE_LAYOUT_BOND_LENGTH, 1);
});

test('copying and pasting within the visible force plot preserves the viewport', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.locator('#plot').hover();
  for (let index = 0; index < 4; index++) {
    await page.mouse.wheel(0, 700);
  }
  await page.waitForTimeout(100);
  await expect.poll(async () => await rootTransform(page)).not.toBe('translate(0,0) scale(1)');

  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');

  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  const pasteX = plotBox.x + plotBox.width / 2;
  const pasteY = plotBox.y + plotBox.height / 2;
  await page.mouse.move(pasteX, pasteY);
  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  const beforePasteTransform = await rootTransform(page);
  const beforeAtomPoint = (await forceAtomScreenPoints(page)).find(atom => atom.id === 'C1');
  expect(beforeAtomPoint).toBeTruthy();
  await page.mouse.click(pasteX, pasteY);
  await page.waitForTimeout(100);

  await expect(page.locator('g.paste-preview-layer')).toHaveCount(0);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePasteTransform);
  const afterAtomPoint = (await forceAtomScreenPoints(page)).find(atom => atom.id === 'C1');
  expect(afterAtomPoint).toBeTruthy();
  expect(afterAtomPoint.cx).toBeCloseTo(beforeAtomPoint.cx, 1);
  expect(afterAtomPoint.cy).toBeCloseTo(beforeAtomPoint.cy, 1);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('copying a selected 2D fragment and pasting in force mode previews generated hydrogens', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC');
  await ensure2dMode(page);
  await page.locator('#select-mode-btn').click();
  await page.locator('g[data-atom-id="C1"] .atom-hit').click();
  await page.keyboard.press('Control+C');

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.keyboard.press('Control+V');

  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  await expect(page.locator('g.paste-preview-layer circle.node')).toHaveCount(5);
  await expect(page.locator('g.paste-preview-layer line.link')).toHaveCount(4);
  const previewRadii = await page.evaluate(() => [...document.querySelectorAll('g.paste-preview-layer circle.node')].map(circle => Number(circle.getAttribute('r'))));
  expect(previewRadii.filter(radius => radius < 6)).toHaveLength(4);
  expect(Math.max(...previewRadii)).toBeLessThan(9);
});

test('active paste preview cancels when a UI button is pressed', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');
  await expect(page.locator('g.paste-preview-layer .atom-label')).not.toHaveCount(0);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('g.paste-preview-layer')).toHaveCount(0);
  await expect(page.locator('g[data-atom-id="O4"] .atom-hit')).toHaveCount(0);
});

test('copying and pasting in force mode places a duplicate near the pointer', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const beforeCount = await page.locator('circle.node').count();

  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  await page.mouse.click(plotBox.x + plotBox.width / 2, plotBox.y + plotBox.height / 2);
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');
  await expect(page.locator('g.paste-preview-layer')).toHaveCount(1);
  await expect(page.locator('g.paste-preview-layer circle.node')).not.toHaveCount(0);
  await expect(page.locator('g.paste-preview-layer line[stroke-dasharray="5,4"]')).toHaveCount(0);
  const longestPreviewBond = await page.evaluate(() => {
    const lengths = [...document.querySelectorAll('g.paste-preview-layer line')].map(line => {
      const x1 = Number(line.getAttribute('x1'));
      const y1 = Number(line.getAttribute('y1'));
      const x2 = Number(line.getAttribute('x2'));
      const y2 = Number(line.getAttribute('y2'));
      return Math.hypot(x2 - x1, y2 - y1);
    });
    return Math.max(0, ...lengths);
  });
  expect(longestPreviewBond).toBeGreaterThan(5);

  const pasteX = plotBox.x + plotBox.width - 8;
  const pasteY = plotBox.y + plotBox.height - 8;
  await page.mouse.move(pasteX, pasteY);
  await page.mouse.click(pasteX, pasteY);

  await expect(page.locator('g.paste-preview-layer')).toHaveCount(0);
  await expect.poll(async () => await page.locator('circle.node').count()).toBeGreaterThan(beforeCount);
  await expect(page.locator('g.force-selection-layer circle')).not.toHaveCount(0);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);

  await page.locator('#undo-btn').click();
  await expect.poll(async () => await page.locator('circle.node').count()).toBe(beforeCount);
});

test('cleaning a drawn 2d branch restores strict trigonal angles', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCC');
  await page.locator('#draw-bond-btn').click();

  const middleCarbon = page.locator('g[data-atom-id="C2"] .atom-hit');
  const box = await middleCarbon.boundingBox();
  if (!box) {
    throw new Error('Expected a drawable atom hit target for C2');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 48, startY - 36, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('#smiles-input')).toHaveValue('CC(C)C');

  await page.locator('#clean-2d-btn').click();

  const centerAngles = await page.evaluate(() => {
    const centers = [...document.querySelectorAll('g[data-atom-id] .atom-hit')].map(el => {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    });
    if (centers.length < 4) {
      return null;
    }

    let bestAngles = null;
    let bestScore = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const center = centers[i];
      const neighbors = centers
        .filter((_, idx) => idx !== i)
        .map(point => ({
          ...point,
          dist: Math.hypot(point.x - center.x, point.y - center.y)
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3);
      if (neighbors.length !== 3) {
        continue;
      }

      const angles = [];
      for (let j = 0; j < neighbors.length; j++) {
        for (let k = j + 1; k < neighbors.length; k++) {
          const a = neighbors[j];
          const b = neighbors[k];
          const v1x = a.x - center.x;
          const v1y = a.y - center.y;
          const v2x = b.x - center.x;
          const v2y = b.y - center.y;
          const dot = v1x * v2x + v1y * v2y;
          const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
          angles.push(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * (180 / Math.PI));
        }
      }

      const score = Math.max(...angles.map(angle => Math.abs(angle - 120)));
      if (score < bestScore) {
        bestScore = score;
        bestAngles = angles;
      }
    }

    return bestAngles;
  });

  expect(centerAngles).toBeTruthy();
  for (const angle of centerAngles) {
    expect(Math.abs(angle - 120)).toBeLessThan(5);
  }
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

test('promoting a reactant bond from reaction preview clears the stale bond highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  const reactantBondPoint = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('g[data-bond-id]'))
      .filter(group => !(group.getAttribute('data-bond-id') ?? '').startsWith('__rxn_product__:'))
      .map(group => {
        const hit = group.querySelector('line.bond-hit');
        const rect = hit?.getBoundingClientRect?.();
        return rect
          ? {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    return candidates[0] ?? null;
  });
  expect(reactantBondPoint).toBeTruthy();

  await page.mouse.click(reactantBondPoint.x, reactantBondPoint.y);

  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
});

test('blocked erase drag in reaction preview clears stale bond highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  await page.locator('#erase-btn').click();
  await expect(page.locator('#erase-btn')).toHaveClass(/active/);

  const reactantBondPoint = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('g[data-bond-id]'))
      .filter(group => !(group.getAttribute('data-bond-id') ?? '').startsWith('__rxn_product__:'))
      .map(group => {
        const hit = group.querySelector('line.bond-hit');
        const rect = hit?.getBoundingClientRect?.();
        return rect
          ? {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    return candidates[0] ?? null;
  });
  expect(reactantBondPoint).toBeTruthy();

  await page.mouse.move(reactantBondPoint.x - 30, reactantBondPoint.y);
  await page.mouse.down();
  await page.mouse.move(reactantBondPoint.x, reactantBondPoint.y, { steps: 4 });
  await page.mouse.move(reactantBondPoint.x + 80, reactantBondPoint.y + 80, { steps: 8 });
  await page.mouse.up();

  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  await expect(page.locator('#erase-btn')).toHaveText('🗑️');
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
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

test('undo and redo preserve the active SMARTS tab', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=CC=CC=C1');
  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.getByRole('button', { name: 'Other' })).toHaveClass(/active/);

  await loadSmiles(page, 'CCO');
  await page.locator('#undo-btn').click();

  await expect(page.getByRole('button', { name: 'Other' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Functional Groups' })).not.toHaveClass(/active/);

  await page.getByRole('button', { name: 'Reactions' }).click();
  await page.locator('#redo-btn').click();
  await expect(page.getByRole('button', { name: 'Reactions' })).toHaveClass(/active/);
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

test('force selection mode highlights a hovered hydrogen atom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  const hydrogenTarget = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    return circles
      .map(circle => {
        const rect = circle.getBoundingClientRect();
        return {
          label: circle.__data__?.name ?? '',
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2
        };
      })
      .find(atom => atom.label === 'H');
  });
  expect(hydrogenTarget).toBeTruthy();

  await page.mouse.move(hydrogenTarget.cx, hydrogenTarget.cy);
  await expect(page.locator('g.force-selection-layer circle')).not.toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(target => {
        return Array.from(document.querySelectorAll('g.force-selection-layer circle')).some(circle => {
          const rect = circle.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          return Math.hypot(cx - target.cx, cy - target.cy) < 3;
        });
      }, hydrogenTarget)
    )
    .toBe(true);
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

test('clean in force mode re-idealizes a dragged force layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(9);

  const beforeDrag = await forceAtomScreenPoints(page);
  const carbonSource = [...beforeDrag].filter(atom => atom.label === 'C').sort((a, b) => a.cx - b.cx)[0] ?? null;
  expect(carbonSource).toBeTruthy();

  await page.mouse.move(carbonSource.cx, carbonSource.cy);
  await page.mouse.down();
  await page.mouse.move(carbonSource.cx + 120, carbonSource.cy + 30, { steps: 10 });
  await page.mouse.up();

  const afterDrag = await forceAtomScreenPoints(page);
  const dragShift = Math.max(...afterDrag.map((atom, index) => Math.hypot(atom.cx - beforeDrag[index].cx, atom.cy - beforeDrag[index].cy)));
  expect(dragShift).toBeGreaterThan(40);

  await page.locator('#clean-force-btn').click();

  await expect
    .poll(async () => {
      const afterClean = await forceAtomScreenPoints(page);
      return Math.max(...afterClean.map((atom, index) => Math.hypot(atom.cx - afterDrag[index].cx, atom.cy - afterDrag[index].cy)));
    })
    .toBeGreaterThan(20);
});

test('clean in force mode preserves the current handedness of a dragged acyclic layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(9);

  const beforeDrag = await forceAtomScreenPoints(page);
  const oxygen = beforeDrag.find(atom => atom.id === 'O3');
  expect(oxygen).toBeTruthy();

  await page.mouse.move(oxygen.cx, oxygen.cy);
  await page.mouse.down();
  await page.mouse.move(oxygen.cx, oxygen.cy + 90, { steps: 10 });
  await page.mouse.up();

  const afterDrag = await forceAtomScreenPoints(page);
  const dragArea = signedTriangleArea(afterDrag, 'C1', 'C2', 'O3');
  expect(Math.abs(dragArea)).toBeGreaterThan(100);

  await page.locator('#clean-force-btn').click();

  await expect
    .poll(async () => {
      const afterClean = await forceAtomScreenPoints(page);
      return Math.sign(signedTriangleArea(afterClean, 'C1', 'C2', 'O3'));
    })
    .toBe(Math.sign(dragArea));
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

test('cleaning a 2d carboxylic-acid deprotonation preview preserves the displayed product layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'O=C(O)C1=C2C=CCC2C=C1');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const deprotonationRow = page.locator('#reaction-body tr').filter({ hasText: 'Carboxylic Acid Deprotonation' }).first();

  await expect(deprotonationRow).toBeVisible();
  await deprotonationRow.click();
  await expect(deprotonationRow).toHaveClass(/reaction-active/);

  const beforeSignature = await bondSignature(page);
  const beforeTexts = await page.evaluate(() => [...document.querySelectorAll('#plot text')].map(el => el.textContent));

  await page.locator('#clean-2d-btn').click();
  await expect(deprotonationRow).toHaveClass(/reaction-active/);

  const afterSignature = await bondSignature(page);
  const afterTexts = await page.evaluate(() => [...document.querySelectorAll('#plot text')].map(el => el.textContent));

  expect(afterSignature).toEqual(beforeSignature);
  expect(afterTexts).toEqual(beforeTexts);
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
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  await loadSmiles(page, 'CCO');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
});

test('exiting reaction preview restores a manually zoomed 2d transform', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

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

test('exiting force reaction preview refits the source molecule', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const manualTransform = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await expect(dehydrationRow).toBeVisible();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(manualTransform);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(manualTransform);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('promoting a reactant bond from force reaction preview refits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  const reactantBondPoint = await page.evaluate(() => {
    const bonds = Array.from(document.querySelectorAll('line.bond-hover-target'))
      .map(line => {
        const id = String(line.__data__?.id ?? line.getAttribute('data-bond-id') ?? '');
        const rect = line.getBoundingClientRect();
        return id && !id.startsWith('__rxn_product__:')
          ? {
              id,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    return bonds[0] ?? null;
  });
  expect(reactantBondPoint).toBeTruthy();
  await page.mouse.click(reactantBondPoint.x, reactantBondPoint.y);

  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);
  await expect.poll(async () => rootTransform(page)).not.toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('changing a reactant atom charge from force reaction preview refits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const reactantOxygen = (await forceAtomScreenPoints(page)).find(atom => atom.id === 'O3');
  expect(reactantOxygen).toBeTruthy();
  await page.locator('#charge-positive-btn').click();
  await page.mouse.click(reactantOxygen.cx, reactantOxygen.cy);

  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);
  await expect.poll(async () => rootTransform(page)).not.toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('replacing a reactant atom from force reaction preview clears the stale atom highlight', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const reactantOxygen = (await forceAtomScreenPoints(page)).find(atom => atom.id === 'O3');
  expect(reactantOxygen).toBeTruthy();
  await page.locator('#draw-bond-btn').click();
  await page.mouse.click(reactantOxygen.cx, reactantOxygen.cy);
  await page.mouse.move(reactantOxygen.cx + 180, reactantOxygen.cy + 120);

  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
});

test('placing a ring on a reactant atom from force reaction preview refits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const reactantCarbon = (await forceAtomScreenPoints(page)).find(atom => atom.id === 'C1');
  expect(reactantCarbon).toBeTruthy();
  await page.locator('#ring-template-btn').click();
  await page.mouse.click(reactantCarbon.cx, reactantCarbon.cy);

  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);
  await expect.poll(async () => rootTransform(page)).not.toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('placing a ring on blank space from force reaction preview refits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');
  await waitForAppReady(page);

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#ring-template-btn').click();
  const point = await blankSvgPoint(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('g.ring-template-preview-layer')).toHaveCount(1);
  await page.mouse.down();
  await page.mouse.up();

  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);
  await expect.poll(async () => rootTransform(page)).not.toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('resizing the window in force layout keeps the molecule in view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCCCCCCCCCCCCCCCCCCC');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect.poll(async () => await forceNodesWithinPlot(page, 2)).toBe(true);

  await page.setViewportSize({ width: 560, height: 520 });

  await expect.poll(async () => await forceNodesWithinPlot(page, 2)).toBe(true);
});

test('resizing the window in 2d reaction preview keeps the preview active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const beforeResize = await rootTransform(page);

  await page.setViewportSize({ width: 560, height: 520 });

  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforeResize);
  await expect.poll(async () => await plotGeometryWithinPlot(page, 2)).toBe(true);
  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(1);
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

test('undo after exiting reaction preview restores the visible preview', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  const sourceBondCount = await page.locator('line.bond-hit').count();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();
  expect(previewBondCount).toBeGreaterThan(sourceBondCount);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(sourceBondCount);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
});

test('compact reaction arrows fit long reagent labels inside the clip path', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC#N');
  await page.locator('#options-btn').click();
  await page.locator('#options-layout-bond-length').fill('0.5');
  await page.locator('#options-reaction-font-size').fill('16');
  await page.locator('#options-apply-btn').click();

  await page.getByRole('button', { name: 'Reactions' }).click();
  const nitrileRow = page.locator('#reaction-body tr').filter({ hasText: 'Nitrile Hydrogenation To Imine' }).first();
  await expect(nitrileRow).toBeVisible();
  await nitrileRow.click();
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  const labelFit = await page.evaluate(() => {
    const arrow = document.querySelector('g.reaction-preview-arrow');
    const text = arrow?.querySelector('text.reaction-arrow-reagents');
    const clipRect = arrow?.querySelector('clipPath rect');
    if (!text || !clipRect) {
      return null;
    }
    const textBox = text.getBBox();
    const clipX = Number(clipRect.getAttribute('x'));
    const clipWidth = Number(clipRect.getAttribute('width'));
    return {
      text: text.textContent,
      leftMargin: textBox.x - clipX,
      rightMargin: clipX + clipWidth - (textBox.x + textBox.width)
    };
  });

  expect(labelFit?.text).toBe('DIBAL-H, low temperature');
  expect(labelFit?.leftMargin).toBeGreaterThanOrEqual(0);
  expect(labelFit?.rightMargin).toBeGreaterThanOrEqual(0);
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

test('reaction preview functional groups apply to the full preview molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Functional Groups' }).click();
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Carbonyl' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const oxidationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Oxidation' }).first();
  await oxidationRow.click();
  await expect(oxidationRow).toHaveClass(/reaction-active/);

  await page.getByRole('button', { name: 'Functional Groups' }).click();
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Alcohol' })).toHaveCount(1);
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Carbonyl' })).toHaveCount(1);
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Aldehyde' })).toHaveCount(1);
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
  await waitForAppReady(page);

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

test('clean in force mode preserves the aromatic-aza-protonation product on the right side of the reaction preview', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'N1C=NC2=C1N=CN2[C@H]3C[C@H](O)[C@@H](CO)O3');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const protonationRow = page.locator('#reaction-body tr').filter({ hasText: 'Aromatic Aza Protonation' }).first();
  await expect(protonationRow).toBeVisible();
  await protonationRow.click();
  await expect(protonationRow).toHaveClass(/reaction-active/);

  const beforeDelta = await forceReactionPreviewHorizontalDelta(page);
  expect(beforeDelta).toBeGreaterThan(20);

  await page.locator('#clean-force-btn').click();
  await expect(protonationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => forceReactionPreviewHorizontalDelta(page)).toBeGreaterThan(20);
});

test('force-mode benzylic oxidation seeds the new product oxygen beside the product carbonyl', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'Cc1cc(ccc1c2ccc(F)cc2F)C(O)CCCCCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const oxidationRow = page.locator('#reaction-body tr').filter({ hasText: 'Benzylic Oxidation' }).first();
  await expect(oxidationRow).toBeVisible();
  await oxidationRow.click();
  await expect(oxidationRow).toHaveClass(/reaction-active/);

  const productOxoDistance = async () =>
    await page.evaluate(() => {
      for (const line of document.querySelectorAll('line.link')) {
        const link = line.__data__;
        const source = typeof link?.source === 'object' ? link.source : null;
        const target = typeof link?.target === 'object' ? link.target : null;
        if (!source || !target || link.order !== 2) {
          continue;
        }
        if (!source.id?.startsWith('__rxn_product__') || !target.id?.startsWith('__rxn_product__')) {
          continue;
        }
        const isCarbonyl = (source.name === 'C' && target.name === 'O') || (source.name === 'O' && target.name === 'C');
        if (!isCarbonyl) {
          continue;
        }
        return Math.hypot(target.x - source.x, target.y - source.y);
      }
      return null;
    });

  await expect.poll(productOxoDistance).toBeLessThan(90);
});

test('force-mode reaction preview rotation keeps the reaction arrow visible', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'O=C(O)C1=C2C=CCC2C=C1');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const hydrogenationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alkene Hydrogenation' }).first();
  await expect(hydrogenationRow).toBeVisible();
  await hydrogenationRow.click();
  await expect(hydrogenationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  const rotateButton = page.locator('#force-rotate-cw');
  const box = await rotateButton.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  let minArrowCount = Infinity;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(80);
    minArrowCount = Math.min(minArrowCount, await page.locator('g.reaction-preview-arrow').count());
  }
  await page.mouse.up();

  expect(minArrowCount).toBe(1);
});

test('undoing a force-mode molecule change still allows switching back to a visible 2d structure', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await ensure2dMode(page);
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
  const beforeRotateTransform = await rootTransform(page);
  await page.locator('#rotate-cw').click();
  const afterRotate = await bondSignature(page);
  const afterRotateTransform = await rootTransform(page);
  await expect(afterRotate).not.toEqual(beforeRotate);
  await expect(afterRotateTransform).not.toBe(beforeRotateTransform);

  await page.locator('#undo-btn').click();
  const afterUndo = await bondSignature(page);
  await expect(afterUndo).toEqual(beforeRotate);
  await expect.poll(async () => rootTransform(page)).toBe(beforeRotateTransform);
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#redo-btn').click();
  const afterRedo = await bondSignature(page);
  await expect(afterRedo).toEqual(afterRotate);
  await expect.poll(async () => rootTransform(page)).toBe(afterRotateTransform);
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
});

test('force reaction preview redo restores the rotated preview layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  const beforeRotate = await forceNodeLayoutSignature(page);
  const beforeRotateRendered = await forceRenderedNodeLayoutSignature(page);
  const beforeRotateTransform = await rootTransform(page);
  await page.locator('#force-rotate-cw').click();
  const afterRotate = await forceNodeLayoutSignature(page);
  const afterRotateRendered = await forceRenderedNodeLayoutSignature(page);
  const afterRotateTransform = await rootTransform(page);
  expect(forceNodeLayoutsClose(afterRotate, beforeRotate)).toBe(false);
  expect(forceNodeLayoutsClose(afterRotateRendered, beforeRotateRendered, 1)).toBe(false);
  await expect(afterRotateTransform).not.toBe(beforeRotateTransform);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).toBe(beforeRotateTransform);
  expect(forceNodeLayoutsClose(await forceNodeLayoutSignature(page), beforeRotate)).toBe(true);

  await page.locator('#redo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).toBe(afterRotateTransform);
  expect(forceNodeLayoutsClose(await forceNodeLayoutSignature(page), afterRotate)).toBe(true);
  await expect.poll(async () => forceNodeLayoutsClose(await forceRenderedNodeLayoutSignature(page), beforeRotateRendered, 1)).toBe(false);
});

test('force resonance redo restores the rotated pair layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  const beforeRotate = await forceNodeLayoutSignature(page);
  const beforeRotateRendered = await forceRenderedNodeLayoutSignature(page);
  const beforeRotateTransform = await rootTransform(page);
  await page.locator('#force-rotate-cw').click();
  const afterRotate = await forceNodeLayoutSignature(page);
  const afterRotateRendered = await forceRenderedNodeLayoutSignature(page);
  const afterRotateTransform = await rootTransform(page);
  expect(forceNodeLayoutsClose(afterRotate, beforeRotate)).toBe(false);
  expect(forceNodeLayoutsClose(afterRotateRendered, beforeRotateRendered, 1)).toBe(false);
  await expect(afterRotateTransform).not.toBe(beforeRotateTransform);

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect.poll(async () => rootTransform(page)).toBe(beforeRotateTransform);
  expect(forceNodeLayoutsClose(await forceNodeLayoutSignature(page), beforeRotate)).toBe(true);

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect.poll(async () => rootTransform(page)).toBe(afterRotateTransform);
  expect(forceNodeLayoutsClose(await forceNodeLayoutSignature(page), afterRotate)).toBe(true);
  await expect.poll(async () => forceNodeLayoutsClose(await forceRenderedNodeLayoutSignature(page), beforeRotateRendered, 1)).toBe(false);
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
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect.poll(async () => await page.locator('.atom-charge-text').count()).toBeGreaterThan(0);
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

test('initial 2D render keeps the C[C@H](F)Cl stereo glyph on the visible heavy bond', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C[C@H](F)Cl');

  await expect(page.locator('g[data-atom-id="H3"] .atom-hit')).toHaveCount(0);
  await expect.poll(() => page.locator('g[data-bond-id="0"] .bond-wedge, g[data-bond-id="0"] .bond-hash').count()).toBeGreaterThan(0);
  await expect(page.locator('g[data-bond-id="3"] .bond-wedge, g[data-bond-id="3"] .bond-hash')).toHaveCount(0);
});

test('switching C[C@H](F)Cl from 2D to force preserves the displayed stereo bond', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C[C@H](F)Cl');
  await expect.poll(() => page.locator('g[data-bond-id="0"] .bond-wedge, g[data-bond-id="0"] .bond-hash').count()).toBeGreaterThan(0);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  const forceStereo = await forceStereoOverlayCounts(page);
  expect(forceStereo.bondIds).toContain('0');
  expect(forceStereo.bondIds).not.toContain('3');
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
  const dragPair = await page.evaluate(() => {
    const snapRadius = 30;
    const atoms = Array.from(document.querySelectorAll('circle.node')).map(circle => {
      const rect = circle.getBoundingClientRect();
      const datum = circle.__data__ ?? {};
      return {
        id: datum.id ?? null,
        label: datum.name ?? '',
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
    const reactantAtoms = atoms.filter(atom => typeof atom.id === 'string' && !atom.id.startsWith('__rxn_product__'));
    const heavyReactants = reactantAtoms.filter(atom => atom.label !== 'H');
    const reactantCarbons = heavyReactants.filter(atom => atom.label === 'C').sort((a, b) => a.cx - b.cx);

    for (const carbon of reactantCarbons) {
      const safeHydrogens = reactantAtoms
        .filter(atom => atom.label === 'H')
        .map(atom => {
          const competingHeavyDistances = heavyReactants.filter(other => other.id !== carbon.id).map(other => Math.hypot(atom.cx - other.cx, atom.cy - other.cy));
          return {
            ...atom,
            competingHeavyDistance: competingHeavyDistances.length ? Math.min(...competingHeavyDistances) : Infinity
          };
        })
        .filter(atom => atom.competingHeavyDistance > snapRadius + 1)
        .sort((a, b) => b.competingHeavyDistance - a.competingHeavyDistance);
      if (safeHydrogens.length > 0) {
        return {
          carbonSource: carbon,
          hydrogenTarget: safeHydrogens[0]
        };
      }
    }

    return null;
  });
  expect(dragPair).toBeTruthy();
  const { carbonSource, hydrogenTarget } = dragPair;

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

test('undo and redo stay coherent when switching between reaction preview and resonance view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();

  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.locator('#resonance-body tr')).toHaveCount(1);
  const resonanceRow = page.locator('#resonance-body tr').first();
  await expect(resonanceRow).toContainText('Resonance Structures');
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(reductionRow).not.toHaveClass(/reaction-active/);
  await expect(resonanceRow).toHaveClass(/resonance-active/);

  await page.locator('#undo-btn').click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);

  await page.locator('#redo-btn').click();
  await expect(reductionRow).not.toHaveClass(/reaction-active/);
  await expect(resonanceRow).toHaveClass(/resonance-active/);
});

test('switching SMARTS tabs preserves the active resonance view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  const sourceBondCount = await page.locator('line.bond-hit').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  const resonanceBondCount = await page.locator('line.bond-hit').count();
  expect(resonanceBondCount).toBeGreaterThan(sourceBondCount);

  await page.getByRole('button', { name: 'Functional Groups' }).click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(resonanceBondCount);

  await page.getByRole('button', { name: 'Reactions' }).click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(resonanceBondCount);
});

test('entering and exiting resonance mode participate in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);

  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.getByRole('button', { name: 'Other' }).click();
  await resonanceRow.click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
});

test('undo after exiting force resonance restores the active resonance pair', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const sourceNodeCount = await page.locator('circle.node').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);

  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  await expect.poll(async () => await page.locator('circle.node').count()).toBeGreaterThan(sourceNodeCount);
  const resonanceNodeCount = await page.locator('circle.node').count();

  await resonanceRow.click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect.poll(async () => await page.locator('circle.node').count()).toBe(sourceNodeCount);

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  await expect(page.locator('circle.node')).toHaveCount(resonanceNodeCount);
});

test('editing from force resonance mode refits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  const resonanceTransform = await rootTransform(page);

  await page.locator('#draw-bond-btn').click();
  const sourceCarbon = await forceResonanceAtomScreenPoint(page, { productSide: false, label: 'C', horizontal: 'left' });
  expect(sourceCarbon).toBeTruthy();
  const sourceIdsBeforeEdit = await page.evaluate(() =>
    Array.from(document.querySelectorAll('circle.node'))
      .map(circle => String(circle.__data__?.id ?? ''))
      .filter(id => id && !id.startsWith('__resonance_product__:'))
  );
  await page.mouse.move(sourceCarbon.cx, sourceCarbon.cy);
  await page.mouse.down();
  await page.mouse.move(sourceCarbon.cx - 70, sourceCarbon.cy - 35, { steps: 8 });
  await page.mouse.up();

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect.poll(async () => rootTransform(page)).not.toBe(resonanceTransform);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
  const newAtomVector = await page.evaluate(
    ({ sourceId, beforeIds }) => {
      const before = new Set(beforeIds);
      const nodes = Array.from(document.querySelectorAll('circle.node')).map(circle => {
        const datum = circle.__data__ ?? {};
        return {
          id: String(datum.id ?? ''),
          label: datum.name ?? '',
          x: Number(datum.x ?? NaN),
          y: Number(datum.y ?? NaN)
        };
      });
      const source = nodes.find(node => node.id === sourceId);
      const newAtom = nodes.find(node => node.label === 'C' && !before.has(node.id));
      return source && newAtom
        ? {
            dx: newAtom.x - source.x,
            dy: newAtom.y - source.y,
            distance: Math.hypot(newAtom.x - source.x, newAtom.y - source.y)
          }
        : null;
    },
    { sourceId: sourceCarbon.id, beforeIds: sourceIdsBeforeEdit }
  );
  expect(newAtomVector).toBeTruthy();
  expect(newAtomVector.dx).toBeLessThan(0);
  expect(newAtomVector.dy).toBeLessThan(0);
  expect(newAtomVector.distance).toBeGreaterThan(20);
  expect(newAtomVector.distance).toBeLessThan(120);
});

test('changing an atom from force resonance mode clears the stale atom highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.locator('#draw-bond-btn').click();
  const sourceOxygen = await forceResonanceAtomScreenPoint(page, { productSide: false, label: 'O', horizontal: 'right' });
  expect(sourceOxygen).toBeTruthy();
  await page.mouse.click(sourceOxygen.cx, sourceOxygen.cy);
  await page.mouse.move(sourceOxygen.cx + 180, sourceOxygen.cy + 120);

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
});

test('replacing a hydrogen from force resonance mode keeps the new atom on the clicked side', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  const hydrogenTarget = await page.evaluate(() => {
    const productPrefix = '__resonance_product__:';
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const links = Array.from(document.querySelectorAll('line.bond-hover-target')).map(line => line.__data__).filter(Boolean);
    for (const circle of circles) {
      const node = circle.__data__;
      if (!node || node.name !== 'H' || String(node.id ?? '').startsWith(productPrefix)) {
        continue;
      }
      const link = links.find(candidate => candidate.source?.id === node.id || candidate.target?.id === node.id);
      const parent = link?.source?.id === node.id ? link.target : link?.target?.id === node.id ? link.source : null;
      if (!parent || parent.name === 'H') {
        continue;
      }
      const rect = circle.getBoundingClientRect();
      return {
        id: String(node.id),
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        hx: node.x,
        hy: node.y,
        px: parent.x,
        py: parent.y
      };
    }
    return null;
  });
  expect(hydrogenTarget).toBeTruthy();

  await page.locator('#draw-bond-btn').click();
  await page.mouse.click(hydrogenTarget.cx, hydrogenTarget.cy);

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  const newAtomVector = await page.evaluate(target => {
    const node = Array.from(document.querySelectorAll('circle.node'))
      .map(circle => circle.__data__)
      .find(candidate => String(candidate?.id ?? '') === target.id);
    if (!node) {
      return null;
    }
    const beforeDx = target.hx - target.px;
    const beforeDy = target.hy - target.py;
    const afterDx = node.x - target.px;
    const afterDy = node.y - target.py;
    return {
      label: node.name,
      dot: beforeDx * afterDx + beforeDy * afterDy,
      distance: Math.hypot(afterDx, afterDy)
    };
  }, hydrogenTarget);

  expect(newAtomVector).toBeTruthy();
  expect(newAtomVector.label).toBe('C');
  expect(newAtomVector.dot).toBeGreaterThan(0);
  expect(newAtomVector.distance).toBeGreaterThan(20);
  expect(newAtomVector.distance).toBeLessThan(90);
});

test('changing a charge from force resonance mode refits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const sourceNodeCount = await page.locator('circle.node').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  await expect.poll(async () => await page.locator('circle.node').count()).toBeGreaterThan(sourceNodeCount);
  const resonanceNodeCount = await page.locator('circle.node').count();
  const resonanceTransform = await rootTransform(page);

  const sourceCarbon = await forceResonanceAtomScreenPoint(page, { productSide: false, label: 'C', horizontal: 'left' });
  expect(sourceCarbon).toBeTruthy();
  await page.locator('#charge-positive-btn').click();
  await page.mouse.click(sourceCarbon.cx, sourceCarbon.cy);

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect.poll(async () => await page.locator('circle.node').count()).toBeLessThan(resonanceNodeCount);
  await expect
    .poll(async () =>
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('circle.node')).every(circle => !String(circle.__data__?.id ?? '').startsWith('__resonance_product__:'))
      )
    )
    .toBe(true);
  await expect.poll(async () => rootTransform(page)).not.toBe(resonanceTransform);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('placing a ring from force resonance mode refits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const sourceNodeCount = await page.locator('circle.node').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  await expect.poll(async () => await page.locator('circle.node').count()).toBeGreaterThan(sourceNodeCount);
  const resonanceTransform = await rootTransform(page);

  const sourceCarbon = await forceResonanceAtomScreenPoint(page, { productSide: false, label: 'C', horizontal: 'left' });
  expect(sourceCarbon).toBeTruthy();
  await page.locator('#ring-template-btn').click();
  await page.mouse.click(sourceCarbon.cx, sourceCarbon.cy);

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect.poll(async () => await page.locator('circle.node').count()).toBeGreaterThan(sourceNodeCount);
  await expect.poll(async () => rootTransform(page)).not.toBe(resonanceTransform);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('erasing a source atom from force resonance mode refits the unlocked molecule with sane coordinates', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const sourceNodeCount = await page.locator('circle.node').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  await expect.poll(async () => await page.locator('circle.node').count()).toBeGreaterThan(sourceNodeCount);

  const sourceOxygen = await forceResonanceAtomScreenPoint(page, { productSide: false, label: 'O', horizontal: 'right' });
  expect(sourceOxygen).toBeTruthy();
  await page.locator('#erase-btn').click();
  await page.mouse.move(sourceOxygen.cx - 24, sourceOxygen.cy);
  await page.mouse.down();
  await page.mouse.move(sourceOxygen.cx, sourceOxygen.cy, { steps: 4 });
  await page.mouse.up();

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect
    .poll(async () =>
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('circle.node')).every(circle => {
          const node = circle.__data__ ?? {};
          return (
            !String(node.id ?? '').startsWith('__resonance_product__:') &&
            Number.isFinite(node.x) &&
            Number.isFinite(node.y) &&
            Math.abs(node.x) < 1000 &&
            Math.abs(node.y) < 1000
          );
        })
      )
    )
    .toBe(true);
  await expect
    .poll(async () => await page.evaluate(() => Array.from(document.querySelectorAll('circle.node')).every(circle => circle.__data__?.name !== 'O')))
    .toBe(true);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('failed force draw onto a resonance product molecule leaves resonance controls usable', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.locator('#draw-bond-btn').click();
  const sourceCarbon = await forceResonanceAtomScreenPoint(page, { productSide: false, label: 'C', horizontal: 'left' });
  const productCarbon = await forceResonanceAtomScreenPoint(page, { productSide: true, label: 'C', horizontal: 'right' });
  expect(sourceCarbon).toBeTruthy();
  expect(productCarbon).toBeTruthy();
  await page.locator('#charge-positive-btn').click();
  await page.mouse.click(productCarbon.cx, productCarbon.cy);
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.locator('#charge-negative-btn').click();
  await page.mouse.click(productCarbon.cx, productCarbon.cy, { button: 'right' });
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.locator('#draw-bond-btn').click();
  await page.mouse.move(productCarbon.cx, productCarbon.cy);
  await page.mouse.down();
  await page.mouse.up();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.mouse.move(productCarbon.cx + 48, productCarbon.cy + 48);
  await page.mouse.down();
  await page.mouse.up();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  const productBond = await forceResonanceBondScreenPoint(page, { productSide: true, horizontal: 'right' });
  expect(productBond).toBeTruthy();
  await page.mouse.move(productBond.cx, productBond.cy);
  await page.mouse.down();
  await page.mouse.up();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.mouse.move(sourceCarbon.cx, sourceCarbon.cy);
  await page.mouse.down();
  await page.mouse.move(productCarbon.cx, productCarbon.cy, { steps: 10 });
  await page.mouse.up();

  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  await page.mouse.move(sourceCarbon.cx, sourceCarbon.cy);
  await page.mouse.down();
  await page.mouse.move(productBond.cx, productBond.cy, { steps: 10 });
  await page.mouse.up();

  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);
  await resonanceRow.click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
});

test('failed line-mode bond promotion on a resonance product molecule leaves resonance controls usable', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=CC2=C3C4=C1C=CC5=C4C6=C(C=C5)C=CC7=C6C3=C(C=C2)C=C7');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');

  await page.locator('#draw-bond-btn').click();
  const productBond = await resonanceBondScreenPoint2d(page, { productSide: true, horizontal: 'right' });
  expect(productBond).toBeTruthy();
  await page.mouse.move(productBond.cx, productBond.cy);
  await page.mouse.down();
  await page.mouse.up();

  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await page.getByTitle('Next resonance pair').click();
  await expect(resonanceRow).toContainText('2→3');

  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await resonanceRow.click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
});

test('undo after exiting resonance keeps source functional groups detected', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(=O)C(Cl)CC(C(C)C)C=C');
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Carbonyl' })).toHaveCount(1);
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Ketone' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);

  await resonanceRow.click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);

  await page.locator('#undo-btn').click();
  await expect(page.getByRole('button', { name: 'Other' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Functional Groups' })).not.toHaveClass(/active/);

  await page.getByRole('button', { name: 'Functional Groups' }).click();
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Carbonyl' })).toHaveCount(1);
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Ketone' })).toHaveCount(1);
});

test('changing the displayed resonance pair participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=CC2=C3C4=C1C=CC5=C4C6=C(C=C5)C=CC7=C6C3=C(C=C2)C=C7');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);

  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');

  await page.getByTitle('Next resonance pair').click();
  await expect(resonanceRow).toContainText('2→3');

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('2→3');
});

test('flipping a 2D resonance view participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'O=C[CH-]C=O');
  await ensure2dMode(page);
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);

  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  const beforeFlip = await resonanceBondSnapshot2d(page);

  await page.locator('#flip-h').click();
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  await expect.poll(async () => JSON.stringify(await resonanceBondSnapshot2d(page))).not.toBe(JSON.stringify(beforeFlip));
  const afterFlip = await resonanceBondSnapshot2d(page);

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  await expect.poll(async () => await resonanceBondSnapshot2d(page)).toEqual(beforeFlip);

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  await expect.poll(async () => await resonanceBondSnapshot2d(page)).toEqual(afterFlip);
});

test('activating a reaction exits the active resonance view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await expect(reductionRow).toBeVisible();
  await reductionRow.click();

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);

  await reductionRow.click();
  await expect(reductionRow).not.toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(0);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
});

test('deleting a selected resonance product-side atom is a no-op', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);
  await page.locator('g[data-atom-id="__resonance_product__:O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.keyboard.press('Delete');

  expect(await page.locator('#erase-btn').textContent()).toBe('🗑️');
  await page.waitForTimeout(200);
  expect(await page.locator('#erase-btn').textContent()).toBe('🗑️');
  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);
});

test('erase-drag over a resonance product-side atom clears the temporary highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  await page.locator('#erase-btn').click();
  await expect(page.locator('#erase-btn')).toHaveClass(/active/);

  const productOxygenBox = await page.locator('g[data-atom-id="__resonance_product__:O3"] .atom-hit').boundingBox();
  expect(productOxygenBox).toBeTruthy();
  const startX = productOxygenBox.x + productOxygenBox.width / 2;
  const startY = productOxygenBox.y + productOxygenBox.height / 2;

  await page.mouse.move(startX - 40, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY, { steps: 4 });
  await page.mouse.move(startX + 120, startY + 90, { steps: 8 });
  await page.mouse.up();

  expect(await page.locator('#erase-btn').textContent()).toBe('🗑️');
  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
});

test('promoting a 2D bond from resonance mode clears hover and auto-fits the unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -700);
  const lockedTransform = await rootTransform(page);

  await page.locator('#draw-bond-btn').click();
  const sourceBondPoint = await page.evaluate(() => {
    const bonds = Array.from(document.querySelectorAll('line.bond-hit'))
      .map(line => {
        const rect = line.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })
      .sort((a, b) => a.x - b.x);
    return bonds[0] ?? null;
  });
  expect(sourceBondPoint).toBeTruthy();
  await page.mouse.click(sourceBondPoint.x, sourceBondPoint.y);
  await page.mouse.move(sourceBondPoint.x + 180, sourceBondPoint.y + 120);

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
  await expect.poll(async () => rootTransform(page)).not.toBe(lockedTransform);
});

test('dragging a carbon line from a 2D resonance oxygen keeps the new atom near the source after exit', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(1);

  const oxygenBox = await page.locator('g[data-atom-id="O3"] .atom-hit').boundingBox();
  expect(oxygenBox).toBeTruthy();
  const startX = oxygenBox.x + oxygenBox.width / 2;
  const startY = oxygenBox.y + oxygenBox.height / 2;
  await page.locator('#draw-bond-btn').click();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY - 60, { steps: 10 });
  await page.mouse.up();

  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(page.locator('g.resonance-electron-flow-layer')).toHaveCount(0);
  await expect(page.locator('g[data-atom-id="C3"] .atom-hit')).toHaveCount(1);
  await expect.poll(async () => await atomDistance(page, 'O3', 'C3')).toBeLessThan(90);
});

test('undo after editing from a locked resonance view restores the locked resonance contributor', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.locator('#resonance-body tr')).toHaveCount(1);
  const resonanceRow = page.locator('#resonance-body tr').first();
  await expect(resonanceRow).toContainText('Resonance Structures');
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');
  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
});

test('redo after editing from a locked resonance view returns to the edited unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.locator('#resonance-body tr')).toHaveCount(1);
  const resonanceRow = page.locator('#resonance-body tr').first();
  await expect(resonanceRow).toContainText('Resonance Structures');
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('1→2');

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('Compute');
  await expect(page.locator('#smiles-input')).toHaveValue('CC=Cl');
});

test('bond drawer selection updates the active option, main tool icon, and collapses the drawer', async ({ page }) => {
  await page.goto('/index.html');

  const drawButton = page.locator('#draw-bond-btn');
  const doubleButton = page.locator('#draw-bond-type-double');

  await drawButton.click();
  await expect(doubleButton).toBeVisible();

  await doubleButton.click();

  await expect(doubleButton).toHaveClass(/active/);
  await expect(drawButton).toHaveClass(/active/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mainButton = document.getElementById('draw-bond-btn');
        const selectedButton = document.getElementById('draw-bond-type-double');
        return (mainButton?.innerHTML ?? '') === (selectedButton?.innerHTML ?? '') && !(document.getElementById('draw-tools')?.classList.contains('drawer-open') ?? true);
      })
    )
    .toBe(true);
});

test('draw bond mode activates from a near-edge click on the circular tool button', async ({ page }) => {
  await page.goto('/index.html');

  const targetPoint = await page.evaluate(() => {
    const button = document.getElementById('draw-bond-btn');
    if (!button) {
      return null;
    }
    const rect = button.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + 17,
      y: rect.top + rect.height / 2
    };
  });

  expect(targetPoint).toBeTruthy();

  await page.mouse.click(targetPoint.x, targetPoint.y);

  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);
});

test('bond drawer stays open while moving from the main button into the drawer hover zone', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const drawBondButton = page.locator('#draw-bond-btn');
  const doubleBondButton = page.locator('#draw-bond-type-double');

  await drawBondButton.hover();
  await expect(doubleBondButton).toBeVisible();

  const bridgePoint = await page.evaluate(() => {
    const drawBondButtonEl = document.getElementById('draw-bond-btn');
    const drawerEl = document.getElementById('draw-bond-drawer');
    if (!drawBondButtonEl || !drawerEl) {
      return null;
    }

    const drawBondRect = drawBondButtonEl.getBoundingClientRect();
    const drawerRect = drawerEl.getBoundingClientRect();
    return {
      x: drawBondRect.right + Math.min(8, Math.max(2, drawerRect.width * 0.06)),
      y: (drawBondRect.top + drawBondRect.bottom) / 2
    };
  });

  expect(bridgePoint).toBeTruthy();

  await page.mouse.move(bridgePoint.x, bridgePoint.y);
  await expect(doubleBondButton).toBeVisible();

  await doubleBondButton.click();
  await expect(doubleBondButton).toHaveClass(/active/);
});

test('bond drawer stays open when the pointer drifts slightly outside the visible drawer', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const drawBondButton = page.locator('#draw-bond-btn');
  const wedgeBondButton = page.locator('#draw-bond-type-wedge');

  await drawBondButton.hover();
  await expect(wedgeBondButton).toBeVisible();

  const gracePoint = await page.evaluate(() => {
    const drawerEl = document.getElementById('draw-bond-drawer');
    if (!drawerEl) {
      return null;
    }

    const drawerRect = drawerEl.getBoundingClientRect();
    return {
      x: drawerRect.right + 8,
      y: drawerRect.top + drawerRect.height / 2
    };
  });

  expect(gracePoint).toBeTruthy();

  await page.mouse.move(gracePoint.x, gracePoint.y);
  await expect(wedgeBondButton).toBeVisible();

  await wedgeBondButton.hover();
  await wedgeBondButton.click();
  await expect(wedgeBondButton).toHaveClass(/active/);
});

test('clicking the active draw bond button again returns the app to pan mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const drawBondButton = page.locator('#draw-bond-btn');

  await drawBondButton.click();
  await drawBondButton.click();

  await expect(drawBondButton).not.toHaveClass(/active/);
  await expect(page.locator('#pan-mode-btn')).toHaveClass(/active/);
});

test('charge mode suppresses native contextmenu on right click in the live app', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C');

  await page.locator('#charge-positive-btn').click();
  await expect(page.locator('#charge-positive-btn')).toHaveClass(/active/);

  const atomHit = page.locator('g[data-atom-id="C1"] .atom-hit');
  await atomHit.click({ button: 'right' });

  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).toBe('[CH3-]');
  await expect
    .poll(() =>
      page.evaluate(() => ({
        bodyHandler: typeof document.body?.oncontextmenu,
        docElHandler: typeof document.documentElement?.oncontextmenu,
        docHandler: typeof document.oncontextmenu,
        windowHandler: typeof window.oncontextmenu
      }))
    )
    .toMatchObject({
      bodyHandler: 'function',
      docElHandler: 'function',
      docHandler: 'function',
      windowHandler: 'function'
    });
});

test('the molecule plot suppresses native contextmenu even outside charge mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const suppression = await page.evaluate(() => {
    const plot = document.getElementById('plot');
    if (!plot) {
      return null;
    }
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2
    });
    const dispatchResult = plot.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult
    };
  });

  expect(suppression).toEqual({
    defaultPrevented: true,
    dispatchResult: false
  });
});

test('undo preserves the selected bond draw type after undoing a bond edit', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();

  const targetBond = page.locator('line.bond-hit').nth(1);
  await targetBond.click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('line.bond-hash').length)).toBeGreaterThan(0);

  await page.locator('#undo-btn').click();

  await expect(page.locator('#draw-bond-type-dash')).toHaveClass(/active/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mainButton = document.getElementById('draw-bond-btn');
        const selectedButton = document.getElementById('draw-bond-type-dash');
        return (mainButton?.innerHTML ?? '') === (selectedButton?.innerHTML ?? '');
      })
    )
    .toBe(true);
});

test('wedge and dash bond types render as actual bond glyphs when selected', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-wedge').click();
  await page.locator('line.bond-hit').nth(1).click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('polygon.bond-wedge').length)).toBeGreaterThan(0);

  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();
  await page.locator('line.bond-hit').nth(1).click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('line.bond-hash').length)).toBeGreaterThan(0);
});

test('the live bond preview reflects the selected bond type while dragging', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-double').click();

  const oxygen = page.locator('g[data-atom-id="O3"] .atom-hit');
  const box = await oxygen.boundingBox();
  expect(box).toBeTruthy();

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY - 50, { steps: 10 });

  await expect
    .poll(() =>
      page.evaluate(() => ({
        previewGroup: document.querySelectorAll('g.draw-bond-preview').length,
        previewSegments: document.querySelectorAll('line.draw-bond-preview-segment').length
      }))
    )
    .toEqual({ previewGroup: 1, previewSegments: 2 });

  await page.mouse.up();
});

test('placing double on an existing double bond is a no-op', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC=O');
  const undoWasDisabled = await page.locator('#undo-btn').isDisabled();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-double').click();
  await clickBondHit(page, 'g[data-bond-id="0"] .bond-hit');

  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
  await expect.poll(() => page.locator('#undo-btn').isDisabled()).toBe(undoWasDisabled);
});

test('placing a double bond removes stale stereo display from centers that become non-stereogenic', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O');

  await expect.poll(async () => await page.locator('g[data-bond-id="7"] .bond-wedge, g[data-bond-id="7"] .bond-hash').count()).toBeGreaterThan(0);
  await expect.poll(async () => await page.locator('g[data-bond-id="8"] .bond-wedge, g[data-bond-id="8"] .bond-hash').count()).toBeGreaterThan(0);

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-double').click();
  await clickBondHit(page, 'g[data-bond-id="3"] .bond-hit');

  await expect(page.locator('g[data-bond-id="3"] line.bond')).toHaveCount(2);
  await expect.poll(async () => await page.locator('g[data-bond-id="7"] .bond-wedge, g[data-bond-id="7"] .bond-hash').count()).toBe(0);
  await expect.poll(async () => await page.locator('g[data-bond-id="8"] .bond-wedge, g[data-bond-id="8"] .bond-hash').count()).toBe(0);
});

test('placing triple on an existing triple bond is a no-op', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC#N');
  const undoWasDisabled = await page.locator('#undo-btn').isDisabled();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-triple').click();
  await clickBondHit(page, 'g[data-bond-id="0"] .bond-hit');

  await expect(page.locator('#smiles-input')).toHaveValue('CC#N');
  await expect.poll(() => page.locator('#undo-btn').isDisabled()).toBe(undoWasDisabled);
});

test('placing aromatic on an existing aromatic bond is a no-op', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'c1ccccc1');
  const undoWasDisabled = await page.locator('#undo-btn').isDisabled();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-aromatic').click();
  await clickBondHit(page, 'g[data-bond-id="0"] .bond-hit');

  await expect(page.locator('#smiles-input')).toHaveValue('c1ccccc1');
  await expect.poll(() => page.locator('#undo-btn').isDisabled()).toBe(undoWasDisabled);
});

test('selection drag can start in the blank strip beside the draw toolbar', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  const probe = await page.evaluate(() => {
    const drawBondButton = document.getElementById('draw-bond-btn');
    const negativeChargeButton = document.getElementById('charge-negative-btn');
    if (!drawBondButton || !negativeChargeButton) {
      return null;
    }

    const drawBondRect = drawBondButton.getBoundingClientRect();
    const negativeChargeRect = negativeChargeButton.getBoundingClientRect();
    const x = drawBondRect.left + 120;
    const y = (drawBondRect.top + negativeChargeRect.bottom) / 2;
    const target = document.elementFromPoint(x, y);

    return {
      x,
      y,
      insideButton: !!target?.closest('button'),
      insideDrawTools: !!target?.closest('#draw-tools')
    };
  });

  expect(probe).toBeTruthy();
  expect(probe.insideButton).toBeFalsy();
  expect(probe.insideDrawTools).toBeFalsy();

  await page.mouse.move(probe.x, probe.y);
  await page.mouse.down();
  await page.mouse.move(probe.x + 60, probe.y + 40, { steps: 6 });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const rect = document.querySelector('.selection-rect');
        if (!rect) {
          return false;
        }
        return getComputedStyle(rect).display !== 'none' && Number(rect.getAttribute('width') ?? 0) > 20 && Number(rect.getAttribute('height') ?? 0) > 20;
      })
    )
    .toBe(true);

  await page.mouse.up();
});

test('2D cobalt wedge tip clears the source Co label', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, '[Co+3](N)(N)(N)(N)(N)N');

  await expect.poll(() => page.evaluate(() => document.querySelectorAll('polygon.bond-wedge').length)).toBeGreaterThan(0);

  const overlapState = await page.evaluate(() => {
    const wedge = document.querySelector('polygon.bond-wedge');
    const coLabel = Array.from(document.querySelectorAll('text')).find(node => (node.textContent ?? '').trim() === 'Co');
    if (!wedge || !coLabel) {
      return null;
    }

    const tip = (wedge.getAttribute('points') ?? '').trim().split(/\s+/)[0].split(',').map(Number);
    const svg = wedge.ownerSVGElement;
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = tip[0];
    svgPoint.y = tip[1];
    const screenPoint = svgPoint.matrixTransform(wedge.getScreenCTM());
    const labelRect = coLabel.getBoundingClientRect();
    const paddedRect = {
      left: labelRect.left - 1.5,
      right: labelRect.right + 1.5,
      top: labelRect.top - 1.5,
      bottom: labelRect.bottom + 1.5
    };

    return {
      inside: screenPoint.x >= paddedRect.left && screenPoint.x <= paddedRect.right && screenPoint.y >= paddedRect.top && screenPoint.y <= paddedRect.bottom
    };
  });

  expect(overlapState).not.toBeNull();
  expect(overlapState.inside).toBeFalsy();
});

test('renders both projected cobalt wedge and dash overlays after switching from 2D to force', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, '[Co+3](N)(N)(N)(N)(N)N');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect(page.locator('circle.node')).toHaveCount(19);

  const data = await forceStereoOverlayCounts(page);
  await expect(data.wedgeCount).toBeGreaterThan(1);
  await expect(data.dashLineCount).toBeGreaterThan(0);
});

test('renders projected cobalt wedge and dash overlays when pasted while already in force mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  await page.evaluate(() => {
    const input = document.getElementById('smiles-input');
    input.focus();
    input.setSelectionRange(0, input.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', '[Co+3](N)(N)(N)(N)(N)N');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('circle.node')).toHaveCount(19);

  const data = await forceStereoOverlayCounts(page);
  await expect(data.wedgeCount).toBeGreaterThan(1);
  await expect(data.dashLineCount).toBeGreaterThan(0);
});

test('renders projected cobalt wedge and dash overlays when loaded by Enter while already in force mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await loadSmiles(page, '[Co+3](N)(N)(N)(N)(N)N');
  await expect(page.locator('circle.node')).toHaveCount(19);

  const data = await forceStereoOverlayCounts(page);
  await expect(data.wedgeCount).toBeGreaterThan(1);
  await expect(data.dashLineCount).toBeGreaterThan(0);
});

test('force mode can invert a preserved stereochemical bond between wedge and dash', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C[C@H](F)Cl');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#draw-bond-btn').click();

  const before = await forceStereoOverlayCounts(page);
  expect(before.wedgeCount + before.dashLineCount).toBeGreaterThan(0);
  const beforeSmiles = await page.evaluate(() => window._getMolSmiles?.() ?? null);
  expect(beforeSmiles).toContain('@');

  await page.locator('#draw-bond-btn').hover();
  if (before.wedgeCount > 0) {
    await page.locator('#draw-bond-type-dash').click();
  } else {
    await page.locator('#draw-bond-type-wedge').click();
  }

  expect(before.bondIds.length).toBeGreaterThan(0);
  const stereoBondBox = await forceBondTargetCenter(page, before.bondIds[0]);
  expect(stereoBondBox).toBeTruthy();
  await page.mouse.click(stereoBondBox.x, stereoBondBox.y);

  if (before.wedgeCount > 0) {
    await expect
      .poll(async () => {
        const after = await forceStereoOverlayCounts(page);
        return after.dashLineCount > 0;
      })
      .toBe(true);
  } else {
    await expect
      .poll(async () => {
        const after = await forceStereoOverlayCounts(page);
        return after.wedgeCount > 0;
      })
      .toBe(true);
  }

  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).not.toBe(beforeSmiles);
  expect(await page.evaluate(() => window._getMolSmiles?.() ?? null)).toContain('@');
});

test('force dash drags from a stereochemical hydrogen target the rendered hydrogen bond', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();

  const forceNodeCenters = async () =>
    await page.evaluate(() => {
      const centers = {};
      for (const circle of document.querySelectorAll('circle.node')) {
        const rect = circle.getBoundingClientRect();
        centers[String(circle.__data__?.id ?? '')] = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          name: circle.__data__?.name ?? ''
        };
      }
      return centers;
    });
  const hasSelectionAt = async target =>
    await page.evaluate(targetPoint => {
      return Array.from(document.querySelectorAll('g.force-selection-layer circle')).some(circle => {
        const rect = circle.getBoundingClientRect();
        return Math.hypot(rect.left + rect.width / 2 - targetPoint.x, rect.top + rect.height / 2 - targetPoint.y) < 3;
      });
    }, target);

  const points = await forceNodeCenters();
  const beforeSmiles = await page.evaluate(() => window._getMolSmiles?.() ?? null);
  expect(beforeSmiles).toContain('@');
  expect(points.H11?.name).toBe('H');
  expect(points.C10?.name).toBe('C');

  await page.mouse.move(points.H11.x, points.H11.y);
  await expect.poll(async () => await hasSelectionAt(points.H11)).toBe(true);

  await page.mouse.down();
  await page.mouse.move(points.C10.x, points.C10.y, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () =>
      page.evaluate(() => Array.from(document.querySelectorAll('g.force-stereo-bonds line')).some(line => line.getAttribute('data-bond-id') === '13'))
    )
    .toBe(true);
  expect(await page.evaluate(() => window._getMolSmiles?.() ?? null)).toContain('@');

  await page.locator('#undo-btn').click();
  const restoredPoints = await forceNodeCenters();
  expect(restoredPoints.H11?.name).toBe('H');
  await page.mouse.move(restoredPoints.H11.x, restoredPoints.H11.y);
  await expect.poll(async () => await hasSelectionAt(restoredPoints.H11)).toBe(true);
});

test('force dash drags from a chiral atom to a stereochemical hydrogen update exported stereochemistry', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C[C@H](F)Cl');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();

  const target = await page.evaluate(() => {
    const centers = {};
    for (const circle of document.querySelectorAll('circle.node')) {
      const rect = circle.getBoundingClientRect();
      centers[String(circle.__data__?.id ?? '')] = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        name: circle.__data__?.name ?? ''
      };
    }
    const hydrogenId = Object.entries(centers).find(([, point]) => point.name === 'H')?.[0] ?? null;
    let parentId = null;
    for (const line of document.querySelectorAll('line.bond-hover-target')) {
      const datum = line.__data__;
      const sourceId = typeof datum?.source === 'object' ? datum.source?.id : datum?.source;
      const targetId = typeof datum?.target === 'object' ? datum.target?.id : datum?.target;
      if (sourceId === hydrogenId || targetId === hydrogenId) {
        const otherId = sourceId === hydrogenId ? targetId : sourceId;
        if (centers[otherId]?.name === 'C') {
          parentId = otherId;
          break;
        }
      }
    }
    return {
      hydrogen: hydrogenId ? centers[hydrogenId] : null,
      parent: parentId ? centers[parentId] : null
    };
  });
  expect(target.hydrogen).toBeTruthy();
  expect(target.parent).toBeTruthy();

  const beforeSmiles = await page.evaluate(() => window._getMolSmiles?.() ?? null);
  await page.mouse.move(target.parent.x, target.parent.y);
  await page.mouse.down();
  await page.mouse.move(target.hydrogen.x, target.hydrogen.y, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).not.toBe(beforeSmiles);
  expect(await page.evaluate(() => window._getMolSmiles?.() ?? null)).toContain('@');
});

test('force dash drags from a potential stereocenter to a plain hydrogen create exported stereochemistry', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC(F)(Cl)[H]');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();

  const target = await page.evaluate(() => {
    const centers = {};
    for (const circle of document.querySelectorAll('circle.node')) {
      const rect = circle.getBoundingClientRect();
      centers[String(circle.__data__?.id ?? '')] = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        name: circle.__data__?.name ?? ''
      };
    }
    const hydrogenCandidates = Object.entries(centers).filter(([, point]) => point.name === 'H');
    const neighborNames = atomId => {
      const names = [];
      for (const line of document.querySelectorAll('line.bond-hover-target')) {
        const datum = line.__data__;
        const sourceId = typeof datum?.source === 'object' ? datum.source?.id : datum?.source;
        const targetId = typeof datum?.target === 'object' ? datum.target?.id : datum?.target;
        if (sourceId === atomId && centers[targetId]) {
          names.push(centers[targetId].name);
        } else if (targetId === atomId && centers[sourceId]) {
          names.push(centers[sourceId].name);
        }
      }
      return names;
    };
    for (const [hydrogenId, hydrogenPoint] of hydrogenCandidates) {
      for (const line of document.querySelectorAll('line.bond-hover-target')) {
        const datum = line.__data__;
        const sourceId = typeof datum?.source === 'object' ? datum.source?.id : datum?.source;
        const targetId = typeof datum?.target === 'object' ? datum.target?.id : datum?.target;
        if (sourceId !== hydrogenId && targetId !== hydrogenId) {
          continue;
        }
        const otherId = sourceId === hydrogenId ? targetId : sourceId;
        const parentNeighborNames = neighborNames(otherId);
        if (centers[otherId]?.name === 'C' && parentNeighborNames.includes('F') && parentNeighborNames.includes('Cl')) {
          return {
            hydrogen: hydrogenPoint,
            parent: centers[otherId]
          };
        }
      }
    }
    return { hydrogen: null, parent: null };
  });
  expect(target.hydrogen).toBeTruthy();
  expect(target.parent).toBeTruthy();
  const beforeSmiles = await page.evaluate(() => window._getMolSmiles?.() ?? null);
  expect(beforeSmiles).not.toContain('@');

  await page.mouse.move(target.parent.x, target.parent.y);
  await page.mouse.down();
  await page.mouse.move(target.hydrogen.x, target.hydrogen.y, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).toContain('@');
});

test('force mode can clear a preserved stereochemical bond back to a single line', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C[C@H](F)Cl');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  const before = await forceStereoOverlayCounts(page);
  expect(before.wedgeCount + before.dashLineCount).toBeGreaterThan(0);
  expect(before.bondIds).toContain('0');
  expect(before.bondIds).not.toContain('3');
  const forceStereoTarget = await forceBondTargetCenter(page, before.bondIds[0]);
  expect(forceStereoTarget).toBeTruthy();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-single').click();
  await page.mouse.click(forceStereoTarget.x, forceStereoTarget.y);

  await expect
    .poll(async () => {
      const after = await forceStereoOverlayCounts(page);
      return after.wedgeCount === 0 && after.dashLineCount === 0;
    })
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).not.toContain('@');
});

test('wedge display only changes exported stereochemistry for a real chiral center', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC(F)(Cl)Br');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-wedge').click();
  await clickBondHit(page, 'g[data-bond-id="1"] .bond-hit');
  await expect(page.locator('#smiles-input')).toHaveValue(/@/);

  await loadSmiles(page, 'CCO');
  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-wedge').click();
  await clickBondHit(page, 'g[data-bond-id="1"] .bond-hit');
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
});
