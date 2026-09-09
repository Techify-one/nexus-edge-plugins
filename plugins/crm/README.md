# CRM plugin

Everything specific to CRM is colocated here:

- [`frontend/`](./frontend/) contains the independently compiled CRM UI;
- [`catalog.json`](./catalog.json) contains its public catalog description;
- [`src/`](./src/) contains the private Worker API and business logic;
- [`migrations/`](./migrations/) contains paired D1 and PostgreSQL migrations;
- [`manifest.json`](./manifest.json) defines permissions, menus, and compatibility;
- `release/crm.plugin.zip` is the generated, signed installable package.

From the repository root, rebuild the package with:

```bash
pnpm --filter @techify/plugin-crm build
PLUGIN_SIGNING_PRIVATE_KEY=... pnpm --filter @techify/plugin-crm package
```

The Worker remains private. Its page is loaded by the generic Core host from
the installed package; the Core has no CRM route or import to update.
