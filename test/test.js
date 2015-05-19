// SMILES Test
var test = [
    {weight: 84.16, formula: {C:6, H:12}, name: 'C1CCCCC1'},
    {weight: 188.70, formula: {C:10, H:17, Cl:1, O:1}, name: 'CC(=O)C(Cl)CC(C(C)C)C=C'},
    {weight: 154.21, formula: {C:9, H:14, O:2}, name: 'C2C(=O)C1COCCC1CC2'},
    {weight: 150.65, formula: {C:7, H:15, Cl:1, O:1}, name: 'CC(CC(Cl)CCO)C'},
    {weight: 170.25, formula: {C:10, H:18, O:2}, name: 'CC1C(CC(CC1C)CCO)=O'},
    {weight: 131.18, formula: {C:6, H:13, N:1, O:2}, name: 'NC(C(CC)C)C(O)=O'},
    {weight: 180.16, formula: {C:6, H:12, O:6}, name: 'O[C@@]([H])(O1)[C@@](O)([H])[C@@]([H])(O)[C@]1([C@@](CO)(O)[H])[H]'},
    {weight: 390.62, formula: {C:13, H:24, Cl:1, I:1, N:1, O:2}, name: 'CCOC(Cl)C1C[14C](I)C1N-OCC(C)CCC'},
    {weight: 372.45, formula: {C:23, H:22, N:3, O:2}, name: 'c1ccccc1[C@]2(C(=O)N(C)C(N)=[NH+]2)c3cc(ccc3)-c4ccc(cc4)OC'}
];

//var element = require('./../build/ES5/reference/elements');

//console.log(element['Se']);

// Load molecules.js
var molecules = require('./../dist/molecules.min.js');

// Initialize variables
var tokens = [],
    mol = [],
    weights = [],
    formulas = [];

for (var i = 0; i < test.length; i++) {

    // Parse SMILES
    tokens[i] = molecules.getTokens(test[i].name);

    // Read tokens
    mol[i] = molecules.readTokens(tokens[i]);

    // Calculate properties
    weights[i] = mol[i].properties.mass;
    formulas[i] = mol[i].properties.formula;
}

// Compare molecular weights
var weightsDifference = [],
    weightsResult = [];

for (i = 0; i < weights.length; i++) {

    var diff = weights[i] - test[i].weight,
        sign = '';

    if (diff < 0) { sign = '-'; }
    else if (diff > 0) { sign = '+'; }

    if (Math.abs(diff) < 0.8) {
        weightsResult[i] = i + ') PASS';
    }
    else {
        diff = Math.abs(Math.round(diff*100) / 100);
        weightsResult[i] = i + ') FAIL (Error: ' + sign + diff + ', Actual: ' + test[i].weight + ')';
    }
}

console.log(weightsResult);


