import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium, webkit } from '@playwright/test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BROWSER_SENSITIVE_SMILES = 'COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13';
const BROWSER_ATTACHED_RING_RESCUE_SMILES = 'CCCOC1=C(C)C=CC=C1N1C(=S)[N-]N=C1C1=CC=C(O)C=C1O';
const BROWSER_MIXED_ROOT_EXACT_EXIT_SMILES = 'COC1=CC(=CC(OC)=C1OC)C(F)(F)C(=O)N1CCCC[C@H]1C(=O)O[C@@H](CCCC1=CC=CC=C1)CCCC1=CN=CC=C1';
const BROWSER_FUSED_CYCLOBUTYL_METHYLENE_SMILES = 'FC1=CC=CC(CC2C(CC3=CC=C(CC4(CCC4)NS(=O)=O)C=C23)[NH+]2CCC2)=C1';
const BROWSER_CROWDED_PHENOL_RING_EXIT_SMILES = 'CC(=CCC12Oc3cc(O)ccc3C1(O)Oc4cc(O)c([C@H]5C=C(C)CC([C@H]5C(=O)c6ccc(O)cc6O)c7ccc(O)cc7O)c(O)c4C2=O)C';
const BROWSER_OMITTED_H_RING_HUB_SMILES = 'CC(NC(=O)C1=C2C=CC=CC2=NC=C1C(N1CCN(CC([O-])=O)C(=O)C1)C1=CC=CS1)C1CCCCC1';
const BROWSER_TETRAZOLE_OMITTED_H_SMILES = 'CCCCCCCC(C)C1CC(C(CC)C2=NNC=N2)(C(=O)O1)C1=CC=C(Cl)C=C1C';
const BROWSER_TRISODIUM_ANTHRAQUINONE_SMILES = '[Na+].[Na+].[Na+].CCc1cc(C(=O)C)c([O-])cc1OCCCOc2ccc3C(=O)c4cc(ccc4Oc3c2CCC(=O)[O-])C(=O)[O-]';
const BROWSER_PROJECTED_DIARYL_AMIDE_SMILES = 'CC(C)[NH+]1CCC(CC1)NC(=O)NC(CC1=CC=CC=C1)(C1=CC=CC(OC(F)(F)C(F)F)=C1)C1=CC=C(I)C=N1';
const BROWSER_CHLORO_BENZAMIDE_CARBAMATE_SMILES = 'Clc1ccc(NC(=O)c2cc(Cl)ccc2OC(=O)[C@H](Cc3ccccc3)NC(=O)OCc4ccccc4)cc1';
const BROWSER_ACYL_HYDRAZINE_TERTIARY_NITROGEN_SMILES = 'CCCCC([NH3+])C(=O)CN(NC(=O)C(C[NH3+])OC1=CC=CC=C1)C(C1=CC=CC=C1)C1=CC=CC=C1';
const BROWSER_TERMINAL_AMIDE_CARBONYL_CROSSING_SMILES = 'CC1=CC=C2C=C(CC3=CC=C(O)C=C3)C=C(C2=C1)[N+]1(NCC(=O)N2CC(=O)NCC12)C(=O)NCC1=CC=CC=C1';
const BROWSER_CYCLOBUTANE_IMIDAMIDE_SMILES = 'NC1=NC=C(C=N1)C1=CC=C(C=C1)C1(CCC1)C(=N)N=C(O)C1=CC=C(N=C1)N1CC[NH2+]CC1';
const BROWSER_LINKED_UREA_CARBONYL_SMILES = '[H][C@](NC(=O)NC1CCCC1)(C(C)C)C(=O)N1CC[C@]([H])(NC(=O)C2CC2)[C@@]1([H])C1(CCC1)C=O';
const BROWSER_SODIUM_TETRAZOLE_C2_CROSSING_SMILES = '[Na+].CC(C)n1nnnc1C(=C(c2ccc(F)cc2)c3ccc(F)cc3)\\C=C\\[C@@H](O)C[C@@H](O)CC(=O)[O-]';
const BROWSER_TRIARYL_SULFOXIDE_INDOLE_SMILES = 'C[S+]([O-])c1ccc(cc1)c2cc(c3ccncc3C)c([nH]2)c4ccc(F)cc4';
const BROWSER_DIHYDROPYRIDINE_CHLOROPHENYL_SMILES = 'CC1=C(C(C2=CC=CC=C2Cl)C(C2=NN=CO2)=C(C)N1)C([O-])=O';
const BROWSER_FLUORINATED_CYCLOHEXYL_ISOCYANATE_SMILES = 'FC1(F)CCCC(N=C=O)(C(C2(CCCC(F)(F)C2(F)F)N=C=O)C2(CCCC(F)(F)C2(F)F)N=C=O)C1(F)F';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

function respond(res, statusCode, body) {
  res.statusCode = statusCode;
  res.end(body);
}

async function resolveRequestPath(urlPathname) {
  const relativePath = urlPathname === '/' ? 'index.html' : urlPathname.slice(1);
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  if (!absolutePath.startsWith(REPO_ROOT)) {
    return null;
  }

  const fileStats = await stat(absolutePath).catch(() => null);
  if (!fileStats) {
    return null;
  }
  if (fileStats.isDirectory()) {
    const directoryIndexPath = path.join(absolutePath, 'index.html');
    const indexStats = await stat(directoryIndexPath).catch(() => null);
    return indexStats?.isFile() ? directoryIndexPath : null;
  }
  return fileStats.isFile() ? absolutePath : null;
}

