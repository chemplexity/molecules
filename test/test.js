// Load molecules.js
var Molecules = require('./../dist/molecules.min.js');
//var Molecules = require('./../dist/molecules.js');

// SMILES Examples
var test = [

    // Alkanes
    {mass: 72.151, formula: {C:5, H:12}, name: 'CCCCC', category: 'Alkane', type: 'Primary'},
    {mass: 72.151, formula: {C:5, H:12}, name: 'CC(C)CC', category: 'Alkane', type: 'Secondary'},
    {mass: 72.151, formula: {C:5, H:12}, name: 'CC(C)(C)C', category: 'Alkane', type: 'Tertiary'},

    // Alkenes
    {mass: 56.108, formula: {C:4, H:8}, name: 'CC=CC', category: 'Alkene', type: 'Internal'},
    {mass: 56.108, formula: {C:4, H:8}, name: 'C=CCC', category: 'Alkene', type: 'Terminal'},
    {mass: 56.108, formula: {C:4, H:8}, name: 'C/C=C\C', category: 'Alkene', type: 'Cis'},
    {mass: 56.108, formula: {C:4, H:8}, name: 'C/C=C/C', category: 'Alkene', type: 'Trans'},
    {mass: 54.092, formula: {C:4, H:6}, name: 'C=CC=C', category: 'Alkene', type: 'Conjugated'},
    {mass: 54.092, formula: {C:4, H:6}, name: 'C=C=CC', category: 'Alkene', type: 'Allene'},

    // Alkynes
    {mass: 54.092, formula: {C:4, H:6}, name: 'CC#CC', category: 'Alkyne', type: 'Internal'},
    {mass: 54.092, formula: {C:4, H:6}, name: 'C#CCC', category: 'Alkyne', type: 'Terminal'},

    // Alcohols
    {mass: 74.123, formula: {C:4, H:10, O:1}, name: 'OCCCC', category: 'Alcohol', type: 'Primary'},
    {mass: 74.123, formula: {C:4, H:10, O:1}, name: 'CC(O)CC', category: 'Alcohol', type: 'Secondary'},
    {mass: 74.123, formula: {C:4, H:10, O:1}, name: 'CC(O)(C)C', category: 'Alcohol', type: 'Tertiary'},

    // Carbonyls
    {mass: 72.107, formula: {C:4, H:8, O:1}, name: 'C(=O)CCC', category: 'Carbonyl', type:'Aldehyde'},
    {mass: 72.107, formula: {C:4, H:8, O:1}, name: 'CC(=O)CC', category: 'Carbonyl', type:'Ketone'},
    {mass: 88.106, formula: {C:4, H:8, O:2}, name: 'OC(CCC)=O', category: 'Carbonyl', type:'Carboxylic Acid'},
    {mass: 88.106, formula: {C:4, H:8, O:2}, name: 'O=C(CC)OC', category: 'Carbonyl', type:'Ester'},
    {mass: 87.122, formula: {C:4, H:9, O:1, N:1}, name: 'NC(CCC)=O', category: 'Carbonyl', type:'Amide'},
    {mass: 104.105, formula: {C:4, H:8, O:3}, name: 'O=C(CCC)OO', category: 'Carbonyl', type:'Peroxy Acid'},
    {mass: 106.549, formula: {C:4, H:7, O:1, Cl:1}, name: 'ClC(CCC)=O', category: 'Carbonyl', type:'Acid Halide'},
    {mass: 116.116, formula: {C:5, H:8, O:3}, name: 'O=C(CC)OC(C)=O', category: 'Carbonyl', type:'Acid Anhydride'},

    // Rings (Non-Aromatic)
    {mass: 84.162, formula: {C:6, H:12}, name: 'C1CCCCC1', category: 'Cycloalkane', type: 'Basic'},
    {mass: 166.308, formula: {C:12, H:22}, name: 'C1CCCCC1C2CCCCC2', category: 'Cycloalkane', type: 'Intermediate'},
    {mass: 152.281, formula: {C:11, H:20}, name: 'C12(CCCCC1)CCCCC2', category: 'Cycloalkane', type: 'Advanced'},

    {mass: 80.130, formula: {C:6, H:8}, name: 'C1C=CCC=C1', category: 'Cycloalkene', type: 'Basic'},
    {mass: 104.152, formula: {C:8, H:8}, name: '[C@H]1=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H]1', category: 'Cycloalkene', type: 'Advanced'},

    // Rings (Aromatic)
    {mass: 78.114, formula: {C:6, H:6}, name: 'c1ccccc1', category: 'Aromatic', type: 'Basic'},
    {mass: 108.140, formula: {C:7, H:8, O:1}, name: 'OCc1ccccc1', category: 'Aromatic', type: 'Substituted'},
    {mass: 154.212, formula: {C:12, H:10}, name: 'c1ccccc1-c2ccccc2', category: 'Aromatic', type: 'Advanced'},
    {mass: 178.223, formula: {C:14, H:10}, name: 'C12=CC=CC=C1C3=C(C=CC=C3)C=C2', category: 'Aromatic', type: 'Polycyclic'},

    {mass: 67.091, formula: {C:4, H:5, N:1}, name: 'C1=CC=CN1', category: 'Heteroaromatic', type: 'N'},
    {mass: 68.075, formula: {C:4, H:4, O:1}, name: 'c1occc1', category: 'Heteroaromatic', type: 'O'},
    {mass: 84.136, formula: {C:4, H:4, S:1}, name: 'c1sccc1', category: 'Heteroaromatic', type: 'S'},

    // Charge
    {mass: 15.036, formula: {C:1, H:3}, name: '[CH3+]', category: 'Charge', type: 'Cation'},
    {mass: 15.036, formula: {C:1, H:3}, name: '[CH3-]', category: 'Charge', type: 'Anion'},

    {mass: 58.440, formula: {Na:1, Cl:1}, name: '[Na+].[Cl-]', category: 'Salt', type: 'Basic'},
    {mass: 148.195, formula: {N:2, O:3, H:8, S:2}, name: '[NH4+].[NH4+].[O-]S(=O)(=O)[S-]', category: 'Salt', type: 'Advanced'},

    // Isotope
    {mass: 59.116, formula: {C:4, H:10}, name: 'C[13CH](C)C', category: 'Isotope', type: '13C'},
    {mass: 60.116, formula: {C:4, H:10}, name: 'C[14CH](C)C', category: 'Isotope', type: '14C'},
    {mass: 391.694, formula: {C:13, H:25, Cl:1, I:1, N:1, O:2}, name: 'CCOC(Cl)C1C[14C](I)C1NOCC(C)CCC', category: 'Isotope', type: '14C'},

    // Chiral
    {mass: 143.408, formula: {C:2, H:4, Br:1, Cl:1}, name: 'C[C@@H](Br)Cl', category: 'Chiral', type: 'Clockwise'},
    {mass: 143.408, formula: {C:2, H:4, Br:1, Cl:1}, name: 'C[C@H](Br)Cl', category: 'Chiral', type: 'Anti-Clockwise'},
    {mass: 180.156, formula: {C:6, H:12, O:6}, name: 'O[C@@]([H])(O1)[C@@](O)([H])[C@@]([H])(O)[C@]1([C@@](CO)(O)[H])[H]', category: 'Chiral', type: 'Mixed'},

    // Amino Acids
    {mass: 89.094, formula: {C:3, H:7, N:1, O:2}, name: 'NC(C)C(O)=O', category: 'Amino Acids', type: 'ALA'},
    {mass: 174.204, formula: {C:6, H:14, N:4, O:2}, name: 'NC(CCCNC(N)=N)C(O)=O', category: 'Amino Acids', type: 'ARG'},
    {mass: 132.119, formula: {C:4, H:8, N:2, O:3}, name: 'NC(CC(N)=O)C(O)=O', category: 'Amino Acids', type: 'ASN'},
    {mass: 133.103, formula: {C:4, H:7, N:1, O:4}, name: 'NC(CC(O)=O)C(O)=O', category: 'Amino Acids', type: 'ASP'},
    {mass: 121.154, formula: {C:3, H:7, N:1, O:2, S:1}, name: 'NC(CS)C(O)=O', category: 'Amino Acids', type: 'CYS'},
    {mass: 147.130, formula: {C:5, H:9, N:1, O:4}, name: 'NC(CCC(O)=O)C(O)=O', category: 'Amino Acids', type: 'GLU'},
    {mass: 146.146, formula: {C:5, H:10, N:2, O:3}, name: 'NC(CCC(N)=O)C(O)=O', category: 'Amino Acids', type: 'GLA'},
    {mass: 75.067, formula: {C:2, H:5, N:1, O:2}, name: 'NC([H])C(O)=O', category: 'Amino Acids', type: 'GLY'},
    {mass: 155.157, formula: {C:6, H:9, N:3, O:2}, name: 'NC(CC1=CNC=N1)C(O)=O', category: 'Amino Acids', type: 'HIS'},
    {mass: 131.175, formula: {C:6, H:13, N:1, O:2}, name: 'NC(C(CC)C)C(O)=O', category: 'Amino Acids', type: 'ILE'},

    // Relaxed Rules
    {mass: 46.069, formula: {C:2, H:6, O:1}, name: 'C((C))O', category: 'Relaxed', type: 'Extra Parentheses'},
    {mass: 85.150, formula: {C:5, H:11, N:1}, name: '(N1CCCCC1)', category: 'Relaxed', type: 'Extra Parentheses'},
    {mass: 310.610, formula: {C:22, H:46}, name: 'C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C(C))))))))))))))))))))C', category: 'Relaxed', type: 'Extra Parentheses'},

    // Advanced
    {mass: 188.695, formula: {C:10, H:17, Cl:1, O:1}, name: 'CC(=O)C(Cl)CC(C(C)C)C=C', category: 'Other', type: 'Advanced'},
    {mass: 154.209, formula: {C:9, H:14, O:2}, name: 'C2C(=O)C1COCCC1CC2', category: 'Other', type: 'Advanced'},
    {mass: 150.646, formula: {C:7, H:15, Cl:1, O:1}, name: 'CC(CC(Cl)CCO)C', category: 'Other', type: 'Advanced'},
    {mass: 170.252, formula: {C:10, H:18, O:2}, name: 'CC1C(CC(CC1C)CCO)=O', category: 'Other', type: 'Advanced'},
    {mass: 131.175, formula: {C:6, H:13, N:1, O:2}, name: 'NC(C(CC)C)C(O)=O', category: 'Other', type: 'Advanced'},
    {mass: 372.447, formula: {C:23, H:22, N:3, O:2}, name: 'c1ccccc1[C@]2(C(=O)N(C)C(N)=[NH+]2)c3cc(ccc3)-c4ccc(cc4)OC', category: 'Other', type: 'Advanced'}
];

