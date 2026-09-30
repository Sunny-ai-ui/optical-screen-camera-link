# Architecture

# Optical Screen-to-Camera Link

**Repository:** `Sunny-Gumber/optical-screen-camera-link`  
**Role of this document:** Master technical architecture and project structure.  
**Related documents:** `PRD.md`, `PRD-Architecture.md`, `Architecture-Essentials.md`, `agents.md`, `chatgpt.md`.

---

## 1. Architectural Goal

Build a layered optical communication system where application data is encoded into colour-cell frames displayed on a screen and decoded by a camera.

The architecture must make it possible to change:

- packet format;
- colour alphabet;
- grid density;
- calibration algorithm;
- camera implementation;
- FEC strategy;
- rendering technology;

without rewriting the entire project.

The system is therefore divided into independent layers.

---

## 2. System Context

```text
┌──────────────────────────┐
│       SENDER DEVICE      │
│                          │
│  User Data / File        │
│          ↓               │
│  Transport / Protocol    │
│          ↓               │
│  Optical Encoder         │
│          ↓               │
│  Frame Renderer          │
│          ↓               │
│  Laptop / Mobile Screen  │
└────────────┬─────────────┘
             │
             │ Visible light
             ▼
┌──────────────────────────┐
│      RECEIVER DEVICE     │
│                          │
│  Camera                  │
│      ↓                   │
│  Vision / ROI            │
│      ↓                   │
│  Calibration             │
│      ↓                   │
│  Optical Decoder         │
│      ↓                   │
│  Protocol Reassembly     │
│      ↓                   │
│  Recovered Data / File   │
└──────────────────────────┘
```

The physical optical channel is intentionally simple:

```text
DISPLAY → AIR → CAMERA
```

No radio link is required for the primary data path.

---

## 3. Layered Architecture

## Layer 1 — Application/Data Layer
Responsible for:

- text input;
- binary file input;
- metadata;
- recovered data presentation;
- explicit save/download action.

This layer must never understand colour or camera geometry.

---

## Layer 2 — Session / Transport Layer
Responsible for:

- creating a transfer session;
- chunking data;
- assigning sequence numbers;
- completion detection;
- duplicate handling;
- reassembly;
- optional retransmission logic later.

Input:

```text
arbitrary bytes
```

Output:

```text
ordered protocol payload chunks
```

---

## Layer 3 — Packet Protocol Layer
Responsible for serialization/deserialization.

Initial packet model:

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

Possible future additions:

- total packet count;
- total file size;
- payload hash;
- modulation mode;
- FEC profile;
- grid profile;
- timestamps;
- ACK/retransmission information.

Protocol encoding must be deterministic and testable without camera/display hardware.

---

## Layer 4 — FEC / Integrity Layer
V1:

- CRC32 validation;
- frame rejection;
- duplicate/sequence detection.

Later:

- Reed-Solomon or another appropriate FEC;
- interleaving;
- erasure recovery;
- optional retransmission.

This layer consumes bytes/packets, not raw camera pixels.

---

## Layer 5 — Symbol Mapping Layer
Converts packet bits into modulation symbols.

Supported/target symbol profiles:

```text
C16  → 4 bits/symbol
C32  → 5 bits/symbol
C64  → 6 bits/symbol
C128 → 7 bits/symbol
C256 → 8 bits/symbol
```

A symbol refers to an entry in a colour constellation, not directly to one guaranteed camera RGB value.

Example conceptual interface:

```ts
encodeBits(bits, constellation) -> Symbol[]
decodeSymbols(symbols) -> bits
```

---

## Layer 6 — Optical Frame Layout Layer
Responsible for placing symbols into logical cells.

Canonical logical ROI:

```text
256 × 256 logical pixels
```

Baseline profiles:

```text
Profile G16
cell = 16×16
matrix = 16×16
256 total cells

Profile G32
cell = 8×8
matrix = 32×32
1,024 total cells

Profile G64
cell = 4×4
matrix = 64×64
4,096 total cells

Profile G128
cell = 2×2
matrix = 128×128
16,384 total cells
```

Actual payload capacity is lower because cells/areas are reserved for synchronization, calibration, protocol and guards.

The layout layer defines logical coordinates only. Physical display scaling belongs to the renderer.

---

## Layer 7 — Sender Rendering Layer
Responsible for drawing the logical optical frame to a real display.

Responsibilities:

