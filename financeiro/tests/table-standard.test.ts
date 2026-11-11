import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TABLE_ACTIONS_KEY,
  tableActionsWidth,
} from "../../.marketplace/packages/plugin-sdk/src/table-layout.js";

const shared = (path: string) =>
  readFileSync(new URL(`../../.marketplace/${path}`, import.meta.url), "utf8");

describe("shared plugin Actions column contract", () => {
  it("keeps bounded, persisted Actions resizing in both canonical implementations", () => {
    const react = shared(
      "frontend/src/components/ui/configurable-data-table.tsx",
    );
    const dom = shared("packages/plugin-sdk/src/table.ts");
    for (const source of [react, dom]) {
      expect(source).toContain("TABLE_ACTIONS_KEY");
      expect(source).toContain("tableActionsWidth");
      expect(source).toContain('"separator"');
      expect(source).toContain('"ArrowRight"');
      expect(source).toContain('"pointercancel"');
      expect(source).not.toContain("const actionsWidth = 144");
      expect(source).not.toContain('actionCol.style.width = "144px"');
    }
    expect(shared("frontend/src/styles/globals.css")).toContain(
      ".app-table-actions-content",
    );
    expect(shared("templates/plugin/frontend/styles.css")).toContain(
      ".nexus-table-actions-content",
    );
    expect(TABLE_ACTIONS_KEY).toBe("__nexus_actions");
    expect(tableActionsWidth(undefined)).toBe(240);
    expect(tableActionsWidth(Number.NaN)).toBe(240);
    expect(tableActionsWidth(-1)).toBe(144);
    expect(tableActionsWidth(9999)).toBe(640);
  });
});
