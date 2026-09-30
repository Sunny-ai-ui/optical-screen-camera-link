# PRD — Optical Screen-to-Camera Data Link

## 1. Product Goal
Build a wireless data-transfer prototype where a laptop/mobile display is the transmitter and a camera is the receiver. The first release prioritizes reliability and observability over speed. Later releases progressively increase throughput.

## 2. Core Concept
- Sender renders a controlled optical data frame on a display.
- Receiver detects the frame using a camera.
- A fixed Region of Interest (ROI) is recovered from corner/finder markers.
- The ROI is divided into data cells.
- Each cell represents a symbol using a tolerant colour region rather than one exact RGB value.
- Symbols are decoded into bytes, validated, reordered, and written back into the original payload.

## 3. V1 Scope — Slow and Reliable
### Logical frame
- ROI: 256 × 256 logical pixels.
- Initial cell size: 16 × 16 logical pixels.
- Grid: 16 × 16 = 256 cells.
- Initial alphabet: 16 colour regions = 4 bits per data cell.
- Later V1 modes may test 32/64/128/256 colour regions.

### Frame areas
- 4 finder/corner markers.
- Calibration/reference colours.
- Protocol header.
- Payload cells.
- CRC/error-detection area.

### Sender
- Runs in a browser first.
- Accepts text or a small binary file.
- Converts input into packets and symbols.
- Renders one optical frame at a controlled refresh rate.

### Receiver
- Runs in a browser/mobile-compatible camera view first where supported.
- Finds the four corner markers.
- Performs perspective correction.
- Samples each data cell.
- Converts measured colour to the closest valid colour region.
- Reconstructs packets.
- Validates CRC and reports decode confidence/error rate.

## 4. Out of Scope for V1
- Rolling-shutter exploitation.
- Multi-Mbps optimization.
- 2 × 2 or 4 × 4 data cells.
- 256-colour/1-byte-per-cell as a mandatory mode.
- Encryption.
- Background/hidden transmission.
- Production mobile apps.

## 5. Success Criteria
V1 is successful when:
1. A sender can transmit a text message across the screen-camera optical link.
2. The receiver automatically detects and rectifies the ROI.
3. Data can be reconstructed without manual entry.
4. CRC detects corrupted frames.
5. The UI reports FPS, decoded frames, rejected frames, confidence, and estimated data rate.
6. The link works under normal indoor lighting at close range.

## 6. Roadmap
### V1 — Baseline
16-colour symbols, large cells, low refresh rate, robust calibration.

### V2 — Denser spatial encoding
8 × 8 cells, more symbols per frame, adaptive colour calibration.

### V3 — 1-byte colour symbols
Up to 256 colour regions with confidence/erasure handling and FEC.

### V4 — High-speed mode
4 × 4 and experimental 2 × 2 cells, higher display refresh rates.

### V5 — Temporal/rolling-shutter optimization
Exploit row timing and multi-state capture when supported.

## 7. Performance Metrics
- Useful throughput (bps).
- Raw throughput (bps).
- Frame decode rate.
- Frame rejection rate.
- Symbol error rate.
- Packet error rate.
- Average colour confidence.
- Distance.
- Viewing angle.
- Ambient illumination.
- Sender refresh rate.
- Receiver camera FPS/exposure.

## 8. Safety and Privacy
The system is intended for consensual local data-transfer experiments. The receiver should clearly show when camera capture is active and should not execute received payloads automatically.
