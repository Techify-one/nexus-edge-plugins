import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import {
  createPluginDatabase,
  type PluginContextV1,
  type PluginInstallerContextV1,
} from "@nexus/plugin-sdk/backend";

type ProbeMessage = { id: string; sentAt: string };
type Bindings = {
  DATABASE_PROVIDER: "d1" | "postgres";
  DB?: D1Database;
  HYPERDRIVE?: Hyperdrive;
  PROBE_BUCKET: R2Bucket;
  PROBE_KV: KVNamespace;
  PROBE_QUEUE: Queue<ProbeMessage>;
  PROBE_DLQ: Queue<ProbeMessage>;
  PROBE_OBJECT: DurableObjectNamespace<PlatformProbeObject>;
};
type Variables = {
  pluginContext?: PluginContextV1;
  installerContext?: PluginInstallerContextV1;
};
type Env = { Bindings: Bindings; Variables: Variables };

const decodeContext = (value: string): unknown => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
  );
};

export class PlatformProbeObject extends DurableObject<Bindings> {
  async fetch(): Promise<Response> {
    const count = ((await this.ctx.storage.get<number>("count")) ?? 0) + 1;
    await this.ctx.storage.put("count", count);
    return Response.json({ count });
  }
}

const app = new Hono<Env>();
app.get("/health", (c) =>
  c.json({ ok: true, plugin: "platform_probe", version: "1.0.1" }),
);
app.use("/*", async (c, next) => {
  if (c.req.path === "/health") return next();
  const authenticated = c.req.header("X-Plugin-Context");
  const installer = c.req.header("X-Plugin-Installer-Context");
  if (Boolean(authenticated) === Boolean(installer))
    return c.json({ error: { code: "PLUGIN_CONTEXT_REQUIRED" } }, 401);
  try {
    const context = decodeContext(authenticated ?? installer!);
    if (!context || typeof context !== "object") throw new Error("invalid");
    if (authenticated) {
      const selected = context as PluginContextV1;
      if (!selected.userId || !Array.isArray(selected.permissions))
        throw new Error("invalid");
      c.set("pluginContext", selected);
    } else {
      const selected = context as PluginInstallerContextV1;
      if (selected.pluginId !== "platform_probe" || !selected.operationId)
        throw new Error("invalid");
      c.set("installerContext", selected);
    }
  } catch {
    return c.json({ error: { code: "INVALID_PLUGIN_CONTEXT" } }, 401);
  }
  await next();
});

const runProbe = async (env: Bindings, source: string) => {
  const id = `probe_${crypto.randomUUID().replaceAll("-", "")}`;
  const objectKey = `${id}.txt`;
  await env.PROBE_BUCKET.put(objectKey, id);
  const r2 = (await env.PROBE_BUCKET.get(objectKey))
    ? await (await env.PROBE_BUCKET.get(objectKey))!.text()
    : null;
  await env.PROBE_BUCKET.delete(objectKey);

  await env.PROBE_KV.put(id, source);
  const kv = await env.PROBE_KV.get(id);
  await env.PROBE_KV.delete(id);

  const stub = env.PROBE_OBJECT.getByName("installer-smoke");
  const durable = (await (
    await stub.fetch("https://platform-probe.internal/increment")
  ).json()) as { count: number };

  await env.PROBE_QUEUE.send({ id, sentAt: new Date().toISOString() });
  return {
    id,
    r2: r2 === id,
    kv: kv === source,
    queue: true,
    durableObject: durable.count >= 1,
    cron: true,
  };
};

app.post("/__installer/smoke", async (c) => {
  if (!c.get("installerContext"))
    return c.json({ error: { code: "INSTALLER_CONTEXT_REQUIRED" } }, 403);
  const result = await runProbe(c.env, "installer");
  const db = await createPluginDatabase(c.env);
  const now = db.provider === "d1" ? Date.now() : new Date();
  await db.execute(
    "INSERT INTO platform_probe_runs(id, source, created_at) VALUES (?, ?, ?)",
    [result.id, "installer", now],
  );
  const stored = await db.first<{ id: string }>(
    "SELECT id FROM platform_probe_runs WHERE id = ?",
    [result.id],
  );
  await db.execute("DELETE FROM platform_probe_runs WHERE id = ?", [result.id]);
  await db.close();
  return c.json({ ok: stored?.id === result.id, ...result, database: true });
});

app.post("/run", async (c) => {
  if (
    !c.get("pluginContext")?.permissions.includes("platform_probe.status.read")
  )
    return c.json({ error: { code: "FORBIDDEN" } }, 403);
  return c.json({ ok: true, ...(await runProbe(c.env, "user")) });
});

const worker = {
  fetch: app.fetch,
  async queue(batch: MessageBatch<ProbeMessage>, env: Bindings) {
    await Promise.all(
      batch.messages.map(async (message) => {
        await env.PROBE_KV.put(
          `queue:${message.body.id}`,
          message.body.sentAt,
          {
            expirationTtl: 3_600,
          },
        );
        message.ack();
      }),
    );
  },
  async scheduled(controller: ScheduledController, env: Bindings) {
    await env.PROBE_KV.put("cron:last", String(controller.scheduledTime));
  },
};

export default worker;
