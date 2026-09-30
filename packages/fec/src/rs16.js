// Reed-Solomon RS(15,11) over GF(16), primitive polynomial x^4 + x + 1 (0x13).
// Symbols are nibbles (0..15), which maps directly to the V3 optical alphabet.
// Four parity symbols correct up to two arbitrary unknown symbol errors, or up
// to four known erasures, or mixed errors/erasures satisfying 2e + s <= 4.

export const RS16_N = 15;
export const RS16_K = 11;
export const RS16_PARITY = RS16_N - RS16_K;
export const RS16_T = RS16_PARITY / 2;

const FIELD_ORDER = 15;
const EXP = new Uint8Array(FIELD_ORDER * 2);
const LOG = new Int8Array(16).fill(-1);

let value = 1;
for (let i = 0; i < FIELD_ORDER; i += 1) {
  EXP[i] = value;
  LOG[value] = i;
  value <<= 1;
  if (value & 0x10) value ^= 0x13;
}
for (let i = FIELD_ORDER; i < EXP.length; i += 1) EXP[i] = EXP[i - FIELD_ORDER];

export function gf16Mul(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 15 || b < 0 || b > 15) {
    throw new RangeError('GF(16) operands must be integers from 0 to 15');
  }
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % FIELD_ORDER];
}

export function gf16Div(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 15 || b < 0 || b > 15) {
    throw new RangeError('GF(16) operands must be integers from 0 to 15');
  }
  if (b === 0) throw new RangeError('Division by zero in GF(16)');
  if (a === 0) return 0;
  return EXP[(LOG[a] - LOG[b] + FIELD_ORDER) % FIELD_ORDER];
}

export function gf16PowAlpha(power) {
  const p = ((power % FIELD_ORDER) + FIELD_ORDER) % FIELD_ORDER;
  return EXP[p];
}

function polyMul(a, b) {
  const out = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) out[i + j] ^= gf16Mul(a[i], b[j]);
  }
  return out;
}

function buildGenerator() {
  let generator = Uint8Array.of(1);
  for (let root = 1; root <= RS16_PARITY; root += 1) {
    generator = polyMul(generator, Uint8Array.of(1, gf16PowAlpha(root)));
  }
  return generator;
}

const GENERATOR = buildGenerator();

function polyEval(coefficients, x) {
  let result = 0;
  for (const coefficient of coefficients) result = gf16Mul(result, x) ^ coefficient;
  return result;
}

export function rs16Syndromes(codeword) {
  if (!(codeword instanceof Uint8Array) || codeword.length !== RS16_N) {
    throw new TypeError(`RS16 codeword must be Uint8Array(${RS16_N})`);
  }
  return Uint8Array.from(
    { length: RS16_PARITY },
    (_, index) => polyEval(codeword, gf16PowAlpha(index + 1)),
  );
}

function syndromesAreZero(syndromes) {
  return syndromes.every((symbol) => symbol === 0);
}

export function rs16Encode(dataSymbols) {
  if (!(dataSymbols instanceof Uint8Array) || dataSymbols.length !== RS16_K) {
    throw new TypeError(`RS16 data must be Uint8Array(${RS16_K})`);
  }
  for (const symbol of dataSymbols) {
    if (symbol > 15) throw new RangeError('RS16 symbols must be nibbles (0..15)');
  }

  const work = new Uint8Array(RS16_N);
  work.set(dataSymbols);
  for (let i = 0; i < RS16_K; i += 1) {
    const coefficient = work[i];
    if (coefficient === 0) continue;
    for (let j = 1; j < GENERATOR.length; j += 1) work[i + j] ^= gf16Mul(GENERATOR[j], coefficient);
  }

  const codeword = new Uint8Array(RS16_N);
  codeword.set(dataSymbols, 0);
  codeword.set(work.slice(RS16_K), RS16_K);
  return codeword;
}

function applyError(codeword, position, magnitude) {
  const corrected = codeword.slice();
  corrected[position] ^= magnitude;
  return corrected;
}

function trySingleError(codeword, syndromes) {
  if (syndromes[0] === 0) return null;
  for (let position = 0; position < RS16_N; position += 1) {
    const degree = RS16_N - 1 - position;
    const x = gf16PowAlpha(degree);
    const magnitude = gf16Div(syndromes[0], x);
    if (magnitude === 0) continue;
    const candidate = applyError(codeword, position, magnitude);
    if (syndromesAreZero(rs16Syndromes(candidate))) {
      return { codeword: candidate, correctedSymbols: 1, positions: [position], erasuresUsed: 0 };
    }
  }
  return null;
}