// Initialize variables
var tokens = [],
    mol = [],
    mass = [],
    formula = [];

function testAll() {

    var t0 = new Date();

    for (var i = 0, ii = test.length; i < ii; i+=1) {

        // String --> Molecule
        mol[i] = Molecules.load.smiles(test[i].name);
    }

    var t1 = new Date();

    for (var i = 0, ii = test.length; i < ii; i++) {

        // Extract properties
        mass[i] = mol[i].properties.mass;
        formula[i] = mol[i].properties.formula;
    }

    // Compare molecular weights
    var difference = [],
        category = test[0].category,
        result = [category];

    var pass = 0,
        fail = 0;

    for (var i = 0, sign = '', ii = mass.length; i < ii; i++) {

        // Calculated vs. Actual
        var m1 = Math.round(mass[i] * 100) / 100,
            m2 = Math.round(test[i].mass * 100) / 100;

        difference[i] = m1 - m2;

        if (difference[i] <= -0.01) { sign = '-'; }
        else { sign = '+'; }

        var message = sign + Math.abs(Math.round(difference[i]*100)/100);

        if (test[i].category !== category) {
            category = test[i].category;
            result.push('', category);
        }

        if (Math.abs(difference[i]) < 0.5) {
            result.push('  ' + (i+1) + ') PASS (' + test[i].type + ')');
            pass += 1;
        }
        else {
            result.push('  ' + (i+1) + ') FAIL (' + test[i].type + ')');
            fail += 1;

            var e1 = Object.keys(formula[i]),
                e2 = Object.keys(test[i].formula);

            var f1 = '',
                f2 = '';

            for (var j = 0; j < e2.length; j++) {

                f2 = f2 + e2[j] + test[i].formula[e2[j]] + ' ';

                if (formula[i][e2[j]] !== undefined) {
                    f1 = f1 + e2[j] + formula[i][e2[j]] + ' ';
                }
                else {
                    f1 = f1 + e2[j] + '0' + ' ';
                }
            }

            result.push('      ' + 'input  | ' + test[i].name);
            result.push('      ' + 'output | ' + f1 + '| ' + m1);
            result.push('      ' + 'actual | ' + f2 + '| ' + m2);
        }
    }

    result.push('');
    result.push('PASS  | ' + pass + ' | ' + (Math.round((pass / (pass+fail)) * 100)) + '%');
    result.push('FAIL  | ' + fail + ' | ' + (Math.round((fail / (pass+fail)) * 100)) + '%');
    result.push('TOTAL | ' + (pass + fail) + ' | 100%');
    result.push('TIME  | ' + (t1-t0) + ' ms');

    console.log(result);
}