async function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const filePath = await resolveRequestPath(requestUrl.pathname);
      if (!filePath) {
        respond(res, 404, 'Not found');
        return;
      }
      const body = await readFile(filePath);
      const contentType = MIME_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(body);
    } catch (error) {
      respond(res, 500, String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function browserLayoutSignature(browserType, origin, smiles, layoutOptions = null) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/index.html`, { timeout: 60_000 });
    return await page.evaluate(async ({ smilesValue, layoutOptionsValue }) => {
      const { parseSMILES } = await import('/src/io/smiles.js');
      const { findVisibleHeavyBondCrossings } = await import('/src/layout/engine/audit/invariants.js');
      const { computeIncidentRingOutwardAngles } = await import('/src/layout/engine/geometry/ring-direction.js');
      const { createLayoutGraphFromNormalized } = await import('/src/layout/engine/model/layout-graph.js');
      const { normalizeOptions } = await import('/src/layout/engine/options.js');
      const { measureSmallRingExteriorGapSpreadPenalty } = await import('/src/layout/engine/placement/branch-placement.js');
      const { runPipeline } = await import('/src/layout/engine/pipeline.js');

      const molecule = parseSMILES(smilesValue);
      const pipelineOptions = {
        suppressH: true,
        ...(layoutOptionsValue ?? {})
      };
      const layoutGraph = createLayoutGraphFromNormalized(molecule, normalizeOptions(pipelineOptions));
      const pipeline = runPipeline(molecule, pipelineOptions);
      const heavyAtomIds = [...molecule.atoms.keys()]
        .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
        .sort((firstAtomId, secondAtomId) => firstAtomId.localeCompare(secondAtomId, 'en', { numeric: true }));
      const coordSignature = heavyAtomIds.map(atomId => {
        const position = pipeline.coords.get(atomId);
        return `${atomId}:${Math.round(position.x * 1e6)}:${Math.round(position.y * 1e6)}`;
      }).join('|');
      const stereoSignature = [...(pipeline.metadata?.stereo?.assignments ?? [])]
        .sort((firstAssignment, secondAssignment) => (
          firstAssignment.centerId.localeCompare(secondAssignment.centerId, 'en', { numeric: true })
          || firstAssignment.bondId.localeCompare(secondAssignment.bondId, 'en', { numeric: true })
          || firstAssignment.type.localeCompare(secondAssignment.type, 'en', { numeric: true })
        ))
        .map(assignment => `${assignment.centerId}:${assignment.bondId}:${assignment.type}`)
        .join('|');
      const angularDifference = (firstAngle, secondAngle) => {
        let difference = Math.abs(firstAngle - secondAngle) % (Math.PI * 2);
        if (difference > Math.PI) {
          difference = Math.PI * 2 - difference;
        }
        return difference;
      };
      const bondAngleAtAtom = (centerAtomId, firstNeighborAtomId, secondNeighborAtomId) => {
        const center = pipeline.coords.get(centerAtomId);
        const firstNeighbor = pipeline.coords.get(firstNeighborAtomId);
        const secondNeighbor = pipeline.coords.get(secondNeighborAtomId);
        if (!center || !firstNeighbor || !secondNeighbor) {
          return null;
        }
        return angularDifference(
          Math.atan2(firstNeighbor.y - center.y, firstNeighbor.x - center.x),
          Math.atan2(secondNeighbor.y - center.y, secondNeighbor.x - center.x)
        ) * (180 / Math.PI);
      };
      const atomDistance = (firstAtomId, secondAtomId) => {
        const firstAtom = pipeline.coords.get(firstAtomId);
        const secondAtom = pipeline.coords.get(secondAtomId);
        if (!firstAtom || !secondAtom) {
          return null;
        }
        return Math.hypot(firstAtom.x - secondAtom.x, firstAtom.y - secondAtom.y);
      };
      const neighborAngleGapsAtAtom = (centerAtomId, neighborAtomIds) => {
        const center = pipeline.coords.get(centerAtomId);
        if (!center || !neighborAtomIds.every(neighborAtomId => pipeline.coords.has(neighborAtomId))) {
          return null;
        }
        const sortedAngles = neighborAtomIds
          .map(neighborAtomId => {
            const neighbor = pipeline.coords.get(neighborAtomId);
            const angle = Math.atan2(neighbor.y - center.y, neighbor.x - center.x);
            return angle < 0 ? angle + Math.PI * 2 : angle;
          })
          .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
        return sortedAngles.map((angle, index) => (
          ((sortedAngles[(index + 1) % sortedAngles.length] - angle + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI)
        ));
      };
      const isTetrazoleOmittedHCase = smilesValue === 'CCCCCCCC(C)C1CC(C(CC)C2=NNC=N2)(C(=O)O1)C1=CC=C(Cl)C=C1C';
      const c28Spreads = [
        bondAngleAtAtom('C28', 'O27', 'C30'),
        bondAngleAtAtom('C28', 'O27', 'C39'),
        bondAngleAtAtom('C28', 'C30', 'C39')
      ];
      const c13Angles = {
        branch: bondAngleAtAtom('C13', 'C5', 'C16'),
        geminalFluoro: bondAngleAtAtom('C13', 'F14', 'F15')
      };
      const fusedCyclobutylC15Angle = bondAngleAtAtom('C15', 'C14', 'C16');
      const fusedCyclobutylS21Angles = {
        firstOxo: bondAngleAtAtom('S21', 'N20', 'O22'),
        secondOxo: bondAngleAtAtom('S21', 'N20', 'O23'),
        oxo: bondAngleAtAtom('S21', 'O22', 'O23')
      };
      const crowdedPhenolC49Spreads = [
        bondAngleAtAtom('C49', 'C21', 'O50'),
        bondAngleAtAtom('C49', 'C21', 'C51'),
        bondAngleAtAtom('C49', 'O50', 'C51')
      ];
      const crowdedPhenolC52Spreads = [
        bondAngleAtAtom('C52', 'C5', 'O53'),
        bondAngleAtAtom('C52', 'C5', 'C51'),
        bondAngleAtAtom('C52', 'O53', 'C51')
      ];
      const crowdedPhenolC31Angles = [
        bondAngleAtAtom('C31', 'O32', 'C33'),
        bondAngleAtAtom('C31', 'O32', 'C29'),
        bondAngleAtAtom('C31', 'C33', 'C29')
      ];
      const crowdedPhenolO15BridgeAngle = bondAngleAtAtom('C14', 'C5', 'O15');
      const omittedHubC16Spreads = [
        bondAngleAtAtom('C16', 'N17', 'C28'),
        bondAngleAtAtom('C16', 'N17', 'C15'),
        bondAngleAtAtom('C16', 'C28', 'C15')
      ];
      const omittedHubC28Angles = [
        bondAngleAtAtom('C28', 'C16', 'C29'),
        bondAngleAtAtom('C28', 'C16', 'S32'),
        bondAngleAtAtom('C28', 'C29', 'S32')
      ];
      const omittedHubN17Angles = [
        bondAngleAtAtom('N17', 'C16', 'C18'),
        bondAngleAtAtom('N17', 'C16', 'C27'),
        bondAngleAtAtom('N17', 'C18', 'C27')
      ];
      const omittedHubC6Angles = [
        bondAngleAtAtom('C6', 'C4', 'C15'),
        bondAngleAtAtom('C6', 'C4', 'C7'),
        bondAngleAtAtom('C6', 'C15', 'C7')
      ];
      const omittedHubC4Angles = [
        bondAngleAtAtom('C4', 'O5', 'C6'),
        bondAngleAtAtom('C4', 'O5', 'N3'),
        bondAngleAtAtom('C4', 'C6', 'N3')
      ];
      const tetrazoleC13Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C13', 'C12', 'C14'),
            bondAngleAtAtom('C13', 'C12', 'C16'),
            bondAngleAtAtom('C13', 'C14', 'C16')
          ]
        : null;
      const tetrazoleC12Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C12', 'C11', 'C13'),
            bondAngleAtAtom('C12', 'C11', 'C21'),
            bondAngleAtAtom('C12', 'C11', 'C24'),
            bondAngleAtAtom('C12', 'C13', 'C21'),
            bondAngleAtAtom('C12', 'C13', 'C24'),
            bondAngleAtAtom('C12', 'C21', 'C24')
          ]
        : null;
      const tetrazoleC30Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C30', 'C24', 'C31'),
            bondAngleAtAtom('C30', 'C29', 'C31'),
            bondAngleAtAtom('C30', 'C24', 'C29')
          ]
        : null;
      const tetrazoleC24Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C24', 'C12', 'C30'),
            bondAngleAtAtom('C24', 'C12', 'C25'),
            bondAngleAtAtom('C24', 'C30', 'C25')
          ]
        : null;
      const trisodiumC37Angle = bondAngleAtAtom('C37', 'C36', 'C38');
      const projectedDiarylC15Angles = [
        bondAngleAtAtom('C15', 'N14', 'C16'),
        bondAngleAtAtom('C15', 'N14', 'C23'),
        bondAngleAtAtom('C15', 'N14', 'C36'),
        bondAngleAtAtom('C15', 'C16', 'C23'),
        bondAngleAtAtom('C15', 'C16', 'C36'),
        bondAngleAtAtom('C15', 'C23', 'C36')
      ];
      const projectedDiarylC12Angles = [
        bondAngleAtAtom('C12', 'O13', 'N14'),
        bondAngleAtAtom('C12', 'O13', 'N11'),
        bondAngleAtAtom('C12', 'N14', 'N11')
      ];
      const projectedDiarylC36Angles = [
        bondAngleAtAtom('C36', 'C15', 'N42'),
        bondAngleAtAtom('C36', 'C15', 'C37'),
        bondAngleAtAtom('C36', 'N42', 'C37')
      ];
      const projectedDiarylC16Angle = bondAngleAtAtom('C16', 'C15', 'C17');
      const projectedDiarylC37C24Distance = atomDistance('C37', 'C24');
      const chloroBenzamideC15Angles = [
        bondAngleAtAtom('C15', 'C9', 'C14'),
        bondAngleAtAtom('C15', 'C9', 'O16'),
        bondAngleAtAtom('C15', 'C14', 'O16')
      ];
      const acylHydrazineN11Angles = [
        bondAngleAtAtom('N11', 'N12', 'C26'),
        bondAngleAtAtom('N11', 'N12', 'C10'),
        bondAngleAtAtom('N11', 'C26', 'C10')
      ];
      const acylHydrazineC26Angles = [
        bondAngleAtAtom('C26', 'N11', 'C27'),
        bondAngleAtAtom('C26', 'N11', 'C33'),
        bondAngleAtAtom('C26', 'C27', 'C33')
      ];
      const acylHydrazineN17PhenoxyRingClearance = Math.min(
        ...['C20', 'C21', 'C22', 'C23', 'C24', 'C25']
          .map(ringAtomId => atomDistance('N17', ringAtomId))
          .filter(value => typeof value === 'number' && Number.isFinite(value))
      );
      const isTerminalAmideCarbonylCrossingCase = smilesValue
        === 'CC1=CC=C2C=C(CC3=CC=C(O)C=C3)C=C(C2=C1)[N+]1(NCC(=O)N2CC(=O)NCC12)C(=O)NCC1=CC=CC=C1';
      const terminalAmideO33C16Distance = isTerminalAmideCarbonylCrossingCase
        ? atomDistance('O33', 'C16')
        : null;
      const terminalAmideN20BranchGap = isTerminalAmideCarbonylCrossingCase
        ? bondAngleAtAtom('N20', 'C17', 'C32')
        : null;
      const terminalAmideN20ExteriorPenalty = isTerminalAmideCarbonylCrossingCase && pipeline.coords.has('N20')
        ? measureSmallRingExteriorGapSpreadPenalty(pipeline.layoutGraph, pipeline.coords, 'N20')
        : null;
      const terminalAmideC32Angles = isTerminalAmideCarbonylCrossingCase
        ? [
            bondAngleAtAtom('C32', 'N20', 'O33'),
            bondAngleAtAtom('C32', 'N20', 'N34'),
            bondAngleAtAtom('C32', 'O33', 'N34')
          ]
        : [];
      const terminalAmideC32MaxDeviation = terminalAmideC32Angles.every(value => (
        typeof value === 'number' && Number.isFinite(value)
      ))
        ? Math.max(...terminalAmideC32Angles.map(value => Math.abs(value - 120)))
        : null;
      const isCyclobutaneImidamideCase = smilesValue
        === 'NC1=NC=C(C=N1)C1=CC=C(C=C1)C1(CCC1)C(=N)N=C(O)C1=CC=C(N=C1)N1CC[NH2+]CC1';
      const cyclobutaneImidamideC14ExteriorPenalty = isCyclobutaneImidamideCase
        ? measureSmallRingExteriorGapSpreadPenalty(pipeline.layoutGraph, pipeline.coords, 'C14')
        : null;
      const cyclobutaneImidamideC14Gaps = isCyclobutaneImidamideCase
        ? neighborAngleGapsAtAtom('C14', ['C11', 'C15', 'C17', 'C18'])
        : null;
      const cyclobutaneImidamideN19C10Distance = isCyclobutaneImidamideCase
        ? atomDistance('N19', 'C10')
        : null;
      const isLinkedUreaCarbonylCase = smilesValue
        === '[H][C@](NC(=O)NC1CCCC1)(C(C)C)C(=O)N1CC[C@]([H])(NC(=O)C2CC2)[C@@]1([H])C1(CCC1)C=O';
      const linkedUreaC4Angles = isLinkedUreaCarbonylCase
        ? [
            bondAngleAtAtom('C4', 'O5', 'N6'),
            bondAngleAtAtom('C4', 'O5', 'N3'),
            bondAngleAtAtom('C4', 'N6', 'N3')
          ]
        : null;
      const triarylSulfoxideC18Angles = smilesValue === 'C[S+]([O-])c1ccc(cc1)c2cc(c3ccncc3C)c([nH]2)c4ccc(F)cc4'
        ? [
            bondAngleAtAtom('C18', 'C13', 'C17'),
            bondAngleAtAtom('C18', 'C13', 'C19'),
            bondAngleAtAtom('C18', 'C17', 'C19')
          ]
        : null;
      const isDihydropyridineChlorophenylCase = smilesValue
        === 'CC1=C(C(C2=CC=CC=C2Cl)C(C2=NN=CO2)=C(C)N1)C([O-])=O';
      const dihydropyridineC12Angles = isDihydropyridineChlorophenylCase
        ? [
            bondAngleAtAtom('C12', 'C4', 'C13'),
            bondAngleAtAtom('C12', 'C4', 'C18'),
            bondAngleAtAtom('C12', 'C13', 'C18')
          ]
        : null;
      const dihydropyridineC13Angles = isDihydropyridineChlorophenylCase
        ? [
            bondAngleAtAtom('C13', 'C12', 'O17'),
            bondAngleAtAtom('C13', 'C12', 'N14'),
            bondAngleAtAtom('C13', 'O17', 'N14')
          ]
        : null;
      const isFluorinatedCyclohexylIsocyanateCase = smilesValue
        === 'FC1(F)CCCC(N=C=O)(C(C2(CCCC(F)(F)C2(F)F)N=C=O)C2(CCCC(F)(F)C2(F)F)N=C=O)C1(F)F';
      const fluorinatedCyclohexylExteriorPenalties = isFluorinatedCyclohexylIsocyanateCase
        ? Object.fromEntries(['C38', 'C32', 'C16', 'C19', 'C2', 'C29'].map(atomId => [
            atomId,
            measureSmallRingExteriorGapSpreadPenalty(pipeline.layoutGraph, pipeline.coords, atomId)
          ]))
        : null;
      const fluorinatedCyclohexylC11Angles = isFluorinatedCyclohexylIsocyanateCase
        ? neighborAngleGapsAtAtom('C11', ['C7', 'C12', 'C25'])
        : null;
      const fluorinatedCyclohexylC7Angles = isFluorinatedCyclohexylIsocyanateCase
        ? neighborAngleGapsAtAtom('C7', ['C38', 'C6', 'N8', 'C11'])
        : null;
      const fluorinatedCyclohexylIsocyanateAngles = isFluorinatedCyclohexylIsocyanateCase
        ? [
            bondAngleAtAtom('C36', 'N35', 'O37'),
            bondAngleAtAtom('C23', 'N22', 'O24'),
            bondAngleAtAtom('C9', 'N8', 'O10')
          ]
        : null;
      const omittedHubRootOutwardDeviation = (rootAtomId, parentAtomId) => {
        const rootPosition = pipeline.coords.get(rootAtomId);
        const parentPosition = pipeline.coords.get(parentAtomId);
        if (!rootPosition || !parentPosition) {
          return null;
        }
        const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, rootAtomId, atomId => pipeline.coords.get(atomId) ?? null);
        if (outwardAngles.length === 0) {
          return null;
        }
        const parentAngle = Math.atan2(parentPosition.y - rootPosition.y, parentPosition.x - rootPosition.x);
        return Math.min(...outwardAngles.map(outwardAngle => angularDifference(parentAngle, outwardAngle))) * (180 / Math.PI);
      };
      const omittedHubC28OutwardDeviation = omittedHubRootOutwardDeviation('C28', 'C16');
      const omittedHubN17OutwardDeviation = omittedHubRootOutwardDeviation('N17', 'C16');
      return {
        coordSignature,
        stereoSignature,
        c28Spreads: c28Spreads.every(value => typeof value === 'number' && Number.isFinite(value))
          ? c28Spreads
          : null,
        c13Angles: Object.values(c13Angles).every(value => typeof value === 'number' && Number.isFinite(value))
          ? c13Angles
          : null,
        fusedCyclobutylC15Angle: typeof fusedCyclobutylC15Angle === 'number' && Number.isFinite(fusedCyclobutylC15Angle)
          ? fusedCyclobutylC15Angle
          : null,
        fusedCyclobutylS21Angles: Object.values(fusedCyclobutylS21Angles).every(value => typeof value === 'number' && Number.isFinite(value))
          ? fusedCyclobutylS21Angles
          : null,
        crowdedPhenolC49Spreads: crowdedPhenolC49Spreads.every(value => typeof value === 'number' && Number.isFinite(value))
          ? crowdedPhenolC49Spreads
          : null,
        crowdedPhenolC52Spreads: crowdedPhenolC52Spreads.every(value => typeof value === 'number' && Number.isFinite(value))
          ? crowdedPhenolC52Spreads
          : null,
        crowdedPhenolC31Angles: crowdedPhenolC31Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? crowdedPhenolC31Angles
          : null,
        crowdedPhenolO15BridgeAngle: typeof crowdedPhenolO15BridgeAngle === 'number' && Number.isFinite(crowdedPhenolO15BridgeAngle)
          ? crowdedPhenolO15BridgeAngle
          : null,
        omittedHubC16Spreads: omittedHubC16Spreads.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC16Spreads
          : null,
        omittedHubC28Angles: omittedHubC28Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC28Angles
          : null,
        omittedHubN17Angles: omittedHubN17Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubN17Angles
          : null,
        omittedHubC6Angles: omittedHubC6Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC6Angles
          : null,
        omittedHubC4Angles: omittedHubC4Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC4Angles
          : null,
        tetrazoleC13Angles: Array.isArray(tetrazoleC13Angles) && tetrazoleC13Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC13Angles
          : null,
        tetrazoleC12Angles: Array.isArray(tetrazoleC12Angles) && tetrazoleC12Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC12Angles
          : null,
        tetrazoleC30Angles: Array.isArray(tetrazoleC30Angles) && tetrazoleC30Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC30Angles
          : null,
        tetrazoleC24Angles: Array.isArray(tetrazoleC24Angles) && tetrazoleC24Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC24Angles
          : null,
        visibleHeavyBondCrossingCount: findVisibleHeavyBondCrossings(pipeline.layoutGraph, pipeline.coords).length,
        omittedHubC28OutwardDeviation: typeof omittedHubC28OutwardDeviation === 'number' && Number.isFinite(omittedHubC28OutwardDeviation)
          ? omittedHubC28OutwardDeviation
          : null,
        omittedHubN17OutwardDeviation: typeof omittedHubN17OutwardDeviation === 'number' && Number.isFinite(omittedHubN17OutwardDeviation)
          ? omittedHubN17OutwardDeviation
          : null,
        trisodiumC37Angle: typeof trisodiumC37Angle === 'number' && Number.isFinite(trisodiumC37Angle)
          ? trisodiumC37Angle
          : null,
        projectedDiarylC15Angles: projectedDiarylC15Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? projectedDiarylC15Angles
          : null,
        projectedDiarylC12Angles: projectedDiarylC12Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? projectedDiarylC12Angles
          : null,
        projectedDiarylC36Angles: projectedDiarylC36Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? projectedDiarylC36Angles
          : null,
        projectedDiarylC16Angle: typeof projectedDiarylC16Angle === 'number' && Number.isFinite(projectedDiarylC16Angle)
          ? projectedDiarylC16Angle
          : null,
        projectedDiarylC37C24Distance: typeof projectedDiarylC37C24Distance === 'number' && Number.isFinite(projectedDiarylC37C24Distance)
          ? projectedDiarylC37C24Distance
          : null,
        chloroBenzamideC15Angles: chloroBenzamideC15Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? chloroBenzamideC15Angles
          : null,
        acylHydrazineN11Angles: acylHydrazineN11Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? acylHydrazineN11Angles
          : null,
        acylHydrazineC26Angles: acylHydrazineC26Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? acylHydrazineC26Angles
          : null,
        acylHydrazineN17PhenoxyRingClearance: typeof acylHydrazineN17PhenoxyRingClearance === 'number' && Number.isFinite(acylHydrazineN17PhenoxyRingClearance)
          ? acylHydrazineN17PhenoxyRingClearance
          : null,
        terminalAmideO33C16Distance: typeof terminalAmideO33C16Distance === 'number' && Number.isFinite(terminalAmideO33C16Distance)
          ? terminalAmideO33C16Distance
          : null,
        terminalAmideN20BranchGap: typeof terminalAmideN20BranchGap === 'number' && Number.isFinite(terminalAmideN20BranchGap)
          ? terminalAmideN20BranchGap
          : null,
        terminalAmideN20ExteriorPenalty: typeof terminalAmideN20ExteriorPenalty === 'number' && Number.isFinite(terminalAmideN20ExteriorPenalty)
          ? terminalAmideN20ExteriorPenalty
          : null,
        terminalAmideC32MaxDeviation: typeof terminalAmideC32MaxDeviation === 'number' && Number.isFinite(terminalAmideC32MaxDeviation)
          ? terminalAmideC32MaxDeviation
          : null,
        cyclobutaneImidamideC14ExteriorPenalty: typeof cyclobutaneImidamideC14ExteriorPenalty === 'number' && Number.isFinite(cyclobutaneImidamideC14ExteriorPenalty)
          ? cyclobutaneImidamideC14ExteriorPenalty
          : null,
        cyclobutaneImidamideC14Gaps: Array.isArray(cyclobutaneImidamideC14Gaps) && cyclobutaneImidamideC14Gaps.every(value => typeof value === 'number' && Number.isFinite(value))
          ? cyclobutaneImidamideC14Gaps
          : null,
        cyclobutaneImidamideN19C10Distance: typeof cyclobutaneImidamideN19C10Distance === 'number' && Number.isFinite(cyclobutaneImidamideN19C10Distance)
          ? cyclobutaneImidamideN19C10Distance
          : null,
        linkedUreaC4Angles: Array.isArray(linkedUreaC4Angles) && linkedUreaC4Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? linkedUreaC4Angles
          : null,
        triarylSulfoxideC18Angles: Array.isArray(triarylSulfoxideC18Angles) && triarylSulfoxideC18Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? triarylSulfoxideC18Angles
          : null,
        dihydropyridineC12Angles: Array.isArray(dihydropyridineC12Angles) && dihydropyridineC12Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? dihydropyridineC12Angles
          : null,
        dihydropyridineC13Angles: Array.isArray(dihydropyridineC13Angles) && dihydropyridineC13Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? dihydropyridineC13Angles
          : null,
        fluorinatedCyclohexylExteriorPenalties,
        fluorinatedCyclohexylC11Angles: Array.isArray(fluorinatedCyclohexylC11Angles) && fluorinatedCyclohexylC11Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? fluorinatedCyclohexylC11Angles
          : null,
        fluorinatedCyclohexylC7Angles: Array.isArray(fluorinatedCyclohexylC7Angles) && fluorinatedCyclohexylC7Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? fluorinatedCyclohexylC7Angles
          : null,
        fluorinatedCyclohexylIsocyanateAngles: Array.isArray(fluorinatedCyclohexylIsocyanateAngles) && fluorinatedCyclohexylIsocyanateAngles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? fluorinatedCyclohexylIsocyanateAngles
          : null,
        audit: {
          ok: pipeline.metadata?.audit?.ok ?? null,
          severeOverlapCount: pipeline.metadata?.audit?.severeOverlapCount ?? null,
          ringSubstituentReadabilityFailureCount: pipeline.metadata?.audit?.ringSubstituentReadabilityFailureCount ?? null,
          outwardAxisRingSubstituentFailureCount: pipeline.metadata?.audit?.outwardAxisRingSubstituentFailureCount ?? null
        }
      };
    }, { smilesValue: smiles, layoutOptionsValue: layoutOptions });
  } finally {
    await browser.close();
  }
}

test('browser layout remains deterministic across chromium and webkit for mixed fused/attached-ring placement', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_SENSITIVE_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_SENSITIVE_SMILES);

  assert.deepStrictEqual(webkitSignature, chromiumSignature);
});

test('browser layout stays deterministic and overlap-free for the attached-ring overlap rescue', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_ATTACHED_RING_RESCUE_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_ATTACHED_RING_RESCUE_SMILES);

  assert.deepStrictEqual(webkitSignature, chromiumSignature);
  assert.equal(chromiumSignature.audit.ok, true);
  assert.equal(chromiumSignature.audit.severeOverlapCount, 0);
  assert.equal(chromiumSignature.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(chromiumSignature.audit.outwardAxisRingSubstituentFailureCount, 0);
});

test('browser layout clears terminal amide carbonyl ring crossings in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const webkitSignature = await browserLayoutSignature(
    webkit,
    origin,
    BROWSER_TERMINAL_AMIDE_CARBONYL_CROSSING_SMILES,
    { finalLandscapeOrientation: true }
  );

  assert.equal(webkitSignature.audit.ok, true);
  assert.equal(webkitSignature.audit.severeOverlapCount, 0);
  assert.equal(webkitSignature.visibleHeavyBondCrossingCount, 0);
  assert.ok(webkitSignature.terminalAmideO33C16Distance > 1.125);
  assert.ok(webkitSignature.terminalAmideN20BranchGap > 80);
  assert.ok(webkitSignature.terminalAmideN20ExteriorPenalty < 0.6);
  assert.ok(webkitSignature.terminalAmideC32MaxDeviation < 30);
});

test('browser layout keeps fused cyclobutyl methylene linkers bent and suppressed-h sulfonyl sulfur trigonal in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_FUSED_CYCLOBUTYL_METHYLENE_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_FUSED_CYCLOBUTYL_METHYLENE_SMILES);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.ok(
      Math.abs(signature.fusedCyclobutylC15Angle - 120) < 1e-6,
      `expected ${browserName} C14-C15-C16 near 120 degrees, got ${signature.fusedCyclobutylC15Angle?.toFixed(2)}`
    );
    assert.ok(signature.fusedCyclobutylS21Angles, `expected ${browserName} to report S21 angles`);
    for (const [label, angle] of Object.entries(signature.fusedCyclobutylS21Angles)) {
      assert.ok(
        Math.abs(angle - 120) < 1e-6,
        `expected ${browserName} S21 ${label} fan angle near 120 degrees, got ${angle.toFixed(2)}`
      );
    }
  }
});

test('browser layout stays audit-clean for mixed-root exact ring exits on anisole-linked ring systems', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_MIXED_ROOT_EXACT_EXIT_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_MIXED_ROOT_EXACT_EXIT_SMILES);

  assert.equal(webkitSignature.stereoSignature, chromiumSignature.stereoSignature);
  assert.deepStrictEqual(webkitSignature.audit, chromiumSignature.audit);
  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.ok(Array.isArray(signature.c28Spreads), `expected ${browserName} to report C28 spreads`);
    for (const spread of signature.c28Spreads) {
      assert.ok(Math.abs(spread - 120) < 1e-6, `expected ${browserName} C28 spread near 120 degrees, got ${spread.toFixed(2)}`);
    }
    assert.ok(signature.c13Angles, `expected ${browserName} to report C13 angles`);
    assert.ok(Math.abs(signature.c13Angles.branch - 90) < 1e-6, `expected ${browserName} C5-C13-C16 near 90 degrees, got ${signature.c13Angles.branch.toFixed(2)}`);
    assert.ok(Math.abs(signature.c13Angles.geminalFluoro - 90) < 2.5, `expected ${browserName} F14-C13-F15 near 90 degrees, got ${signature.c13Angles.geminalFluoro.toFixed(2)}`);
  }
  assert.equal(chromiumSignature.audit.ok, true);
  assert.equal(chromiumSignature.audit.severeOverlapCount, 0);
  assert.equal(chromiumSignature.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(chromiumSignature.audit.outwardAxisRingSubstituentFailureCount, 0);
});

test('browser layout keeps crowded omitted-h thiophene and piperazine hubs bounded and overlap-free in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_OMITTED_H_RING_HUB_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_OMITTED_H_RING_HUB_SMILES, layoutOptions);

  assert.deepStrictEqual(webkitSignature.audit, chromiumSignature.audit);
  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.ok(Array.isArray(signature.omittedHubC16Spreads), `expected ${browserName} to report C16 spreads`);
    assert.ok(
      Math.max(...signature.omittedHubC16Spreads.map(spread => Math.abs(spread - 120))) <= 30 + 1e-6,
      `expected ${browserName} C16 omitted-H spread to stay bounded, got ${signature.omittedHubC16Spreads.map(spread => spread.toFixed(2)).join(', ')}`
    );
    assert.ok(Array.isArray(signature.omittedHubC28Angles), `expected ${browserName} to report C28 angles`);
    for (const [index, expectedAngle] of [126, 126, 108].entries()) {
      const angle = signature.omittedHubC28Angles[index];
      assert.ok(Math.abs(angle - expectedAngle) < 1e-6, `expected ${browserName} C28 angle near ${expectedAngle} degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.omittedHubN17Angles), `expected ${browserName} to report N17 angles`);
    for (const angle of signature.omittedHubN17Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} N17 angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.omittedHubC6Angles), `expected ${browserName} to report C6 angles`);
    for (const angle of signature.omittedHubC6Angles) {
      assert.ok(Math.abs(angle - 120) <= 24 + 1e-6, `expected ${browserName} C6 angle within the bounded local relief, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.omittedHubC4Angles), `expected ${browserName} to report C4 angles`);
    assert.ok(
      Math.max(...signature.omittedHubC4Angles.map(angle => Math.abs(angle - 120))) <= 16 + 1e-6,
      `expected ${browserName} C4 balanced relief angles to stay bounded, got ${signature.omittedHubC4Angles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      signature.omittedHubC28OutwardDeviation < 1e-6,
      `expected ${browserName} C28 outward deviation below tolerance, got ${signature.omittedHubC28OutwardDeviation?.toFixed(6)}`
    );
    assert.ok(
      signature.omittedHubN17OutwardDeviation < 1e-6,
      `expected ${browserName} N17 outward deviation below tolerance, got ${signature.omittedHubN17OutwardDeviation?.toFixed(6)}`
    );
  }
});

