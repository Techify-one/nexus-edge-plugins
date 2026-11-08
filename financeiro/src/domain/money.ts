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
