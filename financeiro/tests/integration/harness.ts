import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type {
  PluginDatabase,
  PluginSqlValue,
  PluginSqlStatement,
} from "../../../.marketplace/packages/plugin-sdk/src/backend.ts";

export const pluginRoot =
  process.env.FINANCEIRO_TEST_PLUGIN_ROOT ??
  fileURLToPath(new URL("../../", import.meta.url));
const workspace =
  process.env.FINANCEIRO_TEST_WORKSPACE ?? resolve(pluginRoot, "..");
const sdkRequire = createRequire(
  resolve(workspace, ".marketplace/packages/plugin-sdk/package.json"),
);
const rootRequire = createRequire(resolve(workspace, "package.json"));
const normalize = (v: PluginSqlValue) =>
  v instanceof Date ? v.getTime() : typeof v === "boolean" ? Number(v) : v;

// These adapters execute real engines, not SQL mocks. SQLite is not D1 evidence.
export class SQLiteDatabase implements PluginDatabase {
  readonly provider = "d1" as const;
  readonly connection = new DatabaseSync(":memory:");
  constructor() {
    this.connection.exec("PRAGMA foreign_keys = ON");
  }
  async query<T extends Record<string, unknown>>(
    sql: string,
    params: PluginSqlValue[] = [],
  ): Promise<T[]> {
    return this.connection.prepare(sql).all(...params.map(normalize)) as T[];
  }
  async first<T extends Record<string, unknown>>(
    sql: string,
    params: PluginSqlValue[] = [],
  ): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async execute(sql: string, params: PluginSqlValue[] = []) {
    return {
      rowsAffected: Number(
        this.connection.prepare(sql).run(...params.map(normalize)).changes,
      ),
    };
  }
  async atomic(statements: PluginSqlStatement[]) {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(({ sql, params = [] }) => ({
        rowsAffected: Number(
          this.connection.prepare(sql).run(...params.map(normalize)).changes,
        ),
      }));
      this.connection.exec("COMMIT");
      return results;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  async close() {
    this.connection.close();
  }
}

export type Engine = "sqlite" | "d1" | "postgres";
export const engines: Engine[] = [
  "sqlite",
  ...(process.env.FINANCEIRO_TEST_D1 === "1" ? ["d1" as const] : []),
  ...(process.env.FINANCEIRO_TEST_POSTGRES_URL ? ["postgres" as const] : []),
];

export async function openDatabase(engine: Engine): Promise<PluginDatabase> {
  const migration = await readFile(
    resolve(
      pluginRoot,
      `migrations/${engine === "postgres" ? "postgres" : "d1"}/0001_init.sql`,
    ),
    "utf8",
  );
  if (engine === "sqlite") {
    const db = new SQLiteDatabase();
    db.connection.exec(migration);
    return db;
  }
  const { createPluginDatabase } = await import(
    pathToFileURL(
      resolve(workspace, ".marketplace/packages/plugin-sdk/src/backend.ts"),
    ).href
  );
  if (engine === "d1") {
    const wranglerRequire = createRequire(rootRequire.resolve("wrangler"));
    const { Miniflare } = wranglerRequire("miniflare");
    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: "financeiro-integration",
            type: "worker",
            compatibilityDate: "2026-03-01",
            manifest: {
              mainModule: "index.js",
              modules: {
                "index.js": {
                  type: "esm",
                  contents:
                    "export default { fetch() { return new Response('integration'); } };",
                },
              },
            },
            env: { DB: { type: "d1", id: "financeiro-integration" } },
          },
        },
      ],
    });
    const binding = await mf.getD1Database("DB");
    // Single statements work with D1 exec and preserve all schema constraints.
    await binding.batch(
      migration
        .split(";")
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => binding.prepare(s)),
    );
    const db = await createPluginDatabase({
      DATABASE_PROVIDER: "d1",
      DB: binding,
    });
    db.close = () => mf.dispose();
    Object.assign(db, {
      testBindings: { DATABASE_PROVIDER: "d1", DB: binding },
    });
    return db;
  }
  const { Client } = sdkRequire("pg");
  const client = new Client({
    connectionString: process.env.FINANCEIRO_TEST_POSTGRES_URL,
  });
  await client.connect();
  const schema = `financeiro_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  try {
    await client.query(migration);
  } catch (error) {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
    throw error;
  }
  // SDK's Postgres adapter owns one Client per request. Separate clients ensure
  // concurrent writes never interleave BEGIN/COMMIT on the same connection.
  const sqlParams = (sql: string) => {
    let n = 0;
    return sql.replaceAll("?", () => `$${++n}`);
  };
  let queued: Promise<unknown> = Promise.resolve();
  const schedule = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queued.then(operation);
    queued = result.catch(() => undefined);
    return result;
  };
  const query = async (sql: string, params: PluginSqlValue[] = []) =>
    schedule(async () => (await client.query(sqlParams(sql), params)).rows);
  return {
    provider: "postgres",
    query,
    first: async (sql: string, params: PluginSqlValue[] = []) =>
      (await query(sql, params))[0] ?? null,
    execute: async (sql: string, params: PluginSqlValue[] = []) =>
      schedule(async () => ({
        rowsAffected:
          (await client.query(sqlParams(sql), params)).rowCount ?? 0,
      })),
    atomic: async (statements: PluginSqlStatement[]) => {
      const tx = new Client({
        connectionString: process.env.FINANCEIRO_TEST_POSTGRES_URL,
      });
      await tx.connect();
      try {
        await tx.query("BEGIN");
        await tx.query(`SET LOCAL search_path TO ${schema}`);
        const results = [];
        for (const statement of statements)
          results.push({
            rowsAffected:
              (await tx.query(sqlParams(statement.sql), statement.params ?? []))
                .rowCount ?? 0,
          });
        await tx.query("COMMIT");
        return results;
      } catch (error) {
        await tx.query("ROLLBACK");
        throw error;
      } finally {
        await tx.end();
      }
    },
    close: async () => {
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
    },
  } as PluginDatabase;
}

export async function loadBackend() {
  return import(
    pathToFileURL(resolve(pluginRoot, "src/modules/ledger.ts")).href
  );
}

// Hold the first N prepared writes before entering atomic. Each service has
// already read its revision/state. This creates an actual stale CAS race.
export function racePreparedWrites(db: PluginDatabase, count: number) {
  const original = db.atomic.bind(db);
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  const timeout = setTimeout(release, 10_000);
  db.atomic = async (statements) => {
    if (arrivals < count) {
      arrivals++;
      if (arrivals === count) {
        clearTimeout(timeout);
        release();
      }
      await barrier;
    }
    return original(statements);
  };
  return {
    restore: () => {
      clearTimeout(timeout);
      release();
      db.atomic = original;
    },
    arrivals: () => arrivals,
  };
}

export async function counts(db: PluginDatabase) {
  const names = [
    "empresas",
    "contas",
    "categorias",
    "lancamentos",
    "movimentos",
    "transferencias",
    "fechamentos",
    "idempotencia",
    "auditoria",
    "outbox",
  ];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        Number(
          (await db.first(`SELECT COUNT(*) AS n FROM financeiro_${name}`))?.n,
        ),
      ]),
    ),
  );
}
