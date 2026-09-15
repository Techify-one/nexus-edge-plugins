import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
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

const generateWebhookToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export default function AsaasSettingsPage() {
  const { locale, t } = useI18n();
  const client = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const mayUpdate = can("asaas.settings.update");
  const webhookUrl = `${window.location.origin}/api/v1/public/p/asaas/withdrawal-authorization`;
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
  const webhookStatus = useQuery({
    queryKey: ["asaas", "webhook-token-status"],
    enabled: mayUpdate,
    retry: false,
    queryFn: () =>
      api<{ configured: boolean }>(
        "/api/v1/plugins/asaas/runtime-secrets/ASAAS_WEBHOOK_TOKEN",
      ),
  });
  const saveWebhookToken = useMutation({
    mutationFn: async (value: string) => {
      const reauth = await recentReauthHeaders(
        t("asaas.settings.webhookSavePassword"),
      );
      await api("/api/v1/plugins/asaas/runtime-secrets/ASAAS_WEBHOOK_TOKEN", {
        method: "PUT",
        headers: reauth,
        body: JSON.stringify({ value }),
      });
    },
    onSuccess: () => {
      setWebhookToken("");
      toast.success(t("asaas.settings.webhookSaved"));
      void client.invalidateQueries({ queryKey: ["asaas"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteWebhookToken = useMutation({
    mutationFn: async () =>
      api("/api/v1/plugins/asaas/runtime-secrets/ASAAS_WEBHOOK_TOKEN", {
        method: "DELETE",
        headers: await recentReauthHeaders(
          t("asaas.settings.webhookDeletePassword"),
        ),
      }),
    onSuccess: () => {
      setWebhookToken("");
      toast.success(t("asaas.settings.webhookDeleted"));
      void client.invalidateQueries({ queryKey: ["asaas"] });
    },
    onError: (error: Error) => toast.error(error.message),
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
  const webhookConfigured = webhookStatus.data?.configured === true;

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
      <Card className="mt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <Webhook className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">
                  {t("asaas.settings.webhookTitle")}
                </h2>
                {mayUpdate && (
                  <Badge tone={webhookConfigured ? "success" : "neutral"}>
                    {webhookConfigured
                      ? t("asaas.settings.configured")
                      : t("asaas.settings.notConfigured")}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {t("asaas.settings.webhookDescription")}
              </p>
            </div>
          </div>
          {webhookConfigured && mayUpdate && (
            <Button
              variant="ghost"
              className="text-red-600"
              busy={deleteWebhookToken.isPending}
              onClick={() => {
                if (window.confirm(t("asaas.settings.webhookDeleteConfirm")))
                  deleteWebhookToken.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("asaas.settings.delete")}
            </Button>
          )}
        </div>
        <div className="mt-5 grid gap-4">
          <div>
            <Label htmlFor="asaas-webhook-url">
              {t("asaas.settings.webhookUrl")}
            </Label>
            <div className="flex gap-2">
              <Input id="asaas-webhook-url" value={webhookUrl} readOnly />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  toast.success(t("asaas.settings.copied"));
                }}
                aria-label={t("asaas.settings.copyUrl")}
                title={t("asaas.settings.copyUrl")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {mayUpdate && (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                const value = webhookToken.trim();
                if (value.length < 32 || value.length > 255) {
                  toast.error(t("asaas.settings.webhookInvalid"));
                  return;
                }
                saveWebhookToken.mutate(value);
              }}
            >
              <PasswordInput
                value={webhookToken}
                onChange={(event) => setWebhookToken(event.target.value)}
                placeholder={t("asaas.settings.webhookTokenPlaceholder")}
                aria-label={t("asaas.settings.webhookToken")}
                autoComplete="off"
                minLength={32}
                maxLength={255}
                required
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setWebhookToken(generateWebhookToken())}
              >
                <RefreshCw className="h-4 w-4" />
                {t("asaas.settings.generateToken")}
              </Button>
              <Button
                busy={saveWebhookToken.isPending}
                disabled={!webhookToken.trim()}
              >
                <ShieldCheck className="h-4 w-4" />
                {webhookConfigured
                  ? t("asaas.settings.replaceWebhookToken")
                  : t("asaas.settings.saveWebhookToken")}
              </Button>
            </form>
          )}
          {webhookToken && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
              {t("asaas.settings.webhookCopyBeforeSave")}
              <Button
                type="button"
                variant="ghost"
                className="ml-2"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookToken);
                  toast.success(t("asaas.settings.copied"));
                }}
              >
                <Copy className="h-4 w-4" />
                {t("asaas.settings.copyToken")}
              </Button>
            </div>
          )}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">
              {t("asaas.settings.webhookStepsTitle")}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>{t("asaas.settings.webhookStepOne")}</li>
              <li>{t("asaas.settings.webhookStepTwo")}</li>
              <li>{t("asaas.settings.webhookStepThree")}</li>
            </ol>
            <p className="mt-3 font-medium">
              {t("asaas.settings.webhookScopeWarning")}
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
