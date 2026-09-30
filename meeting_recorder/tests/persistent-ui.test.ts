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

  it("refreshes the shared query cache when a capture starts or ends", () => {
    // The provider lives outside the route pages. Without this the recordings
    // table keeps stale rows after Stop until the page is reloaded.
    const provider = readFileSync(
      "meeting_recorder/frontend/MeetingRecorderSessionProvider.tsx",
      "utf8",
    );
    expect(provider).toContain("useQueryClient");
    expect(provider).toContain(
      'invalidateQueries({ queryKey: ["meeting-recorder"] })',
    );
    const stop = provider.slice(
      provider.indexOf("const stop = useCallback"),
      provider.indexOf("const recover = useCallback"),
    );
    expect(stop.match(/refreshLists\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
