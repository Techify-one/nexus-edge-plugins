import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { validatePluginOpenApi } from "../src/package.js";

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
