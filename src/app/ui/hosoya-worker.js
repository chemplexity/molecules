/** @module app/ui/hosoya-worker */

import { hosoyaIndex } from '../../descriptors/topological.js';
import { fromJSON } from '../../io/json.js';

self.onmessage = event => {
  self.postMessage(hosoyaIndex(fromJSON(event.data)));
};
