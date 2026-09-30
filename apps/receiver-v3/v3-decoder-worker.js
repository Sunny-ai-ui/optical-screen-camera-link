import { V3_PROFILES } from '../../packages/optical-codec/src/profiles.js';
import { observeV3ImageData } from './v3-decoder.js';

self.onmessage = (event) => {
  const { id, imageData, rotation, profileId, tuning } = event.data || {};
  try {
    const profile = V3_PROFILES.find((item) => item.id === profileId);
    if (!profile) throw new Error(`Unknown V3 profile ${profileId}`);
    const observation = observeV3ImageData(imageData, rotation, profile, tuning);
    self.postMessage({ id, ok: true, observation }, [
      observation.symbols.buffer,
      observation.shapeIds.buffer,
      observation.colorIds.buffer,
      observation.confidences.buffer,
      observation.shapeConfidences.buffer,
      observation.colorConfidences.buffer,
    ]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { message: error.message, code: error.code, blockIndex: error.blockIndex } });
  }
};
