import { describe, it, expect } from "vitest";
import { app } from "../src/index.js";
const header = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
describe("financeiro gateway context", () => {
  it("rejects absent, malformed and public context before database access", async () => {
    for (const headers of [
      {},
      { "X-Plugin-Context": "!!" },
      {
        "X-Plugin-Public-Context": header({
          pluginId: "financeiro",
          requestId: "r",
        }),
      },
      {
        "X-Plugin-Context": header({
          userId: 12,
          permissions: [],
          requestId: "r",
        }),
      },
      {
        "X-Plugin-Context": header({
          userId: "u",
          permissions: [42],
          requestId: "r",
        }),
      },
    ]) {
      const response = await app.request(
        "/empresas",
        { headers: headers as HeadersInit },
        { DATABASE_PROVIDER: "d1" },
      );
      expect(response.status).toBe(401);
    }
  });
  it("rejects dual contexts and Installer use on business endpoints", async () => {
    const user = header({
        userId: "u",
        permissions: ["financeiro.empresas.read"],
        requestId: "r",
      }),
      installer = header({
        pluginId: "financeiro",
        operationId: "op",
        requestId: "r",
      });
    expect(
      (
        await app.request(
          "/empresas",
          {
            headers: {
              "X-Plugin-Context": user,
              "X-Plugin-Installer-Context": installer,
            },
          },
          { DATABASE_PROVIDER: "d1" },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          "/empresas",
          { headers: { "X-Plugin-Installer-Context": installer } },
          { DATABASE_PROVIDER: "d1" },
        )
      ).status,
    ).toBe(401);
  });
  it("enforces specific operation permission with valid database binding", async () => {
    const env = { DATABASE_PROVIDER: "d1", DB: {} as D1Database };
    const response = await app.request(
      "/empresas",
      {
        headers: {
          "X-Plugin-Context": header({
            userId: "u",
            permissions: ["financeiro.lancamentos.read"],
            requestId: "r",
          }),
        },
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("FORBIDDEN");
  });
});
