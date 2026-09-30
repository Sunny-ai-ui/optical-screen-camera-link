# V3 High-Density Optical Modem — Implementation Plan

## Why V3 exists

V1/V2 proved that real data can travel from an ordinary display to an ordinary phone camera, including multi-frame reassembly. They also exposed the wrong scaling strategy: trying to obtain many bits from a small number of large cells makes the optical classifier fragile.

V3 reverses that strategy:

- many more cells;
- fewer states per cell;
- high-resolution decoding;
- timing tracks for sub-cell alignment;
- real forward error correction instead of 3x repetition;
- interleaving so local blur does not destroy one FEC block;
- streaming/fountain coding later.

The design target is not merely a custom QR code. The target is a continuous screen-to-camera optical modem.

---

## V3.0 implemented baseline

Profile ID: `V3-G64-S4-C4-RS15-11`

| Item | V3.0 |
|---|---:|
| Full optical frame | 912 x 912 logical px |
| Quiet zone | 72 px |
| Data/timing ROI | 768 x 768 px |
| Grid | 64 x 64 |
| Cell | 12 x 12 logical px |
| Shape states | 4 = 2 bits |
| Colour states | 4 = 2 bits |
| Raw bits per data cell | 4 |
| Encoded data cells used | 3,810 |
| FEC | RS(15,11) over GF(16) |
| RS correction | up to 2 wrong 4-bit symbols / 15-symbol block |
| RS codewords | 254 |
| FEC-protected data nibbles | 2,794 |
| FEC-protected envelope | 1,397 bytes |
| Maximum protocol packet | 1,395 bytes |
| Initial recommended DATA payload | 1,024 bytes |

The first physical target deliberately uses a 1,024-byte DATA chunk rather than the mathematical maximum. A shorter packet requires fewer RS codewords to decode successfully and is a safer starting point.

---

## One V3 optical cell

Each cell has one solid calibrated colour background and one very strong high-contrast shape.

```text
4 colours = 2 bits
4 shapes  = 2 bits
-----------------
             4 bits / cell
```

Current shape family:

- vertical bar;
- horizontal bar;
- diagonal down;
- diagonal up.

Current colour family:

- red;
- green;
- blue;
- yellow.

The colour and shape classifiers are calibrated from dedicated cells in every optical frame.

---

## Frame structure

```text
+-------------------------------------------------------+
| alternating timing track                             |
|  [finder] ... calibration + signature ... [finder]  |
| T                                                   T |
| I                 RS-interleaved                    I |
| M                 DATA CELLS                        M |
| I                                                   I |
| N                                                   N |
| G                                                   G |
|  [finder]                               [finder]     |
| alternating timing track                             |
+-------------------------------------------------------+

Outside the logical grid:
4 large black/white/black optical fiducials
```

The four outside fiducials handle global perspective. The timing border handles fine grid phase.

---

## Two-resolution receiver

V3 does not downscale the data before decoding.

```text
CAMERA 720p / 1080p
        |
        +--> 640px locator image
        |       |
        |       +--> global 4-marker acquisition
        |       +--> local marker tracking
        |
        +--> native/high-resolution camera image
                |
                +--> perspective warp directly to 768x768 ROI
                +--> +/-2px timing-phase search
                +--> cell classification
                +--> deinterleave
                +--> RS correction
                +--> protocol CRC
                +--> transfer reassembly
```

The full-resolution data path is the important change. A cheap low-resolution image is used only for locating/tracking the frame.

---

## Fiducial tracking

V2 repeatedly searched the whole camera image for the four highest-scoring locator-like patterns. That allowed a false internal candidate to replace a valid corner.

V3 behaviour:

1. global search acquires the four markers once;
2. each marker is then searched only in a small region around its previous location;
3. the four identities remain TL/TR/BR/BL during local tracking;
4. global search is used again only after tracking is lost;
5. the data path is decoded only when the V3 timing/signature check passes.

---

## Timing phase

Even a good perspective transform can leave the cell grid shifted by one or two pixels.

V3 reserves the complete outer row/column as alternating black/white timing cells. The decoder tests 25 phase positions:

```text
dx = -2 .. +2
dy = -2 .. +2
```

The phase with the strongest expected black/white separation becomes the sampling origin for the entire grid.

---

## Reed-Solomon design

V3 cells are 4-bit symbols, so FEC works directly on 4-bit values.

