import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfigurableDataTable } from "../../.marketplace/frontend/src/components/ui/configurable-data-table.js";
import {
  Button,
  DataValue,
  Input,
  Label,
  PageHeader,
  SingleLineFilterBar,
  Skeleton,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { useI18n } from "../../.marketplace/frontend/src/i18n/index.js";
import { asaasApi, formatCurrency, formatDate } from "./api-client.js";

const isoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const initialDates = () => {
  const finish = new Date();
  const start = new Date(finish);
  start.setDate(start.getDate() - 30);
  return { startDate: isoDate(start), finishDate: isoDate(finish) };
};

export default function AsaasStatementPage() {
  const { locale, t } = useI18n();
  const initial = useMemo(initialDates, []);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [finishDate, setFinishDate] = useState(initial.finishDate);
  const [applied, setApplied] = useState(initial);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const statement = useQuery({
    queryKey: ["asaas", "statement", applied, offset],
    retry: false,
    queryFn: () => {
      const query = new URLSearchParams({
        startDate: applied.startDate,
        finishDate: applied.finishDate,
        offset: String(offset),
        limit: String(limit),
        order: "desc",
      });
      return asaasApi.statement(query);
    },
  });

  return (
    <>
      <PageHeader
        title={t("asaas.statement.sectionTitle")}
        description={t("asaas.statement.description")}
        action={
          <Button
            variant="secondary"
            busy={statement.isFetching}
            onClick={() => void statement.refetch()}
          >
            <RefreshCw className="h-4 w-4" />
            {t("asaas.refresh")}
          </Button>
        }
      />
      <form
        className="mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setApplied({ startDate, finishDate });
        }}
      >
        <SingleLineFilterBar>
          <div>
            <Label htmlFor="asaas-statement-start">
              {t("asaas.statement.startDate")}
            </Label>
            <Input
              id="asaas-statement-start"
              type="date"
              value={startDate}
              max={finishDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="asaas-statement-finish">
              {t("asaas.statement.finishDate")}
            </Label>
            <Input
              id="asaas-statement-finish"
              type="date"
              value={finishDate}
              min={startDate}
              onChange={(event) => setFinishDate(event.target.value)}
              required
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full">
              <Search className="h-4 w-4" />
              {t("asaas.statement.filter")}
            </Button>
          </div>
        </SingleLineFilterBar>
      </form>
      {statement.isPending ? (
        <Skeleton className="h-72" />
      ) : (
        <ConfigurableDataTable
          tableId="plugin.asaas.statement"
          rows={statement.data?.data ?? []}
          onOpen={(row) =>
            toast.info(
              `${formatDate(locale, row.date)} · ${row.description} · ${formatCurrency(locale, row.value)}`,
            )
          }
          emptyTitle={t("asaas.statement.empty")}
          emptyDescription={t("asaas.statement.emptyDescription")}
          columns={[
            {
              key: "date",
              label: t("common.date"),
              render: (row) => formatDate(locale, row.date),
              sortValue: (row) => row.date,
              size: 160,
              minSize: 120,
              maxSize: 260,
            },
            {
              key: "description",
              label: t("asaas.statement.movement"),
              render: (row) => row.description,
              sortValue: (row) => row.description,
              size: 340,
              minSize: 180,
              maxSize: 800,
            },
            {
              key: "type",
              label: t("asaas.statement.type"),
              render: (row) => row.type,
              sortValue: (row) => row.type,
              size: 240,
              minSize: 150,
              maxSize: 520,
            },
            {
              key: "value",
              label: t("asaas.statement.value"),
              render: (row) => (
                <DataValue tone={row.value >= 0 ? "success" : "warning"}>
                  {formatCurrency(locale, row.value)}
                </DataValue>
              ),
              sortValue: (row) => row.value,
              size: 170,
              minSize: 130,
              maxSize: 260,
            },
            {
              key: "balance",
              label: t("asaas.statement.balanceAfter"),
              render: (row) =>
                row.balance === null
                  ? "—"
                  : formatCurrency(locale, row.balance),
              sortValue: (row) => row.balance,
              size: 180,
              minSize: 130,
              maxSize: 280,
            },
          ]}
        />
      )}
      {statement.data && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>
            {t("asaas.statement.total", {
              total: String(statement.data.totalCount),
            })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() =>
                setOffset((current) => Math.max(0, current - limit))
              }
            >
              <ChevronLeft className="h-4 w-4" />
              {t("asaas.previous")}
            </Button>
            <Button
              variant="secondary"
              disabled={!statement.data.hasMore}
              onClick={() => setOffset((current) => current + limit)}
            >
              {t("asaas.next")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
