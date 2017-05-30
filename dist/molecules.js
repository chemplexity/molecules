(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Molecules = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * File        : smiles.js
 * Description : parse SMILES chemical line notation
 *
 * Options     : grammar, tokenize, decode
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _slicedToArray = (function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i['return']) _i['return'](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError('Invalid attempt to destructure non-iterable instance'); } }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _utilitiesReference = require('./../utilities/reference');

var _utilitiesReference2 = _interopRequireDefault(_utilitiesReference);

/**
 * Name        : grammar
 * Description : regular expressions for parsing SMILES string
 *
 * Properties
 *   type       : token category
 *   term       : SMILES symbol
 *   tag        : token definition
 *   expression : SMILES regular expression
 */

var grammar = [{ type: 'atom', term: 'H', tag: 'H', expression: /(?=[A-Z])H(?=[^efgos]|$)([0-9]?)+/g }, { type: 'atom', term: 'D', tag: 'H', expression: /(?=[A-Z])D(?=[^bsy]|$)([0-9]?)+/g }, { type: 'atom', term: 'He', tag: 'He', expression: /He/g }, { type: 'atom', term: 'Li', tag: 'Li', expression: /Li/g }, { type: 'atom', term: 'Be', tag: 'Be', expression: /Be/g }, { type: 'atom', term: 'B', tag: 'B', expression: /B(?=[^aehikr]|$)/g }, { type: 'atom', term: 'C', tag: 'C', expression: /C(?=[^adeflmnorsu]|$)/g }, { type: 'atom', term: 'N', tag: 'N', expression: /N(?=[^abdeiop]|$)/g }, { type: 'atom', term: 'O', tag: 'O', expression: /O(?=[^s]|$)/g }, { type: 'atom', term: 'F', tag: 'F', expression: /F(?=[^elmr]|$)/g }, { type: 'atom', term: 'Ne', tag: 'Ne', expression: /Ne/g }, { type: 'atom', term: 'Na', tag: 'Na', expression: /Na/g }, { type: 'atom', term: 'Mg', tag: 'Mg', expression: /Mg/g }, { type: 'atom', term: 'Al', tag: 'Al', expression: /Al/g }, { type: 'atom', term: 'Si', tag: 'Si', expression: /Si/g }, { type: 'atom', term: 'P', tag: 'P', expression: /P(?=[^abdmortu]|$)/g }, { type: 'atom', term: 'S', tag: 'S', expression: /S(?=[^bcegimnr]|$)/g }, { type: 'atom', term: 'Cl', tag: 'Cl', expression: /Cl/g }, { type: 'atom', term: 'Ar', tag: 'Ar', expression: /Ar/g }, { type: 'atom', term: 'As', tag: 'As', expression: /As/g }, { type: 'atom', term: 'Se', tag: 'Se', expression: /Se/g }, { type: 'atom', term: 'Br', tag: 'Br', expression: /Br/g }, { type: 'atom', term: 'I', tag: 'I', expression: /I(?=[^nr]|$)/g },
//{type: 'atom',     term: '*',  tag: '*',       expression: /[*]/g},
{ type: 'atom', term: 'b', tag: 'B', expression: /b(?=[^e]|$)/g }, { type: 'atom', term: 'c', tag: 'C', expression: /c(?=[^l]|$)/g }, { type: 'atom', term: 'n', tag: 'N', expression: /n(?=[^ae]|$)/g }, { type: 'atom', term: 'o', tag: 'O', expression: /o(?=[^s]|$)/g }, { type: 'atom', term: 'p', tag: 'P', expression: /p/g }, { type: 'atom', term: 's', tag: 'S', expression: /s(?=[^ei]|$)/g }, { type: 'atom', term: 'se', tag: 'Se', expression: /se/g }, { type: 'bond', term: '-', tag: 'single', expression: /(?=([^0-9]))[-](?=[^0-9-\]])/g }, { type: 'bond', term: '=', tag: 'double', expression: /[=]/g }, { type: 'bond', term: '#', tag: 'triple', expression: /[#]/g }, { type: 'bond', term: '(', tag: 'branch', expression: /[(]/g }, { type: 'bond', term: ')', tag: 'branch', expression: /[)]/g }, { type: 'bond', term: '%', tag: 'ring', expression: /(?=[^+-])(?:[a-zA-Z]{1,2}[@]{1,2})?(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[%]?\d+(?=([^+]|$))/g }, { type: 'bond', term: '.', tag: 'dot', expression: /(?:[A-Z][+-]?[\[])?[.]/g }, { type: 'property', term: '+', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g }, { type: 'property', term: '-', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g }, { type: 'property', term: 'n', tag: 'isotope', expression: /(?:[\[])[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g }, { type: 'property', term: 'S', tag: 'chiral', expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g }, { type: 'property', term: 'R', tag: 'chiral', expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g }];

/**
 * Method      : tokenize(input)
 * Description : parse string with SMILES grammar
 */

function tokenize(input) {
    var tokens = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];

    // Parse input with SMILES grammar
    for (var i = 0; i < grammar.length; i++) {

        var token = grammar[i];
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

    // Check tokens for exceptions
    for (var i = 0; i < tokens.length; i++) {

        // Check for multi-digit ring number
        if (tokens[i].tag === 'ring') {

            // Get ring number
            var ringID = tokens[i].term.match(/[0-9]+/g);

            // Limit to first match
            if (ringID !== null) {
                ringID = ringID[0];
            } else {
                continue;
            }

            // Confirm ring number is valid
            if (ringID.length > 1) {

                var exception = 0;

                // Check tokens for matching ring number
                for (var j = 0; j < tokens.length; j++) {

                    if (i === j || tokens[j].tag !== 'ring') {
                        continue;
                    }

                    // Get ring number
                    var checkID = tokens[j].term.match(/[0-9]+/g);

                    if (checkID !== null) {
                        checkID = checkID[0];
                    } else {
                        continue;
                    }

                    // Compare ring numbers
                    if (ringID === checkID) {
                        exception = 1;
                        break;
                    }
                }

                // Matching ring number found
                if (exception === 1) {
                    continue;
                }

                // Get ring prefix
                var prefix = tokens[i].term.match(/[a-zA-Z]/g)[0];

                // Parse multi-digit ring number
                for (var j = 0; j < ringID.length; j++) {

                    // Create new tokens
                    tokens.splice(i + 1, 0, {
                        index: tokens[i].index + j,
                        type: tokens[i].type,
                        term: prefix + ringID.substr(j, j + 1),
                        tag: tokens[i].tag
                    });
                }

                // Remove original token
                tokens.splice(i, 1);
            }
        }
    }

    return { tokens: tokens };
}

/**
 * Method      : decode(tokens)
 * Description : convert SMILES tokens into atoms (nodes) and bonds (edges)
 */

function decode(tokens) {

    function validateTokens(tokens) {

        // Check input type
        if (typeof tokens !== 'object') {
            console.log('Error: Tokens must be of type "object"');
            return false;
        } else if (tokens.tokens !== undefined) {
            tokens = tokens.tokens;
        }

        // Check tokens for required fields
        var fields = ['index', 'type', 'term', 'tag'];

        for (var i = 0; i < tokens.length; i++) {

            // Compare fields
            var match = compareArrays(fields, Object.keys(tokens[i]));

            // Check for invalid tokens
            if (match.reduce(function (a, b) {
                return a + b;
            }) < 4) {
                console.log('Error: Invalid token at index "' + i + '"');
                return false;
            }
        }

        return tokens;
    }

    function readTokens(tokens) {
        var atoms = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
        var bonds = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];
        var properties = arguments.length <= 3 || arguments[3] === undefined ? {} : arguments[3];
        var keys = arguments.length <= 4 || arguments[4] === undefined ? {} : arguments[4];

        // Parse tokens by category
        for (var i = 0; i < tokens.length; i++) {

            // Get token info
            var _tokens$i = tokens[i];
            var type = _tokens$i.type;
            var term = _tokens$i.term;
            var tag = _tokens$i.tag;
            var index = _tokens$i.index;

            // Use token index as key
            var key = index.toString();

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

        // Extract token keys
        keys.all = [];

        for (var i = 0; i < tokens.length; i++) {
            keys.all[i] = tokens[i].index.toString();
        }

        // Check number of atoms
        if (atoms.length < 1) {
            console.log('Error: Could not find atoms');
            return false;
        }

        // Get token keys by category
        keys.atoms = Object.keys(atoms);
        keys.bonds = Object.keys(bonds);
        keys.properties = Object.keys(properties);

        return [atoms, bonds, properties, keys];
    }

    function defaultAtoms(atoms, keys) {

        for (var i = 0; i < keys.atoms.length; i++) {

            var atomID = keys.atoms[i];

            // Check element
            if (_utilitiesReference2['default'][atoms[atomID].name] === undefined) {
                continue;
            }

            // Element information
            var element = _utilitiesReference2['default'][atoms[atomID].name];

            // Exception: 'deuterium'
            if (atoms[atomID].value === 'D') {
                element = _utilitiesReference2['default'][atoms[atomID].value];
            }

            // Element properties
            atoms[atomID].group = element.group;
            atoms[atomID].protons = element.protons;
            atoms[atomID].neutrons = element.neutrons;
            atoms[atomID].electrons = element.electrons;

            // Bond properties
            atoms[atomID].bonds = {
                id: [],
                atoms: [],
                electrons: 0
            };

            // Other properties
            atoms[atomID].properties = {
                chiral: 0,
                charge: 0,
                aromatic: 0
            };

            // Check aromatic
            if (atoms[atomID].value === atoms[atomID].value.toLowerCase()) {
                atoms[atomID].properties.aromatic = 1;
            }
        }

        return atoms;
    }

    function updateAtoms(atoms, properties, keys) {

        for (var i = 0; i < keys.properties.length; i++) {

            var propertyID = keys.properties[i];

            // Get properties
            var _properties$propertyID = properties[propertyID];
            var _name = _properties$propertyID.name;
            var value = _properties$propertyID.value;

            // Update atom properties
            switch (_name) {

                case 'chiral':

                    if (atoms[propertyID] !== undefined) {

                        // Update chiral property
                        atoms[propertyID].properties.chiral = value.slice(value.indexOf('@'));
                        break;
                    }

                    break;

                case 'isotope':

                    // Get isotope number and id
                    var isotope = value.match(/[0-9]+/g);
                    var atomID = 1 + isotope.toString().length + parseInt(propertyID);

                    // Check value
                    if (isotope >= 0 && isotope < 250 && atoms[atomID] !== undefined) {

                        // Subtract protons from isotope number
                        var neutrons = isotope - atoms[atomID].protons;

                        if (neutrons >= 0) {
                            atoms[atomID].neutrons = neutrons;
                            break;
                        }
                    }

                    break;

                case 'charge':

                    // Charge type (positive/negative)
                    var sign = value.indexOf('+') !== -1 ? 1 : -1;

                    // Check for numeric charge (e.g. '3+')
                    var charge = value.match(/(?:[^H])[0-9]+/g);

                    if (charge !== null && atoms[propertyID] !== undefined) {

                        // Update charge
                        charge = charge[0].substr(1);
                        atoms[propertyID].properties.charge = charge * sign;
                        break;
                    }

                    // Check for symbolic charge (e.g. '+++')
                    charge = value.match(/([+]+|[-]+)/g);

                    if (charge !== null && atoms[propertyID] !== undefined) {

                        // Update charge
                        atoms[propertyID].properties.charge = charge[0].length * sign;
                        break;
                    }

                    break;
            }
        }

        return atoms;
    }

    function explicitBonds(atoms, bonds, keys) {

        if (keys.bonds.length === 0 || keys.bonds === undefined) {
            return [atoms, bonds, keys];
        }

        // Add bonds
        for (var i = 0; i < keys.bonds.length; i++) {

            // Get bond key
            var bondID = keys.bonds[i];

            // Get source/target atoms
            var sourceAtom = atoms[previousAtom(bondID, keys.all, atoms)];
            var targetAtom = atoms[nextAtom(bondID, keys.all, atoms)];

            // Get bond index
            var bondIndex = keys.all.indexOf(bondID);
            var sourceIndex = 0;
            var targetIndex = 0;

            // Validate source atom
            if (sourceAtom !== undefined && sourceAtom !== null) {

                // Get source index
                sourceIndex = keys.atoms.indexOf(sourceAtom.id);

                // Check source atom for hydrogen
                if ((bonds[bondID].name === 'double' || bonds[bondID].name === 'triple') && sourceAtom.name === 'H') {

                    // Change source atom to nearest non-hydrogen atom
                    while ((sourceAtom.name === 'H' || atoms[keys.atoms[sourceIndex]] === undefined) && sourceIndex > -1) {
                        sourceAtom = atoms[keys.atoms[sourceIndex]];
                        sourceIndex -= 1;
                    }
                }

                // Update source index
                sourceIndex = keys.all.indexOf(sourceAtom.id);
            }

            if (sourceIndex < 0) {
                continue;
            }

            // Get target index
            if (targetAtom !== undefined && targetAtom !== null) {
                targetIndex = keys.all.indexOf(targetAtom.id);
            }

            // Check for exceptions
            var exceptions = 0;

            if (targetIndex > bondIndex && bondIndex > sourceIndex) {

                // Check previous bond
                if (bonds[keys.all[bondIndex - 1]] !== undefined) {

                    var bond1 = bonds[keys.all[bondIndex - 1]].value;
                    var bond2 = bonds[bondID].value;

                    // Case: bond declared next to branch (e.g. 'CC(CC)=CC' or 'CC(=CC)CC')
                    switch (bond1) {
                        case ')':
                        case '(':

                            switch (bond2) {
                                case '-':
                                case '=':
                                case '#':
                                case '.':

                                    exceptions = 1;
                            }
                    }

                    //if ((bond1 === ')' || bond1 === '(') && (bond2 === '-' || bond2 === '=' || bond2 === '#' || bond2 === '.')) {
                    //    exceptions = 1;
                    //}
                }
            }

            // Bond type
            switch (bonds[bondID].name) {

                case 'single':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
                        continue;
                    }
                    bonds[bondID].order = 1;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'double':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
                        continue;
                    } else if (targetAtom.name === 'H') {
                        continue;
                    }

                    bonds[bondID].order = 2;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'triple':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
                        continue;
                    } else if (targetAtom.name === 'H') {
                        continue;
                    }

                    bonds[bondID].order = 3;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'dot':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) {
                        continue;
                    }
                    bonds[bondID].order = 0;
                    //bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'branch':

                    // Keys before/after branch
                    var keysBefore = keys.all.slice(0, bondIndex).reverse(),
                        keysAfter = keys.all.slice(bondIndex + 1, keys.all.length);

                    // Branch type
                    switch (bonds[bondID].value) {

                        // Start branch
                        case '(':

                            // Find start of branch
                            for (var j = 0, skip = 0; j < keysBefore.length; j++) {

                                // Determine source atom
                                sourceAtom = atoms[keysBefore[j]];

                                // Update bond
                                if (sourceAtom !== undefined && sourceAtom.name !== 'H' && skip === 0) {

                                    // Default bond properties
                                    var bondOrder = 1;

                                    // Check aromatic ring
                                    if (sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
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

                            // Find target atom
                            for (var j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {

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

                                // Update bond order
                                if (skip === 0) {
                                    bonds[bondID].order = bondOrder;
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

                        // End branch
                        case ')':

                            // Find start of branch
                            for (var j = 0, skip = 1; j < keysBefore.length; j++) {

                                // Retrieve source atom
                                sourceAtom = atoms[keysBefore[j]];

                                // Update bond
                                if (sourceAtom !== undefined && sourceAtom.name !== 'H' && skip === 0) {

                                    // Default bond properties
                                    var bondOrder = 1;

                                    // Check aromatic ring
                                    if (sourceAtom.properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
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
                            for (var j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {

                                // Retrieve target atom
                                targetAtom = atoms[keysAfter[j]];

                                // Update bond
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
                                if (targetAtom !== undefined && skip === 0) {

                                    // Check aromatic ring
                                    if (targetAtom.properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
                                    bonds[bondID].atoms[1] = targetAtom.id;
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

                case 'ring':

                    var sourceID = bonds[bondID].value.match(/[0-9]+/g);

                    // Keys before/after ring token
                    var bondsBefore = keys.bonds.slice(0, keys.bonds.indexOf(bondID)),
                        bondsAfter = keys.bonds.slice(keys.bonds.indexOf(bondID), keys.bonds.length);

                    // Check keys after ring token
                    for (var j = 1; j < bondsAfter.length; j++) {

                        if (bonds[bondsAfter[j]].name !== 'ring') {
                            continue;
                        }

                        var targetID = bonds[bondsAfter[j]].value.match(/[0-9]+/g),
                            _targetIndex = bondsAfter[j],
                            _sourceIndex = bondID;

                        if (sourceID !== null && targetID !== null && sourceID[0] === targetID[0]) {

                            while (atoms[_sourceIndex] === undefined && _sourceIndex >= -1) {
                                _sourceIndex -= 1;
                            }
                            while (atoms[_targetIndex] === undefined && _targetIndex >= -1) {
                                _targetIndex -= 1;
                            }

                            if (_sourceIndex === -1 || _targetIndex === -1) {
                                break;
                            }

                            // Update bond
                            var bondOrder = 1;

                            // Check aromatic
                            if (atoms[_sourceIndex].properties.aromatic === 1 && atoms[_targetIndex].properties.aromatic === 1) {
                                bondOrder = 1.5;
                            }

                            bonds[bondID].order = bondOrder;
                            bonds[bondID].atoms = [_sourceIndex.toString(), _targetIndex.toString()];

                            break;
                        }

                        // Check keys before ring token
                        if (j === bondsAfter.length - 1) {

                            // Find matching ring atom
                            for (var k = 0; k < bondsBefore.length; k++) {

                                if (bonds[bondsAfter[j]].name !== 'ring') {
                                    continue;
                                }

                                var _targetID = bonds[bondsBefore[k]].value.match(/[0-9]+/g),
                                    _targetIndex2 = bondID,
                                    _sourceIndex2 = bondsBefore[k];

                                if (sourceID !== null && _targetID !== null && sourceID[0] === _targetID[0]) {

                                    // Determine atom index
                                    while (atoms[_sourceIndex2] === undefined && _sourceIndex2 >= -1) {
                                        _sourceIndex2 -= 1;
                                    }
                                    while (atoms[_targetIndex2] === undefined && _targetIndex2 >= -1) {
                                        _targetIndex2 -= 1;
                                    }

                                    if (_sourceIndex2 === -1 || _targetIndex2 === -1) {
                                        break;
                                    }

                                    // Update bond
                                    var bondOrder = 1;

                                    // Check aromatic
                                    if (atoms[_sourceIndex2].properties.aromatic === 1 && atoms[_targetIndex2].properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
                                    bonds[bondID].atoms = [_sourceIndex2.toString(), _targetIndex2.toString()];

                                    break;
                                }
                            }
                        }
                    }

                    break;
            }
        }

        // Remove duplicate bonds
        for (var i = 0; i < keys.bonds.length; i++) {

            // Check for empty key
            if (keys.bonds[i] === undefined) {
                keys.bonds.splice(i, 1);
                i--;
                continue;
            }

            // Check for empty bond
            if (bonds[keys.bonds[i]].atoms.length !== 2) {
                delete bonds[keys.bonds[i]];
                keys.bonds.splice(i, 1);
                i--;
                continue;
            }

            if (i === keys.bonds.length - 1) {
                continue;
            }

            // Extract bonds after index
            var bondsAfter = keys.bonds.slice(i, keys.bonds.length);

            // Check for duplicate/empty bonds
            for (var j = 0; j < bondsAfter.length; j++) {

                if (j === 0) {
                    continue;
                }

                // Bond keys
                var bondID = bondsAfter[j],
                    a = bonds[keys.bonds[i]],
                    b = bonds[bondID];

                if (a === undefined || b === undefined) {
                    continue;
                }

                // Compare atom keys
                if (a.atoms[0] === b.atoms[0] && a.atoms[1] === b.atoms[1] || a.atoms[0] === b.atoms[1] && a.atoms[1] === b.atoms[0]) {

                    // Duplicate ring bond
                    if (a.name === 'ring' && b.name === 'ring') {
                        delete bonds[bondID];
                        keys.bonds.splice(keys.bonds.indexOf(bondID), 1);
                    }

                    // Duplicate branching bonds
                    else if (a.name === 'branch' && (b.name === 'single' || b.name === 'double' || b.name === 'triple')) {
                            delete bonds[keys.bonds[i]];
                            keys.bonds.splice(i, 1);
                        } else if ((a.name === 'single' || a.name === 'double' || a.name === 'triple') && b.name === 'branch') {
                            delete bonds[bondID];
                            keys.bonds.splice(keys.bonds.indexOf(bondID), 1);
                        }

                        // Other duplicate bonds
                        else {
                                delete bonds[keys.bonds[i]];
                                keys.bonds.splice(i, 1);
                            }

                    i--;
                    break;
                }
            }
        }

        // Add bond references to all atoms
        for (var i = 0; i < keys.bonds.length; i++) {

            // Bond key
            var bondID = keys.bonds[i];

            // Atom keys
            var sourceID = bonds[bondID].atoms[0],
                targetID = bonds[bondID].atoms[1];

            if (sourceID === undefined || targetID === undefined) {
                continue;
            }

            // Add bond reference to atom
            atoms[sourceID].bonds.id.push(bondID);
            atoms[targetID].bonds.id.push(bondID);

            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[targetID].bonds.atoms.push(sourceID);

            atoms[sourceID].bonds.electrons += bonds[bondID].order;
            atoms[targetID].bonds.electrons += bonds[bondID].order;
        }

        return [atoms, bonds, keys];
    }

    function implicitBonds(atoms, bonds, keys) {

        // Calculate valence electrons
        var valence = function valence(group) {
            var electrons = arguments.length <= 1 || arguments[1] === undefined ? 18 : arguments[1];

            if (group <= 2) {
                return 2;
            } else if (group > 2 && group <= 12) {
                return 12;
            } else if (group > 12 && group <= 18) {
                return 18;
            }
        };

        // Adjust for charge
        var charge = function charge(electrons, _charge) {
            if (_charge > 0) {
                return electrons -= _charge;
            }
        };

        // Adjust for row
        var checkRow = function checkRow(group, protons, electrons) {
            if (group > 12 && protons > 10 && electrons <= 0) {
                return electrons += 4;
            } else {
                return electrons;
            }
        };

        // Update atoms/bonds
        var updateAtoms = function updateAtoms(sourceID, targetID, bondID, bondOrder) {

            atoms[sourceID].bonds.id.push(bondID);
            atoms[targetID].bonds.id.push(bondID);

            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[targetID].bonds.atoms.push(sourceID);

            atoms[sourceID].bonds.electrons += bondOrder;
            atoms[targetID].bonds.electrons += bondOrder;
        };

        // Add bonds between adjacent atoms
        for (var i = 0; i < keys.atoms.length - 1; i++) {

            // Retrieve atoms
            var sourceAtom = atoms[keys.atoms[i]],
                targetAtom = atoms[keys.atoms[i + 1]];

            // Check for hydrogen
            var sourceIndex = i;

            while ((sourceAtom.name === 'H' || atoms[keys.atoms[sourceIndex]] === undefined) && sourceIndex > -1) {
                sourceAtom = atoms[keys.atoms[sourceIndex]];
                sourceIndex -= 1;
            }

            if (sourceIndex === -1) {
                continue;
            }

            var sourceTotal = charge(valence(sourceAtom.group) - sourceAtom.bonds.electrons, sourceAtom.properties.charge),
                targetTotal = charge(valence(targetAtom.group) - targetAtom.bonds.electrons, targetAtom.properties.charge);

            // Check atoms for exceptions
            sourceTotal = checkRow(sourceTotal);
            targetTotal = checkRow(targetTotal);

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

            // Check for tokens preventing implicit bond
            if (n > 1) {

                // Extract all keys between source/target atoms
                var keysBetween = keys.all.slice(keys.all.indexOf(sourceAtom.id) + 1, keys.all.indexOf(targetAtom.id));

                // Check for bond symbol
                for (var j = 0; j < keysBetween.length; j++) {
                    if (bonds[keysBetween[j]] === undefined) {
                        exceptions += 0;
                    } else if (bonds[keysBetween[j]].name !== 'ring') {
                        exceptions += 1;
                    }
                }
            }

            if (exceptions === 0) {

                // Assign new bond key
                var bondID = sourceAtom.name + sourceAtom.id + (targetAtom.name + targetAtom.id),
                    bondValue = sourceAtom.name + targetAtom.name,
                    bondName = 'single',
                    bondOrder = 1;

                if (sourceAtom.name === 'H' || targetAtom.name === 'H') {
                    bondName = 'H';
                }

                // Check aromatic atoms
                if (sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
                    bondName = 'aromatic';
                    bondOrder = 1.5;
                }

                // Update bonds
                keys.bonds.push(bondID);
                bonds[bondID] = addBond(bondID, bondName, bondValue, bondOrder, [sourceAtom.id, targetAtom.id]);

                // Update atoms
                updateAtoms(sourceAtom.id, targetAtom.id, bondID, bondOrder);
            }
        }

        // Add implicit hydrogen
        var H = _utilitiesReference2['default'].H;

        var update = function update(x, sourceID, sourceName) {

            var bondID = 'H' + (x + 1) + sourceName + sourceID;
            var targetID = bondID;

            atoms[targetID] = addAtom(targetID, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);
            bonds[bondID] = addBond(bondID, 'H', 'H', 1, [sourceID, targetID]);

            atoms[sourceID].bonds.id.push(bondID);
            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[sourceID].bonds.electrons += 1;

            atoms[targetID].bonds.id.push(bondID);
            atoms[targetID].bonds.atoms.push(sourceID);
            atoms[targetID].bonds.electrons += 1;
        };

        for (var i = 0; i < keys.atoms.length; i++) {

            // Retrieve atoms
            var sourceAtom = atoms[keys.atoms[i]];

            // Check atom group
            if (sourceAtom.group < 13 && sourceAtom.group > 1) {
                continue;
            }

            var bondCount = sourceAtom.bonds.atoms.length;

            // Exception: explicit number of hydrogen
            if (sourceAtom.name !== 'H' && bondCount > 0) {

                for (var j = 0; j < bondCount; j++) {

                    // Retrieve target atom
                    var targetID = sourceAtom.bonds.atoms[j],
                        targetAtom = atoms[targetID];

                    // Check for hydrogen
                    if (targetAtom.name === 'H') {

                        // Check for value
                        var count = parseInt(targetAtom.value.match(/[0-9]+/g));

                        // Add hydrogen if electrons are available
                        if (count > 1 && count < sourceAtom.electrons) {

                            // Add hydrogen
                            for (var k = 0; k < count - 1; k++) {
                                update(k, sourceAtom.id, sourceAtom.name);
                            }
                        }
                    }
                }
            }

            // Exception: single uncharged hydrogen atom
            else if (sourceAtom.name === 'H' && sourceAtom.properties.charge === 0 && bondCount === 0) {
                    update(i, sourceAtom.id, sourceAtom.name);
                }

            var total = 18 - sourceAtom.group - sourceAtom.bonds.electrons,
                _charge2 = sourceAtom.properties.charge;

            if (total <= 0 || sourceAtom.group === 1) {
                continue;
            }

            // Positive charge
            if (_charge2 > 0) {
                total -= _charge2;
            }

            // Negitive charge
            else if (_charge2 < 0) {
                    total += _charge2;

                    // Exception: lone pair
                    if (total === 1) {
                        total -= 1;
                        atoms[sourceAtom.id].bonds.electrons += 1;
                    }
                }

            if (total <= 0) {
                continue;
            }

            // Add hydrogen
            for (var j = 0; j < total; j++) {

                // Check aromatic
                if (sourceAtom.properties.aromatic === 1 && j > 1) {
                    continue;
                }

                update(j, sourceAtom.id, sourceAtom.name);
            }
        }

        return [atoms, bonds, keys];
    }

    function clean(atoms, bonds) {

        var atomID = Object.keys(atoms),
            bondID = Object.keys(bonds);

        for (var i = 0; i < bondID.length; i++) {

            // Re-label bond value
            var source = atoms[bonds[bondID[i]].atoms[0]],
                target = atoms[bonds[bondID[i]].atoms[1]],
                order = bonds[bondID[i]].order;

            // Format: source element + bond order + target element (e.g. C1C, C2O, O1H)
            bonds[bondID[i]].value = source.name + order + target.name;
        }

        var getID = function getID(name, i) {
            return name + (i + 1);
        };

        var setID = function setID(obj, a, b) {
            if (obj.hasOwnProperty(a)) {
                obj[b] = obj[a];
                delete obj[a];
            }
        };

        // Re-label atom id
        for (var i = 0; i < atomID.length; i++) {

            var oldID = atomID[i],
                newID = getID(atoms[oldID].name, i);

            // Set ID
            atoms[oldID].id = newID;

            // Update bond pointers
            for (var j = 0; j < atoms[oldID].bonds.id.length; j++) {

                var key = atoms[oldID].bonds.id[j],
                    index = bonds[key].atoms.indexOf(oldID);

                if (index !== -1) {
                    bonds[key].atoms[index] = newID;
                }

                key = atoms[oldID].bonds.atoms[j];
                index = atoms[key].bonds.atoms.indexOf(oldID);

                if (index !== -1) {
                    atoms[key].bonds.atoms[index] = newID;
                }
            }

            setID(atoms, oldID, newID);
        }

        return [atoms, bonds];
    }

    var atoms = undefined,
        bonds = undefined,
        properties = undefined,
        keys = undefined;

    // 1. Validate tokens
    tokens = validateTokens(tokens);

    if (!tokens) {
        return false;
    }

    // 2. Categorize tokens

    // 3. Add atoms

    var _readTokens = readTokens(tokens);

    var _readTokens2 = _slicedToArray(_readTokens, 4);

    atoms = _readTokens2[0];
    bonds = _readTokens2[1];
    properties = _readTokens2[2];
    keys = _readTokens2[3];
    atoms = defaultAtoms(atoms, keys);
    atoms = updateAtoms(atoms, properties, keys);

    // 4. Add bonds

    var _explicitBonds = explicitBonds(atoms, bonds, keys);

    var _explicitBonds2 = _slicedToArray(_explicitBonds, 3);

    atoms = _explicitBonds2[0];
    bonds = _explicitBonds2[1];
    keys = _explicitBonds2[2];

    // 5. Clean atoms/bonds

    var _implicitBonds = implicitBonds(atoms, bonds, keys);

    var _implicitBonds2 = _slicedToArray(_implicitBonds, 3);

    atoms = _implicitBonds2[0];
    bonds = _implicitBonds2[1];
    keys = _implicitBonds2[2];

    var _clean = clean(atoms, bonds);

    var _clean2 = _slicedToArray(_clean, 2);

    atoms = _clean2[0];
    bonds = _clean2[1];

    return { atoms: atoms, bonds: bonds };
}

/**
 * Method      : compareArrays
 * Description : compare values across two arrays
 */

function compareArrays(a, b) {
    var ab = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];

    for (var i = 0; i < a.length; i++) {
        ab[i] = b.indexOf(a[i]) > -1 ? 1 : 0;
    }

    return ab;
}

/**
 * Method      : addAtom
 * Description : return new atom
 */

function addAtom(id, name, value) {
    var group = arguments.length <= 3 || arguments[3] === undefined ? 0 : arguments[3];
    var protons = arguments.length <= 4 || arguments[4] === undefined ? 0 : arguments[4];
    var neutrons = arguments.length <= 5 || arguments[5] === undefined ? 0 : arguments[5];
    var electrons = arguments.length <= 6 || arguments[6] === undefined ? 0 : arguments[6];

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
            id: [],
            atoms: [],
            electrons: 0
        },

        // Other properties
        properties: {
            chiral: 0,
            charge: 0,
            aromatic: 0
        }
    };
}

/**
 * Method      : addBond
 * Description : return new bond
 */

function addBond(id, name, value) {
    var order = arguments.length <= 3 || arguments[3] === undefined ? 0 : arguments[3];
    var atoms = arguments.length <= 4 || arguments[4] === undefined ? [] : arguments[4];

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

/**
 * Method      : nextAtom
 * Description : find key of next atom in array
 */

function nextAtom(start, keys, atoms) {

    var index = keys.indexOf(start);

    if (index !== -1) {
        keys = keys.slice(index, keys.length);

        for (var i = 1, ii = keys.length; i < ii; i++) {
            if (atoms[keys[i]] !== undefined) {
                return keys[i];
            }
        }
    }

    return null;
}

/**
 * Method      : previousAtom
 * Description : find key of previous atom in array
 */

function previousAtom(start, keys, atoms) {

    if (start === '0' && atoms['0'] !== undefined) {
        return '0';
    }

    var index = keys.indexOf(start);

    if (index !== -1) {
        keys = keys.slice(0, index).reverse();

        for (var i = 0, ii = keys.length; i < ii; i++) {
            if (atoms[keys[i]] !== undefined) {
                return keys[i];
            }
        }
    }

    return null;
}

/**
 * Exports
 */

exports.grammar = grammar;
exports.tokenize = tokenize;
exports.decode = decode;

},{"./../utilities/reference":5}],2:[function(require,module,exports){
/**
 * File        : topology.js
 * Description : chemical graph matrices and topological indices
 *
 * Options     : topology.matrix, topology.index
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

var _utilitiesMath = require('./../utilities/math');

var _utilitiesMath2 = _interopRequireDefault(_utilitiesMath);

var topology = {

    /**
     * Method      : topology.matrix
     * Description : compute chemical graph matrices
     *
     * Options     : adjacency, degree, distance, laplacian, randic, reciprocal
     */

    matrix: {

        /**
         * Returns adjacency matrix
         * @param {Object} G - molecule object
         * @return {Array} A - adjacency matrix
         */

        adjacency: function adjacency(G) {

            var V = Object.keys(G.atoms).filter(function (x) {
                return G.atoms[x].name !== 'H';
            });
            var E = Object.keys(G.bonds).filter(function (x) {
                return G.bonds[x].name !== 'H';
            });

            var A = [];

            for (var i = 0; i < V.length; i++) {
                A[i] = [];

                for (var j = 0; j < V.length; j++) {
                    A[i][j] = 0;
                }
            }

            for (var i = 0; i < E.length; i++) {

                var ii = V.indexOf(G.bonds[E[i]].atoms[0]);
                var jj = V.indexOf(G.bonds[E[i]].atoms[1]);

                A[ii][jj] = 1;
                A[jj][ii] = 1;
            }

            return A;
        },

        /**
         * Returns degree matrix
         * @param {Array} A - adjacency matrix
         * @return {Array} DEG - degree matrix
         */

        degree: function degree(A) {

            var DEG = [];

            for (var i = 0; i < A.length; i++) {
                DEG[i] = [];

                for (var j = 0; j < A[i].length; j++) {
                    DEG[i][j] = 0;

                    if (i === j) {

                        for (var k = 0; k < A[i].length; k++) {
                            DEG[i][j] += A[i][k];
                        }
                    }
                }
            }

            return DEG;
        },

        /**
         * Returns distance matrix (R. Seidel, ACM, (1992) 745-749)
         * @param {Array} A - adjacency matrix
         * @return {Array} D - distance matrix
         */

        distance: function distance(A) {

            var B = [];
            var D = [];

            var Z = _utilitiesMath2['default'].matrix.multiply(A, A);

            for (var i = 0; i < A.length; i++) {
                B[i] = [];

                for (var j = 0; j < A[i].length; j++) {

                    if (i !== j && (A[i][j] === 1 || Z[i][j] > 0)) {
                        B[i][j] = 1;
                    } else {
                        B[i][j] = 0;
                    }
                }
            }

            var count = 0;

            for (var i = 0; i < B.length; i++) {
                for (var j = 0; j < B[0].length; j++) {

                    if (i !== j && B[i][j] === 1) {
                        count += 1;
                    }
                }
            }

            if (count === B.length * B.length - B.length) {

                for (var i = 0; i < B.length; i++) {
                    D[i] = [];

                    for (var j = 0; j < B[i].length; j++) {
                        D[i][j] = B[i][j] * 2 - A[i][j];
                    }
                }

                return D;
            }

            var T = this.distance(B);
            var X = _utilitiesMath2['default'].matrix.multiply(T, A);

            var DEG = [];

            for (var i = 0; i < A.length; i++) {
                DEG[i] = 0;

                for (var j = 0; j < A[0].length; j++) {
                    DEG[i] += A[i][j];
                }
            }

            for (var i = 0; i < X.length; i++) {
                D[i] = [];

                for (var j = 0; j < X[0].length; j++) {

                    if (X[i][j] >= T[i][j] * DEG[j]) {
                        D[i][j] = T[i][j] * 2;
                    } else if (X[i][j] < T[i][j] * DEG[j]) {
                        D[i][j] = T[i][j] * 2 - 1;
                    }
                }
            }

            return D;
        },

        /**
         * Returns Laplacian matrix
         * @param {Array} A - adjacency matrix
         * @param {Array} DEG - degree matrix
         * @return {Array} L - Laplacian matrix
         */

        laplacian: function laplacian(A, DEG) {

            var L = [];

            for (var i = 0; i < A.length; i++) {
                L[i] = [];

                for (var j = 0; j < A[i].length; j++) {
                    L[i][j] = DEG[i][j] - A[i][j];
                }
            }

            return L;
        },

        /**
         * Returns Randic matrix
         * @param {Array} A - adjacency matrix
         * @param {Array} DEG - degree matrix
         * @return {Array} R - Randic matrix
         */

        randic: function randic(A, DEG) {

            var R = [];

            for (var i = 0; i < A.length; i++) {
                R[i] = [];

                for (var j = 0; j < A[i].length; j++) {
                    R[i][j] = 0;

                    if (A[i][j] === 1) {
                        R[i][j] = 1 / Math.sqrt(Math.max.apply(Math, _toConsumableArray(DEG[i])) * Math.max.apply(Math, _toConsumableArray(DEG[j])));
                    }
                }
            }

            return R;
        },

        /**
         * Returns reciprocal matrix
         * @param {Array} D - distance matrix
         * @return {Array} RD - reciprocal matrix
         */

        reciprocal: function reciprocal(D) {

            var RD = [];

            for (var i = 0; i < D.length; i++) {
                RD[i] = [];

                for (var j = 0; j < D[i].length; j++) {
                    RD[i][j] = 0;

                    if (i !== j && D[i][j] > 0) {
                        RD[i][j] = 1 / D[i][j];
                    }
                }
            }

            return RD;
        }
    },

    /**
     * Method      : topology.index
     * Description : molecular topological indices
     *
     * Options     : balaban, harary, hyperwiener, randic, wiener
     */

    index: {

        /**
         * Returns Balaban index
         * @param {Array} D - distance matrix
         * @return {Number} J - Balaban index
         */

        balaban: function balaban(D) {

            var J = 0;
            var B = 0;
            var S = [];

            for (var i = 0; i < D.length; i++) {
                S[i] = D[i].reduce(function (a, b) {
                    return a + b;
                }, 0);
            }

            for (var i = 0; i < D.length - 1; i++) {

                for (var j = i + 1; j < D[i].length; j++) {

                    if (D[i][j] === 1) {
                        J += 1 / Math.sqrt(S[i] * S[j]);
                        B += 1;
                    }
                }
            }

            return B / (B - D.length + 2) * J;
        },

        /**
         * Returns Harary index
         * @param {Array} RD - reciprocal matrix
         * @return {Number} H - Harary index
         */

        harary: function harary(RD) {

            var H = 0;

            for (var i = 0; i < RD.length; i++) {
                for (var j = 0; j < RD[i].length; j++) {
                    H += RD[i][j];
                }
            }

            return H / 2;
        },

        /**
         * Returns Hyper-Wiener index
         * @param {Array} D - distance matrix
         * @return {Number} WW - Hyper-Wiener index
         */

        hyperwiener: function hyperwiener(D) {

            var WW = 0;

            for (var i = 0; i < D.length; i++) {
                for (var j = 0; j < i; j++) {
                    WW += D[i][j] + Math.pow(D[i][j], 2);
                }
            }

            return WW / 2;
        },

        /**
         * Returns Randic index
         * @param {Array} R - Randic matrix
         * @return {Number} RI - Randic index
         */

        randic: function randic(R) {

            var RI = 0;

            for (var i = 0; i < R.length; i++) {
                RI += R[i].reduce(function (a, b) {
                    return a + b;
                }, 0);
            }

            return RI / 2;
        },

        /**
         * Returns Wiener index
         * @param {Array} D - distance matrix
         * @return {Number} W - Wiener index
         */

        wiener: function wiener(D) {

            var W = 0;

            for (var i = 0; i < D.length; i++) {
                for (var j = 0; j < D[i].length; j++) {
                    W += D[i][j];
                }
            }

            return W / 2;
        }
    }
};

/**
 * Exports
 */

exports['default'] = topology;
module.exports = exports['default'];

},{"./../utilities/math":4}],3:[function(require,module,exports){
/**
 * File        : molecules.js
 * Version     : 0.1.0-20170525
 * Description : chemical graph theory library
 *
 * Options     : load, save, topology
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _mainSmiles = require('./main/smiles');

var _mainTopology = require('./main/topology');

var _mainTopology2 = _interopRequireDefault(_mainTopology);

/**
 * Method      : load
 * Description : load molecule from supported chemical file format
 *
 * Options     : load.smiles, load.json
 */

var load = {

    /**
     * Method      : load.smiles(input)
     * Description : load molecule from SMILES string
     */

    smiles: function smiles(input) {
        var _tokenize = (0, _mainSmiles.tokenize)(input);

        var tokens = _tokenize.tokens;

        var _decode = (0, _mainSmiles.decode)(tokens);

        var atoms = _decode.atoms;
        var bonds = _decode.bonds;

        return getMolecule(atoms, bonds);
    },

    /**
     * Method      : load.json(input)
     * Description : load molecule from JSON object
     */

    json: function json(input) {
        return JSON.parse(input);
    }

};

/**
 * Method      : save
 * Description : save molecule as supported chemical file formats
 *
 * Options     : json
 */

var save = {

    /**
     * Method      : save.json(input)
     * Description : save molecule as JSON object
     */

    json: function json(input) {
        return JSON.stringify(input, null, '\t');
    },

    /**
     * Method      : save.d3(input)
     * Description : save molecule as d3 graph object {nodes: atoms, links: bonds}
     */

    d3: function d3(input) {
        return molecule2graph(input);
    }

};

/**
 * Method      : topology
 * Description : chemical graph matrices and topological indices
 *
 * Options     : topology.matrix, topology.index
 */

var topology = {

    /**
     * Method      : topology.matrix
     * Description : chemical graph matrices
     *
     * Options     : adjacency, degree, distance, laplacian, randic, reciprocal
     */

    matrix: {

        /**
         * Method      : topology.matrix.adjacency(G)
         * Description : returns adjacency matrix (A)
         */

        adjacency: function adjacency(G) {
            return _mainTopology2['default'].matrix.adjacency(G);
        },

        /**
         * Method      : topology.matrix.degree(A)
         * Description : returns degree matrix (DEG)
         */

        degree: function degree(A) {
            return _mainTopology2['default'].matrix.degree(A);
        },

        /**
         * Method      : topology.matrix.distance(A)
         * Description : returns distance matrix (D)
         *
         * Reference   : R. Seidel, ACM, (1992) 745-749.
         */

        distance: function distance(A) {
            return _mainTopology2['default'].matrix.distance(A);
        },

        /**
         * Method      : topology.matrix.laplacian(A, DEG)
         * Description : returns Laplacian matrix (L)
         */

        laplacian: function laplacian(A, DEG) {
            return _mainTopology2['default'].matrix.laplacian(A, DEG);
        },

        /**
         * Method      : topology.matrix.randic(A, DEG)
         * Description : returns Randic matrix (R)
         */

        randic: function randic(A, DEG) {
            return _mainTopology2['default'].matrix.randic(A, DEG);
        },

        /**
         * Method      : topology.matrix.reciprocal(D)
         * Description : returns reciprocal matrix (RD)
         */

        reciprocal: function reciprocal(D) {
            return _mainTopology2['default'].matrix.reciprocal(D);
        }
    },

    /**
     * Method      : topology.index
     * Description : molecular topological indices
     *
     * Options     : balaban, harary, hyperwiener, randic, wiener
     */

    index: {

        /**
         * Method      : topology.index.balaban(D)
         * Description : returns the Balaban index (J)
         */

        balaban: function balaban(D) {
            return _mainTopology2['default'].index.balaban(D);
        },

        /**
         * Method      : topology.index.harary(RD)
         * Description : returns the Harary index (H)
         */

        harary: function harary(RD) {
            return _mainTopology2['default'].index.harary(RD);
        },

        /**
         * Method      : topology.index.hyperwiener(D)
         * Description : returns the Hyper-Wiener index (WW)
         */

        hyperwiener: function hyperwiener(D) {
            return _mainTopology2['default'].index.hyperwiener(D);
        },

        /**
         * Method      : topology.index.randic(R)
         * Description : returns the Randic index (RI)
         */

        randic: function randic(R) {
            return _mainTopology2['default'].index.randic(R);
        },

        /**
         * Method      : topology.index.wiener(D)
         * Description : returns the Wiener index (W)
         */

        wiener: function wiener(D) {
            return _mainTopology2['default'].index.wiener(D);
        }
    }
};

/**
 * Method      : getMolecule
 * Description : return molecule
 */

var Molecule = function Molecule() {
    _classCallCheck(this, Molecule);

    this.id = [];
    this.name = [];
    this.tags = [];

    this.atoms = [];
    this.bonds = [];
    this.properties = {};
};

var Atom = function Atom() {
    _classCallCheck(this, Atom);

    this.id = [];
    this.name = [];
    this.tags = [];

    this.bonds = [];
    this.properties = {};
};

var Bond = function Bond() {
    _classCallCheck(this, Bond);

    this.id = [];
    this.name = [];
    this.tags = [];

    this.atoms = [];
    this.properties = {};
};

function getMolecule() {
    var atoms = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];
    var bonds = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
    var id = arguments.length <= 2 || arguments[2] === undefined ? 0 : arguments[2];

    var mass = getMass(atoms),
        formula = getFormula(atoms),
        name = getName(formula);

    return {
        id: id,
        name: name,
        atoms: atoms,
        bonds: bonds,
        properties: {
            mass: mass,
            formula: formula
        }
    };
}

/**
 * Method      : getFormula
 * Description : return molecular formula
 */

function getFormula(atoms) {
    var formula = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

    if (typeof atoms !== 'object') {
        return null;
    }

    var keys = Object.keys(atoms);

    for (var i = 0; i < keys.length; i++) {

        if (formula[atoms[keys[i]].name] === undefined) {
            formula[atoms[keys[i]].name] = 1;
        } else {
            formula[atoms[keys[i]].name] += 1;
        }
    }

    return formula;
}

/**
 * Method      : getName
 * Description : return molecular formula as string
 */

function getName(formula) {
    var name = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];

    if (typeof formula !== 'object') {
        return null;
    }

    var keys = Object.keys(formula).sort();

    var remove = function remove(element) {
        return keys.splice(keys.indexOf(element), 1);
    };

    var update = function update(element) {
        if (formula[element] === 1) {
            name.push(element);
        } else {
            name.push(element + formula[element]);
        }
    };

    if (keys.indexOf('C') !== -1) {
        update('C');
        remove('C');
    }

    if (keys.indexOf('H') !== -1) {
        update('H');
        remove('H');
    }

    if (keys.length > 0) {

        for (var i = 0; i < keys.length; i++) {
            update(keys[i]);
        }
    }

    return name.join('');
}

/**
 * Method      : getMass
 * Description : return molecular weight
 */

function getMass(atoms) {
    var mass = arguments.length <= 1 || arguments[1] === undefined ? 0 : arguments[1];

    if (typeof atoms !== 'object') {
        return null;
    }

    var keys = Object.keys(atoms);

    for (var i = 0; i < keys.length; i++) {
        mass += atoms[keys[i]].protons + atoms[keys[i]].neutrons;
    }

    return Math.round(mass * 10000) / 10000;
}

/**
 * molecule2graph
 * @param {Object} molecule object
 * @return {Object} d3 graph object {nodes: atoms, links: bonds}
 */

function molecule2graph(molecule) {

    if (typeof molecule !== 'object') {
        return null;
    }

    var atoms = Object.keys(molecule.atoms);
    var bonds = Object.keys(molecule.bonds);

    var nodes = [];
    var links = [];

    for (var i = 0; i < atoms.length; i++) {

        nodes.push({
            id: molecule.atoms[atoms[i]].id,
            name: molecule.atoms[atoms[i]].name,
            group: molecule.atoms[atoms[i]].group,
            protons: molecule.atoms[atoms[i]].protons,
            neutrons: molecule.atoms[atoms[i]].neutrons,
            electrons: molecule.atoms[atoms[i]].electrons,
            bonds: molecule.atoms[atoms[i]].bonds,
            properties: molecule.atoms[atoms[i]].properties
        });
    }

    for (var i = 0; i < bonds.length; i++) {

        links.push({
            id: molecule.bonds[bonds[i]].id,
            name: molecule.bonds[bonds[i]].name,
            value: molecule.bonds[bonds[i]].value,
            source: molecule.bonds[bonds[i]].atoms[0],
            target: molecule.bonds[bonds[i]].atoms[1],
            //source: atoms.indexOf(molecule.bonds[bonds[i]].atoms[0]),
            //target: atoms.indexOf(molecule.bonds[bonds[i]].atoms[1]),
            order: molecule.bonds[bonds[i]].order
        });
    }

    return { nodes: nodes, links: links };
}

/**
 * Exports
 */

exports.load = load;
exports.save = save;
exports.topology = topology;

},{"./main/smiles":1,"./main/topology":2}],4:[function(require,module,exports){
/**
 * File        : math.js
 * Description : assorted math functions
 *
 * Options     : math.matrix
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
var math = {

    /**
     * Method      : math.matrix
     * Description : assorted matrix functions
     *
     * Options     : zeros, ones, add, subtract, multiply, identity, inverse
     */

    matrix: {

        /**
         * Method      : math.matrix.zeros(rows, columns)
         * Description : returns a matrix of zeros
         */

        zeros: function zeros() {
            var rows = arguments.length <= 0 || arguments[0] === undefined ? 1 : arguments[0];
            var columns = arguments.length <= 1 || arguments[1] === undefined ? rows : arguments[1];
            var A = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];
            return (function () {

                for (var _i = 0; _i < rows; _i++) {
                    A[_i] = [];

                    for (var j = 0; j < columns; j++) {
                        A[_i][j] = 0;
                    }
                }

                return A;
            })();
        },

        /**
         * Method      : math.matrix.ones(rows, columns)
         * Description : returns a matrix of ones
         */

        ones: function ones() {
            var rows = arguments.length <= 0 || arguments[0] === undefined ? 1 : arguments[0];
            var columns = arguments.length <= 1 || arguments[1] === undefined ? rows : arguments[1];
            var A = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];
            return (function () {

                for (var _i2 = 0; _i2 < rows; _i2++) {
                    A[_i2] = [];

                    for (var j = 0; j < columns; j++) {
                        A[_i2][j] = 1;
                    }
                }

                return A;
            })();
        },

        /**
         * Method      : math.matrix.add(A, B)
         * Description : returns [A] + [B]
         */

        add: function add(A, B) {
            var AB = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];

            for (var _i3 = 0; _i3 < A.length; _i3++) {
                AB[_i3] = [];

                for (var j = 0; j < A[_i3].length; j++) {
                    AB[_i3][j] = A[_i3][j] + B[_i3][j];
                }
            }

            return AB;
        },

        /**
         * Method      : math.matrix.subtract(A, B)
         * Description : returns [A] - [B]
         */

        subtract: function subtract(A, B) {
            var AB = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];

            for (var _i4 = 0; _i4 < A.length; _i4++) {
                AB[_i4] = [];

                for (var j = 0; j < A[_i4].length; j++) {
                    AB[_i4][j] = A[_i4][j] - B[_i4][j];
                }
            }

            return AB;
        },

        /**
         * Method      : math.matrix.multiply(A, B)
         * Description : returns [A] * [B]
         */

        multiply: function multiply(A, B) {
            var AB = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];

            switch (typeof B) {

                case 'object':

                    for (var _i5 = 0; _i5 < A.length; _i5++) {
                        AB[_i5] = [];

                        for (var j = 0; j < A[0].length; j++) {
                            AB[_i5][j] = 0;

                            for (var k = 0; k < A[0].length; k++) {
                                AB[_i5][j] += A[_i5][k] * B[k][j];
                            }
                        }
                    }

                    return AB;

                case 'number':

                    for (var _i6 = 0; _i6 < A.length; _i6++) {
                        AB[_i6] = [];

                        for (var j = 0; j < A[0].length; j++) {
                            AB[_i6][j] = A[_i6][j] * B;
                        }
                    }

                    return AB;

            }
        },

        /**
         * Method      : math.matrix.identity(A)
         * Description : returns [A] * [I] = [A]
         */

        identity: function identity(A) {
            var I = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];

            for (var _i7 = 0; _i7 < A.length; _i7++) {
                I[_i7] = [];

                for (var j = 0; j < A[_i7].length; j++) {
                    I[_i7][j] = 0;

                    if (_i7 === j) {
                        I[_i7][j] = 1;
                    }
                }
            }

            return I;
        },

        /**
         * Method      : math.matrix.inverse(A)
         * Description : returns [A]^-1
         *
         * Reference   : http://blog.acipo.com/matrix-inversion-in-javascript/
         */

        inverse: function inverse(A) {
            var AA = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];
            var I = arguments.length <= 2 || arguments[2] === undefined ? [] : arguments[2];

            if (A.length !== A[i].length) {
                return null;
            }

            for (var _i8 = 0; _i8 < A.length; _i8++) {
                AA[_i8] = [];
                I[_i8] = [];

                for (var j = 0; j < A[_i8].length; j++) {
                    AA[_i8][j] = A[_i8][j];
                    I[_i8][j] = 0;

                    if (_i8 === j) {
                        I[_i8][j] = 1;
                    }
                }
            }

            for (var _i9 = 0, x = A[i][i]; _i9 < A.length; _i9++) {

                if (x === 0) {

                    for (var j = _i9 + 1; j < A.length; j++) {

                        if (A[j][_i9] !== 0) {

                            for (var k = 0; k < A.length; k++) {
                                x = AA[_i9][k];
                                AA[_i9][k] = AA[j][k];
                                AA[j][k] = x;

                                x = I[_i9][j];
                                I[_i9][k] = I[j][k];
                                I[j][k] = x;
                            }

                            break;
                        }
                    }

                    x = AA[_i9][_i9];

                    if (AA[_i9][_i9] === 0) {
                        return null;
                    }
                }

                for (var j = 0, _x13 = AA[_i9][_i9]; j < A.length; j++) {
                    AA[_i9][j] = AA[_i9][j] / _x13;
                    I[_i9][j] = I[_i9][j] / _x13;
                }

                for (var j = 0; j < A.length; j++) {
                    if (_i9 !== j) {

                        for (var k = 0, _x14 = AA[j][_i9]; k < A.length; k++) {
                            AA[j][k] -= AA[_i9][k] * _x14;
                            I[j][k] -= I[_i9][k] * _x14;
                        }
                    }
                }
            }

            return I;
        },

        /**
         * Method      : math.matrix.check(A, B)
         * Description : check matrix input for errors
         */

        check: function check(A) {
            var B = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];

            if (!Array.isArray(A)) {
                throw 'Error: input \'A\' must be an array';
            }

            if (!Array.isArray(B)) {
                throw 'Error: input \'B\' must be an array';
            }

            if (A.length === 0) {
                throw 'Error: input cannot be empty';
            }

            if (B.length !== 0 && A.length !== B.length) {
                throw 'Error: matrix dimensions must agree';
            }

            if (A.filter(function (x) {
                return Array.isArray(x);
            }).length === A.length) {

                if (A.map(function (x) {
                    return x.length;
                }).reduce(function (a, b) {
                    return a + b;
                }) !== A.length * A.length) {
                    throw 'Error: matrix dimensions must agree';
                }

                if (B.length !== 0) {

                    if (B.filter(function (x) {
                        return Array.isArray(x);
                    }).length !== A.length) {
                        throw 'Error: matrix dimensions must agree';
                    }

                    if (B.map(function (x) {
                        return x.length;
                    }).reduce(function (a, b) {
                        return a + b;
                    }) !== A.length * A.length) {
                        throw 'Error: matrix dimensions must agree';
                    }
                }
            } else if (A.filter(function (x) {
                return typeof x === 'number';
            }).length === A.length) {

                if (B.length !== 0) {

                    if (B.filter(function (x) {
                        return typeof x === 'number';
                    }).length !== A.length) {
                        throw 'Error: matrix dimensions must agree';
                    }
                }
            } else {
                throw 'Error: input must be uniform';
            }

            return 1;
        }
    }
};

