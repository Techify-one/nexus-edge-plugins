import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  engines,
  openDatabase,
  pluginRoot,
  loadBackend,
} from "./integration/harness.ts";

for (const engine of engines) {
  test(`${engine}: recurrence saves the next yearly occurrence beyond 90 days, open and unpaid`, async () => {
    const db = await openDatabase(engine);
    try {
      const { LedgerService } = await loadBackend();
      const service = new LedgerService(db, {
        userId: "recurrence-test",
        requestId: "recurrence-test",
        permissions: [],
      });
      const { today } = await import(
        pathToFileURL(resolve(pluginRoot, "src/domain/dates.ts")).href
      );
      const year = Number(today().slice(0, 4)) + 1;
      const company = await service.createCompany({ nome: "Yearly isolated" });
      const category = await service.createCategory(company.id, {
        nome: "Annual fee",
        tipo: "DESPESA",
      });
      const recurrence = await service.createRecurrence(company.id, {
        descricao: "Annual fee",
        tipo: "DESPESA",
        valorCentavos: "12345",
        categoriaId: category.id,
        ancora: `${year}-09-15`,
        inicio: `${year}-09-15`,
        regra: { frequencia: "ANO", intervalo: 1, ajuste_fds: "MANTER" },
      });
      let entries = await service.list(company.id, "lancamentos");
      assert.equal(entries.length, 1);
      assert.equal(entries[0].vencimento, `${year}-09-15`);
      assert.equal(entries[0].recorrenciaId, recurrence.id);
      assert.equal(entries[0].statusLancamento, "LANCADO");
      assert.equal(entries[0].situacao, "ABERTO");
      assert.equal((await service.list(company.id, "movimentos")).length, 0);
      await service.generateAutomatic(company.id, `${year}-01-01`);
      entries = await service.list(company.id, "lancamentos");
      assert.equal(entries.length, 1);
      await service.generateAutomatic(company.id, `${year + 1}-01-01`);
      entries = await service.list(company.id, "lancamentos");
      assert.equal(entries.length, 2);
      assert.ok(entries.some((e) => e.vencimento === `${year + 1}-09-15`));
      await service.generateAutomatic(company.id, `${year + 1}-01-01`);
      assert.equal((await service.list(company.id, "lancamentos")).length, 2);
    } finally {
      await db.close();
    }
  });
  test(`${engine}: monthly totals count all weekly occurrences and yearly/monthly rules without paying them`, async () => {
    const db = await openDatabase(engine);
    try {
      const { LedgerService } = await loadBackend();
      const service = new LedgerService(db, {
        userId: "recurrence-test",
        requestId: "recurrence-test",
        permissions: [],
      });
      const company = await service.createCompany({ nome: "Totals isolated" });
      const expense = await service.createCategory(company.id, {
        nome: "Expense",
        tipo: "DESPESA",
      });
      const income = await service.createCategory(company.id, {
        nome: "Income",
        tipo: "RECEITA",
      });
      await service.createRecurrence(company.id, {
        descricao: "Weekly income",
        tipo: "RECEITA",
        valorCentavos: "10001",
        categoriaId: income.id,
        ancora: "2028-01-03",
        inicio: "2028-01-03",
        regra: { frequencia: "SEMANA", intervalo: 1, ajuste_fds: "MANTER" },
      });
      await service.createRecurrence(company.id, {
        descricao: "Monthly expense",
        tipo: "DESPESA",
        valorCentavos: "20000",
        categoriaId: expense.id,
        ancora: "2028-01-10",
        inicio: "2028-01-10",
        regra: {
          frequencia: "MES",
          intervalo: 1,
          dia_mes: 10,
          ajuste_fds: "MANTER",
        },
      });
      await service.createRecurrence(company.id, {
        descricao: "Annual expense",
        tipo: "DESPESA",
        valorCentavos: "30000",
        categoriaId: expense.id,
        ancora: "2028-01-15",
        inicio: "2028-01-15",
        regra: { frequencia: "ANO", intervalo: 1, ajuste_fds: "MANTER" },
      });
      const totals = await service.recurrenceSummary(company.id, "2028-01");
      assert.equal(totals.receitasCentavos, "50005");
      assert.equal(totals.receitasCadastradasCentavos, "10001");
      assert.equal(totals.despesasCadastradasCentavos, "50000");
      assert.equal(totals.despesasCentavos, "50000");
      assert.equal(totals.receitasOcorrencias, 5);
      assert.equal(totals.despesasOcorrencias, 2);
      await service.generateAutomatic(company.id, "2028-01-01");
      const entries = await service.list(company.id, "lancamentos");
      assert.equal(
        entries.filter((e) => e.competencia === "2028-01-10").length,
        1,
      );
      assert.equal(
        entries.filter((e) => e.competencia === "2028-01-15").length,
        1,
      );
      await service.generateAutomatic(company.id, "2028-01-10");
      assert.equal(
        (await service.list(company.id, "lancamentos")).filter(
          (e) => e.competencia === "2028-01-10",
        ).length,
        2,
      ); // one weekly income plus one monthly expense
      const feb = await service.recurrenceSummary(company.id, "2028-02");
      assert.equal(feb.receitasCentavos, "40004");
      assert.equal(feb.despesasCentavos, "20000");
      assert.equal((await service.list(company.id, "movimentos")).length, 0);
    } finally {
      await db.close();
    }
  });
  test(`${engine}: automatic period generation catches up outages and respects pause, cancellation and closed months`, async () => {
    const db = await openDatabase(engine);
    try {
      const { LedgerService } = await loadBackend();
      const service = new LedgerService(db, {
        userId: "recurrence-test",
        requestId: "recurrence-test",
        permissions: [],
      });
      const company = await service.createCompany({ nome: "Catchup isolated" });
      const category = await service.createCategory(company.id, {
        nome: "Monthly",
        tipo: "DESPESA",
      });
      const r = await service.createRecurrence(company.id, {
        descricao: "Monthly",
        tipo: "DESPESA",
        valorCentavos: "1000",
        categoriaId: category.id,
        ancora: "2028-01-05",
        inicio: "2028-01-05",
        regra: {
          frequencia: "MES",
          intervalo: 1,
          dia_mes: 5,
          ajuste_fds: "MANTER",
        },
      });
      await service.generateAutomatic(company.id, "2028-01-01");
      await service.generateAutomatic(company.id, "2028-04-01");
      let entries = await service.list(company.id, "lancamentos");
      for (const m of ["01", "02", "03", "04"])
        assert.equal(
          entries.filter((e) => e.competencia === `2028-${m}-05`).length,
          1,
        );
      const april = entries.find((e) => e.competencia === "2028-04-05");
      await service.cancel(company.id, april.id, {
        motivo: "Ocorrência cancelada pelo usuário",
      });
      await service.generateAutomatic(company.id, "2028-04-01");
      assert.equal(
        (await service.list(company.id, "lancamentos")).filter(
          (e) => e.competencia === "2028-04-05",
        ).length,
        1,
      );
      await service.updateRecurrence(company.id, r.id, { status: "PAUSADA" });
      await service.generateAutomatic(company.id, "2028-05-01");
      assert.equal(
        (await service.list(company.id, "lancamentos")).filter(
          (e) => e.competencia === "2028-05-05",
        ).length,
        0,
      );
      await service.updateRecurrence(company.id, r.id, { status: "ATIVA" });
      await service.closePeriod(company.id, { mes: "2028-05" });
      await service.generateAutomatic(company.id, "2028-06-01");
      entries = await service.list(company.id, "lancamentos");
      assert.equal(
        entries.filter((e) => e.competencia === "2028-06-05").length,
        1,
      );
      assert.equal((await service.list(company.id, "movimentos")).length, 0);
    } finally {
      await db.close();
    }
  });
}

