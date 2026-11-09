import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, pluginRoot } from "./integration/harness.ts";

test(
  "d1 scheduled: isolated jobs round-robin companies, continue generation and remain disabled without secrets",
  { skip: process.env.FINANCEIRO_TEST_D1 !== "1" },
  async () => {
    const db = await openDatabase("d1");
    try {
      for (const file of [
        "0002_webhook_deliveries.sql",
        "0003_scheduler.sql",
      ]) {
        const sql = await readFile(
          resolve(pluginRoot, "migrations/d1", file),
          "utf8",
        );
        await db.atomic(
          sql
            .split(";")
            .map((sql) => sql.trim())
            .filter(Boolean)
            .map((sql) => ({ sql })),
        );
      }
      const { LedgerService, runScheduled } = await import(
        pathToFileURL(resolve(pluginRoot, "src/index.ts")).href
      );
      const { today } = await import(
        pathToFileURL(resolve(pluginRoot, "src/domain/dates.ts")).href
      );
      const ledger = new LedgerService(db, {
        userId: "scheduler-integration",
        requestId: "scheduler-integration",
        permissions: [],
      });
      const a = await ledger.createCompany({ nome: "Scheduler A" });
      const b = await ledger.createCompany({ nome: "Scheduler B" });
      const companies = [a, b].sort((a, b) => a.id.localeCompare(b.id));
      for (const company of companies) {
        const category = await ledger.createCategory(company.id, {
          nome: "Daily",
          tipo: "DESPESA",
        });
        await ledger.createRecurrence(company.id, {
          descricao: "Diária",
          tipo: "DESPESA",
          valorCentavos: "100",
          categoriaId: category.id,
          ancora: today(),
          inicio: today(),
          regra: { frequencia: "DIA", intervalo: 1, ajuste_fds: "MANTER" },
        });
      }
      const env = db.testBindings;
      await runScheduled(env, "generate");
      assert.equal(
        (await ledger.list(companies[0].id, "lancamentos")).length,
        20,
      );
      assert.equal(
        (await ledger.list(companies[1].id, "lancamentos")).length,
        0,
      );
      await runScheduled(env, "generate");
      assert.equal(
        (await ledger.list(companies[1].id, "lancamentos")).length,
        20,
      );
      await runScheduled(env, "generate");
      assert.equal(
        (await ledger.list(companies[0].id, "lancamentos")).length,
        40,
      );
      await runScheduled(env, "notices");
      await runScheduled(env, "webhooks");
      assert.equal(
        (
          await db.first(
            "SELECT COUNT(*) AS n FROM financeiro_webhook_deliveries",
          )
        )?.n,
        0,
      );
      assert.equal(
        (await ledger.list(companies[0].id, "movimentos")).length,
        0,
      );
    } finally {
      await db.close();
    }
  },
);

test(
  "d1 alarm scheduler: arms once, rotates real generation and stops when uninstalled",
  { skip: process.env.FINANCEIRO_TEST_D1 !== "1" },
  async () => {
    const db = await openDatabase("d1");
    try {
      for (const file of [
        "0002_webhook_deliveries.sql",
        "0003_scheduler.sql",
      ]) {
        const sql = await readFile(
          resolve(pluginRoot, "migrations/d1", file),
          "utf8",
        );
        await db.atomic(
          sql
            .split(";")
            .map((sql) => sql.trim())
            .filter(Boolean)
            .map((sql) => ({ sql })),
        );
      }
      await db.execute(
        "CREATE TABLE plugins (id TEXT PRIMARY KEY,status TEXT NOT NULL)",
      );
      await db.execute("INSERT INTO plugins (id,status) VALUES (?,?)", [
        "financeiro",
        "installed",
      ]);
      const { FinanceiroScheduler, LedgerService } = await import(
        pathToFileURL(resolve(pluginRoot, "src/index.ts")).href
      );
      const { today } = await import(
        pathToFileURL(resolve(pluginRoot, "src/domain/dates.ts")).href
      );
      const ledger = new LedgerService(db, {
        userId: "alarm-test",
        requestId: "alarm-test",
        permissions: [],
      });
      const company = await ledger.createCompany({ nome: "Alarm isolated" });
      const category = await ledger.createCategory(company.id, {
        nome: "Daily",
        tipo: "DESPESA",
      });
      await ledger.createRecurrence(company.id, {
        descricao: "Alarm daily",
        tipo: "DESPESA",
        categoriaId: category.id,
        valorCentavos: "100",
        ancora: today(),
        inicio: today(),
        regra: { frequencia: "DIA", intervalo: 1, ajuste_fds: "MANTER" },
      });
      const values = new Map();
      let alarmAt = null;
      let armCount = 0;
      const state = {
        storage: {
          getAlarm: async () => alarmAt,
          setAlarm: async (at) => {
            alarmAt = at;
            armCount++;
          },
          deleteAlarm: async () => {
            alarmAt = null;
          },
          get: async (key) => values.get(key),
          put: async (key, value) => {
            values.set(key, value);
          },
        },
      };
      const scheduler = new FinanceiroScheduler(state, db.testBindings);
      assert.equal(
        (
          await scheduler.fetch(
            new Request("https://local/arm", { method: "POST" }),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await scheduler.fetch(
            new Request("https://local/arm", { method: "POST" }),
          )
        ).status,
        200,
      );
      assert.equal(armCount, 1);
      await scheduler.alarm();
      assert.equal((await ledger.list(company.id, "lancamentos")).length, 20);
      assert.equal(values.get("step"), 1);
      await scheduler.alarm();
      assert.equal(values.get("step"), 2);
      await scheduler.alarm();
      assert.equal(values.get("step"), 0);
      await db.execute("UPDATE plugins SET status = ? WHERE id = ?", [
        "uninstalled",
        "financeiro",
      ]);
      await scheduler.alarm();
      assert.equal(alarmAt, null);
    } finally {
      await db.close();
    }
  },
);
