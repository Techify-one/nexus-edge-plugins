import { describe, expect, it } from "vitest";
import { money, amount, sum, monthlyAverage } from "../src/domain/money";
import { civil, month, today, addDays, monthEnd } from "../src/domain/dates";
import { status } from "../src/domain/status";
import {
  ajustarFimDeSemana,
  descreverRegra,
  diaDaSemana,
  enesimoDiaDaSemana,
  nominal,
  proximas,
  RegraInvalida,
  somarDias,
  ultimoDia,
  validarRegra,
  type Regra,
} from "../src/domain/recurrence";

const mensal = (extra: Partial<Regra> = {}): Regra => ({
  frequencia: "MES",
  intervalo: 1,
  ajuste_fds: "MANTER",
  ...extra,
});
const datas = (regra: Regra, ancora: string, de: string, ate: string) =>
  proximas(regra, ancora, { inicio: ancora, de, ate }).map(
    (value) => value.dataNominal,
  );

describe("canonical integer cents", () => {
  it("parses exact strings and serializes signed bounded amounts", () => {
    expect(money("0")).toBe(0n);
    expect(money("5000000")).toBe(5000000n);
    expect(money("999999999999999")).toBe(999999999999999n);
    expect(money("-999999999999999", true)).toBe(-999999999999999n);
    expect(money("0", true)).toBe(0n);
    for (const value of [
      0n,
      5n,
      -25000n,
      999999999999999n,
      -999999999999999n,
    ]) {
      expect(money(amount(value), true)).toBe(value);
    }
  });

  it.each([
    0,
    123,
    1n,
    null,
    undefined,
    {},
    [],
    "",
    "00",
    "01",
    "-0",
    "+1",
    " 1",
    "1 ",
    "1\n",
    "1\r\n",
    "1.00",
    "1e3",
    "1,00",
    "１００",
    "1000000000000000",
  ])("rejects noncanonical input %#", (value) => {
    expect(() => money(value)).toThrow();
    expect(() => money(value, true)).toThrow();
  });

  it("requires opt-in for negatives and checks output limits", () => {
    expect(() => money("-1")).toThrow();
    expect(money("-1", true)).toBe(-1n);
    expect(() => amount(1000000000000000n)).toThrow();
    expect(() => amount(-1000000000000000n)).toThrow();
    expect(() => amount(1 as never)).toThrow();
  });

  it("sums arbitrary iterables exactly, including aggregates above the input limit", () => {
    expect(sum([])).toBe(0n);
    expect(sum(new Set([1n, 2n, -3n]))).toBe(0n);
    function* values() {
      yield 999999999999999n;
      yield 999999999999999n;
    }
    expect(sum(values())).toBe(1999999999999998n);
  });
});

describe("civil dates", () => {
  it.each([
    "1000-01-01",
    "2000-02-29",
    "2026-10-31",
    "2028-02-29",
    "9999-12-31",
  ])("accepts existing date %s", (value) => {
    expect(civil(value)).toBe(value);
  });

  it.each([
    "0999-12-31",
    "0000-01-01",
    "10000-01-01",
    "1900-02-29",
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-00-10",
    "2026-13-10",
    "2026-10-00",
    "2026-1-01",
    "31/10/2026",
    "2026-10-31T00:00:00Z",
    "2026-10-31\n",
    "",
  ])("rejects malformed or nonexistent date %s", (value) => {
    expect(() => civil(value)).toThrow();
  });

  it("validates exact months and both supported month-end inputs", () => {
    expect(month("1000-01")).toBe("1000-01");
    expect(month("9999-12")).toBe("9999-12");
    for (const value of [
      "0999-12",
      "2026-00",
      "2026-13",
      "2026-1",
      "2026-10-01",
      "2026-10\n",
    ]) {
      expect(() => month(value)).toThrow();
    }
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("9999-12")).toBe("9999-12-31");
    expect(() => monthEnd("2026-02-30")).toThrow();
    expect(() => monthEnd("2026-02-extra")).toThrow();
  });

  it("adds UTC calendar days across months, years and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-31", 0)).toBe("2026-10-31");
    expect(() => addDays("2026-10-31", 0.5)).toThrow();
    expect(() => addDays("2026-10-31", Infinity)).toThrow();
    expect(() => addDays("9999-12-31", 1)).toThrow();
    expect(() => addDays("1000-01-01", -1)).toThrow();
  });

  it("uses Sao Paulo rather than UTC for the business day", () => {
    expect(today(new Date("2026-11-01T01:30:00Z"))).toBe("2026-10-31");
    expect(today(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11-01");
    expect(() => today(new Date(NaN))).toThrow();
  });
});

