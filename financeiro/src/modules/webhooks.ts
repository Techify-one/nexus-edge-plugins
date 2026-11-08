import type {
  PluginDatabase,
  PluginSqlStatement,
} from "@nexus/plugin-sdk/backend";

/** Operator-provisioned bindings only. Never accept destination or signing keys from user input or DB. */
export type FinanceiroWebhookBindings = {
  FINANCEIRO_WEBHOOK_SECRET?: string;
  FINANCEIRO_WEBHOOK_URL?: string;
  FINANCEIRO_WEBHOOK_ALLOWED_HOSTS?: string;
};
export type WebhookStatus = {
  enabled: boolean;
  configuration: "READY" | "MISSING_CONFIGURATION" | "INVALID_CONFIGURATION";
};
export type WebhookDispatchResult = WebhookStatus & {
  claimed: number;
  sent: number;
  retried: number;
  blocked: number;
  lostClaims: number;
};
export type WebhookDispatchOptions = {
  limit?: number;
  fetch?: typeof fetch;
  now?: () => number;
};
type Configuration = { url: string; secret: string };
type OutboxRow = Record<string, unknown> & {
  id: string;
  empresa_id: string;
  event_type: string;
  payload: string;
  created_at: string;
};
type DeliveryRow = Record<string, unknown> & {
  outbox_id: string;
  attempts: number;
  destination_sha256: string;
  body: string | null;
};

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 65_536;
const encoder = new TextEncoder();

// This is an operator trust boundary, not DNS pinning. Only provision domains whose DNS
// the operator trusts to remain public. Workers fetch cannot pin a validated DNS answer.
function publicHostname(host: string): boolean {
  if (host.length > 253 || host !== host.toLowerCase() || !host.includes("."))
    return false;
  const labels = host.split(".");
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    return false;
  if (labels.some((label) => label.startsWith("xn--"))) return false;
  const suffix = labels[labels.length - 1];
  if (!suffix || !/^[a-z]{2,63}$/.test(suffix)) return false;
  if (
    labels.some((label) =>
      [
        "localhost",
        "local",
        "localdomain",
        "internal",
        "intranet",
        "lan",
        "home",
        "corp",
      ].includes(label),
    )
  )
    return false;
  return !["test", "invalid", "example", "onion", "arpa"].includes(suffix);
}

