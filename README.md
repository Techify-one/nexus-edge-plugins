# Nexus Edge Plugins

Marketplace público oficial da Techify para plugins Nexus Edge. Cada diretório
em [`plugins/`](./plugins/) é uma aplicação independente, com frontend,
backend, migrations e declaração dos recursos Cloudflare que o instalador deve
provisionar. Adicionar um plugin aqui não exige alterar ou republicar o Core.

Catálogo padrão:

```text
https://raw.githubusercontent.com/Techify-one/nexus-edge-plugins/main/nexus-marketplace.json
```

## Desenvolvimento

Requisitos: Node.js 24 ou superior e pnpm 11.19.0.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Comece por [`templates/plugin`](./templates/plugin/) e consulte
[`docs/PLUGIN-DEVELOPMENT.md`](./docs/PLUGIN-DEVELOPMENT.md). O contrato público
fica em [`packages/plugin-sdk`](./packages/plugin-sdk/); ele não importa código
privado do Core.

## Publicação

Os pacotes `.plugin.zip` e o catálogo são assinados com uma chave Ed25519 que
existe somente como secret do GitHub Actions. O workflow **Publish marketplace**
reconstrói e testa todos os plugins, publica releases imutáveis e só então
atualiza o catálogo. Veja [`docs/MARKETPLACE-PUBLISHING.md`](./docs/MARKETPLACE-PUBLISHING.md).

## Plugins

- `crm`: CRM e gestão de leads.
- `meta_ads`: contas, campanhas e métricas Meta Ads.
- `soletrando`: treino de ortografia com transcrição por voz.
- `meeting_recorder`: gravação, transcrição e integração Telegram.
- `platform_probe`: plugin de conformidade para R2, KV, Queues, Durable Objects
  SQLite e Cron.
