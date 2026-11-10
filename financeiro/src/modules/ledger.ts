import {
  createId,
  type PluginDatabase,
  type PluginContextV1,
} from "@nexus/plugin-sdk/backend";
import { assert } from "../errors.js";
import { money, amount, monthlyAverage } from "../domain/money.js";
import { today, addDays, civil, month, monthEnd } from "../domain/dates.js";
import {
  proximas,
  validarRegra,
  periodoAtual,
  type Regra,
  type Ocorrencia,
} from "../domain/recurrence.js";
import {
  type Entity,
  type Snapshot,
  type Resource,
  consistentRead,
} from "../db/repository.js";
import { withCompanyWrite } from "../db/write-unit.js";
import * as schemas from "../schemas.js";

type Input = Record<string, unknown>;
const now = () => new Date().toISOString();
const find = (s: Snapshot, r: Resource, id: string) => {
  const row = s.records[r].find((item) => item.id === id);
  assert(row, "NOT_FOUND", "Registro não encontrado nesta empresa.", 404);
  return row;
};
const push = (s: Snapshot, r: Resource, value: Input): Entity => {
  const row = {
    ...value,
    id: createId(r),
    empresaId: s.company.id,
    createdAt: now(),
  } as Entity;
  s.records[r].push(row);
  return row;
};
const value = (row: Entity) => money(row.valorCentavos);
const paid = (s: Snapshot, id: string) =>
  s.records.movimentos
    .filter((m) => m.lancamentoId === id && !m.estornoDeId && !m.estornado)
    .reduce((sum, m) => sum + value(m), 0n);
