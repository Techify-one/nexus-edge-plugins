import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import type { PluginHostV1 } from "@nexus/plugin-sdk";
import { I18nProvider } from "./i18n/index.js";
import { ability } from "./lib/ability.js";

const permissionRules = (permissions: readonly string[]) =>
  permissions.flatMap((permission) => {
    const [namespace, resource, action] = permission.split(".");
    return namespace && resource && action
      ? [{ action, subject: `${namespace}.${resource}` }]
      : [];
  });

export const preparePluginHost = (host: PluginHostV1): void => {
  ability.update(permissionRules(host.permissions));
  try {
    localStorage.setItem("modular.language", host.locale);
  } catch {
    // The plugin remains usable when browser storage is unavailable.
  }
};

export const PluginProviders = ({
  host,
  children,
}: {
  host: PluginHostV1;
  children: ReactNode;
}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: 1 },
      mutations: { retry: false },
    },
  });
  preparePluginHost(host);
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
        <Toaster richColors position="top-right" theme={host.theme} />
      </QueryClientProvider>
    </I18nProvider>
  );
};

export const mountReactPlugin = (
  container: HTMLElement,
  host: PluginHostV1,
  content: ReactNode,
): { root: Root; dispose(): void } => {
  const root = createRoot(container);
  root.render(<PluginProviders host={host}>{content}</PluginProviders>);
  return { root, dispose: () => root.unmount() };
};
