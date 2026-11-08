import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  engines,
  openDatabase,
  pluginRoot,
  counts,
} from "./integration/harness.ts";

for (const engine of engines) {
  test(`${engine}: Telegram revalidates host authorization and sends only once to an explicitly configured chat`, async () => {
    const db = await openDatabase(engine);
    const originalFetch = globalThis.fetch;
    try {
      const boolean = engine === "postgres" ? "BOOLEAN" : "INTEGER";
      await db.atomic([
        {
          sql: `CREATE TABLE "user" (id TEXT PRIMARY KEY,active ${boolean} NOT NULL)`,
        },
        {
          sql: `CREATE TABLE groups (id TEXT PRIMARY KEY,is_admin ${boolean} NOT NULL)`,
        },
        {
          sql: "CREATE TABLE permissions (id TEXT PRIMARY KEY,key TEXT NOT NULL)",
        },
        {
          sql: "CREATE TABLE group_members (group_id TEXT NOT NULL,user_id TEXT NOT NULL)",
        },
        {
          sql: "CREATE TABLE group_permissions (group_id TEXT NOT NULL,permission_id TEXT NOT NULL)",
        },
        {
          sql: 'INSERT INTO "user" (id,active) VALUES (?,?)',
          params: ["notice-user", engine === "postgres" ? true : 1],
        },
        {
          sql: "INSERT INTO groups (id,is_admin) VALUES (?,?)",
          params: ["notice-group", engine === "postgres" ? false : 0],
        },
        {
          sql: "INSERT INTO permissions (id,key) VALUES (?,?)",
          params: ["notice-permission", "financeiro.avisos.manage"],
        },
        {
          sql: "INSERT INTO group_members (group_id,user_id) VALUES (?,?)",
          params: ["notice-group", "notice-user"],
        },
        {
          sql: "INSERT INTO group_permissions (group_id,permission_id) VALUES (?,?)",
          params: ["notice-group", "notice-permission"],
        },
      ]);
      const { LedgerService } = await import(
        pathToFileURL(resolve(pluginRoot, "src/modules/ledger.ts")).href
      );
      const { sendNotices } = await import(
        pathToFileURL(resolve(pluginRoot, "src/modules/integrations.ts")).href
      );
      const { today } = await import(
        pathToFileURL(resolve(pluginRoot, "src/domain/dates.ts")).href
      );
      const actor = {
        userId: "notice-user",
        requestId: "notice-test",
        permissions: [],
      };
      const ledger = new LedgerService(db, actor);
      const company = await ledger.createCompany({ nome: "Avisos isolados" });
      const category = await ledger.createCategory(company.id, {
        nome: "Serviços",
        tipo: "DESPESA",
      });
      await ledger.createEntry(company.id, {
        tipo: "DESPESA",
        descricao: "Pendente",
        valorCentavos: "100",
        categoriaId: category.id,
        competencia: today(),
        vencimento: today(),
      });
      await ledger.configureNotices(company.id, {
        ativo: true,
        chatId: "-123",
        diasAntecedencia: 1,
      });
      let sends = 0;
      globalThis.fetch = async (url, init) => {
        sends++;
        assert.equal(
          String(url),
          "https://api.telegram.org/botintegration-only/sendMessage",
        );
        assert.equal(JSON.parse(String(init.body)).chat_id, "-123");
        return Response.json({ ok: true });
      };
      await db.execute('UPDATE "user" SET active = ? WHERE id = ?', [
        engine === "postgres" ? false : 0,
        "notice-user",
      ]);
      const before = await counts(db);
      await assert.rejects(
        () =>
          sendNotices(
            db,
            { TELEGRAM_BOT_TOKEN: "integration-only" },
            company.id,
            actor,
          ),
        (error) => error.code === "DESTINATARIO_SEM_ACESSO",
      );
      assert.deepEqual(await counts(db), before);
      assert.equal(sends, 0);
      await db.execute('UPDATE "user" SET active = ? WHERE id = ?', [
        engine === "postgres" ? true : 1,
        "notice-user",
      ]);
      const first = await sendNotices(
        db,
        { TELEGRAM_BOT_TOKEN: "integration-only" },
        company.id,
        actor,
      );
      assert.equal(first.enviados, 1);
      const second = await sendNotices(
        db,
        { TELEGRAM_BOT_TOKEN: "integration-only" },
        company.id,
        actor,
      );
      assert.equal(second.duplicados, 1);
      assert.equal(sends, 1);
    } finally {
      globalThis.fetch = originalFetch;
      await db.close();
    }
  });
}
