import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { engines, openDatabase, pluginRoot } from "./integration/harness.ts";

for (const engine of engines) {
  test(`${engine}: webhook claims, retry and acknowledgement use the real database`, async () => {
    const db = await openDatabase(engine);
    try {
      const migration = await readFile(
        resolve(
          pluginRoot,
          `migrations/${engine === "postgres" ? "postgres" : "d1"}/0002_webhook_deliveries.sql`,
        ),
        "utf8",
      );
      await db.atomic(
        migration
          .split(";")
          .map((sql) => sql.trim())
          .filter(Boolean)
          .map((sql) => ({ sql })),
      );
      const at = new Date("2026-11-08T12:00:00Z").getTime();
      const companyId = "webhook_company";
      await db.execute(
        "INSERT INTO financeiro_empresas (id,nome,ativo,revision,created_at,updated_at) VALUES (?,?,1,0,?,?)",
        [
          companyId,
          "Webhook integration",
          new Date(at).toISOString(),
          new Date(at).toISOString(),
        ],
      );
      await db.execute(
        "INSERT INTO financeiro_outbox (id,empresa_id,event_type,payload,status,created_at) VALUES (?,?,?,?,'PENDING',?)",
        [
          "event_test",
          companyId,
          "lancamentos.create",
          JSON.stringify({
            empresaId: companyId,
            action: "lancamentos.create",
            entities: [
              { resource: "lancamentos", id: "entry_test", deleted: false },
            ],
          }),
          new Date(at).toISOString(),
        ],
      );
      const { processWebhookOutbox } = await import(
        pathToFileURL(resolve(pluginRoot, "src/modules/webhooks.ts")).href
      );
      const env = {
        FINANCEIRO_WEBHOOK_SECRET:
          "integration-only-key-with-at-least-32-bytes",
        FINANCEIRO_WEBHOOK_URL: "https://events.vendor.com/financeiro",
        FINANCEIRO_WEBHOOK_ALLOWED_HOSTS: "events.vendor.com",
      };
      let sends = 0;
      const transport = async (_url: unknown, init: RequestInit) => {
        sends++;
        assert.equal(init.redirect, "error");
        assert.match(
          new Headers(init.headers).get("X-Financeiro-Signature") || "",
          /^v1=[a-f0-9]{64}$/,
        );
        return new Response(null, { status: sends === 1 ? 503 : 204 });
      };
      const first = await processWebhookOutbox(db, env, {
        now: () => at,
        fetch: transport,
      });
      assert.equal(first.retried, 1);
      const notDue = await processWebhookOutbox(db, env, {
        now: () => at + 1,
        fetch: transport,
      });
      assert.equal(notDue.claimed, 0);
      const second = await processWebhookOutbox(db, env, {
        now: () => at + 31_000,
        fetch: transport,
      });
      assert.equal(second.sent, 1);
      assert.equal(sends, 2);
      assert.equal(
        (
          await db.first("SELECT status FROM financeiro_outbox WHERE id = ?", [
            "event_test",
          ])
        )?.status,
        "SENT",
      );
      assert.equal(
        (
          await db.first(
            "SELECT status FROM financeiro_webhook_deliveries WHERE outbox_id = ?",
            ["event_test"],
          )
        )?.status,
        "SENT",
      );
      await processWebhookOutbox(db, env, {
        now: () => at + 120_000,
        fetch: transport,
      });
      assert.equal(sends, 2);
    } finally {
      await db.close();
    }
  });
}
