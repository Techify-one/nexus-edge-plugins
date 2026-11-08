import { createContext, useContext, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PluginHostV1 } from "@nexus/plugin-sdk";
import { FinanceApi, hasPermission, scoped } from "./api-client.js";
import { labelFor, type Label } from "./i18n.js";
import type { Account, Category, Company, List } from "./types.js";

export type FinanceContext = {
  api: FinanceApi;
  host: PluginHostV1;
  t: Label;
  empresaId: string;
  mes: string;
  accounts: Account[];
  categories: Category[];
  companies: Company[];
  refresh: number;
  reload(): void;
  can(resource: string, action?: string): boolean;
};
const Context = createContext<FinanceContext | null>(null);
export const Provider = Context.Provider;
export function useFinance(): FinanceContext {
  const value = useContext(Context);
  if (!value) throw new Error("Finance context unavailable");
  return value;
}
export { labelFor, hasPermission, scoped };
export type Resource<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
};
export function useResource<T>(
  api: FinanceApi,
  path: string | null,
  revision = 0,
  allPages = false,
): Resource<T> {
  const [state, setState] = useState<Resource<T> & { key: string | null }>({
    data: undefined,
    error: null,
    loading: Boolean(path),
    key: null,
  });
  useEffect(() => {
    const abort = new AbortController();
    setState((current) => ({
      data: current.key === path ? current.data : undefined,
      error: null,
      loading: Boolean(path),
      key: path,
    }));
    const load = async () => {
      const first = await api.get<T>(path!, abort.signal);
      if (!allPages) return first;
      const page = first as List<unknown>;
      const rows = [...page.data];
      while (rows.length < page.total) {
        const nextPath = new URL(path!, "https://plugin.invalid");
        nextPath.searchParams.set("offset", String(rows.length));
        nextPath.searchParams.set("limit", "200");
        const next = await api.get<List<unknown>>(
          `${nextPath.pathname}${nextPath.search}`,
          abort.signal,
        );
        if (!next.data.length) break;
        rows.push(...next.data);
      }
      return { ...page, data: rows, total: rows.length } as T;
    };
    if (path)
      void load()
        .then((data) => {
          if (!abort.signal.aborted)
            setState({ data, error: null, loading: false, key: path });
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setState({ data: undefined, error, loading: false, key: path });
        });
    return () => abort.abort();
  }, [api, path, revision, allPages]);
  // A company or URL change must never render the previous company's cached records.
  return state.key === path
    ? state
    : { data: undefined, error: null, loading: Boolean(path) };
}
export function useList<T>(
  resource: string,
  params: Record<string, string> = {},
): Resource<List<T>> {
  const { api, empresaId, can, refresh } = useFinance();
  const [search] = useSearchParams();
  const raw = Number(search.get(`pagina_${resource}`) ?? 0);
  const offset = Number.isSafeInteger(raw) && raw >= 0 ? raw * 100 : 0;
  return useResource<List<T>>(
    api,
    empresaId && can(resource)
      ? scoped(`/${resource}`, empresaId, {
          ...params,
          offset: String(offset),
          limit: "100",
        })
      : null,
    refresh,
  );
}
