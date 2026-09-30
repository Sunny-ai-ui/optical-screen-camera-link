# Architecture Essentials

## 1. End-to-End Pipeline

```text
Input Data
   ↓
Packetizer
   ↓
CRC / framing
   ↓
Symbol Encoder
   ↓
Optical Frame Renderer
   ↓
DISPLAY
   ↓ photons
CAMERA
   ↓
Finder Detection
   ↓
Perspective Rectification
   ↓
Cell Sampling
   ↓
Colour Normalization
   ↓
Nearest Symbol / Confidence
   ↓
Packet Reassembly
   ↓
CRC Validation
   ↓
Recovered Data
```

## 2. Baseline Optical Frame
- Logical ROI: 256 × 256.
- V1 cell size: 16 × 16.
- Grid: 16 × 16 cells.
- Reserve cells for markers, calibration, metadata, and CRC.
- Do not assume the camera observes the same RGB values emitted by the display.

## 3. Colour Symbol Principle
A symbol is represented by a region in colour space, not one exact RGB triplet.

Receiver pipeline:
1. Measure cell RGB.
2. Apply calibration from known reference cells.
3. Normalize illumination/brightness effects.
4. Compare against valid symbol centroids.
5. Choose the nearest symbol only when confidence is above threshold.
6. Otherwise mark the symbol as an erasure/unknown.

## 4. Calibration
Every synchronization frame should include known reference colours. Calibration should estimate the current screen-to-camera colour transformation. Auto exposure and white balance changes must be treated as channel changes.

## 5. Finder / ROI Detection
Use four high-contrast corner markers with asymmetric orientation so rotation can be determined. The receiver should:
- locate the four markers;
- order the corners;
- calculate a homography;
- rectify the detected quadrilateral into the 256 × 256 logical ROI.

## 6. Packet Format — Initial Draft

```text
Magic        2 bytes
Version      1 byte
Frame Type   1 byte
Session ID   2 bytes
Sequence     2 bytes
Payload Len  2 bytes
Payload      variable
CRC32        4 bytes
```

The optical mapping is separate from the packet format so modulation can change without changing higher protocol layers.

## 7. Frame Types
- SYNC — establishes geometry and calibration.
- DATA — carries payload.
- END — marks completion and expected final length/hash.
- TEST — diagnostics/calibration only.

## 8. Engineering Rules
- Optimize useful throughput, not theoretical raw rate.
- Never guess ambiguous colours when confidence is low.
- Keep sender and receiver deterministic in V1.
- Instrument every stage.
- Maintain recorded test vectors for regression testing.
- Keep modulation, framing, vision, and UI modules independent.

## 9. Future Speed Levers
- 8 × 8 → 4 × 4 → 2 × 2 cells.
- 16 → 32 → 64 → 128 → 256 colour symbols.
- Higher display refresh rates.
- Better camera resolution and manual exposure control.
- FEC and interleaving.
- Differential colour encoding.
- Rolling-shutter temporal decoding.
- Adaptive link negotiation based on measured error rate.
