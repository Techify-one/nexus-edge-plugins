import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, pluginRoot } from "./integration/harness.ts";

test(
  "d1 HTTP: entry-read does not disclose separately protected movements or receipt metadata",
  { skip: process.env.FINANCEIRO_TEST_D1 !== "1" },
  async () => {
    const db = await openDatabase("d1");
    try {
      const { app, LedgerService } = await import(
        pathToFileURL(resolve(pluginRoot, "src/index.ts")).href
      );
      const actor = {
        userId: "permissions-test",
        requestId: "permissions-test",
        permissions: [],
      };
      const ledger = new LedgerService(db, actor);
      const company = await ledger.createCompany({
        nome: "Permissões isoladas",
      });
      const account = await ledger.createAccount(company.id, {
        nome: "Banco",
        tipo: "BANCO",
        saldoInicialCentavos: "0",
        dataSaldoInicial: "2026-01-01",
      });
      const category = await ledger.createCategory(company.id, {
        nome: "Receita",
        tipo: "RECEITA",
      });
      const entry = await ledger.createEntry(company.id, {
        descricao: "Receita",
        tipo: "RECEITA",
        categoriaId: category.id,
        valorCentavos: "100",
        competencia: "2026-11-01",
        vencimento: "2026-11-08",
      });
      await ledger.settle(company.id, entry.id, {
        contaId: account.id,
        valorCentavos: "100",
        dataEfetiva: "2026-11-08",
        chaveIdempotencia: crypto.randomUUID(),
      });
      await ledger.addAttachment(company.id, entry.id, {
        nome: "privado.pdf",
        objectKey: "private-key",
        contentType: "application/pdf",
        tamanho: 100,
      });
      const read = async (permissions) => {
        const response = await app.request(
          `http://financeiro/lancamentos/${entry.id}?empresaId=${company.id}`,
          {
            headers: {
              "X-Plugin-Context": Buffer.from(
                JSON.stringify({ ...actor, permissions }),
              ).toString("base64url"),
            },
          },
          db.testBindings,
        );
        assert.equal(response.status, 200);
        return (await response.json()).data;
      };
      const restricted = await read(["financeiro.lancamentos.read"]);
      assert.deepEqual(restricted.movimentos, []);
      assert.deepEqual(restricted.anexos, []);
      const full = await read([
        "financeiro.lancamentos.read",
        "financeiro.movimentos.read",
        "financeiro.anexos.read",
      ]);
      assert.equal(full.movimentos.length, 1);
      assert.equal(full.anexos.length, 1);
      assert.equal(full.anexos[0].objectKey, undefined);
    } finally {
      await db.close();
    }
  },
);
