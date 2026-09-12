# Meta Ads plugin

Everything specific to Meta Ads is colocated here:

- [`frontend/`](./frontend/) contains the independently compiled Meta Ads UI;
- [`catalog.json`](./catalog.json) contains its public catalog description;
- [`src/`](./src/) contains the private Worker API and Meta client;
- [`migrations/`](./migrations/) contains paired D1 and PostgreSQL migrations;
- [`manifest.json`](./manifest.json) defines permissions, menus, and compatibility;
- `release/meta_ads.plugin.zip` is the generated, signed installable package.

From the repository root, rebuild the package with:

```bash
pnpm --filter @techify/plugin-meta-ads build
PLUGIN_SIGNING_PRIVATE_KEY=... pnpm --filter @techify/plugin-meta-ads package
```

The Worker remains private. Its pages are loaded by the generic Core host from
the installed package; the Core has no Meta Ads route or import to update.
