import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsaasApiError,
  createPixTransfer,
  getBalance,
  getPersonalAccount,
  inspectPixKey,
  maskPixKey,
  normalizePixKey,
  parseValueCents,
  validateStatementRange,
} from "../src/asaas-client.js";

const apiKey = `$aact_prod_${"a".repeat(60)}`;
const env = {
  DATABASE_PROVIDER: "d1" as const,
  ASAAS_API_KEY: apiKey,
};

afterEach(() => vi.unstubAllGlobals());

describe("Asaas plugin", () => {
  it("declares the production API key as a Worker secret", () => {
    const source = readFileSync("asaas/manifest.json", "utf8");
    const manifest = JSON.parse(source) as {
      id: string;
      tablePrefix: string;
      secrets: Array<Record<string, unknown>>;
      permissions: string[];
    };
    expect(manifest.id).toBe("asaas");
    expect(manifest.tablePrefix).toBe("asaas_");
    expect(manifest.secrets).toContainEqual({
      name: "ASAAS_API_KEY",
      label: "Asaas production API key",
      required: false,
      permission: "asaas.settings.update",
    });
    expect(manifest.permissions).toContain("asaas.pix.create");
    expect(source).not.toContain("$aact_prod_000");
  });

  it("authenticates balance reads with access_token and an identifying user agent", async () => {
    let requestedUrl = "";
    let headers = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        headers = new Headers(init?.headers);
        return Response.json({ balance: 123.45 });
      }),
    );
    await expect(getBalance(env)).resolves.toEqual({ balance: 123.45 });
    expect(requestedUrl).toBe("https://api.asaas.com/v3/finance/balance");
    expect(requestedUrl).not.toContain(apiKey);
    expect(headers.get("access_token")).toBe(apiKey);
    expect(headers.get("User-Agent")).toContain("Nexus-Asaas-Plugin");
  });

  it("normalizes and masks every supported Pix key type", () => {
    expect(normalizePixKey("CPF", "529.982.247-25")).toBe("52998224725");
    expect(normalizePixKey("CNPJ", "04.252.011/0001-10")).toBe(
      "04252011000110",
    );
    expect(normalizePixKey("EMAIL", " Pessoa@Example.COM ")).toBe(
      "pessoa@example.com",
    );
    expect(normalizePixKey("PHONE", "(48) 99999-9999")).toBe("48999999999");
    const evp = "123e4567-e89b-42d3-a456-426614174000";
    expect(normalizePixKey("EVP", evp)).toBe(evp);
    expect(maskPixKey("CPF", "52998224725")).toBe("***.***.***-25");
    expect(maskPixKey("EMAIL", "pessoa@example.com")).toBe("pe***@example.com");
  });

  it("accepts only a personal Asaas account during credential setup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ personType: "FISICA" })),
    );
    await expect(getPersonalAccount(env)).resolves.toEqual({
      personType: "FISICA",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ personType: "JURIDICA" })),
    );
    await expect(getPersonalAccount(env)).rejects.toMatchObject({
      code: "ASAAS_PERSONAL_ACCOUNT_REQUIRED",
    });
  });

  it("resolves and masks the Pix recipient before money moves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          financialInstitution: { name: "Banco de Teste" },
          owner: { name: "Pessoa Destinatária", cpfCnpj: "52998224725" },
        }),
      ),
    );
    await expect(
      inspectPixKey(env, "EMAIL", "Pessoa@Example.com"),
    ).resolves.toEqual({
      ownerName: "Pessoa Destinatária",
      ownerDocument: "***.***.***-25",
      institutionName: "Banco de Teste",
      pixKeyType: "EMAIL",
      pixKeyMasked: "pe***@example.com",
    });
  });

  it("rejects invalid Pix keys and values", () => {
    expect(() => normalizePixKey("CPF", "111.111.111-11")).toThrow(
      AsaasApiError,
    );
    expect(() => normalizePixKey("PHONE", "489999999")).toThrow("11 digits");
    expect(parseValueCents("10,25")).toBe(1025);
    expect(parseValueCents(10.2)).toBe(1020);
    expect(() => parseValueCents("0")).toThrow("greater than zero");
  });

  it("submits the documented Asaas Pix payload without leaking the key in the URL", async () => {
    let requestedUrl = "";
    let submitted: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          id: "transfer_12345678",
          status: "PENDING",
          value: 25.5,
          externalReference: "nexus-apx-test",
        });
      }),
    );
    const transfer = await createPixTransfer(env, {
      valueCents: 2550,
      pixAddressKey: "pessoa@example.com",
      pixAddressKeyType: "EMAIL",
      description: "Teste",
      externalReference: "nexus-apx-test",
    });
    expect(requestedUrl).toBe("https://api.asaas.com/v3/transfers");
    expect(requestedUrl).not.toContain("pessoa@example.com");
    expect(submitted).toEqual({
      value: 25.5,
      pixAddressKey: "pessoa@example.com",
      pixAddressKeyType: "EMAIL",
      description: "Teste",
      externalReference: "nexus-apx-test",
    });
    expect(transfer).toMatchObject({
      id: "transfer_12345678",
      status: "PENDING",
    });
  });

  it("maps invalid upstream credentials to a plugin error without returning HTTP 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            errors: [
              { code: "invalid_access_token", description: "Invalid key" },
            ],
          },
          { status: 401 },
        ),
      ),
    );
    await expect(getBalance(env)).rejects.toMatchObject({
      code: "ASAAS_API_KEY_INVALID",
      status: 422,
    });
  });

  it("bounds statement queries to 366 days", () => {
    expect(() =>
      validateStatementRange("2026-01-01", "2026-12-31"),
    ).not.toThrow();
    expect(() => validateStatementRange("2026-12-31", "2026-01-01")).toThrow(
      "invalid",
    );
    expect(() => validateStatementRange("2024-01-01", "2026-01-02")).toThrow(
      "366",
    );
  });

  it("uses the canonical configurable tables and the protected Core secret flow", () => {
    const statement = readFileSync(
      "asaas/frontend/AsaasStatementPage.tsx",
      "utf8",
    );
    const pix = readFileSync("asaas/frontend/AsaasPixPage.tsx", "utf8");
    const settings = readFileSync(
      "asaas/frontend/AsaasSettingsPage.tsx",
      "utf8",
    );
    expect(statement).toContain('tableId="plugin.asaas.statement"');
    expect(pix).toContain('tableId="plugin.asaas.pix_transfers"');
    expect(pix).toContain("window.confirm");
    expect(settings).toContain("runtime-secrets/ASAAS_API_KEY");
    expect(settings).toContain("recentReauthHeaders");
    expect(settings).toContain('method: "PUT"');
    expect(settings).toContain('method: "DELETE"');
  });
});
