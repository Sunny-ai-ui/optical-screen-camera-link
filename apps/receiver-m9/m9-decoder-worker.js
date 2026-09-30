import { decodeM9Observation } from './m9-decoder.js';

self.onmessage = (event) => {
  const { id, imageData, unresolvedTileIndexes } = event.data || {};
  try {
    const result = decodeM9Observation(imageData, unresolvedTileIndexes);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: { name: error.name, message: error.message, code: error.code ?? null },
    });
  }
};
