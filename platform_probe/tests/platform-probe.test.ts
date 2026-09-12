import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Cloudflare platform probe", () => {
  it("declares every generic platform resource without Core registration", () => {
    const manifest = JSON.parse(
      readFileSync("platform_probe/manifest.json", "utf8"),
    ) as {
      id: string;
      packageFormat: number;
      resources: Array<{ type: string; binding: string }>;
    };
    expect(manifest.id).toBe("platform_probe");
    expect(manifest.packageFormat).toBe(2);
    expect(new Set(manifest.resources.map(({ binding }) => binding)).size).toBe(
      manifest.resources.length,
    );
    expect(new Set(manifest.resources.map(({ type }) => type))).toEqual(
      new Set(["r2", "kv", "queue", "durable_object", "cron"]),
    );
  });

  it("exports runtime handlers and uses only the public SDK", () => {
    const source = readFileSync("platform_probe/src/index.ts", "utf8");
    expect(source).toContain("export class PlatformProbeObject");
    expect(source).toContain("async queue(");
    expect(source).toContain("async scheduled(");
    expect(source).toContain('from "@nexus/plugin-sdk/backend"');
    expect(source).not.toContain("@app/");
    expect(source).not.toContain("workers/core");
  });
});
