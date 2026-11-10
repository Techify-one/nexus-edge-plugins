import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../.marketplace/frontend/src/i18n/index.js";
import {
  NavLink,
  Route,
  Routes,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { definePlugin, type PluginHostV1 } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../.marketplace/frontend/src/plugin-host.js";
import { registerPluginTranslations } from "../../.marketplace/frontend/src/i18n/index.js";
import {
  Button,
  Input,
  Select,
  SingleLineFilterBar,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { FinanceApi, hasPermission, scoped } from "./api-client.js";
import { Field, ErrorBox } from "./components.js";
import { Provider, useResource } from "./context.js";
import { financeiroFrontendMessages, labelFor } from "./i18n.js";
import { today } from "./format.js";
import {
  AuditPage,
  ClosingPage,
  EntriesPage,
  RecurrencesPage,
  RegistersPage,
  SettingsPage,
  SummaryPage,
  TransfersPage,
} from "./pages.js";
import type { Account, Category, Company, List } from "./types.js";
import "../../.marketplace/frontend/src/styles/globals.css";
import "./styles.css";

registerPluginTranslations(financeiroFrontendMessages);
const root = "/app/p/financeiro";
const routes = [
  ["resumo", "resumo", SummaryPage],
  ["lancamentos", "lancamentos", EntriesPage],
  ["recorrencias", "recorrencias", RecurrencesPage],
  ["cadastros", "empresas", RegistersPage],
  ["transferencias", "transferencias", TransfersPage],
  ["fechamento", "fechamentos", ClosingPage],
  ["auditoria", "auditoria", AuditPage],
  ["configuracoes", "avisos", SettingsPage],
] as const;
export function FinanceApp({ host }: { host: PluginHostV1 }) {
  const api = useMemo(() => new FinanceApi(host), [host]);
  const compactRecurrences = useLocation().pathname.startsWith(
    `${root}/recorrencias`,
  );
  const { setLocale } = useI18n();
  useEffect(() => setLocale(host.locale), [host.locale, setLocale]);
  const t = labelFor(host.locale);
  const [params, setParams] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const can = (resource: string, action = "read") =>
    hasPermission(host, resource, action);
  const companies = useResource<List<Company>>(
    api,
    can("empresas") ? "/empresas" : null,
    refresh,
    true,
  );
  const selected = params.get("empresaId") ?? "";
  const empresaId =
    selected && companies.data?.data.some((company) => company.id === selected)
      ? selected
      : !selected
        ? (companies.data?.data.find((company) => company.ativo)?.id ??
          companies.data?.data[0]?.id ??
          "")
        : "";
  const month = params.get("mes") ?? "";
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? month
    : today().slice(0, 7);
  const accounts = useResource<List<Account>>(
    api,
    empresaId && can("contas") ? scoped("/contas", empresaId) : null,
    refresh,
    true,
  );
  const categories = useResource<List<Category>>(
    api,
    empresaId && can("categorias") ? scoped("/categorias", empresaId) : null,
    refresh,
    true,
  );
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    for (const name of [...next.keys()])
      if (name.startsWith("pagina_")) next.delete(name);
    setParams(next);
  };
  const query = new URLSearchParams(params);
  if (empresaId) query.set("empresaId", empresaId);
  query.set("mes", mes);
  return (
    <Provider
      value={{
        api,
        host,
        t,
        empresaId,
        mes,
        accounts: accounts.data?.data ?? [],
        categories: categories.data?.data ?? [],
        companies: companies.data?.data ?? [],
        refresh,
        reload: () => setRefresh((value) => value + 1),
        can,
      }}
    >
      <div className="financeiro space-y-3" data-theme={host.theme}>
        <nav
          aria-label={t("financeiro.cadastros")}
          className="financeiro-tabs flex gap-1 overflow-x-auto border-b pb-2"
        >
          {routes
            .filter(([, resource]) => can(resource))
            .map(([path]) => (
              <NavLink
                key={path}
                to={{
                  pathname: path === "resumo" ? root : `${root}/${path}`,
                  search: `?${query}`,
                }}
                end={path === "resumo"}
                className={({ isActive }) =>
                  `shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? "app-card border" : "text-slate-500"}`
                }
              >
                {t(`financeiro.${path}`)}
              </NavLink>
            ))}
        </nav>
        {(!compactRecurrences || !empresaId) && (
          <SingleLineFilterBar>
            <Field label={t("financeiro.empresa")}>
              <Select
                value={empresaId}
                aria-label={t("financeiro.empresa")}
                onChange={(e) => change("empresaId", e.target.value)}
              >
                <option value="">{t("financeiro.selecione")}</option>
                {companies.data?.data.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.nome}
                    {company.ativo ? "" : ` (${t("financeiro.inativo")})`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("financeiro.mes")}>
              <Input
                type="month"
                aria-label={t("financeiro.mes")}
                value={mes}
                onChange={(e) => change("mes", e.target.value)}
              />
            </Field>
            <div className="flex items-end justify-end">
              <Button
                variant="secondary"
                onClick={() => setRefresh((value) => value + 1)}
              >
                {t("financeiro.atualizar")}
              </Button>
            </div>
          </SingleLineFilterBar>
        )}
        <ErrorBox
          error={companies.error || accounts.error || categories.error}
        />
        <Routes>
          <Route path={root} element={<SummaryPage />} />
          {routes.map(([path, , Page]) => (
            <Route
              key={path}
              path={`${root}/${path}`}
              element={<Page key={`${empresaId}:${path}`} />}
            />
          ))}
          <Route path="*" element={<SummaryPage />} />
        </Routes>
      </div>
    </Provider>
  );
}
export default definePlugin({
  mountPage({ container, host }) {
    return mountReactPlugin(container, host, <FinanceApp host={host} />);
  },
});