function testCustom(input) {

    mol = Molecules.load.smiles(input);

    console.log(mol.atoms);
    console.log(mol.bonds);

    formula = mol.properties.formula;
    mass = Math.round(mol.properties.mass * 100) / 100;

    console.log(mol.bonds);

    var elements = Object.keys(formula),
        f = '';

    for (var i = 0; i < elements.length; i++) {

        f = f + elements[i] + formula[elements[i]] + ' ';
    }

    console.log('input  | ' + input);
    console.log('output | ' + f + '| ' + mass);

    return [tokens, mol];
}

function run(option, input) {

    if (typeof option !== 'string') { return; }

    option.toLowerCase();

    switch (option) {

        case 'all':
        case '1':
            testAll();
            break;

        case 'custom':
        case '2':
            var input = 'CC1C(CC(CC1C)CCO)=O';
            testCustom(input);
            break;

        case 'other':
        case '3':

            var input = 'CCO';
            //var input = test[3].name;

            var molecule = Molecules.load.smiles(input);

            console.log(input);
            console.log(molecule.properties.mass);
            console.log('');

            var adjacent = Molecules.topology.matrix.adjacency(molecule);

            console.log('adjacency');
            for (var i = 0; i < adjacent.length; i++) {
                console.log(adjacent[i]);
            }
            console.log('');

            var distance = Molecules.topology.matrix.distance(adjacent);

            console.log('distance');
            for (var i = 0; i < distance.length; i++) {
                console.log(distance[i]);
            }
            console.log('');

            var reciprocal = Molecules.topology.matrix.reciprocal(distance);

            console.log('reciprocal');
            for (var i = 0; i < reciprocal.length; i++) {
                console.log(reciprocal[i]);
            }
            console.log('');

            var degree = Molecules.topology.matrix.degree(adjacent);

            console.log('degree');
            for (var i = 0; i < degree.length; i++) {
                console.log(degree[i]);
            }
            console.log('');

            var laplacian = Molecules.topology.matrix.laplacian(adjacent,degree);

            console.log('laplacian');
            for (var i = 0; i < laplacian.length; i++) {
                console.log(laplacian[i]);
            }
            console.log('');

            var randic = Molecules.topology.matrix.randic(adjacent,degree);

            console.log('randic');
            for (var i = 0; i < randic.length; i++) {
                console.log(randic[i]);
            }
            console.log('');

            console.log('Wiener:', Molecules.topology.index.wiener(distance));
            console.log('Hyper-Wiener:', Molecules.topology.index.hyperwiener(distance));
            console.log('Harary:', Molecules.topology.index.harary(reciprocal));
            console.log('Balaban:', Molecules.topology.index.balaban(distance));
            console.log('Randic:', Molecules.topology.index.randic(randic));
            console.log('');

            //console.log(molecule);

            break;

        case '4':
            //var input = 'fdgk;3#GVED@FX';
            var input = 'C@H]1=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H][C@@H]=[C@@H]1';

            var molecule = Molecules.load.smiles(input);

            console.log(Molecules.save.json(molecule));
    }
}

// SMILES accuracy test
//   --FAIL if molecular weight > +/-0.01 g/mol from actual value

// 5-20-2015 - pass: 40, fail: 12, total: 52
// 5-25-2015 - pass: 44, fail: 8, total: 52
// 5-26-2015 - pass: 50, fail: 2, total: 52
// 5-30-2015 - pass: 61, fail: 2, total: 63
// 6-1-2015 - pass: 61, fail: 2, total: 63
// 6-4-2015 - pass: 63, fail: 0, total: 63
var latest_results = {pass: 63, fail: 0, total: 63};


// run(option, input)
//   Option 1) 'all' (Full Test)
//   Option 2) 'custom', (SMILES Test)
//   Option 3) 'other' (Matrix/Index Test)

run('1');
run('2');
run('3');