- scale logical ROI to physical CSS/canvas pixels;
- preserve sharp cell boundaries where appropriate;
- disable unwanted smoothing where required;
- control frame duration;
- provide fullscreen mode;
- render sync/calibration/data frames;
- expose current sequence and modulation profile.

Potential implementation:

- HTML5 Canvas for V1;
- WebGL/WebGPU later if rendering/timing requires it.

The sender must not assume that one logical pixel equals one physical display pixel.

---

## Layer 8 — Camera Capture Layer
Responsible for acquiring image frames.

Browser V1:

- `getUserMedia`;
- requested resolution/FPS;
- camera preview;
- copy frames to processing canvas/video frame path.

Native receiver later may provide:

- manual exposure;
- fixed white balance;
- high-speed modes;
- RAW/YUV access;
- sensor timing information.

Output should be a standardized image/frame object for the vision pipeline.

---

## Layer 9 — Vision / Geometry Layer
Responsible for locating the optical frame.

Pipeline:

```text
Camera Frame
   ↓
Finder candidate detection
   ↓
Four-corner validation
   ↓
Orientation resolution
   ↓
Corner ordering
   ↓
Homography
   ↓
Perspective warp
   ↓
Normalized 256×256 ROI
```

Finder markers should be:

- high contrast;
- robust under perspective;
- distinguishable from payload colours;
- asymmetric enough to determine orientation.

The vision layer returns a rectified ROI plus detection quality metrics.

---

## Layer 10 — Calibration Layer
Responsible for estimating how known transmitted colours appear to the receiver.

Inputs:

- known reference symbols;
- corresponding observed samples.

Outputs may include:

- brightness normalization parameters;
- colour transformation matrix/model;
- constellation centroids in observed colour space;
- confidence/noise estimates.

V1 should begin with straightforward calibration and only add complexity when measurements justify it.

Candidate representations:

- normalized RGB/chromaticity;
- HSV;
- YCbCr;
- Lab/CIELAB;
- linear/nonlinear learned transform.

---

## Layer 11 — Cell Sampling Layer
Responsible for converting the rectified ROI into representative colour samples per logical data cell.

Do not sample only one image pixel by default.

Preferred approach:

- define a central sampling window per cell;
- exclude cell borders;
- average/median pixels;
- optionally reject outliers;
- return colour sample + variance/noise metric.

This helps reduce:

- moiré;
- lens blur;
- border mixing;
- camera noise;
- small homography error.

---

## Layer 12 — Symbol Classifier
Responsible for mapping calibrated cell measurements to constellation symbols.

Conceptual process:

```text
Observed cell colour
      ↓
Normalize / transform
      ↓
Distance to valid constellation regions
      ↓
Best symbol + second-best symbol
      ↓
Confidence / distance margin
      ↓
valid symbol OR erasure
```

Required output:

```ts
{
  symbol: number | null,
  confidence: number,
  distance: number,
  rawColor: ..., 
  calibratedColor: ...,
  erasure: boolean
}
```

The classifier must support changing constellations without rewriting packet logic.

---

## Layer 13 — Metrics / Diagnostics Layer
This is a first-class architecture component, not an afterthought.

Track:

- capture FPS;
- display/symbol rate;
- finder lock rate;
- homography quality;
- calibration residual/error;
- decoded symbols;
- erasures;
- CRC failures;
- accepted/rejected packets;
- raw throughput;
- useful throughput;
- session bytes recovered;
- processing latency.

Metrics should be available both to UI and benchmark tools.

---

# 4. Complete Repository Structure

Target repository layout:

