import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PluginDatabase,
  PluginSqlStatement,
  PluginSqlValue,
} from "@nexus/plugin-sdk/backend";
import {
  getWebhookStatus,
  processWebhookOutbox,
  type FinanceiroWebhookBindings,
} from "../src/modules/webhooks.js";

const env: FinanceiroWebhookBindings = {
  FINANCEIRO_WEBHOOK_SECRET: "test-only-signing-key-32-characters-minimum",
  FINANCEIRO_WEBHOOK_URL: "https://events.vendor.com/financeiro",
  FINANCEIRO_WEBHOOK_ALLOWED_HOSTS: "events.vendor.com",
};
const databases: DatabaseSync[] = [];
function fixture(): PluginDatabase & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE financeiro_outbox (id TEXT PRIMARY KEY,empresa_id TEXT NOT NULL,event_type TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','BLOCKED')),created_at TEXT NOT NULL,sent_at TEXT);
  `);
  sqlite.exec(
    readFileSync(
      new URL("../migrations/d1/0002_webhook_deliveries.sql", import.meta.url),
      "utf8",
    ),
  );
  const values = (params: PluginSqlValue[] = []) =>
    params as Array<string | number | null | Uint8Array>;
  const db: PluginDatabase & { sqlite: DatabaseSync } = {
    sqlite,
    provider: "d1",
    async query<T extends Record<string, unknown>>(
      sql: string,
      params?: PluginSqlValue[],
    ) {
      return sqlite.prepare(sql).all(...values(params)) as T[];
    },
    async first<T extends Record<string, unknown>>(
      sql: string,
      params?: PluginSqlValue[],
    ) {
      return (sqlite.prepare(sql).get(...values(params)) ?? null) as T | null;
    },
    async execute(sql: string, params?: PluginSqlValue[]) {
      return {
        rowsAffected: Number(
          sqlite.prepare(sql).run(...values(params)).changes,
        ),
      };
    },
    async atomic(statements: PluginSqlStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements)
          results.push(await db.execute(statement.sql, statement.params));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {},
  };
  return db;
}
function seed(
  db: ReturnType<typeof fixture>,
  id = "event_1",
  payload: unknown = {
    requestId: "req_1",
    userId: "user_1",
    action: "movimentos.create",
    empresaId: "company_1",
    entities: [{ resource: "movimentos", id: "mov_1", deleted: false }],
    revision: 1,
  },
) {
  db.sqlite
    .prepare(
      "INSERT INTO financeiro_outbox (id,empresa_id,event_type,payload,created_at) VALUES (?,?,?,?,?)",
    )
    .run(
      id,
      "company_1",
      "movimentos.create",
      JSON.stringify(payload),
      "2026-11-08T12:00:00.000Z",
    );
}
function delivery(db: ReturnType<typeof fixture>) {
  return db.sqlite
    .prepare("SELECT * FROM financeiro_webhook_deliveries ORDER BY outbox_id")
    .get();
}
function status(db: ReturnType<typeof fixture>) {
  return db.sqlite
    .prepare("SELECT status,sent_at FROM financeiro_outbox ORDER BY id")
    .get();
}
function transport(statusCode = 204) {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(null, { status: statusCode }));
}

afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
});

describe("operator-only webhook configuration", () => {
  it("is disabled without all three bindings and never accesses DB or fetch", async () => {
    const db = fixture();
    const query = vi.spyOn(db, "query");
    const request = transport();
    for (const config of [
      {},
      { ...env, FINANCEIRO_WEBHOOK_SECRET: undefined },
      { ...env, FINANCEIRO_WEBHOOK_URL: undefined },
      { ...env, FINANCEIRO_WEBHOOK_ALLOWED_HOSTS: undefined },
    ]) {
      expect(
        await processWebhookOutbox(db, config, { fetch: request }),
      ).toMatchObject({
        enabled: false,
        configuration: "MISSING_CONFIGURATION",
      });
    }
    expect(query).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    "http://events.vendor.com/hook",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://2130706433/hook",
    "https://0x7f000001/hook",
    "https://[::1]/hook",
    "https://169.254.169.254/hook",
    "https://10.0.0.1/hook",
    "https://events.internal/hook",
    "https://events.local/hook",
    "https://events.localhost.com/hook",
    "https://events.vendor.com:8443/hook",
    "https://events.vendor.com:443/hook",
    "https://user:pass@events.vendor.com/hook",
    "https://events.vendor.com/#fragment",
    "https://events.vendor.com.evil.com/hook",
    "https://events.vendor.com./hook",
    "https://events.vendor.com\\@evil.com/hook",
    "https://events.vendor.com/has space",
  ])("rejects unsafe or nonallowlisted destination %s", async (url) => {
    const db = fixture();
    const request = transport();
    expect(
      await processWebhookOutbox(
        db,
        { ...env, FINANCEIRO_WEBHOOK_URL: url },
        { fetch: request },
      ),
    ).toMatchObject({ enabled: false, configuration: "INVALID_CONFIGURATION" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    "*.vendor.com",
    "vendor.com:443",
    "localhost",
    "127.0.0.1",
    "events.local",
    "events.vendor.com,",
    "https://events.vendor.com",
    "EVENTS.vendor.com",
    "xn--vendor-9za.com",
  ])("rejects invalid allowlist %s", (hosts) => {
    expect(
      getWebhookStatus({ ...env, FINANCEIRO_WEBHOOK_ALLOWED_HOSTS: hosts })
        .enabled,
    ).toBe(false);
  });
  it("supports exact comma-separated trusted public hostnames and keeps status secret-free", () => {
    expect(
      getWebhookStatus({
        ...env,
        FINANCEIRO_WEBHOOK_ALLOWED_HOSTS: "other.vendor.com, events.vendor.com",
      }),
    ).toEqual({ enabled: true, configuration: "READY" });
    expect(
      getWebhookStatus({ ...env, FINANCEIRO_WEBHOOK_SECRET: "short" }),
    ).toEqual({ enabled: false, configuration: "INVALID_CONFIGURATION" });
  });
  it("requires paired migrations with identical portable schema", () => {
    expect(
      readFileSync(
        new URL(
          "../migrations/postgres/0002_webhook_deliveries.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(
      readFileSync(
        new URL(
          "../migrations/d1/0002_webhook_deliveries.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  });
});

describe("committed outbox dispatcher", () => {
  it("signs exact stable body and timestamp, acknowledges only 2xx, sends no contact data", async () => {
    const db = fixture();
    seed(db, "event_1", {
      requestId: "req_1",
      action: "movimentos.create",
      contact: { email: "private@vendor.com" },
      secret: "must-not-leak",
    });
    const request = transport();
    const at = Date.parse("2026-11-08T12:00:00Z");
    expect(
      await processWebhookOutbox(db, env, { fetch: request, now: () => at }),
    ).toMatchObject({ claimed: 1, sent: 1 });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(env.FINANCEIRO_WEBHOOK_URL);
    expect(init?.redirect).toBe("error");
    const headers = init?.headers as Record<string, string>;
    const body = String(init?.body);
    expect(headers["X-Financeiro-Event-Id"]).toBe("event_1");
    expect(headers["X-Financeiro-Signature"]).toBe(
      `v1=${createHmac("sha256", env.FINANCEIRO_WEBHOOK_SECRET!).update(`${headers["X-Financeiro-Timestamp"]}.${body}`).digest("hex")}`,
    );
    expect(JSON.parse(body)).toMatchObject({
      version: 1,
      id: "event_1",
      type: "movimentos.create",
      companyId: "company_1",
      data: { requestId: "req_1", action: "movimentos.create" },
    });
    expect(body).not.toContain("private@");
    expect(body).not.toContain("must-not-leak");
    expect(status(db)).toMatchObject({
      status: "SENT",
      sent_at: new Date(at).toISOString(),
    });
    expect(JSON.stringify(delivery(db))).not.toContain(
      env.FINANCEIRO_WEBHOOK_SECRET!,
    );
    expect(JSON.stringify(delivery(db))).not.toContain(
      env.FINANCEIRO_WEBHOOK_URL!,
    );
    await processWebhookOutbox(db, env, { fetch: request, now: () => at });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not see rolled-back events", async () => {
    const db = fixture();
    db.sqlite.exec("BEGIN");
    seed(db);
    db.sqlite.exec("ROLLBACK");
    const request = transport();
    expect(
      (await processWebhookOutbox(db, env, { fetch: request })).claimed,
    ).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([408, 425, 429, 500, 503])(
    "backs off on %i with stable body and ID even if source changes",
    async (code) => {
      const db = fixture();
      seed(db);
      let at = 1_800_000_000_000;
      const request = transport(code);
      expect(
        (await processWebhookOutbox(db, env, { fetch: request, now: () => at }))
          .retried,
      ).toBe(1);
      expect(delivery(db)).toMatchObject({
        attempts: 1,
        next_attempt_at: at + 30_000,
        status: "PENDING",
      });
      await processWebhookOutbox(db, env, { fetch: request, now: () => at });
      expect(request).toHaveBeenCalledTimes(1);
      db.sqlite.prepare("UPDATE financeiro_outbox SET payload = ?").run("{}");
      at += 30_000;
      request.mockImplementation(
        async () => new Response(null, { status: 204 }),
      );
      expect(
        (await processWebhookOutbox(db, env, { fetch: request, now: () => at }))
          .sent,
      ).toBe(1);
      expect(request.mock.calls[1]![1]?.body).toBe(
        request.mock.calls[0]![1]?.body,
      );
    },
  );
  it.each([301, 302, 307, 308, 400, 401, 403, 404, 422])(
    "blocks permanent rejection/redirect %i without following it",
    async (code) => {
      const db = fixture();
      seed(db);
      const request = transport(code);
      expect(
        (await processWebhookOutbox(db, env, { fetch: request })).blocked,
      ).toBe(1);
      expect(status(db)?.status).toBe("BLOCKED");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("retries network failures without persisting exception payload or URL", async () => {
    const db = fixture();
    seed(db);
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error("https://events.vendor.com/private?secret=credential"),
      );
    expect(
      (await processWebhookOutbox(db, env, { fetch: request })).retried,
    ).toBe(1);
    expect(delivery(db)?.last_error).toBe("TRANSPORT_ERROR");
    expect(JSON.stringify(delivery(db))).not.toContain("credential");
  });
  it("aborts at 10 seconds even when injected fetch ignores the signal", async () => {
    vi.useFakeTimers();
    const db = fixture();
    seed(db);
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const run = processWebhookOutbox(db, env, { fetch: request });
    // Real WebCrypto settles outside the fake timer queue.
    while (!request.mock.calls.length)
      await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await run).retried).toBe(1);
    expect(delivery(db)?.last_error).toBe("TIMEOUT");
    expect(request.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
  it("stops after eight attempts and never silently requeues a blocked event", async () => {
    const db = fixture();
    seed(db);
    let at = 1_800_000_000_000;
    const request = transport(503);
    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await processWebhookOutbox(db, env, {
        fetch: request,
        now: () => at,
      });
      expect(delivery(db)?.attempts).toBe(attempt);
      expect(attempt === 8 ? result.blocked : result.retried).toBe(1);
      at += 3_600_000;
    }
    await processWebhookOutbox(db, env, { fetch: request, now: () => at });
    expect(request).toHaveBeenCalledTimes(8);
    expect(status(db)?.status).toBe("BLOCKED");
    expect(() =>
      db.sqlite.exec("UPDATE financeiro_webhook_deliveries SET attempts = 9"),
    ).toThrow();
  });
  it("uses CAS to exclude simultaneous workers and recovers after a lost acknowledgement", async () => {
    const db = fixture();
    seed(db);
    let at = 1_800_000_000_000;
    let accept!: (response: Response) => void;
    const request = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const first = processWebhookOutbox(db, env, {
      fetch: request,
      now: () => at,
    });
    while (!request.mock.calls.length)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const second = await processWebhookOutbox(db, env, {
      fetch: request,
      now: () => at,
    });
    expect(second.claimed).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    at += 60_001;
    const retry = transport();
    expect(
      (await processWebhookOutbox(db, env, { fetch: retry, now: () => at }))
        .sent,
    ).toBe(1);
    accept(new Response(null, { status: 204 }));
    expect((await first).lostClaims).toBe(1);
    expect(delivery(db)).toMatchObject({ attempts: 2, status: "SENT" });
    expect(retry.mock.calls[0]![1]?.body).toBe(request.mock.calls[0]![1]?.body);
  });
  it("only one worker wins when both read the same unclaimed candidate", async () => {
    const db = fixture();
    seed(db);
    const request = transport();
    const original = db.query.bind(db);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
      const rows = await original(sql, params);
      reads++;
      if (reads === 2) release();
      await gate;
      return rows;
    });
    const results = await Promise.all([
      processWebhookOutbox(db, env, { fetch: request }),
      processWebhookOutbox(db, env, { fetch: request }),
    ]);
    expect(results.reduce((sum, item) => sum + item.sent, 0)).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("recovers an expired final attempt without a ninth delivery", async () => {
    const db = fixture();
    seed(db);
    const request = transport(503);
    let at = 1_800_000_000_000;
    await processWebhookOutbox(db, env, { fetch: request, now: () => at });
    db.sqlite
      .prepare(
        "UPDATE financeiro_webhook_deliveries SET attempts = 8,lease_token = 'dead-worker',lease_until = ?,next_attempt_at = ?",
      )
      .run(at + 60_000, at + 3_600_000);
    at += 60_001;
    expect(
      (await processWebhookOutbox(db, env, { fetch: request, now: () => at }))
        .blocked,
    ).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(status(db)?.status).toBe("BLOCKED");
  });
  it("blocks destination rotation without sending old backlog to a new endpoint", async () => {
    const db = fixture();
    seed(db);
    const request = transport(503);
    let at = 1_800_000_000_000;
    await processWebhookOutbox(db, env, { fetch: request, now: () => at });
    at += 30_000;
    expect(
      (
        await processWebhookOutbox(
          db,
          { ...env, FINANCEIRO_WEBHOOK_URL: "https://events.vendor.com/other" },
          { fetch: request, now: () => at },
        )
      ).blocked,
    ).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(delivery(db)?.last_error).toBe("DESTINATION_CHANGED");
  });
  it.each([
    null,
    [],
    "broken",
    { action: "different" },
    { empresaId: "other-company" },
    { revision: 1.5 },
    { entities: [{ resource: "movimentos", id: "x", deleted: "false" }] },
    { requestId: "line\nbreak" },
  ])("blocks malformed event %j", async (payload) => {
    const db = fixture();
    seed(db, "event_1", payload);
    const request = transport();
    expect(
      (await processWebhookOutbox(db, env, { fetch: request })).blocked,
    ).toBe(1);
    expect(request).not.toHaveBeenCalled();
    expect(delivery(db)?.last_error).toBe("INVALID_EVENT");
  });
  it("rejects oversized and invalid JSON payloads", async () => {
    const db = fixture();
    seed(db);
    const request = transport();
    db.sqlite
      .prepare("UPDATE financeiro_outbox SET payload = ?")
      .run("x".repeat(65_537));
    expect(
      (await processWebhookOutbox(db, env, { fetch: request })).blocked,
    ).toBe(1);
    expect(request).not.toHaveBeenCalled();
    seed(db, "event_2");
    db.sqlite
      .prepare("UPDATE financeiro_outbox SET payload = ? WHERE id = ?")
      .run("{bad-json", "event_2");
    expect(
      (await processWebhookOutbox(db, env, { fetch: request })).blocked,
    ).toBe(1);
  });
  it("propagates SDK errors and reclaims the lease after failed acknowledgement", async () => {
    const db = fixture();
    seed(db);
    let at = 1_800_000_000_000;
    const request = transport();
    const atomic = vi
      .spyOn(db, "atomic")
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      processWebhookOutbox(db, env, { fetch: request, now: () => at }),
    ).rejects.toThrow("database unavailable");
    expect(status(db)?.status).toBe("PENDING");
    atomic.mockRestore();
    at += 60_001;
    expect(
      (await processWebhookOutbox(db, env, { fetch: request, now: () => at }))
        .sent,
    ).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not acknowledge a success whose lease already expired", async () => {
    const db = fixture();
    seed(db);
    let at = 1_800_000_000_000;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      at += 60_001;
      return new Response(null, { status: 204 });
    });
    expect(
      (await processWebhookOutbox(db, env, { fetch: request, now: () => at }))
        .lostClaims,
    ).toBe(1);
    expect(status(db)?.status).toBe("PENDING");
    expect(delivery(db)?.status).toBe("PENDING");
    const retry = transport();
    expect(
      (await processWebhookOutbox(db, env, { fetch: retry, now: () => at }))
        .sent,
    ).toBe(1);
  });
  it("rolls back the delivery acknowledgement if the paired outbox update fails", async () => {
    const db = fixture();
    seed(db);
    db.sqlite.exec(
      "CREATE TRIGGER fail_ack BEFORE UPDATE OF status ON financeiro_outbox BEGIN SELECT RAISE(ABORT, 'outbox_ack_failed'); END",
    );
    const request = transport();
    await expect(
      processWebhookOutbox(db, env, { fetch: request }),
    ).rejects.toThrow("outbox_ack_failed");
    expect(status(db)?.status).toBe("PENDING");
    expect(delivery(db)?.status).toBe("PENDING");
    expect(delivery(db)?.lease_token).toBeTruthy();
  });
  it("bounds scans and validates options without sending", async () => {
    const db = fixture();
    seed(db);
    seed(db, "event_2");
    const request = transport();
    expect(
      (await processWebhookOutbox(db, env, { fetch: request, limit: 1 })).sent,
    ).toBe(1);
    for (const limit of [0, 51, -1, 1.5, NaN])
      await expect(
        processWebhookOutbox(db, env, { fetch: request, limit }),
      ).rejects.toThrow(RangeError);
    await expect(
      processWebhookOutbox(db, env, { fetch: request, now: () => NaN }),
    ).rejects.toThrow(RangeError);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
