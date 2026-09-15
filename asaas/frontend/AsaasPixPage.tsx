import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, RefreshCw, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfigurableDataTable } from "../../.marketplace/frontend/src/components/ui/configurable-data-table.js";
import {
  Badge,
  Button,
  Card,
  DataValue,
  Input,
  Label,
  MetricCard,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { can } from "../../.marketplace/frontend/src/lib/ability.js";
import { useI18n } from "../../.marketplace/frontend/src/i18n/index.js";
import { asaasApi, formatCurrency, formatDate } from "./api-client.js";
import type { PixKeyType, PixTransfer } from "./types.js";

const transferTone = (
  status: string,
): "neutral" | "success" | "warning" | "danger" => {
  if (status === "DONE") return "success";
  if (["FAILED", "CANCELLED", "REFUSED"].includes(status)) return "danger";
  if (["UNKNOWN", "SUBMITTING"].includes(status)) return "warning";
  return "neutral";
};

const authorizationTone = (
  status: PixTransfer["authorizationStatus"],
): "neutral" | "success" | "danger" => {
  if (status === "APPROVED") return "success";
  if (status === "REFUSED") return "danger";
  return "neutral";
};

const localizedAmount = (value: string): number => {
  const compact = value.trim().replace(/\s/gu, "");
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./gu : /,/gu;
    return Number(compact.replace(thousands, "").replace(decimal, "."));
  }
  return Number(compact.replace(",", "."));
};