```text
optical-screen-camera-link/
│
├── README.md
├── PRD.md
├── Architecture.md
├── PRD-Architecture.md
├── Architecture-Essentials.md
├── agents.md
├── chatgpt.md
├── LICENSE
├── package.json
├── package-lock.json / pnpm-lock.yaml
├── tsconfig.base.json
├── .gitignore
├── .editorconfig
│
├── apps/
│   │
│   ├── sender-web/
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.ts
│   │   │   ├── ui/
│   │   │   │   ├── sender-controls.ts
│   │   │   │   ├── transfer-status.ts
│   │   │   │   └── diagnostics-panel.ts
│   │   │   ├── renderer/
│   │   │   │   ├── canvas-renderer.ts
│   │   │   │   ├── fullscreen.ts
│   │   │   │   └── frame-clock.ts
│   │   │   └── styles/
│   │   │       └── main.css
│   │   └── tests/
│   │
│   └── receiver-web/
│       ├── index.html
│       ├── package.json
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.ts
│       │   ├── camera/
│       │   │   ├── camera-manager.ts
│       │   │   ├── frame-source.ts
│       │   │   └── camera-capabilities.ts
│       │   ├── ui/
│       │   │   ├── camera-preview.ts
│       │   │   ├── roi-overlay.ts
│       │   │   ├── decode-status.ts
│       │   │   └── diagnostics-panel.ts
│       │   └── output/
│       │       ├── text-output.ts
│       │       └── file-output.ts
│       └── tests/
│
├── packages/
│   │
│   ├── protocol/
│   │   ├── src/
│   │   │   ├── constants.ts
│   │   │   ├── packet-types.ts
│   │   │   ├── packet.ts
│   │   │   ├── serialize.ts
│   │   │   ├── deserialize.ts
│   │   │   ├── session.ts
│   │   │   ├── chunker.ts
│   │   │   └── reassembler.ts
│   │   └── tests/
│   │
│   ├── optical-codec/
│   │   ├── src/
│   │   │   ├── profiles.ts
│   │   │   ├── grid-layout.ts
│   │   │   ├── symbol-encoder.ts
│   │   │   ├── symbol-decoder.ts
│   │   │   ├── frame-encoder.ts
│   │   │   ├── frame-decoder.ts
│   │   │   ├── finder-layout.ts
│   │   │   └── calibration-layout.ts
│   │   └── tests/
│   │
│   ├── constellation/
│   │   ├── src/
│   │   │   ├── c16.ts
│   │   │   ├── c32.ts
│   │   │   ├── c64.ts
│   │   │   ├── c128.ts
│   │   │   ├── c256.ts
│   │   │   ├── color-space.ts
│   │   │   ├── distance.ts
│   │   │   └── optimizer.ts
│   │   └── tests/
│   │
│   ├── vision/
│   │   ├── src/
│   │   │   ├── finder-detector.ts
│   │   │   ├── corner-ordering.ts
│   │   │   ├── homography.ts
│   │   │   ├── perspective-warp.ts
│   │   │   ├── roi-tracker.ts
│   │   │   ├── cell-sampler.ts
│   │   │   └── image-types.ts
│   │   └── tests/
│   │
│   ├── calibration/
│   │   ├── src/
│   │   │   ├── reference-sampler.ts
│   │   │   ├── rgb-normalize.ts
│   │   │   ├── color-transform.ts
│   │   │   ├── centroid-model.ts
│   │   │   └── calibration-state.ts
│   │   └── tests/
│   │
│   ├── fec/
│   │   ├── src/
│   │   │   ├── crc32.ts
│   │   │   ├── erasure.ts
│   │   │   └── reed-solomon.ts   # later
│   │   └── tests/
│   │
│   ├── metrics/
│   │   ├── src/
│   │   │   ├── counters.ts
│   │   │   ├── timing.ts
│   │   │   ├── throughput.ts
│   │   │   ├── error-rates.ts
│   │   │   └── benchmark-result.ts
│   │   └── tests/
│   │
│   └── shared/
│       ├── src/
│       │   ├── bytes.ts
│       │   ├── math.ts
│       │   ├── types.ts
│       │   └── logger.ts
│       └── tests/
│
├── tests/
│   │
│   ├── unit/
│   ├── integration/
│   │   ├── text-roundtrip.test.ts
│   │   ├── packet-roundtrip.test.ts
│   │   ├── frame-roundtrip.test.ts
│   │   └── corrupted-frame.test.ts
│   │
│   ├── fixtures/
│   │   ├── frames-generated/
│   │   ├── perspective/
│   │   ├── color-shift/
│   │   ├── blur/
│   │   └── noise/
│   │
│   └── recorded-captures/
│       ├── README.md
│       └── device-pairs/
│
├── tools/
│   │
│   ├── frame-generator/
│   │   └── generate-test-frame.ts
│   │
│   ├── capture-analyzer/
│   │   └── analyze-image.ts
│   │
│   ├── benchmark/
│   │   ├── run-benchmark.ts
│   │   └── compare-results.ts
│   │
│   └── constellation-designer/
│       ├── generate-colors.ts
│       ├── evaluate-confusion.ts
│       └── optimize-constellation.ts
│
├── docs/
│   │
│   ├── protocol/
│   │   ├── packet-format.md
│   │   ├── frame-types.md
│   │   └── versioning.md
│   │
│   ├── optical-frame/
│   │   ├── logical-layout.md
│   │   ├── finder-markers.md
│   │   ├── calibration-palette.md
│   │   └── modulation-profiles.md
│   │
│   ├── experiments/
│   │   ├── EXP-001-baseline.md
│   │   ├── EXP-002-color-count.md
│   │   ├── EXP-003-cell-size.md
│   │   └── EXP-004-refresh-rate.md
│   │
│   └── results/
│       ├── device-matrix.md
│       └── benchmark-history.md
│
└── .github/
    └── workflows/
        ├── test.yml
        └── build.yml
```