test('browser layout keeps the tetrazole-linked C13 fan bounded without collapsing C12 in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_TETRAZOLE_OMITTED_H_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_TETRAZOLE_OMITTED_H_SMILES, layoutOptions);

  assert.deepStrictEqual(webkitSignature.audit, chromiumSignature.audit);
  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.equal(signature.visibleHeavyBondCrossingCount, 0, `expected ${browserName} to avoid visible heavy-bond crossings`);
    assert.ok(Array.isArray(signature.tetrazoleC13Angles), `expected ${browserName} to report C13 angles`);
    for (const angle of signature.tetrazoleC13Angles) {
      assert.ok(Math.abs(angle - 120) <= 25 + 1e-6, `expected ${browserName} C13 fan within bounded relief, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.tetrazoleC12Angles), `expected ${browserName} to report C12 angles`);
    assert.ok(
      Math.min(...signature.tetrazoleC12Angles) >= 70,
      `expected ${browserName} C12 branch fan to avoid collapse, got ${signature.tetrazoleC12Angles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(Array.isArray(signature.tetrazoleC30Angles), `expected ${browserName} to report C30 angles`);
    for (const angle of signature.tetrazoleC30Angles) {
      assert.ok(
        Math.abs(angle - 120) <= 15 + 1e-6,
        `expected ${browserName} C30 methyl fan to stay on the backed-off outward slot, got ${angle.toFixed(2)}`
      );
    }
    assert.ok(Array.isArray(signature.tetrazoleC24Angles), `expected ${browserName} to report C24 angles`);
    for (const angle of signature.tetrazoleC24Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} C24 phenyl root near 120 degrees, got ${angle.toFixed(2)}`);
    }
  }
});

test('browser layout keeps triaryl sulfoxide indole aromatic fans trigonal in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const webkitSignature = await browserLayoutSignature(
    webkit,
    origin,
    BROWSER_TRIARYL_SULFOXIDE_INDOLE_SMILES,
    {
      auditTelemetry: true,
      finalLandscapeOrientation: true
    }
  );

  assert.equal(webkitSignature.audit.ok, true);
  assert.equal(webkitSignature.audit.severeOverlapCount, 0);
  assert.ok(Array.isArray(webkitSignature.triarylSulfoxideC18Angles), 'expected webkit to report C18 aromatic fan angles');
  for (const angle of webkitSignature.triarylSulfoxideC18Angles) {
    assert.ok(Math.abs(angle - 120) < 1e-6, `expected webkit C18 fan near 120 degrees, got ${angle.toFixed(2)}`);
  }
});

test('browser layout retidies the chlorophenyl dihydropyridine C12 fan in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const webkitSignature = await browserLayoutSignature(
    webkit,
    origin,
    BROWSER_DIHYDROPYRIDINE_CHLOROPHENYL_SMILES,
    {
      auditTelemetry: true,
      finalLandscapeOrientation: true
    }
  );

  assert.equal(webkitSignature.audit.ok, true);
  assert.equal(webkitSignature.audit.severeOverlapCount, 0);
  assert.ok(Array.isArray(webkitSignature.dihydropyridineC12Angles), 'expected webkit to report C12 angles');
  for (const angle of webkitSignature.dihydropyridineC12Angles) {
    assert.ok(Math.abs(angle - 120) < 1e-6, `expected webkit C12 fan near 120 degrees, got ${angle.toFixed(2)}`);
  }
  assert.ok(Array.isArray(webkitSignature.dihydropyridineC13Angles), 'expected webkit to report C13 angles');
  assert.ok(
    Math.max(
      Math.abs(webkitSignature.dihydropyridineC13Angles[0] - 126),
      Math.abs(webkitSignature.dihydropyridineC13Angles[1] - 126)
    ) <= 15 + 1e-6,
    `expected webkit oxadiazole root relief to stay bounded, got ${webkitSignature.dihydropyridineC13Angles.map(angle => angle.toFixed(2)).join(', ')}`
  );
});

test('browser layout preserves fluorinated cyclohexyl exterior fans in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const webkitSignature = await browserLayoutSignature(
    webkit,
    origin,
    BROWSER_FLUORINATED_CYCLOHEXYL_ISOCYANATE_SMILES,
    {
      auditTelemetry: true,
      finalLandscapeOrientation: true
    }
  );

  assert.equal(webkitSignature.audit.ok, true);
  assert.equal(webkitSignature.audit.severeOverlapCount, 0);
  assert.equal(webkitSignature.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(webkitSignature.audit.outwardAxisRingSubstituentFailureCount, 0);
  assert.ok(webkitSignature.fluorinatedCyclohexylExteriorPenalties, 'expected webkit to report fluorinated cyclohexyl exterior penalties');
  for (const [atomId, penalty] of Object.entries(webkitSignature.fluorinatedCyclohexylExteriorPenalties)) {
    assert.ok(
      penalty < 1e-9,
      `expected webkit ${atomId} exterior fan to stay exact, got penalty ${penalty.toExponential(3)}`
    );
  }
  assert.ok(Array.isArray(webkitSignature.fluorinatedCyclohexylC11Angles), 'expected webkit to report C11 ring-link angles');
  for (const angle of webkitSignature.fluorinatedCyclohexylC11Angles) {
    assert.ok(Math.abs(angle - 120) < 1e-6, `expected webkit C11 fan near 120 degrees, got ${angle.toFixed(2)}`);
  }
  assert.ok(Array.isArray(webkitSignature.fluorinatedCyclohexylC7Angles), 'expected webkit to report C7 ring-exit angles');
  assert.ok(
    Math.min(...webkitSignature.fluorinatedCyclohexylC7Angles) >= 45 - 1e-6,
    `expected webkit C7 fan to stay bounded while clearing overlaps, got ${webkitSignature.fluorinatedCyclohexylC7Angles.map(angle => angle.toFixed(2)).join(', ')}`
  );
  assert.ok(Array.isArray(webkitSignature.fluorinatedCyclohexylIsocyanateAngles), 'expected webkit to report isocyanate angles');
  for (const angle of webkitSignature.fluorinatedCyclohexylIsocyanateAngles) {
    assert.ok(Math.abs(angle - 180) < 1e-6, `expected webkit isocyanate arm near 180 degrees, got ${angle.toFixed(2)}`);
  }
});

test('browser layout preserves the trisodium anthraquinone C37 zigzag through presentation cleanup', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_TRISODIUM_ANTHRAQUINONE_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_TRISODIUM_ANTHRAQUINONE_SMILES, layoutOptions);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.ok(
      Math.abs(signature.trisodiumC37Angle - 120) < 1e-6,
      `expected ${browserName} C36-C37-C38 near 120 degrees, got ${signature.trisodiumC37Angle?.toFixed(2)}`
    );
  }
});

test('browser layout keeps projected diaryl amide C15 bounded and clears C37 in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_PROJECTED_DIARYL_AMIDE_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_PROJECTED_DIARYL_AMIDE_SMILES, layoutOptions);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.ok(Array.isArray(signature.projectedDiarylC15Angles), `expected ${browserName} to report C15 angles`);
    const sortedAngles = [...signature.projectedDiarylC15Angles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
    assert.ok(
      sortedAngles.every(angle => Math.min(Math.abs(angle - 90), Math.abs(angle - 180)) <= 20 + 1e-6),
      `expected ${browserName} C15 projected center to stay near crossed slots, got ${sortedAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      sortedAngles[0] >= 70 - 1e-6 && sortedAngles.at(-1) >= 160 - 1e-6,
      `expected ${browserName} C15 projected center to remain crossed, got ${sortedAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(Array.isArray(signature.projectedDiarylC12Angles), `expected ${browserName} to report C12 angles`);
    for (const angle of signature.projectedDiarylC12Angles) {
      assert.ok(
        Math.abs(angle - 120) <= 30 + 1e-6,
        `expected ${browserName} C12 carbonyl fan to stay bounded, got ${angle.toFixed(2)}`
      );
    }
    assert.ok(Array.isArray(signature.projectedDiarylC36Angles), `expected ${browserName} to report C36 angles`);
    for (const angle of signature.projectedDiarylC36Angles) {
      assert.ok(
        Math.abs(angle - 120) < 1e-6,
        `expected ${browserName} C36 pyridyl fan near 120 degrees, got ${angle.toFixed(2)}`
      );
    }
    assert.ok(
      signature.projectedDiarylC16Angle >= 120 - 1e-6 && signature.projectedDiarylC16Angle <= 150 + 1e-6,
      `expected ${browserName} C16 branch to keep a bounded bend, got ${signature.projectedDiarylC16Angle?.toFixed(2)}`
    );
    assert.ok(
      signature.projectedDiarylC37C24Distance > 2.5,
      `expected ${browserName} C37/C24 to be separated, got ${signature.projectedDiarylC37C24Distance?.toFixed(2)}`
    );
  }
});

test('browser layout keeps aryl-carbamate direct ring roots exact in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_CHLORO_BENZAMIDE_CARBAMATE_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_CHLORO_BENZAMIDE_CARBAMATE_SMILES, layoutOptions);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.ok(Array.isArray(signature.chloroBenzamideC15Angles), `expected ${browserName} to report aryl-carbamate root angles`);
    for (const angle of signature.chloroBenzamideC15Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} aryl-carbamate root angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
  }
});

test('browser layout keeps cyclobutane imidamide branches exact and clear in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_CYCLOBUTANE_IMIDAMIDE_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_CYCLOBUTANE_IMIDAMIDE_SMILES, layoutOptions);

  assert.deepStrictEqual(webkitSignature.audit, chromiumSignature.audit);
  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.equal(signature.visibleHeavyBondCrossingCount, 0, `expected ${browserName} to avoid visible heavy-bond crossings`);
    assert.ok(
      signature.cyclobutaneImidamideC14ExteriorPenalty < 1e-9,
      `expected ${browserName} C14 exterior fan to be exact, got ${signature.cyclobutaneImidamideC14ExteriorPenalty?.toExponential(3)}`
    );
    assert.ok(Array.isArray(signature.cyclobutaneImidamideC14Gaps), `expected ${browserName} to report C14 exterior gaps`);
    for (const gap of signature.cyclobutaneImidamideC14Gaps) {
      assert.ok(Math.abs(gap - 90) < 1e-6, `expected ${browserName} C14 branches on quadrants, got ${gap.toFixed(2)} degrees`);
    }
    assert.ok(
      signature.cyclobutaneImidamideN19C10Distance > 1.125,
      `expected ${browserName} N19 to clear the aryl ring, got ${signature.cyclobutaneImidamideN19C10Distance?.toFixed(3)}`
    );
  }
});

test('browser layout retries mixed roots when linked urea carbonyl slots are blocked in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_LINKED_UREA_CARBONYL_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_LINKED_UREA_CARBONYL_SMILES, layoutOptions);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.equal(signature.visibleHeavyBondCrossingCount, 0, `expected ${browserName} to avoid visible heavy-bond crossings`);
    assert.ok(Array.isArray(signature.linkedUreaC4Angles), `expected ${browserName} to report linked urea carbonyl angles`);
    for (const angle of signature.linkedUreaC4Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} linked urea carbonyl fan near 120 degrees, got ${angle.toFixed(2)}`);
    }
  }
});

