# Nexus Edge Plugin Marketplace

This repository is the official Techify marketplace for Nexus Edge. Each plugin
is a folder at the repository root; its source code, manifest and generated ZIP
stay together. Adding a plugin or marketplace never requires a Core change.

```text
crm/
meta_ads/
soletrando/
meeting_recorder/
platform_probe/
```

## Create your own marketplace

1. Fork this repository and delete the plugin folders you do not want to publish.
2. Edit [`marketplace.json`](./marketplace.json): set your marketplace name,
   GitHub `owner/repository`, and publisher ID/name.
3. After removing or adding plugin folders, refresh and commit the workspace
   lockfile so CI remains reproducible:

   ```bash
   pnpm install --lockfile-only
   ```

4. Generate an Ed25519 key and add the printed value as the Actions secret
   `PLUGIN_SIGNING_PRIVATE_KEY` in your fork. Keep it private; the public key is
   added to the signed catalog automatically:

   ```bash
   node --input-type=module -e 'import { generateKeyPairSync } from "node:crypto"; const { privateKey } = generateKeyPairSync("ed25519"); console.log(privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"));'
   ```

5. Copy [`.marketplace/templates/plugin`](./.marketplace/templates/plugin/) to
   a new root folder named after the plugin ID, then follow its README.
6. Set the plugin version in `manifest.json`, open a pull request, and merge it
   after validation passes. A manifest change publishes the marketplace
   automatically; **Publish marketplace** in the Actions tab is also available
   for a manual republish.
7. Add this catalog URL in Nexus Edge → Plugins → Marketplaces:

   ```text
   https://raw.githubusercontent.com/OWNER/REPOSITORY/main/nexus-marketplace.json
   ```

The release workflow builds and signs each plugin ZIP, saves it under that
plugin's `release/` folder, publishes an immutable GitHub release, and updates
the signed catalog. `.marketplace/` contains the shared SDK, starter template,
docs and automation; leave it in place, but you do not need to edit it to add
or remove plugin folders.

## Develop this marketplace

Requirements: Node.js 24+ and pnpm 11.19.0.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

The Nexus Edge catalog URL is:

```text
https://raw.githubusercontent.com/Techify-one/nexus-edge-plugins/main/nexus-marketplace.json
```
