# Desenvolvimento de plugins Nexus Edge

Um plugin formato 2 é construído e versionado fora do Core. O pacote instalado
contém o Worker privado já compilado, frontend ESM, migrations, manifesto,
inventário de integridade e assinaturas. A instalação nunca executa `npm`,
scripts de shell ou código de build.

## Começando do zero

1. Copie `.marketplace/templates/plugin` para a raiz do repositório, usando o `<plugin_id>` como nome da pasta.
2. Escolha um ID imutável em `snake_case`; tabelas devem usar o prefixo
   `<plugin_id>_` e preferências de tabela, `plugin.<plugin_id>.<recurso>`.
3. Troque a identidade do editor e declare todas as permissões, rotas, segredos
   e recursos em `manifest.json`.
4. Implemente o Worker e a UI apenas contra `@nexus/plugin-sdk`.
5. Forneça migrations D1 e PostgreSQL para os providers declarados.
6. Execute typecheck, testes, build e empacotamento antes de publicar.

O SDK publicado pode ser consumido sem checkout do Core:

```json
{
  "dependencies": {
    "@nexus/plugin-sdk": "https://github.com/Techify-one/nexus-edge-plugins/releases/download/plugin-sdk-v1.1.2/nexus-plugin-sdk-1.1.2.tgz"
  }
}
```

## Frontend

O módulo exporta `definePlugin({ mountPage })`. O host entrega navegação,
idioma, tema, permissões, notificações, API do plugin e preferências de tabela.
Rotas ficam sempre em `/app/p/<plugin_id>`. A UI é código confiável executado na
origem do Core; Shadow DOM limita CSS, não é uma barreira de segurança.

O frontend deve remover listeners, cancelar requests e liberar recursos em
`dispose`. Tarefas que precisam sobreviver a trocas de página devem usar a
superfície persistente do contrato, quando declarada no manifesto.

## Backend e autorização

O Worker do plugin não é público. Requests normais chegam pelo gateway do Core
com um contexto delegado em `X-Plugin-Context`; operações de instalação usam
`X-Plugin-Installer-Context`. Nunca aceite esses headers diretamente da
internet ou substitua a autorização do servidor por controles de interface.

Use `createPluginDatabase` de `@nexus/plugin-sdk/backend`. O mesmo código atende
D1 ou PostgreSQL/Hyperdrive e mantém SQL e tipos fora dos pacotes internos do
Core.

## Recursos Cloudflare

O campo `resources` suporta as capacidades v1:

- `database`: banco da instalação em um binding adicional;
- `r2`: bucket criado ou anexado;
- `kv`: namespace dedicado;
- `queue`: produtor e, opcionalmente, consumer/DLQ;
- `durable_object`: classe exportada com armazenamento SQLite;
- `cron`: uma ou mais expressões;
- `ai`: Workers AI.

Cada recurso tem nome lógico, binding, obrigatoriedade e retenção. Recursos
obrigatórios bloqueiam a instalação se não puderem ser provisionados. Durable
Objects sempre usam retenção conservadora. Veja `platform_probe` para
um exemplo executável de todas as capacidades de estado e tarefas.

## Segredos

Declare nomes e a permissão administrativa em `secrets`. Valores nunca entram
no manifesto, ZIP, catálogo, logs ou Git. Eles são configurados pela API privada
do instalador e preservados em updates do Worker.

## Compatibilidade

O plugin fixa `packageFormat`, `manifestVersion`, `engines.hostApi`,
`engines.coreApi`, `coreMinVersion`, `compatibilityDate` e providers. Mudanças
compatíveis recebem nova versão SemVer. Não reutilize uma versão com bytes
diferentes e não mude editor/origem de um plugin instalado.
