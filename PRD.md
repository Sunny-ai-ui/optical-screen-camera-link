# Product Requirements Document (PRD)

# Optical Screen-to-Camera Link

**Status:** Initial master specification  
**Project:** `optical-screen-camera-link`  
**Primary goal:** Build a reliable wireless data-transfer system in which a laptop/mobile display is the optical transmitter and a camera is the optical receiver.  
**Development philosophy:** Prove a slow, measurable, reliable link first. Increase spatial density, colour alphabet and temporal speed only after the previous mode is validated.

---

## 1. Product Vision

Create a software-defined optical communication system that transfers digital data through visible light using hardware already available on common devices:

- laptop or mobile display as transmitter;
- mobile/laptop camera as receiver;
- no Wi-Fi required for the optical hop;
- no Bluetooth required for the optical hop;
- no NFC required for the optical hop;
- no cable required for the optical hop.

The display presents a machine-readable sequence of colour-coded optical frames. The camera detects the transmission region, corrects perspective, calibrates observed colours, converts colour regions back into symbols, reconstructs packets and finally recreates the original data.

The long-term objective is to study how far useful throughput can be increased using spatial parallelism, larger colour alphabets, high-refresh displays, camera timing characteristics and adaptive modulation.

---

## 2. Problem Statement

Conventional QR codes primarily encode a static payload. A screen and camera can do more because the screen can continuously change its content.

The project therefore treats the display as a two-dimensional array of optical transmitters and the camera as a two-dimensional optical sensor.

The core engineering questions are:

1. How many independent data cells can a normal camera reliably resolve from a display?
2. How many colour regions can be reliably distinguished after screen/camera colour shift?
3. How rapidly can frames/symbols change without unacceptable error?
4. How can geometry, colour shift, exposure and ambient light be corrected automatically?
5. What is the highest **useful** data rate after framing, CRC, FEC and retransmission overhead?

---

## 3. Core Communication Concept

```text
SOURCE DATA
    ↓
Packetization
    ↓
CRC / integrity information
    ↓
Optional FEC
    ↓
Symbol encoding
    ↓
Colour-cell optical frame
    ↓
DISPLAY
    ↓ photons through air
CAMERA
    ↓
ROI / finder detection
    ↓
Perspective correction
    ↓
Colour calibration
    ↓
Cell sampling
    ↓
Symbol classification
    ↓
Error / erasure handling
    ↓
Packet reconstruction
    ↓
CRC validation
    ↓
ORIGINAL DATA
```

---

## 4. Key Design Principles

### 4.1 Colour region, not exact RGB
A data symbol must represent a **region in colour space**, not one exact RGB value.

Example concept:

```text
Transmitter symbol X
Nominal RGB = (220, 40, 50)

Receiver may observe:
(204, 47, 44)
(232, 35, 59)
(211, 52, 48)

All may still classify as symbol X.
```

The decoder should use calibration, normalized colour representation and nearest-symbol confidence rather than direct RGB equality.

### 4.2 Confidence-aware decoding
The receiver must not force every ambiguous cell into a valid byte/symbol. If confidence is too low, it should mark the cell as an **erasure/unknown** for recovery or frame rejection.

### 4.3 Geometry must be self-identifying
The optical frame requires corner/finder structures so the receiver can identify the transmitted ROI even when:

- rotated;
- tilted;
- moved within the camera frame;
- viewed with perspective distortion.

### 4.4 Useful throughput matters more than theoretical bitrate
The project must report both:

- raw theoretical bitrate;
- actually recovered useful payload bitrate.

A slower mode with very low error may outperform an aggressive mode that causes many retries.

### 4.5 Progressive capability
Do not begin with the densest possible grid or 256 colours. Each mode must be measured before progressing.

---

## 5. Baseline Logical Optical Frame

The project uses a **256 × 256 logical ROI**.

Important distinction:

- **Logical ROI:** fixed protocol coordinate system, 256 × 256.
- **Physical display area:** may be scaled to 512 × 512, 768 × 768, 1024 × 1024 or more physical screen pixels.

This allows the same protocol to run on displays of different sizes and resolutions.

### V1 baseline

- Logical ROI: `256 × 256`
- Logical cell: `16 × 16`
- Grid: `16 × 16 = 256 cells`
- Initial alphabet: `16 colour regions`
- Bits per symbol: `4 bits`
- Refresh: deliberately slow during initial validation

Some cells are reserved for:

- corner/finder information;
- orientation;
- calibration colours;
- protocol header;
- sequence information;
- CRC/integrity;
- payload.

---

## 6. Users / Use Cases

