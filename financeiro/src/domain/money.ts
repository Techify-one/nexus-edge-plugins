const MAX_AMOUNT = 999_999_999_999_999n;
const UNSIGNED = /^(?:0|[1-9][0-9]{0,14})(?![\s\S])/;
const SIGNED = /^(?:0|-?[1-9][0-9]{0,14})(?![\s\S])/;

/** Parse canonical integer cents without coercion or whitespace normalization. */
export function money(value: unknown, signed = false): bigint {
  if (typeof value !== "string" || !(signed ? SIGNED : UNSIGNED).test(value)) {
    throw new Error("Informe centavos como string canônica de até 15 dígitos.");
  }
  return BigInt(value);
}

/** Serialize cents using the same bounds as the API input. */
export function amount(value: bigint): string {
  if (typeof value !== "bigint" || value < -MAX_AMOUNT || value > MAX_AMOUNT) {
    throw new Error("Valor em centavos fora do limite de 15 dígitos.");
  }
  return value.toString();
}

/** Aggregates can exceed individual amounts; bounds apply at serialization. */
export function sum(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/** Sum rational monthly equivalents, rounding only the final total to a cent. */
export function monthlyAverage(
  values: Iterable<{ cents: bigint; frequency: string; interval: number }>,
): string {
  let numerator = 0n,
    denominator = 1n;
  const gcd = (a: bigint, b: bigint): bigint => {
    while (b) [a, b] = [b, a % b];
    return a;
  };
  for (const value of values) {
    if (
      !Number.isSafeInteger(value.interval) ||
      value.interval < 1 ||
      value.cents < 0n
    )
      throw new RangeError("Invalid monthly average input");
    const factor =
      value.frequency === "SEMANA" ? 4n : value.frequency === "DIA" ? 30n : 1n;
    const divisor =
      BigInt(value.interval) * (value.frequency === "ANO" ? 12n : 1n);
    if (!["DIA", "SEMANA", "MES", "ANO"].includes(value.frequency))
      throw new RangeError("Invalid recurrence frequency");
    const common = (denominator / gcd(denominator, divisor)) * divisor;
    numerator =
      numerator * (common / denominator) +
      value.cents * factor * (common / divisor);
    denominator = common;
    const reduce = gcd(numerator, denominator);
    if (reduce) {
      numerator /= reduce;
      denominator /= reduce;
    }
  }
  return amount((numerator * 2n + denominator) / (denominator * 2n));
}