for (const engine of engines) {
  test(`${engine}: monthly averages normalize active weekly monthly yearly and legacy intervals independently from selected month`, async () => {
    const db = await openDatabase(engine);
    try {
      const { LedgerService } = await loadBackend();
      const service = new LedgerService(db, {
        userId: "average-test",
        requestId: "average-test",
        permissions: [],
      });
      const company = await service.createCompany({
        nome: "Monthly average isolated",
      });
      const income = await service.createCategory(company.id, {
        nome: "Income",
        tipo: "RECEITA",
      });
      const expense = await service.createCategory(company.id, {
        nome: "Expense",
        tipo: "DESPESA",
      });
      const input = {
        descricao: "Average rule",
        ancora: "2028-02-15",
        inicio: "2028-02-15",
      };
      await service.createRecurrence(company.id, {
        ...input,
        tipo: "RECEITA",
        categoriaId: income.id,
        valorCentavos: "10000",
        regra: { frequencia: "SEMANA", intervalo: 1, ajuste_fds: "MANTER" },
      });
      await service.createRecurrence(company.id, {
        ...input,
        tipo: "RECEITA",
        categoriaId: income.id,
        valorCentavos: "240000",
        regra: { frequencia: "ANO", intervalo: 2, ajuste_fds: "MANTER" },
      });
      await service.createRecurrence(company.id, {
        ...input,
        tipo: "DESPESA",
        categoriaId: expense.id,
        valorCentavos: "30000",
        regra: { frequencia: "MES", intervalo: 1, ajuste_fds: "MANTER" },
      });
      const paused = await service.createRecurrence(company.id, {
        ...input,
        tipo: "DESPESA",
        categoriaId: expense.id,
        valorCentavos: "999999",
        regra: { frequencia: "MES", intervalo: 1, ajuste_fds: "MANTER" },
      });
      await service.updateRecurrence(company.id, paused.id, {
        status: "PAUSADA",
      });
      await service.createRecurrence(company.id, {
        ...input,
        tipo: "DESPESA",
        categoriaId: expense.id,
        valorCentavos: "120000",
        regra: { frequencia: "MES", intervalo: 12, ajuste_fds: "MANTER" },
      });
      for (const month of ["2028-02", "2028-03"]) {
        const result = await service.recurrenceSummary(company.id, month);
        assert.equal(result.mediaMensalReceitasCentavos, "50000");
        assert.equal(result.mediaMensalDespesasCentavos, "40000");
      }
      assert.equal((await service.list(company.id, "movimentos")).length, 0);
    } finally {
      await db.close();
    }
  });
}
