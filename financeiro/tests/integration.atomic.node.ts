import assert from "node:assert/strict";
import { test } from "node:test";
import { engines, openDatabase, counts } from "./integration/harness.ts";

for (const engine of engines) {
  test(`${engine}: a constraint failure aborts every batch statement, including earlier financial inserts`, async () => {
    const db = await openDatabase(engine);
    try {
      await db.execute(
        "INSERT INTO financeiro_empresas (id,nome,created_at,updated_at) VALUES (?,?,?,?)",
        ["e1", "Empresa teste", "2026-10-01", "2026-10-01"],
      );
      await db.execute(
        "INSERT INTO financeiro_contas (id,empresa_id,payload) VALUES (?,?,?)",
        ["a1", "e1", "{}"],
      );
      await db.execute(
        "INSERT INTO financeiro_contas (id,empresa_id,payload) VALUES (?,?,?)",
        ["a2", "e1", "{}"],
      );
      const before = await counts(db);
      await assert.rejects(() =>
        db.atomic([
          {
            sql: "UPDATE financeiro_empresas SET revision=revision+1 WHERE id=? AND revision=?",
            params: ["e1", 0],
          },
          {
            sql: "INSERT INTO financeiro_transferencias (id,empresa_id,origem_id,destino_id,payload) VALUES (?,?,?,?,?)",
            params: ["t1", "e1", "a1", "a2", "{}"],
          },
          {
            sql: "INSERT INTO financeiro_movimentos (id,empresa_id,conta_id,transferencia_id,data_efetiva,valor_centavos,sinal,payload) VALUES (?,?,?,?,?,?,?,?)",
            params: ["m1", "e1", "a1", "t1", "2026-10-15", "800000", -1, "{}"],
          },
          // Destination FK violation occurs after the source movement.
          {
            sql: "INSERT INTO financeiro_movimentos (id,empresa_id,conta_id,transferencia_id,data_efetiva,valor_centavos,sinal,payload) VALUES (?,?,?,?,?,?,?,?)",
            params: [
              "m2",
              "e1",
              "missing",
              "t1",
              "2026-10-15",
              "800000",
              1,
              "{}",
            ],
          },
          {
            sql: "INSERT INTO financeiro_outbox (id,empresa_id,event_type,payload,created_at) VALUES (?,?,?,?,?)",
            params: ["o1", "e1", "transferencia.criada", "{}", "2026-10-15"],
          },
        ]),
      );
      assert.deepEqual(await counts(db), before);
      assert.equal(
        Number(
          (
            await db.first(
              "SELECT revision FROM financeiro_empresas WHERE id=?",
              ["e1"],
            )
          )?.revision,
        ),
        0,
      );
    } finally {
      await db.close();
    }
  });

  test(`${engine}: relational composite keys reject cross-company accounts and category type mismatch`, async () => {
    const db = await openDatabase(engine);
    try {
      for (const id of ["e1", "e2"])
        await db.execute(
          "INSERT INTO financeiro_empresas (id,nome,created_at,updated_at) VALUES (?,?,?,?)",
          [id, id, "2026-10-01", "2026-10-01"],
        );
      await db.execute(
        "INSERT INTO financeiro_contas (id,empresa_id,payload) VALUES (?,?,?)",
        ["foreign-account", "e2", "{}"],
      );
      await db.execute(
        "INSERT INTO financeiro_categorias (id,empresa_id,tipo,payload) VALUES (?,?,?,?)",
        ["expense", "e1", "DESPESA", "{}"],
      );
      const insert =
        "INSERT INTO financeiro_lancamentos (id,empresa_id,categoria_id,conta_id,tipo,competencia,vencimento,valor_centavos,payload) VALUES (?,?,?,?,?,?,?,?,?)";
      await assert.rejects(() =>
        db.execute(insert, [
          "cross",
          "e1",
          "expense",
          "foreign-account",
          "DESPESA",
          "2026-10",
          "2026-10-20",
          "1000",
          "{}",
        ]),
      );
      await assert.rejects(() =>
        db.execute(insert, [
          "wrong-type",
          "e1",
          "expense",
          null,
          "RECEITA",
          "2026-10",
          "2026-10-20",
          "1000",
          "{}",
        ]),
      );
      assert.equal((await counts(db)).lancamentos, 0);
    } finally {
      await db.close();
    }
  });
}
