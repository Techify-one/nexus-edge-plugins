const CIVIL = /^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const MONTH = /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/;
const BUSINESS_ZONE = "America/Sao_Paulo";

/** Financial dates are civil dates, represented internally at midnight UTC. */
export function civil(value: string): string {
  if (typeof value !== "string" || value.length !== 10 || !CIVIL.test(value)) {
    throw new Error(
      "Data inválida: use AAAA-MM-DD, entre os anos 1000 e 9999.",
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Data inexistente: "${value}".`);
  }
  return value;
}

export function month(value: string): string {
  if (typeof value !== "string" || value.length !== 7 || !MONTH.test(value)) {
    throw new Error("Mês inválido: use AAAA-MM, entre os anos 1000 e 9999.");
  }
  return value;
}

export function today(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  return civil(`${part("year")}-${part("month")}-${part("day")}`);
}

export function addDays(iso: string, days: number): string {
  civil(iso);
  if (!Number.isSafeInteger(days))
    throw new Error("Quantidade de dias deve ser um inteiro seguro.");
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return civil(date.toISOString().slice(0, 10));
}

/** Accepts an exact month or an existing civil date, not arbitrary date prefixes. */
export function monthEnd(value: string): string {
  if (typeof value !== "string") throw new Error("Mês ou data inválida.");
  const selected = value.length === 7 ? month(value) : civil(value).slice(0, 7);
  const [year, monthNumber] = selected.split("-").map(Number);
  const last = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return `${selected}-${String(last).padStart(2, "0")}`;
}
