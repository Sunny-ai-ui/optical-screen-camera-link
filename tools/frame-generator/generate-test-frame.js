import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createTransferPackets } from '../../packages/protocol/src/index.js';
import {
  V1_G16_C16,
  encodeOpticalFrame,
  renderOpticalFrameSvg,
} from '../../packages/optical-codec/src/index.js';

const text = process.argv.slice(2).join(' ') || 'HELLO OPTICAL';
const outputDir = resolve(process.cwd(), 'output');
mkdirSync(outputDir, { recursive: true });

const transfer = createTransferPackets(text, {
  sessionId: 1,
  chunkSize: V1_G16_C16.recommendedProtocolPayloadBytes,
});

for (let index = 0; index < transfer.packets.length; index += 1) {
  const frame = encodeOpticalFrame(transfer.packets[index]);
  const svg = renderOpticalFrameSvg(frame, { scale: 3, showGrid: false });
  const name = `frame-${String(index).padStart(3, '0')}.svg`;
  writeFileSync(resolve(outputDir, name), svg, 'utf8');
}

console.log(`Input bytes: ${new TextEncoder().encode(text).length}`);
console.log(`Session: ${transfer.sessionId}`);
console.log(`Optical frames: ${transfer.packets.length}`);
console.log(`Profile: ${V1_G16_C16.id}`);
console.log(`Generated in: ${outputDir}`);
