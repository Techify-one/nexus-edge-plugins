# Plugin Asaas para Nexus Edge

Integra uma conta Asaas pessoa física de produção ao Nexus Edge para:

- consultar o saldo disponível;
- consultar e paginar o extrato por período;
- enviar Pix para CPF, CNPJ, e-mail, telefone ou chave aleatória;
- acompanhar o estado dos Pix iniciados pelo plugin;
- autorizar automaticamente os Pix via webhook de validação de saques;
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

## Autorização automática do Pix

O Asaas exige uma autorização adicional para transferências criadas por API. O
plugin implementa o webhook específico de autorização de saques para que um Pix
registrado pelo Nexus possa ser aprovado sem confirmação manual por SMS ou pelo
aplicativo.

Na tela **Configurar Asaas**:

1. gere um token de webhook, copie-o e salve-o como segredo do plugin;
2. copie a URL pública exibida;
3. no Asaas, acesse **Menu do usuário > Integrações > Mecanismos de segurança**,
   ative o webhook de autorização de saques e informe a URL e o mesmo token.

Se a opção não estiver disponível para a conta pessoa física, solicite ao
suporte técnico do Asaas a habilitação do mecanismo. A disponibilidade pode
depender da análise da conta.

Ao ativar o mecanismo, todas as transferências criadas via API passam por essa
validação. Por segurança, o plugin só aprova transferências Pix que ele próprio
registrou e quando ID, valor e todos os dados presentes no callback conferem.
O Asaas documenta `pixAddressKey` como anulável nesse callback; quando a chave é
enviada, o plugin também exige que ela confira com o hash registrado.
Solicitações desconhecidas ou divergentes são recusadas. A chave Pix completa
não é armazenada: apenas sua forma mascarada e um hash SHA-256 são persistidos.

Transferências criadas antes da versão 1.1.0 não possuem o hash de destino e não
podem ser autorizadas automaticamente; autorize-as manualmente ou crie uma nova
transferência depois de configurar o webhook.

Este plugin usa exclusivamente a API de produção (`https://api.asaas.com/v3`)
e aceita chaves iniciadas por `$aact_prod_`.

## Desenvolvimento

```bash
pnpm --filter @techify/plugin-asaas typecheck
pnpm --filter @techify/plugin-asaas build
```

O empacotamento assinado é realizado pelo workflow do marketplace. Nunca
adicione uma chave Asaas ou uma chave privada de assinatura ao repositório.