test('browser layout clears sodium tetrazole C2 branch crossings in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const signature = await browserLayoutSignature(webkit, origin, BROWSER_SODIUM_TETRAZOLE_C2_CROSSING_SMILES, {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  });

  assert.equal(signature.audit.ok, true);
  assert.equal(signature.audit.severeOverlapCount, 0);
  assert.equal(signature.visibleHeavyBondCrossingCount, 0);
});

test('browser layout preserves acyl-hydrazine tertiary nitrogen geometry in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_ACYL_HYDRAZINE_TERTIARY_NITROGEN_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_ACYL_HYDRAZINE_TERTIARY_NITROGEN_SMILES, layoutOptions);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.ok(Array.isArray(signature.acylHydrazineN11Angles), `expected ${browserName} to report acyl-hydrazine tertiary nitrogen angles`);
    for (const angle of signature.acylHydrazineN11Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} acyl-hydrazine tertiary nitrogen angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.acylHydrazineC26Angles), `expected ${browserName} to report acyl-hydrazine C26 fan angles`);
    for (const angle of signature.acylHydrazineC26Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} acyl-hydrazine C26 fan angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(
      signature.acylHydrazineN17PhenoxyRingClearance >= 1.5 - 1e-6,
      `expected ${browserName} N17 label to keep bond-length clearance from the phenoxy ring, got ${signature.acylHydrazineN17PhenoxyRingClearance?.toFixed(3)}`
    );
  }
});

