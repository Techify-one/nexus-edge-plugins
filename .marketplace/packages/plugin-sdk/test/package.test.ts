import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import {
  validatePluginFrontend,
  validatePluginOpenApi,
} from "../src/package.js";

describe("plugin frontend packaging policy", () => {
  it("accepts browser-safe production bundles", () => {
    expect(() =>
      validatePluginFrontend(
        strToU8('const mode = "production"; export { mode };'),
      ),
    ).not.toThrow();
  });

  it("rejects unresolved Node environment lookups", () => {
    expect(() =>
      validatePluginFrontend(
        strToU8("export const mode = process.env.NODE_ENV;"),
      ),
    ).toThrow("PLUGIN_FRONTEND_NODE_ENV_UNRESOLVED");
  });
});

describe("plugin OpenAPI packaging policy", () => {
  it("accepts authenticated and declared public gateway paths", () => {
    expect(() =>
      validatePluginOpenApi(
        "demo",
        ["/callback"],
        strToU8(
          JSON.stringify({
            openapi: "3.1.0",
            paths: {
              "/api/v1/p/demo/items": {},
              "/api/v1/public/p/demo/callback/:token": {},
            },
          }),
        ),
      ),
    ).not.toThrow();
  });

  it("rejects paths outside the plugin gateways", () => {
    expect(() =>
      validatePluginOpenApi(
        "demo",
        [],
        strToU8(JSON.stringify({ openapi: "3.1.0", paths: { "/items": {} } })),
      ),
    ).toThrow("PLUGIN_OPENAPI_PATH_OUTSIDE_NAMESPACE");
  });
});
