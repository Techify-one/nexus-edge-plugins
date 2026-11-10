import { useState, type FormEvent, type ReactNode } from "react";
import { Info, RefreshCw, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  DataValue,
  Input,
  MetricCard,
  Select,
  SingleLineFilterBar,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { Modal } from "../../.marketplace/frontend/src/components/ui/modal.js";
import type { ConfigurableColumn } from "../../.marketplace/frontend/src/components/ui/configurable-data-table.js";
import {
  ActionButton,
  Check,
  ConfirmOperation,
  ErrorBox,
  Field,
  Gate,
  RecordForm,
  Records,
  textColumn,
  type ConfirmAction,
  type FormResource,
} from "./components.js";
import { scoped, useFinance, useList, useResource } from "./context.js";
import {
  addDays,
  formatDate,
  formatMoney,
  moneySort,
  today,
} from "./format.js";
import type {
  Account,
  Attachment,
  Audit,
  Category,
  Closing,
  Company,
  Entry,
  List,
  Movement,
  Notice,
  Recurrence,
  Row,
  Single,
  Summary,
  Transfer,
  View,
} from "./types.js";
import type { MessageKey } from "./i18n.js";

const statusKey: Record<string, MessageKey> = {
  ABERTO: "financeiro.aberto",
  LANCADO: "financeiro.lancado",
  PARCIAL: "financeiro.parcial",
  LIQUIDADO: "financeiro.liquidado",
  CANCELADO: "financeiro.cancelado",
  FECHADO: "financeiro.fechado",
  REABERTO: "financeiro.reaberto",
  ATIVA: "financeiro.ativa",
  PAUSADA: "financeiro.pausada",
  ENCERRADA: "financeiro.encerrada",
};
function useColumns() {
  const { host, t } = useFinance();
  return {
    amount: <T extends Row>(
      key: string,
      label: MessageKey,
      tone: "accent" | "success" | "warning" | "info" = "accent",
    ): ConfigurableColumn<T> => ({
      ...textColumn<T>(key, t(label)),
      render: (row) =>
        typeof row[key] === "string" ? (
          <DataValue tone={tone}>
            {formatMoney(row[key] as string, host.locale)}
          </DataValue>
        ) : (
          ""
        ),
      sortValue: (row) => moneySort(String(row[key] ?? "0")),
    }),
    date: <T extends Row>(
      key: string,
      label: MessageKey,
    ): ConfigurableColumn<T> => ({
      ...textColumn<T>(key, t(label)),
      render: (row) =>
        row[key] ? formatDate(String(row[key]), host.locale) : "",
    }),
    status: <T extends Row>(key: string): ConfigurableColumn<T> =>
      textColumn<T>(key, t("financeiro.status"), (row) =>
        statusKey[String(row[key])]
          ? t(statusKey[String(row[key])]!)
          : String(row[key] ?? ""),
      ),
    type: <T extends Row>(): ConfigurableColumn<T> =>
      textColumn<T>("tipo", t("financeiro.tipo"), (row) =>
        t(
          row.tipo === "RECEITA"
            ? "financeiro.receita"
            : row.tipo === "DESPESA"
              ? "financeiro.despesa"
              : row.tipo === "BANCO"
                ? "financeiro.banco"
                : "financeiro.caixa",
        ),
      ),
  };
}
function PageActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {children}
    </div>
  );
}
export function SummaryPage() {
  const { api, empresaId, mes, host, t, can, refresh } = useFinance();
  const cols = useColumns();
  const [error, setError] = useState<unknown>(null);
  const state = useResource<Single<Summary>>(
    api,
    empresaId && can("resumo") ? scoped("/resumo", empresaId, { mes }) : null,
    refresh,
  );
  const download = async (regime: string) => {
    setError(null);
    try {
      await api.download(
        scoped("/relatorios/csv", empresaId, { mes, regime }),
        `financeiro-${mes}-${regime}.csv`,
      );
    } catch (cause) {
      setError(cause);
    }
  };
  const summary = state.data?.data;
  const metrics: [
    MessageKey,
    keyof Summary,
    "accent" | "success" | "warning" | "info",
  ][] = [
    ["financeiro.saldo", "saldoConsolidadoCentavos", "accent"],
    ["financeiro.recebido", "entradasCentavos", "success"],
    ["financeiro.pago", "saidasCentavos", "warning"],
    ["financeiro.resultadoCaixa", "resultadoCaixaCentavos", "info"],
    ["financeiro.receitasCompetencia", "receitasCentavos", "success"],
    ["financeiro.despesasCompetencia", "despesasCentavos", "warning"],
    ["financeiro.resultadoCompetencia", "resultadoCompetenciaCentavos", "info"],
    ["financeiro.aReceber", "pendenteReceberCentavos", "success"],
    ["financeiro.aPagar", "pendentePagarCentavos", "warning"],
  ];
  return (
    <Gate resource="resumo">
      <div className="space-y-3">
        <ErrorBox error={error || state.error} />
        {can("relatorios") && (
          <PageActions>
            <Button variant="secondary" onClick={() => void download("caixa")}>
              {t("financeiro.exportarCaixa")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void download("competencia")}
            >
              {t("financeiro.exportarCompetencia")}
            </Button>
          </PageActions>
        )}
        {summary ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metrics.map(([label, key, tone]) => (
                <MetricCard
                  key={key}
                  label={t(label)}
                  tone={tone}
                  value={formatMoney(String(summary[key]), host.locale)}
                />
              ))}
            </div>
            {(BigInt(summary.estimadasReceitasCentavos ?? "0") !== 0n ||
              BigInt(summary.estimadasDespesasCentavos ?? "0") !== 0n) && (
              <Card>
                <h2 className="font-semibold">{t("financeiro.estimado")}</h2>
                <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt>{t("financeiro.receita")}</dt>
                    <dd>
                      {formatMoney(
                        summary.estimadasReceitasCentavos ?? "0",
                        host.locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("financeiro.despesa")}</dt>
                    <dd>
                      {formatMoney(
                        summary.estimadasDespesasCentavos ?? "0",
                        host.locale,
                      )}
                    </dd>
                  </div>
                </dl>
              </Card>
            )}
            <p className="text-sm text-slate-500">
              {t("financeiro.resumoNota")}
            </p>
            <Records
              resource="saldos"
              state={{
                data: { data: summary.contas, total: summary.contas.length },
                loading: false,
                error: null,
              }}
              columns={[
                textColumn("nome", t("financeiro.conta")),
                cols.amount("saldoCentavos", "financeiro.saldo"),
              ]}
              onOpen={() => {}}
            />
          </>
        ) : (
          !state.error && (
            <Card role="status">
              {t(
                state.loading
                  ? "financeiro.carregando"
                  : "financeiro.semDadosResumo",
              )}
            </Card>
          )
        )}
      </div>
    </Gate>
  );
}

