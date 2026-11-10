import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ids = [
  "crm",
  "asaas",
  "meta_ads",
  "soletrando",
  "meeting_recorder",
  "platform_probe",
  "financeiro",
];
describe("published MCP action contracts", () => {
  it.each(ids)(
    "keeps %s actions explicit, private, permission-bound and localized",
    (id) => {
      const manifest = JSON.parse(readFileSync(`${id}/manifest.json`, "utf8"));
      const document = JSON.parse(readFileSync(`${id}/openapi.json`, "utf8"));
      const names = new Set<string>();
      for (const [path, methods] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(
          methods as Record<string, any>,
        )) {
          const action = operation["x-nexus-mcp"];
          if (!action) continue;
          expect(path.startsWith(`/api/v1/p/${id}/`)).toBe(true);
          expect(path).not.toContain("__installer");
          expect(path).not.toMatch(/\/transient$|\/connection\/validate$/u);
          expect(action.name.startsWith(`${id}_`)).toBe(true);
          expect(action.name).toMatch(/^[A-Za-z0-9_]{1,128}$/u);
          expect(names.has(action.name)).toBe(false);
          names.add(action.name);
          expect(action.permissions.length).toBeGreaterThan(0);
          for (const permission of action.permissions)
            expect(manifest.permissions).toContain(permission);
          for (const permission of action.optionalPermissions ?? [])
            expect(manifest.permissions).toContain(permission);
          expect(action.titles.en).toBeTruthy();
          expect(action.titles["pt-BR"]).toBeTruthy();
          if (operation.requestBody)
            expect(
              operation.requestBody.content["application/json"].schema,
            ).toBeTruthy();
          if (method === "delete") expect(action.destructive).toBe(true);
          if (method === "get") expect(action.readOnly).toBe(true);
        }
      }
      expect(names.size).toBeGreaterThan(0);
      expect(document.info.version).toBe(manifest.version);
      expect(
        JSON.parse(readFileSync(`${id}/package.json`, "utf8")).version,
      ).toBe(manifest.version);
    },
  );
  it("retains Pix confirmation and recorder consent in the published tool inputs", () => {
    const asaas = JSON.parse(readFileSync("asaas/openapi.json", "utf8"));
    const pix = asaas.paths["/api/v1/p/asaas/pix/transfers"].post;
    expect(
      pix.requestBody.content["application/json"].schema.properties.confirmed
        .const,
    ).toBe(true);
    expect(pix["x-nexus-mcp"].destructive).toBe(true);
    const recorder = JSON.parse(
      readFileSync("meeting_recorder/openapi.json", "utf8"),
    );
    const input =
      recorder.paths["/api/v1/p/meeting_recorder/recordings"].post.requestBody
        .content["application/json"].schema;
    expect(input.required).toContain("consentAcknowledged");
    expect(input.properties.consentAcknowledged.const).toBe(true);
  });
});
