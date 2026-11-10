import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  Skeleton,
  Textarea,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { Modal } from "../../.marketplace/frontend/src/components/ui/modal.js";
import {
  ConfigurableDataTable,
  type ConfigurableColumn,
} from "../../.marketplace/frontend/src/components/ui/configurable-data-table.js";
import { errorLabel } from "./api-client.js";
import { useFinance, type Resource } from "./context.js";
import {
  addDays,
  civilDate,
  formatDate,
  moneyInput,
  parseMoney,
  today,
} from "./format.js";
import type { List, Row, Rule } from "./types.js";
import type { MessageKey } from "./i18n.js";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <div
        className="contents"
        ref={(node) => {
          const control = node?.querySelector("input,select,textarea");
          if (control && !control.id) control.id = id;
        }}
      >
        {children}
      </div>
    </div>
  );
}
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useFinance();
  return error ? (
    <Card role="alert" className="text-sm">
      {errorLabel(error, t)}
    </Card>
  ) : null;
}
export function Gate({
  resource,
  children,
}: {
  resource: string;
  children: ReactNode;
}) {
  const { can, empresaId, t } = useFinance();
  if (!can(resource))
    return <Card role="status">{t("financeiro.semPermissao")}</Card>;
  if (!empresaId && resource !== "empresas")
    return <Card role="status">{t("financeiro.semEmpresa")}</Card>;
  return children;
}
export const textColumn = <T extends Row>(
  key: string,
  label: string,
  render?: (row: T) => ReactNode,
): ConfigurableColumn<T> => ({
  key,
  label,
  render: render ?? ((row) => String(row[key] ?? "")),
  sortValue: (row) =>
    typeof row[key] === "number"
      ? (row[key] as number)
      : String(row[key] ?? ""),
  size: 200,
  minSize: 120,
  maxSize: 600,
});
export function Records<T extends Row>({
  resource,
  state,
  columns,
  onOpen,
  actions,
}: {
  resource: string;
  state: Resource<List<T>>;
  columns: ConfigurableColumn<T>[];
  onOpen(row: T): void;
  actions?: (row: T) => ReactNode;
}) {
  const { t, host, empresaId } = useFinance();
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get(`pagina_${resource}`) ?? 0);
  const page = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
  const move = (next: number) => {
    const query = new URLSearchParams(params);
    query.set(`pagina_${resource}`, String(next));
    setParams(query);
  };
  if (state.error) return <ErrorBox error={state.error} />;
  if (state.loading)
    return (
      <div
        role="status"
        aria-label={t("financeiro.carregando")}
        className="space-y-3"
      >
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  return (
    <>
      <ConfigurableDataTable
        key={`${host.locale}:${empresaId}:${resource}`}
        tableId={`plugin.financeiro.${resource}`}
        rows={state.data?.data ?? []}
        columns={columns}
        onOpen={onOpen}
        actions={actions}
        emptyTitle={t("financeiro.vazio")}
        emptyDescription={t("financeiro.vazioAjuda")}
      />
      {(state.data?.total ?? 0) > 100 &&
        (state.data?.data.length ?? 0) <= 100 && (
          <div className="flex items-center justify-end gap-3 text-sm">
            <Button
              variant="secondary"
              disabled={page === 0}
              onClick={() => move(page - 1)}
            >
              {t("financeiro.anterior")}
            </Button>
            <span>
              {page * 100 + 1} / {state.data?.total}
            </span>
            <Button
              variant="secondary"
              disabled={(page + 1) * 100 >= (state.data?.total ?? 0)}
              onClick={() => move(page + 1)}
            >
              {t("financeiro.proxima")}
            </Button>
          </div>
        )}
    </>
  );
}
export function ActionButton({
  children,
  onClick,
  danger = false,
}: {
  children: ReactNode;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={danger ? "danger" : "ghost"}
      className="min-h-9 px-2 py-1"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
export type FormResource =
  | "empresas"
  | "contas"
  | "categorias"
  | "lancamentos"
  | "recorrencias"
  | "transferencias";
export function RecordForm({
  resource,
  record,
  onClose,
}: {
  resource: FormResource;
  record?: Row;
  onClose(): void;
}) {
  const { api, host, t, empresaId, accounts, categories, can, reload } =
    useFinance();
  const existing = record as
    | (Row & { regra?: Rule; excecoes?: string[] })
    | undefined;
  const [form, setForm] = useState<Record<string, string>>({
    nome: String(record?.nome ?? ""),
    descricao: String(record?.descricao ?? ""),
    tipo: String(record?.tipo ?? (resource === "contas" ? "BANCO" : "DESPESA")),
    valor: moneyInput(String(record?.valorCentavos ?? "0"), host.locale),
    saldo: moneyInput(String(record?.saldoInicialCentavos ?? "0"), host.locale),
    dataSaldoInicial: String(record?.dataSaldoInicial ?? today()),
    competencia: String(record?.competencia ?? today()),
    vencimento: String(record?.vencimento ?? today()),
    categoriaId: String(record?.categoriaId ?? ""),
    contaPrevistaId: String(record?.contaPrevistaId ?? ""),
    observacao: String(record?.observacao ?? ""),
    contraparte: String(record?.contraparte ?? ""),
    contaId: "",
    dataEfetiva: today(),
    contaOrigemId: "",
    contaDestinoId: "",
    ancora: String(record?.ancora ?? today()),
    inicio: String(record?.inicio ?? today()),
    fim: String(record?.fim ?? ""),
    frequencia:
      existing?.regra?.frequencia === "MES" &&
      existing.regra.intervalo % 12 === 0
        ? "ANO"
        : (existing?.regra?.frequencia ?? "MES"),
    intervalo: String(
      existing?.regra?.frequencia === "MES" &&
        existing.regra.intervalo % 12 === 0
        ? existing.regra.intervalo / 12
        : (existing?.regra?.intervalo ?? 1),
    ),
    dia_mes: String(
      existing?.regra?.dia_mes ??
        Number(String(record?.ancora ?? today()).slice(8)),
    ),
    semana_do_mes: String(existing?.regra?.semana_do_mes ?? 1),
    dia_semana: String(existing?.regra?.dia_semana ?? 1),
    ajuste_fds: existing?.regra?.ajuste_fds ?? "MANTER",
    excecoes: existing?.excecoes?.join("\n") ?? "",
  });
  const [ativo, setAtivo] = useState(record ? Boolean(record.ativo) : true);
  const [confirmado, setConfirmado] = useState(record?.confirmado !== false);
  const [settled, setSettled] = useState(false);
  const [monthlyMode, setMonthlyMode] = useState(
    existing?.regra?.semana_do_mes ? "week" : "day",
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<unknown[] | null>(null);
  const field = (name: string, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
    setPreview(null);
  };
  const input = (
    name: string,
    label: MessageKey,
    type = "text",
    required = true,
    extra: Record<string, string | number> = {},
  ) => (
    <Field label={t(label)}>
      <Input
        name={name}
        type={type}
        required={required}
        value={form[name] ?? ""}
        onChange={(e) => field(name, e.target.value)}
        {...extra}
      />
    </Field>
  );
  const select = (
    name: string,
    label: MessageKey,
    options: { value: string; label: string }[],
    required = true,
  ) => (
    <Field label={t(label)}>
      <Select
        name={name}
        required={required}
        value={form[name] ?? ""}
        onChange={(e) => field(name, e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  const accountOptions = (optional = false) => [
    {
      value: "",
      label: t(optional ? "financeiro.semConta" : "financeiro.selecione"),
    },
    ...accounts
      .filter((a) => a.ativo || a.id === form.contaPrevistaId)
      .map((a) => ({ value: a.id, label: a.nome })),
  ];
  const rule = (): Rule => ({
    frequencia:
      form.frequencia === "ANO" && existing?.regra?.frequencia === "MES"
        ? "MES"
        : (form.frequencia as Rule["frequencia"]),
    intervalo:
      Number(form.intervalo) *
      (form.frequencia === "ANO" && existing?.regra?.frequencia === "MES"
        ? 12
        : 1),
    ajuste_fds: form.ajuste_fds as Rule["ajuste_fds"],
    ...(form.frequencia === "ANO" && existing?.regra?.frequencia === "MES"
      ? {
          ...(existing.regra.dia_mes !== undefined
            ? { dia_mes: existing.regra.dia_mes }
            : {}),
          ...(existing.regra.semana_do_mes !== undefined
            ? {
                semana_do_mes: existing.regra.semana_do_mes,
                dia_semana: existing.regra.dia_semana,
              }
            : {}),
        }
      : form.frequencia === "MES"
        ? monthlyMode === "day"
          ? { dia_mes: Number(form.dia_mes) }
          : {
              semana_do_mes: Number(form.semana_do_mes),
              dia_semana: Number(form.dia_semana),
            }
        : {}),
  });
  const body = (): Record<string, unknown> => {
    if (resource === "empresas") return { nome: form.nome, ativo };
    if (resource === "contas") {
      civilDate(form.dataSaldoInicial!);
      const saldoInicialCentavos = parseMoney(form.saldo!, host.locale, true);
      return {
        nome: form.nome,
        tipo: form.tipo,
        ativo,
        ...(!record || saldoInicialCentavos !== record.saldoInicialCentavos
          ? { saldoInicialCentavos }
          : {}),
        ...(!record || form.dataSaldoInicial !== record.dataSaldoInicial
          ? { dataSaldoInicial: form.dataSaldoInicial }
          : {}),
      };
    }
    if (resource === "categorias")
      return { nome: form.nome, tipo: form.tipo, ativo };
    const valorCentavos = parseMoney(form.valor!, host.locale);
    if (resource === "transferencias") {
      civilDate(form.dataEfetiva!);
      if (form.contaOrigemId === form.contaDestinoId)
        throw new Error("financeiro.contasIguais");
      return {
        contaOrigemId: form.contaOrigemId,
        contaDestinoId: form.contaDestinoId,
        dataEfetiva: form.dataEfetiva,
        valorCentavos,
        ...(form.descricao ? { descricao: form.descricao } : {}),
        chaveIdempotencia: operationKey,
      };
    }
    const common = {
      tipo: form.tipo,
      descricao: form.descricao,
      valorCentavos,
      categoriaId: form.categoriaId,
      contaPrevistaId: form.contaPrevistaId || null,
      observacao: form.observacao,
      contraparte: form.contraparte,
      confirmado,
    };
    if (resource === "recorrencias") {
      civilDate(form.ancora!);
      civilDate(form.inicio!);
      if (form.fim) civilDate(form.fim);
      const excecoes = form.excecoes!.split(/\s+/).filter(Boolean);
      excecoes.forEach(civilDate);
      return {
        ...common,
        ancora: form.ancora,
        inicio: form.inicio,
        fim: form.fim || null,
        regra: rule(),
        excecoes,
        ...(record ? { escopo: "FUTURAS" } : {}),
      };
    }
    civilDate(form.competencia!);
    civilDate(form.vencimento!);
    return {
      ...common,
      competencia: form.competencia,
      vencimento: form.vencimento,
      ...(!record ? { chaveIdempotencia: operationKey } : {}),
      ...(!record && settled
        ? {
            liquidacao: {
              contaId: form.contaId,
              dataEfetiva: form.dataEfetiva,
              valorCentavos,
            },
          }
        : {}),
    };
  };
  const [operationKey] = useState(() => crypto.randomUUID());
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = record
        ? `/${resource}/${encodeURIComponent(record.id)}`
        : `/${resource}`;
      await api.write(
        resource === "empresas"
          ? path
          : `${path}?${new URLSearchParams({ empresaId })}`,
        record ? "PATCH" : "POST",
        body(),
      );
      host.notify({ message: t("financeiro.sucesso"), tone: "success" });
      reload();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const { escopo, ...payload } = body();
      const de = form.inicio! > today() ? form.inicio! : today();
      const result = await api.write<{ data: unknown }>(
        "/recorrencias/previa?" + new URLSearchParams({ empresaId }),
        "POST",
        { ...payload, de, ate: addDays(de, 89) },
      );
      const data = result.data;
      setPreview(
        Array.isArray(data)
          ? data
          : typeof data === "object" &&
              data !== null &&
              "ocorrencias" in data &&
              Array.isArray(data.ocorrencias)
            ? data.ocorrencias
            : [],
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const business = resource === "lancamentos" || resource === "recorrencias";
  const titleKey = `financeiro.${resource}` as MessageKey;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={`${t(record ? "financeiro.editar" : "financeiro.novo")} ${t(titleKey)}`}
      description={
        resource === "transferencias"
          ? t("financeiro.confirmacaoFinanceira")
          : undefined
      }
    >
      <form onSubmit={save} className="space-y-4">
        <ErrorBox error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          {(resource === "empresas" ||
            resource === "contas" ||
            resource === "categorias") &&
            input("nome", "financeiro.nome", "text", true, { maxLength: 200 })}
          {(business || resource === "transferencias") &&
            input(
              "descricao",
              "financeiro.descricao",
              "text",
              resource !== "transferencias",
              { maxLength: 200 },
            )}
          {(business || resource === "categorias") &&
            select("tipo", "financeiro.tipo", [
              { value: "RECEITA", label: t("financeiro.receita") },
              { value: "DESPESA", label: t("financeiro.despesa") },
            ])}
          {resource === "contas" && (
            <>
              {select("tipo", "financeiro.tipo", [
                { value: "BANCO", label: t("financeiro.banco") },
                { value: "CAIXA", label: t("financeiro.caixa") },
              ])}
              {input("saldo", "financeiro.saldoInicial", "text", true, {
                inputMode: "decimal",
              })}
              {input("dataSaldoInicial", "financeiro.dataSaldoInicial", "date")}
            </>
          )}
          {(business || resource === "transferencias") &&
            input("valor", "financeiro.valor", "text", true, {
              inputMode: "decimal",
            })}
          {business && (
            <>
              {input("contraparte", "financeiro.contraparte", "text", false, {
                maxLength: 200,
              })}
              {select("categoriaId", "financeiro.categoria", [
                { value: "", label: t("financeiro.selecione") },
                ...categories
                  .filter(
                    (c) =>
                      c.tipo === form.tipo &&
                      (c.ativo || c.id === form.categoriaId),
                  )
                  .map((c) => ({ value: c.id, label: c.nome })),
              ])}
              {select(
                "contaPrevistaId",
                "financeiro.contaPrevista",
                accountOptions(true),
                false,
              )}
            </>
          )}
          {resource === "lancamentos" && (
            <>
              {input("competencia", "financeiro.competencia", "date")}
              {input("vencimento", "financeiro.vencimento", "date")}
            </>
          )}
          {resource === "transferencias" && (
            <>
              {select("contaOrigemId", "financeiro.origem", accountOptions())}
              {select(
                "contaDestinoId",
                "financeiro.destino",
                accountOptions().filter(
                  (o) => !o.value || o.value !== form.contaOrigemId,
                ),
              )}
              {input("dataEfetiva", "financeiro.dataEfetiva", "date")}
            </>
          )}
          {resource === "recorrencias" && (
            <>
              {input("ancora", "financeiro.ancora", "date")}
              {input("inicio", "financeiro.inicio", "date")}
              {input("fim", "financeiro.fim", "date", false)}
              {select("frequencia", "financeiro.frequencia", [
                { value: "SEMANA", label: t("financeiro.semanal") },
                { value: "MES", label: t("financeiro.mensal") },
                { value: "ANO", label: t("financeiro.anual") },
                ...(existing?.regra?.frequencia === "DIA"
                  ? [{ value: "DIA", label: t("financeiro.dia") }]
                  : []),
              ])}
              {input("intervalo", "financeiro.intervalo", "number", true, {
                min: 1,
                max: 366,
              })}
              {form.frequencia === "MES" && (
                <Field label={t("financeiro.mensal")}>
                  <Select
                    value={monthlyMode}
                    onChange={(e) => {
                      setMonthlyMode(e.target.value);
                      setPreview(null);
                    }}
                  >
                    <option value="day">{t("financeiro.porDia")}</option>
                    <option value="week">{t("financeiro.porSemana")}</option>
                  </Select>
                </Field>
              )}
              {form.frequencia === "MES" &&
                monthlyMode === "day" &&
                input("dia_mes", "financeiro.diaMes", "number", true, {
                  min: 1,
                  max: 31,
                })}
              {form.frequencia === "MES" &&
                monthlyMode === "week" &&
                select(
                  "semana_do_mes",
                  "financeiro.semanaMes",
                  [1, 2, 3, 4, 5, -1].map((value) => ({
                    value: String(value),
                    label:
                      value === -1 ? t("financeiro.ultima") : String(value),
                  })),
                )}
              {form.frequencia === "MES" &&
                monthlyMode === "week" &&
                select(
                  "dia_semana",
                  "financeiro.diaSemana",
                  Array.from({ length: 7 }, (_, value) => ({
                    value: String(value),
                    label: new Intl.DateTimeFormat(host.locale, {
                      weekday: "long",
                    }).format(new Date(2026, 10, 1 + value, 12)),
                  })),
                )}
              {select("ajuste_fds", "financeiro.ajuste", [
                { value: "MANTER", label: t("financeiro.manter") },
                { value: "ANTECIPAR", label: t("financeiro.antecipar") },
                { value: "ADIAR", label: t("financeiro.adiar") },
              ])}
            </>
          )}
        </div>
        {business && (
          <>
            <Check
              checked={confirmado}
              onChange={setConfirmado}
              label={t("financeiro.confirmado")}
            />
            <Field label={t("financeiro.observacao")}>
              <Textarea
                value={form.observacao}
                onChange={(e) => field("observacao", e.target.value)}
                maxLength={5000}
              />
            </Field>
          </>
        )}
        {!business && resource !== "transferencias" && (
          <Check
            label={t("financeiro.ativo")}
            checked={ativo}
            onChange={setAtivo}
          />
        )}
        {resource === "lancamentos" &&
          !record &&
          can("movimentos", "create") && (
            <>
              <Check
                checked={settled}
                onChange={setSettled}
                label={t("financeiro.liquidadoAgora")}
              />
              {settled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {select("contaId", "financeiro.conta", accountOptions())}
                  {input("dataEfetiva", "financeiro.dataEfetiva", "date")}
                  <p className="text-sm sm:col-span-2">
                    {t("financeiro.confirmacaoFinanceira")}
                  </p>
                </div>
              )}
            </>
          )}
        {resource === "recorrencias" && (
          <>
            <Field label={t("financeiro.excecoes")}>
              <Textarea
                value={form.excecoes}
                onChange={(e) => field("excecoes", e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              busy={busy}
              onClick={() => void loadPreview()}
            >
              {t("financeiro.previa")}
            </Button>
            {preview !== null && (
              <Card role="status">
                {preview.length ? (
                  <ul className="space-y-1">
                    {preview.map((item, index) => {
                      const data = item as {
                        vencimento?: string;
                        dataNominal?: string;
                      };
                      return (
                        <li key={index}>
                          {data.vencimento || data.dataNominal
                            ? formatDate(
                                (data.vencimento ?? data.dataNominal)!,
                                host.locale,
                              )
                            : String(item)}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  t("financeiro.vazio")
                )}
              </Card>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t("financeiro.cancelar")}
          </Button>
          <Button type="submit" busy={busy}>
            {t("financeiro.salvar")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export type ConfirmAction = {
  title: string;
  description: string;
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  reason?: boolean;
  date?: boolean;
  settlement?: { maximum: string };
  danger?: boolean;
};
export function ConfirmOperation({
  action,
  onClose,
}: {
  action: ConfirmAction;
  onClose(): void;
}) {
  const { api, host, t, accounts, reload } = useFinance();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState(
    action.settlement ? moneyInput(action.settlement.maximum, host.locale) : "",
  );
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [generation, setGeneration] = useState<{
    gerados: number;
    restantes: number;
  } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (action.reason && reason.trim().length < 5)
        throw new Error("financeiro.motivoInvalido");
      if (action.date || action.settlement) civilDate(date);
      const value = action.settlement
        ? parseMoney(amount, host.locale)
        : undefined;
      if (
        action.settlement &&
        BigInt(value!) > BigInt(action.settlement.maximum)
      )
        throw new Error("financeiro.limite");
      const response = await api.write<{
        data?: {
          gerados?: number;
          restantes?: number;
          arquivoRemovido?: boolean;
          manutencaoNecessaria?: boolean;
        };
      }>(action.path, action.method ?? "POST", {
        ...action.body,
        ...(action.reason ? { motivo: reason.trim() } : {}),
        ...(action.date || action.settlement
          ? { dataEfetiva: date, chaveIdempotencia: key }
          : {}),
        ...(action.settlement
          ? { contaId: account, valorCentavos: value }
          : {}),
      });
      if ((response?.data?.restantes ?? 0) > 0) {
        setGeneration((previous) => ({
          gerados: (previous?.gerados ?? 0) + (response.data?.gerados ?? 0),
          restantes: response.data!.restantes!,
        }));
        reload();
        return;
      }
      host.notify({
        message: t(
          response?.data?.manutencaoNecessaria ||
            response?.data?.arquivoRemovido === false
            ? "financeiro.anexoManutencao"
            : "financeiro.sucesso",
        ),
        tone: response?.data?.manutencaoNecessaria ? "info" : "success",
      });
      reload();
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={action.title}
      description={action.description}
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        {generation && (
          <Card role="status">
            {t("financeiro.gerados")}: {generation.gerados}.{" "}
            {t("financeiro.restantes")}: {generation.restantes}.{" "}
            {t("financeiro.continuarGeracao")}
          </Card>
        )}
        {action.settlement && (
          <>
            <Field label={t("financeiro.valor")}>
              <Input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={t("financeiro.conta")}>
              <Select
                required
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">{t("financeiro.selecione")}</option>
                {accounts
                  .filter((a) => a.ativo)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
              </Select>
            </Field>
          </>
        )}
        {(action.date || action.settlement) && (
          <Field label={t("financeiro.dataEfetiva")}>
            <Input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        )}
        {action.reason && (
          <Field label={t("financeiro.motivo")}>
            <Textarea
              required
              minLength={5}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {t("financeiro.cancelar")}
          </Button>
          <Button
            type="submit"
            variant={action.danger ? "danger" : "primary"}
            busy={busy}
          >
            {t(generation ? "financeiro.continuar" : "financeiro.confirmar")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