### 6.1 Primary user
Developer/researcher testing screen-camera optical communication using consumer devices.

### 6.2 Primary V1 use case
Transfer a short text message from a laptop browser to a receiving camera/browser or receiver application.

Example:

```text
Sender input:
HELLO WORLD

Screen:
animated colour data frames

Camera receiver:
HELLO WORLD
```

### 6.3 Later use cases
- contact information;
- arbitrary binary data;
- small files;
- images/documents where practical;
- device-to-device local exchange;
- offline one-way data distribution;
- optical broadcast to multiple camera receivers;
- benchmarking screen/camera channel capability.

---

## 7. Functional Requirements

## FR-01 — Sender text input
The sender must accept plain UTF-8 text and convert it into bytes for transmission.

## FR-02 — Sender binary input
A later V1/V2 sender must support selecting a small arbitrary file and reading its bytes without modifying the file content.

## FR-03 — Packetization
Input data must be broken into numbered protocol packets.

Each packet must contain sufficient information to identify:

- protocol version;
- session;
- packet/frame type;
- sequence number;
- payload length;
- payload;
- integrity value.

## FR-04 — Optical frame rendering
The sender must render packets as a deterministic matrix of colour symbols inside the logical 256 × 256 coordinate system.

## FR-05 — Finder detection
The receiver must identify the four frame corners automatically.

## FR-06 — Orientation detection
The receiver must distinguish all valid rotations so that cell coordinates remain deterministic.

## FR-07 — Perspective rectification
Detected frame geometry must be transformed to a normalized 256 × 256 logical image before cell decoding.

## FR-08 — Colour calibration
The receiver must use known reference/calibration symbols to compensate for screen-camera colour differences.

## FR-09 — Cell sampling
The receiver must sample an area within each logical cell rather than relying on a single camera pixel.

## FR-10 — Symbol classification
Each sampled cell must be classified against the current colour constellation.

Decoder output for a cell:

- symbol value;
- confidence score;
- calibrated colour value;
- raw observed colour value;
- optional erasure state.

## FR-11 — CRC validation
Received packets must be validated before being accepted.

## FR-12 — Sequence handling
The receiver must track frame/packet sequence numbers and reject unintended duplicates.

## FR-13 — Session handling
A new transfer must have a session identifier so frames from separate transfers are not accidentally mixed.

## FR-14 — Completion
The receiver must know when the complete payload has arrived and verify expected final size/integrity information.

## FR-15 — Diagnostics
The receiver UI must expose at least:

- camera FPS;
- optical frames detected;
- successfully decoded frames;
- rejected frames;
- CRC failures;
- average classification confidence;
- symbol erasures/errors when measurable;
- current data rate;
- total recovered bytes.

## FR-16 — Test mode
The system must provide a diagnostic frame containing known symbols to measure colour confusion and geometry quality before file transmission.

## FR-17 — No automatic execution
Received data must never be automatically executed as code, opened as an executable, or treated as a command. It may be displayed or saved only through explicit user action.

---

## 8. Non-Functional Requirements

### NFR-01 Reliability first
The V1 success target is correct reconstruction rather than maximum throughput.

### NFR-02 Deterministic encoding
Given the same packet and modulation mode, the optical frame generator must produce deterministic symbols.

### NFR-03 Separation of concerns
Protocol, optical encoding, rendering, vision, decoding and UI must be separate modules.

### NFR-04 Testability
Core codec functions must work without a physical camera so they can be unit tested using generated images/test vectors.

### NFR-05 Browser-first development
The initial transmitter should work in a modern desktop browser. Receiver implementation may use browser camera APIs where adequate; native mobile implementation can be added when camera control/performance requires it.

### NFR-06 Cross-device tolerance
The design must not depend on one exact display panel or camera model.

### NFR-07 Measurability
Every speed improvement must be accompanied by measured error and useful-throughput results.

### NFR-08 Graceful failure
The receiver should reject frames when geometry/calibration/confidence is insufficient rather than silently output corrupted payload data.

---

## 9. Initial Protocol

Initial packet proposal:

```text
Field         Size
--------------------------
Magic         2 bytes
Version       1 byte
Frame Type    1 byte
Session ID    2 bytes
Sequence      2 bytes
Payload Len   2 bytes
Payload       variable
CRC32         4 bytes
```

Frame types:

- `SYNC` — geometry/calibration/session establishment;
- `DATA` — data payload;
- `END` — transfer completion information;
- `TEST` — diagnostics/benchmarking.

Protocol fields may evolve, but the packet layer must remain independent from the optical modulation layer.

---

## 10. Colour Modulation Roadmap

