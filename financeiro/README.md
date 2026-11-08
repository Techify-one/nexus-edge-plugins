# Financeiro para Nexus Edge

Plugin nativo para controle gerencial de receitas, despesas e contas. Registra fatos financeiros; não faz pagamentos bancários, Pix ou conciliação automática.

Esta implementação adapta o repositório `Techify-one/nexus-financeiro`, revisão original inspecionada `07fdd19f8084e636ef220b7a104aa2f5e52509f2`. Não é uma cópia da API Nest/Prisma nem uma declaração de paridade integral. Consulte [PARITY.md](./PARITY.md) para diferenças e pendências.

## Dados e segurança

- A instalação começa vazia. Não há empresas fictícias, importação automática ou reutilização das credenciais do módulo antigo.
- Tabelas com prefixo `financeiro_`, migrations D1 e PostgreSQL, referências compostas por empresa e revisão otimista por empresa.
- Valores monetários na API são strings de centavos, com cálculos `bigint` e limite explícito de 15 dígitos. Não envie valores JSON numéricos para dinheiro.
- Mutações financeiras usam `PluginDatabase.atomic`: guarda CAS com constraint, alterações, auditoria e outbox confirmam juntas. Conflitos refazem leitura/validação, com limite de tentativas.
- A API usa contexto interno do host e permissões específicas. O Worker deve continuar privado. Cabeçalhos `X-Plugin-Context` não são autenticação independente para exposição pública: o gateway do host precisa remover cabeçalhos fornecidos externamente e injetar seu próprio contexto validado.
- Outbox persistida não significa webhook entregue. A entrega opcional usa HMAC SHA256, ID estável, claim/lease e até oito tentativas. Fica desativada sem URL, segredo e hostname público exato provisionados pelo operador. Não há envio bancário.

## Superfície atual

A API é montada pelo host em `/api/v1/p/financeiro`. As rotas empresariais usam `empresaId` na query, não o caminho legado `/empresas/:chave/...`.

Há serviços para empresas, contas, categorias, lançamentos, baixas parciais, estornos de baixa, transferências, resumo mensal, CSV, recorrências, fechamento/reabertura, visões pessoais e metadados de anexos. A criação com `liquidacao` persiste lançamento e movimento no mesmo batch. Baixas, estornos e transferências usam `chaveIdempotencia` no corpo, não o header legado.

Comprovantes exigem binding `DOCUMENTS` e aceitam PDF, PNG ou JPEG até 5 MiB, com download autenticado. Upload de objeto e commit de metadados não são uma transação distribuída; há limpeza compensatória, e falha dessa limpeza pode deixar objeto privado órfão para inspeção. Não há evidência de teste com bucket remoto.

Telegram é opcional e depende de `TELEGRAM_BOT_TOKEN`, configuração explícita de chat e validação do usuário configurador no host. A política atual prefere envio no máximo uma vez por configuração/dia; timeout ou falha após reservar a tentativa não tem repetição automática. Isso difere de uma fila de entrega recuperável.

## Integrações e agendamento

Configure segredos opcionais pelo painel de plugins do Nexus, sem gravá-los no banco financeiro:

- `TELEGRAM_BOT_TOKEN`: bot do Telegram; o chat precisa ter iniciado contato com o bot.
- `FINANCEIRO_WEBHOOK_URL`: destino HTTPS controlado e confiável.
- `FINANCEIRO_WEBHOOK_SECRET`: chave HMAC com pelo menos 32 bytes.
- `FINANCEIRO_WEBHOOK_ALLOWED_HOSTS`: hostnames exatos permitidos, separados por vírgula.

O receptor deve validar `X-Financeiro-Signature: v1=<hex>` como HMAC SHA256 de `X-Financeiro-Timestamp + '.' + corpo bruto`, validar a janela temporal e deduplicar `X-Financeiro-Event-Id`. Não há redirects, IPs ou destinos arbitrários enviados por usuário. A allowlist é uma fronteira de confiança do operador, não DNS pinning. Eventos carregam identificadores, não cópias de contatos ou documentos. Mudança de destino bloqueia entregas já vinculadas ao endereço anterior.

O cron separa geração, avisos e webhooks em invocações distintas. Um cursor persistente percorre uma empresa por invocação; geração limita 20 ocorrências e webhooks três eventos por lote. Novas invocações continuam idempotentemente, sem executar um pagamento. Para muitas empresas ou importações extensas, use a geração manual em lotes e dimensione as cotas do plano Workers. O horizonte é de 90 dias; recuperação histórica usa janela explícita. Não há garantia de geração instantânea de todos os lotes.

## Desenvolvimento e testes

Requer Node 24+ e ferramentas do workspace. O ambiente de referência usa `/home/francisco/.local/node/bin`, pnpm 11 via Corepack e dependências já instaladas. Não exige servidor Nest ou Prisma.

Na raiz do workspace:

```sh
node --import tsx --test financeiro/tests/integration*.node.ts
```

Esse comando executa SQLite real via `node:sqlite`; os testes HTTP D1 ficam explicitamente marcados como não executados sem opt-in. SQLite não é evidência de D1.

Para D1 local real com Miniflare/workerd e PostgreSQL isolado:

```sh
FINANCEIRO_TEST_D1=1 \
FINANCEIRO_TEST_POSTGRES_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/TEST_DATABASE' \
node --import tsx --test financeiro/tests/integration*.node.ts
```

Use somente um PostgreSQL descartável de testes. O harness cria um schema aleatório por caso e o remove ao terminar. Transações concorrentes usam clientes separados. Nunca aponte essa variável para produção.

Dependências do harness: `node:sqlite`, `tsx`, `pg` já utilizado pelo SDK e `miniflare` resolvido através do Wrangler instalado. D1 usa o `createPluginDatabase` real do SDK. O harness suporta `FINANCEIRO_TEST_PLUGIN_ROOT` e `FINANCEIRO_TEST_WORKSPACE` para testar os arquivos reais em outro checkout durante integração entre agentes.

Os testes exercitam rollback após falha na segunda perna de transferência, CAS inválido com ausência de efeitos, disputas de baixas e idempotência, estorno concorrente, fechamento disputado, snapshot preservado ao pagar mês posterior, isolamento por empresa, geração recorrente e o aceite numérico. Barreiras retêm batches já preparados para provocar revisões obsoletas de verdade; não são mocks de SQL.

## Estado de entrega

O script `tests/frontend.browser.mjs` valida pt-BR/en, claro/escuro, mobile, permissões reduzidas e fluxos de formulário com API controlada. `tests/browser.integration.mjs` conecta a interface real ao backend Hono e D1 local real, validando cadastro, baixa parcial, transferência, resumo e fechamento/reabertura. Execute com `node --import tsx financeiro/tests/browser.integration.mjs`; `PLAYWRIGHT_MODULE` pode selecionar uma instalação existente do Playwright. Nenhum desses scripts grava dados de produção.

Testes locais não comprovam instalação, release assinada, concessão de permissões pelo host, configuração de R2/Telegram ou funcionamento no hub. O aceite de produção exige concluir o Installer oficial e conferir runtime, API e interface no hub. Consulte PARITY.md antes de migrar clientes ou dados do módulo antigo.