This is the target structure. Directories should be created only when implementation reaches them; do not generate dozens of meaningless placeholder source files merely to match the tree.

---

# 5. Package Responsibilities

## `packages/protocol`
Pure byte-level protocol. Must have zero dependency on browser camera APIs or canvas rendering.

## `packages/optical-codec`
Defines how protocol bytes become optical symbols and how symbols are positioned in a logical frame.

## `packages/constellation`
Defines colour alphabets and colour-distance operations.

## `packages/vision`
Geometry/image processing only: finder detection, homography, warping and cell sampling.

## `packages/calibration`
Maps camera-observed colours into the symbol classifier's working colour space.

## `packages/fec`
Integrity and later error correction.

## `packages/metrics`
Common telemetry objects and calculations.

## `packages/shared`
Small utilities/types only. Avoid turning this into an unstructured dumping ground.

---

# 6. Sender Data Flow

```text
User text/file
    ↓
Application input
    ↓
Uint8Array
    ↓
Session manager
    ↓
Chunker
    ↓
Packet serializer
    ↓
CRC/FEC
    ↓
Bit stream
    ↓
Symbol encoder
    ↓
Logical optical frame
    ↓
Canvas/WebGL renderer
    ↓
Physical display
```

Each transition should expose a unit-testable interface.

---

# 7. Receiver Data Flow

```text
Camera
  ↓
Image frame
  ↓
Finder detector
  ↓
ROI lock/tracker
  ↓
Perspective rectification
  ↓
Calibration reference sampling
  ↓
Calibration model
  ↓
Data cell sampling
  ↓
Symbol classifier
  ↓
Symbols / erasures
  ↓
Bit/byte recovery
  ↓
CRC/FEC
  ↓
Packet parser
  ↓
Session reassembler
  ↓
Text/file output
```

Receiver errors must be surfaced at the layer where they occur.

Examples:

- no ROI;
- bad geometry;
- calibration unavailable;
- symbol confidence too low;
- malformed packet;
- CRC failure;
- missing sequence.

Do not collapse all failures into a single `decode failed` message internally.

---

# 8. Optical Frame Architecture

## 8.1 Logical coordinate space
All protocol geometry is expressed in normalized 256 × 256 coordinates.

This allows a renderer to display the frame physically at larger dimensions while receiver logic always rectifies back to the same space.

## 8.2 Proposed regions
Conceptually:

```text
┌──────────────────────────────────┐
│ FINDER      CALIBRATION    FINDER│
│                                  │
│   ┌──────────────────────────┐   │
│   │                          │   │
│   │      DATA / METADATA     │   │
│   │         GRID             │   │
│   │                          │   │
│   └──────────────────────────┘   │
│                                  │
│ FINDER     SYNC/HEADER      FINDER│
└──────────────────────────────────┘
```

Exact geometry should be versioned and defined by a profile object rather than scattered constants.

Example:

```ts
interface OpticalProfile {
  id: string;
  logicalSize: 256;
  cellSize: number;
  gridRows: number;
  gridCols: number;
  constellationId: string;
  finderRegions: Region[];
  calibrationCells: CellAddress[];
  metadataCells: CellAddress[];
  dataCells: CellAddress[];
}
```

---

# 9. Finder Marker Strategy

Requirements:

- detect four frame boundaries;
- determine orientation;
- tolerate perspective;
- remain distinct from payload data;
- not require reading colour symbols first.

V1 should prefer robust high-contrast geometry.

Possible strategy:

- QR-like nested square at three corners;
- distinct fourth orientation marker;
- guard/quiet border around full ROI.

The exact pattern should be validated through physical-camera tests rather than chosen only for visual appearance.

---

# 10. Calibration Architecture

Calibration should have two levels.

## 10.1 Initial/session calibration
A `SYNC` or `TEST` frame presents a richer reference palette.

