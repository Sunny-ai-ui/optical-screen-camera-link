# Optical Screen-to-Camera Link

Experimental visible-light data transfer using a normal laptop/mobile display as the transmitter and a normal camera as the receiver.

> **Current release: v0.4.0** — hardened one-way V3 optical link with temporal fusion, adaptive receiver logic, resilient fountain transport, physical-channel calibration, and improved decoder sampling/classification. No reverse communication channel is used.

V1 deliberately prioritizes **correct decoding and measurements** over speed. Later versions will increase cell density, colour alphabet size, frame rate and eventually explore rolling-shutter timing.

## V1 baseline

- Logical optical ROI: `256 × 256`
- Cell size: `16 × 16`
- Grid: `16 × 16`
- Colour alphabet: `C16`
- Bits per colour symbol: `4`
- Data cells: `176`
- Optical envelope: `88 bytes/frame`
- Maximum encoded protocol packet: `86 bytes`
- Recommended DATA payload: `72 bytes`
- Packet integrity: `CRC32`
- Whole-transfer integrity: `CRC32`

## End-to-end flow

```text
Text / Binary
    ↓
Packetization + sequence + CRC32
    ↓
C16 symbol mapping
    ↓
256×256 optical frame
    ↓
Laptop/mobile screen
    ↓ visible light
Camera
    ↓
Bright-square ROI detection
    ↓
Perspective rectification
    ↓
Finder/orientation check
    ↓
Per-frame 16-colour calibration
    ↓
Cell classification
    ↓
Protocol CRC validation
    ↓
Packet reassembly
    ↓
Recovered text/data
```

## Run locally

Because the receiver uses the camera, serve the repository from a secure origin. `localhost` is accepted by modern browsers for local development.

```bash
python -m http.server 8080
```

Then open:

- Landing page: `http://localhost:8080/`
- Sender: `http://localhost:8080/apps/sender-web/`
- Receiver: `http://localhost:8080/apps/receiver-web/`

For a phone receiver, use the GitHub Pages HTTPS deployment instead of plain LAN HTTP, because mobile browsers normally require HTTPS for camera access.

## First physical test

1. Open the **Sender** on a laptop or second phone.
2. Enter a short message such as `HELLO OPTICAL`.
3. Press **Generate Frames**.
4. Select **1 fps**.
5. Press **Fullscreen Frame**.
6. Set the sender screen brightness high enough for stable camera exposure.
7. Open the **Receiver** on another device.
8. Press **Start Camera** and grant camera permission.
9. Point the camera at the whole bright sender square from roughly 20–60 cm away.
10. Keep the screen reasonably straight for the first test.
11. Watch for `ROI locked`, then valid `DATA` / `END` packets and finally `Complete`.

## Receiver V1 implementation

The receiver currently uses OpenCV.js for only the geometry stage:

- frame acquisition;
- bright quadrilateral detection;
- perspective warp.

The custom project code then performs:

- orientation selection using the four finder patterns;
- calibration using the 16 known C16 symbols emitted in every frame;
- normalized colour-space nearest-centroid classification;
- optical-envelope recovery;
- protocol CRC validation;
- session/sequence reassembly.

A decoded optical frame is **never trusted just because colours were classified**. The packet must also pass the protocol CRC32 check.

## Important V1 limitations

- V1 is tuned for a dark sender background and a clearly visible bright outer square.
- Automatic exposure/white balance can still change during a transfer.
- The C16 palette is intentionally conservative but is not yet optimized for every screen/camera pair.
- The receiver currently processes a few frames per second, not full camera FPS.
- There is no FEC yet; corrupt packets are rejected and must be seen again during the repeating sender cycle.
- File-save UI will be added after stable text transfer is demonstrated physically.

## Repository documents

- `PRD.md` — master product requirements.
- `Architecture.md` — master technical architecture and full target repository structure.
- `PRD-Architecture.md` — original baseline requirements.
- `Architecture-Essentials.md` — concise architectural principles.
- `agents.md` — implementation rules for coding agents.
- `chatgpt.md` — ChatGPT project guidance.

## Roadmap