### Mode C16
- 16 colour regions;
- 4 bits per cell;
- V1 baseline.

### Mode C32
- 32 colour regions;
- 5 bits per cell.

### Mode C64
- 64 colour regions;
- 6 bits per cell.

### Mode C128
- 128 colour regions;
- 7 bits per cell.

### Mode C256
- 256 colour regions;
- 8 bits = 1 byte per data cell.

C256 is a target capability, not a V1 assumption.

The colour constellation should ultimately be optimized based on measured camera output rather than evenly spaced RGB values alone.

---

## 11. Spatial Density Roadmap

With a 256 × 256 logical ROI:

| Logical cell size | Grid | Total cells |
|---|---:|---:|
| 16 × 16 | 16 × 16 | 256 |
| 8 × 8 | 32 × 32 | 1,024 |
| 4 × 4 | 64 × 64 | 4,096 |
| 2 × 2 | 128 × 128 | 16,384 |

Not all cells are payload cells because synchronization/calibration/protocol overhead is required.

The receiver may eventually negotiate an appropriate cell density based on measured optical quality.

---

## 12. Adaptive Link Concept

Later versions should benchmark the channel and select a mode based on actual conditions.

Possible dimensions:

```text
Colour alphabet:
16 → 32 → 64 → 128 → 256

Cell size:
16×16 → 8×8 → 4×4 → 2×2

Frame/symbol rate:
slow → display refresh limited → advanced temporal modes

Error correction:
low overhead → stronger FEC when channel worsens
```

The chosen mode should maximize:

```text
useful throughput
=
raw throughput × successful payload ratio
```

not simply raw symbol rate.

---

## 13. Error Handling

### V1
- CRC32 per packet/frame;
- invalid frame rejection;
- sequence tracking;
- optional repeat transmission.

### Later
- erasure-aware decoding;
- interleaving;
- Reed-Solomon or another suitable FEC mechanism;
- retransmission/ACK if a reverse communication path is available;
- duplicate suppression;
- missing packet recovery.

---

## 14. Calibration Requirements

The optical frame should contain known reference colours.

Calibration must help account for:

- display gamma;
- camera white balance;
- automatic exposure;
- ambient light;
- RGB channel cross-talk;
- camera image processing;
- screen brightness changes.

Potential representations to test:

- normalized RGB/chromaticity;
- HSV/HSL components;
- YCbCr chroma components;
- Lab/CIELAB distance;
- learned screen-to-camera colour transform.

The baseline should remain simple and measurable before more advanced models are introduced.

---

## 15. Receiver Geometry Requirements

Receiver processing stages:

1. Camera frame acquisition.
2. Candidate finder detection.
3. Four-corner verification.
4. Orientation determination.
5. Homography calculation.
6. Perspective warp into normalized ROI.
7. Grid coordinate generation.
8. Reference colour sampling.
9. Data-cell sampling.
10. Symbol decoding.

The data frame must include sufficient quiet/guard space so edge detection is reliable.

---

## 16. UI Requirements

### Sender UI
Must provide:

- text input;
- file selection when implemented;
- start/stop transmission;
- current mode;
- frame/packet sequence;
- transmitted bytes;
- estimated raw rate;
- display/fullscreen control;
- calibration/test mode.

### Receiver UI
Must provide:

- camera preview;
- detected ROI overlay;
- corner markers;
- cell/grid debug overlay toggle;
- calibration state;
- confidence/error indicators;
- decoded text/file information;
- received byte count;
- current useful throughput;
- reset/new session control.

---

## 17. Performance Metrics

Every benchmark should record:

### Device information
- sender device;
- sender display resolution;
- display refresh rate;
- receiver device;
- camera resolution;
- camera FPS;
- exposure if available.

### Environment
- distance;
- angle;
- ambient lighting;
- display brightness.

### Link mode
- cell size;
- grid size;
- colour alphabet;
- symbol/frame rate;
- FEC mode.

### Results
- raw bitrate;
- useful bitrate;
- frame detection rate;
- successful frame rate;
- CRC failure rate;
- symbol error/erasure rate;
- average confidence;
- total transfer time.

---

## 18. V1 Definition

V1 is intentionally conservative.

### V1-A — Offline codec proof
- text → packet;
- packet → optical image;
- generated image → decoder;
- exact recovered text.

### V1-B — Static physical-screen proof
- show static frame on display;
- photograph/capture with camera;
- automatically detect ROI;
- recover packet.

### V1-C — Slow live stream
- animate a sequence of optical frames;
- live camera receiver;
- receive multi-packet text.

### V1-D — Small file transfer
- arbitrary binary input;
- session/sequence/end handling;
- reconstruct downloaded file;
- final hash/length verification.

