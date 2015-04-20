'use strict';

var _slicedToArray = function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i['return']) _i['return'](); } finally { if (_d) throw _e; } } return _arr; } else { throw new TypeError('Invalid attempt to destructure non-iterable instance'); } };

Object.defineProperty(exports, '__esModule', {
    value: true
});
/*
  smiles.js

    description : parse SMILES chemical line notation
    imports     : elements
    exports     : tokenize, decode
*/

/*
  Imports
*/

// import {periodic_table} from './elements'

var _require = require('./elements');

var periodic_table = _require.periodic_table;

/*
  Variable: definitions
   -regular expressions for SMILES grammar
*/

var definitions = [{ type: 'atom', term: 'H', tag: 'H', expression: /[A-Z]?H(?=[^efgos]|$)([0-9]?)+/g }, { type: 'atom', term: 'B', tag: 'B', expression: /B(?=[^aehikr]|$)/g }, { type: 'atom', term: 'C', tag: 'C', expression: /C(?=[^adeflmnorsu]|$)/g }, { type: 'atom', term: 'N', tag: 'N', expression: /N(?=[^abdeiop]|$)/g }, { type: 'atom', term: 'O', tag: 'O', expression: /O(?=[^s]|$)/g }, { type: 'atom', term: 'F', tag: 'F', expression: /F(?=[^elmr]|$)/g }, { type: 'atom', term: 'Si', tag: 'Si', expression: /Si/g }, { type: 'atom', term: 'P', tag: 'P', expression: /P(?=[^abdmortu]|$)/g }, { type: 'atom', term: 'S', tag: 'S', expression: /S(?=[^bcegimnr]|$)/g }, { type: 'atom', term: 'Cl', tag: 'Cl', expression: /Cl/g }, { type: 'atom', term: 'Se', tag: 'Se', expression: /Se/g }, { type: 'atom', term: 'Br', tag: 'Br', expression: /Br/g }, { type: 'atom', term: 'I', tag: 'I', expression: /I(?=[^nr]|$)/g }, { type: 'atom', term: '*', tag: '*', expression: /[*]/g }, { type: 'atom', term: 'b', tag: 'B', expression: /b(?=[^aehikr]|$)/g }, { type: 'atom', term: 'c', tag: 'C', expression: /c(?=[^adeflmnorsu]|$)/g }, { type: 'atom', term: 'n', tag: 'N', expression: /n(?=[^abdeiop]|$)/g }, { type: 'atom', term: 'o', tag: 'O', expression: /o(?=[^s]|$)/g }, { type: 'atom', term: 'p', tag: 'P', expression: /p(?=[^abdmortu]|$)/g }, { type: 'atom', term: 's', tag: 'S', expression: /s(?=[^bcegimnr]|$)/g }, { type: 'atom', term: 'se', tag: 'Se', expression: /se/g }, { type: 'bond', term: '-', tag: 'single', expression: /(?=[^d])[-](?=[^d])/g }, { type: 'bond', term: '=', tag: 'double', expression: /[=]/g }, { type: 'bond', term: '#', tag: 'triple', expression: /[#]/g }, { type: 'bond', term: '(', tag: 'branch', expression: /[(]/g }, { type: 'bond', term: ')', tag: 'branch', expression: /[)]/g }, { type: 'bond', term: '%', tag: 'ring', expression: /(?=[^+-])(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[%]?\d(?=([^+-]|$))/g }, { type: 'bond', term: '.', tag: 'dot', expression: /[A-Z][+-]?[\[]?[.]/g }, { type: 'property', term: '+', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g }, { type: 'property', term: '-', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g }, { type: 'property', term: 'n', tag: 'isotope', expression: /[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g }, { type: 'property', term: '@', tag: 'chiral', expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g }, { type: 'property', term: '@@', tag: 'chiral', expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g }];

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

function tokenize(input) {
    var tokens = arguments[1] === undefined ? [] : arguments[1];

    // Parse input with definitions
    for (var i = 0; i < definitions.length; i++) {

        var token = definitions[i];
        var text = [];

        // Check input for match
        while (text = token.expression.exec(input)) {

            // Update tokens
            tokens.push({
                index: text.index,
                type: token.type,
                term: text[0],
                tag: token.tag
            });
        }
    }

    // Sort tokens by index
    tokens.sort(function (a, b) {
        if (a.index < b.index) {
            return -1;
        }
        if (a.index > b.index) {
            return +1;
        }
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
        if (typeof tokens !== 'object') {
            throw 'Error: Tokens must be of type "object"';
        }

        // Required token fields
        var fields = ['index', 'type', 'term', 'tag'];

        // Check tokens for required fields
        for (var i = 0; i < tokens.length; i++) {

            // Return binary comparison array
            var match = compare(fields, Object.keys(tokens[i]));

            // Check for invalid token
            if (match.reduce(function (a, b) {
                return a + b;
            }) < 4) {
                throw 'Error: Invalid token at index #' + i;
            }
        }

        return true;
    }

    // Read tokens
    function readTokens(tokens) {
        var atoms = arguments[1] === undefined ? {} : arguments[1];
        var bonds = arguments[2] === undefined ? {} : arguments[2];
        var properties = arguments[3] === undefined ? {} : arguments[3];
        var keys = arguments[4] === undefined ? {} : arguments[4];

        // Generate unique key
        var newKey = function newKey(x) {
            return x.toString();
        };

        // Parse tokens by category
        for (var i = 0; i < tokens.length; i++) {

            // Extract token values
            var _tokens$i = tokens[i];
            var type = _tokens$i.type;
            var term = _tokens$i.term;
            var tag = _tokens$i.tag;
            var index = _tokens$i.index;

            // Assign unique key
            var key = newKey(index);

            // Categorize tokens
            switch (type) {

                case 'atom':
                    atoms[key] = addAtom(key, tag, term);
                    break;

                case 'bond':
                    bonds[key] = addBond(key, tag, term);
                    break;

                case 'property':
                    properties[key] = { id: key, name: tag, value: term };
                    break;
            }
        }

        // Check for atoms
        if (atoms.length < 1) {
            return false;
        }

        keys.all = [];

        // Extract all token keys
        for (var i = 0; i < tokens.length; i++) {
            keys.all[i] = newKey(tokens[i].index);
        }

        // Extract token keys by category
        keys.atoms = Object.keys(atoms);
        keys.bonds = Object.keys(bonds);
        keys.properties = Object.keys(properties);

        return [atoms, bonds, properties, keys];
    }

    // Default atom properties
    function defaultAtoms(atoms, keys) {

        // Add default properties to atoms
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
            for (var _iterator = keys.atoms[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                var key = _step.value;

                // Element
                var element = periodic_table[atoms[key].name];

                // Element properties
                atoms[key].group = element.group;
                atoms[key].protons = element.protons;
                atoms[key].neutrons = element.neutrons;
                atoms[key].electrons = element.electrons;

                // Bond properties
                atoms[key].bonds = {
                    electrons: 0,
                    chiral: 0,
                    atoms: []
                };

                // Other properties
                atoms[key].properties = {
                    charge: 0
                };
            }
        } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
        } finally {
            try {
                if (!_iteratorNormalCompletion && _iterator['return']) {
                    _iterator['return']();
                }
            } finally {
                if (_didIteratorError) {
                    throw _iteratorError;
                }
            }
        }

        return atoms;
    }

    // Custom atom properties
    function customAtoms(atoms, properties, keys) {

        // Add custom properties to atoms
        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
            for (var _iterator2 = keys.properties[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                var key = _step2.value;

                // Retrieve properties
                var _properties$key = properties[key];
                var _name = _properties$key.name;
                var value = _properties$key.value;

                // Property name
                switch (_name) {

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
                        var sign = value.indexOf('+') !== -1 ? 1 : -1;

                        // Check numeric charge (e.g. '3+')
                        var charge = value.match(/[0-9]+/g);

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
        } catch (err) {
            _didIteratorError2 = true;
            _iteratorError2 = err;
        } finally {
            try {
                if (!_iteratorNormalCompletion2 && _iterator2['return']) {
                    _iterator2['return']();
                }
            } finally {
                if (_didIteratorError2) {
                    throw _iteratorError2;
                }
            }
        }

        return atoms;
    }

    // Explicit bonds
    function explicitBonds(atoms, bonds, keys) {

        // Check for any explicit bonds
        if (keys.bonds.length === 0) {
            return bonds;
        }

        // Find bonding atoms
        var source = function source(key) {
            return previousAtom(key, keys.all, atoms);
        };
        var target = function target(key) {
            return nextAtom(key, keys.all, atoms);
        };

        // Add explicit bonds
        for (var i = 0; i < keys.bonds.length; i++) {

            // Retrieve key
            var key = keys.bonds[i];

            // Bond type
            switch (bonds[key].name) {

                case 'single':
                    bonds[key].order = 1;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'double':
                    bonds[key].order = 2;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'triple':
                    bonds[key].order = 3;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'dot':
                    bonds[key].order = 0;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'branch':

                    // Key index
                    var keyIndex = keys.all.indexOf(key);

                    // Tokens before/after branch
                    var tokensBefore = keys.all.slice(0, keyIndex).reverse();
                    var tokensAfter = keys.all.slice(keyIndex + 1, keys.all.length);

                    switch (bonds[key].value) {

                        // Start branch
                        case '(':

                            // Find start of branch
                            for (var j = 0, skip = 0; j < tokensBefore.length; j++) {

                                // Token ID
                                var tokenID = tokensBefore[j];

                                // Update bond
                                if (keys.atoms.indexOf(tokenID) !== -1 && skip === 0) {
                                    bonds[key].order = 1;
                                    bonds[key].atoms = [tokenID, target(key)];
                                    break;
                                }

                                // Check for bond
                                else if (keys.bonds.indexOf(tokenID) !== -1) {

                                    // Nested branch
                                    switch (bonds[tokenID].value) {
                                        case ')':
                                            skip++;break;
                                        case '(':
                                            skip--;break;
                                    }
                                }
                            }

                            break;

                        // End branch
                        case ')':

                            // Find start of branch
                            for (var j = 0, skip = 1; j < tokensBefore.length; j++) {

                                // Token ID
                                var tokenID = tokensBefore[j];

                                // Update bond
                                if (keys.atoms.indexOf(tokenID) !== -1 && skip === 0) {
                                    bonds[key].order = 1;
                                    bonds[key].atoms[0] = tokenID;
                                    break;
                                }

                                // Check for bond
                                else if (keys.bonds.indexOf(tokenID) !== -1) {

                                    // Nested branch
                                    switch (bonds[tokenID].value) {
                                        case ')':
                                            skip++;break;
                                        case '(':
                                            skip--;break;
                                    }
                                }
                            }

                            // Find end of branch
                            for (var j = 0, skip = 0; j < tokensAfter.length; j++) {

                                // Token ID
                                var tokenID = tokensAfter[j];

                                // Update bond
                                if (keys.atoms.indexOf(tokenID) !== -1 && skip === 0) {
                                    bonds[key].atoms[1] = tokenID;
                                    break;
                                }

                                // Check for bond
                                else if (keys.bonds.indexOf(tokenID) !== -1) {

                                    // Nested branch
                                    switch (bonds[tokenID].value) {
                                        case ')':
                                            skip--;break;
                                        case '(':
                                            skip++;break;
                                    }
                                }
                            }

                            break;
                    }

                    break;

                // Ring
                case 'ring':

                    // Extract bonds after key
                    var bondsAfter = keys.bonds.slice(keys.bonds.indexOf(key), keys.bonds.length);

                    // Find matching ring atom
                    for (var j = 0; j < bondsAfter.length; j++) {

                        // Check for existing bond
                        if (bonds[key].atoms.length > 0 || j === 0) {
                            continue;
                        }

                        // Bond ID
                        var bondID = bondsAfter[j];

                        // Ring ID
                        var ringID = /[0-9]+/g;

                        var a = bonds[key].value.match(ringID);
                        var b = bonds[bondID].value.match(ringID);

                        // Add ring bond
                        if (a !== null && b !== null && a[0] === b[0]) {

                            bonds[key].order = 1;
                            bonds[key].atoms = [key, bondID];

                            bonds[bondID].order = 1;
                            bonds[bondID].atoms = [key, bondID];

                            break;
                        }
                    }

                    break;
            }
        }

        // Remove duplicate bonds
        for (var i = 0; i < keys.bonds.length; i++) {

            // Extract bonds after index
            var bondsAfter = keys.bonds.slice(i, keys.bonds.length);

            // Check for duplicate bonds
            for (var j = 0; j < bondsAfter.length; j++) {

                // Bond ID
                var bondID = bondsAfter[j];

                // Bond keys
                var a = bonds[keys.bonds[i]];
                var b = bonds[bondID];

                // Check bond for atoms
                if (a === undefined || b === undefined || j === 0) {
                    continue;
                }

                // Compare atom keys
                if (a.atoms[0] === b.atoms[0] && a.atoms[1] === b.atoms[1]) {

                    // Duplicate ring bond
                    if (a.name === 'ring' && b.name === 'ring') {
                        delete bonds[bondID];
                        delete keys.bonds[keys.bonds.indexOf(bondID)];
                    }

                    // Duplicate branching bonds
                    else if (a.name === 'branch' && (b.name === 'single' || b.name === 'double' || b.name === 'triple')) {
                        delete bonds[keys.bonds[i]];
                        delete keys.bonds[i];
                    } else if ((a.name === 'single' || a.name === 'double' || a.name === 'triple') && b.name === 'branch') {
                        delete bonds[bondID];
                        delete keys.bonds[keys.bonds.indexOf(bondID)];
                    }

                    // Other duplicate bonds
                    else {
                        delete bonds[bondID];
                        delete keys.bonds[keys.bonds.indexOf(bondID)];
                    }

                    i--;
                    break;
                }
            }
        }

        // Remove empty references from keys
        for (var i = 0; i < keys.bonds.length; i++) {
            if (keys.bonds[i] === undefined) {
                keys.bonds.splice(i, 1);i--;
            }
        }

        // Add bond references to atom properties
        for (var i = 0; i < keys.bonds.length; i++) {

            // Bond ID
            var bondID = keys.bonds[i];

            // Atom keys
            var a = bonds[bondID].atoms[0];
            var b = bonds[bondID].atoms[1];

            // Add bond reference to atom
            atoms[a].bonds.atoms.push(bondID);
            atoms[b].bonds.atoms.push(bondID);

            // Update total bonding electrons
            atoms[a].bonds.electrons += bonds[bondID].order;
            atoms[b].bonds.electrons += bonds[bondID].order;
        }

        return [atoms, bonds, keys];
    }

    // Implicit bonds
    function implicitBonds(atoms, bonds, keys) {

        // Generate unique key
        var newKey = function newKey(a, b) {
            return a + b;
        };

        // Add bonds to nearest neighbor
        for (var i = 0; i < keys.atoms.length; i++) {

            // Check if last element in array
            if (keys.atoms.length === i + 1) {
                continue;
            }

            // Atom key
            var atomID = keys.atoms[i];

            // Check availability
            if (18 - atoms[atomID].group - atoms[atomID].bonds.electrons > 0) {

                // Locate next atom
                var source = keys.all[keys.all.indexOf(atomID) + 1];
                var target = nextAtom(source, keys.all, atoms);

                // Recalculate if source is equal to target
                var counter = 2;

                while (source === target) {
                    source = keys.all[keys.all.indexOf(atomID) + counter];
                    target = nextAtom(source, keys.all, atoms);
                    counter += 1;
                }

                // Check if bond exists
                if (atoms[atomID].bonds.atoms.indexOf(target) !== -1) {
                    continue;
                }

                // Determine tokens between atoms
                var d = keys.all.indexOf(target) - keys.all.indexOf(atomID);

                // Check for any branches
                if (d > 1) {

                    // Extract keys between atoms
                    var betweenAtoms = keys.all.slice(keys.all.indexOf(atomID) + 1, keys.all.indexOf(target));

                    for (var j = 0; j < betweenAtoms.length; j++) {

                        // Key ID
                        var keyID = betweenAtoms[j];

                        // Check if key exists
                        var bondKey = keys.bonds.indexOf(keyID);
                        var atomKey = keys.atoms.indexOf(keyID);

                        // Check bond type
                        if (bondKey !== -1 && atomKey === -1) {
                            break;
                        }

                        // Assign key
                        var a = atomID + atoms[atomID].name;
                        var b = target + atoms[target].name;

                        var key = newKey(a, b);

                        // Update keys
                        keys.bonds.push(key);

                        // Update bonds
                        var bondName = atoms[atomID].name + atoms[target].name;

                        bonds[key] = addBond(key, 'single', bondName, 1, [atomID, target]);

                        // Update atoms
                        atoms[atomID].bonds.atoms.push(key);
                        atoms[target].bonds.atoms.push(key);

                        // Update total bonding electrons
                        atoms[atomID].bonds.electrons += 1;
                        atoms[target].bonds.electrons += 1;
                    }
                } else if (d === 1) {

                    // Assign key
                    var a = atomID + atoms[atomID].name;
                    var b = target + atoms[target].name;

                    var key = newKey(a, b);

                    // Update keys
                    keys.bonds.push(key);

                    // Add bond
                    var bondName = atoms[atomID].name + atoms[target].name;

                    bonds[key] = addBond(key, 'single', bondName, 1, [atomID, target]);

                    // Update atoms
                    atoms[atomID].bonds.atoms.push(key);
                    atoms[target].bonds.atoms.push(key);

                    // Update total bonding electrons
                    atoms[atomID].bonds.electrons += 1;
                    atoms[target].bonds.electrons += 1;
                }
            }
        }

        // Add implicit hydrogen
        var H = periodic_table.H;

        for (var i = 0; i < keys.atoms.length; i++) {

            // Atom details
            var atomID = keys.atoms[i];
            var atom = atoms[atomID];

            // Check atom group
            if (atom.group < 13) {
                continue;
            }

            // Determine number of hydrogen to add
            var total = 18 - atom.group - atom.bonds.electrons;

            // Adjust total hydrogen for charge
            var charge = atom.properties.charge;

            if (charge > 0) {
                total += -charge;
            } else if (charge < 0) {
                total += charge;
            }

            // Add hydrogens
            if (total <= 0) {
                continue;
            }

            for (var j = 0; j < total; j++) {

                // Assign key
                var key = atomID + atom.name + (j + 1) + 'H';

                // Add hydrogen bond
                bonds[key] = addBond(key, 'hydrogen', atom.name + 'H', 1, [atomID, key]);

                // Add hydrogen atom
                atoms[key] = addAtom(key, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);

                // Update hydrogen properties
                atoms[key].bonds.electrons = 1;
                atoms[key].bonds.atoms.push(key);

                // Update atom properties
                atoms[atomID].bonds.electrons += 1;
                atoms[atomID].bonds.atoms.push(key);
            }
        }

        return [atoms, bonds, keys];
    }

    // Variables
    var atoms = undefined,
        bonds = undefined,
        properties = undefined,
        keys = undefined;

    // 1. Validate
    if (!validateTokens(tokens)) {
        return false;
    }

    // 2. Categorize

    var _readTokens = readTokens(tokens);

    var _readTokens2 = _slicedToArray(_readTokens, 4);

    atoms = _readTokens2[0];
    bonds = _readTokens2[1];
    properties = _readTokens2[2];
    keys = _readTokens2[3];

    // 3. Atoms
    atoms = defaultAtoms(atoms, keys);
    atoms = customAtoms(atoms, properties, keys);

    // 4. Bonds

    var _explicitBonds = explicitBonds(atoms, bonds, keys);

    var _explicitBonds2 = _slicedToArray(_explicitBonds, 3);

    atoms = _explicitBonds2[0];
    bonds = _explicitBonds2[1];
    keys = _explicitBonds2[2];

    var _implicitBonds = implicitBonds(atoms, bonds, keys);

    var _implicitBonds2 = _slicedToArray(_implicitBonds, 3);

    atoms = _implicitBonds2[0];
    bonds = _implicitBonds2[1];
    keys = _implicitBonds2[2];

    return [atoms, bonds];
}

/*
  Utility: compare
   -compare values of two arrays
*/

function compare(a, b) {

    var ab = [];

    // Return binary array
    for (var i = 0; i < a.length; i++) {
        ab[i] = b.indexOf(a[i]) > -1 ? 1 : 0;
    }

    return ab;
}

/*
  Utility: addAtom
   -return new atom
*/

function addAtom(id, name, value) {
    var group = arguments[3] === undefined ? 0 : arguments[3];
    var protons = arguments[4] === undefined ? 0 : arguments[4];
    var neutrons = arguments[5] === undefined ? 0 : arguments[5];
    var electrons = arguments[6] === undefined ? 0 : arguments[6];

    return {

        // Atom name
        id: id,
        name: name,
        value: value,

        // Atom propeties
        group: group,
        protons: protons,
        neutrons: neutrons,
        electrons: electrons,

        // Bond properties
        bonds: {
            electrons: 0,
            chiral: 0,
            atoms: []
        },

        // Other properties
        properties: {
            charge: 0
        }
    };
}

/*
  Utility: addBond
   -return new bond
*/

function addBond(id, name, value) {
    var order = arguments[3] === undefined ? 0 : arguments[3];
    var atoms = arguments[4] === undefined ? [] : arguments[4];

    return {

        //Bond name
        id: id,
        name: name,
        value: value,

        // Bond properties
        order: order,
        atoms: atoms
    };
}

/*
  Utility: nextAtom
   -find key of next atom in array
*/

function nextAtom(start, keys, atoms) {

    // Determine index of key in array
    var index = keys.indexOf(start);

    // Return if key not in array
    if (index === -1) {
        return [];
    }

    // Remove keys before index
    keys = keys.slice(index, keys.length);

    // Determine nearest atom to key
    for (var i = 0; i < keys.length; i++) {

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
    var index = keys.indexOf(start);

    // Return if key not in array
    if (index === -1) {
        return [];
    }

    // Remove keys after index
    keys = keys.slice(0, index).reverse();

    // Determine nearest atom to key
    for (var i = 0; i < keys.length; i++) {

        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }
}

/*
  Exports
*/

exports.tokenize = tokenize;
exports.decode = decode;