import { civil } from "./dates.js";

export type Status = "ABERTO" | "PARCIAL" | "LIQUIDADO" | "CANCELADO";

/** Overdue is a separate date filter, never a persisted settlement status. */
export function status(
  total: bigint,
  paid: bigint,
  cancelled: boolean,
  today?: string,
  due?: string,
): Status {
  if (today !== undefined) civil(today);
  if (due !== undefined) civil(due);
  if (cancelled) return "CANCELADO";
  if (paid >= total) return "LIQUIDADO";
  return paid > 0n ? "PARCIAL" : "ABERTO";
}