---

## 19. V1 Acceptance Criteria

V1 is accepted when all of the following are demonstrated:

1. Sender and receiver run without proprietary optical hardware.
2. Sender encodes a user-entered text message.
3. Receiver identifies the optical frame automatically.
4. Receiver corrects perspective sufficiently to sample the logical grid.
5. Calibration reference cells are detected.
6. Colour symbols are classified with confidence values.
7. At least one complete live multi-frame message is transferred correctly.
8. CRC rejects deliberately corrupted test frames.
9. Receiver does not output corrupted packets as valid data.
10. Diagnostics report useful throughput and decode/error statistics.
11. The project includes automated codec tests.

---

## 20. Project Roadmap

### V0 — Architecture / simulation
- repository structure;
- protocol definitions;
- colour constellation generation;
- generated test images;
- automated unit tests.

### V1 — Reliable low-speed link
- browser sender;
- camera receiver;
- finder markers;
- perspective correction;
- C16 colour alphabet;
- large cells;
- CRC;
- text and small-file transfer.

### V2 — Better optical robustness
- improved calibration;
- confidence/erasure logic;
- 8 × 8 cells;
- C32/C64 modes;
- test/benchmark dashboard.

### V3 — High-colour mode
- C128/C256 experiments;
- adaptive colour constellation;
- FEC/interleaving;
- automated link-quality selection.

### V4 — High spatial density
- 4 × 4 cells;
- experimental 2 × 2 mode;
- high-resolution camera path;
- optimized sampling and image processing.

### V5 — Temporal high-speed research
- high-refresh displays;
- synchronization optimization;
- rolling-shutter analysis;
- row-timing based temporal modulation where feasible.

### V6 — Adaptive high-speed optical link
- capability negotiation;
- dynamic modulation profile;
- continuous error-rate monitoring;
- automatic mode upshift/downshift;
- maximum useful throughput benchmark for each screen-camera pair.

---

## 21. Risks and Engineering Challenges

### Colour ambiguity
256 colours may not be reliable on all devices.

**Mitigation:** start with C16 and progressively measure larger alphabets.

### Moiré / display pixel structure
Camera sensor sampling can interfere with the physical display pixel grid.

**Mitigation:** physically scale logical cells, average cell centres and test multiple scaling ratios.

### Exposure / white-balance changes
Automatic camera controls can move symbol colours over time.

**Mitigation:** continuous/reference calibration and native/manual camera controls where required.

### Motion and focus
Camera movement or autofocus changes may corrupt cells.

**Mitigation:** large V1 cells, geometry tracking, confidence rejection.

### Display response time
Pixel transitions may not be instantaneous.

**Mitigation:** lower initial symbol rate, later transition-aware timing.

### FPS mismatch
Sender refresh and camera exposure are asynchronous.

**Mitigation:** frame IDs, persistent frames, synchronization patterns and later temporal research.

---

## 22. Security and Privacy Principles

This project is a communication transport experiment, not an automatic execution mechanism.

- Camera use must be visible to the receiver user.
- Received bytes are untrusted input.
- Never `eval`, execute or auto-launch received content.
- Enforce payload-size limits.
- Sanitize filenames/metadata before saving.
- Validate protocol length fields before allocation/use.
- Reject malformed packet structures.
- Future encryption/authentication may protect confidentiality and authenticity but is not required for the first optical-layer proof.

---

## 23. Repository-Level Deliverables

The project should evolve toward this high-level layout:

```text
optical-screen-camera-link/
│
├── PRD.md
├── Architecture.md
├── PRD-Architecture.md
├── Architecture-Essentials.md
├── agents.md
├── chatgpt.md
├── README.md
├── LICENSE
├── package.json
├── .gitignore
│
├── apps/
│   ├── sender-web/
│   └── receiver-web/
│
├── packages/
│   ├── protocol/
│   ├── optical-codec/
│   ├── vision/
│   ├── calibration/
│   ├── fec/
│   └── metrics/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── fixtures/
│   └── recorded-captures/
│
├── tools/
│   ├── frame-generator/
│   ├── benchmark/
│   └── constellation-designer/
│
├── docs/
│   ├── protocol/
│   ├── experiments/
│   └── results/
│
└── .github/
    └── workflows/
```

The detailed responsibility of each directory is defined in `Architecture.md`.

---

## 24. Product Decision Rule

At every optimization stage ask:

> Does this change increase **correctly recovered useful bytes per second** on real devices without making the link unacceptably fragile?

If not, the change is not an improvement even if its theoretical raw bitrate is higher.
