/*
  File        : topology.js
  Description : molecular topological indices

  Imports     : adjacencyMatrix, distanceMatrix, reciprocalMatrix
  Exports     : wienerIndex, hyperwienerIndex, hararyIndex
*/


/*
  Imports
*/

import { adjacencyMatrix, distanceMatrix, reciprocalMatrix } from './../geometry/connectivity';


/*
  Method      : wienerIndex
  Description : return Wiener topology index

  Syntax
    index = wienerIndex(distance)

  Input
    distance : distance matrix

  Output
    index : Wiener index

  Examples
    wiener = wienerIndex(dist123)
    w123 = wienerIndex(distanceABC)
*/

function wienerIndex(distance, index = 0) {

    if (typeof distance !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (distance.atoms !== undefined && distance.bonds !== undefined) {
        distance = distanceMatrix(adjacencyMatrix(distance));
    }

    // Check for header
    if (distance.distance !== undefined) {
        distance = distance.distance;
    }

    // Calculate Wiener index
    for (let i = 0; i < distance.length; i++) {
        for (let j = 0; j < distance[0].length; j++) {
            index += distance[i][j];
        }
    }

    return index / 2;
}


/*
  Method      : hyperwienerIndex
  Description : return Hyper-Wiener topology index

  Syntax
    index = hyperwienerIndex(distance)

  Input
    distance : distance matrix

  Output
    index : Hyper-Wiener index

  Examples
    hyperwiener = hyperwienerIndex(dist123)
    hw123 = hyperwienerIndex(distanceABC)
*/

function hyperwienerIndex(distance, index = 0) {

    if (typeof distance !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (distance.atoms !== undefined && distance.bonds !== undefined) {
        distance = distanceMatrix(adjacencyMatrix(distance));
    }

    // Check for header
    if (distance.distance !== undefined) {
        distance = distance.distance;
    }

    // Calculate Hyper-Wiener index
    for (let i = 0; i < distance.length; i++) {
        for (let j = 0; j < distance[i].length; j++) {

            if (i !== j && i < j) {
                index += distance[i][j] + Math.pow(distance[i][j], 2);
            }
        }
    }

    return index / 2;
}


/*
  Method      : hararyIndex
  Description : return Harary topology index

  Syntax
    index = hararyIndex(reciprocal)

  Input
    reciprocal : reciprocal of distance matrix

  Output
    index : Harary index

  Examples
    harary = hararyIndex(recip123)
    h123 = hararyIndex(reciprocalABC)
*/

function hararyIndex(reciprocal, index = 0) {

    if (typeof reciprocal !== 'object') {
        console.log('Error: Tokens must be of type "object"');
        return null;
    }

    // Check input for molecule
    if (reciprocal.atoms !== undefined && reciprocal.bonds !== undefined) {
        reciprocal = reciprocalMatrix(distanceMatrix(adjacencyMatrix(reciprocal)));
    }

    // Check for header
    if (reciprocal.reciprocal !== undefined) {
        reciprocal = reciprocal.reciprocal;
    }

    // Calculate Harary index
    for (let i = 0; i < reciprocal.length; i++) {
        for (let j = 0; j < reciprocal[i].length; j++) {

            if (i !== j) {
                index += reciprocal[i][j];
            }
        }
    }

    return Math.round((index / 2) * 1000) / 1000;
}


/*
  Exports
*/

export { wienerIndex, hyperwienerIndex, hararyIndex};