export default function AsaasPixPage() {
  const { locale, t } = useI18n();
  const client = useQueryClient();
  const [keyType, setKeyType] = useState<PixKeyType>("CPF");
  const [pixKey, setPixKey] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [lastTransfer, setLastTransfer] = useState<PixTransfer | null>(null);
  const balance = useQuery({
    queryKey: ["asaas", "balance"],
    queryFn: asaasApi.balance,
    enabled: can("asaas.balance.read"),
    retry: false,
  });
  const transfers = useQuery({
    queryKey: ["asaas", "pix-transfers"],
    queryFn: asaasApi.transfers,
    enabled: can("asaas.pix.read"),
    retry: false,
  });
  const sendPix = useMutation({
    mutationFn: async (input: {
      numericAmount: number;
      pixAddressKey: string;
      pixAddressKeyType: PixKeyType;
      description?: string | undefined;
    }) => {
      const { recipient } = await asaasApi.inspectPixKey(input);
      const confirmed = window.confirm(
        t("asaas.pix.confirmRecipient", {
          value: formatCurrency(locale, input.numericAmount),
          name: recipient.ownerName,
          document: recipient.ownerDocument,
          institution: recipient.institutionName,
          key: recipient.pixKeyMasked,
        }),
      );
      if (!confirmed) return null;
      return asaasApi.sendPix({
        value: input.numericAmount.toFixed(2),
        pixAddressKey: input.pixAddressKey,
        pixAddressKeyType: input.pixAddressKeyType,
        description: input.description,
      });
    },
    onSuccess: (result) => {
      if (!result) return;
      const { transfer } = result;
      setLastTransfer(transfer);
      setPixKey("");
      setAmount("");
      setDescription("");
      toast.success(t("asaas.pix.submitted"));
      void client.invalidateQueries({ queryKey: ["asaas", "balance"] });
      void client.invalidateQueries({ queryKey: ["asaas", "pix-transfers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const refreshTransfer = useMutation({
    mutationFn: asaasApi.refreshTransfer,
    onSuccess: ({ transfer }) => {
      setLastTransfer((current) =>
        current?.id === transfer.id ? transfer : current,
      );
      void client.invalidateQueries({ queryKey: ["asaas", "pix-transfers"] });
      toast.success(t("asaas.pix.statusUpdated"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title={t("asaas.pix.title")}
        description={t("asaas.pix.description")}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
        {can("asaas.pix.create") && (
          <Card>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const numericAmount = localizedAmount(amount);
                if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
                  toast.error(t("asaas.pix.amountInvalid"));
                  return;
                }
                sendPix.mutate({
                  numericAmount,
                  pixAddressKey: pixKey,
                  pixAddressKeyType: keyType,
                  description: description.trim() || undefined,
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                <div>
                  <Label htmlFor="asaas-pix-type">
                    {t("asaas.pix.keyType")}
                  </Label>
                  <Select
                    id="asaas-pix-type"
                    value={keyType}
                    onChange={(event) =>
                      setKeyType(event.target.value as PixKeyType)
                    }
                  >
                    <option value="CPF">CPF</option>
                    <option value="CNPJ">CNPJ</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="PHONE">{t("asaas.pix.phone")}</option>
                    <option value="EVP">{t("asaas.pix.randomKey")}</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="asaas-pix-key">{t("asaas.pix.key")}</Label>
                  <Input
                    id="asaas-pix-key"
                    value={pixKey}
                    onChange={(event) => setPixKey(event.target.value)}
                    required
                    maxLength={254}
                    autoComplete="off"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="asaas-pix-value">{t("asaas.pix.amount")}</Label>
                <Input
                  id="asaas-pix-value"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  required
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="asaas-pix-description">
                  {t("asaas.pix.transferDescription")}
                </Label>
                <Textarea
                  id="asaas-pix-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                {t("asaas.pix.warning")}
              </div>
              <Button
                busy={sendPix.isPending}
                disabled={!pixKey.trim() || !amount.trim()}
              >
                <Send className="h-4 w-4" />
                {t("asaas.pix.reviewAndSend")}
              </Button>
            </form>
          </Card>
        )}
        <div className="space-y-4">
          {can("asaas.balance.read") &&
            (balance.isPending ? (
              <Skeleton className="h-28" />
            ) : (
              <MetricCard
                label={t("asaas.availableBalance")}
                value={
                  balance.data
                    ? formatCurrency(locale, balance.data.balance)
                    : "—"
                }
                tone="success"
              />
            ))}
          {lastTransfer && (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CircleDollarSign className="h-5 w-5 text-indigo-700" />
                  <h2 className="font-semibold">
                    {t("asaas.pix.lastSubmission")}
                  </h2>
                </div>
                <Badge tone={transferTone(lastTransfer.status)}>
                  {lastTransfer.status}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                {lastTransfer.pixKeyMasked}
              </p>
              <p className="mt-1 text-xl font-bold">
                {formatCurrency(locale, lastTransfer.valueCents / 100)}
              </p>
              <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                <span>{t("asaas.pix.authorization")}</span>
                <Badge
                  tone={authorizationTone(lastTransfer.authorizationStatus)}
                >
                  {t(
                    `asaas.pix.authorization.${lastTransfer.authorizationStatus}`,
                  )}
                </Badge>
              </div>
            </Card>
          )}
        </div>
      </div>
      {can("asaas.pix.read") && (
        <div className="mt-5">
          <h2 className="mb-3 text-lg font-semibold">
            {t("asaas.pix.history")}
          </h2>
          {transfers.isPending ? (
            <Skeleton className="h-64" />
          ) : (
            <ConfigurableDataTable
              tableId="plugin.asaas.pix_transfers"
              rows={transfers.data?.items ?? []}
              onOpen={setLastTransfer}
              emptyTitle={t("asaas.pix.empty")}
              emptyDescription={t("asaas.pix.emptyDescription")}
              columns={[
                {
                  key: "created_at",
                  label: t("common.date"),
                  render: (row) => formatDate(locale, row.createdAt),
                  sortValue: (row) => String(row.createdAt),
                  size: 170,
                  minSize: 120,
                  maxSize: 280,
                },
                {
                  key: "pix_key",
                  label: t("asaas.pix.destination"),
                  render: (row) => `${row.pixKeyType} · ${row.pixKeyMasked}`,
                  sortValue: (row) => `${row.pixKeyType}-${row.pixKeyMasked}`,
                  size: 260,
                  minSize: 170,
                  maxSize: 520,
                },
                {
                  key: "value",
                  label: t("asaas.pix.amount"),
                  render: (row) => (
                    <DataValue tone="warning">
                      {formatCurrency(locale, row.valueCents / 100)}
                    </DataValue>
                  ),
                  sortValue: (row) => row.valueCents,
                  size: 170,
                  minSize: 130,
                  maxSize: 260,
                },
                {
                  key: "description",
                  label: t("asaas.pix.transferDescription"),
                  render: (row) => row.description || "—",
                  sortValue: (row) => row.description || "",
                  size: 280,
                  minSize: 160,
                  maxSize: 620,
                },
                {
                  key: "authorization_status",
                  label: t("asaas.pix.authorization"),
                  render: (row) => (
                    <Badge tone={authorizationTone(row.authorizationStatus)}>
                      {t(`asaas.pix.authorization.${row.authorizationStatus}`)}
                    </Badge>
                  ),
                  sortValue: (row) => row.authorizationStatus,
                  size: 170,
                  minSize: 130,
                  maxSize: 260,
                },
                {
                  key: "status",
                  label: t("common.status"),
                  render: (row) => (
                    <Badge tone={transferTone(row.status)}>{row.status}</Badge>
                  ),
                  sortValue: (row) => row.status,
                  size: 150,
                  minSize: 110,
                  maxSize: 240,
                },
              ]}
              actions={(row) =>
                row.asaasTransferId ? (
                  <Button
                    variant="ghost"
                    className="px-2"
                    busy={refreshTransfer.isPending}
                    onClick={() => refreshTransfer.mutate(row.id)}
                    aria-label={t("asaas.pix.refreshStatus")}
                    title={t("asaas.pix.refreshStatus")}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                ) : null
              }
            />
          )}
        </div>
      )}
    </>
  );
}
