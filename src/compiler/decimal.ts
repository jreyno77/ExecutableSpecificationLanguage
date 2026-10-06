/** Normalize authored digits and exponent without rounding through a host number. */
export function decimal(token: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
  let digits = (match[2]! + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(0, digits.length - trailing); exponent += BigInt(trailing);
  return (match[1] === '-' ? '-' : '') + digits + 'e' + exponent;
}
