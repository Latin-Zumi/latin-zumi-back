interface DecimalParts { coefficient: bigint; scale: number }

export function parseDecimal(value: string): DecimalParts {
  const scientific = /^([+-]?\d+(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(value);
  if (scientific) {
    const exponent = Number(scientific[2]);
    const base = parseDecimal(scientific[1]);
    const newScale = base.scale - exponent;
    if (newScale < 0) return { coefficient: base.coefficient * 10n ** BigInt(-newScale), scale: 0 };
    return { coefficient: base.coefficient, scale: newScale };
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('Invalid decimal');
  const fraction = match[2] ?? '';
  return { coefficient: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
}

export function multiplyAndRoundHalfUp(
  left: string,
  right: string,
  decimalPlaces: number,
): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const product = a.coefficient * b.coefficient;
  const scale = a.scale + b.scale;
  const targetScale = 10n ** BigInt(decimalPlaces);
  const divisor = 10n ** BigInt(scale);
  const scaled = product * targetScale;
  const rounded = (scaled + divisor / 2n) / divisor;
  const integer = rounded / targetScale;
  const fraction = (rounded % targetScale).toString().padStart(decimalPlaces, '0');
  return `${integer}.${fraction}`;
}

export function normalizeDecimal(value: string, decimalPlaces = 12): string {
  const parsed = parseDecimal(value);
  if (parsed.scale > decimalPlaces) {
    const divisor = 10n ** BigInt(parsed.scale - decimalPlaces);
    const rounded = (parsed.coefficient + divisor / 2n) / divisor;
    return formatScaled(rounded, decimalPlaces);
  }
  return formatScaled(parsed.coefficient * 10n ** BigInt(decimalPlaces - parsed.scale), decimalPlaces);
}

export function subtractDecimal(left: string, right: string, decimalPlaces = 2): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale, decimalPlaces);
  const difference = a.coefficient * 10n ** BigInt(scale - a.scale)
    - b.coefficient * 10n ** BigInt(scale - b.scale);
  const negative = difference < 0n;
  const magnitude = negative ? -difference : difference;
  const divisor = 10n ** BigInt(scale - decimalPlaces);
  const rounded = (magnitude + divisor / 2n) / divisor;
  const formatted = formatScaled(rounded, decimalPlaces);
  return negative ? `-${formatted}` : formatted;
}

function formatScaled(coefficient: bigint, scale: number): string {
  const unit = 10n ** BigInt(scale);
  return `${coefficient / unit}.${(coefficient % unit).toString().padStart(scale, '0')}`;
}
