import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, pluginRoot } from "./integration/harness.ts";

test(
  "d1 HTTP: recurrence search filters before pagination, matches accents and preserves complete totals",
  { skip: process.env.FINANCEIRO_TEST_D1 !== "1" },
  async () => {
    const db = await openDatabase("d1");
    try {
      const { app, LedgerService } = await import(
        pathToFileURL(resolve(pluginRoot, "src/index.ts")).href
      );
      const actor = {
        userId: "search-test",
        requestId: "search-test",
        permissions: ["financeiro.recorrencias.read"],
      };
      const ledger = new LedgerService(db, actor);
      const company = await ledger.createCompany({ nome: "Search isolated" });
      const category = await ledger.createCategory(company.id, {
        nome: "Services",
        tipo: "DESPESA",
      });
      const common = {
        tipo: "DESPESA",
        valorCentavos: "100",
        categoriaId: category.id,
        ancora: "2028-01-01",
        inicio: "2028-01-01",
        regra: { frequencia: "MES", intervalo: 1, ajuste_fds: "MANTER" },
      };
      await ledger.createRecurrence(company.id, {
        ...common,
        descricao: "Natação infantil",
        contraparte: "Clube Azul",
      });
      await ledger.createRecurrence(company.id, {
        ...common,
        descricao: "Academia",
      });
      const get = async (search) => {
        const response = await app.request(
          `http://financeiro/recorrencias?empresaId=${company.id}&limit=1&busca=${encodeURIComponent(search)}`,
          {
            headers: {
              "X-Plugin-Context": Buffer.from(JSON.stringify(actor)).toString(
                "base64url",
              ),
            },
          },
          db.testBindings,
        );
        assert.equal(response.status, 200);
        return response.json();
      };
      assert.equal((await get("natacao")).total, 1);
      assert.equal((await get("AZUL")).data[0].descricao, "Natação infantil");
      assert.equal((await get("missing")).total, 0);
      assert.equal(
        (await ledger.recurrenceSummary(company.id, "2028-01"))
          .despesasCadastradasCentavos,
        "200",
      );
    } finally {
      await db.close();
    }
  },
);