export function RegistersPage() {
  const { api, t, refresh, can, empresaId } = useFinance();
  const cols = useColumns();
  const [params, setParams] = useSearchParams();
  const selected = params.get("cadastro");
  const resource: "empresas" | "contas" | "categorias" =
    selected === "contas" || selected === "categorias" ? selected : "empresas";
  const [editing, setEditing] = useState<{
    resource: FormResource;
    row?: Row;
  } | null>(null);
  // Own request preserves real loading/errors even when the lookup cache is still loading.
  const state = useResource<List<Company | Account | Category>>(
    api,
    can(resource) && (resource === "empresas" || empresaId)
      ? resource === "empresas"
        ? `/empresas?offset=${Math.max(0, Number(params.get("pagina_empresas") ?? 0)) * 100}&limit=100`
        : scoped(`/${resource}`, empresaId, {
            offset: String(
              Math.max(0, Number(params.get(`pagina_${resource}`) ?? 0)) * 100,
            ),
            limit: "100",
          })
      : null,
    refresh,
  );
  const options = (["empresas", "contas", "categorias"] as const).filter(
    (value) => can(value),
  );
  const columns: ConfigurableColumn<Company | Account | Category>[] = [
    textColumn("nome", t("financeiro.nome")),
  ];
  if (resource !== "empresas") columns.push(cols.type());
  if (resource === "contas")
    columns.push(
      cols.amount("saldoInicialCentavos", "financeiro.saldoInicial"),
      cols.date("dataSaldoInicial", "financeiro.dataSaldoInicial"),
      cols.amount("saldoCentavos", "financeiro.saldo"),
    );
  columns.push(
    textColumn("ativo", t("financeiro.status"), (row) =>
      t(row.ativo ? "financeiro.ativo" : "financeiro.inativo"),
    ),
  );
  return (
    <div className="space-y-3">
      <SingleLineFilterBar>
        <Field label={t("financeiro.cadastros")}>
          <Select
            value={resource}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set("cadastro", e.target.value);
              setParams(next);
            }}
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {t(`financeiro.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        {can(resource, "create") && (resource === "empresas" || empresaId) && (
          <div className="flex items-end justify-end">
            <Button onClick={() => setEditing({ resource })}>
              {t("financeiro.novo")}
            </Button>
          </div>
        )}
      </SingleLineFilterBar>
      <Gate resource={resource}>
        <Records
          resource={resource}
          state={state}
          columns={columns}
          onOpen={(row) => {
            if (can(resource, "update")) setEditing({ resource, row });
          }}
          actions={(row) =>
            can(resource, "update") ? (
              <ActionButton onClick={() => setEditing({ resource, row })}>
                {t("financeiro.editar")}
              </ActionButton>
            ) : null
          }
        />
      </Gate>
      {editing && (
        <RecordForm
          key={`${editing.resource}:${editing.row?.id ?? "new"}`}
          resource={editing.resource}
          {...(editing.row ? { record: editing.row } : {})}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export function EntriesPage() {
  const {
    api,
    empresaId,
    mes,
    t,
    can,
    refresh,
    categories,
    accounts,
    reload,
    host,
  } = useFinance();
  const cols = useColumns();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<{ row?: Row } | null>(null);
  const [detail, setDetail] = useState<Entry | null>(null);
  const [action, setAction] = useState<ConfirmAction | null>(null);
  const [viewName, setViewName] = useState("");
  const [viewOpen, setViewOpen] = useState(false);
  const [viewError, setViewError] = useState<unknown>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const filterNames = [
    "tipo",
    "situacao",
    "busca",
    "categoriaId",
    "contaPrevistaId",
  ] as const;
  const filters = Object.fromEntries(
    filterNames.map((key) => [key, params.get(key) ?? ""]),
  );
  const state = useList<Entry>("lancamentos", { mes, ...filters });
  const views = useResource<List<View>>(
    api,
    empresaId && can("visoes") ? scoped("/visoes", empresaId) : null,
    refresh,
    true,
  );
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("pagina_lancamentos");
    setParams(next);
  };
  const settle = (row: Entry) =>
    setAction({
      title: t("financeiro.baixar"),
      description: t("financeiro.confirmacaoFinanceira"),
      path: scoped(
        `/lancamentos/${encodeURIComponent(row.id)}/baixas`,
        empresaId,
      ),
      settlement: { maximum: row.pendenteCentavos },
    });
  const cancel = (row: Entry) =>
    setAction({
      title: t("financeiro.cancelarLancamento"),
      description: t("financeiro.confirmacaoCancelamento"),
      path: scoped(
        `/lancamentos/${encodeURIComponent(row.id)}/cancelar`,
        empresaId,
      ),
      reason: true,
      danger: true,
    });
  const saveView = async (event: FormEvent) => {
    event.preventDefault();
    setViewBusy(true);
    setViewError(null);
    try {
      await api.write(scoped("/visoes", empresaId), "POST", {
        nome: viewName,
        filtros: Object.fromEntries(
          Object.entries({ mes, ...filters }).filter(([, value]) => value),
        ),
      });
      reload();
      setViewOpen(false);
      setViewName("");
      host.notify({ message: t("financeiro.sucesso"), tone: "success" });
    } catch (cause) {
      setViewError(cause);
    } finally {
      setViewBusy(false);
    }
  };
  const columns: ConfigurableColumn<Entry>[] = [
    textColumn("descricao", t("financeiro.descricao")),
    textColumn("contraparte", t("financeiro.contraparte")),
    cols.type(),
    cols.date("competencia", "financeiro.competencia"),
    cols.date("vencimento", "financeiro.vencimento"),
    cols.amount("valorCentavos", "financeiro.valor"),
    cols.amount("pendenteCentavos", "financeiro.aberto", "warning"),
    cols.status("situacao"),
    textColumn<Entry>("statusLancamento", t("financeiro.lancamentos"), (row) =>
      row.recorrenciaId ? t("financeiro.lancado") : "",
    ),
    textColumn("confirmado", t("financeiro.estimados"), (row) =>
      t(row.confirmado ? "financeiro.confirmado" : "financeiro.estimado"),
    ),
    textColumn(
      "categoriaId",
      t("financeiro.categoria"),
      (row) =>
        categories.find((c) => c.id === row.categoriaId)?.nome ??
        row.categoriaId,
    ),
  ];
  return (
    <Gate resource="lancamentos">
      <div className="space-y-3">
        <SingleLineFilterBar>
          <Input
            aria-label={t("financeiro.buscar")}
            placeholder={t("financeiro.buscar")}
            value={filters.busca}
            onChange={(e) => change("busca", e.target.value)}
          />
          <Select
            aria-label={t("financeiro.tipo")}
            value={filters.tipo}
            onChange={(e) => change("tipo", e.target.value)}
          >
            <option value="">{t("financeiro.todos")}</option>
            <option value="RECEITA">{t("financeiro.receita")}</option>
            <option value="DESPESA">{t("financeiro.despesa")}</option>
          </Select>
          <Select
            aria-label={t("financeiro.status")}
            value={filters.situacao}
            onChange={(e) => change("situacao", e.target.value)}
          >
            <option value="">{t("financeiro.todos")}</option>
            {["ABERTO", "PARCIAL", "LIQUIDADO", "CANCELADO"].map((value) => (
              <option key={value} value={value}>
                {t(statusKey[value]!)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("financeiro.categoria")}
            value={filters.categoriaId}
            onChange={(e) => change("categoriaId", e.target.value)}
          >
            <option value="">{t("financeiro.todos")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.nome}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("financeiro.contaPrevista")}
            value={filters.contaPrevistaId}
            onChange={(e) => change("contaPrevistaId", e.target.value)}
          >
            <option value="">{t("financeiro.todos")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nome}
              </option>
            ))}
          </Select>
          {can("lancamentos", "create") && (
            <Button onClick={() => setEditing({})}>
              {t("financeiro.novo")}
            </Button>
          )}
        </SingleLineFilterBar>
        {can("visoes") && (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-auto max-w-full"
              aria-label={t("financeiro.visoes")}
              value=""
              onChange={(e) => {
                const view = views.data?.data.find(
                  (v) => v.id === e.target.value,
                );
                if (!view) return;
                const next = new URLSearchParams(params);
                for (const key of ["mes", ...filterNames]) next.delete(key);
                for (const [key, value] of Object.entries(view.filtros))
                  if (value && ["mes", ...filterNames].includes(key))
                    next.set(key, value);
                setParams(next);
              }}
            >
              <option value="">{t("financeiro.semVisao")}</option>
              {views.data?.data.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.nome}
                </option>
              ))}
            </Select>
            {can("visoes", "create") && (
              <Button variant="ghost" onClick={() => setViewOpen(true)}>
                {t("financeiro.salvarVisao")}
              </Button>
            )}
            <ErrorBox error={views.error} />
          </div>
        )}
        <Records
          resource="lancamentos"
          state={state}
          columns={columns}
          onOpen={setDetail}
          actions={(row) => (
            <div className="flex gap-1">
              {!row.cancelado && can("lancamentos", "update") && (
                <ActionButton onClick={() => setEditing({ row })}>
                  {t("financeiro.editar")}
                </ActionButton>
              )}
              {!row.cancelado &&
                row.confirmado &&
                BigInt(row.pendenteCentavos) > 0n &&
                can("movimentos", "create") && (
                  <ActionButton onClick={() => settle(row)}>
                    {t("financeiro.baixar")}
                  </ActionButton>
                )}
              {!row.cancelado &&
                BigInt(row.liquidadoCentavos) === 0n &&
                can("lancamentos", "cancel") && (
                  <ActionButton danger onClick={() => cancel(row)}>
                    {t("financeiro.cancelarLancamento")}
                  </ActionButton>
                )}
            </div>
          )}
        />
        {editing && (
          <RecordForm
            resource="lancamentos"
            {...(editing.row ? { record: editing.row } : {})}
            onClose={() => setEditing(null)}
          />
        )}
        {detail && (
          <EntryDetails
            key={`${detail.id}:${refresh}`}
            entry={
              state.data?.data.find((row) => row.id === detail.id) ?? detail
            }
            onClose={() => setDetail(null)}
            onAction={(next) => {
              setDetail(null);
              setAction(next);
            }}
          />
        )}
        {action && (
          <ConfirmOperation action={action} onClose={() => setAction(null)} />
        )}
        {viewOpen && (
          <Modal
            open
            onOpenChange={setViewOpen}
            title={t("financeiro.salvarVisao")}
          >
            <form onSubmit={saveView} className="space-y-4">
              <ErrorBox error={viewError} />
              <Field label={t("financeiro.nomeVisao")}>
                <Input
                  value={viewName}
                  required
                  maxLength={200}
                  onChange={(e) => setViewName(e.target.value)}
                />
              </Field>
              <Button type="submit" busy={viewBusy}>
                {t("financeiro.salvar")}
              </Button>
            </form>
          </Modal>
        )}
      </div>
    </Gate>
  );
}

function EntryDetails({
  entry,
  onClose,
  onAction,
}: {
  entry: Entry;
  onClose(): void;
  onAction(action: ConfirmAction): void;
}) {
  const { api, empresaId, host, t, can, refresh, reload, accounts } =
    useFinance();
  const cols = useColumns();
  const movements = useResource<List<Movement>>(
    api,
    can("movimentos")
      ? scoped("/movimentos", empresaId, { lancamentoId: entry.id })
      : null,
    refresh,
    true,
  );
  const attachments = useResource<List<Attachment>>(
    api,
    can("anexos")
      ? scoped("/anexos", empresaId, { lancamentoId: entry.id })
      : null,
    refresh,
    true,
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (
        !["application/pdf", "image/jpeg", "image/png"].includes(file.type) ||
        file.size === 0 ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("financeiro.arquivoInvalido");
      await api.upload(
        scoped("/anexos", empresaId, { lancamentoId: entry.id }),
        file,
      );
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const download = async (file: Attachment) => {
    setError(null);
    try {
      await api.download(
        scoped(`/anexos/${encodeURIComponent(file.id)}`, empresaId),
        file.nome,
      );
    } catch (cause) {
      setError(cause);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={entry.descricao}
      contentClassName="sm:max-w-4xl"
    >
      <div className="space-y-4">
        <ErrorBox error={error} />
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt>{t("financeiro.valor")}</dt>
            <dd>
              <DataValue>
                {formatMoney(entry.valorCentavos, host.locale)}
              </DataValue>
            </dd>
          </div>
          <div>
            <dt>{t("financeiro.aberto")}</dt>
            <dd>
              <DataValue tone="warning">
                {formatMoney(entry.pendenteCentavos, host.locale)}
              </DataValue>
            </dd>
          </div>
          <div>
            <dt>{t("financeiro.status")}</dt>
            <dd>{t(statusKey[entry.situacao]!)}</dd>
          </div>
          <div>
            <dt>{t("financeiro.competencia")}</dt>
            <dd>{formatDate(entry.competencia, host.locale)}</dd>
          </div>
          <div>
            <dt>{t("financeiro.vencimento")}</dt>
            <dd>{formatDate(entry.vencimento, host.locale)}</dd>
          </div>
          <div>
            <dt>{t("financeiro.observacao")}</dt>
            <dd className="whitespace-pre-wrap">{entry.observacao}</dd>
          </div>
        </dl>
        {can("movimentos") && (
          <section className="space-y-3">
            <h2 className="font-semibold">{t("financeiro.movimentos")}</h2>
            <Records<Movement>
              resource="movimentos"
              state={movements}
              columns={[
                textColumn<Movement>(
                  "contaId",
                  t("financeiro.conta"),
                  (row) =>
                    accounts.find((account) => account.id === row.contaId)
                      ?.nome ?? row.contaId,
                ),
                cols.date("dataEfetiva", "financeiro.dataEfetiva"),
                cols.amount("valorCentavos", "financeiro.valor"),
                textColumn<Movement>("sinal", t("financeiro.direcao"), (row) =>
                  t(
                    row.sinal === 1 ? "financeiro.entrada" : "financeiro.saida",
                  ),
                ),
                textColumn<Movement>(
                  "estornado",
                  t("financeiro.estornado"),
                  (row) => (row.estornado ? t("financeiro.estornado") : ""),
                ),
              ]}
              onOpen={() => {}}
              actions={(row) =>
                !row.estornado &&
                !row.estornoDeId &&
                !row.transferenciaId &&
                can("movimentos", "reverse") ? (
                  <ActionButton
                    danger
                    onClick={() =>
                      onAction({
                        title: t("financeiro.estornar"),
                        description: t("financeiro.confirmacaoEstorno"),
                        path: scoped(
                          `/movimentos/${encodeURIComponent(row.id)}/estornar`,
                          empresaId,
                        ),
                        reason: true,
                        date: true,
                        danger: true,
                      })
                    }
                  >
                    {t("financeiro.estornar")}
                  </ActionButton>
                ) : null
              }
            />
          </section>
        )}
        {(can("anexos") || can("anexos", "create")) && (
          <section className="space-y-3">
            <h2 className="font-semibold">{t("financeiro.anexos")}</h2>
            {can("anexos", "create") && (
              <Field label={t("financeiro.adicionarAnexo")}>
                <Input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </Field>
            )}
            {can("anexos") && (
              <Records<Attachment>
                resource="anexos"
                state={attachments}
                columns={[
                  textColumn("nome", t("financeiro.arquivo")),
                  textColumn("contentType", t("financeiro.tipo")),
                ]}
                onOpen={(file) => void download(file)}
                actions={(file) => (
                  <div className="flex gap-1">
                    <ActionButton onClick={() => void download(file)}>
                      {t("financeiro.baixarAnexo")}
                    </ActionButton>
                    {can("anexos", "delete") && (
                      <ActionButton
                        danger
                        onClick={() =>
                          onAction({
                            title: t("financeiro.remover"),
                            description: file.nome,
                            path: scoped(
                              `/anexos/${encodeURIComponent(file.id)}`,
                              empresaId,
                            ),
                            method: "DELETE",
                            danger: true,
                          })
                        }
                      >
                        {t("financeiro.remover")}
                      </ActionButton>
                    )}
                  </div>
                )}
              />
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

export function RecurrencesPage() {
  const { api, empresaId, mes, host, t, can, refresh, companies, reload } =
    useFinance();
  const [searchParams, setSearchParams] = useSearchParams();
  const busca = searchParams.get("buscaRecorrencias") ?? "";
  const changeFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    for (const name of [...next.keys()])
      if (name.startsWith("pagina_")) next.delete(name);
    setSearchParams(next, { replace: key === "buscaRecorrencias" });
  };
  const cols = useColumns();
  const state = useList<Recurrence>("recorrencias", { busca });
  const totals = useResource<
    Single<{
      receitasCentavos: string;
      despesasCentavos: string;
      receitasCadastradasCentavos: string;
      despesasCadastradasCentavos: string;
    }>
  >(
    api,
    empresaId && can("recorrencias")
      ? scoped("/recorrencias/resumo", empresaId, { mes })
      : null,
    refresh,
  );
  const [editing, setEditing] = useState<{ row?: Row } | null>(null);
  const [action, setAction] = useState<ConfirmAction | null>(null);
  const changeStatus = (row: Recurrence, status: string) =>
    setAction({
      title: t(
        status === "PAUSADA"
          ? "financeiro.pausar"
          : status === "ATIVA"
            ? "financeiro.retomar"
            : "financeiro.encerrar",
      ),
      description: t(
        status === "ENCERRADA"
          ? "financeiro.confirmacaoEncerramento"
          : "financeiro.confirmacaoFinanceira",
      ),
      path: scoped(`/recorrencias/${encodeURIComponent(row.id)}`, empresaId),
      method: "PATCH",
      body: { status, escopo: "FUTURAS" },
      danger: status === "ENCERRADA",
    });
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <Gate resource="recorrencias">
      <div className="financeiro-recurrences space-y-2">
        <SingleLineFilterBar
          className="financeiro-recurrence-toolbar"
          aria-label={t("financeiro.filtrosRecorrencias")}
        >
          <Select
            aria-label={t("financeiro.empresa")}
            value={empresaId}
            onChange={(e) => changeFilter("empresaId", e.target.value)}
          >
            <option value="">{t("financeiro.selecione")}</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.nome}
                {company.ativo ? "" : ` (${t("financeiro.inativo")})`}
              </option>
            ))}
          </Select>
          <Input
            aria-label={t("financeiro.mes")}
            type="month"
            value={mes}
            onChange={(e) => changeFilter("mes", e.target.value)}
          />
          <div className="financeiro-recurrence-search">
            <Search size={15} aria-hidden="true" />
            <Input
              type="search"
              aria-label={t("financeiro.buscarRecorrencias")}
              placeholder={t("financeiro.buscarRecorrencias")}
              value={busca}
              onChange={(e) =>
                changeFilter("buscaRecorrencias", e.target.value)
              }
            />
          </div>
          <div className="financeiro-recurrence-actions">
            <Button
              variant="ghost"
              title={t("financeiro.atualizar")}
              aria-label={t("financeiro.atualizar")}
              onClick={reload}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </Button>
            {can("recorrencias", "generate") && (
              <Button
                variant="secondary"
                onClick={() =>
                  setAction({
                    title: t("financeiro.gerar"),
                    description: t("financeiro.confirmacaoGeracao"),
                    path: scoped("/recorrencias/gerar", empresaId),
                    body: { de: today(), ate: addDays(today(), 89) },
                  })
                }
              >
                {t("financeiro.gerarCompacto")}
              </Button>
            )}
            {can("recorrencias", "create") && (
              <Button onClick={() => setEditing({})}>
                {t("financeiro.novo")}
              </Button>
            )}
          </div>
        </SingleLineFilterBar>
        <ErrorBox error={totals.error} />
        <div
          className="financeiro-recurrence-totals"
          aria-label={t("financeiro.totaisRecorrencias")}
          aria-busy={totals.loading}
        >
          {(
            [
              [
                "receitasCadastradasCentavos",
                "financeiro.receitasCompacto",
                "financeiro.receitasCadastradas",
                "success",
              ],
              [
                "despesasCadastradasCentavos",
                "financeiro.despesasCompacto",
                "financeiro.despesasCadastradas",
                "warning",
              ],
              [
                "receitasCentavos",
                "financeiro.receitasMesCompacto",
                "financeiro.receitasRecorrentes",
                "success",
              ],
              [
                "despesasCentavos",
                "financeiro.despesasMesCompacto",
                "financeiro.despesasRecorrentes",
                "warning",
              ],
            ] as const
          ).map(([key, label, fullLabel, tone]) => (
            <MetricCard
              key={key}
              className="financeiro-inline-metric"
              tone={tone}
              label={<span title={t(fullLabel)}>{t(label)}</span>}
              value={
                totals.data
                  ? formatMoney(totals.data.data[key] ?? "0", host.locale)
                  : "…"
              }
            />
          ))}
          <Button
            variant="ghost"
            className="financeiro-recurrence-help"
            title={t("financeiro.sobreRecorrencias")}
            aria-label={t("financeiro.sobreRecorrencias")}
            onClick={() => setHelpOpen(true)}
          >
            <Info size={16} aria-hidden="true" />
          </Button>
        </div>
        {helpOpen && (
          <Modal
            open
            title={t("financeiro.sobreRecorrencias")}
            onOpenChange={setHelpOpen}
          >
            <div className="space-y-3 text-sm">
              <p>{t("financeiro.totaisRecorrentesNota")}</p>
              <p>{t("financeiro.automacaoRecorrencias")}</p>
            </div>
          </Modal>
        )}
        <Records<Recurrence>
          resource="recorrencias"
          state={state}
          columns={[
            textColumn("descricao", t("financeiro.descricao")),
            cols.type(),
            cols.amount("valorCentavos", "financeiro.valor"),
            cols.status("status"),
            cols.date("ancora", "financeiro.ancora"),
            cols.date("inicio", "financeiro.inicio"),
            textColumn<Recurrence>("regra", t("financeiro.frequencia"), (row) =>
              t(
                row.regra.frequencia === "ANO" ||
                  (row.regra.frequencia === "MES" &&
                    row.regra.intervalo % 12 === 0)
                  ? "financeiro.anual"
                  : row.regra.frequencia === "DIA"
                    ? "financeiro.dia"
                    : row.regra.frequencia === "SEMANA"
                      ? "financeiro.semana"
                      : "financeiro.mensal",
              ),
            ),
            textColumn("versao", t("financeiro.revisao")),
          ]}
          onOpen={(row) => {
            if (can("recorrencias", "update")) setEditing({ row });
          }}
          actions={(row) =>
            row.status !== "ENCERRADA" && can("recorrencias", "update") ? (
              <div className="flex gap-1">
                <ActionButton onClick={() => setEditing({ row })}>
                  {t("financeiro.editar")}
                </ActionButton>
                <ActionButton
                  onClick={() =>
                    changeStatus(
                      row,
                      row.status === "ATIVA" ? "PAUSADA" : "ATIVA",
                    )
                  }
                >
                  {t(
                    row.status === "ATIVA"
                      ? "financeiro.pausar"
                      : "financeiro.retomar",
                  )}
                </ActionButton>
                <ActionButton
                  danger
                  onClick={() => changeStatus(row, "ENCERRADA")}
                >
                  {t("financeiro.encerrar")}
                </ActionButton>
              </div>
            ) : null
          }
        />
        {editing && (
          <RecordForm
            resource="recorrencias"
            {...(editing.row ? { record: editing.row } : {})}
            onClose={() => setEditing(null)}
          />
        )}
        {action && (
          <ConfirmOperation action={action} onClose={() => setAction(null)} />
        )}
      </div>
    </Gate>
  );
}

export function TransfersPage() {
  const { t, can, accounts, mes, empresaId } = useFinance();
  const cols = useColumns();
  const state = useList<Transfer>("transferencias", { mes });
  const [create, setCreate] = useState(false);
  const [action, setAction] = useState<ConfirmAction | null>(null);
  return (
    <Gate resource="transferencias">
      <div className="space-y-3">
        <PageActions>
          {can("transferencias", "create") && (
            <Button onClick={() => setCreate(true)}>
              {t("financeiro.novo")}
            </Button>
          )}
        </PageActions>
        <Records<Transfer>
          resource="transferencias"
          state={state}
          columns={[
            cols.date("dataEfetiva", "financeiro.dataEfetiva"),
            textColumn<Transfer>(
              "contaOrigemId",
              t("financeiro.origem"),
              (row) =>
                accounts.find((a) => a.id === row.contaOrigemId)?.nome ??
                row.contaOrigemId,
            ),
            textColumn<Transfer>(
              "contaDestinoId",
              t("financeiro.destino"),
              (row) =>
                accounts.find((a) => a.id === row.contaDestinoId)?.nome ??
                row.contaDestinoId,
            ),
            cols.amount("valorCentavos", "financeiro.valor"),
            textColumn("descricao", t("financeiro.descricao")),
            textColumn<Transfer>(
              "estornado",
              t("financeiro.estornado"),
              (row) => (row.estornado ? t("financeiro.estornado") : ""),
            ),
          ]}
          onOpen={() => {}}
          actions={(row) =>
            !row.estornado && can("transferencias", "reverse") ? (
              <ActionButton
                danger
                onClick={() =>
                  setAction({
                    title: t("financeiro.estornar"),
                    description: t("financeiro.confirmacaoEstorno"),
                    path: scoped(
                      `/transferencias/${encodeURIComponent(row.id)}/estornar`,
                      empresaId,
                    ),
                    reason: true,
                    date: true,
                    danger: true,
                  })
                }
              >
                {t("financeiro.estornar")}
              </ActionButton>
            ) : null
          }
        />
        {action && (
          <ConfirmOperation action={action} onClose={() => setAction(null)} />
        )}
        {create && (
          <RecordForm
            resource="transferencias"
            onClose={() => setCreate(false)}
          />
        )}
      </div>
    </Gate>
  );
}

export function ClosingPage() {
  const { api, empresaId, mes, t, can, refresh, host } = useFinance();
  const cols = useColumns();
  const state = useList<Closing>("fechamentos", { mes });
  const summary = useResource<Single<Summary>>(
    api,
    can("resumo") && empresaId ? scoped("/resumo", empresaId, { mes }) : null,
    refresh,
  );
  const [action, setAction] = useState<ConfirmAction | null>(null);
  const [detail, setDetail] = useState<Closing | null>(null);
  const current = state.data?.data
    .filter((row) => row.mes === mes)
    .sort((a, b) => b.versao - a.versao)[0];
  return (
    <Gate resource="fechamentos">
      <div className="space-y-3">
        <PageActions>
          {can("fechamentos", "close") &&
            current?.status !== "FECHADO" &&
            !state.loading &&
            !state.error && (
              <Button
                onClick={() =>
                  setAction({
                    title: t("financeiro.fechar"),
                    description: t("financeiro.confirmacaoFechamento"),
                    path: scoped("/fechamentos", empresaId),
                    body: { mes },
                  })
                }
              >
                {t("financeiro.fechar")}
              </Button>
            )}
        </PageActions>
        <p className="text-sm text-slate-500">
          {t("financeiro.confirmacaoFechamento")}
        </p>
        <ErrorBox error={summary.error} />
        {summary.data && (
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              tone="info"
              label={t("financeiro.resultadoCaixa")}
              value={formatMoney(
                summary.data.data.resultadoCaixaCentavos,
                host.locale,
              )}
            />
            <MetricCard
              label={t("financeiro.resultadoCompetencia")}
              value={formatMoney(
                summary.data.data.resultadoCompetenciaCentavos,
                host.locale,
              )}
            />
          </div>
        )}
        <Records<Closing>
          resource="fechamentos"
          state={state}
          columns={[
            textColumn("mes", t("financeiro.mes")),
            textColumn("versao", t("financeiro.revisao")),
            cols.status("status"),
          ]}
          onOpen={setDetail}
          actions={(row) =>
            row.status === "FECHADO" && can("fechamentos", "reopen") ? (
              <ActionButton
                onClick={() =>
                  setAction({
                    title: t("financeiro.reabrir"),
                    description: `${row.mes} (${t("financeiro.revisao")} ${row.versao})`,
                    path: scoped(
                      `/fechamentos/${encodeURIComponent(row.id)}/reabrir`,
                      empresaId,
                    ),
                    reason: true,
                  })
                }
              >
                {t("financeiro.reabrir")}
              </ActionButton>
            ) : null
          }
        />
        {action && (
          <ConfirmOperation action={action} onClose={() => setAction(null)} />
        )}
        {detail && (
          <Modal
            open
            onOpenChange={(open) => {
              if (!open) setDetail(null);
            }}
            title={`${detail.mes} (${t("financeiro.revisao")} ${detail.versao})`}
          >
            <dl className="space-y-3">
              {Object.entries(detail.snapshot)
                .filter(
                  ([key, value]) =>
                    key.endsWith("Centavos") && typeof value === "string",
                )
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{summaryLabels[key] ? t(summaryLabels[key]!) : key}</dt>
                    <dd>
                      <DataValue>
                        {formatMoney(String(value), host.locale)}
                      </DataValue>
                    </dd>
                  </div>
                ))}
            </dl>
          </Modal>
        )}
      </div>
    </Gate>
  );
}
const summaryLabels: Record<string, MessageKey> = {
  receitasCentavos: "financeiro.receitasCompetencia",
  despesasCentavos: "financeiro.despesasCompetencia",
  resultadoCompetenciaCentavos: "financeiro.resultadoCompetencia",
  entradasCentavos: "financeiro.recebido",
  saidasCentavos: "financeiro.pago",
  resultadoCaixaCentavos: "financeiro.resultadoCaixa",
  saldoConsolidadoCentavos: "financeiro.saldo",
  pendenteReceberCentavos: "financeiro.aReceber",
  pendentePagarCentavos: "financeiro.aPagar",
};

export function AuditPage() {
  const { t, mes, host } = useFinance();
  const state = useList<Audit>("auditoria", { mes });
  const [detail, setDetail] = useState<Audit | null>(null);
  const instant = (value: string) =>
    new Intl.DateTimeFormat(host.locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <Gate resource="auditoria">
      <Records<Audit>
        resource="auditoria"
        state={state}
        columns={[
          textColumn("action", t("financeiro.acao")),
          textColumn("user_id", t("financeiro.autor")),
          textColumn<Audit>("created_at", t("financeiro.quando"), (row) =>
            instant(row.created_at),
          ),
          textColumn("request_id", t("financeiro.requestId")),
        ]}
        onOpen={setDetail}
      />
      {detail && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
          title={t("financeiro.detalhes")}
        >
          <dl className="space-y-4">
            <div>
              <dt>{t("financeiro.requestId")}</dt>
              <dd className="break-all">{detail.request_id}</dd>
            </div>
            {(["before", "after"] as const).map((key) => (
              <div key={key}>
                <dt>
                  {t(
                    key === "before" ? "financeiro.antes" : "financeiro.depois",
                  )}
                </dt>
                <dd>
                  <pre className="overflow-auto rounded-lg border p-3 text-xs">
                    {JSON.stringify(detail[key], null, 2)}
                  </pre>
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </Gate>
  );
}

export function SettingsPage() {
  const { api, t, empresaId, can, refresh } = useFinance();
  const state = useResource<Single<Notice | null>>(
    api,
    empresaId && can("avisos")
      ? scoped("/avisos/configuracao", empresaId)
      : null,
    refresh,
  );
  const webhooks = useResource<
    Single<{
      enabled: boolean;
      configuration:
        | "READY"
        | "MISSING_CONFIGURATION"
        | "INVALID_CONFIGURATION";
    }>
  >(api, can("avisos") ? "/webhooks/status" : null, refresh);
  return (
    <Gate resource="avisos">
      <div className="max-w-2xl space-y-3">
        <ErrorBox error={webhooks.error} />
        {webhooks.data && (
          <Card>
            <h2 className="font-semibold">{t("financeiro.webhooks")}</h2>
            <p className="mt-2 text-sm">
              {t(
                webhooks.data.data.enabled &&
                  webhooks.data.data.configuration === "READY"
                  ? "financeiro.webhookPronto"
                  : webhooks.data.data.configuration === "INVALID_CONFIGURATION"
                    ? "financeiro.webhookInvalido"
                    : "financeiro.webhookAusente",
              )}
            </p>
          </Card>
        )}
        <ErrorBox error={state.error} />
        {state.loading ? (
          <Card role="status">{t("financeiro.carregando")}</Card>
        ) : (
          !state.error && (
            <NoticeForm
              key={`${empresaId}:${refresh}`}
              initial={state.data?.data ?? undefined}
            />
          )
        )}
      </div>
    </Gate>
  );
}
function NoticeForm({ initial }: { initial: Notice | undefined }) {
  const { api, empresaId, t, host, can, reload } = useFinance();
  const [active, setActive] = useState(initial?.ativo ?? false);
  const [chatId, setChatId] = useState(initial?.chatId ?? "");
  const [days, setDays] = useState(String(initial?.diasAntecedencia ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [action, setAction] = useState<ConfirmAction | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.write(scoped("/avisos/configuracao", empresaId), "PUT", {
        ativo: active,
        chatId,
        diasAntecedencia: Number(days),
      });
      host.notify({ message: t("financeiro.sucesso"), tone: "success" });
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card>
        <h2 className="font-semibold">{t("financeiro.avisos")}</h2>
        <p className="mt-2 text-sm text-slate-500">
          {t("financeiro.avisosNota")}
        </p>
        {initial?.telegramConfigurado === false && (
          <p className="mt-2 text-sm" role="status">
            {t("financeiro.avisoSemBot")}
          </p>
        )}
        <form onSubmit={save} className="mt-4 space-y-4">
          <ErrorBox error={error} />
          <fieldset
            disabled={!can("avisos", "manage") || busy}
            className="space-y-4"
          >
            <Check
              label={t("financeiro.habilitarAvisos")}
              checked={active}
              onChange={setActive}
            />
            <Field label={t("financeiro.chatId")}>
              <Input
                required
                pattern="-?[0-9]{1,20}"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
              />
            </Field>
            <Field label={t("financeiro.antecedencia")}>
              <Input
                required
                type="number"
                min={0}
                max={30}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
            {can("avisos", "manage") && (
              <Button type="submit" busy={busy}>
                {t("financeiro.salvar")}
              </Button>
            )}
          </fieldset>
        </form>
      </Card>
      <Card className="text-sm text-slate-500">
        {t("financeiro.segredoNota")}
      </Card>
      {can("avisos", "manage") && initial?.ativo && (
        <Button
          variant="secondary"
          onClick={() =>
            setAction({
              title: t("financeiro.enviarAvisos"),
              description: t("financeiro.avisosNota"),
              path: scoped("/avisos/enviar", empresaId),
            })
          }
        >
          {t("financeiro.enviarAvisos")}
        </Button>
      )}
      {action && (
        <ConfirmOperation action={action} onClose={() => setAction(null)} />
      )}
    </>
  );
}
