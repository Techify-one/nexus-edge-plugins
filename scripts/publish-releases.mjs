import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const run = (args) => {
  const result = spawnSync("gh", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`gh ${args[0]} failed`);
};
const releaseExists = (tag) =>
  spawnSync("gh", ["release", "view", tag], { stdio: "ignore" }).status === 0;
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const publishImmutable = (tag, asset, title, notes) => {
  if (!releaseExists(tag)) {
    run(["release", "create", tag, asset, "--title", title, "--notes", notes]);
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "nexus-release-"));
  try {
    run([
      "release",
      "download",
      tag,
      "--pattern",
      basename(asset),
      "--dir",
      directory,
    ]);
    if (sha256(asset) !== sha256(join(directory, basename(asset))))
      throw new Error(`${tag} already exists with different bytes`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

for (const id of readdirSync("plugins").sort()) {
  const manifestPath = join("plugins", id, "manifest.json");
  const asset = join("plugins", id, "release", `${id}.plugin.zip`);
  if (!existsSync(manifestPath) || !existsSync(asset)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const tag = `${id}-v${manifest.version}`;
  publishImmutable(
    tag,
    asset,
    `${manifest.name} ${manifest.version}`,
    `Signed Nexus Edge plugin release for ${manifest.id}.`,
  );
}

const sdkAsset = readdirSync("sdk-release")
  .filter((name) => name.endsWith(".tgz"))
  .sort()[0];
if (!sdkAsset) throw new Error("SDK package was not generated");
const sdkPath = join("sdk-release", sdkAsset);
const sdkManifest = JSON.parse(
  readFileSync("packages/plugin-sdk/package.json", "utf8"),
);
const sdkTag = `plugin-sdk-v${sdkManifest.version}`;
publishImmutable(
  sdkTag,
  sdkPath,
  `Nexus Plugin SDK ${sdkManifest.version}`,
  `Public SDK artifact ${basename(sdkPath)}.`,
);
