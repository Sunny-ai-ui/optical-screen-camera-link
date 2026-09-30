import { createFountainTransfer, FountainReassembler } from '../../packages/fountain/src/index.js';
import { encodeV3Frame, decodeV3Frame } from '../../packages/optical-codec/src/v3-frame.js';
import { V3_G32_S4_C4_RS } from '../../packages/optical-codec/src/profiles.js';

const original = Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + 19) & 0xFF);

for (const lossPercent of [0, 10, 20, 30]) {
  let successes = 0;
  const trials = 20;
  let totalAccepted = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const transfer = createFountainTransfer(original, {
      packetPayloadBytes: V3_G32_S4_C4_RS.recommendedProtocolPayloadBytes,
      overheadRatio: 1,
      sessionId: trial + 1,
    });
    const receiver = new FountainReassembler();
    let accepted = 0;
    for (let i = 0; i < transfer.packets.length; i += 1) {
      const pseudo = ((i * 37 + trial * 53 + 11) % 100);
      if (pseudo < lossPercent) continue;
      const encoded = encodeV3Frame(transfer.packets[i], V3_G32_S4_C4_RS);
      const decoded = decodeV3Frame(encoded, V3_G32_S4_C4_RS);
      accepted += 1;
      const status = receiver.addPacket(decoded.packetBytes);
      if (status.complete) break;
    }
    if (receiver.status().complete) successes += 1;
    totalAccepted += accepted;
  }
  console.log(`${lossPercent}% frame loss: ${successes}/${trials} recovered; avg accepted droplets ${(totalAccepted / trials).toFixed(1)}`);
}
