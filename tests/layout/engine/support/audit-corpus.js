/** @module tests/layout/engine/support/audit-corpus */

/**
 * Representative audit-regression corpus derived from `smilesDatabase`.
 * The expectations here should only move in the direction of improvement.
 * @type {ReadonlyArray<{
 *   bucket: 'stereo-only'|'stereo-touchup-overlap-tail'|'macrocycle-collapse'|'large-molecule-overlap-only'|'cleanup-overlap-bond'|'pre-cleanup-bond-only',
 *   name: string,
 *   sourceIndex: number,
 *   smiles: string,
 *   expected: {
 *     primaryFamily: string,
 *     maxSevereOverlapCount: number,
 *     maxBondLengthFailureCount: number,
 *     maxBondLengthDeviation: number,
 *     maxCollapsedMacrocycleCount: number,
 *     stereoContradiction: boolean,
 *     fallbackMode: string|null
 *   },
 *   relations?: {
 *     finalBondFailuresAtMostPlacement?: boolean,
 *     finalOverlapsAtMostPlacement?: boolean,
 *     finalCollapsedAtMostPlacement?: boolean,
 *     finalMaxDeviationAtMostPlacement?: boolean,
 *     placementStereoContradiction?: boolean
 *   }
 * }>}
 */
export const AUDIT_CORPUS = Object.freeze([
  {
    bucket: 'stereo-only',
    name: 'row-50-stereo-only-ez',
    sourceIndex: 50,
    smiles: 'O=C(N1CCOCC1)\\C(=C\\2/SC=C(N2c3ccccc3)c4ccccc4)\\C#N',
    expected: {
      primaryFamily: 'isolated-ring',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    },
    relations: {
      placementStereoContradiction: false
    }
  },
  {
    bucket: 'stereo-only',
    name: 'row-2484-stereo-only-implicit-h-center',
    sourceIndex: 2484,
    smiles: 'CC[C@]1(SC(=O)C=C1O)\\C=C/2\\C=C/CCCCC2',
    expected: {
      primaryFamily: 'isolated-ring',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'stereo-only',
    name: 'row-12414-stereo-only-unsupported-annotated-center',
    sourceIndex: 12414,
    smiles: '[H][C@@]1(O)CC(=O)[C@@]([H])(C\\C=C\\CCCC(O)=O)[C@]1([H])\\C=C\\C(=O)CCCCC',
    expected: {
      primaryFamily: 'isolated-ring',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'stereo-only',
    name: 'row-228-stereo-only-unsupported-ring-ez',
    sourceIndex: 228,
    smiles: 'COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'stereo-touchup-overlap-tail',
    name: 'row-259-fused-stereo-touchup-overlap-tail',
    sourceIndex: 259,
    smiles: 'COc1cc2N\\C(=C/c3c(C)c(C)cc(C)c3C)\\C(=O)c2c(OC)c1',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'stereo-touchup-overlap-tail',
    name: 'row-13247-fused-stereo-touchup-overlap-tail',
    sourceIndex: 13247,
    smiles: 'CN(C)S(=O)(=O)C1=CC=C2NC(=O)\\C(=C/C3=CC4=C(CCCC4)N3)C2=C1',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'stereo-touchup-overlap-tail',
    name: 'row-1948-fused-stereo-touchup-overlap-tail-residual',
    sourceIndex: 1948,
    smiles: 'COc1c(O)ccc2O\\C(=C/c3cccc(C)c3)\\c4c(ccc5NC(C)(C)C=C(C)c45)c12',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 3,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    }
  },
  {
    bucket: 'stereo-touchup-overlap-tail',
    name: 'row-2676-fused-stereo-touchup-overlap-tail-residual',
    sourceIndex: 2676,
    smiles: 'CC1=CC(C)(C)Nc2ccc3c4cc(F)ccc4O\\C(=C/c5ccncc5)\\c3c12',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 3,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    }
  },
  {
    bucket: 'macrocycle-collapse',
    name: 'row-3086-macrocycle-collapse-fixed',
    sourceIndex: 3086,
    smiles: 'CC(C)(C)[C@H]1COC(=O)[C@H](C\\C=C/C[C@@H](CC(=O)N[C@@H](CO)Cc2ccccc2)C(=O)N1)NC(=O)OCC3c4ccccc4c5ccccc35',
    expected: {
      primaryFamily: 'macrocycle',
      maxSevereOverlapCount: 1,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-5,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalCollapsedAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'large-molecule-overlap-only',
    name: 'row-21714-large-molecule-overlap-only',
    sourceIndex: 21714,
    smiles: 'O=C([C@H](CCCCNC([C@@H](NC([C@@H](NC([C@H](CCCCNC([C@H]1N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]2CCCN2C([C@@H](NC(C3=CC=C(O[C@H]4[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O4)C=C3)=O)CCCC[NH3+])=O)=O)NC([C@@H]5CCCN5C([C@@H](NC(C6=CC=C(O[C@H]7[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O7)C=C6)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC1)=O)NC([C@H]8N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]9CCCN9C([C@@H](NC(C%10=CC=C(O[C@@H]%11O[C@H](CO)[C@H](O)[C@H](O)[C@H]%11O)C=C%10)=O)CCCC[NH3+])=O)=O)NC([C@@H]%12CCCN%12C([C@@H](NC(C%13=CC=C(O[C@@H]%14O[C@H](CO)[C@H](O)[C@H](O)[C@H]%14O)C=C%13)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC8)=O)=O)CCCC[NH3+])=O)[C@@H](C)CC)=O)NC([C@@H](NC([C@@H](NC([C@H](CCCCNC([C@H]%15N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]%16CCCN%16C([C@@H](NC(C%17=CC=C(O[C@@H]%18O[C@H](CO)[C@H](O)[C@H](O)[C@H]%18O)C=C%17)=O)CCCC[NH3+])=O)=O)NC([C@@H]%19CCCN%19C([C@@H](NC(C%20=CC=C(O[C@@H]%21O[C@H](CO)[C@H](O)[C@H](O)[C@H]%21O)C=C%20)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC%15)=O)NC([C@H]%22N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]%23CCCN%23C([C@@H](NC(C%24=CC=C(O[C@H]%25[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O%25)C=C%24)=O)CCCC[NH3+])=O)=O)NC([C@@H]%26CCCN%26C([C@@H](NC(C%27=CC=C(O[C@H]%28[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O%28)C=C%27)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC%22)=O)=O)CCCC[NH3+])=O)[C@@H](C)CC)=O)N[C@@H](CC%29=CN=CN%29)C(N[C@@H]([C@H](CC)C)C(N)=O)=O',
    expected: {
      primaryFamily: 'large-molecule',
      maxSevereOverlapCount: 27,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'cleanup-overlap-bond',
    name: 'row-21728-cleanup-overlap-bond-organometallic',
    sourceIndex: 21728,
    smiles: '[C@@H]12N3C4=C([N]([Co+]567(N8C9=C(C%10=[N]5C([C@H]([C@]%10(C)CC(N)=O)CCC(N)=O)=CC5=[N]6C([C@H](C5(C)C)CCC(N)=O)=C(C5=[N]7[C@H]([C@@H]([C@@]5(C)CCC(=O)NCC(C)OP([O-])(=O)O[C@@H]([C@H]1O)[C@@H](CO)O2)CC(N)=O)[C@]8([C@@]([C@@H]9CCC(N)=O)(C)CC(N)=O)C)C)C)C)=C3)C=C(C(C)=C4)C',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 3,
      maxBondLengthFailureCount: 1,
      maxBondLengthDeviation: 0.9,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-9646-pre-cleanup-bond-only-polyoxo-cluster-improved',
    sourceIndex: 9646,
    smiles: '[O-][V](=O)[O+]([V](=O)O[V](=O)(=O)O[V](=O)(=O)[O+]([V]([O-])=O)[V](=O)(=O)=O)[V](=O)(=O)=O',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 2,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-11000-pre-cleanup-bond-only-organometallic-cluster-improved',
    sourceIndex: 11000,
    smiles: '[Ta]12([Ta]3([Br])[Ta]([Ta]([Br])([Br])[Ta]1([Br])([Br])[Ta]([Br])([Br])3([Br])[Br])([Br])[Br])([Br])[Br]2',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 9,
      maxBondLengthFailureCount: 2,
      maxBondLengthDeviation: 0.5,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-3299-pre-cleanup-bond-only-bridged',
    sourceIndex: 3299,
    smiles: 'CC[C@]1(O)C[C@H]2CN(CCc3c([nH]c4ccc(C)cc34)[C@@](C2)(C(=O)OC)c5cc6c(cc5OC)N(C=O)[C@H]7[C@](O)([C@H](OC(=O)C)[C@]8(CC)CC=CN9CC[C@]67[C@H]89)C(=O)OC)C1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 8,
      maxBondLengthFailureCount: 26,
      maxBondLengthDeviation: 3.25,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-790-pre-cleanup-bond-only-bridged-hybrid-fixed',
    sourceIndex: 790,
    smiles: 'OC(=O)[C@@]12CC3CC(C1)[C@H](Oc4ccc(cc4)C(=O)NCCNC(=O)c5ccc(cc5)c6ccccc6)C(C3)C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.35,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-4058-pre-cleanup-bond-only-fused-spiro-hybrid-fixed',
    sourceIndex: 4058,
    smiles: 'COC(=O)c1cc2c([nH]1)C(=O)C=C3N(C[C@H]4C[C@@]234)C(=O)c5cc6c([nH]5)C(=O)C=C7N(C[C@H]8C[C@@]678)C(=O)OC(C)(C)C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-7418-pre-cleanup-bond-only-fused-spiro-hybrid-residual',
    sourceIndex: 7418,
    smiles: '[H][C@@]12C[C@@]3([H])[C@]4([H])CCC5=CC(=O)C=C[C@]5(C)[C@@]4(F)[C@@H](O)C[C@]3(C)[C@@]1(OC1(CCCC1)O2)C(=O)COC(C)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 3,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-16513-pre-cleanup-bond-only-bridged-fused-hybrid-improved',
    sourceIndex: 16513,
    smiles: 'CC12CC1CC1=CC(CCC(C)(C)C2)=CS1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 5,
      maxBondLengthDeviation: 0.3,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-9817-pre-cleanup-bond-only-bridged-fused-hybrid-residual',
    sourceIndex: 9817,
    smiles: 'CC[C@@]1(O)C[C@@H]2C[N@@](C1)CCc1c(nc3ccccc13)[C@@](C2)(C(=O)OC)C1=CC2=C(C=C1OC)N(C)[C@H]1[C@]3(C[C@@]4(CC)C=CCN5CC[C@@]21[C@@H]45)OC(=O)N(CCCl)C3=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 9,
      maxBondLengthFailureCount: 7,
      maxBondLengthDeviation: 0.76,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-21740-pre-cleanup-bond-only-large-fused-cage-improved',
    sourceIndex: 21740,
    smiles: 'C12C3C4C5C1C6C7C2C8C3C9C4C1C5C6C2C7C8C9C12',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 2,
      maxBondLengthFailureCount: 3,
      maxBondLengthDeviation: 0.85,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-21753-pre-cleanup-bond-only-giant-fused-cage-residual',
    sourceIndex: 21753,
    smiles: 'C12=C3C4=C5C6=C1C7=C8C9=C1C%10=C%11C(=C29)C3=C2C3=C4C4=C5C5=C9C6=C7C6=C7C8=C1C1=C8C%10=C%10C%11=C2C2=C3C3=C4C4=C5C5=C%11C%12=C(C6=C95)C7=C1C1=C%12C5=C%11C4=C3C3=C5C(=C81)C%10=C23',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 2,
      maxBondLengthFailureCount: 15,
      maxBondLengthDeviation: 0.75,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: true
    }
  }
]);
