# agents.md

## Mission
Develop the optical screen-to-camera data-transfer system incrementally. Reliability comes first; speed optimization comes only after a measured baseline works.

## Working Rules
1. Read `PRD-Architecture.md` and `Architecture-Essentials.md` before changing architecture.
2. Do not jump directly to high-speed/rolling-shutter features unless the baseline receiver is passing tests.
3. Keep sender and receiver modules separate.
4. Every protocol change must update the architecture documentation.
5. Add diagnostics before optimizing performance.
6. Never automatically execute received binary data; save or display it only.
7. Prefer deterministic algorithms over opaque heuristics in the first versions.
8. Add test vectors for encoding/decoding changes.
9. Preserve backwards compatibility inside a protocol version where practical.
10. Measure real throughput and error rate; do not claim speed from theoretical calculations alone.

## Suggested Project Structure

```text
/
├── PRD-Architecture.md
├── Architecture-Essentials.md
├── agents.md
├── chatgpt.md
├── sender/
├── receiver/
├── protocol/
├── tests/
└── docs/
```

## Development Sequence
### Phase 1
Text → packet → static frame → image-based decoder.

### Phase 2
Live screen → live camera → repeated low-rate frames.

### Phase 3
File transfer + sequence numbers + CRC + retransmission/erasure handling.

### Phase 4
Adaptive colour alphabet and smaller cells.

### Phase 5
High-speed and rolling-shutter experiments.

## Definition of Done for Any Change
- Code runs.
- Existing tests pass.
- New behavior has a test where feasible.
- Metrics/logging expose failures.
- Documentation matches implementation.
