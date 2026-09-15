import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileClock, KeyRound, RefreshCw, Send } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  MetricCard,
  PageHeader,
  Skeleton,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { can } from "../../.marketplace/frontend/src/lib/ability.js";
import { useI18n } from "../../.marketplace/frontend/src/i18n/index.js";
import { asaasApi, formatCurrency } from "./api-client.js";

export default function AsaasDashboardPage() {
  const { locale, t } = useI18n();
  const mayReadBalance = can("asaas.balance.read");
  const balance = useQuery({
    queryKey: ["asaas", "balance"],
    queryFn: asaasApi.balance,
    enabled: mayReadBalance,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  return (
    <>
      <PageHeader
        title={t("asaas.title")}
        description={t("asaas.description")}
        action={
          mayReadBalance ? (
            <Button
              variant="secondary"
              busy={balance.isFetching}
              onClick={() => void balance.refetch()}
            >
              <RefreshCw className="h-4 w-4" />
              {t("asaas.refresh")}
            </Button>
          ) : undefined
        }
      />
      {mayReadBalance &&
        (balance.isPending ? (
          <Skeleton className="h-28" />
        ) : balance.data ? (
          <MetricCard
            className="max-w-md"
            label={t("asaas.availableBalance")}
            value={formatCurrency(locale, balance.data.balance)}
            tone="success"
          />
        ) : (
          <Card className="border-amber-200">
            <p className="font-semibold">{t("asaas.connectionRequired")}</p>
            <p className="mt-1 text-sm text-slate-500">
              {t("asaas.connectionRequiredDescription")}
            </p>
            {can("asaas.settings.update") && (
              <Link
                className="mt-4 inline-flex items-center gap-2 font-semibold text-indigo-700"
                to="/app/p/asaas/settings"
              >
                <KeyRound className="h-4 w-4" />
                {t("asaas.configure")}
              </Link>
            )}
          </Card>
        ))}
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {can("asaas.statement.read") && (
          <QuickLink
            to="/app/p/asaas/statement"
            icon={<FileClock className="h-5 w-5" />}
            title={t("asaas.statement.title")}
            description={t("asaas.statement.cardDescription")}
          />
        )}
        {can("asaas.pix.create") && (
          <QuickLink
            to="/app/p/asaas/pix"
            icon={<Send className="h-5 w-5" />}
            title={t("asaas.pix.title")}
            description={t("asaas.pix.cardDescription")}
          />
        )}
        {can("asaas.settings.read") && (
          <QuickLink
            to="/app/p/asaas/settings"
            icon={<KeyRound className="h-5 w-5" />}
            title={t("asaas.settings.title")}
            description={t("asaas.settings.cardDescription")}
          />
        )}
      </div>
    </>
  );
}

function QuickLink({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group block rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <Card className="h-full transition group-hover:border-indigo-300">
        <div className="flex items-center justify-between">
          <span className="text-indigo-700">{icon}</span>
          <ArrowRight className="h-4 w-4 text-slate-400" />
        </div>
        <h2 className="mt-4 font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </Card>
    </Link>
  );
}
