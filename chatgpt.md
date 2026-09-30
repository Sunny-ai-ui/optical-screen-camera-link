# chatgpt.md

## Project Context
This repository contains an experimental optical wireless communication system using a display as transmitter and a camera as receiver.

## Primary Design Direction
Start slow and reliable. The first implementation should prove end-to-end transmission before optimizing speed.

Baseline assumptions:
- 256 × 256 logical ROI.
- Four finder markers for ROI detection and perspective correction.
- Large cells initially.
- Colour regions/constellations instead of exact RGB equality.
- Calibration references inside synchronization frames.
- Confidence-aware decoding.
- CRC validation.

## Instructions for ChatGPT / Coding Assistants
When asked to implement or modify this project:
1. Inspect the existing repository first.
2. Preserve the protocol layering: transport data → packet → symbol → optical frame.
3. Do not mix UI code with core codec logic when avoidable.
4. Use real camera measurements to tune colour thresholds/centroids.
5. Do not assume 256 colours will work reliably on every screen/camera pair.
6. Prefer an adaptive mode over hardcoded aggressive settings.
7. Keep a robust fallback mode.
8. Report both raw and useful throughput.
9. Track symbol/frame/packet errors separately.
10. Avoid unsafe behavior: received content must never be auto-executed.

## Current Priority
Build V1:
- sender page;
- deterministic packet encoder;
- optical frame renderer;
- camera/image receiver;
- finder detection;
- perspective correction;
- colour calibration;
- symbol decoder;
- CRC validation;
- basic diagnostics.

## Do Not Optimize Yet
Do not begin with:
- 2 × 2 cells;
- 256 colour symbols;
- rolling-shutter decoding;
- invisible modulation;
- multi-Mbps claims.

Those are later milestones after baseline measurements exist.