function tryDoubleError(codeword, syndromes) {
  const s1 = syndromes[0];
  const s2 = syndromes[1];

  for (let first = 0; first < RS16_N - 1; first += 1) {
    const x1 = gf16PowAlpha(RS16_N - 1 - first);
    const x1Squared = gf16Mul(x1, x1);

    for (let second = first + 1; second < RS16_N; second += 1) {
      const x2 = gf16PowAlpha(RS16_N - 1 - second);
      const x2Squared = gf16Mul(x2, x2);
      const determinant = gf16Mul(x1, x2Squared) ^ gf16Mul(x2, x1Squared);
      if (determinant === 0) continue;

      const e1 = gf16Div(gf16Mul(s1, x2Squared) ^ gf16Mul(s2, x2), determinant);
      const e2 = gf16Div(gf16Mul(x1, s2) ^ gf16Mul(x1Squared, s1), determinant);
      if (e1 === 0 || e2 === 0) continue;

      const candidate = codeword.slice();
      candidate[first] ^= e1;
      candidate[second] ^= e2;
      if (syndromesAreZero(rs16Syndromes(candidate))) {
        return { codeword: candidate, correctedSymbols: 2, positions: [first, second], erasuresUsed: 0 };
      }
    }
  }
  return null;
}

function solveGf16(matrix, rhs) {
  const n = matrix.length;
  if (n === 0) return [];
  const a = matrix.map((row, r) => [...row, rhs[r]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    while (pivot < n && a[pivot][column] === 0) pivot += 1;
    if (pivot === n) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];

    const divisor = a[column][column];
    for (let c = column; c <= n; c += 1) a[column][c] = gf16Div(a[column][c], divisor);

    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      if (factor === 0) continue;
      for (let c = column; c <= n; c += 1) a[row][c] ^= gf16Mul(factor, a[column][c]);
    }
  }
  return a.map((row) => row[n]);
}

function tryKnownErrorPositions(codeword, syndromes, positions, erasureCount = positions.length) {
  if (!positions.length || positions.length > RS16_PARITY) return null;
  const matrix = [];
  const rhs = [];
  for (let equation = 1; equation <= positions.length; equation += 1) {
    matrix.push(positions.map((position) => {
      const degree = RS16_N - 1 - position;
      return gf16PowAlpha(degree * equation);
    }));
    rhs.push(syndromes[equation - 1]);
  }
  const magnitudes = solveGf16(matrix, rhs);
  if (!magnitudes) return null;

  const candidate = codeword.slice();
  const correctedPositions = [];
  positions.forEach((position, index) => {
    const magnitude = magnitudes[index];
    if (magnitude !== 0) {
      candidate[position] ^= magnitude;
      correctedPositions.push(position);
    }
  });
  if (!syndromesAreZero(rs16Syndromes(candidate))) return null;
  return {
    codeword: candidate,
    correctedSymbols: correctedPositions.length,
    positions: correctedPositions,
    erasuresUsed: erasureCount,
  };
}

function sanitizeErasures(erasures) {
  if (!Array.isArray(erasures)) return [];
  return [...new Set(erasures)]
    .filter((position) => Number.isInteger(position) && position >= 0 && position < RS16_N)
    .slice(0, RS16_PARITY);
}

export function rs16Decode(codeword, options = {}) {
  if (!(codeword instanceof Uint8Array) || codeword.length !== RS16_N) {
    throw new TypeError(`RS16 codeword must be Uint8Array(${RS16_N})`);
  }
  for (const symbol of codeword) {
    if (symbol > 15) throw new RangeError('RS16 symbols must be nibbles (0..15)');
  }

  const syndromes = rs16Syndromes(codeword);
  if (syndromesAreZero(syndromes)) {
    return { data: codeword.slice(0, RS16_K), correctedSymbols: 0, positions: [], erasuresUsed: 0 };
  }

  const erasures = sanitizeErasures(options.erasures);
  if (erasures.length) {
    // First assume every optical error is among the low-confidence erasures.
    const erasureOnly = tryKnownErrorPositions(codeword, syndromes, erasures, erasures.length);
    if (erasureOnly) {
      return { ...erasureOnly, data: erasureOnly.codeword.slice(0, RS16_K) };
    }

    // With <=2 erasures the RS distance still permits one additional unknown
    // error (2*1 + s <= 4). Enumerating one location is tiny for N=15.
    if (erasures.length <= 2) {
      for (let unknown = 0; unknown < RS16_N; unknown += 1) {
        if (erasures.includes(unknown)) continue;
        const mixed = tryKnownErrorPositions(codeword, syndromes, [...erasures, unknown], erasures.length);
        if (mixed) return { ...mixed, data: mixed.codeword.slice(0, RS16_K) };
      }
    }
  }

  const single = trySingleError(codeword, syndromes);
  if (single) return { ...single, data: single.codeword.slice(0, RS16_K) };

  const double = tryDoubleError(codeword, syndromes);
  if (double) return { ...double, data: double.codeword.slice(0, RS16_K) };

  const error = new Error('RS16 codeword has more errors than RS(15,11) can correct');
  error.code = 'RS16_UNCORRECTABLE';
  error.erasures = erasures;
  throw error;
}
