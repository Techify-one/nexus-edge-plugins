import {
  createId,
  type PluginContextV1,
  type PluginDatabase,
} from "@nexus/plugin-sdk/backend";
import { assert, FinanceError } from "../errors.js";
import { changes, loadCompany, type Snapshot } from "./repository.js";
export async function withCompanyWrite<T>(
  db: PluginDatabase,
  companyId: string,
  context: PluginContextV1,
  action: string,
  prepare: (snapshot: Snapshot) => T | Promise<T>,
  options: { allowInactive?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await loadCompany(db, companyId);
    assert(
      options.allowInactive || before.company.ativo === 1,
      "EMPRESA_INACTIVE",
      "Empresa inativa.",
      409,
    );
    const after = structuredClone(before);
    let result: T;
    try {
      result = await prepare(after);
    } catch (error) {
      const actual = await db.first<{ revision: number }>(
        "SELECT revision FROM financeiro_empresas WHERE id = ?",
        [companyId],
      );
      if (actual && actual.revision !== before.company.revision) continue;
      throw error;
    }
    const mutations = changes(before, after);
    if (
      !mutations.length &&
      before.company.nome === after.company.nome &&
      before.company.ativo === after.company.ativo
    ) {
      const actual = await db.first<{ revision: number }>(
        "SELECT revision FROM financeiro_empresas WHERE id = ?",
        [companyId],
      );
      if (actual && actual.revision === before.company.revision) return result;
      continue;
    }

    const now = new Date().toISOString();
    const changedBefore: Record<string, unknown> = {},
      changedAfter: Record<string, unknown> = {};
    for (const resource of Object.keys(before.records) as Array<
      keyof Snapshot["records"]
    >) {
      const old = new Map(before.records[resource].map((row) => [row.id, row]));
      const current = new Map(
        after.records[resource].map((row) => [row.id, row]),
      );
      const ids = new Set([...old.keys(), ...current.keys()]);
      for (const id of ids)
        if (JSON.stringify(old.get(id)) !== JSON.stringify(current.get(id))) {
          changedBefore[`${resource}/${id}`] = old.get(id) ?? null;
          changedAfter[`${resource}/${id}`] = current.get(id) ?? null;
        }
    }
    const statements = [
      // Setting a negative revision violates CHECK and aborts the WHOLE atomic batch, not just this statement.
      {
        sql: "UPDATE financeiro_empresas SET revision = CASE WHEN revision = ? THEN revision + 1 ELSE -1 END, nome = ?, ativo = ?, updated_at = ? WHERE id = ?",
        params: [
          before.company.revision,
          after.company.nome,
          after.company.ativo,
          now,
          companyId,
        ],
      },
      ...mutations,
      {
        sql: "INSERT INTO financeiro_auditoria (id,empresa_id,user_id,request_id,action,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
        params: [
          createId("audit"),
          companyId,
          context.userId,
          context.requestId,
          action,
          JSON.stringify({ company: before.company, records: changedBefore }),
          JSON.stringify({ company: after.company, records: changedAfter }),
          now,
        ],
      },
      {
        sql: "INSERT INTO financeiro_outbox (id,empresa_id,event_type,payload,status,created_at) VALUES (?,?,?,?,'PENDING',?)",
        params: [
          createId("event"),
          companyId,
          action,
          JSON.stringify({
            requestId: context.requestId,
            userId: context.userId,
            action,
            empresaId: companyId,
            entities: Object.keys(changedAfter).map((key) => ({
              resource: key.slice(0, key.indexOf("/")),
              id: key.slice(key.indexOf("/") + 1),
              deleted: changedAfter[key] === null,
            })),
            revision: before.company.revision + 1,
          }),
          now,
        ],
      },
    ];
    try {
      await db.atomic(statements);
      return result;
    } catch (error) {
      const actual = await db.first<{ revision: number }>(
        "SELECT revision FROM financeiro_empresas WHERE id = ?",
        [companyId],
      );
      if (actual && actual.revision !== before.company.revision) continue;
      if (error instanceof FinanceError) throw error;
      throw error;
    }
  }
  throw new FinanceError(
    "CONCURRENT_WRITE",
    "Conflito de revisão. Tente novamente.",
    409,
  );
}
