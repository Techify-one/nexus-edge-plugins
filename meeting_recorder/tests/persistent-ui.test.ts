import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Meeting Recorder dynamic lifecycle", () => {
  it("keeps the capture provider mounted while pages are replaced", () => {
    const manifest = JSON.parse(
      readFileSync("meeting_recorder/manifest.json", "utf8"),
    ) as { frontend: { persistentSurface: boolean } };
    const entry = readFileSync("meeting_recorder/frontend/entry.tsx", "utf8");
    expect(manifest.frontend.persistentSurface).toBe(true);
    expect(entry).toContain("mountSurface");
    expect(entry).toContain("createPortal");
    expect(entry).toContain("MeetingRecorderSessionProvider");
  });
});