describe("derived settlement status", () => {
  it("derives open, partial and liquidated including overpayment", () => {
    expect(status(10000n, 0n, false)).toBe("ABERTO");
    expect(status(10000n, 4000n, false)).toBe("PARCIAL");
    expect(status(10000n, 10000n, false)).toBe("LIQUIDADO");
    expect(status(10000n, 11000n, false)).toBe("LIQUIDADO");
    expect(status(0n, 0n, false)).toBe("LIQUIDADO");
    expect(status(10000n, -100n, false)).toBe("ABERTO");
  });

  it("cancellation takes precedence and overdue does not create a new status", () => {
    expect(status(10000n, 10000n, true)).toBe("CANCELADO");
    expect(status(10000n, 0n, true)).toBe("CANCELADO");
    expect(status(10000n, 0n, false, "2026-10-11", "2026-10-10")).toBe(
      "ABERTO",
    );
    expect(status(10000n, 4000n, false, "2026-10-10", "2026-10-10")).toBe(
      "PARCIAL",
    );
    expect(() => status(10000n, 0n, false, "2026-02-30")).toThrow();
  });
});

describe("recurrence calendar", () => {
  it("calculates from the anchor without month-end drift", () => {
    expect(datas(mensal(), "2026-01-31", "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(nominal(mensal(), "2026-01-31", 2)).toBe("2026-03-31");
    expect(
      datas(mensal({ dia_mes: 30 }), "2028-01-30", "2028-02-01", "2028-02-29"),
    ).toEqual(["2028-02-29"]);
    expect(ultimoDia(2028, 2)).toBe(29);
  });

  it("handles annual leap-day rules, semiannual intervals and year changes", () => {
    expect(
      datas(
        mensal({ intervalo: 12 }),
        "2024-02-29",
        "2024-01-01",
        "2028-12-31",
      ),
    ).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
    expect(
      datas(mensal({ intervalo: 6 }), "2026-03-15", "2026-01-01", "2027-12-31"),
    ).toEqual(["2026-03-15", "2026-09-15", "2027-03-15", "2027-09-15"]);
    expect(datas(mensal(), "2026-11-10", "2026-11-01", "2027-02-28")).toEqual([
      "2026-11-10",
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
    ]);
  });

  it("supports first, last and missing fifth weekdays", () => {
    expect(
      datas(
        mensal({ semana_do_mes: 1, dia_semana: 1 }),
        "2026-01-05",
        "2026-01-01",
        "2026-04-30",
      ),
    ).toEqual(["2026-01-05", "2026-02-02", "2026-03-02", "2026-04-06"]);
    expect(
      datas(
        mensal({ semana_do_mes: 5, dia_semana: 1 }),
        "2026-03-30",
        "2026-03-01",
        "2026-06-30",
      ),
    ).toEqual(["2026-03-30", "2026-06-29"]);
    expect(enesimoDiaDaSemana(2026, 4, 5, 1)).toBeNull();
    expect(
      datas(
        mensal({ semana_do_mes: -1, dia_semana: 5 }),
        "2026-01-30",
        "2026-01-01",
        "2026-03-31",
      ),
    ).toEqual(["2026-01-30", "2026-02-27", "2026-03-27"]);
  });

  it("adjusts only the due date across month boundaries", () => {
    for (const value of ["2026-10-31", "2026-11-01"]) {
      expect(ajustarFimDeSemana(value, "ANTECIPAR")).toBe("2026-10-30");
      expect(ajustarFimDeSemana(value, "ADIAR")).toBe("2026-11-02");
      expect(ajustarFimDeSemana(value, "MANTER")).toBe(value);
    }
    expect(ajustarFimDeSemana("2026-10-28", "ADIAR")).toBe("2026-10-28");
    expect(
      proximas(mensal({ ajuste_fds: "ADIAR" }), "2026-10-31", {
        inicio: "2026-10-31",
        de: "2026-10-01",
        ate: "2026-10-31",
      }),
    ).toEqual([
      {
        chave: "2026-10-31",
        dataNominal: "2026-10-31",
        vencimento: "2026-11-02",
        indice: 0,
      },
    ]);
    expect(diaDaSemana("2026-10-31")).toBe(6);
    expect(somarDias("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("supports daily and weekly intervals", () => {
    expect(
      datas(
        { frequencia: "DIA", intervalo: 15, ajuste_fds: "MANTER" },
        "2026-01-01",
        "2026-01-01",
        "2026-02-20",
      ),
    ).toEqual(["2026-01-01", "2026-01-16", "2026-01-31", "2026-02-15"]);
    expect(
      datas(
        { frequencia: "SEMANA", intervalo: 2, ajuste_fds: "MANTER" },
        "2026-10-05",
        "2026-10-01",
        "2026-11-30",
      ),
    ).toEqual([
      "2026-10-05",
      "2026-10-19",
      "2026-11-02",
      "2026-11-16",
      "2026-11-30",
    ]);
  });

  it("honors start, end, inclusive range and result limits", () => {
    expect(
      proximas(mensal(), "2026-01-10", {
        inicio: "2026-02-01",
        fim: "2026-03-10",
        de: "2026-01-01",
        ate: "2027-12-31",
      }).map((o) => o.chave),
    ).toEqual(["2026-02-10", "2026-03-10"]);
    expect(
      proximas(mensal(), "2026-01-10", {
        inicio: "2026-01-10",
        de: "2026-01-01",
        ate: "2030-12-31",
        limite: 12,
      }),
    ).toHaveLength(12);
    expect(
      proximas(mensal(), "2026-01-10", {
        inicio: "2026-01-10",
        de: "2026-01-01",
        ate: "2030-12-31",
        limite: 0,
      }),
    ).toEqual([]);
    expect(datas(mensal(), "2026-01-10", "2026-03-01", "2026-02-01")).toEqual(
      [],
    );
  });

  it("does not skip modern occurrences when a monthly anchor is decades old", () => {
    expect(
      proximas(mensal(), "2000-01-31", {
        inicio: "2000-01-31",
        de: "2026-10-01",
        ate: "2026-12-29",
      }),
    ).toEqual([
      {
        chave: "2026-10-31",
        dataNominal: "2026-10-31",
        vencimento: "2026-10-31",
        indice: 321,
      },
      {
        chave: "2026-11-30",
        dataNominal: "2026-11-30",
        vencimento: "2026-11-30",
        indice: 322,
      },
    ]);
    expect(
      datas(
        mensal({ intervalo: 12 }),
        "1980-02-29",
        "2028-02-01",
        "2028-03-01",
      ),
    ).toEqual(["2028-02-29"]);
  });

  it("keeps window slices identical for old anchors and every interval family", () => {
    const rules: Regra[] = [
      mensal(),
      mensal({ intervalo: 3, dia_mes: 31 }),
      mensal({ intervalo: 12 }),
      mensal({ semana_do_mes: 5, dia_semana: 1 }),
      { frequencia: "DIA", intervalo: 15, ajuste_fds: "ADIAR" },
      { frequencia: "SEMANA", intervalo: 2, ajuste_fds: "ANTECIPAR" },
    ];
    for (const regra of rules) {
      const all = proximas(regra, "2000-01-31", {
        inicio: "2000-01-31",
        de: "2026-01-01",
        ate: "2027-12-31",
      });
      for (const de of [
        "2026-01-20",
        "2026-04-01",
        "2026-12-31",
        "2027-07-15",
      ]) {
        expect(
          proximas(regra, "2000-01-31", {
            inicio: "2000-01-31",
            de,
            ate: "2027-12-31",
          }),
        ).toEqual(all.filter((o) => o.dataNominal >= de));
      }
      expect(new Set(all.map((o) => o.chave)).size).toBe(all.length);
      expect(all.map((o) => o.chave)).toEqual(all.map((o) => o.chave).sort());
      for (const o of all) {
        if (regra.ajuste_fds !== "MANTER")
          expect([0, 6]).not.toContain(diaDaSemana(o.vencimento));
        expect(
          Math.abs(Date.parse(o.vencimento) - Date.parse(o.dataNominal)) /
            86400000,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it("terminates at the highest supported year, including skipped weekdays", () => {
    expect(datas(mensal(), "9999-12-31", "9999-12-01", "9999-12-31")).toEqual([
      "9999-12-31",
    ]);
    expect(
      datas(
        mensal({ semana_do_mes: 5, dia_semana: 1 }),
        "9999-12-01",
        "9999-12-01",
        "9999-12-31",
      ),
    ).toEqual([]);
  });

  it("validates every date and rejects invalid rules and indices", () => {
    const invalid: Regra[] = [
      mensal({ intervalo: 0 }),
      mensal({ intervalo: 367 }),
      mensal({ dia_mes: 32 }),
      mensal({ semana_do_mes: 6, dia_semana: 1 }),
      mensal({ semana_do_mes: 1 }),
      mensal({ dia_mes: 1, semana_do_mes: 1, dia_semana: 1 }),
      mensal({ dia_semana: 1 }),
      { frequencia: "DIA", intervalo: 1, dia_mes: 3, ajuste_fds: "MANTER" },
    ];
    for (const regra of invalid)
      expect(() => validarRegra(regra)).toThrow(RegraInvalida);
    for (const key of ["inicio", "de", "ate", "fim"]) {
      expect(() =>
        proximas(mensal(), "2026-01-01", {
          inicio: "2026-01-01",
          de: "2026-01-01",
          ate: "2026-03-01",
          [key]: "2026-02-30",
        }),
      ).toThrow();
    }
    expect(() => nominal(mensal(), "2026-02-30", 0)).toThrow();
    expect(() => nominal(mensal(), "2026-01-01", -1)).toThrow();
    expect(() => ajustarFimDeSemana("2026-02-30", "MANTER")).toThrow();
    expect(() =>
      proximas(mensal(), "2026-01-01", {
        inicio: "2026-01-01",
        de: "2026-01-01",
        ate: "2026-03-01",
        limite: -1,
      }),
    ).toThrow();
  });

  it("preserves Portuguese descriptions", () => {
    expect(descreverRegra(mensal({ dia_mes: 10, ajuste_fds: "ADIAR" }))).toBe(
      "todo mês, no dia 10 (fim de semana adia para segunda)",
    );
    expect(descreverRegra(mensal({ semana_do_mes: 1, dia_semana: 1 }))).toBe(
      "todo mês, na primeira segunda-feira",
    );
    expect(descreverRegra(mensal({ intervalo: 12 }))).toBe(
      "todo ano, no dia da data âncora",
    );
    expect(descreverRegra(mensal({ semana_do_mes: -1, dia_semana: 0 }))).toBe(
      "todo mês, no último domingo",
    );
  });
});

describe("explicit yearly recurrence", () => {
  it("keeps the annual anchor across leap years and skips no February obligation", () => {
    const yearly: Regra = {
      frequencia: "ANO",
      intervalo: 1,
      ajuste_fds: "MANTER",
    };
    expect(nominal(yearly, "2024-02-29", 1)).toBe("2025-02-28");
    expect(nominal(yearly, "2024-02-29", 4)).toBe("2028-02-29");
    expect(datas(yearly, "2024-02-29", "2026-01-01", "2026-12-31")).toEqual([
      "2026-02-28",
    ]);
    expect(descreverRegra(yearly)).toBe("todo ano");
  });
});

describe("monthly recurring average", () => {
  it("normalizes monthly, weekly and yearly values and intervals", () => {
    expect(
      monthlyAverage([
        { cents: 10000n, frequency: "SEMANA", interval: 1 },
        { cents: 20000n, frequency: "MES", interval: 1 },
        { cents: 120000n, frequency: "ANO", interval: 1 },
      ]),
    ).toBe("70000");
    expect(
      monthlyAverage([{ cents: 10000n, frequency: "SEMANA", interval: 2 }]),
    ).toBe("20000");
    expect(
      monthlyAverage([{ cents: 120000n, frequency: "MES", interval: 12 }]),
    ).toBe("10000");
    expect(
      monthlyAverage([{ cents: 120000n, frequency: "ANO", interval: 2 }]),
    ).toBe("5000");
  });
  it("rounds only once after summing exact fractional cents", () => {
    expect(
      monthlyAverage(
        Array.from({ length: 12 }, () => ({
          cents: 1n,
          frequency: "ANO",
          interval: 1,
        })),
      ),
    ).toBe("1");
    expect(monthlyAverage([{ cents: 6n, frequency: "ANO", interval: 1 }])).toBe(
      "1",
    );
    expect(
      monthlyAverage([
        { cents: 999999999999999n, frequency: "ANO", interval: 1 },
      ]),
    ).toBe("83333333333333");
    expect(monthlyAverage([])).toBe("0");
  });
});