```text
V1  Reliable low-speed C16 link
 ↓
V2  Better calibration + 8×8 cells + C32/C64
 ↓
V3  C128/C256 + confidence/erasure handling + FEC
 ↓
V4  4×4 / experimental 2×2 cells + higher refresh
 ↓
V5  Adaptive link negotiation
 ↓
V6  Rolling-shutter / advanced temporal experiments
```

The main performance metric is **useful recovered payload throughput**, not theoretical raw bitrate.

## V3.2 temporal receiver (current experimental path)

The dedicated V3 receiver now includes an experimental temporal-evidence path at `apps/receiver-v3/`.

Key points:

- V3 G32/G48/G64 sender profiles remain wire-compatible with the previous V3 implementation.
- The receiver separates optical observation from RS packet recovery.
- Expensive cell classification can run in a Web Worker.
- Compatible camera observations are grouped over a short time window.
- Shape and colour evidence are fused independently using confidence-weighted voting.
- Reed-Solomon receives fused confidence/erasure information and can be retried when another compatible observation arrives.
- Low-agreement observations are treated as likely sender-frame transitions and start a new group instead of being mixed.
- `apps/receiver-v3/?mode=legacy` retains the previous single-frame V3 decoder for A/B testing.

Run the deterministic temporal benchmark with:

```bash
npm run benchmark:v3-temporal
```

Implementation and physical-validation notes are in `docs/V3.2_TEMPORAL_RECEIVER_IMPLEMENTATION.md`.

## V3.2B adaptive link

The temporal V3 receiver now maintains a rolling link-quality model. It adapts the number of camera observations required before RS decoding and recommends G32/G48/G64 upgrade or fallback only after a sustained quality streak. Because the optical link is currently one-way, profile changes remain manual; the receiver does not pretend to control the sender.

The sender now includes **Auto Reliable dwell**. Current defaults are 700 ms/frame for G32, 900 ms/frame for G48, and 1200 ms/frame for G64. Manual 0.5/1/2 fps modes remain available.

For physical validation, begin with **G32 + Auto Reliable dwell**, watch Link quality / Evidence target / Adaptive action on the V3 receiver, and move to the recommended profile only after the recommendation remains stable.

## V3.2C resilient transport

V3 now supports a **Resilient Fountain** transport mode in addition to the original ordered DATA/END transport. The optical receiver still performs temporal fusion and RS(15,11) first; valid packets are then fed into a deterministic fountain reassembler so complete missed optical frames no longer require every original DATA packet to be received. Classic transport remains selectable for compatibility and A/B testing.

Use `npm run benchmark:v3-fountain` for the deterministic whole-frame-loss benchmark. See `V3.2C-RESILIENT-TRANSPORT-REPORT.md` for the implementation details.

## V3.2D physical-channel calibration

The V3 receiver now learns a rolling physical-channel baseline from real camera observations. It tracks timing/signature separation, shape/colour confidence, pixels per cell, frame quality, and actual decode success. Once enough observations are collected, it derives a bounded learned quality gate and recommends a sender profile, frame dwell, and fountain redundancy level.

Because the current optical link is one-way, the receiver does not silently reconfigure the sender. Apply the closest recommendation using the sender's profile, dwell, and fountain-redundancy controls. Debug snapshots include the learned calibration and optimizer decision.


## V3.2E receiver decoder hardening

V3.2E keeps the system strictly one-way (sender → camera receiver) and focuses on physical decoder reliability. It adds sub-pixel timing-phase refinement with drift protection, bilinear cell sampling, per-frame RGB channel normalization from the live colour calibration row, local per-cell background estimation for shape decoding, higher-resolution 5×5 shape features, absolute-fit-aware colour/shape confidence, calibration-driven timing/signature gates, calibration-aware confidence scaling before RS erasure selection, and diagnostics for low-confidence cells plus colour/shape calibration separation.

No reverse communication, ACK channel, or receiver-to-sender control path is implemented. The existing temporal fusion, adaptive recommendations, fountain transport, RS(15,11), interleaving, CRC, G32/G48/G64 profiles, legacy receiver fallback, and debug snapshot workflow remain intact.