const entryView = (s: Snapshot, row: Entity): Entity => {
  const settled = paid(s, row.id);
  return {
    ...row,
    liquidadoCentavos: amount(settled),
    pendenteCentavos: amount(value(row) - settled),
    situacao: row.cancelado
      ? "CANCELADO"
      : settled === value(row)
        ? "LIQUIDADO"
        : settled > 0n
          ? "PARCIAL"
          : "ABERTO",
  };
};
function open(s: Snapshot, ...dates: string[]): void {
  for (const date of dates) {
    civil(date);
    assert(
      !s.records.fechamentos.some(
        (f) => String(f.mes) >= date.slice(0, 7) && f.status === "FECHADO",
      ),
      "PERIODO_FECHADO",
      "O período está fechado.",
      409,
    );
  }
}
function refs(s: Snapshot, input: Input): void {
  const category = find(s, "categorias", String(input.categoriaId));
  assert(
    category.ativo && category.tipo === input.tipo,
    "CATEGORIA_INVALIDA",
    "Categoria inativa ou de natureza incompatível.",
  );
  if (input.contaPrevistaId) {
    const account = find(s, "contas", String(input.contaPrevistaId));
    assert(account.ativo, "CONTA_INATIVA", "Conta inativa.");
  }
}
function balance(s: Snapshot, account: Entity, until = "9999-12-31"): bigint {
  let total =
    String(account.dataSaldoInicial) <= until
      ? money(account.saldoInicialCentavos, true)
      : 0n;
  for (const m of s.records.movimentos)
    if (m.contaId === account.id && String(m.dataEfetiva) <= until)
      total += value(m) * BigInt(Number(m.sinal));
  amount(total);
  return total;
}
function enforceBalances(s: Snapshot): void {
  for (const account of s.records.contas) {
    balance(s, account);
    let running = money(account.saldoInicialCentavos, true);
    for (const m of s.records.movimentos
      .filter((m) => m.contaId === account.id)
      .sort((a, b) =>
        String(a.dataEfetiva).localeCompare(String(b.dataEfetiva)),
      )) {
      running += value(m) * BigInt(Number(m.sinal));
      amount(running);
    }
  }
}
async function hash(input: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input)),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function idempotent<T>(
  s: Snapshot,
  key: string,
  input: unknown,
  run: () => T,
): Promise<T> {
  const fingerprint = await hash(input);
  const old = s.records.idempotencia.find((r) => r.chave === key);
  if (old) {
    assert(
      old.hash === fingerprint,
      "IDEMPOTENCY_CONFLICT",
      "Chave de idempotência já usada com outro conteúdo.",
      409,
    );
    return old.result as T;
  }
  const result = run();
  push(s, "idempotencia", { chave: key, hash: fingerprint, result });
  return result;
}
function settleIn(s: Snapshot, entry: Entity, input: Input): Entity {
  assert(
    !entry.cancelado,
    "LANCAMENTO_CANCELADO",
    "Lançamento cancelado.",
    409,
  );
  const account = find(s, "contas", String(input.contaId));
  assert(account.ativo, "CONTA_INATIVA", "Conta inativa.");
  assert(
    entry.confirmado === true,
    "VALOR_NAO_CONFIRMADO",
    "Confirme o valor do lançamento antes da baixa.",
    409,
  );
  open(s, String(input.dataEfetiva));
  assert(
    String(input.dataEfetiva) >= String(account.dataSaldoInicial),
    "DATA_ANTERIOR_SALDO",
    "Movimento anterior ao saldo inicial.",
  );
  const remaining = value(entry) - paid(s, entry.id);
  assert(
    money(input.valorCentavos) > 0n && money(input.valorCentavos) <= remaining,
    "SOBREPAGAMENTO",
    "Baixa excede o saldo pendente.",
    409,
  );
  const movement = push(s, "movimentos", {
    lancamentoId: entry.id,
    contaId: account.id,
    dataEfetiva: input.dataEfetiva,
    valorCentavos: input.valorCentavos,
    sinal: entry.tipo === "RECEITA" ? 1 : -1,
    estornado: false,
  });
  enforceBalances(s);
  return movement;
}
function createEntryIn(s: Snapshot, input: Input, extra: Input = {}): Entity {
  refs(s, input);
  open(s, String(input.competencia), String(input.vencimento));
  const { liquidacao, chaveIdempotencia, ...fields } = input;
  const entry = push(s, "lancamentos", {
    ...fields,
    ...extra,
    cancelado: false,
  });
  if (liquidacao) settleIn(s, entry, liquidacao as Input);
  return entry;
}
function occurrenceClosed(s: Snapshot, o: Ocorrencia): boolean {
  return s.records.fechamentos.some(
    (f) =>
      f.status === "FECHADO" &&
      (String(f.mes) >= o.dataNominal.slice(0, 7) ||
        String(f.mes) >= o.vencimento.slice(0, 7)),
  );
}
function occurrenceExists(
  s: Snapshot,
  recurrence: Entity,
  key: string,
): boolean {
  return s.records.lancamentos.some(
    (e) => e.recorrenciaId === recurrence.id && e.ocorrencia === key,
  );
}
function recurrenceOccurrences(
  r: Entity,
  de: string,
  ate: string,
  limite = 2000,
): Ocorrencia[] {
  return proximas(r.regra as Regra, String(r.ancora), {
    inicio: String(r.inicio),
    fim: r.fim ? String(r.fim) : null,
    de,
    ate,
    limite,
  }).filter((o) => !(r.excecoes as string[]).includes(o.chave));
}
function launchOccurrence(s: Snapshot, r: Entity, o: Ocorrencia): Entity {
  return createEntryIn(
    s,
    {
      descricao: r.descricao,
      tipo: r.tipo,
      valorCentavos: r.valorCentavos,
      categoriaId: r.categoriaId,
      contaPrevistaId: r.contaPrevistaId,
      observacao: r.observacao,
      contraparte: r.contraparte,
      confirmado: r.confirmado === true,
      competencia: o.dataNominal,
      vencimento: o.vencimento,
    },
    {
      recorrenciaId: r.id,
      ocorrencia: o.chave,
      recorrenciaVersao: r.versao,
      statusLancamento: "LANCADO",
    },
  );
}
function launchNext(s: Snapshot, r: Entity, date: string): Entity | null {
  const de = [date, String(r.inicio), String(r.ancora)].sort().at(-1)!;
  const year = Math.min(9999, Number(de.slice(0, 4)) + 8);
  // A fifth weekday may skip months; annual rules can have multi-year intervals.
  const rule = r.regra as Regra;
  const years = rule.frequencia === "ANO" ? rule.intervalo + 1 : 8;
  const ate = `${Math.min(9999, Math.max(year, Number(de.slice(0, 4)) + years))}-12-31`;
  const candidate = recurrenceOccurrences(r, de, ate).find(
    (o) => !occurrenceClosed(s, o),
  );
  if (!candidate || occurrenceExists(s, r, candidate.chave)) return null;
  return launchOccurrence(s, r, candidate);
}

