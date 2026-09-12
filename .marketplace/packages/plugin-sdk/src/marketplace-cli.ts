#!/usr/bin/env node
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { generatePluginMarketplace } from "./marketplace.js";

const privateKey = process.env.PLUGIN_SIGNING_PRIVATE_KEY?.trim();
if (!privateKey) throw new Error("PLUGIN_SIGNING_PRIVATE_KEY is required.");
const configuration = JSON.parse(readFileSync("marketplace.json", "utf8")) as {
  name: string;
  repository: string;
  publisher: { id: string; name: string };
};
const result = generatePluginMarketplace({
  pluginsDirectory: resolve(
    process.env.MARKETPLACE_PLUGINS_DIRECTORY?.trim() || ".",
  ),
  output: resolve(
    process.env.MARKETPLACE_OUTPUT?.trim() || "nexus-marketplace.json",
  ),
  repository:
    process.env.MARKETPLACE_GITHUB_REPOSITORY?.trim() ||
    configuration.repository,
  marketplaceName: process.env.MARKETPLACE_NAME?.trim() || configuration.name,
  publisherId:
    process.env.MARKETPLACE_PUBLISHER_ID?.trim() || configuration.publisher.id,
  publisherName:
    process.env.MARKETPLACE_PUBLISHER_NAME?.trim() ||
    configuration.publisher.name,
  keyId: process.env.PLUGIN_SIGNING_KEY_ID?.trim() || "publisher-v1",
  privateKey,
});
process.stdout.write(
  `Generated marketplace revision ${result.revision} with ${result.pluginCount} plugin(s).\n`,
);
