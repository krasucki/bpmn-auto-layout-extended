import { Layouter } from './Layouter.js';

export function layoutProcess(xml, options = {}) {
  return new Layouter().layoutProcess(xml, options);
}
