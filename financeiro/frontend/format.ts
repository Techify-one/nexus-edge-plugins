// Financial dates are civil dates. Only audit timestamps represent instants.
export function civilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("financeiro.dataInvalida");
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const result = new Date(0);
  result.setHours(12, 0, 0, 0);
  result.setFullYear(year, month - 1, day);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  )
    throw new Error("financeiro.dataInvalida");
  return result;
}
export function today(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const formatDate = (value: string, locale: string): string =>
  new Intl.DateTimeFormat(locale).format(civilDate(value));
export const addDays = (value: string, days: number): string => {
  const date = civilDate(value);
  date.setDate(date.getDate() + days);
  return today(date);
};
export const moneyInput = (cents: string, locale: string): string => {
  const value = BigInt(cents);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}${locale === "pt-BR" ? "," : "."}${String(abs % 100n).padStart(2, "0")}`;
};
export function parseMoney(
  value: string,
  locale: string,
  signed = false,
): string {
  const separator = locale === "pt-BR" ? "," : ".";
  const normalized = value.trim();
  const pattern = new RegExp(
    `^${signed ? "-?" : ""}\\d+(?:\\${separator}\\d{1,2})?$`,
  );
  if (!pattern.test(normalized)) throw new Error("financeiro.valorInvalido");
  const negative = normalized.startsWith("-");
  const [integer = "", fraction = ""] = normalized
    .replace("-", "")
    .split(separator);
  const result = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > 999999999999999n || (!signed && result <= 0n))
    throw new Error("financeiro.valorInvalido");
  return `${negative && result !== 0n ? "-" : ""}${result}`;
}
export function formatMoney(cents: string, locale: string): string {
  if (!/^-?\d+$/.test(cents)) throw new Error("financeiro.valorInvalido");
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Format the integer with BigInt, then replace the fraction without converting cents to Number.
  const parts = formatter.formatToParts(
    value < 0n ? -(absolute / 100n) : absolute / 100n,
  );
  if (value < 0n && absolute < 100n)
    parts.unshift({ type: "minusSign", value: "-" });
  return parts
    .map((part) =>
      part.type === "fraction"
        ? String(absolute % 100n).padStart(2, "0")
        : part.value,
    )
    .join("");
}
// A lexicographic key keeps numeric ordering exact in the shared table string sorter.
export function moneySort(cents: string): string {
  const n = BigInt(cents);
  const bound = 10n ** 60n;
  return (bound + n)
    .toString()
    .padStart(61, "0")
    .replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!);
}