function configuration(
  env: FinanceiroWebhookBindings,
): Configuration | WebhookStatus {
  const {
    FINANCEIRO_WEBHOOK_SECRET: secret,
    FINANCEIRO_WEBHOOK_URL: rawUrl,
    FINANCEIRO_WEBHOOK_ALLOWED_HOSTS: rawHosts,
  } = env;
  if (!secret || !rawUrl || !rawHosts)
    return { enabled: false, configuration: "MISSING_CONFIGURATION" };
  const invalid: WebhookStatus = {
    enabled: false,
    configuration: "INVALID_CONFIGURATION",
  };
  if (
    encoder.encode(secret).length < 32 ||
    encoder.encode(secret).length > 4096 ||
    rawUrl.length > 4096 ||
    rawHosts.length > 4096
  )
    return invalid;
  const hosts = rawHosts.split(",").map((host) => host.trim());
  if (hosts.length > 32 || hosts.some((host) => !publicHostname(host)))
    return invalid;
  try {
    if (rawUrl !== rawUrl.trim() || /[\x00-\x20\x7f\\]/.test(rawUrl))
      return invalid;
    const url = new URL(rawUrl);
    const authority = /^https:\/\/([^/?#]+)/i.exec(rawUrl)?.[1];
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.port ||
      authority?.toLowerCase() !== url.hostname ||
      !publicHostname(url.hostname) ||
      !hosts.includes(url.hostname)
    )
      return invalid;
    return { url: url.href, secret };
  } catch {
    return invalid;
  }
}

/** Safe for a protected configuration/status endpoint. Does not expose URL, allowlist or key. */
export function getWebhookStatus(
  env: FinanceiroWebhookBindings,
): WebhookStatus {
  const config = configuration(env);
  return "configuration" in config
    ? config
    : { enabled: true, configuration: "READY" };
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function signature(
  key: CryptoKey,
  timestamp: string,
  body: string,
): Promise<string> {
  return `v1=${hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)))}`;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Outbox events carry identifiers, not ledger/contact snapshots. Explicit projection also
// prevents a future outbox payload expansion from leaking contact details to integrations.
function eventBody(row: OutboxRow): string | null {
  if (
    !identifier(row.id) ||
    !identifier(row.empresa_id) ||
    !identifier(row.event_type) ||
    typeof row.payload !== "string" ||
    encoder.encode(row.payload).length > MAX_BODY_BYTES ||
    typeof row.created_at !== "string" ||
    row.created_at.length > 40 ||
    !Number.isFinite(Date.parse(row.created_at))
  )
    return null;
  try {
    const input: unknown = JSON.parse(row.payload);
    if (!object(input)) return null;
    const data: Record<string, unknown> = {};
    for (const field of ["requestId", "userId", "action", "empresaId"]) {
      if (input[field] !== undefined) {
        if (!identifier(input[field])) return null;
        data[field] = input[field];
      }
    }
    if (input.action !== undefined && input.action !== row.event_type)
      return null;
    if (input.empresaId !== undefined && input.empresaId !== row.empresa_id)
      return null;
    if (input.revision !== undefined) {
      if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0)
        return null;
      data.revision = input.revision;
    }
    if (input.entities !== undefined) {
      if (!Array.isArray(input.entities) || input.entities.length > 500)
        return null;
      const entities = [];
      for (const entity of input.entities) {
        if (
          !object(entity) ||
          !identifier(entity.resource) ||
          !identifier(entity.id) ||
          typeof entity.deleted !== "boolean"
        )
          return null;
        entities.push({
          resource: entity.resource,
          id: entity.id,
          deleted: entity.deleted,
        });
      }
      data.entities = entities;
    }
    const body = JSON.stringify({
      version: 1,
      id: row.id,
      type: row.event_type,
      companyId: row.empresa_id,
      createdAt: row.created_at,
      data,
    });
    return encoder.encode(body).length <= MAX_BODY_BYTES ? body : null;
  } catch {
    return null;
  }
}

function retryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
function retryDelay(attempt: number): number {
  return Math.min(3_600_000, 30_000 * 2 ** (attempt - 1));
}
function clock(now: () => number): number {
  const value = now();
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER - LEASE_MS
  )
    throw new RangeError("Invalid webhook clock.");
  return value;
}

/**
 * Call only after application commits, normally from scheduled(), awaiting it before DB close.
 * This reads committed outbox rows and never invokes fetch inside a financial write batch.
 * At-least-once: consumers must deduplicate X-Financeiro-Event-Id. A crash after acceptance
 * and before acknowledgement can repeat delivery. A dead worker is recovered after its lease.
 * Rotating URL blocks its existing backlog; no automatic retarget/requeue or user URL setter.
 * No logging, response bodies, secrets, URLs or contact payloads are retained in diagnostics.
 * DB/SDK errors propagate to the caller; only transport failures enter the retry policy.
 */
export async function processWebhookOutbox(
  db: PluginDatabase,
  env: FinanceiroWebhookBindings,
  options: WebhookDispatchOptions = {},
): Promise<WebhookDispatchResult> {
  const config = configuration(env);
  const result: WebhookDispatchResult = {
    ...("configuration" in config
      ? config
      : { enabled: true, configuration: "READY" as const }),
    claimed: 0,
    sent: 0,
    retried: 0,
    blocked: 0,
    lostClaims: 0,
  };
  if ("configuration" in config) return result;
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new RangeError("Webhook limit must be between 1 and 50.");
  const now = options.now ?? Date.now;
  const request = options.fetch ?? globalThis.fetch;
  const destinationHash = await sha256(config.url);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const startedAt = clock(now);
  const candidates = await db.query<OutboxRow>(
    `SELECT o.id,o.empresa_id,o.event_type,o.payload,o.created_at
     FROM financeiro_outbox o LEFT JOIN financeiro_webhook_deliveries d ON d.outbox_id = o.id
     WHERE o.status = 'PENDING' AND (d.outbox_id IS NULL OR
       (d.status = 'PENDING' AND (d.lease_until IS NULL OR d.lease_until <= ?) AND
         (d.attempts >= 8 OR d.next_attempt_at <= ?)))
     ORDER BY o.created_at,o.id LIMIT ?`,
    [startedAt, startedAt, limit],
  );
  for (const event of candidates) {
    const at = clock(now);
    await db.execute(
      `INSERT INTO financeiro_webhook_deliveries
       (outbox_id,status,attempts,next_attempt_at,destination_sha256,body,updated_at)
       SELECT id,'PENDING',0,?,?,?,? FROM financeiro_outbox WHERE id = ? AND status = 'PENDING'
       ON CONFLICT (outbox_id) DO NOTHING`,
      [
        at,
        destinationHash,
        eventBody(event),
        new Date(at).toISOString(),
        event.id,
      ],
    );
    const delivery = await db.first<DeliveryRow>(
      "SELECT outbox_id,attempts,destination_sha256,body FROM financeiro_webhook_deliveries WHERE outbox_id = ?",
      [event.id],
    );
    if (!delivery) continue;
    // Recover a worker that died during the final permitted attempt without a ninth send.
    if (delivery.attempts >= MAX_ATTEMPTS) {
      const token = crypto.randomUUID();
      const updates = await db.atomic([
        {
          sql: `UPDATE financeiro_webhook_deliveries SET status = 'BLOCKED',last_error = 'ATTEMPTS_EXHAUSTED',lease_token = ?,lease_until = NULL,updated_at = ? WHERE outbox_id = ? AND status = 'PENDING' AND attempts >= 8 AND (lease_until IS NULL OR lease_until <= ?)`,
          params: [token, new Date(at).toISOString(), event.id, at],
        },
        terminalOutbox(event.id, token, "BLOCKED", null),
      ]);
      if (updates[0]?.rowsAffected === 1) result.blocked++;
      continue;
    }
    const token = crypto.randomUUID();
    const claim = await db.execute(
      `UPDATE financeiro_webhook_deliveries SET attempts = attempts + 1,lease_token = ?,lease_until = ?,updated_at = ?
       WHERE outbox_id = ? AND status = 'PENDING' AND attempts = ? AND attempts < 8 AND next_attempt_at <= ?
       AND (lease_until IS NULL OR lease_until <= ?) AND EXISTS
       (SELECT 1 FROM financeiro_outbox WHERE id = ? AND status = 'PENDING')`,
      [
        token,
        at + LEASE_MS,
        new Date(at).toISOString(),
        event.id,
        delivery.attempts,
        at,
        at,
        event.id,
      ],
    );
    if (claim.rowsAffected !== 1) continue;
    result.claimed++;
    const attempt = delivery.attempts + 1;
    let state: "SENT" | "PENDING" | "BLOCKED" = "BLOCKED";
    let error: string | null =
      delivery.destination_sha256 !== destinationHash
        ? "DESTINATION_CHANGED"
        : !delivery.body
          ? "INVALID_EVENT"
          : null;
    let httpStatus: number | null = null;
    // Revalidate lease immediately before I/O, including after potentially delayed DB work.
    const dispatchAt = clock(now);
    const owned = await db.first<Record<string, unknown>>(
      `SELECT outbox_id FROM financeiro_webhook_deliveries WHERE outbox_id = ? AND lease_token = ? AND status = 'PENDING' AND lease_until > ?`,
      [event.id, token, dispatchAt],
    );
    if (!owned) {
      result.lostClaims++;
      continue;
    }
    if (!error && delivery.body) {
      const timestamp = String(Math.floor(dispatchAt / 1000));
      const signed = await signature(key, timestamp, delivery.body);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Explicit race also bounds a misbehaving injected transport that ignores AbortSignal.
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Webhook timeout."));
          }, TIMEOUT_MS);
        });
        const response = await Promise.race([
          request(config.url, {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "X-Financeiro-Event-Id": event.id,
              "X-Financeiro-Timestamp": timestamp,
              "X-Financeiro-Signature": signed,
            },
            body: delivery.body,
          }),
          timeout,
        ]);
        httpStatus = response.status;
        // Never read or log response text; release its stream without waiting on remote body.
        void response.body?.cancel().catch(() => {});
        if (response.status >= 200 && response.status < 300) state = "SENT";
        else if (retryable(response.status)) {
          state = "PENDING";
          error = "HTTP_RETRYABLE";
        } else
          error =
            response.status >= 300 && response.status < 400
              ? "REDIRECT_REJECTED"
              : "HTTP_REJECTED";
      } catch {
        state = "PENDING";
        error = controller.signal.aborted ? "TIMEOUT" : "TRANSPORT_ERROR";
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
      }
    }
    if (state === "PENDING" && attempt >= MAX_ATTEMPTS) {
      state = "BLOCKED";
      error = "ATTEMPTS_EXHAUSTED";
    }
    const completedAt = clock(now);
    const updates = await db.atomic([
      {
        sql: `UPDATE financeiro_webhook_deliveries SET status = ?,next_attempt_at = ?,lease_until = NULL,last_error = ?,last_http_status = ?,updated_at = ? WHERE outbox_id = ? AND lease_token = ? AND status = 'PENDING' AND lease_until > ?`,
        params: [
          state,
          completedAt + retryDelay(attempt),
          error,
          httpStatus,
          new Date(completedAt).toISOString(),
          event.id,
          token,
          completedAt,
        ],
      },
      ...(state !== "PENDING"
        ? [
            terminalOutbox(
              event.id,
              token,
              state,
              state === "SENT" ? new Date(completedAt).toISOString() : null,
            ),
          ]
        : []),
    ]);
    if (updates[0]?.rowsAffected !== 1) result.lostClaims++;
    else if (state === "SENT") result.sent++;
    else if (state === "BLOCKED") result.blocked++;
    else result.retried++;
  }
  return result;
}

function terminalOutbox(
  id: string,
  token: string,
  status: "SENT" | "BLOCKED",
  sentAt: string | null,
): PluginSqlStatement {
  return {
    sql: `UPDATE financeiro_outbox SET status = ?,sent_at = ? WHERE id = ? AND status = 'PENDING' AND EXISTS (SELECT 1 FROM financeiro_webhook_deliveries WHERE outbox_id = ? AND lease_token = ? AND status = ?)`,
    params: [status, sentAt, id, id, token, status],
  };
}