```text
RS(15,11) over GF(16)
11 data symbols
+4 parity symbols
=15 transmitted symbols
```

Each codeword can correct up to two arbitrary bad optical cells.

The encoded codewords are spatially interleaved. Consecutive cells on screen belong to different RS codewords, so a local blur/glare/moire region distributes errors rather than concentrating them inside one codeword.

The decoder also stops RS processing once it has recovered enough blocks for the actual packet length. Padding blocks after the packet do not need to decode.

---

## Capacity roadmap

The same S4 x C4 + RS(15,11) concept scales by increasing the grid, not by adding colours.

Approximate capacities after timing/finder/calibration reservations and RS overhead:

| Grid | Approx encoded cells | FEC-protected envelope | Practical stage |
|---:|---:|---:|---|
| 64 x 64 | 3,810 | ~1.40 KB | V3.0 implemented |
| 80 x 80 | ~6,045 | ~2.21 KB | V3.2 target |
| 96 x 96 | ~8,790 | ~3.22 KB | V3.3 QR-capacity target |

At 96 x 96, the design can exceed roughly 3 KB per frame while still retaining RS parity. This is the point at which the architecture becomes competitive with the maximum binary payload of one dense QR image.

The comparison must be made using usable error-corrected payload on the same screen/camera/distance, not theoretical raw symbols.

---

## Physical acceptance gates

### Gate A — V3.0 acquisition

- four-marker global acquisition succeeds;
- local tracking becomes the normal tracking mode;
- V3 coarse timing/signature lock > 95% while devices are stationary;
- camera reports >= 8 camera pixels/cell where possible.

### Gate B — 64x64 symbol reliability

- timing contrast remains stable;
- average shape confidence > 85%;
- average colour confidence > 85%;
- RS corrects ordinary cell errors without frequent uncorrectable blocks;
- 100-byte transfer succeeds 10/10 times;
- 1 KB transfer succeeds 10/10 times in a fixed setup.

### Gate C — packet efficiency

- accepted optical packets > 80%, then target > 95%;
- useful throughput is measured from first accepted packet to completion;
- no 3x spatial repetition in V3.

Only after these gates should the grid increase.

---

## V3 roadmap

### V3.0 — implemented

- 64x64 grid;
- S4 x C4 modulation;
- 912px full frame / 768px ROI;
- two-resolution receiver;
- local fiducial tracking;
- bilinear perspective sampling;
- timing tracks and +/-2px phase search;
- RS(15,11) GF(16);
- spatial interleaving;
- protocol CRC + reassembly;
- 1,024-byte recommended DATA chunk;
- live density/FEC metrics.

### V3.1 — physical tuning

- measure a confusion matrix for all 16 shape/colour combinations;
- choose the best four camera-space colours automatically;
- confidence-assisted RS erasures;
- improve local marker tracking thresholds;
- camera exposure/focus controls where browsers permit;
- adaptive processing cadence based on CPU time.

### V3.2 — 80x80

Enable only after the 64x64 acceptance gate is met.

- smaller cell pitch;
- retain 4-bit alphabet;
- same RS/interleaving layer;
- target ~2.2 KB protected envelope/frame.

### V3.3 — 96x96

- target >= 8 camera pixels/cell under the intended test geometry;
- target >3 KB protected envelope/frame;
- direct QR capacity comparison on the same devices.

### V3.4 — stream coding

- add fountain/LT/Raptor-style frame-level recovery;
- receiver no longer requires every numbered frame;
- dropped frames become normal rather than exceptional.

### V3.5 — speed

After packet acceptance is stable:

```text
1 fps
2 fps
5 fps
10 fps
15 fps
30 fps
```

Measure useful bytes/s at every step and stop increasing rate when accepted-packet throughput falls.

### V3.6 — adaptive modem

Receiver quality feeds back into profile selection when a reverse channel is available, or sender cycles robust/performance profiles when it is not.

Potential profiles:

- G64 S4C4 RS — robust;
- G80 S4C4 RS — balanced;
- G96 S4C4 RS — dense;
- future G96 S4C8 — performance only after the simple alphabet is proven.

---

## What we are explicitly not doing in V3.0

- 32/256 colour alphabets;
- 8 complex glyphs per cell;
- background-level data;
- rolling-shutter modulation;
- 30 fps before 1 fps is reliable;
- replacing FEC with repetition.

Those ideas remain experiments, but density + simple symbols + FEC is now the primary architecture.