/**
 * Exports
 */

exports['default'] = math;
module.exports = exports['default'];

},{}],5:[function(require,module,exports){
/**
 * File        : reference.js
 * Description : assorted chemical terms and constants
 *
 * Options     : reference.elements
 */

"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var reference = {

  /**
   * Name        : reference.elements
   * Description : dictionary of atomic properties
   *
   * element :
   *   protons   : # protons
   *   neutrons  : average # neutrons
   *   electrons : # electrons
   *   group     : periodic table column
   *   period    : periodic table row
   */

  elements: {
    H: { protons: 1, neutrons: 0.0079, electrons: 1, group: 1, period: 1 },
    D: { protons: 1, neutrons: 1.0000, electrons: 1, group: 1, period: 1 },
    He: { protons: 2, neutrons: 2.0026, electrons: 2, group: 18, period: 1 },
    Li: { protons: 3, neutrons: 3.9410, electrons: 3, group: 1, period: 2 },
    Be: { protons: 4, neutrons: 5.0122, electrons: 4, group: 2, period: 2 },
    B: { protons: 5, neutrons: 5.8110, electrons: 5, group: 13, period: 2 },
    C: { protons: 6, neutrons: 6.0107, electrons: 6, group: 14, period: 2 },
    N: { protons: 7, neutrons: 7.0067, electrons: 7, group: 15, period: 2 },
    O: { protons: 8, neutrons: 7.9994, electrons: 8, group: 16, period: 2 },
    F: { protons: 9, neutrons: 9.9984, electrons: 9, group: 17, period: 2 },
    Ne: { protons: 10, neutrons: 10.1797, electrons: 10, group: 18, period: 2 },
    Na: { protons: 11, neutrons: 11.9897, electrons: 11, group: 1, period: 3 },
    Mg: { protons: 12, neutrons: 12.3050, electrons: 12, group: 2, period: 3 },
    Al: { protons: 13, neutrons: 13.9815, electrons: 13, group: 13, period: 3 },
    Si: { protons: 14, neutrons: 14.0855, electrons: 14, group: 14, period: 3 },
    P: { protons: 15, neutrons: 15.9738, electrons: 15, group: 15, period: 3 },
    S: { protons: 16, neutrons: 16.0650, electrons: 16, group: 16, period: 3 },
    Cl: { protons: 17, neutrons: 18.4500, electrons: 17, group: 17, period: 3 },
    Ar: { protons: 18, neutrons: 21.9480, electrons: 18, group: 18, period: 3 },
    K: { protons: 19, neutrons: 20.0983, electrons: 19, group: 1, period: 4 },
    Ca: { protons: 20, neutrons: 20.0780, electrons: 20, group: 2, period: 4 },
    Sc: { protons: 21, neutrons: 23.9559, electrons: 21, group: 3, period: 4 },
    Ti: { protons: 22, neutrons: 25.8670, electrons: 22, group: 4, period: 4 },
    V: { protons: 23, neutrons: 27.9415, electrons: 23, group: 5, period: 4 },
    Cr: { protons: 24, neutrons: 27.9961, electrons: 24, group: 6, period: 4 },
    Mn: { protons: 25, neutrons: 29.9380, electrons: 25, group: 7, period: 4 },
    Fe: { protons: 26, neutrons: 29.8450, electrons: 26, group: 8, period: 4 },
    Co: { protons: 27, neutrons: 31.9332, electrons: 27, group: 9, period: 4 },
    Ni: { protons: 28, neutrons: 30.6934, electrons: 28, group: 10, period: 4 },
    Cu: { protons: 29, neutrons: 34.5460, electrons: 29, group: 11, period: 4 },
    Zn: { protons: 30, neutrons: 35.3900, electrons: 30, group: 12, period: 4 },
    Ga: { protons: 31, neutrons: 38.7230, electrons: 31, group: 13, period: 4 },
    Ge: { protons: 32, neutrons: 40.6100, electrons: 32, group: 14, period: 4 },
    As: { protons: 33, neutrons: 41.9216, electrons: 33, group: 15, period: 4 },
    Se: { protons: 34, neutrons: 44.9600, electrons: 34, group: 16, period: 4 },
    Br: { protons: 35, neutrons: 44.9040, electrons: 35, group: 17, period: 4 },
    Kr: { protons: 36, neutrons: 47.8000, electrons: 36, group: 18, period: 4 },
    Rb: { protons: 37, neutrons: 48.4678, electrons: 37, group: 1, period: 5 },
    Sr: { protons: 38, neutrons: 49.6210, electrons: 38, group: 2, period: 5 },
    Y: { protons: 39, neutrons: 49.9058, electrons: 39, group: 3, period: 5 },
    Zr: { protons: 40, neutrons: 52.2242, electrons: 40, group: 4, period: 5 },
    Nb: { protons: 41, neutrons: 51.9064, electrons: 41, group: 5, period: 5 },
    Mo: { protons: 42, neutrons: 53.9510, electrons: 42, group: 6, period: 5 },
    Tc: { protons: 43, neutrons: 55.0000, electrons: 43, group: 7, period: 5 },
    Ru: { protons: 44, neutrons: 57.0720, electrons: 44, group: 8, period: 5 },
    Rh: { protons: 45, neutrons: 57.9055, electrons: 45, group: 9, period: 5 },
    Pd: { protons: 46, neutrons: 60.4210, electrons: 46, group: 10, period: 5 },
    Ag: { protons: 47, neutrons: 60.8682, electrons: 47, group: 11, period: 5 },
    Cd: { protons: 48, neutrons: 64.4144, electrons: 48, group: 12, period: 5 },
    In: { protons: 49, neutrons: 65.8181, electrons: 49, group: 13, period: 5 },
    Sn: { protons: 50, neutrons: 68.7107, electrons: 50, group: 14, period: 5 },
    Sb: { protons: 51, neutrons: 70.7601, electrons: 51, group: 15, period: 5 },
    Te: { protons: 52, neutrons: 75.6030, electrons: 52, group: 16, period: 5 },
    I: { protons: 53, neutrons: 73.9045, electrons: 53, group: 17, period: 5 },
    Xe: { protons: 54, neutrons: 77.2936, electrons: 54, group: 18, period: 5 }
  }
};

/**
 * Exports
 */

exports["default"] = reference.elements;
module.exports = exports["default"];

},{}]},{},[3])(3)
});