Purpose:

- estimate channel transform;
- measure symbol separability;
- determine if requested constellation is feasible.

## 10.2 Ongoing frame calibration
DATA frames may contain a smaller subset of references.

Purpose:

- detect brightness/white-balance drift;
- update calibration without consuming excessive payload area.

The calibration model should be stateful but resettable when a new session starts or observed conditions change abruptly.

---

# 11. Colour Constellation Architecture

A constellation is a mapping:

```text
symbol ID → nominal display colour
```

but receiver classification operates on calibrated/observed regions.

Each constellation should include:

```ts
interface Constellation {
  id: string;
  bitsPerSymbol: number;
  symbols: {
    value: number;
    displayRgb: [number, number, number];
  }[];
}
```

Later measured device profiles may add receiver-space centroids/regions.

Do not build C256 as 256 nearly identical colours. Constellation design must maximize useful separation under the actual optical channel.

---

# 12. Timing Architecture

V1 timing model:

```text
render frame
   ↓
hold for configured duration
   ↓
render next frame
```

A frame may be repeated for multiple display refresh cycles.

Reason:

- camera and display are asynchronous;
- initial priority is correct decode;
- repeated frames allow receiver lock and duplicate suppression.

Later timing modes may include:

- one frame per display refresh;
- phase/synchronization patterns;
- high-refresh displays;
- rolling-shutter-aware modulation.

Temporal optimizations must remain separate from packet encoding.

---

# 13. State Machines

## Sender state

```text
IDLE
 ↓
PREPARE
 ↓
SYNC
 ↓
TRANSMIT_DATA
 ↓
END
 ↓
COMPLETE
```

Possible errors return to a safe IDLE/ERROR state.

## Receiver state

```text
CAMERA_READY
 ↓
SEARCHING
 ↓
ROI_LOCKED
 ↓
CALIBRATING
 ↓
RECEIVING
 ↓
VALIDATING
 ↓
COMPLETE
```

Receiver may fall back:

```text
ROI_LOCKED → SEARCHING
CALIBRATING → SEARCHING
RECEIVING → CALIBRATING
```

when geometry/channel quality drops.

---

# 14. Protocol Versioning

Never couple protocol version directly to application release number.

Recommended concepts:

- protocol version;
- optical profile ID;
- constellation ID;
- FEC profile ID.

Example:

```text
Protocol: 1
Optical profile: G16
Constellation: C16
FEC: CRC32_ONLY
```

Later:

```text
Protocol: 1
Optical profile: G64
Constellation: C128
FEC: RS_xxx
```

The same packet protocol can therefore run through different optical modulation modes.

---

# 15. Testing Architecture

The system must be testable in increasing realism.

## Level 1 — Pure codec tests
No images.

```text
bytes → packet → symbols → bytes
```

## Level 2 — Generated image tests

```text
bytes → rendered image → image decoder → bytes
```

## Level 3 — Synthetic impairment tests
Generated image modified with:

- rotation;
- perspective;
- brightness;
- colour cast;
- blur;
- noise;
- resampling.

## Level 4 — Recorded physical captures
Display generated frames on actual screens and capture images/videos from actual cameras.

## Level 5 — Live transfer tests
Real sender + real receiver at runtime.

A feature is not considered robust only because Level 1 works.

---

# 16. Benchmark Architecture

Each benchmark result should be a machine-readable record similar to:

```json
{
  "sender": {
    "device": "...",
    "displayResolution": "1920x1080",
    "refreshHz": 60,
    "brightness": 100
  },
  "receiver": {
    "device": "...",
    "cameraResolution": "1920x1080",
    "fps": 30
  },
  "environment": {
    "distanceCm": 40,
    "angleDeg": 5,
    "lighting": "indoor"
  },
  "profile": {
    "grid": "G16",
    "constellation": "C16"
  },
  "result": {
    "rawBps": 0,
    "usefulBps": 0,
    "framesAccepted": 0,
    "framesRejected": 0,
    "crcFailures": 0
  }
}
```

Exact schema can evolve, but benchmark data should not live only as screenshots or prose.

---

# 17. Performance Optimization Order

Do not optimize everything simultaneously.

Recommended order:

