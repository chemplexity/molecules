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

var _periodic_table = require('./elements');

/*
  Variable: definitions
  --regular expressions for SMILES grammar
*/

var definitions = [{ type: 'atom', term: 'H', tag: 'H', expression: /[A-Z]?H(?=[^efgos]|$)([0-9]?)+/g }, { type: 'atom', term: 'B', tag: 'B', expression: /B(?=[^aehikr]|$)/g }, { type: 'atom', term: 'C', tag: 'C', expression: /C(?=[^adeflmnorsu]|$)/g }, { type: 'atom', term: 'N', tag: 'N', expression: /N(?=[^abdeiop]|$)/g }, { type: 'atom', term: 'O', tag: 'O', expression: /O(?=[^s]|$)/g }, { type: 'atom', term: 'F', tag: 'F', expression: /F(?=[^elmr]|$)/g }, { type: 'atom', term: 'Si', tag: 'Si', expression: /Si/g }, { type: 'atom', term: 'P', tag: 'P', expression: /P(?=[^abdmortu]|$)/g }, { type: 'atom', term: 'S', tag: 'S', expression: /S(?=[^bcegimnr]|$)/g }, { type: 'atom', term: 'Cl', tag: 'Cl', expression: /Cl/g }, { type: 'atom', term: 'Se', tag: 'Se', expression: /Se/g }, { type: 'atom', term: 'Br', tag: 'Br', expression: /Br/g }, { type: 'atom', term: 'I', tag: 'I', expression: /I(?=[^nr]|$)/g }, { type: 'atom', term: '*', tag: '*', expression: /[*]/g }, { type: 'atom', term: 'b', tag: 'B', expression: /b(?=[^aehikr]|$)/g }, { type: 'atom', term: 'c', tag: 'C', expression: /c(?=[^adeflmnorsu]|$)/g }, { type: 'atom', term: 'n', tag: 'N', expression: /n(?=[^abdeiop]|$)/g }, { type: 'atom', term: 'o', tag: 'O', expression: /o(?=[^s]|$)/g }, { type: 'atom', term: 'p', tag: 'P', expression: /p(?=[^abdmortu]|$)/g }, { type: 'atom', term: 's', tag: 'S', expression: /s(?=[^bcegimnr]|$)/g }, { type: 'atom', term: 'se', tag: 'Se', expression: /se/g }, { type: 'bond', term: '-', tag: 'single', expression: /(?=[^d])[-](?=[^d])/g }, { type: 'bond', term: '=', tag: 'double', expression: /[=]/g }, { type: 'bond', term: '#', tag: 'triple', expression: /[#]/g }, { type: 'bond', term: '(', tag: 'branch', expression: /[(]/g }, { type: 'bond', term: ')', tag: 'branch', expression: /[)]/g }, { type: 'bond', term: '%', tag: 'ring', expression: /(?=[^+-])(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[%]?\d(?=([^+-]|$))/g }, { type: 'bond', term: '.', tag: 'dot', expression: /[A-Z][+-]?[\[]?[.]/g }, { type: 'property', term: '+', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g }, { type: 'property', term: '-', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g }, { type: 'property', term: 'n', tag: 'isotope', expression: /(?:[\[])[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g }, { type: 'property', term: '@', tag: 'chiral', expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g }, { type: 'property', term: '@@', tag: 'chiral', expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g }];

/*
  Method: tokenize
  --parse input string for valid SMILES definitions

  Syntax
    tokens = tokenize(input)

  Arguments
    input : any SMILES encoded string

  Output
    tokens : array of token objects

  Examples
    tokens123 = tokenize('CC(=O)CC')
    tokensABC = tokenize('c1cccc1')
*/

function tokenize(input) {
    var tokens = arguments[1] === undefined ? [] : arguments[1];
    var header = arguments[2] === undefined ? [] : arguments[2];

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
  Method: decode
  --convert SMILES tokens into atoms (nodes) and bonds (edges)

  Syntax
    {atoms, bonds} = decode(tokens)

  Arguments
    tokens : array of tokens obtained from the output of 'tokenize'

  Output
    {atoms, bonds} : array of atom/bond objects describing connectivity and properties

  Examples
    {atoms, bonds} = decode(mytokensABC)
    {atoms, bonds} = decode(tokens123)
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

            // Check for token header
            if (tokens[i].index === 'header') {
                continue;
            }

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
                var element = _periodic_table.periodic_table[atoms[key].name];

                // Element properties
                atoms[key].group = element.group;
                atoms[key].protons = element.protons;
                atoms[key].neutrons = element.neutrons;
                atoms[key].electrons = element.electrons;

                // Bond properties
                atoms[key].bonds = {
                    electrons: 0,
                    atoms: []
                };

                // Other properties
                atoms[key].properties = {
                    chiral: 0,
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

                        atoms[key].properties.chiral = value.slice(value.indexOf('@'));
                        break;

                    // Set neutrons
                    case 'isotope':

                        // Check neutrons
                        var neutrons = value.match(/[0-9]+/g);

                        // Determine atom key
                        var atomKey = 1 + neutrons.toString().length;

                        // Check value
                        if (neutrons > 0 && neutrons < 250) {

                            // Subtract number of protons
                            neutrons = neutrons - atoms[atomKey].protons;

                            if (neutrons > 0) {
                                atoms[atomKey].neutrons = neutrons;
                                break;
                            }
                        }

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
            return [atoms, bonds, keys];
        }

        // Add explicit bonds
        for (var i = 0; i < keys.bonds.length; i++) {

            // Retrieve bond key
            var bondID = keys.bonds[i];

            // Retrieve source/target atoms
            var sourceAtom = atoms[previousAtom(bondID, keys.all, atoms)],
                targetAtom = atoms[nextAtom(bondID, keys.all, atoms)];

            // Determine index values
            var sourceIndex = keys.all.indexOf(sourceAtom.id),
                targetIndex = keys.all.indexOf(targetAtom.id),
                bondIndex = keys.all.indexOf(bondID);

            // Check for exceptions
            var exceptions = 0;

            if (targetIndex > bondIndex && bondIndex > sourceIndex) {

                // Check previous bond
                if (bonds[keys.all[bondIndex - 1]] !== undefined) {

                    // Determine bond values
                    var bond1 = bonds[keys.all[bondIndex - 1]].value,
                        bond2 = bonds[bondID].value;

                    // Exception #1: bond symbol follows branch end
                    if (bond1 === ')' && (bond2 === '-' || bond2 === '=' || bond2 === '#' || bond2 === '.')) {
                        exceptions = 1;
                    }
                }
            }

            // Bond type
            switch (bonds[bondID].name) {

                case 'single':
                    if (exceptions === 1) {
                        continue;
                    }
                    bonds[bondID].order = 1;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'double':
                    if (exceptions === 1) {
                        continue;
                    }
                    bonds[bondID].order = 2;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'triple':
                    if (exceptions === 1) {
                        continue;
                    }
                    bonds[bondID].order = 3;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'dot':
                    if (exceptions === 1) {
                        continue;
                    }
                    bonds[bondID].order = 0;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'branch':

                    // Keys before and after branch
                    var keysBefore = keys.all.slice(0, bondIndex).reverse(),
                        keysAfter = keys.all.slice(bondIndex + 1, keys.all.length);

                    // Branch type
                    switch (bonds[bondID].value) {

                        // Start branch
                        case '(':

                            // Find start of branch
                            for (var j = 0, skip = 0; j < keysBefore.length; j++) {

                                // Retrieve source atom
                                sourceAtom = atoms[keysBefore[j]];

                                // Update bond
                                if (sourceAtom !== undefined && skip === 0) {
                                    bonds[bondID].order = 1;
                                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                                    break;
                                }

                                // Check for nested branch
                                else if (bonds[keysBefore[j]] !== undefined) {
                                    switch (bonds[keysBefore[j]].value) {
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
                            for (var j = 0, skip = 1; j < keysBefore.length; j++) {

                                // Retrieve source atom
                                sourceAtom = atoms[keysBefore[j]];

                                // Update bond
                                if (sourceAtom !== undefined && skip === 0) {
                                    bonds[bondID].order = 1;
                                    bonds[bondID].atoms[0] = sourceAtom.id;
                                    break;
                                }

                                // Check for nested branch
                                else if (bonds[keysBefore[j]] !== undefined) {
                                    switch (bonds[keysBefore[j]].value) {
                                        case ')':
                                            skip++;break;
                                        case '(':
                                            skip--;break;
                                    }
                                }
                            }

                            // Find end of branch
                            for (var j = 0, bondOrder = 1, skip = 0; j < keysAfter.length; j++) {

                                // Update bond order
                                if (bonds[keysAfter[j]] !== undefined && skip === 0) {

                                    switch (bonds[keysAfter[j]].value) {
                                        case '-':
                                            bondOrder = 1;break;
                                        case '=':
                                            bondOrder = 2;break;
                                        case '#':
                                            bondOrder = 3;break;
                                        case '.':
                                            bondOrder = 0;break;
                                    }
                                }

                                // Update bond
                                if (atoms[keysAfter[j]] !== undefined && skip === 0) {
                                    bonds[bondID].order = bondOrder;
                                    bonds[bondID].atoms[1] = atoms[keysAfter[j]].id;
                                    break;
                                }

                                // Check for nested branch
                                else if (bonds[keysAfter[j]] !== undefined) {
                                    switch (bonds[keysAfter[j]].value) {
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

                    // Keys after ring
                    var bondsAfter = keys.bonds.slice(keys.bonds.indexOf(bondID), keys.bonds.length);

                    // Find matching ring atom
                    for (var j = 0; j < bondsAfter.length; j++) {

                        // Check for existing bond
                        if (bonds[bondID].atoms.length > 0 || j === 0) {
                            continue;
                        }

                        // Determine ring number
                        var ringID = /[0-9]+/g;

                        var sourceBond = bonds[bondID].value.match(ringID);
                        var targetBond = bonds[bondsAfter[j]].value.match(ringID);

                        // Add bond
                        if (sourceBond !== null && targetBond !== null && sourceBond[0] === targetBond[0]) {

                            bonds[bondID].order = 1;
                            bonds[bondID].atoms = [bondID, bondsAfter[j]];
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

                // Bond key
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
                keys.bonds.splice(i, 1);
                i--;
            }
        }

        // Add bond references to all atoms
        for (var i = 0; i < keys.bonds.length; i++) {

            // Bond key
            var bondID = keys.bonds[i];

            // Atom keys
            var sourceID = bonds[bondID].atoms[0],
                targetID = bonds[bondID].atoms[1];

            // Check keys
            if (sourceID === undefined || targetID === undefined) {
                continue;
            }

            // Add bond reference to atom
            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[targetID].bonds.atoms.push(sourceID);

            // Update total bonding electrons
            atoms[sourceID].bonds.electrons += bonds[bondID].order;
            atoms[targetID].bonds.electrons += bonds[bondID].order;
        }

        return [atoms, bonds, keys];
    }

    // Implicit bonds
    function implicitBonds(atoms, bonds, keys) {

        // Add bonds between adjacent atoms
        for (var i = 0; i < keys.atoms.length; i++) {

            // Check conditions to proceed
            if (keys.atoms.length === i + 1) {
                continue;
            }

            // Retrieve atoms
            var sourceAtom = atoms[keys.atoms[i]],
                targetAtom = atoms[keys.atoms[i + 1]];

            // Determine electrons available
            var sourceElectrons = 18,
                targetElectrons = 18;

            // Check for hydrogen
            if (sourceAtom.group === 1) {
                sourceElectrons = 2;
            }
            if (targetAtom.group === 1) {
                targetElectrons = 2;
            }

            var sourceTotal = sourceElectrons - sourceAtom.group - sourceAtom.bonds.electrons,
                targetTotal = targetElectrons - targetAtom.group - targetAtom.bonds.electrons;

            // Account for atom charge
            if (sourceAtom.properties.charge > 0) {
                sourceTotal -= sourceAtom.properties.charge;
            }
            if (targetAtom.properties.charge > 0) {
                targetTotal -= targetAtom.properties.charge;
            }

            // Check electrons available
            if (sourceTotal <= 0 || targetTotal <= 0) {
                continue;
            }

            // Check if bond exists
            if (sourceAtom.bonds.atoms.indexOf(targetAtom.id) !== -1) {
                continue;
            }

            // Determine number of tokens between source/target atoms
            var n = keys.all.indexOf(targetAtom.id) - keys.all.indexOf(sourceAtom.id),
                exceptions = 0;

            // Check tokens preventing implicit bond
            if (n > 1) {

                // Extract all keys between source/target atoms
                var keysBetween = keys.all.slice(keys.all.indexOf(sourceAtom.id) + 1, keys.all.indexOf(targetAtom.id));

                for (var j = 0; j < keysBetween.length; j++) {

                    // Check for bond symbol
                    if (bonds[keysBetween[j]] !== undefined) {
                        if (bonds[keysBetween[j]].name !== 'ring') {
                            exceptions = 1;
                        }
                    }
                }
            }

            // Check for exceptions
            if (exceptions === 0) {

                // Assign new bond key
                var bondID = sourceAtom.name + sourceAtom.id + (targetAtom.name + targetAtom.id),
                    bondName = sourceAtom.name + targetAtom.name;

                // Update bonds
                keys.bonds.push(bondID);
                bonds[bondID] = addBond(bondID, 'single', bondName, 1, [sourceAtom.id, targetAtom.id]);

                // Update atoms
                atoms[sourceAtom.id].bonds.atoms.push(targetAtom.id);
                atoms[targetAtom.id].bonds.atoms.push(sourceAtom.id);

                // Update electron count
                atoms[sourceAtom.id].bonds.electrons += 1;
                atoms[targetAtom.id].bonds.electrons += 1;
            }
        }

        // Add implicit hydrogen
        var H = _periodic_table.periodic_table.H;

        for (var i = 0; i < keys.atoms.length; i++) {

            // Retrieve atoms
            var sourceAtom = atoms[keys.atoms[i]];

            // Check atom group
            if (sourceAtom.group < 13) {
                continue;
            }

            // Determine number of hydrogen to add
            var sourceTotal = 18 - sourceAtom.group - sourceAtom.bonds.electrons;

            // Account for atom charge
            if (sourceAtom.properties.charge > 0) {
                sourceTotal -= sourceAtom.properties.charge;
            }

            // Check electrons available
            if (sourceTotal <= 0) {
                continue;
            }

            // Add hydrogen
            for (var j = 0; j < sourceTotal; j++) {

                // Assign new bond key
                var bondID = 'H' + (j + 1) + sourceAtom.name + sourceAtom.id,
                    bondName = sourceAtom.name + 'H';

                // Assign new atom name
                var atomName = sourceAtom.name + 'H';

                // Add hydrogen atom/bond
                atoms[bondID] = addAtom(bondID, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);
                bonds[bondID] = addBond(bondID, 'hydrogen', bondName, 1, [sourceAtom.id, bondID]);

                // Update atoms
                atoms[sourceAtom.id].bonds.atoms.push(bondID);
                atoms[bondID].bonds.atoms.push(sourceAtom.id);

                // Update electron count
                atoms[sourceAtom.id].bonds.electrons += 1;
                atoms[bondID].bonds.electrons += 1;
            }
        }

        return [atoms, bonds, keys];
    }

    // Variables
    var atoms = undefined,
        bonds = undefined,
        properties = undefined,
        keys = undefined;

    // 1. Validate tokens
    if (!validateTokens(tokens)) {
        return false;
    }

    // 2. Categorize tokens

    var _readTokens = readTokens(tokens);

    var _readTokens2 = _slicedToArray(_readTokens, 4);

    atoms = _readTokens2[0];
    bonds = _readTokens2[1];
    properties = _readTokens2[2];
    keys = _readTokens2[3];

    // 3. Add atoms
    atoms = defaultAtoms(atoms, keys);
    atoms = customAtoms(atoms, properties, keys);

    // 4. Add bonds

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

    return { atoms: atoms, bonds: bonds };
}

/*
  Utility: compare
  --compare values across two arrays
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
  --return new atom
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
            atoms: []
        },

        // Other properties
        properties: {
            chiral: 0,
            charge: 0
        }
    };
}

/*
  Utility: addBond
  --return new bond
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
  --find key of next atom in array
*/

function nextAtom(start, keys, atoms) {

    if (start === '0') {
        return '0';
    }

    // Determine index of key in array
    var index = keys.indexOf(start);
    if (index === -1) {
        return null;
    }

    // Remove keys before index
    keys = keys.slice(index, keys.length);

    // Determine nearest atom to key
    for (var i = 1; i < keys.length; i++) {
        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }

    return null;
}

/*
  Utility: previousAtom
  --find key of previous atom in array
*/

function previousAtom(start, keys, atoms) {

    if (start === '0') {
        return '0';
    }

    // Determine index of key in array
    var index = keys.indexOf(start);
    if (index === -1) {
        return null;
    }

    // Remove keys after index
    keys = keys.slice(0, index).reverse();

    // Determine nearest atom to key
    for (var i = 0; i < keys.length; i++) {
        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }

    return null;
}

/*
  Exports
*/

exports.tokenize = tokenize;
exports.decode = decode;