import assert from "node:assert/strict";
import { test } from "node:test";
import { engines, openDatabase, loadBackend } from "./integration/harness.ts";

for (const engine of engines) {
  test(`${engine}: scoped financial reads skip unrelated tables and preserve results`, async () => {
    const db = await openDatabase(engine);
    try {
      const { LedgerService } = await loadBackend();
      const service = new LedgerService(db, {
        userId: "scoped-test",
        requestId: "scoped-test",
        permissions: [],
      });
      const company = await service.createCompany({ nome: "Scoped reads" });
      const other = await service.createCompany({ nome: "Other company" });
      await service.createCategory(other.id, {
        nome: "Hidden",
        tipo: "DESPESA",
      });
      const category = await service.createCategory(company.id, {
        nome: "Rent",
        tipo: "DESPESA",
      });
      await service.createRecurrence(company.id, {
        descricao: "Rent",
        tipo: "DESPESA",
        valorCentavos: "10000",
        categoriaId: category.id,
        ancora: "2028-01-10",
        inicio: "2028-01-10",
        regra: { frequencia: "MES", intervalo: 1, ajuste_fds: "MANTER" },
      });
      const statements: string[] = [];
      const query = db.query.bind(db);
      const first = db.first.bind(db);
      db.query = async (sql, params) => {
        statements.push(sql);
        return query(sql, params);
      };
      db.first = async (sql, params) => {
        const result = await first(sql, params);
        if (engine !== "sqlite") statements.push(sql);
        return result;
      };
      const categories = await service.list(company.id, "categorias");
      assert.equal(categories.length, 1);
      assert.equal(categories[0].id, category.id);
      assert.equal(statements.length, 3);
      assert.equal(
        statements.filter((s) => s.includes("SELECT payload")).length,
        1,
      );
      statements.length = 0;
      const totals = await service.recurrenceSummary(company.id, "2028-01");
      assert.equal(totals.mediaMensalDespesasCentavos, "10000");
      assert.equal(totals.despesasCentavos, "10000");
      assert.equal(statements.length, 4);
      assert.ok(
        !statements.some((s) =>
          /financeiro_(movimentos|anexos|idempotencia)/.test(s),
        ),
      );
      statements.length = 0;
      const entries = await service.list(company.id, "lancamentos");
      assert.equal(entries[0].pendenteCentavos, "10000");
      assert.equal(statements.length, 4);
      assert.ok(statements.some((s) => s.includes("financeiro_movimentos")));
      statements.length = 0;
      const detail = await service.getEntry(company.id, entries[0].id);
      assert.equal(detail.pendenteCentavos, "10000");
      assert.equal(statements.length, 5);
      assert.deepEqual(detail.movimentos, []);
      assert.deepEqual(detail.anexos, []);
    } finally {
      await db.close();
    }
  });

  test(`${engine}: scoped reads retry when revision changes during a read`, async () => {
    const db = await openDatabase(engine);
    try {
      const { LedgerService } = await loadBackend();
      const service = new LedgerService(db, {
        userId: "scoped-test",
        requestId: "scoped-test",
        permissions: [],
      });
      const company = await service.createCompany({ nome: "Revision reads" });
      await service.createCategory(company.id, {
        nome: "Before",
        tipo: "DESPESA",
      });
      const query = db.query.bind(db);
      let reads = 0;
      db.query = async (sql, params) => {
        const result = await query(sql, params);
        if (sql.includes("SELECT payload FROM financeiro_categorias")) {
          reads++;
          if (reads === 1) {
            await db.execute(
              "UPDATE financeiro_empresas SET revision = revision + 1 WHERE id = ?",
              [company.id],
            );
          }
        }
        return result;
      };
      const rows = await service.list(company.id, "categorias");
      assert.equal(rows.length, 1);
      assert.equal(reads, 2);
    } finally {
      await db.close();
    }
  });
}