1. Correct protocol roundtrip.
2. Correct static generated-frame roundtrip.
3. Physical static screen-camera decode.
4. Stable finder tracking.
5. Stable colour calibration.
6. Slow live frame sequence.
7. Reduce cell size.
8. Increase colour alphabet.
9. Increase frame rate.
10. Add stronger FEC/interleaving.
11. Add adaptive mode selection.
12. Explore rolling shutter/high-speed temporal modulation.

This ordering makes it possible to identify which change caused a regression.

---

# 18. V1 Implementation Plan

## Milestone 1 — Protocol core
Create:

- packet constants;
- serializer/deserializer;
- CRC32;
- chunker;
- reassembler;
- roundtrip tests.

## Milestone 2 — Static optical encoder
Create:

- C16 constellation;
- G16 logical grid;
- finder/calibration layout;
- optical image/frame renderer;
- deterministic test frames.

## Milestone 3 — Static image receiver
Create:

- finder detector;
- homography;
- normalized ROI;
- cell sampler;
- simple calibration;
- C16 classifier;
- frame decode test.

## Milestone 4 — Sender web application
Create:

- text input;
- transmit button;
- frame renderer;
- configurable slow frame duration;
- fullscreen display;
- sender metrics.

## Milestone 5 — Receiver web application
Create:

- camera access;
- live preview;
- ROI overlay;
- frame decode loop;
- recovered text;
- receiver diagnostics.

## Milestone 6 — Multi-frame transfer
Add:

- session state;
- sequence numbers;
- duplicate rejection;
- END frame;
- final payload validation.

## Milestone 7 — Small binary file
Add:

- file picker;
- file metadata kept minimal;
- binary reassembly;
- explicit receiver download/save.

---

# 19. V2+ Architectural Extensions

## Adaptive modulation controller
Input:

- error rate;
- confidence;
- finder quality;
- colour confusion matrix;
- processing load.

Output:

- preferred grid profile;
- preferred constellation;
- preferred frame duration;
- FEC profile.

## Rolling-shutter decoder
Must be implemented as an optional temporal decoder module, not mixed into baseline geometry or packet code.

## Native camera adapter
If browser APIs limit control/performance, implement native adapters with the same normalized frame-source interface.

---

# 20. Security Boundaries

The receiver treats all optical payloads as untrusted bytes.

Required rules:

- never automatically execute payloads;
- never use received length fields before bounds checking;
- cap session/payload sizes;
- reject unknown protocol versions safely;
- sanitize supplied filenames;
- require user action before saving/opening received content;
- keep camera-active UI visible;
- avoid hidden/background receiver behavior in the baseline project.

---

# 21. Coding Standards

Recommended baseline:

- TypeScript for shared/browser code;
- strict TypeScript mode;
- deterministic pure functions for codec/math layers;
- explicit typed interfaces;
- no magic protocol numbers scattered through UI code;
- central profile definitions;
- unit tests for serialization and transformations;
- comments explaining optical/math reasoning, not obvious syntax.

Heavy computer-vision dependencies should not be introduced until necessary. V1 may use lightweight custom processing or a suitable browser-capable vision library if it materially accelerates robust finder/homography work.

---

# 22. Dependency Direction

Preferred dependency flow:

```text
apps
 ↓
protocol / optical-codec / vision / calibration / metrics
 ↓
shared
```

Rules:

- `protocol` must not import `vision`.
- `vision` must not import sender UI.
- `calibration` must not know about file transfer UI.
- `metrics` may consume standardized events but must not control protocol decisions directly.
- UI can orchestrate packages but should not duplicate their logic.

---

# 23. Architectural Invariants

These should remain true as the project grows:

1. The logical optical coordinate system is independent of physical screen resolution.
2. Packet bytes are independent of optical colour selection.
3. Camera geometry is independent of file/session semantics.
4. Colour calibration is replaceable.
5. Modulation profiles are versioned/configurable.
6. Received payloads are never automatically executed.
7. Useful throughput and error metrics are measured for every performance claim.
8. Slow reliable mode remains available as a fallback even after high-speed modes exist.

---

# 24. Architectural Decision for Current Development

The current implementation target is deliberately:

```text
256×256 logical ROI
+
large 16×16 logical cells
+
16 colour regions
+
slow repeated optical frames
+
robust finder/calibration
+
CRC32
```

Only after this works through a real screen and camera should the project move toward:

```text
8×8 cells
→ 4×4 cells
→ larger colour alphabets
→ higher refresh rates
→ FEC
→ adaptive modulation
→ rolling-shutter research
```

This ensures that speed is built on a working communication channel rather than on theoretical calculations alone.
