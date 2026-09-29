# Plugin Asaas para Nexus Edge

Integra uma conta Asaas pessoa física de produção ao Nexus Edge para:

- consultar o saldo disponível;
- consultar e paginar o extrato por período;
- enviar Pix para CPF, CNPJ, e-mail, telefone ou chave aleatória;
- acompanhar o estado dos Pix iniciados pelo plugin;
- configurar, testar, substituir e apagar a chave de API dentro do plugin.

## Segurança

A chave `ASAAS_API_KEY` é declarada como Worker Secret. O valor não entra no
banco, no pacote, no catálogo nem nos logs e não pode ser lido de volta depois
de salvo. A tela valida a chave, confirma que ela pertence a uma conta `FISICA`
e faz uma consulta de saldo antes de armazená-la. Também exige confirmação
recente da senha do Nexus para salvar, substituir ou apagar a credencial.

O envio de Pix exige permissão específica, consulta prévia da titularidade da
chave, confirmação explícita do favorecido e um `Idempotency-Key`. O plugin
grava apenas a chave Pix mascarada. Quando a API não permite determinar se um
envio foi processado, a operação fica como `UNKNOWN` e não é repetida
automaticamente.

Este plugin usa exclusivamente a API de produção (`https://api.asaas.com/v3`)
e aceita chaves iniciadas por `$aact_prod_`.

## Desenvolvimento

```bash
pnpm --filter @techify/plugin-asaas typecheck
pnpm --filter @techify/plugin-asaas build
```

O empacotamento assinado é realizado pelo workflow do marketplace. Nunca
adicione uma chave Asaas ou uma chave privada de assinatura ao repositório.