export function summarize(s: Snapshot, mes: string): Input {
  month(mes);
  let receitas = 0n,
    despesas = 0n,
    entradas = 0n,
    saidas = 0n,
    receber = 0n,
    pagar = 0n,
    estimadasReceitas = 0n,
    estimadasDespesas = 0n;
  for (const e of s.records.lancamentos) {
    if (e.cancelado) continue;
    const pending = value(e) - paid(s, e.id);
    if (String(e.vencimento).slice(0, 7) === mes) {
      if (e.tipo === "RECEITA") receber += pending;
      else pagar += pending;
    }
    if (String(e.competencia).slice(0, 7) !== mes) continue;
    if (e.confirmado) {
      if (e.tipo === "RECEITA") receitas += value(e);
      else despesas += value(e);
    } else if (e.tipo === "RECEITA") estimadasReceitas += value(e);
    else estimadasDespesas += value(e);
  }
  for (const m of s.records.movimentos) {
    if (String(m.dataEfetiva).slice(0, 7) !== mes || m.transferenciaId)
      continue;
    const entry = find(s, "lancamentos", String(m.lancamentoId));
    const delta = m.estornoDeId ? -value(m) : value(m);
    if (entry.tipo === "RECEITA") entradas += delta;
    else saidas += delta;
  }
  const contas = s.records.contas.map((a) => ({
    id: a.id,
    nome: a.nome,
    saldoCentavos: amount(balance(s, a, `${mes}-31`)),
  }));
  return {
    mes,
    receitasCentavos: amount(receitas),
    despesasCentavos: amount(despesas),
    resultadoCompetenciaCentavos: amount(receitas - despesas),
    entradasCentavos: amount(entradas),
    saidasCentavos: amount(saidas),
    resultadoCaixaCentavos: amount(entradas - saidas),
    saldoConsolidadoCentavos: amount(
      contas.reduce((total, a) => total + money(a.saldoCentavos, true), 0n),
    ),
    pendenteReceberCentavos: amount(receber),
    pendentePagarCentavos: amount(pagar),
    estimadasReceitasCentavos: amount(estimadasReceitas),
    estimadasDespesasCentavos: amount(estimadasDespesas),
    contas,
  };
}
export class LedgerService {
  constructor(
    public readonly db: PluginDatabase,
    public readonly context: PluginContextV1,
  ) {}
  private write<T>(
    companyId: string,
    action: string,
    prepare: (s: Snapshot) => T | Promise<T>,
    allowInactive = false,
  ) {
    return withCompanyWrite(this.db, companyId, this.context, action, prepare, {
      allowInactive,
    });
  }
  async companies() {
    const rows = await this.db.query<Record<string, unknown>>(
      "SELECT id,nome,ativo,revision FROM financeiro_empresas ORDER BY nome,id",
    );
    return rows.map((row) => ({ ...row, ativo: Boolean(row.ativo) }));
  }
  async createCompany(input: unknown) {
    const parsed = schemas.companySchema.parse(input);
    const id = createId("empresa"),
      at = now();
    await this.db.atomic([
      {
        sql: "INSERT INTO financeiro_empresas (id,nome,ativo,revision,created_at,updated_at) VALUES (?,?,?,0,?,?)",
        params: [id, parsed.nome, parsed.ativo === false ? 0 : 1, at, at],
      },
      {
        sql: "INSERT INTO financeiro_auditoria (id,empresa_id,user_id,request_id,action,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
        params: [
          createId("audit"),
          id,
          this.context.userId,
          this.context.requestId,
          "empresas.create",
          "{}",
          JSON.stringify(parsed),
          at,
        ],
      },
    ]);
    return { id, ...parsed, ativo: parsed.ativo ?? true };
  }
  updateCompany(id: string, input: unknown) {
    const parsed = schemas.companySchema.partial().parse(input);
    return this.write(
      id,
      "empresas.update",
      (s) => {
        if (parsed.nome !== undefined) s.company.nome = parsed.nome;
        if (parsed.ativo !== undefined) s.company.ativo = parsed.ativo ? 1 : 0;
        return { ...s.company, ativo: s.company.ativo === 1 };
      },
      true,
    );
  }
  list(companyId: string, resource: Resource) {
    return consistentRead(
      this.db,
      companyId,
      (s) =>
        s.records[resource]
          .filter(
            (r) => resource !== "visoes" || r.userId === this.context.userId,
          )
          .map((r) =>
            resource === "lancamentos"
              ? entryView(s, r)
              : resource === "contas"
                ? { ...r, saldoCentavos: amount(balance(s, r)) }
                : r,
          ),
      resource === "lancamentos" || resource === "contas"
        ? [resource, "movimentos"]
        : [resource],
    );
  }
  getEntry(companyId: string, id: string) {
    return consistentRead(
      this.db,
      companyId,
      (s) => ({
        ...entryView(s, find(s, "lancamentos", id)),
        movimentos: s.records.movimentos.filter((m) => m.lancamentoId === id),
        anexos: s.records.anexos.filter((a) => a.lancamentoId === id),
      }),
      ["lancamentos", "movimentos", "anexos"],
    );
  }
  createAccount(companyId: string, input: unknown) {
    const parsed = schemas.accountSchema.parse(input);
    return this.write(companyId, "contas.create", (s) => {
      open(s, String(parsed.dataSaldoInicial));
      return push(s, "contas", parsed);
    });
  }
  createCategory(companyId: string, input: unknown) {
    const parsed = schemas.categorySchema.parse(input);
    return this.write(companyId, "categorias.create", (s) =>
      push(s, "categorias", parsed),
    );
  }
  updateCatalog(
    companyId: string,
    resource: "contas" | "categorias",
    id: string,
    input: unknown,
  ) {
    const parsed: Input = (
      resource === "contas"
        ? schemas.accountUpdateSchema
        : schemas.categoryUpdateSchema
    ).parse(input);
    return this.write(companyId, `${resource}.update`, (s) => {
      const row = find(s, resource, id);
      if (
        resource === "contas" &&
        s.records.movimentos.some((m) => m.contaId === id)
      )
        assert(
          parsed.saldoInicialCentavos === undefined &&
            parsed.dataSaldoInicial === undefined,
          "SALDO_IMUTAVEL",
          "Saldo inicial não pode mudar após movimentos.",
          409,
        );
      if (resource === "categorias" && parsed.tipo && parsed.tipo !== row.tipo)
        assert(
          !s.records.lancamentos.some((e) => e.categoriaId === id) &&
            !s.records.recorrencias.some((e) => e.categoriaId === id),
          "NATUREZA_IMUTAVEL",
          "Categoria utilizada não pode mudar de natureza.",
          409,
        );
      if (
        resource === "contas" &&
        (parsed.saldoInicialCentavos !== undefined ||
          parsed.dataSaldoInicial !== undefined)
      ) {
        open(s, String(row.dataSaldoInicial));
        if (parsed.dataSaldoInicial) open(s, String(parsed.dataSaldoInicial));
      }
      Object.assign(row, parsed);
      enforceBalances(s);
      return row;
    });
  }
  createEntry(companyId: string, input: unknown) {
    const parsed = schemas.entrySchema.parse(input);
    assert(
      !parsed.liquidacao || parsed.chaveIdempotencia,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Cadastro liquidado exige chaveIdempotencia.",
    );
    return this.write(companyId, "lancamentos.create", (s) =>
      parsed.chaveIdempotencia
        ? idempotent(
            s,
            parsed.chaveIdempotencia,
            { action: "lancamento", ...parsed },
            () => entryView(s, createEntryIn(s, parsed)),
          )
        : entryView(s, createEntryIn(s, parsed)),
    );
  }
  updateEntry(companyId: string, id: string, input: unknown) {
    const parsed = schemas.entryUpdateSchema.parse(input);
    return this.write(companyId, "lancamentos.update", (s) => {
      const row = find(s, "lancamentos", id);
      assert(
        !row.cancelado,
        "LANCAMENTO_CANCELADO",
        "Lançamento cancelado.",
        409,
      );
      open(s, String(row.competencia), String(row.vencimento));
      assert(
        paid(s, id) === 0n,
        "LANCAMENTO_LIQUIDADO",
        "Estorne as baixas antes de editar.",
        409,
      );
      const next = { ...row, ...parsed };
      refs(s, next);
      open(s, String(next.competencia), String(next.vencimento));
      Object.assign(row, parsed, { alteradoManualmente: true });
      return entryView(s, row);
    });
  }
  cancel(companyId: string, id: string, input: unknown) {
    const parsed = schemas.reasonSchema.parse(input);
    return this.write(companyId, "lancamentos.cancel", (s) => {
      const row = find(s, "lancamentos", id);
      open(s, String(row.competencia), String(row.vencimento));
      assert(
        !row.cancelado && paid(s, id) === 0n,
        "CANCELAMENTO_INVALIDO",
        "Lançamento cancelado ou com baixas ativas.",
        409,
      );
      Object.assign(row, {
        cancelado: true,
        motivoCancelamento: parsed.motivo,
      });
      return entryView(s, row);
    });
  }
  settle(companyId: string, id: string, input: unknown) {
    const parsed = schemas.settlementSchema.parse(input);
    return this.write(companyId, "movimentos.create", (s) =>
      idempotent(
        s,
        parsed.chaveIdempotencia,
        { action: "baixa", id, ...parsed },
        () => settleIn(s, find(s, "lancamentos", id), parsed),
      ),
    );
  }
  reverse(companyId: string, id: string, input: unknown) {
    const parsed = schemas.reversalSchema.parse(input);
    return this.write(companyId, "movimentos.reverse", (s) =>
      idempotent(
        s,
        parsed.chaveIdempotencia,
        { action: "estorno", id, ...parsed },
        () => {
          const movement = find(s, "movimentos", id);
          assert(
            !movement.estornado &&
              !movement.estornoDeId &&
              !movement.transferenciaId,
            "ESTORNO_INVALIDO",
            "Movimento já estornado ou transferência. Estorno de transferência exige operação própria.",
            409,
          );
          const entry = find(s, "lancamentos", String(movement.lancamentoId));
          open(s, parsed.dataEfetiva);
          assert(
            parsed.dataEfetiva >= String(movement.dataEfetiva),
            "DATA_ESTORNO_INVALIDA",
            "Estorno não pode anteceder o movimento.",
          );
          movement.estornado = true;
          const reversal = push(s, "movimentos", {
            lancamentoId: movement.lancamentoId,
            contaId: movement.contaId,
            dataEfetiva: parsed.dataEfetiva,
            valorCentavos: movement.valorCentavos,
            sinal: -Number(movement.sinal),
            estornoDeId: id,
            estornado: false,
            motivo: parsed.motivo,
          });
          enforceBalances(s);
          return reversal;
        },
      ),
    );
  }
  transfer(companyId: string, input: unknown) {
    const parsed = schemas.transferSchema.parse(input);
    return this.write(companyId, "transferencias.create", (s) =>
      idempotent(
        s,
        parsed.chaveIdempotencia,
        { action: "transferencia", ...parsed },
        () => {
          assert(
            parsed.contaOrigemId !== parsed.contaDestinoId,
            "CONTAS_IGUAIS",
            "Selecione contas distintas.",
          );
          open(s, parsed.dataEfetiva);
          for (const id of [parsed.contaOrigemId, parsed.contaDestinoId]) {
            const a = find(s, "contas", id);
            assert(a.ativo, "CONTA_INATIVA", "Conta inativa.");
            assert(
              parsed.dataEfetiva >= String(a.dataSaldoInicial),
              "DATA_ANTERIOR_SALDO",
              "Transferência anterior ao saldo inicial.",
            );
          }
          const transfer = push(s, "transferencias", parsed);
          for (const [contaId, sinal] of [
            [parsed.contaOrigemId, -1],
            [parsed.contaDestinoId, 1],
          ] as const)
            push(s, "movimentos", {
              transferenciaId: transfer.id,
              contaId,
              sinal,
              dataEfetiva: parsed.dataEfetiva,
              valorCentavos: parsed.valorCentavos,
              estornado: false,
            });
          enforceBalances(s);
          return transfer;
        },
      ),
    );
  }
  reverseTransfer(companyId: string, id: string, input: unknown) {
    const parsed = schemas.reversalSchema.parse(input);
    return this.write(companyId, "transferencias.reverse", (s) =>
      idempotent(
        s,
        parsed.chaveIdempotencia,
        { action: "estornoTransferencia", id, ...parsed },
        () => {
          const transfer = find(s, "transferencias", id);
          assert(
            !transfer.estornado,
            "ESTORNO_INVALIDO",
            "Transferência já estornada.",
            409,
          );
          open(s, parsed.dataEfetiva);
          assert(
            parsed.dataEfetiva >= String(transfer.dataEfetiva),
            "DATA_ESTORNO_INVALIDA",
            "Estorno não pode anteceder a transferência.",
          );
          const originals = s.records.movimentos.filter(
            (m) => m.transferenciaId === id && !m.estornoDeId,
          );
          assert(
            originals.length === 2,
            "TRANSFERENCIA_INVALIDA",
            "Transferência sem par de movimentos.",
            409,
          );
          for (const movement of originals) {
            assert(
              !movement.estornado,
              "ESTORNO_INVALIDO",
              "Movimento já estornado.",
              409,
            );
            movement.estornado = true;
            push(s, "movimentos", {
              transferenciaId: id,
              contaId: movement.contaId,
              dataEfetiva: parsed.dataEfetiva,
              valorCentavos: movement.valorCentavos,
              sinal: -Number(movement.sinal),
              estornoDeId: movement.id,
              estornado: false,
              motivo: parsed.motivo,
            });
          }
          Object.assign(transfer, {
            estornado: true,
            motivoEstorno: parsed.motivo,
            dataEstorno: parsed.dataEfetiva,
          });
          enforceBalances(s);
          return transfer;
        },
      ),
    );
  }
  summary(companyId: string, mes: string) {
    return consistentRead(this.db, companyId, (s) => summarize(s, mes));
  }
  closePeriod(companyId: string, input: unknown) {
    const { mes } = schemas.generateSchema
      .pick({})
      .extend({ mes: schemas.monthSchema })
      .strict()
      .parse(input);
    return this.write(companyId, "fechamentos.close", (s) => {
      assert(
        !s.records.fechamentos.some(
          (f) => f.mes === mes && f.status === "FECHADO",
        ),
        "PERIODO_FECHADO",
        "Período já fechado.",
        409,
      );
      const versao =
        1 +
        Math.max(
          0,
          ...s.records.fechamentos
            .filter((f) => f.mes === mes)
            .map((f) => Number(f.versao)),
        );
      return push(s, "fechamentos", {
        mes,
        versao,
        status: "FECHADO",
        snapshot: summarize(s, mes),
        closedBy: this.context.userId,
      });
    });
  }
  reopen(companyId: string, id: string, input: unknown) {
    const parsed = schemas.reasonSchema.parse(input);
    return this.write(companyId, "fechamentos.reopen", (s) => {
      const closure = find(s, "fechamentos", id);
      assert(
        closure.status === "FECHADO",
        "PERIODO_ABERTO",
        "Período não está fechado.",
        409,
      );
      assert(
        !s.records.fechamentos.some(
          (f) => f.status === "FECHADO" && String(f.mes) > String(closure.mes),
        ),
        "PERIODO_POSTERIOR_FECHADO",
        "Reabra primeiro os períodos posteriores.",
        409,
      );
      closure.status = "REABERTO";
      closure.reabertura = {
        motivo: parsed.motivo,
        userId: this.context.userId,
        at: now(),
      };
      return closure;
    });
  }
  createRecurrence(companyId: string, input: unknown) {
    const parsed = schemas.recurrenceSchema.parse(input);
    validarRegra(parsed.regra);
    assert(
      !parsed.fim || parsed.fim >= parsed.inicio,
      "REGRA_INVALIDA",
      "Fim anterior ao início.",
    );
    return this.write(companyId, "recorrencias.create", (s) => {
      refs(s, parsed);
      const recurrence = push(s, "recorrencias", {
        ...parsed,
        status: "ATIVA",
        versao: 1,
        geracaoAte: today(),
        automacaoInicio: today(),
      });
      launchNext(s, recurrence, today());
      return recurrence;
    });
  }
  preview(input: unknown) {
    const parsed = schemas.recurrenceSchema
      .extend({ de: schemas.date.optional(), ate: schemas.date.optional() })
      .parse(input);
    const de = parsed.de ?? today(),
      ate = parsed.ate ?? addDays(de, 89);
    assert(
      ate >= de && ate <= addDays(de, 89),
      "JANELA_INVALIDA",
      "A janela máxima é de 90 dias.",
    );
    return proximas(parsed.regra, parsed.ancora, {
      inicio: parsed.inicio,
      fim: parsed.fim,
      de,
      ate,
      limite: 90,
    }).filter((o) => !parsed.excecoes.includes(o.chave));
  }
  updateRecurrence(companyId: string, id: string, input: unknown) {
    const parsed = schemas.recurrenceUpdate.parse(input);
    return this.write(companyId, "recorrencias.update", (s) => {
      const r = find(s, "recorrencias", id);
      assert(
        r.status !== "ENCERRADA",
        "RECORRENCIA_ENCERRADA",
        "Recorrência encerrada.",
        409,
      );
      const { escopo, ...changes } = parsed;
      const next = { ...r, ...changes };
      refs(s, next);
      validarRegra(next.regra as Regra);
      assert(
        !next.fim || String(next.fim) >= String(next.inicio),
        "REGRA_INVALIDA",
        "Fim anterior ao início.",
      );
      Object.assign(r, changes, { versao: Number(r.versao) + 1 });
      for (const e of s.records.lancamentos.filter(
        (e) =>
          e.recorrenciaId === id &&
          String(e.ocorrencia) >= today() &&
          !e.cancelado &&
          !e.alteradoManualmente &&
          paid(s, e.id) === 0n,
      )) {
        if (
          s.records.fechamentos.some(
            (f) =>
              f.status === "FECHADO" &&
              (String(f.mes) >= String(e.competencia).slice(0, 7) ||
                String(f.mes) >= String(e.vencimento).slice(0, 7)),
          )
        )
          continue;
        if (r.status === "ENCERRADA") {
          e.cancelado = true;
          e.motivoCancelamento = "Recorrência encerrada.";
          continue;
        }
        if (r.status === "PAUSADA") continue;
        const occurrences = proximas(r.regra as Regra, String(r.ancora), {
          inicio: String(r.inicio),
          fim: r.fim ? String(r.fim) : null,
          de: String(e.ocorrencia),
          ate: String(e.ocorrencia),
          limite: 1,
        });
        const occurrence = occurrences.find((o) => o.chave === e.ocorrencia);
        if (
          !occurrence ||
          (r.excecoes as string[]).includes(String(e.ocorrencia))
        ) {
          e.cancelado = true;
          e.motivoCancelamento = "Ocorrência removida pela edição da regra.";
          continue;
        }
        open(s, occurrence.dataNominal, occurrence.vencimento);
        Object.assign(e, {
          descricao: r.descricao,
          tipo: r.tipo,
          valorCentavos: r.valorCentavos,
          categoriaId: r.categoriaId,
          contaPrevistaId: r.contaPrevistaId,
          observacao: r.observacao,
          contraparte: r.contraparte,
          confirmado: r.confirmado === true,
          competencia: occurrence.dataNominal,
          vencimento: occurrence.vencimento,
          recorrenciaVersao: r.versao,
        });
      }
      if (r.status === "ATIVA") launchNext(s, r, today());
      return r;
    });
  }
  recurrenceSummary(companyId: string, mes: string) {
    month(mes);
    return consistentRead(
      this.db,
      companyId,
      (s) => {
        let receitas = 0n,
          despesas = 0n,
          receitasCadastradas = 0n,
          despesasCadastradas = 0n,
          receitasOcorrencias = 0,
          despesasOcorrencias = 0;
        for (const r of s.records.recorrencias.filter(
          (r) => r.status === "ATIVA",
        )) {
          if (r.tipo === "RECEITA") receitasCadastradas += value(r);
          else despesasCadastradas += value(r);
          const projected = new Map(
            recurrenceOccurrences(r, `${mes}-01`, monthEnd(mes)).map((o) => [
              o.chave,
              value(r),
            ]),
          );
          for (const entry of s.records.lancamentos.filter(
            (e) =>
              e.recorrenciaId === r.id && String(e.competencia).startsWith(mes),
          )) {
            if (entry.cancelado) projected.delete(String(entry.ocorrencia));
            else projected.set(String(entry.ocorrencia), value(entry));
          }
          for (const cents of projected.values()) {
            if (r.tipo === "RECEITA") {
              receitas += cents;
              receitasOcorrencias++;
            } else {
              despesas += cents;
              despesasOcorrencias++;
            }
          }
        }
        return {
          mes,
          receitasCentavos: amount(receitas),
          despesasCentavos: amount(despesas),
          mediaMensalReceitasCentavos: monthlyAverage(
            s.records.recorrencias
              .filter((r) => r.status === "ATIVA" && r.tipo === "RECEITA")
              .map((r) => ({
                cents: value(r),
                frequency: (r.regra as Regra).frequencia,
                interval: (r.regra as Regra).intervalo,
              })),
          ),
          mediaMensalDespesasCentavos: monthlyAverage(
            s.records.recorrencias
              .filter((r) => r.status === "ATIVA" && r.tipo === "DESPESA")
              .map((r) => ({
                cents: value(r),
                frequency: (r.regra as Regra).frequencia,
                interval: (r.regra as Regra).intervalo,
              })),
          ),
          receitasCadastradasCentavos: amount(receitasCadastradas),
          despesasCadastradasCentavos: amount(despesasCadastradas),
          receitasOcorrencias,
          despesasOcorrencias,
        };
      },
      ["recorrencias", "lancamentos"],
    );
  }
  generateAutomatic(companyId: string, date = today()) {
    civil(date);
    return this.write(companyId, "recorrencias.generate", (s) => {
      let generated = 0,
        remaining = 0;
      for (const r of s.records.recorrencias.filter(
        (r) => r.status === "ATIVA",
      )) {
        const category = s.records.categorias.find(
          (c) => c.id === r.categoriaId,
        );
        const account = r.contaPrevistaId
          ? s.records.contas.find((a) => a.id === r.contaPrevistaId)
          : null;
        if (!category?.ativo || (r.contaPrevistaId && !account?.ativo))
          continue;
        const period = periodoAtual(r.regra as Regra, date);
        const cursor =
          typeof r.geracaoAte === "string" ? r.geracaoAte : period.de;
        const initial =
          typeof r.automacaoInicio === "string" ? r.automacaoInicio : period.de;
        const start = cursor < period.de ? cursor : period.de;
        const de = initial > start ? initial : start;
        const ate =
          addDays(de, 365) < period.ate ? addDays(de, 365) : period.ate;
        const occurrences = de <= ate ? recurrenceOccurrences(r, de, ate) : [];
        let complete = true;
        for (const occurrence of occurrences) {
          if (
            occurrenceExists(s, r, occurrence.chave) ||
            occurrenceClosed(s, occurrence)
          )
            continue;
          if (generated >= 20) {
            remaining++;
            complete = false;
            continue;
          }
          launchOccurrence(s, r, occurrence);
          generated++;
        }
        if (complete && de <= ate && r.geracaoAte !== ate) r.geracaoAte = ate;
      }
      return {
        gerados: generated,
        restantes: remaining,
        concluido: remaining === 0,
      };
    });
  }
  generate(companyId: string, input: unknown) {
    const parsed = schemas.generateSchema.parse(input);
    const de = parsed.de ?? today(),
      ate = parsed.ate ?? addDays(de, 89);
    assert(
      ate >= de && ate <= addDays(de, 89),
      "JANELA_INVALIDA",
      "A janela máxima é de 90 dias.",
    );
    return this.write(companyId, "recorrencias.generate", (s) => {
      let generated = 0,
        skipped = 0,
        remaining = 0;
      for (const r of s.records.recorrencias.filter(
        (r) => r.status === "ATIVA",
      )) {
        refs(s, r);
        for (const o of proximas(r.regra as Regra, String(r.ancora), {
          inicio: String(r.inicio),
          fim: r.fim ? String(r.fim) : null,
          de,
          ate,
          limite: 90,
        })) {
          if ((r.excecoes as string[]).includes(o.chave)) continue;
          const old = s.records.lancamentos.find(
            (e) => e.recorrenciaId === r.id && e.ocorrencia === o.chave,
          );
          if (old) {
            skipped++;
            continue;
          }
          if (
            s.records.fechamentos.some(
              (f) =>
                f.status === "FECHADO" &&
                (String(f.mes) >= o.dataNominal.slice(0, 7) ||
                  String(f.mes) >= o.vencimento.slice(0, 7)),
            )
          ) {
            skipped++;
            continue;
          }
          if (generated >= 20) {
            remaining++;
            continue;
          }
          createEntryIn(
            s,
            {
              descricao: r.descricao,
              tipo: r.tipo,
              valorCentavos: r.valorCentavos,
              categoriaId: r.categoriaId,
              contaPrevistaId: r.contaPrevistaId,
              observacao: r.observacao,
              contraparte: r.contraparte,
              confirmado: r.confirmado === true,
              competencia: o.dataNominal,
              vencimento: o.vencimento,
            },
            {
              recorrenciaId: r.id,
              ocorrencia: o.chave,
              recorrenciaVersao: r.versao,
              statusLancamento: "LANCADO",
            },
          );
          generated++;
        }
      }
      return {
        gerados: generated,
        ignorados: skipped,
        restantes: remaining,
        concluido: remaining === 0,
        de,
        ate,
      };
    });
  }
  createView(companyId: string, input: unknown) {
    const parsed = schemas.viewSchema.parse(input);
    return this.write(companyId, "visoes.create", (s) =>
      push(s, "visoes", { ...parsed, userId: this.context.userId }),
    );
  }
  deleteView(companyId: string, id: string) {
    return this.write(companyId, "visoes.delete", (s) => {
      const r = find(s, "visoes", id);
      assert(
        r.userId === this.context.userId,
        "FORBIDDEN",
        "Visão pertence a outro usuário.",
        403,
      );
      s.records.visoes = s.records.visoes.filter((r) => r.id !== id);
      return { id };
    });
  }
  addAttachment(companyId: string, lancamentoId: string, metadata: Input) {
    return this.write(companyId, "anexos.create", (s) => {
      const e = find(s, "lancamentos", lancamentoId);
      open(s, String(e.competencia));
      return push(s, "anexos", { ...metadata, lancamentoId });
    });
  }
  deleteAttachment(companyId: string, id: string) {
    return this.write(companyId, "anexos.delete", (s) => {
      const r = find(s, "anexos", id);
      const e = find(s, "lancamentos", String(r.lancamentoId));
      open(s, String(e.competencia));
      s.records.anexos = s.records.anexos.filter((a) => a.id !== id);
      return r;
    });
  }
  configureNotices(companyId: string, input: unknown) {
    const parsed = schemas.noticeSchema.parse(input);
    return this.write(companyId, "avisos.manage", (s) => {
      let row = s.records.avisos[0];
      if (!row)
        row = push(s, "avisos", { ...parsed, userId: this.context.userId });
      else Object.assign(row, parsed, { userId: this.context.userId });
      return row;
    });
  }
}
