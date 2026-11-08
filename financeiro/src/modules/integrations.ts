import {
  createId,
  type PluginDatabase,
  type PluginContextV1,
} from "@nexus/plugin-sdk/backend";
import type { Bindings } from "../env.js";
import { assert } from "../errors.js";
import { today, addDays } from "../domain/dates.js";
import { money } from "../domain/money.js";
import { consistentRead } from "../db/repository.js";
import { withCompanyWrite } from "../db/write-unit.js";
export async function mayNotify(
  db: PluginDatabase,
  userId: string,
): Promise<boolean> {
  const active = db.provider === "d1" ? "u.active = 1" : "u.active = TRUE";
  const admin = db.provider === "d1" ? "g.is_admin = 1" : "g.is_admin = TRUE";
  const row = await db.first<{ id: string }>(
    `SELECT u.id FROM "user" u WHERE u.id = ? AND ${active} AND EXISTS (SELECT 1 FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = u.id AND (${admin} OR EXISTS (SELECT 1 FROM group_permissions gp JOIN permissions p ON p.id = gp.permission_id WHERE gp.group_id = gm.group_id AND p.key = 'financeiro.avisos.manage')))`,
    [userId],
  );
  return Boolean(row);
}
export async function sendNotices(
  db: PluginDatabase,
  env: Bindings,
  companyId: string,
  actor: PluginContextV1,
): Promise<{ enviados: number; duplicados: number }> {
  assert(
    env.TELEGRAM_BOT_TOKEN,
    "TELEGRAM_NOT_CONFIGURED",
    "Configure TELEGRAM_BOT_TOKEN no host.",
    503,
  );
  const data = await consistentRead(db, companyId, (s) => {
    assert(s.company.ativo === 1, "EMPRESA_INACTIVE", "Empresa inativa.", 409);
    const config = s.records.avisos[0];
    assert(config?.ativo, "AVISOS_INATIVOS", "Avisos não habilitados.", 409);
    const day = today(),
      until = addDays(day, Number(config.diasAntecedencia));
    const entries = s.records.lancamentos.filter(
      (e) =>
        !e.cancelado &&
        String(e.vencimento) <= until &&
        money(e.valorCentavos) >
          s.records.movimentos
            .filter(
              (m) => m.lancamentoId === e.id && !m.estornado && !m.estornoDeId,
            )
            .reduce((total, m) => total + money(m.valorCentavos), 0n),
    );
    return { config, entries, day };
  });
  assert(
    await mayNotify(db, String(data.config.userId)),
    "DESTINATARIO_SEM_ACESSO",
    "Usuário configurador inativo ou sem permissão de avisos.",
    403,
  );
  if (!data.entries.length) return { enviados: 0, duplicados: 0 };
  const key = `telegram:${data.day}:${String(data.config.id)}`;
  const claim = await withCompanyWrite(
    db,
    companyId,
    actor,
    "avisos.claim",
    (s) => {
      if (s.records.idempotencia.some((r) => r.chave === key)) return false;
      s.records.idempotencia.push({
        id: createId("notice"),
        empresaId: companyId,
        chave: key,
        hash: "delivery-at-most-once",
        result: { status: "CLAIMED", at: new Date().toISOString() },
      });
      return true;
    },
  );
  if (!claim) return { enviados: 0, duplicados: 1 };
  // Claim before external delivery deliberately prefers at-most-once to duplicate financial notifications.
  // An ambiguous timeout is retained for operator review, never silently retried.
  assert(
    await mayNotify(db, String(data.config.userId)),
    "DESTINATARIO_SEM_ACESSO",
    "Acesso revogado antes do envio.",
    403,
  );
  const text = `Financeiro: ${data.entries.length} lançamento(s) pendente(s) até ${addDays(data.day, Number(data.config.diasAntecedencia))}. Consulte o painel autenticado.`;
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: data.config.chatId,
        text,
        disable_notification: false,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const body = (await response.json()) as { ok?: boolean };
  assert(
    response.ok && body.ok === true,
    "TELEGRAM_DELIVERY_FAILED",
    "Telegram recusou o envio. Verifique a configuração; não houve repetição automática.",
    502,
  );
  await withCompanyWrite(db, companyId, actor, "avisos.sent", (s) => {
    const record = s.records.idempotencia.find((r) => r.chave === key);
    if (record)
      record.result = { status: "SENT", at: new Date().toISOString() };
    return null;
  });
  return { enviados: 1, duplicados: 0 };
}