test('browser layout keeps crowded phenolic C49 ring exits exact after retouch cleanup', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_CROWDED_PHENOL_RING_EXIT_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_CROWDED_PHENOL_RING_EXIT_SMILES);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.ok(Array.isArray(signature.crowdedPhenolC49Spreads), `expected ${browserName} to report C49 spreads`);
    for (const spread of signature.crowdedPhenolC49Spreads) {
      assert.ok(Math.abs(spread - 120) < 1e-6, `expected ${browserName} C49 spread near 120 degrees, got ${spread.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.crowdedPhenolC52Spreads), `expected ${browserName} to report C52 spreads`);
    for (const spread of signature.crowdedPhenolC52Spreads) {
      assert.ok(Math.abs(spread - 120) < 1e-6, `expected ${browserName} C52 spread near 120 degrees, got ${spread.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.crowdedPhenolC31Angles), `expected ${browserName} to report C31 angles`);
    assert.ok(
      Math.min(...signature.crowdedPhenolC31Angles) >= 75 - 1e-6,
      `expected ${browserName} C31 fan to stay bounded, got ${signature.crowdedPhenolC31Angles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.max(...signature.crowdedPhenolC31Angles) <= 165 + 1e-6,
      `expected ${browserName} C31 fan not to over-open, got ${signature.crowdedPhenolC31Angles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.abs(signature.crowdedPhenolO15BridgeAngle - 180) <= 6 + 1e-6,
      `expected ${browserName} C14-O15 bridge hydroxyl to stay near straight, got ${signature.crowdedPhenolO15BridgeAngle?.toFixed(2)}`
    );
  }
});
