import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { openDatabase, pluginRoot, counts } from "./integration/harness.ts";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const user = (permissions: string[]) => ({
  "X-Plugin-Context": encode({
    userId: "restricted-user",
    requestId: "route-integration",
    permissions,
  }),
});

test(
  "d1 HTTP: malformed/missing/mixed contexts and forged installer cannot access data",
  { skip: process.env.FINANCEIRO_TEST_D1 !== "1" },
  async () => {
    const db = await openDatabase("d1");
    try {
      const { app } = await import(
        pathToFileURL(resolve(pluginRoot, "src/index.ts")).href
      );
      const env = (db as any).testBindings;
      const contexts = [
        {},
        { "X-Plugin-Context": "not-base64-json" },
        {
          "X-Plugin-Public-Context": encode({
            pluginId: "financeiro",
            requestId: "public",
          }),
        },
        {
          ...user(["financeiro.empresas.read"]),
          "X-Plugin-Installer-Context": encode({
            pluginId: "financeiro",
            operationId: "op",
            requestId: "mixed",
          }),
        },
        {
          "X-Plugin-Context": encode({
            userId: "u",
            requestId: "r",
            permissions: "financeiro.empresas.read",
          }),
        },
        {
          "X-Plugin-Installer-Context": encode({
            pluginId: "other-plugin",
            operationId: "op",
            requestId: "forged",
          }),
        },
        {
          "X-Plugin-Installer-Context": encode({
            pluginId: "financeiro",
            operationId: "op",
            requestId: "wrong-scope",
          }),
        },
      ];
      for (const headers of contexts) {
        const response = await app.request(
          "http://financeiro/empresas",
          { headers },
          env,
        );
        assert.equal(response.status, 401, JSON.stringify(headers));
        assert.equal(
          (await response.json()).error.code,
          "INVALID_PLUGIN_CONTEXT",
        );
      }
      assert.equal((await counts(db)).empresas, 0);
      const smoke = await app.request(
        "http://financeiro/__installer/smoke",
        {
          method: "POST",
          headers: {
            "X-Plugin-Installer-Context": encode({
              pluginId: "financeiro",
              operationId: "isolated-op",
              requestId: "smoke",
            }),
          },
        },
        env,
      );
      assert.equal(smoke.status, 200);
      assert.equal((await counts(db)).empresas, 0);
    } finally {
      await db.close();
    }
  },
);

test(
  "d1 HTTP: permissions are operation-specific and already-paid requires both grants",
  { skip: process.env.FINANCEIRO_TEST_D1 !== "1" },
  async () => {
    const db = await openDatabase("d1");
    try {
      const { app } = await import(
        pathToFileURL(resolve(pluginRoot, "src/index.ts")).href
      );
      const env = (db as any).testBindings;
      for (const [path, method] of [
        ["/empresas", "POST"],
        ["/auditoria?empresaId=missing", "GET"],
        ["/anexos/file?empresaId=missing", "GET"],
        ["/avisos/configuracao?empresaId=missing", "PUT"],
        ["/relatorios/csv?empresaId=missing", "GET"],
        ["/fechamentos?empresaId=missing", "POST"],
        ["/recorrencias/gerar?empresaId=missing", "POST"],
      ]) {
        const response = await app.request(
          `http://financeiro${path}`,
          {
            method,
            headers: user(["financeiro.empresas.read"]),
            ...(method === "GET" ? {} : { body: "{}" }),
          },
          env,
        );
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal((await response.json()).error.code, "FORBIDDEN");
      }
      const response = await app.request(
        "http://financeiro/lancamentos?empresaId=missing",
        {
          method: "POST",
          headers: {
            ...user(["financeiro.lancamentos.create"]),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ liquidacao: {} }),
        },
        env,
      );
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "FORBIDDEN");
      assert.equal((await counts(db)).lancamentos, 0);
      const list = await app.request(
        "http://financeiro/empresas",
        { headers: user(["financeiro.empresas.read"]) },
        env,
      );
      assert.equal(list.status, 200);
      assert.deepEqual((await list.json()).data, []);
    } finally {
      await db.close();
    }
  },
);
