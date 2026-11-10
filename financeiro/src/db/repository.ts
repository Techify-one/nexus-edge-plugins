import type {
  PluginDatabase,
  PluginSqlStatement,
  PluginSqlValue,
} from "@nexus/plugin-sdk/backend";
import { assert } from "../errors.js";
export type Entity = { id: string; empresaId: string; [key: string]: unknown };
export const resources = [
  "contas",
  "categorias",
  "recorrencias",
  "lancamentos",
  "transferencias",
  "movimentos",
  "fechamentos",
  "visoes",
  "anexos",
  "avisos",
  "idempotencia",
] as const;
export type Resource = (typeof resources)[number];
export type Company = {
  id: string;
  nome: string;
  ativo: number;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type Snapshot = {
  company: Company;
  records: Record<Resource, Entity[]>;
};
const columns: Record<Resource, Record<string, string>> = {
  contas: {},
  categorias: { tipo: "tipo" },
  recorrencias: {
    categoria_id: "categoriaId",
    conta_id: "contaPrevistaId",
    tipo: "tipo",
  },
  lancamentos: {
    categoria_id: "categoriaId",
    conta_id: "contaPrevistaId",
    recorrencia_id: "recorrenciaId",
    ocorrencia: "ocorrencia",
    tipo: "tipo",
    competencia: "competencia",
    vencimento: "vencimento",
    valor_centavos: "valorCentavos",
  },
  transferencias: { origem_id: "contaOrigemId", destino_id: "contaDestinoId" },
  movimentos: {
    lancamento_id: "lancamentoId",
    conta_id: "contaId",
    transferencia_id: "transferenciaId",
    estorno_de_id: "estornoDeId",
    data_efetiva: "dataEfetiva",
    valor_centavos: "valorCentavos",
    sinal: "sinal",
  },
  fechamentos: { mes: "mes", versao: "versao" },
  visoes: { user_id: "userId" },
  anexos: { lancamento_id: "lancamentoId" },
  avisos: {},
  idempotencia: { chave: "chave", hash: "hash" },
};
export async function loadCompany(
  db: PluginDatabase,
  companyId: string,
  selected: readonly Resource[] = resources,
): Promise<Snapshot> {
  const company = await db.first<Company>(
    "SELECT * FROM financeiro_empresas WHERE id = ?",
    [companyId],
  );
  assert(company, "EMPRESA_NOT_FOUND", "Empresa não encontrada.", 404);
  const records = Object.fromEntries(
    resources.map((resource) => [resource, [] as Entity[]]),
  ) as Snapshot["records"];
  // Revision is deliberately read before every business query. The final CAS detects any concurrent write.
  for (const resource of new Set(selected)) {
    const rows = await db.query<{ payload: string }>(
      `SELECT payload FROM financeiro_${resource} WHERE empresa_id = ? ORDER BY id`,
      [companyId],
    );
    records[resource] = rows.map((row) => JSON.parse(row.payload) as Entity);
  }
  return { company, records };
}
export async function consistentRead<T>(
  db: PluginDatabase,
  companyId: string,
  read: (snapshot: Snapshot) => T | Promise<T>,
  selected: readonly Resource[] = resources,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await loadCompany(db, companyId, selected);
    let result: T;
    try {
      result = await read(snapshot);
    } catch (error) {
      const actual = await db.first<{ revision: number }>(
        "SELECT revision FROM financeiro_empresas WHERE id = ?",
        [companyId],
      );
      if (actual && actual.revision !== snapshot.company.revision) continue;
      throw error;
    }
    const after = await db.first<{ revision: number }>(
      "SELECT revision FROM financeiro_empresas WHERE id = ?",
      [companyId],
    );
    if (after && after.revision === snapshot.company.revision) return result;
  }
  assert(
    false,
    "CONCURRENT_WRITE",
    "A empresa foi alterada durante a leitura. Tente novamente.",
    409,
  );
}
export function changes(
  before: Snapshot,
  after: Snapshot,
): PluginSqlStatement[] {
  const statements: PluginSqlStatement[] = [];
  for (const resource of resources) {
    const previous = new Map(
      before.records[resource].map((row) => [row.id, row]),
    );
    for (const row of after.records[resource]) {
      const old = previous.get(row.id);
      previous.delete(row.id);
      const payload = JSON.stringify(row);
      if (old && JSON.stringify(old) === payload) continue;
      const fields = columns[resource];
      const values = Object.values(fields).map(
        (key) => (row[key] ?? null) as PluginSqlValue,
      );
      if (!old) {
        const names = ["id", "empresa_id", ...Object.keys(fields), "payload"];
        statements.push({
          sql: `INSERT INTO financeiro_${resource} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
          params: [row.id, row.empresaId, ...values, payload],
        });
      } else
        statements.push({
          sql: `UPDATE financeiro_${resource} SET ${[...Object.keys(fields), "payload"].map((name) => `${name} = ?`).join(",")} WHERE empresa_id = ? AND id = ?`,
          params: [...values, payload, row.empresaId, row.id],
        });
    }
    for (const row of previous.values()) {
      assert(
        resource === "visoes" || resource === "anexos",
        "IMMUTABLE_RECORD",
        "Registros financeiros não podem ser excluídos.",
      );
      statements.push({
        sql: `DELETE FROM financeiro_${resource} WHERE empresa_id = ? AND id = ?`,
        params: [row.empresaId, row.id],
      });
    }
  }
  return statements;
}
