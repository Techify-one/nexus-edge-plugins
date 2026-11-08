import { describe, it, expect } from "vitest";
import * as schemas from "../src/schemas.js";
describe("financeiro input schemas", () => {
  it("does not apply create defaults to partial edits", () => {
    expect(schemas.accountUpdateSchema.parse({ nome: "Renomeada" })).toEqual({
      nome: "Renomeada",
    });
    expect(schemas.categoryUpdateSchema.parse({ nome: "Categoria" })).toEqual({
      nome: "Categoria",
    });
    expect(schemas.entryUpdateSchema.parse({ descricao: "Descrição" })).toEqual(
      { descricao: "Descrição" },
    );
    expect(schemas.recurrenceUpdate.parse({ status: "PAUSADA" })).toEqual({
      status: "PAUSADA",
      escopo: "FUTURAS",
    });
  });
  it("rejects JSON numeric cents, zero settlements, impossible dates and unknown input", () => {
    for (const value of [
      0,
      123,
      1.2,
      "0",
      "-1",
      "1000000000000000",
      "01",
      "1\n",
    ])
      expect(schemas.positiveMoney.safeParse(value).success).toBe(false);
    expect(schemas.date.safeParse("2026-02-31").success).toBe(false);
    expect(schemas.monthSchema.safeParse("2026-13").success).toBe(false);
    expect(
      schemas.companySchema.safeParse({ nome: "Empresa", revision: 4 }).success,
    ).toBe(false);
  });
});
