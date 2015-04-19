/*
  smiles.js

    description : parse SMILES chemical line notation
    imports     : elements
    exports     : tokenize, decode
*/

/*
  Imports
*/
let {periodic_table} = require('./elements');


/*
  Variable: definitions
   -regular expressions for SMILES grammar
*/

var definitions = [
    {type: 'atom',     term: 'H',  tag: 'H',       expression: /[A-Z]?H(?=[^efgos]|$)([0-9]?)+/g},
    {type: 'atom',     term: 'B',  tag: 'B',       expression: /B(?=[^aehikr]|$)/g},
    {type: 'atom',     term: 'C',  tag: 'C',       expression: /C(?=[^adeflmnorsu]|$)/g},
    {type: 'atom',     term: 'N',  tag: 'N',       expression: /N(?=[^abdeiop]|$)/g},
    {type: 'atom',     term: 'O',  tag: 'O',       expression: /O(?=[^s]|$)/g},
    {type: 'atom',     term: 'F',  tag: 'F',       expression: /F(?=[^elmr]|$)/g},
    {type: 'atom',     term: 'Si', tag: 'Si',      expression: /Si/g},
    {type: 'atom',     term: 'P',  tag: 'P',       expression: /P(?=[^abdmortu]|$)/g},
    {type: 'atom',     term: 'S',  tag: 'S',       expression: /S(?=[^bcegimnr]|$)/g},
    {type: 'atom',     term: 'Cl', tag: 'Cl',      expression: /Cl/g},
    {type: 'atom',     term: 'Se', tag: 'Se',      expression: /Se/g},
    {type: 'atom',     term: 'Br', tag: 'Br',      expression: /Br/g},
    {type: 'atom',     term: 'I',  tag: 'I',       expression: /I(?=[^nr]|$)/g},
    {type: 'atom',     term: '*',  tag: '*',       expression: /[*]/g},
    {type: 'atom',     term: 'b',  tag: 'B',       expression: /b(?=[^aehikr]|$)/g},
    {type: 'atom',     term: 'c',  tag: 'C',       expression: /c(?=[^adeflmnorsu]|$)/g},
    {type: 'atom',     term: 'n',  tag: 'N',       expression: /n(?=[^abdeiop]|$)/g},
    {type: 'atom',     term: 'o',  tag: 'O',       expression: /o(?=[^s]|$)/g},
    {type: 'atom',     term: 'p',  tag: 'P',       expression: /p(?=[^abdmortu]|$)/g},
    {type: 'atom',     term: 's',  tag: 'S',       expression: /s(?=[^bcegimnr]|$)/g},
    {type: 'atom',     term: 'se', tag: 'Se',      expression: /se/g},
    {type: 'bond',     term: '-',  tag: 'single',  expression: /(?=[^d])[-](?=[^d])/g},
    {type: 'bond',     term: '=',  tag: 'double',  expression: /[=]/g},
    {type: 'bond',     term: '#',  tag: 'triple',  expression: /[#]/g},
    {type: 'bond',     term: '(',  tag: 'branch',  expression: /[(]/g},
    {type: 'bond',     term: ')',  tag: 'branch',  expression: /[)]/g},
    {type: 'bond',     term: '%',  tag: 'ring',    expression: /(?=[^+-])(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[%]?\d(?=([^+-]|$))/g},
    {type: 'bond',     term: '.',  tag: 'dot',     expression: /[A-Z][+-]?[\[]?[.]/g},
    {type: 'property', term: '+',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g},
    {type: 'property', term: '-',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g},
    {type: 'property', term: 'n',  tag: 'isotope', expression: /[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g},
    {type: 'property', term: '@',  tag: 'chiral',  expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g},
    {type: 'property', term: '@@', tag: 'chiral',  expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g}
];


/*
  Method: Tokenize
   -parse string for valid SMILES definitions

  Syntax
    tokens = tokenize(input)

  Arguments
    input : any SMILES encoded string

  Output
    tokens : array of token objects matching input

  Examples
    tokens123 = tokenize('CC(=O)CC')
    tokensABC = tokenize('c1cccc1')
*/

function tokenize(input, tokens = []) {

    // Parse input with definitions
    for (let i = 0; i < definitions.length; i++) {

        let token = definitions[i];
        let text = [];

        // Check input for match
        while ((text = token.expression.exec(input))) {

            // Update tokens
            tokens.push({
                index: text.index,
                type:  token.type,
                term:  text[0],
                tag:   token.tag
            });
        }
    }

    // Sort tokens by index
    tokens.sort(function (a, b) {
        if (a.index < b.index) { return -1; }
        if (a.index > b.index) { return +1; }
        return 0;
    });

    return tokens;
}


/*
  Method: Decode
   -convert SMILES tokens into atoms (nodes) and bonds (edges)

  Syntax
    [atoms, bonds] = decode(tokens)

  Arguments
    tokens : array of SMILES tokens obtained from the output of 'tokenize'

  Output
    [atoms, bonds] : array of atom/bond objects describing connectivity and properties

  Examples
    [atoms, bonds] = decode(tokensABC)
    [atoms, bonds] = decode(tokens123)
*/

function decode(tokens) {

    // Validate tokens
    function validateTokens(tokens) {

        // Check supplied tokens type
        if (typeof(tokens) !== 'object') { throw 'Error: Tokens must be of type "object"'; }

        // Required token fields
        let fields = ['index', 'type', 'term', 'tag'];

        // Check tokens for valid fields
        for (let i = 0; i < tokens.length; i++) {

            // Return binary comparison array
            let match = compare(fields, Object.keys(tokens[i]));

            // Clear invalid token
            if (match.reduce((a, b) => a + b) < 4) { throw 'Error: Invalid token at index #' + i; }
        }

        return true;
    }

    // Read tokens
    function readTokens(tokens, atoms = {}, bonds = {}, properties = {}, keys = {}) {

        // Generate unique key
        let newKey = (x) => x.toString();

        // Parse tokens by category
        for (let i = 0; i < tokens.length; i++) {

            // Extract token values
            let {type, term, tag, index} = tokens[i];

            // Assign unique key
            let key = newKey(index);

            // Categorize tokens
            switch (type) {

                case 'atom':
                    atoms[key] = {id: key, name: tag};
                    break;

                case 'bond':
                    bonds[key] = {id: key, name: tag, value: term};
                    break;

                case 'property':
                    properties[key] = {id: key, name: tag, value: term};
                    break;
            }
        }

        // Check for atoms
        if (atoms.length < 1) { return false; }

        keys.all = [];

        // Extract all token keys
        for (let i = 0; i < tokens.length; i++) {
            keys.all[i] = newKey(tokens[i].index);
        }

        // Extract token keys by category
        keys.atoms = Object.keys(atoms);
        keys.bonds = Object.keys(bonds);
        keys.properties = Object.keys(properties);

        return [atoms, bonds, properties, keys];
    }

    // Default atom properties
    function defaultAtoms(atoms, keys){

        // Add default properties to atoms
        for (let key of keys.atoms) {

            // Element
            let element = periodic_table[atoms[key].name];

            // Element properties
            atoms[key].protons = element.protons;
            atoms[key].neutrons = element.neutrons;
            atoms[key].electrons = element.electrons;

            // Bond properties
            atoms[key].bonds = {
                chiral: 0,
                atoms: []
            };

            // Other properties
            atoms[key].properties = {
                charge: 0
            };
        }

        return atoms;
    }

    // Custom atom properties
    function customAtoms(atoms, properties, keys) {

        // Add custom properties to atoms
        for (let key of keys.properties) {

            // Retrieve properties
            let {name, value} = properties[key];

            // Property name
            switch (name) {

                // Set chiral property
                case 'chiral':
                    atoms[key].bonds.chiral = value.slice(value.indexOf('@'));
                    break;

                // Set neutrons
                case 'isotope':
                    break;

                // Set charge property
                case 'charge':

                    // Determine charge sign
                    let sign = value.indexOf('+') !== -1 ? 1 : -1;

                    // Check numeric charge (e.g. '3+')
                    let charge = value.match(/[0-9]+/g);

                    if (charge !== null) {
                        atoms[key].properties.charge = charge[0] * sign;
                        break;
                    }

                    // Check symbolic charge (e.g. '+++')
                    charge = value.match(/([+]+|[-]+)/g);

                    if (charge !== null) {
                        atoms[key].properties.charge = charge[0].length * sign;
                        break;
                    }

                    break;
            }
        }

        return atoms;
    }

    // Explicit bonds
    function explicitBonds(atoms, bonds, keys) {

        // Check for any explicit bonds
        if (keys.bonds.length === 0) { return bonds; }

        // Find bonding atoms
        let source = (key) => previousAtom(key, keys.all, atoms);
        let target = (key) => nextAtom(key, keys.all, atoms);

        // Add explicit bonds
        for (let i = 0; i < keys.bonds.length; i++) {

            // Retrieve key
            let key = keys.bonds[i];

            // Bond type
            switch (bonds[key].name) {

                // Single bond
                case 'single':
                    bonds[key].order = 1;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                // Double bond
                case 'double':
                    bonds[key].order = 2;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                // Triple bond
                case 'triple':
                    bonds[key].order = 3;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                // Disconnect bond
                case 'dot':
                    bonds[key].order = 0;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                // Branch
                case 'branch':

                    switch (bonds[key].value) {

                        // Start branch
                        case '(':
                            bonds[key].order = 1;
                            bonds[key].atoms = [source(key), target(key)];
                            break;

                        // End branch
                        case ')':

                            // Extract bonds before key
                            let bondsBefore = keys.bonds.slice(0, keys.bonds.indexOf(key)).reverse();

                            // Find start of branch
                            for (let j = 0, skip = 0; j < bondsBefore.length; j++) {

                                // Add branch
                                if (bonds[bondsBefore[j]].value === '(' && skip === 0) {
                                    bonds[key].order = 1;
                                    bonds[key].atoms = [source(bondsBefore[j]), target(key)];
                                    break;
                                }

                                // Nested branch
                                switch (bonds[bondsBefore[j]].value) {
                                    case ')': skip++; break;
                                    case '(': skip--; break;
                                }
                            }
                            break;
                    }
                    break;

                // Ring
                case 'ring':

                    // Extract bonds after key
                    let bondsAfter = keys.bonds.slice(keys.bonds.indexOf(key), keys.bonds.length);

                    // Find matching ring atom
                    for (let j = 0; j < bondsAfter.length; j++) {

                        // Add ring junction
                        if (bonds[bondsAfter[j]].value === bonds[key].value && j > 0) {

                            bonds[key].order = 1;
                            bonds[key].atoms = [key, bondsAfter[j]];

                            bonds[bondsAfter[j]].order = 1;
                            bonds[bondsAfter[j]].atoms = [key, bondsAfter[j]];
                        }
                    }
                    break;
            }
        }

        // Remove duplicate bonds
        for (let i = 0; i < keys.bonds.length; i++) {

            // Extract bonds after index
            let bondsAfter = keys.bonds.slice(i, keys.bonds.length);

            // Check for duplicate bonds
            for (let j = 0; j < bondsAfter.length; j++) {

                // Bond keys
                let a = bonds[keys.bonds[i]];
                let b = bonds[bondsAfter[j]];

                // Check bond for atoms
                if (a === undefined || b === undefined || j === 0) { continue; }

                // Compare atom keys
                if (a.atoms[0] === b.atoms[0] && a.atoms[1] === b.atoms[1]) {

                    // Duplicate ring bond
                    if (a.name === 'ring' && b.name === 'ring') { delete bonds[bondsAfter[j]]; }

                    // Duplicate single bonds
                    else if (a.name === 'branch' && b.name === 'single') { delete bonds[keys.bonds[i]]; }
                    else if (a.name === 'single' && b.name === 'branch') { delete bonds[bondsAfter[j]]; }

                    else if (a.name === 'branch' && b.name === 'double') { delete bonds[keys.bonds[i]]; }
                    else if (a.name === 'double' && b.name === 'branch') { delete bonds[bondsAfter[j]]; }

                    else if (a.name === 'branch' && b.name === 'triple') { delete bonds[keys.bonds[i]]; }
                    else if (a.name === 'triple' && b.name === 'branch') { delete bonds[bondsAfter[j]]; }

                    // Other duplicate bonds
                    else { delete bonds[bondsAfter[j]]; }

                    i--;
                    break;
                }
            }
        }
        return bonds;
    }

    // Implicit bonds
    function implicitBonds (atoms, bonds, keys) {

    }

    // Variables
    let atoms, bonds, properties, keys;

    // 1. Validate
    if (!validateTokens(tokens)) { return false; }

    // 2. Categorize
    [atoms, bonds, properties, keys] = readTokens(tokens);

    // 3. Atoms
    atoms = defaultAtoms(atoms, keys);
    atoms = customAtoms(atoms, properties, keys);

    // 4. Bonds
    bonds = explicitBonds(atoms, bonds, keys);

    return [atoms, bonds];
}


/*
  Utility: compare
   -compare values of two arrays
*/

function compare(a, b) {

    let ab = [];

    // Return binary array
    for (let i = 0; i < a.length; i++) {
        ab[i] = b.indexOf(a[i]) > -1 ? 1 : 0;
    }

    return ab;
}


/*
  Utility: nextAtom
   -find key of next atom in array
*/

function nextAtom(start, keys, atoms) {

    // Determine index of key in array
    let index = keys.indexOf(start);

    // Return if key not in array
    if (index === -1) { return []; }

    // Filter keys before index
    keys = keys.slice(index, keys.length);

    // Determine nearest atom to key
    for (let i = 0; i < keys.length; i++) {

        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }
}


/*
 Utility: previousAtom
 -find key of previous atom in array
 */

function previousAtom(start, keys, atoms) {

    // Determine index of key in array
    let index = keys.indexOf(start);

    // Return if key not in array
    if (index === -1) { return []; }

    // Filter keys after index
    keys = keys.slice(0, index).reverse();

    // Determine nearest atom to key
    for (let i = 0; i < keys.length; i++) {

        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }
}


/*
  Exports
*/

export { tokenize, decode };
