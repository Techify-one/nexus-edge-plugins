import { describe, expect, it, vi } from "vitest";
import type { PluginHostV1 } from "@nexus/plugin-sdk";
import {
  FinanceApi,
  FinanceError,
  errorLabel,
  hasPermission,
  scoped,
} from "../frontend/api-client.js";
import {
  addDays,
  civilDate,
  formatDate,
  formatMoney,
  moneyInput,
  moneySort,
  parseMoney,
  today,
} from "../frontend/format.js";
import { financeiroFrontendMessages, labelFor } from "../frontend/i18n.js";

describe("financial frontend exact money", () => {
  it("parses decimals without floating point and rejects rounding/grouping/overflow", () => {
    expect(parseMoney("9999999999999,99", "pt-BR")).toBe("999999999999999");
    expect(parseMoney("0.01", "en")).toBe("1");
    expect(parseMoney("-0,01", "pt-BR", true)).toBe("-1");
    for (const value of [
      "1.234,56",
      "1,001",
      "1e3",
      "0",
      "-1",
      "10000000000000,00",
    ])
      expect(() => parseMoney(value, "pt-BR")).toThrow();
  });
  it("formats aggregates beyond Number safe precision exactly in both languages", () => {
    expect(formatMoney("900719925474099399", "en")).toBe(
      "R$9,007,199,254,740,993.99",
    );
    expect(formatMoney("-1", "pt-BR")).toContain("-R$");
    expect(formatMoney("-1", "en")).toBe("-R$0.01");
    expect(moneyInput("999999999999999", "pt-BR")).toBe("9999999999999,99");
    expect(
      ["100", "-1", "2", "-1000"].sort((a, b) =>
        moneySort(a).localeCompare(moneySort(b)),
      ),
    ).toEqual(["-1000", "-1", "2", "100"]);
  });
});
describe("financial civil dates", () => {
  it("keeps the same civil day in all tested timezone environments", () => {
    for (const timezone of [
      "America/Sao_Paulo",
      "Pacific/Honolulu",
      "Pacific/Kiritimati",
    ]) {
      const old = process.env.TZ;
      process.env.TZ = timezone;
      expect(today(civilDate("2026-11-01"))).toBe("2026-11-01");
      expect(formatDate("2026-11-01", "pt-BR")).toBe("01/11/2026");
      expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
      process.env.TZ = old;
    }
    expect(() => civilDate("2026-02-29")).toThrow();
    expect(() => civilDate("2026-11-01T00:00:00Z")).toThrow();
  });
});
describe("host API and permission boundary", () => {
  const host = (api: PluginHostV1["api"]) =>
    ({
      api,
      locale: "en",
      permissions: ["financeiro.lancamentos.read"],
    }) as PluginHostV1;
  it("uses host API, translated errors, exact strings and language header", async () => {
    const request = vi.fn(async () => Response.json({ data: { id: "entry" } }));
    const client = new FinanceApi(host(request));
    await client.write(scoped("/lancamentos", "company"), "POST", {
      valorCentavos: "999999999999999",
    });
    const [path, init] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe("/lancamentos?empresaId=company");
    expect(new Headers(init.headers).get("Accept-Language")).toBe("en");
    expect(init.body).toBe('{"valorCentavos":"999999999999999"}');
    expect(hasPermission(host(request), "lancamentos")).toBe(true);
    expect(hasPermission(host(request), "lancamentos", "create")).toBe(false);
    const rejected = new FinanceApi(
      host(async () =>
        Response.json(
          { error: { code: "FORBIDDEN", message: "private server detail" } },
          { status: 403 },
        ),
      ),
    );
    await expect(rejected.get("/lancamentos")).rejects.toBeInstanceOf(
      FinanceError,
    );
    expect(
      errorLabel(new FinanceError("FORBIDDEN", 403), labelFor("en")),
    ).not.toContain("private");
  });
  it("does not JSON stringify binary bodies or change their content type", async () => {
    const request = vi.fn(async () => Response.json({ data: {} }));
    const client = new FinanceApi(host(request));
    const file = new File(["%PDF-1.7"], "recibo ç.pdf", {
      type: "application/pdf",
    });
    await client.upload("/anexos?empresaId=company&lancamentoId=entry", file);
    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(file);
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/pdf",
    );
    expect(
      decodeURIComponent(new Headers(init.headers).get("X-File-Name")!),
    ).toBe(file.name);
  });
  it("provides complete paired locale catalogs without forbidden dash", () => {
    expect(Object.keys(financeiroFrontendMessages.en).sort()).toEqual(
      Object.keys(financeiroFrontendMessages["pt-BR"]).sort(),
    );
    expect(JSON.stringify(financeiroFrontendMessages)).not.toContain(
      String.fromCharCode(8212),
    );
  });
});
