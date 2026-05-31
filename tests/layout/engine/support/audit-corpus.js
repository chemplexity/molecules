/** @module tests/layout/engine/support/audit-corpus */

/**
 * Representative audit-regression corpus derived from `smilesDatabase`.
 * The expectations here should only move in the direction of improvement.
 * @type {ReadonlyArray<{
 *   bucket: 'stereo-only'|'stereo-touchup-overlap-tail'|'macrocycle-collapse'|'large-molecule-overlap-only'|'cleanup-overlap-bond'|'pre-cleanup-bond-only'|'pre-cleanup-bond-overlap'|'pre-cleanup-overlap-only',
 *   name: string,
 *   sourceIndex: number,
 *   smiles: string,
 *   expected: {
 *     primaryFamily: string,
 *     maxSevereOverlapCount: number,
 *     maxBondLengthFailureCount: number,
 *     maxBondLengthDeviation: number,
 *     maxLabelOverlapCount?: number,
 *     maxRingSubstituentReadabilityFailureCount?: number,
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
      maxBondLengthDeviation: 0.075,
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
    name: 'row-2676-fused-stereo-touchup-overlap-tail-residual',
    sourceIndex: 2676,
    smiles: 'CC1=CC(C)(C)Nc2ccc3c4cc(F)ccc4O\\C(=C/c5ccncc5)\\c3c12',
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
    smiles:
      'O=C([C@H](CCCCNC([C@@H](NC([C@@H](NC([C@H](CCCCNC([C@H]1N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]2CCCN2C([C@@H](NC(C3=CC=C(O[C@H]4[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O4)C=C3)=O)CCCC[NH3+])=O)=O)NC([C@@H]5CCCN5C([C@@H](NC(C6=CC=C(O[C@H]7[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O7)C=C6)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC1)=O)NC([C@H]8N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]9CCCN9C([C@@H](NC(C%10=CC=C(O[C@@H]%11O[C@H](CO)[C@H](O)[C@H](O)[C@H]%11O)C=C%10)=O)CCCC[NH3+])=O)=O)NC([C@@H]%12CCCN%12C([C@@H](NC(C%13=CC=C(O[C@@H]%14O[C@H](CO)[C@H](O)[C@H](O)[C@H]%14O)C=C%13)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC8)=O)=O)CCCC[NH3+])=O)[C@@H](C)CC)=O)NC([C@@H](NC([C@@H](NC([C@H](CCCCNC([C@H]%15N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]%16CCCN%16C([C@@H](NC(C%17=CC=C(O[C@@H]%18O[C@H](CO)[C@H](O)[C@H](O)[C@H]%18O)C=C%17)=O)CCCC[NH3+])=O)=O)NC([C@@H]%19CCCN%19C([C@@H](NC(C%20=CC=C(O[C@@H]%21O[C@H](CO)[C@H](O)[C@H](O)[C@H]%21O)C=C%20)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC%15)=O)NC([C@H]%22N(C([C@@H](NC(CSC[C@H](NC([C@H]([C@@H](C)CC)NC([C@H](CCCCNC([C@@H]%23CCCN%23C([C@@H](NC(C%24=CC=C(O[C@H]%25[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O%25)C=C%24)=O)CCCC[NH3+])=O)=O)NC([C@@H]%26CCCN%26C([C@@H](NC(C%27=CC=C(O[C@H]%28[C@H](O)[C@@H](O)[C@@H](O)[C@@H](CO)O%28)C=C%27)=O)CCCC[NH3+])=O)=O)=O)=O)C(N)=O)=O)CCCC[NH3+])=O)CCC%22)=O)=O)CCCC[NH3+])=O)[C@@H](C)CC)=O)N[C@@H](CC%29=CN=CN%29)C(N[C@@H]([C@H](CC)C)C(N)=O)=O',
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
    smiles:
      '[C@@H]12N3C4=C([N]([Co+]567(N8C9=C(C%10=[N]5C([C@H]([C@]%10(C)CC(N)=O)CCC(N)=O)=CC5=[N]6C([C@H](C5(C)C)CCC(N)=O)=C(C5=[N]7[C@H]([C@@H]([C@@]5(C)CCC(=O)NCC(C)OP([O-])(=O)O[C@@H]([C@H]1O)[C@@H](CO)O2)CC(N)=O)[C@]8([C@@]([C@@H]9CCC(N)=O)(C)CC(N)=O)C)C)C)C)=C3)C=C(C(C)=C4)C',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 6,
      maxBondLengthFailureCount: 2,
      maxBondLengthDeviation: 3.46,
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
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0,
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
    name: 'row-21740-pre-cleanup-bond-only-large-fused-cage-improved',
    sourceIndex: 21740,
    smiles: 'C12C3C4C5C1C6C7C2C8C3C9C4C1C5C6C2C7C8C9C12',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 5,
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
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-21745-pre-cleanup-bond-overlap-substituted-giant-fused-cage',
    sourceIndex: 21745,
    smiles: 'O=C(OCC)C1(C(OCC)=O)C2(C3=C4C5=C6C7=C8C9=C%10C%11=C%12C%13=C%14C%15=C%16C%17=C%18C%19=C%20C%21=C4C%22=C5C%23=C7C%24=C9C%25=C%26C%27=C(C%14=C%17C%28=C%27C%29=C%26C%24=C%23C%30=C%29C(C%20=C%22%30)=C%18%28)C%13=C%10%25)C%21=C%19C%16=C%31C%15=C%12C%32=C%11C8=C6C3=C%32C2%311',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
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
    name: 'row-10880-pre-cleanup-bond-only-cyclic-glycan-macrocycle',
    sourceIndex: 10880,
    smiles: 'OC[C@H]1O[C@H]2O[C@@H]3[C@H](CO)O[C@H](O[C@@H]4[C@H](CO)O[C@@H](O[C@@H]5[C@H](CO)O[C@@H](O[C@@H]6[C@H](CO)O[C@@H](O[C@@H]7[C@H](CO)O[C@@H](O[C@@H]8[C@H](CO)O[C@@H](O[C@H]1[C@H](O)[C@H]2O)[C@H](O)[C@H]8O)[C@H](O)[C@H]7O)[C@H](O)[C@H]6O)[C@H](O)[C@H]5O)[C@H](O)[C@H]4O)[C@H](O)[C@H]3O',
    expected: {
      primaryFamily: 'macrocycle',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.1,
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-27435-pre-cleanup-bond-overlap-compact-fused-cage-peripheral-path',
    sourceIndex: 27435,
    smiles: 'CCC12C3C4C5OCC(N)(C1CNC25)C34C',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.45,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-23438-pre-cleanup-bond-overlap-compact-aza-bridge-bend',
    sourceIndex: 23438,
    smiles: 'CCN1CC23C=CC4OC(C)CN2C34C1=N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
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
    name: 'row-21443-pre-cleanup-bond-only-compact-saturated-bridged-spiro-lane',
    sourceIndex: 21443,
    smiles: 'CC1C[NH+]2CCC11CCC(C1)C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
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
    name: 'row-17046-pre-cleanup-bond-only-compact-bridged-projection-regression',
    sourceIndex: 17046,
    smiles: 'CC12CCCC(CC11C[NH2+]C1)OCCO2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.5,
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
    name: 'row-15124-pre-cleanup-bond-only-compact-cyclopropane-bridged-spiro-lane',
    sourceIndex: 15124,
    smiles: 'CC(C)C1CC2(C[NH3+])CCCC1C21CC1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.25,
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-4652-pre-cleanup-bond-overlap-aromatic-fused-bridged-lane',
    sourceIndex: 4652,
    smiles: 'CC(=CCc1c(O)cc(O)c2C(=O)C3=C[C@@H]4[C@H](CN5CCCCC5)[C@H]6COC(CC=C(C)C)(C4=O)[C@@]36Oc12)C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-2872-pre-cleanup-overlap-only-aromatic-fused-bridged-lane',
    sourceIndex: 2872,
    smiles: 'CC(=CCc1c(O)cc(O)c2C(=O)C3=C[C@@H]4C[C@H]5C(C)(C)OC(CC=C(C)C)(C4=O)[C@@]35Oc12)C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-9174-pre-cleanup-overlap-only-organometallic-chelate-ring',
    sourceIndex: 9174,
    smiles: 'CCC1=C(C)C2=[N+]3C1=CC1=C(C)C(C=C)=C4C=C5C(C)=C(CCC(O)=O)C6=[N+]5[Fe@@]3(N3C(=C2)C(C)=C(CCC(O)=O)C3=C6)N14',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.35,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-9547-pre-cleanup-overlap-only-organometallic-chelate-ring',
    sourceIndex: 9547,
    smiles: 'CC1=C(CCC(O)=O)C2=CC3=[N+]4C(=CC5=C(C=C)C(C)=C6C=C7C(C=C)=C(C)C8=[N+]7[Fe@]4(N2C1=C8)N56)C(C)=C3CCC(O)=O',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.35,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-10334-pre-cleanup-overlap-only-organometallic-chelate-ring',
    sourceIndex: 10334,
    smiles: 'CC(=O)C1=C2C=C3C(C)=C(CCC(O)=O)C4=[N+]3[Fe@@]35N6C(=CC7=[N+]3C(=CC(N25)=C1C)C(C(O)=C)=C7C)C(C)=C(CCC(O)=O)C6=C4',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.35,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-10821-pre-cleanup-overlap-only-zinc-porphyrin-chelate-ring',
    sourceIndex: 10821,
    smiles: 'CC1=C(CCC(O)=O)C2=CC3=[N+]4C(=CC5=C(C=C)C(C)=C6C=C7C(C=C)=C(C)C8=[N+]7[Zn@]4(N2C1=C8)N56)C(C)=C3CCC(O)=O',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.34,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-9180-pre-cleanup-overlap-readability-organometallic-chelate-ring',
    sourceIndex: 9180,
    smiles: 'CCC1=C(C)C2=CC3=C(CC)C(C)=C4C=C5C(C)=C(CCC(O)=O)C6=[N+]5[Cu@@]5(N7C(=CC1=[N+]25)C(C)=C(CCC(O)=O)C7=C6)[N@+]34C',
    expected: {
      primaryFamily: 'organometallic',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.58,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-26449-pre-cleanup-bond-overlap-current-bridged-projection-clean',
    sourceIndex: 26449,
    smiles: 'CCC12CC3(CC3)C(CC=C1)C1CC2CO1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.36,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-26633-pre-cleanup-bond-only-saturated-double-bridged-lanes',
    sourceIndex: 26633,
    smiles: 'CC1OC2CC(C1N)C1CC(N)CC2C(=N)N1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-20428-pre-cleanup-bond-only-compact-four-five-bridged-path',
    sourceIndex: 20428,
    smiles: 'C[NH2+]C1(C)C2CCC1C2(O)C([O-])=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.53,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-26824-pre-cleanup-bond-only-compact-sulfone-aza-cyclopropane-cage',
    sourceIndex: 26824,
    smiles: 'CC1CC23NS(=O)(=O)CC2(CO1)NC1CC31C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-667-pre-cleanup-bond-only-compact-shared-path-spiro-cage',
    sourceIndex: 667,
    smiles: 'CNCCNC(=O)[C@@H]1[C@H]2C=C[C@@H]([C@H]1C(=O)NCc3ccc(Br)cc3)C24CC4',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-10351-pre-cleanup-bond-only-group13-chelate-macrocycle',
    sourceIndex: 10351,
    smiles: 'CC1=[O][Ga]2345ON1CCC[C@H]1NC(=O)CNC(=O)[C@H](CO)NC(=O)CNC(=O)[C@H](CCCN(O2)C(C)=[O]3)NC(=O)C(CCCN(O4)C(C)=[O]5)NC1=O',
    expected: {
      primaryFamily: 'macrocycle',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-17154-pre-cleanup-bond-only-single-spiro-shared-path-cage',
    sourceIndex: 17154,
    smiles: 'CCC1(CC)C2CC3(CC3)C1C[NH+]2C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.3,
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
    name: 'row-18141-pre-cleanup-bond-only-long-theta-shared-path-cage',
    sourceIndex: 18141,
    smiles: 'CC(C)C12CCC(CCC[NH2+]C1)C(C)CC2O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.15,
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-25186-pre-cleanup-bond-overlap-double-shared-path-cage',
    sourceIndex: 25186,
    smiles: 'CC(=O)C12CNC(CN1)C1CN=CNC(C1)C2',
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-27577-pre-cleanup-bond-overlap-aromatic-capped-fused-square-bridge',
    sourceIndex: 27577,
    smiles: 'C1CC2C1C1CCNC2C2=C1N=CO2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.25,
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
    name: 'row-23388-pre-cleanup-bond-only-amino-ether-long-theta-cage',
    sourceIndex: 23388,
    smiles: 'CCCCC1(N)CNC2CN(C)C1COCC2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.15,
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
    name: 'row-18936-pre-cleanup-bond-only-compact-aminated-bridged-cage',
    sourceIndex: 18936,
    smiles: 'CC1=NC(=NO1)C1(N)C2CCC1[NH2+]2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-20703-pre-cleanup-bond-overlap-compact-ether-lactam-cage',
    sourceIndex: 20703,
    smiles: 'CC(CC(N)=O)C1C2COC1C2=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.5,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-21565-pre-cleanup-bond-only-compact-imino-nitrile-cage',
    sourceIndex: 21565,
    smiles: 'CC1C2OCC1(C2C#N)C(N)=[NH2+]',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-22090-pre-cleanup-bond-overlap-compact-amide-azabicycle',
    sourceIndex: 22090,
    smiles: 'CC(C(CO)N(C)C=O)N1C2CCC1C2=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.5,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-25476-pre-cleanup-bond-overlap-compact-amino-lactone-cage',
    sourceIndex: 25476,
    smiles: 'CCC1NC2CC1C2(C)OC(=O)C(O)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.3,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-27970-pre-cleanup-bond-overlap-compact-dicarbonyl-nitrile-cage',
    sourceIndex: 27970,
    smiles: 'CC12CNCC(C(=O)CO1)C(=O)NC(C2)C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-18635-pre-cleanup-bond-only-bridged-ether-cage',
    sourceIndex: 18635,
    smiles: 'CC1COC11CC2CCCC1CCOC2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-18939-pre-cleanup-bond-overlap-aminotriazine-bridged-cage',
    sourceIndex: 18939,
    smiles: 'CN1C=C(NC2C3CCC2[NH2+]3)C=N1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-22550-pre-cleanup-bond-overlap-diamino-ether-cage',
    sourceIndex: 22550,
    smiles: 'CC1(CN)COC2(CN)CNC(=N)C1C(N)C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-26701-pre-cleanup-bond-only-furan-bridged-alcohol',
    sourceIndex: 26701,
    smiles: 'CC1=C(OC2C3CC2C(CO)C3)OC=C1O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-15763-pre-cleanup-bond-only-azetidine-sulfone-cage',
    sourceIndex: 15763,
    smiles: 'CC[NH2+]C1C2CC1S(=O)(=O)N2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-24615-pre-cleanup-bond-only-oxime-enyne-cage',
    sourceIndex: 24615,
    smiles: 'CC(=NO)C12CC(N1)(C=O)C=C2C#CC#C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-25366-pre-cleanup-bond-only-oxime-thiazole-cage',
    sourceIndex: 25366,
    smiles: 'CC12CC(C1)(OC2=N)C#CC1=CSC(O)=N1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-25379-pre-cleanup-bond-only-imino-ether-cage',
    sourceIndex: 25379,
    smiles: 'CN1CC2(CC1(CO)C2)OCC(=N)NC=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-27548-pre-cleanup-bond-only-isoxazole-lactone-cage',
    sourceIndex: 27548,
    smiles: 'CC1C(=O)C2(CC1(O2)C1=NC=NO1)C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-27651-pre-cleanup-bond-only-alkynyl-azabicycle',
    sourceIndex: 27651,
    smiles: 'CC(N)C(CO)C12CC(CC1C)(C#C)N2C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-28753-pre-cleanup-bond-only-aminonitrile-cage',
    sourceIndex: 28753,
    smiles: 'CCNC12CC(NC1)(C#CC)C2C(N)C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-17428-pre-cleanup-bond-only-ammonium-bicyclic-alcohol',
    sourceIndex: 17428,
    smiles: 'CCC12CC(CO)([NH2+]1)C(C)C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-27391-pre-cleanup-bond-only-alkenyl-azabicycle',
    sourceIndex: 27391,
    smiles: 'CC(C)CC(O)C1C2CC1(C=C2)N(C)C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-1863-pre-cleanup-bond-only-disconnected-bridged-amide',
    sourceIndex: 1863,
    smiles: 'Cc1ccc(CCNC(=O)[C@@H]2[C@@H]3C=C[C@H]([C@H]2C(=O)NCCCCN4CCCC4)C35CC5)cc1.OC=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-18615-pre-cleanup-bond-only-tertiary-amino-lactam-cage',
    sourceIndex: 18615,
    smiles: 'C[NH2+]C1(C)C2OCC1(N(C)C(C)C)C2=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-27894-pre-cleanup-bond-overlap-alkenyl-oxime-azabicycle',
    sourceIndex: 27894,
    smiles: 'CC(OC1CC2N(C)C1C2=NO)C=C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-15978-pre-cleanup-bond-overlap-pyridyl-imino-azabicycle',
    sourceIndex: 15978,
    smiles: 'CN1C=CC(OC2C3CCC2N3C=[NH2+])=C1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-17305-pre-cleanup-bond-overlap-carboxylate-azabicycle',
    sourceIndex: 17305,
    smiles: '[NH3+]C1C2CCC1N2C(=O)C([O-])=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-22178-pre-cleanup-bond-overlap-sulfone-dicarbonyl-cage',
    sourceIndex: 22178,
    smiles: 'CC12N(C=O)C(CC1=O)(C2=O)S(=O)(=O)C(O)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-20218-pre-cleanup-bond-overlap-polyether-decalin-cage',
    sourceIndex: 20218,
    smiles: 'CC1C(O)CC2(CCCO)CCC1CCOC2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-22546-pre-cleanup-bond-only-di-oxime-alkynyl-cage',
    sourceIndex: 22546,
    smiles: 'CC12CC(CC#C)(C1=NO)C(CO)(O2)C=NO',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-26059-pre-cleanup-bond-only-imino-azabicycle',
    sourceIndex: 26059,
    smiles: 'CC(C)C(=N)OCCC12CC(N1)C(C)(C)C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-28737-pre-cleanup-bond-only-imino-ether-cage',
    sourceIndex: 28737,
    smiles: 'CCOCC12CC(C1N(C)C=N)C(=N)N2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-28027-pre-cleanup-bond-only-oxa-imino-bridged-cage',
    sourceIndex: 28027,
    smiles: 'C1NCC2OC1OC1=C2OC2=C1OC=N2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.47,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-30236-pre-cleanup-bond-only-steroid-like-bridged-nitrile',
    sourceIndex: 30236,
    smiles: 'CC1(C)CCC23CCC4(C)C(OC2CO)(C3C1)C(=O)CC1C4(C)CCC2C(C)(C)C(=O)C(=CC12C)[N+]#C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.56,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-23280-pre-cleanup-bond-only-compact-bridged-diaza-cage',
    sourceIndex: 23280,
    smiles: 'C1C2C34CC1C1(C3)C3NC=NC24C13',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.5,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-24227-pre-cleanup-bond-only-compact-sulfone-imidazoline-cage',
    sourceIndex: 24227,
    smiles: 'CC1CN(CC2CC(OCS(=O)(=O)N2)=N1)C=N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-8513-pre-cleanup-bond-only-bridged-morphinan-acetate-tail',
    sourceIndex: 8513,
    smiles: '[H][C@@]12OC3=C(OC(C)=O)C=CC4=C3[C@@]11CCN(C)[C@]([H])(C4)[C@@]11C[C@]([H])([C@](C)(O)CCC)[C@]2(OC)C=C1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.53,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-8522-pre-cleanup-bond-only-bridged-morphinan-cyclopropyl-tail',
    sourceIndex: 8522,
    smiles: '[H][C@@]12OC3=C(O)C=CC4=C3[C@@]11CCN(CC3CC3)[C@]([H])(C4)[C@@]11C[C@]([H])(C(C)(C)O)[C@]2(OC)C=C1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.53,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-31902-pre-cleanup-bond-only-bridged-bis-ether-terpene',
    sourceIndex: 31902,
    smiles: 'CC1CCC2C(CSCC3=C(OC4OC5(C)CCC6C(C)CCC3C46OO5)C(F)(F)F)=C(OC3OC4(C)CCC1C23CO4)C(F)(F)F',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.53,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-32719-pre-cleanup-bond-only-bridged-morphinan-phenol',
    sourceIndex: 32719,
    smiles: 'COC12CCC3(CC1CC(C)(C)O)C1CC4=CC=C(O)C5=C4C3(CC[NH+]1CC1CC1)C2O5',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.58,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-9405-pre-cleanup-bond-only-bridged-sulfated-glycoside',
    sourceIndex: 9405,
    smiles: 'CC(C)CC(=O)O[C@H]1[C@@H](O[C@@H]2C[C@]3(C)[C@H]4CC[C@@H]5C[C@@]4(CC[C@H]3C(C2)(C(O)=O)C(O)=O)[C@@H](O)C5=C)O[C@@H](COO)[C@H](OS(O)(=O)=O)[C@@H]1OS(O)(=O)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.56,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-8795-pre-cleanup-bond-only-bridged-macrolide-glycoside',
    sourceIndex: 8795,
    smiles: 'COC[C@@H]1CC[C@@H]2[C@@H](C)[C@H](O)[C@@H](O[C@H]3O[C@@H](COC(C)(C)C=C)[C@H](O)[C@@H](OC(C)=O)[C@@H]3O)C3=C(C[C@@H](O)[C@]3(C)\\C=C1/2)[C@H](C)COC(C)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-20629-pre-cleanup-bond-overlap-imino-ether-spiro-cage',
    sourceIndex: 20629,
    smiles: 'N=CNC(=O)C1CC2CC11CC1O2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-22726-pre-cleanup-bond-only-cyclic-amidine-ether',
    sourceIndex: 22726,
    smiles: 'CC1N=C(N)CC2COC(C)CNC1CN2C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-26481-pre-cleanup-bond-overlap-fused-hydroxy-alkene',
    sourceIndex: 26481,
    smiles: 'CC1=CC2CCCC(C1)C1C(O)CC=C21',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-2911-pre-cleanup-bond-overlap-steroidal-imide-ester',
    sourceIndex: 2911,
    smiles: 'CC(C)C1=CC2CC3(C=O)C4CC[C@@H](C)C4CC2(CCOC(=O)[C@@H]5CCC(=O)N5)C13C(=O)O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-24167-pre-cleanup-bond-only-acetamide-nitrile-cage',
    sourceIndex: 24167,
    smiles: 'CC1CC2C(C)CN(C1)C(CN2C(C)=O)C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-28900-pre-cleanup-bond-only-amidine-ether-cage',
    sourceIndex: 28900,
    smiles: 'CCOCC1(C)CC2N=C(N)C(COC2C)N1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-24185-pre-cleanup-bond-only-alkynyl-decalin-cage',
    sourceIndex: 24185,
    smiles: 'CC1(C)CC2CC(C#C)C(C1)CCCC2C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-4098-pre-cleanup-bond-only-coumarin-nitrile-bicycle',
    sourceIndex: 4098,
    smiles: 'COC(=O)C1=CC2C(CC1OC2=O)C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-11732-pre-cleanup-overlap-only-glycopeptide-macrocycle',
    sourceIndex: 11732,
    smiles: '[H][C@]12NC(=O)[C@]([H])(NC(=O)[C@]3([H])NC(=O)[C@H](CC(N)=O)NC(=O)[C@H](NC(=O)[C@@H](CC(C)C)NC)[C@H](O)C4=CC(Cl)=C(OC5=C(O[C@@H]6O[C@H](CO)[C@@H](O)[C@H](O)[C@H]6O[C@H]6C[C@](C)(NCC7=CC=C(C=C7)C7=CC=C(Cl)C=C7)[C@@H](O)[C@H](C)O6)C(OC6=C(Cl)C=C(C=C6)[C@H]1O[C@H]1C[C@](C)(N)[C@@H](O)[C@H](C)O1)=CC3=C5)C=C4)C1=CC(=C(O)C=C1)C1=C(C=C(O)C=C1O)[C@H](NC2=O)C(O)=O',
    expected: {
      primaryFamily: 'macrocycle',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-24291-pre-cleanup-overlap-only-hydroxy-pyran-pyridone',
    sourceIndex: 24291,
    smiles: 'CC1OC2C(O)C(O)C1C1=C2N=CC(=O)O1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-25235-pre-cleanup-overlap-only-alkynyl-azabicycle',
    sourceIndex: 25235,
    smiles: 'CN1CC23CCC(C#C)C12C(C)(C)C(O)C3',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-25418-pre-cleanup-overlap-only-imino-azabicycle',
    sourceIndex: 25418,
    smiles: 'CN1CCC2(C)CN(C)C(=N)C1C21CO1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-15417-pre-cleanup-overlap-only-cationic-bridged-cage',
    sourceIndex: 15417,
    smiles: 'CC1C[NH+]2CC3(C)CC(C3)(C1)C2C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-28570-pre-cleanup-overlap-only-imino-bridged-lactam',
    sourceIndex: 28570,
    smiles: 'CC1CC=CC23C4NC=NC2CNC34C1=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-17250-pre-cleanup-overlap-only-sulfone-azabicycle',
    sourceIndex: 17250,
    smiles: 'CC1CC2NCC1([NH3+])CN(C)S2(=O)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-20730-pre-cleanup-overlap-only-thienolactam-bridged-cage',
    sourceIndex: 20730,
    smiles: 'CNC1=CSC(=O)C2=C1CC1C(C)C2C1=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-36038-pre-cleanup-overlap-only-acetoxy-bridged-aryl-cage',
    sourceIndex: 36038,
    smiles: 'COC1=CC=CC=C1CCC(=O)OC1C=CC2C3CC4=CC=C(OC(C)=O)C5=C4C2(CC[NH+]3C)C1O5',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-21937-pre-cleanup-overlap-only-ethyl-aza-ether-cage',
    sourceIndex: 21937,
    smiles: 'CCN1C2CC(CC2(C)CCOC)NCC1=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-25286-pre-cleanup-overlap-only-attached-heteroaryl-root',
    sourceIndex: 25286,
    smiles: 'CC1CCN2CCNC1C2C1=CN(C)C(C)=N1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-30979-pre-cleanup-overlap-only-phosphazene-pyrrolidine-fan',
    sourceIndex: 30979,
    smiles: 'CC(C)(C)N[PH+](N1CCCC1)N(=P(N1CCCC1)(N1CCCC1)N1CCCC1)=P(N1CCCC1)(N1CCCC1)N1CCCC1',
    expected: {
      primaryFamily: 'isolated-ring',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-1409-pre-cleanup-overlap-only-large-peptide-fan',
    sourceIndex: 1409,
    smiles: 'CCCCCCCCC(C)C(=O)N1CCCC1C(=O)N2C(CC(=O)CC)CC(C)CC2C(=O)NC(C)C(=O)NC(C)(C)C(=O)NC(C)(C)C(=O)NC(C(C)CC)C(=O)NC(C)C(=O)NC(C)(C)C(=O)NC(C)(C)C(=O)NC(C)CN(C)CCO',
    expected: {
      primaryFamily: 'large-molecule',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-33406-pre-cleanup-overlap-only-fused-polyaryl-triazine',
    sourceIndex: 33406,
    smiles: 'C1C=CC=C2C1C=CC1=C2C2=C(N1C1=CC=CC=C1)C1=C(C=C2)C2=CC=CC=C2N1C1=NC(=NC(=N1)C1=CC=CC=C1)C1=CC=CC=C1',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-5468-pre-cleanup-overlap-only-nucleotide-linker',
    sourceIndex: 5468,
    smiles: 'CN(CCCC(=O)NCCCCn1nnc2C(CCCCCc12)OCCNC(=O)CCCN(C)C[C@H]3O[C@H]([C@H](O)[C@@H]3O)n4cnc5c(N)ncnc45)C[C@H]6O[C@H]([C@H](O)[C@@H]6O)n7cnc8c(N)ncnc78',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-23988-pre-cleanup-overlap-only-amino-pyran-bridged-aldehyde',
    sourceIndex: 23988,
    smiles: 'CCC1OC2C(CC(O)C=O)C(O1)C2NC',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-11358-pre-cleanup-overlap-only-large-glycan-branch',
    sourceIndex: 11358,
    smiles: 'CC(=O)N[C@H]1CO[C@H](CO)[C@@H](O[C@H]2O[C@@H](CO)[C@@H](O[C@H]3O[C@@H](CO[C@H]4O[C@@H](CO)[C@H](O)[C@@H](O[C@H]5O[C@@H](CO)[C@H](O)[C@@H](O)[C@@H]5O)[C@@H]4O)[C@H](O)[C@H](O[C@H]4O[C@@H](CO)[C@H](O)[C@@H](O)[C@H]4O[C@H]4O[C@@H](CO)[C@H](O)[C@@H](O)[C@H]4O[C@H]4O[C@@H](CO)[C@H](O)[C@@H](O)[C@@H]4O)[C@@H]3O)[C@@H](O)[C@@H]2NC(C)=O)[C@@H]1O',
    expected: {
      primaryFamily: 'large-molecule',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-19549-pre-cleanup-overlap-only-ammonium-oxa-bridged-lactam',
    sourceIndex: 19549,
    smiles: 'C[NH2+]C1C2CC(=O)C(CNC(C)=O)C1(C)O2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-20884-pre-cleanup-overlap-only-ethyl-ammonium-decalin-cage',
    sourceIndex: 20884,
    smiles: 'CCC1C2CCCC1C1(CC1)C[NH+]2CC',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-8613-pre-cleanup-overlap-only-fused-chloro-lactam-aryl',
    sourceIndex: 8613,
    smiles: 'CN1C2=C(C=C(Cl)C=C2)C2(OC(C)=CC(=O)N2CC1=O)C1=CC=CC=C1',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-35238-pre-cleanup-overlap-only-fused-thiophene-decalin-amine',
    sourceIndex: 35238,
    smiles: 'C[NH2+]CC1=C(C2CCC1CC2)C1=C2SC=C(C)C2=CC=C1',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-4175-pre-cleanup-overlap-only-large-arginine-peptide',
    sourceIndex: 4175,
    smiles: 'C[C@@H](O)[C@H](N)C(=O)N1CCC[C@H]1C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCC(=O)O)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](CCCNC(=N)N)C(=O)N[C@@H](C)C(=O)N[C@@H](C)C(=O)N[C@@H](CCCNC(=N)N)C(=O)O',
    expected: {
      primaryFamily: 'large-molecule',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-readability',
    name: 'row-27983-pre-cleanup-overlap-readability-amino-azabicycle-alkyne',
    sourceIndex: 27983,
    smiles: 'CC1C2(C)CC(CN)C(N)(CN2)C1(N)CC#C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-readability',
    name: 'row-3003-pre-cleanup-overlap-readability-diaryl-hydroxy-amide',
    sourceIndex: 3003,
    smiles: 'Cc1cccc(C(=O)N[C@@H](Cc2ccccc2)[C@@H](O)[C@@H](O)[C@H](Cc3ccccc3)NC(=O)c4cccc(C)c4NC(=O)OCc5ccccc5)c1NC(=O)OCc6ccccc6',
    expected: {
      primaryFamily: 'isolated-ring',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-20224-pre-cleanup-bond-only-triapex-aminoketone-cage',
    sourceIndex: 20224,
    smiles: 'CCN1C2C3CC(=O)CC2C13',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.45,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-22300-pre-cleanup-bond-only-bridged-oxime-oxaaza-cage',
    sourceIndex: 22300,
    smiles: 'CC1CC23C(C)C(=NO)C4CN1C21COCC341',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-8316-pre-cleanup-bond-only-macrocycle-bond-cleared-residual-readability',
    sourceIndex: 8316,
    smiles:
      'CO[C@H]1\\C=C\\O[C@@]2(C)OC3=C(C2=O)C2=C(C(O)=C3C)C(O)=C(NC(=O)\\C(C)=C/C=C/[C@H](C)[C@H](O)[C@@H](C)[C@@H](O)[C@@H](C)[C@H](OC(C)=O)[C@@H]1C)C(\\C=N\\N1CCN(CC1)C1CCCC1)=C2O',
    expected: {
      primaryFamily: 'macrocycle',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.43,
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
    name: 'row-6991-pre-cleanup-bond-only-bridged-polycycle-bond-cleared-residual-overlap',
    sourceIndex: 6991,
    smiles: 'CC1(C)CCC[C@]2(C)[C@@H]1C[C@@H](O)[C@@]34[C@H](O)[C@@H]([C@@H](O)C[C@@H]23)C(=C)C4=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 1,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.42,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: false
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-28033-pre-cleanup-bond-only-imino-diaza-cage-bond-cleared-residual-overlap',
    sourceIndex: 28033,
    smiles: 'CC1CC2=C3CC4CN1C2C12NC=NC31C42',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 1,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.51,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: true,
      finalMaxDeviationAtMostPlacement: false
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-24460-pre-cleanup-bond-only-diaza-oxa-cage-bond-cleared-residual-overlap',
    sourceIndex: 24460,
    smiles: 'CC1COC23C4CNC12CCC3(C)CN4',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 2,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.22,
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
    name: 'row-1341-pre-cleanup-bond-only-diterpene-cage-bond-cleared-residual-readability',
    sourceIndex: 1341,
    smiles: 'CCC(=O)O[C@@H]1C(=C)[C@H]2C[C@@H]3C4N5C[C@]6(C)CCC[C@]47[C@H]([C@H]2O)[C@]13C[C@]5(O)[C@H]67',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 1,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.58,
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
    name: 'row-12016-pre-cleanup-bond-only-bridged-lactone-bond-cleared-residual-overlap',
    sourceIndex: 12016,
    smiles: 'C[C@@H]1C(=O)O[C@H]2[C@H](O)[C@@]34[C@H]5C[C@@H](C(C)(C)C)[C@@]33[C@@H](O)C(=O)O[C@H]3O[C@@]4(C(=O)O5)[C@@]12O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 2,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.56,
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
    name: 'row-27074-pre-cleanup-bond-only-thiazole-oxa-cage-bond-cleared-residual-overlap',
    sourceIndex: 27074,
    smiles: 'CC1C2CC2C2OC(N)=NC1C1=NSC=C21',
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-25846-pre-cleanup-bond-overlap-ether-cage-bond-cleared-residual-overlap',
    sourceIndex: 25846,
    smiles: 'CCOC1C(O)C2COC1C1CCC(O1)C2O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 2,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.49,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: 'generic-scaffold'
    },
    relations: {
      finalBondFailuresAtMostPlacement: true,
      finalOverlapsAtMostPlacement: false,
      finalMaxDeviationAtMostPlacement: true
    }
  },
  {
    bucket: 'pre-cleanup-bond-only',
    name: 'row-34750-pre-cleanup-bond-only-chlorinated-cage-bond-cleared-residual-overlap',
    sourceIndex: 34750,
    smiles: 'ClC1C2(Cl)C3C4CC5C3C(Cl)(C2(Cl)Cl)C1(Cl)C5C4=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 3,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.6,
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-25209-pre-cleanup-bond-overlap-aminal-cage-bond-cleared-residual-overlap',
    sourceIndex: 25209,
    smiles: 'CC1C2CN(C(CC(CO)O2)CN1C)C(C)=N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
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
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-22905-pre-cleanup-bond-overlap-fused-aromatic-bridged-span',
    sourceIndex: 22905,
    smiles: 'CC1COCC2OC(C)(C)C1OC1=C2C=CN1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.56,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-bond-overlap',
    name: 'row-1118-pre-cleanup-bond-overlap-benzo-bridged-ammonium-bromide',
    sourceIndex: 1118,
    smiles: 'Br.C1CCN2C(C1)C3C4CCCC4C2c5ccccc35',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.12,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-6603-pre-cleanup-overlap-only-crowded-bridged-ureide-relaxed',
    sourceIndex: 6603,
    smiles: 'CCCC12CN3CC(CCC)(CN(C1)C3C4=C(C)NC(=O)NC4=O)C2=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.04,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-24343-pre-cleanup-overlap-only-bridged-lactone-amide',
    sourceIndex: 24343,
    smiles: 'CCOCC1(NC=O)C2CC(C1CN)C(=O)O2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.13,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-6328-pre-cleanup-overlap-only-bridged-amino-aryl-tail',
    sourceIndex: 6328,
    smiles: 'OC12C3C4CC5C6C4C1C6C(C35)N2CCCCc7cccc(F)c7',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.2,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-23712-pre-cleanup-overlap-only-aminonitrile-cage-overlap-cleared-residual-bond',
    sourceIndex: 23712,
    smiles: 'CC1OC23C4C(N)C(C#N)C2=CCC34C1C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 1,
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
    name: 'row-14262-pre-cleanup-bond-only-chloro-aza-cage-bond-cleared-residual-overlap-label',
    sourceIndex: 14262,
    smiles: 'CN1CCC23NC(=O)CC(C2C1)C1=CC(Cl)=CC=C1O3',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 3,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxLabelOverlapCount: 1,
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
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-7825-pre-cleanup-overlap-only-spiro-fused-angular-methyl',
    sourceIndex: 7825,
    smiles: '[H][C@@]12CC[C@@]3(CCC(=O)O3)[C@@]1(C)C[C@H]1O[C@@]11[C@@]2([H])[C@@H](CC2=CC(=O)CC[C@]12C)C(=O)OC',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.65,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-26593-pre-cleanup-overlap-only-bridged-oxime-hydroxyl',
    sourceIndex: 26593,
    smiles: 'CCCC1C2C3OC3C(O)C(CC1=O)C2=NO',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.1,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-26035-pre-cleanup-overlap-only-bridged-exocyclic-ethyl-root',
    sourceIndex: 26035,
    smiles: 'CCC1C2CCC(CN=CN)CC1C2N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.4,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-26545-pre-cleanup-overlap-only-compact-fused-spiro-ring-pinch',
    sourceIndex: 26545,
    smiles: 'CC1CC2(C)CNC=NCCC22NC(=N)NC12',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.12,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-19684-pre-cleanup-overlap-only-carbon-dispiro-5-6-5',
    sourceIndex: 19684,
    smiles: 'CC1CCC(C)C11CCC(=O)CC11CCCC1',
    expected: {
      primaryFamily: 'spiro',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 1e-6,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-27064-pre-cleanup-overlap-only-bridged-ether-exocyclic-root',
    sourceIndex: 27064,
    smiles: 'CCN1C2CNC(=O)C(COC2)(C=O)C1(C)C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.3,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-17493-pre-cleanup-overlap-only-bridged-ether-junction',
    sourceIndex: 17493,
    smiles: 'NC12C3CC(CCOC1=O)(O3)C2[NH3+]',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-16580-pre-cleanup-overlap-only-ammonium-bridged-cage',
    sourceIndex: 16580,
    smiles: 'CC1C2CC(C)[NH2+]C1C2(C)C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-17150-pre-cleanup-overlap-only-bridged-terminal-alcohol',
    sourceIndex: 17150,
    smiles: 'CC12CCC3CC3(C[NH2+]C1)C2CO',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.1,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-20091-pre-cleanup-overlap-only-linear-ring-carbonyl-leaf',
    sourceIndex: 20091,
    smiles: 'OCC1CC(=O)C2C[NH2+]CC1OC2=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.1,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-24109-pre-cleanup-overlap-only-compact-bridged-amide',
    sourceIndex: 24109,
    smiles: 'CCC1(C)C2NCCC1(C)N(C)CC2NC=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.1,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-26273-pre-cleanup-overlap-only-parallel-bridged-lanes',
    sourceIndex: 26273,
    smiles: 'CC12CCNCC(NCCN1)C1=C(N)OC=C21',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.45,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-24087-pre-cleanup-overlap-only-hydroxy-aza-bridged-aldehyde',
    sourceIndex: 24087,
    smiles: 'CC1(O)CNCC2C=C(CC2(O)C=O)C=C1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.31,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-20485-pre-cleanup-overlap-only-iminium-bridged-ketone',
    sourceIndex: 20485,
    smiles: 'CN1CC2N(C=[NH2+])C(C(=O)C1)C2(C)C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.48,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-23852-pre-cleanup-overlap-only-amino-oxa-azabicycle-nitrile',
    sourceIndex: 23852,
    smiles: 'CC(N)CN1CC2(COCC1CCC2C)C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.16,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-26892-pre-cleanup-overlap-only-diazabicycle-amino-nitrile',
    sourceIndex: 26892,
    smiles: 'CC1NCCN2CC(CC1O)C(N)(CC#N)C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.55,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-28821-pre-cleanup-overlap-only-amino-azabicycle-alcohol',
    sourceIndex: 28821,
    smiles: 'CN1C2(C)CC1(C)C1NCC(N)(CO)C1C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.16,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-25944-pre-cleanup-overlap-only-oxa-aza-decalin-alcohol',
    sourceIndex: 25944,
    smiles: 'CCC1OC2CCCC(CC)(C1O)C2(O)CN',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.54,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-6355-pre-cleanup-overlap-slow-ester-decalin-glycoside',
    sourceIndex: 6355,
    smiles: 'CCCCCC(=O)O[C@H]1C(O)[C@H](OCC23C[C@@H]4[C@H](C)CC[C@H]4C5(CC2C=C(C(C)C)C35C(=O)O)C=O)O[C@H](C)[C@H]1OC',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.59,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-7166-pre-cleanup-overlap-slow-ester-decalin-glycoside',
    sourceIndex: 7166,
    smiles: 'CCCCC(C)C(=O)O[C@H]1C(O)[C@H](OCC23C[C@@H]4[C@H](C)CC[C@H]4C5(CC2C=C(C(C)C)C35C(=O)O)C=O)O[C@H](C)[C@H]1OC',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.59,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-23078-pre-cleanup-overlap-only-sulfone-oxo-leaf',
    sourceIndex: 23078,
    smiles: 'CC1OCC2CCCC1(CC#C)NS2(=O)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-15797-pre-cleanup-overlap-only-ring-sulfone-branch',
    sourceIndex: 15797,
    smiles: 'CCC1C2CCCS(=O)(=O)C1N2C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.19,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-19075-pre-cleanup-overlap-only-bridged-amidine-root',
    sourceIndex: 19075,
    smiles: 'CC1C2CCCC(C)(CCC2(C)C)C1C(N)=[NH2+]',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.51,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-22840-pre-cleanup-overlap-only-bridged-amide-root',
    sourceIndex: 22840,
    smiles: 'CN1C2C(CO)C(N)C(C1=N)C2(C#C)C(N)=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.49,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-21849-pre-cleanup-overlap-only-bridged-imine-nitrogen-root',
    sourceIndex: 21849,
    smiles: 'CC(N)=NC1(C)C2CNC(C#N)C1(C)CCN2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.49,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-21804-pre-cleanup-overlap-only-bridged-oxime-center-root',
    sourceIndex: 21804,
    smiles: 'CCCNC12C=CC(NC1C(N)=N)C2=NO',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.29,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-15469-pre-cleanup-overlap-only-bridged-ring-oxime-center',
    sourceIndex: 15469,
    smiles: 'CCC12CCC(C[NH2+]C)OC(C1C)C2=NO',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.57,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-23729-pre-cleanup-overlap-only-bridged-nitrile-lactam',
    sourceIndex: 23729,
    smiles: 'CC(CC#C)N1C(C)C2CCC1(C#N)C(=O)N2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.57,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-15136-pre-cleanup-overlap-only-bridged-lactam-carbonyl-center',
    sourceIndex: 15136,
    smiles: 'CC12CCC1C1(O)C[NH2+]CCN2CCC1=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.51,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-28831-pre-cleanup-overlap-only-bridged-imine-ring-path-tail',
    sourceIndex: 28831,
    smiles: 'CC1CC2CN=C3CCC(O)C(CN3)C(O2)=N1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.53,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-24892-pre-cleanup-overlap-only-fused-acyl-leaf-fan',
    sourceIndex: 24892,
    smiles: 'CC1C2OCC3CCN(C1(C)C#C)C23C(C)=O',
    expected: {
      primaryFamily: 'fused',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-14672-pre-cleanup-overlap-only-compact-bridged-ammonium-cage',
    sourceIndex: 14672,
    smiles: 'CC12CCC3C(C[NH+]3C1(C)C)C2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.25,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-15074-pre-cleanup-overlap-only-compact-bridged-nitrile-center',
    sourceIndex: 15074,
    smiles: 'CCC12C(C#N)C(N(C)CC1(C)[NH2+]C)C2=O',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-28878-pre-cleanup-overlap-only-compact-bridged-exact-branch-ring',
    sourceIndex: 28878,
    smiles: 'CCC1C2(C)NC1(C)C(CO)(CC2C)OC',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-27172-pre-cleanup-overlap-only-compact-bridged-amide-branch-ring',
    sourceIndex: 27172,
    smiles: 'CC1C(=O)C2CCCN(C2C(N)=O)C1(C)C#N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-26803-pre-cleanup-overlap-only-compact-bridged-ring-pyrrolidine',
    sourceIndex: 26803,
    smiles: 'CC1C2OCCC(NC1=N)C2(C)N1CCCC1',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-24929-pre-cleanup-overlap-only-compact-bridged-amino-diol',
    sourceIndex: 24929,
    smiles: 'CC(O)C(C)C1(C)C2CN(C(C)CO)C1CO2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.1,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-14991-pre-cleanup-overlap-only-compact-bridged-ammonium-tertbutyl',
    sourceIndex: 14991,
    smiles: 'CCN1C2C[NH2+]C(CC(C)(C)C)C1(C)C2C',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-97-pre-cleanup-overlap-only-bridged-bis-amide-aryl',
    sourceIndex: 97,
    smiles: 'Fc1ccc(cc1)C(=O)NC2CC3CCCC(C2)N3C(=O)NC4CCCCC4',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-19362-pre-cleanup-overlap-only-compact-bridged-iminium-ketone',
    sourceIndex: 19362,
    smiles: 'CC(=O)C1(C)C2CN3C=[NH+]CC3C1(C)CCO2',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.08,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-27853-pre-cleanup-overlap-only-terminal-imine-leaf-bridged-path',
    sourceIndex: 27853,
    smiles: 'CC1(O)C(N)CC2CC(N)C(N)C1(C)OC2=N',
    expected: {
      primaryFamily: 'bridged',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.2,
      maxLabelOverlapCount: 0,
      maxRingSubstituentReadabilityFailureCount: 0,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  },
  {
    bucket: 'pre-cleanup-overlap-only',
    name: 'row-11760-pre-cleanup-overlap-only-macrocycle',
    sourceIndex: 11760,
    smiles: '[H][C@@]12CCCN1C(=O)[C@H](CC(C)C)NC(=O)[C@@H](C)C(=O)[C@@H](OC(=O)C[C@H](O)[C@]([H])(NC(=O)[C@@H](NC(=O)[C@@H](CC(C)C)N(C)C(=O)[C@@H]1CCCN1C(=O)C(C)=O)[C@@H](C)OC(=O)[C@H](CC1=CC=C(OC)C=C1)N(C)C2=O)[C@@H](C)CC)C(C)C',
    options: {
      suppressH: true,
      finalLandscapeOrientation: true
    },
    expected: {
      primaryFamily: 'macrocycle',
      maxSevereOverlapCount: 0,
      maxBondLengthFailureCount: 0,
      maxBondLengthDeviation: 0.06,
      maxCollapsedMacrocycleCount: 0,
      stereoContradiction: false,
      fallbackMode: null
    }
  }
]);
