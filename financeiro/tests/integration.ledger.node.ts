import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engines,
  openDatabase,
  counts,
  loadBackend,
  racePreparedWrites,
} from "./integration/harness.ts";

const context = {
  userId: "integration-user",
  requestId: "integration-request",
  permissions: [],
};
const key = () => crypto.randomUUID();
const code = (expected: string) => (error: any) => {
  assert.equal(error.code, expected);
  return true;
};

async function fixture(engine: (typeof engines)[number]) {
  const db = await openDatabase(engine);
  try {
    const { LedgerService } = await loadBackend();
    const service = new LedgerService(db, context);
    const company = await service.createCompany({ nome: "Empresa integração" });
    const account = await service.createAccount(company.id, {
      nome: "Banco",
      tipo: "BANCO",
      saldoInicialCentavos: "1000000",
      dataSaldoInicial: "2026-01-01",
    });
    const account2 = await service.createAccount(company.id, {
      nome: "Caixa",
      tipo: "CAIXA",
      saldoInicialCentavos: "0",
      dataSaldoInicial: "2026-01-01",
    });
    const expense = await service.createCategory(company.id, {
      nome: "Despesas",
      tipo: "DESPESA",
    });
    const revenue = await service.createCategory(company.id, {
      nome: "Receitas",
      tipo: "RECEITA",
    });
    const entry = (valorCentavos = "100000", extra = {}) =>
      service.createEntry(company.id, {
        tipo: "DESPESA",
        descricao: "Fornecedor",
        categoriaId: expense.id,
        valorCentavos,
        competencia: "2026-10-01",
        vencimento: "2026-10-20",
        chaveIdempotencia: key(),
        ...extra,
      });
    const settle = (id: string, valorCentavos: string, extra = {}) =>
      service.settle(company.id, id, {
        contaId: account.id,
        dataEfetiva: "2026-10-21",
        valorCentavos,
        chaveIdempotencia: key(),
        ...extra,
      });
    return {
      db,
      service,
      company,
      account,
      account2,
      expense,
      revenue,
      entry,
      settle,
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}

for (const engine of engines) {
  test(`${engine}: stale CAS aborts all financial/audit/outbox/idempotency inserts`, async () => {
    const f = await fixture(engine);
    try {
      const e = await f.entry();
      const before = await counts(f.db);
      const original = f.db.atomic.bind(f.db);
      let failedBatch = false;
      f.db.atomic = async (statements) => {
        assert.ok(statements.length > 3);
        // Real CHECK failure on a prepared operation. Make retries observe the
        // same revision so the test inspects the failed commit itself.
        const guard = statements[0];
        const params = [...(guard.params ?? [])];
        params[0] = -900;
        try {
          return await original([{ ...guard, params }, ...statements.slice(1)]);
        } catch (error) {
          failedBatch = true;
          throw error;
        }
      };
      await assert.rejects(() => f.settle(e.id, "10000"));
      f.db.atomic = original;
      assert.equal(failedBatch, true);
      assert.deepEqual(await counts(f.db), before);
      assert.equal(
        (await f.service.getEntry(f.company.id, e.id)).pendenteCentavos,
        "100000",
      );
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: concurrent prepared partial payments retry without overpayment or lost ledger updates`, async () => {
    const f = await fixture(engine);
    try {
      const e = await f.entry("10000");
      const before = await counts(f.db);
      const race = racePreparedWrites(f.db, 4);
      const results = await Promise.allSettled([
        f.settle(e.id, "3000"),
        f.settle(e.id, "3000"),
        f.settle(e.id, "3000", { contaId: f.account2.id }),
        f.settle(e.id, "3000"),
      ]);
      race.restore();
      assert.equal(race.arrivals(), 4);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
      for (const r of results)
        if (r.status === "rejected")
          assert.equal(r.reason.code, "SOBREPAGAMENTO");
      const detail = await f.service.getEntry(f.company.id, e.id);
      assert.equal(detail.liquidadoCentavos, "9000");
      assert.equal(detail.pendenteCentavos, "1000");
      assert.equal(detail.movimentos.length, 3);
      const after = await counts(f.db);
      assert.equal(after.auditoria - before.auditoria, 3);
      assert.equal(after.outbox - before.outbox, 3);
      assert.equal(after.idempotencia - before.idempotencia, 3);
      assert.equal(
        (await f.service.summary(f.company.id, "2026-10"))
          .saldoConsolidadoCentavos,
        "991000",
      );
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: same idempotency key races to one movement and changed content is rejected`, async () => {
    const f = await fixture(engine);
    try {
      const e = await f.entry();
      const chaveIdempotencia = key();
      const race = racePreparedWrites(f.db, 2);
      const results = await Promise.all([
        f.settle(e.id, "10000", { chaveIdempotencia }),
        f.settle(e.id, "10000", { chaveIdempotencia }),
      ]);
      race.restore();
      assert.equal(race.arrivals(), 2);
      assert.equal(results[0].id, results[1].id);
      assert.equal((await counts(f.db)).movimentos, 1);
      assert.equal((await counts(f.db)).idempotencia, 2);
      const afterFirst = await counts(f.db);
      const beforeRevision = await f.db.first(
        "SELECT revision FROM financeiro_empresas WHERE id=?",
        [f.company.id],
      );
      assert.equal(
        (await f.settle(e.id, "10000", { chaveIdempotencia })).id,
        results[0].id,
      );
      assert.deepEqual(await counts(f.db), afterFirst);
      assert.deepEqual(
        await f.db.first(
          "SELECT revision FROM financeiro_empresas WHERE id=?",
          [f.company.id],
        ),
        beforeRevision,
      );
      const before = await counts(f.db);
      await assert.rejects(
        () => f.settle(e.id, "5000", { chaveIdempotencia }),
        code("IDEMPOTENCY_CONFLICT"),
      );
      assert.deepEqual(await counts(f.db), before);
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: transfer commits two opposite movements, preserves consolidated cash and replay`, async () => {
    const f = await fixture(engine);
    try {
      const body = {
        contaOrigemId: f.account.id,
        contaDestinoId: f.account2.id,
        dataEfetiva: "2026-10-15",
        valorCentavos: "800000",
        chaveIdempotencia: key(),
      };
      const transfer = await f.service.transfer(f.company.id, body);
      assert.equal(
        (await f.service.transfer(f.company.id, body)).id,
        transfer.id,
      );
      const movements = await f.service.list(f.company.id, "movimentos");
      assert.equal(movements.length, 2);
      assert.deepEqual(movements.map((m: any) => m.sinal).sort(), [-1, 1]);
      const summary = await f.service.summary(f.company.id, "2026-10");
      assert.equal(summary.saldoConsolidadoCentavos, "1000000");
      assert.equal(summary.resultadoCaixaCentavos, "0");
      assert.deepEqual(summary.contas.map((a: any) => a.saldoCentavos).sort(), [
        "200000",
        "800000",
      ]);
      const before = await counts(f.db);
      // Inject a real invalid FK into the final movement, after all other
      // financial statements. The real engine must undo the valid first leg.
      const original = f.db.atomic.bind(f.db);
      f.db.atomic = (statements) =>
        original([
          ...statements.slice(0, -1),
          {
            sql: "INSERT INTO financeiro_movimentos (id,empresa_id,conta_id,data_efetiva,valor_centavos,sinal,payload) VALUES (?,?,?,?,?,?,?)",
            params: [
              key(),
              f.company.id,
              "missing-account",
              "2026-10-15",
              "1",
              1,
              "{}",
            ],
          },
          statements.at(-1)!,
        ]);
      await assert.rejects(() =>
        f.service.transfer(f.company.id, { ...body, chaveIdempotencia: key() }),
      );
      f.db.atomic = original;
      assert.deepEqual(await counts(f.db), before);
      assert.equal(
        (await f.service.summary(f.company.id, "2026-10"))
          .saldoConsolidadoCentavos,
        "1000000",
      );
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: transfer reversal is atomic, idempotent and cash neutral`, async () => {
    const f = await fixture(engine);
    try {
      const transfer = await f.service.transfer(f.company.id, {
        contaOrigemId: f.account.id,
        contaDestinoId: f.account2.id,
        dataEfetiva: "2026-10-15",
        valorCentavos: "800000",
        chaveIdempotencia: key(),
      });
      const reversal = {
        motivo: "Transferência registrada incorretamente",
        dataEfetiva: "2026-10-16",
        chaveIdempotencia: key(),
      };
      await f.service.reverseTransfer(f.company.id, transfer.id, reversal);
      const before = await counts(f.db);
      await f.service.reverseTransfer(f.company.id, transfer.id, reversal);
      assert.deepEqual(await counts(f.db), before);
      await assert.rejects(
        () =>
          f.service.reverseTransfer(f.company.id, transfer.id, {
            ...reversal,
            chaveIdempotencia: key(),
          }),
        code("ESTORNO_INVALIDO"),
      );
      const movements = await f.service.list(f.company.id, "movimentos");
      assert.equal(movements.length, 4);
      assert.equal(movements.filter((m: any) => m.estornoDeId).length, 2);
      const summary = await f.service.summary(f.company.id, "2026-10");
      assert.equal(summary.saldoConsolidadoCentavos, "1000000");
      assert.equal(summary.resultadoCaixaCentavos, "0");
      assert.deepEqual(summary.contas.map((a: any) => a.saldoCentavos).sort(), [
        "0",
        "1000000",
      ]);
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: already-paid creation rolls back entry when movement fails`, async () => {
    const f = await fixture(engine);
    try {
      const before = await counts(f.db);
      const original = f.db.atomic.bind(f.db);
      f.db.atomic = (statements) =>
        original([
          ...statements,
          {
            sql: "INSERT INTO financeiro_contas (id,empresa_id,payload) VALUES (?,?,?)",
            params: ["invalid", "missing-company", "{}"],
          },
        ]);
      await assert.rejects(() =>
        f.entry("50000", {
          liquidacao: {
            contaId: f.account.id,
            valorCentavos: "50000",
            dataEfetiva: "2026-10-21",
          },
        }),
      );
      f.db.atomic = original;
      assert.deepEqual(await counts(f.db), before);
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: already-paid creation requires a key and replays without duplicate obligation or payment`, async () => {
    const f = await fixture(engine);
    try {
      const payload = {
        tipo: "DESPESA",
        descricao: "Conta já paga",
        categoriaId: f.expense.id,
        valorCentavos: "4500",
        competencia: "2026-10-01",
        vencimento: "2026-10-20",
        liquidacao: {
          contaId: f.account.id,
          dataEfetiva: "2026-10-20",
          valorCentavos: "4500",
        },
      };
      await assert.rejects(async () =>
        f.service.createEntry(f.company.id, payload),
      );
      const chaveIdempotencia = key();
      const first = await f.service.createEntry(f.company.id, {
        ...payload,
        chaveIdempotencia,
      });
      const before = await counts(f.db);
      const replay = await f.service.createEntry(f.company.id, {
        ...payload,
        chaveIdempotencia,
      });
      assert.equal(replay.id, first.id);
      assert.deepEqual(await counts(f.db), before);
      assert.equal(
        (await f.service.list(f.company.id, "lancamentos")).length,
        1,
      );
      assert.equal(
        (await f.service.list(f.company.id, "movimentos")).length,
        1,
      );
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: concurrent reversal is unique, restores pending amount and rejects reversal of reversal`, async () => {
    const f = await fixture(engine);
    try {
      const e = await f.entry("40000");
      const movement = await f.settle(e.id, "40000");
      const reverse = () =>
        f.service.reverse(f.company.id, movement.id, {
          motivo: "Pagamento incorreto",
          dataEfetiva: "2026-10-22",
          chaveIdempotencia: key(),
        });
      const race = racePreparedWrites(f.db, 2);
      const results = await Promise.allSettled([reverse(), reverse()]);
      race.restore();
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      assert.equal(rejected.reason.code, "ESTORNO_INVALIDO");
      const reversal = (
        results.find(
          (r) => r.status === "fulfilled",
        ) as PromiseFulfilledResult<any>
      ).value;
      await assert.rejects(
        () =>
          f.service.reverse(f.company.id, reversal.id, {
            motivo: "Não permitido",
            dataEfetiva: "2026-10-23",
            chaveIdempotencia: key(),
          }),
        code("ESTORNO_INVALIDO"),
      );
      assert.equal(
        (await f.service.getEntry(f.company.id, e.id)).pendenteCentavos,
        "40000",
      );
      assert.equal(
        (await f.service.summary(f.company.id, "2026-10"))
          .saldoConsolidadoCentavos,
        "1000000",
      );
      assert.equal((await counts(f.db)).movimentos, 2);
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: closing races a payment, snapshot contains exactly committed cash, reopening versions history`, async () => {
    const f = await fixture(engine);
    try {
      const e = await f.entry("10000");
      const race = racePreparedWrites(f.db, 2);
      const [payment, closing] = await Promise.allSettled([
        f.settle(e.id, "10000"),
        f.service.closePeriod(f.company.id, { mes: "2026-10" }),
      ]);
      race.restore();
      assert.equal(closing.status, "fulfilled");
      if (payment.status === "rejected")
        assert.equal(payment.reason.code, "PERIODO_FECHADO");
      const closure = (closing as PromiseFulfilledResult<any>).value;
      assert.equal(
        closure.snapshot.saidasCentavos,
        payment.status === "fulfilled" ? "10000" : "0",
      );
      const snapshot = structuredClone(closure.snapshot);
      await assert.rejects(() => f.entry("1000"), code("PERIODO_FECHADO"));
      await assert.rejects(async () =>
        f.service.reopen(f.company.id, closure.id, { motivo: "" }),
      );
      await f.service.reopen(f.company.id, closure.id, {
        motivo: "Ajustar tarifa bancária",
      });
      const second = await f.service.closePeriod(f.company.id, {
        mes: "2026-10",
      });
      assert.equal(second.versao, 2);
      const closures = await f.service.list(f.company.id, "fechamentos");
      assert.equal(closures.length, 2);
      const firstVersion = closures.find((c: any) => c.id === closure.id);
      const secondVersion = closures.find((c: any) => c.id === second.id);
      assert.equal(firstVersion.status, "REABERTO");
      assert.deepEqual(firstVersion.snapshot, snapshot);
      assert.equal(secondVersion.status, "FECHADO");
      assert.equal(secondVersion.versao, 2);
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: simultaneous close produces one revision and company isolation rejects foreign references`, async () => {
    const f = await fixture(engine);
    try {
      const race = racePreparedWrites(f.db, 2);
      const results = await Promise.allSettled([
        f.service.closePeriod(f.company.id, { mes: "2026-10" }),
        f.service.closePeriod(f.company.id, { mes: "2026-10" }),
      ]);
      race.restore();
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await counts(f.db)).fechamentos, 1);
      const other = await f.service.createCompany({ nome: "Empresa isolada" });
      const before = await counts(f.db);
      await assert.rejects(
        () =>
          f.service.createEntry(other.id, {
            tipo: "DESPESA",
            descricao: "Referência externa",
            categoriaId: f.expense.id,
            valorCentavos: "1000",
            competencia: "2026-11-01",
            vencimento: "2026-11-20",
          }),
        code("NOT_FOUND"),
      );
      await assert.rejects(
        () =>
          f.service.transfer(other.id, {
            contaOrigemId: f.account.id,
            contaDestinoId: f.account2.id,
            dataEfetiva: "2026-11-01",
            valorCentavos: "1000",
            chaveIdempotencia: key(),
          }),
        code("NOT_FOUND"),
      );
      assert.deepEqual(await counts(f.db), before);
      assert.deepEqual(await f.service.list(other.id, "lancamentos"), []);
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: closed competence permits later cash settlement without mutating snapshot`, async () => {
    const f = await fixture(engine);
    try {
      const e = await f.entry("80000");
      const closure = await f.service.closePeriod(f.company.id, {
        mes: "2026-10",
      });
      const snapshot = structuredClone(closure.snapshot);
      await assert.rejects(
        () => f.settle(e.id, "80000"),
        code("PERIODO_FECHADO"),
      );
      await f.settle(e.id, "80000", { dataEfetiva: "2026-11-03" });
      const [saved] = await f.service.list(f.company.id, "fechamentos");
      assert.deepEqual(saved.snapshot, snapshot);
      assert.equal(
        (await f.service.summary(f.company.id, "2026-11")).saidasCentavos,
        "80000",
      );
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: estimated entry cannot settle and net cash reversal does not inflate receipts`, async () => {
    const f = await fixture(engine);
    try {
      const estimated = await f.entry("20000", { confirmado: false });
      const before = await counts(f.db);
      await assert.rejects(() => f.settle(estimated.id, "20000"));
      assert.deepEqual(await counts(f.db), before);
      const e = await f.entry("20000");
      const movement = await f.settle(e.id, "20000");
      await f.service.reverse(f.company.id, movement.id, {
        motivo: "Pagamento incorreto",
        dataEfetiva: "2026-10-22",
        chaveIdempotencia: key(),
      });
      const summary = await f.service.summary(f.company.id, "2026-10");
      assert.equal(summary.entradasCentavos, "0");
      assert.equal(summary.saidasCentavos, "0");
      await f.service.cancel(f.company.id, e.id, {
        motivo: "Lançamento duplicado",
      });
      assert.equal(
        (await f.service.getEntry(f.company.id, e.id)).situacao,
        "CANCELADO",
      );
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: concurrent recurrence generation is idempotent and skips closed periods`, async () => {
    const f = await fixture(engine);
    try {
      const r = await f.service.createRecurrence(f.company.id, {
        tipo: "DESPESA",
        descricao: "Aluguel recorrente",
        categoriaId: f.expense.id,
        valorCentavos: "10000",
        confirmado: false,
        ancora: "2026-10-01",
        inicio: "2026-10-01",
        regra: {
          frequencia: "MES",
          intervalo: 1,
          dia_mes: 1,
          ajuste_fds: "MANTER",
        },
        excecoes: [],
      });
      const window = { de: "2026-10-01", ate: "2026-12-29" };
      const race = racePreparedWrites(f.db, 3);
      await Promise.all([
        f.service.generate(f.company.id, window),
        f.service.generate(f.company.id, window),
        f.service.generate(f.company.id, window),
      ]);
      race.restore();
      let entries = await f.service.list(f.company.id, "lancamentos");
      assert.equal(entries.length, 3);
      assert.equal(new Set(entries.map((e: any) => e.ocorrencia)).size, 3);
      assert.ok(entries.every((e: any) => e.recorrenciaId === r.id));
      assert.equal((await f.service.generate(f.company.id, window)).gerados, 0);
      await f.service.closePeriod(f.company.id, { mes: "2027-01" });
      await f.service.generate(f.company.id, {
        de: "2027-01-01",
        ate: "2027-03-31",
      });
      entries = await f.service.list(f.company.id, "lancamentos");
      assert.equal(
        entries.filter((e: any) => e.competencia.startsWith("2027-01")).length,
        0,
      );
      assert.equal(
        (await f.service.list(f.company.id, "movimentos")).length,
        0,
      );
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: recurrence future edits replace unpaid occurrences without deleting paid history`, async () => {
    const f = await fixture(engine);
    try {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 1);
      const date = (offset: number) => {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + offset);
        return d.toISOString().slice(0, 10);
      };
      const r = await f.service.createRecurrence(f.company.id, {
        tipo: "DESPESA",
        descricao: "Serviço diário",
        categoriaId: f.expense.id,
        valorCentavos: "1000",
        confirmado: true,
        ancora: date(0),
        inicio: date(0),
        regra: { frequencia: "DIA", intervalo: 1, ajuste_fds: "MANTER" },
        excecoes: [],
      });
      const window = { de: date(0), ate: date(2) };
      await f.service.generate(f.company.id, window);
      const entries = await f.service.list(f.company.id, "lancamentos");
      const paid = entries.find((e: any) => e.ocorrencia === date(1));
      await f.service.updateEntry(f.company.id, paid.id, { confirmado: true });
      await f.settle(paid.id, "1000", { dataEfetiva: date(1) });
      await f.service.updateRecurrence(f.company.id, r.id, {
        valorCentavos: "2000",
        escopo: "FUTURAS",
      });
      await f.service.generate(f.company.id, window);
      const updated = await f.service.list(f.company.id, "lancamentos");
      const active = updated.filter((e: any) => !e.cancelado);
      assert.equal(active.length, 3);
      assert.equal(
        active.find((e: any) => e.ocorrencia === date(0)).valorCentavos,
        "2000",
      );
      assert.equal(
        active.find((e: any) => e.ocorrencia === date(2)).valorCentavos,
        "2000",
      );
      const preserved = active.find((e: any) => e.id === paid.id);
      assert.equal(preserved.valorCentavos, "1000");
      assert.equal(preserved.liquidadoCentavos, "1000");
      assert.equal(
        (await f.service.list(f.company.id, "movimentos")).length,
        1,
      );
      assert.equal((await f.service.generate(f.company.id, window)).gerados, 0);
    } finally {
      await f.db.close();
    }
  });

  test(`${engine}: numeric acceptance preserves cents, competence, cash and transfer neutrality`, async () => {
    const f = await fixture(engine);
    try {
      await f.entry("5500000", {
        tipo: "RECEITA",
        categoriaId: f.revenue.id,
        liquidacao: {
          contaId: f.account.id,
          dataEfetiva: "2026-10-15",
          valorCentavos: "5500000",
        },
      });
      await f.entry("2000000", {
        liquidacao: {
          contaId: f.account.id,
          dataEfetiva: "2026-10-15",
          valorCentavos: "2000000",
        },
      });
      await f.service.transfer(f.company.id, {
        contaOrigemId: f.account.id,
        contaDestinoId: f.account2.id,
        dataEfetiva: "2026-10-15",
        valorCentavos: "800000",
        chaveIdempotencia: key(),
      });
      const late = await f.entry("30000");
      await f.settle(late.id, "30000", { dataEfetiva: "2026-11-04" });
      const october = await f.service.summary(f.company.id, "2026-10");
      assert.equal(october.entradasCentavos, "5500000");
      assert.equal(october.saidasCentavos, "2000000");
      assert.equal(october.resultadoCaixaCentavos, "3500000");
      assert.equal(october.saldoConsolidadoCentavos, "4500000");
      assert.equal(october.despesasCentavos, "2030000");
      const november = await f.service.summary(f.company.id, "2026-11");
      assert.equal(november.saidasCentavos, "30000");
      assert.equal(november.despesasCentavos, "0");
    } finally {
      await f.db.close();
    }
  });
}
