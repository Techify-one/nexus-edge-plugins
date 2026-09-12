import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { canonicalPluginJson } from "../packages/plugin-sdk/dist/package.js";

const catalog = JSON.parse(readFileSync("nexus-marketplace.json", "utf8"));
const rawPublicKey = Buffer.from(catalog.publisher.publicKey, "base64url");
const publicKey = createPublicKey({
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    rawPublicKey,
  ]),
  format: "der",
  type: "spki",
});
const { signature, ...payload } = catalog;
if (
  !verify(
    null,
    Buffer.from(canonicalPluginJson(payload)),
    publicKey,
    Buffer.from(signature.value, "base64url"),
  )
)
  throw new Error("Marketplace signature is invalid");

for (const plugin of catalog.plugins) {
  for (const release of plugin.releases) {
    const archive = readFileSync(
      `${plugin.id}/release/${plugin.id}.plugin.zip`,
    );
    const hash = createHash("sha256").update(archive).digest("base64url");
    if (hash !== release.artifact.sha256)
      throw new Error(`${plugin.id}: catalog archive hash mismatch`);
    if (
      !verify(
        null,
        archive,
        publicKey,
        Buffer.from(release.artifact.signature, "base64url"),
      )
    )
      throw new Error(`${plugin.id}: catalog archive signature is invalid`);
    const files = unzipSync(archive);
    const integrity = JSON.parse(strFromU8(files["integrity.json"]));
    const packageSignature = JSON.parse(strFromU8(files["signature.json"]));
    if (
      !verify(
        null,
        Buffer.from(canonicalPluginJson(integrity)),
        publicKey,
        Buffer.from(packageSignature.signature, "base64url"),
      )
    )
      throw new Error(`${plugin.id}: package signature is invalid`);
    for (const [path, expected] of Object.entries(integrity.files)) {
      const bytes = files[path];
      if (!bytes) throw new Error(`${plugin.id}: missing ${path}`);
      const actual = createHash("sha256").update(bytes).digest("base64url");
      if (actual !== expected.sha256 || bytes.byteLength !== expected.size)
        throw new Error(`${plugin.id}: integrity mismatch for ${path}`);
    }
  }
}

process.stdout.write(
  `Verified ${catalog.plugins.length} signed plugin package(s).\n`,
);
