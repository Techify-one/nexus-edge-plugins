import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  PasswordInput,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { can } from "../../.marketplace/frontend/src/lib/ability.js";
import {
  api,
  recentReauthHeaders,
} from "../../.marketplace/frontend/src/lib/api/core-client.js";
import { useI18n } from "../../.marketplace/frontend/src/i18n/index.js";
import { asaasApi, formatCurrency } from "./api-client.js";

const productionKey = /^\$aact_prod_[A-Za-z0-9:_-]{40,8180}$/u;

export default function AsaasSettingsPage() {
  const { locale, t } = useI18n();
  const client = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const mayUpdate = can("asaas.settings.update");
  const secretStatus = useQuery({
    queryKey: ["asaas", "api-key-status"],
    enabled: mayUpdate,
    retry: false,
    queryFn: () =>
      api<{ configured: boolean }>(
        "/api/v1/plugins/asaas/runtime-secrets/ASAAS_API_KEY",
      ),
  });
  const saveKey = useMutation({
    mutationFn: async (value: string) => {
      await asaasApi.validateConnection(value);
      const reauth = await recentReauthHeaders(
        t("asaas.settings.savePassword"),
      );
      await api("/api/v1/plugins/asaas/runtime-secrets/ASAAS_API_KEY", {
        method: "PUT",
        headers: reauth,
        body: JSON.stringify({ value }),
      });
    },
    onSuccess: () => {
      setApiKey("");
      toast.success(t("asaas.settings.saved"));
      void client.invalidateQueries({ queryKey: ["asaas"] });
    },
    onError: (error: Error) => {
      setApiKey("");
      toast.error(error.message);
    },
  });
  const deleteKey = useMutation({
    mutationFn: async () =>
      api("/api/v1/plugins/asaas/runtime-secrets/ASAAS_API_KEY", {
        method: "DELETE",
        headers: await recentReauthHeaders(t("asaas.settings.deletePassword")),
      }),
    onSuccess: () => {
      setApiKey("");
      toast.success(t("asaas.settings.deleted"));
      void client.invalidateQueries({ queryKey: ["asaas"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const testSaved = useMutation({
    mutationFn: asaasApi.testConnection,
    onSuccess: ({ balance }) =>
      toast.success(
        t("asaas.settings.connectionOk", {
          balance: formatCurrency(locale, balance),
        }),
      ),
    onError: (error: Error) => toast.error(error.message),
  });
  const configured = secretStatus.data?.configured === true;

  return (
    <>
      <PageHeader
        title={t("asaas.settings.title")}
        description={t("asaas.settings.description")}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">
                    {t("asaas.settings.apiKey")}
                  </h2>
                  {mayUpdate && (
                    <Badge tone={configured ? "success" : "neutral"}>
                      {configured
                        ? t("asaas.settings.configured")
                        : t("asaas.settings.notConfigured")}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {t("asaas.settings.apiKeyDescription")}
                </p>
              </div>
            </div>
            {configured && mayUpdate && (
              <Button
                variant="ghost"
                className="text-red-600"
                busy={deleteKey.isPending}
                onClick={() => {
                  if (window.confirm(t("asaas.settings.deleteConfirm")))
                    deleteKey.mutate();
                }}
              >
                <Trash2 className="h-4 w-4" />
                {t("asaas.settings.delete")}
              </Button>
            )}
          </div>
          {mayUpdate && (
            <form
              className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                const value = apiKey.trim();
                if (!productionKey.test(value)) {
                  toast.error(t("asaas.settings.invalidFormat"));
                  return;
                }
                saveKey.mutate(value);
              }}
            >
              <PasswordInput
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="$aact_prod_…"
                aria-label={t("asaas.settings.apiKey")}
                autoComplete="off"
                required
              />
              <Button busy={saveKey.isPending} disabled={!apiKey.trim()}>
                <ShieldCheck className="h-4 w-4" />
                {configured
                  ? t("asaas.settings.validateAndReplace")
                  : t("asaas.settings.validateAndSave")}
              </Button>
            </form>
          )}
          {configured && can("asaas.settings.read") && (
            <Button
              className="mt-4"
              variant="secondary"
              busy={testSaved.isPending}
              onClick={() => testSaved.mutate()}
            >
              <CircleCheck className="h-4 w-4" />
              {t("asaas.settings.testSaved")}
            </Button>
          )}
        </Card>
        <Card>
          <h2 className="font-semibold">{t("asaas.settings.securityTitle")}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
            <li>{t("asaas.settings.securitySecret")}</li>
            <li>{t("asaas.settings.securityNeverReturned")}</li>
            <li>{t("asaas.settings.securityProduction")}</li>
            <li>{t("asaas.settings.securityRotate")}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
