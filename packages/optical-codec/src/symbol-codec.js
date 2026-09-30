export function bytesToC16Symbols(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytesToC16Symbols expects Uint8Array');
  }

  const symbols = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i += 1) {
    symbols[i * 2] = bytes[i] >>> 4;
    symbols[i * 2 + 1] = bytes[i] & 0x0F;
  }
  return symbols;
}

export function c16SymbolsToBytes(symbols) {
  if (!(symbols instanceof Uint8Array) && !Array.isArray(symbols)) {
    throw new TypeError('c16SymbolsToBytes expects Uint8Array or Array');
  }
  if (symbols.length % 2 !== 0) {
    throw new RangeError('C16 symbol count must be even');
  }

  const bytes = new Uint8Array(symbols.length / 2);
  for (let i = 0; i < symbols.length; i += 2) {
    const high = symbols[i];
    const low = symbols[i + 1];
    if (!Number.isInteger(high) || high < 0 || high > 15 ||
        !Number.isInteger(low) || low < 0 || low > 15) {
      throw new RangeError('Every C16 symbol must be an integer from 0 to 15');
    }
    bytes[i / 2] = (high << 4) | low;
  }
  return bytes;
}
