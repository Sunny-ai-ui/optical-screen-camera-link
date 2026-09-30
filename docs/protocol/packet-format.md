# Protocol V1 Packet Format

This document describes the first executable data-layer protocol for the optical screen-to-camera link.

## Design goal

The packet format is deliberately independent of colour encoding, grid density, display refresh rate and camera implementation. The same packet bytes can later be carried by C16, C64, C256 or another optical modulation mode.

## Byte layout

All multi-byte integers are unsigned and encoded in **network byte order (big-endian)**.

```text
Offset  Size   Field
--------------------------------
0       2      Magic = 0x4F 0x53 ("OS")
2       1      Protocol version = 1
3       1      Frame type
4       2      Session ID
6       2      Sequence
8       2      Payload length N
10      N      Payload
10+N    4      CRC32
```

Minimum encoded packet size: **14 bytes**.

CRC32 is IEEE CRC-32 and covers every byte from offset 0 through the final payload byte. The CRC field itself is not included in the calculation.

## Frame types

| Value | Name | Purpose |
|---:|---|---|
| 1 | SYNC | Reserved for optical/session synchronization |
| 2 | DATA | Carries transfer bytes |
| 3 | END | Declares transfer completion metadata |
| 4 | TEST | Reserved for calibration/benchmark traffic |

V0.1 transfer logic currently consumes DATA and END. SYNC and TEST will become active when the optical frame layer is implemented.

## DATA packet

`sequence` starts at 0 and increases by one for each chunk.

V0.1 uses a conservative default payload chunk of **64 bytes**, but this is not a protocol limit. Optical modes can select a different chunk size up to the implementation limit.

## END packet

The END packet has an 8-byte payload:

```text
Offset  Size   Field
-------------------------------
0       4      Original transfer length
4       4      CRC32 of the complete original data
```

For END packets, `sequence` equals the number of DATA packets expected in the transfer.

Example:

```text
DATA seq 0
DATA seq 1
DATA seq 2
END  seq 3
```

The receiver therefore knows both the expected number of chunks and the expected reconstructed byte length.

## Integrity levels

The first protocol deliberately uses two integrity checks:

1. **Packet CRC32** — catches corruption of one encoded packet.
2. **Transfer CRC32** — catches incorrect final reassembly even if packet-level handling is wrong.

CRC is an error-detection mechanism, not a security/authentication mechanism.

## Receiver behavior

The receiver:

1. validates magic, version, frame type and declared length;
2. validates packet CRC32;
3. locks onto one session ID;
4. stores DATA by sequence number;
5. tolerates identical duplicates;
6. rejects conflicting duplicates or mixed sessions;
7. may receive DATA out of order;
8. waits until END metadata and all required sequences are present;
9. reconstructs bytes in sequence order;
10. validates final length and whole-transfer CRC32;
11. exposes the data only after successful final validation.

## Safety rule

Protocol bytes are data only. A receiver must never automatically execute a received payload. Applications may display text or offer an explicit save/download action.

## Next protocol work

- SYNC payload definition;
- optical mode/profile identifier;
- optional total packet count in early metadata;
- transfer metadata for filename/MIME type;
- FEC profile identifier;
- erasure-aware recovery;
- optional ACK/retransmission channel later.
