import { hc } from "hono/client";
export const crmRpc = hc("/api/v1/p/crm", {
  init: { credentials: "include" },
});
