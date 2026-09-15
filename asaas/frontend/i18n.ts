export const asaasFrontendMessages = {
  "pt-BR": {
    "asaas.title": "Conta Asaas",
    "asaas.description":
      "Consulte sua conta pessoa física e movimente apenas o saldo mantido no Asaas.",
    "asaas.refresh": "Atualizar",
    "asaas.previous": "Anterior",
    "asaas.next": "Próxima",
    "asaas.availableBalance": "Saldo disponível",
    "asaas.connectionRequired": "Conecte sua conta Asaas",
    "asaas.connectionRequiredDescription":
      "Configure uma chave de API de produção válida para consultar saldo, extrato e enviar Pix.",
    "asaas.configure": "Configurar chave de API",
    "asaas.statement.title": "Extrato Asaas",
    "asaas.statement.description":
      "Movimentações que impactaram o saldo da conta no período selecionado.",
    "asaas.statement.cardDescription":
      "Consulte entradas, saídas, tarifas e saldo.",
    "asaas.statement.startDate": "Data inicial",
    "asaas.statement.finishDate": "Data final",
    "asaas.statement.filter": "Consultar",
    "asaas.statement.movement": "Movimentação",
    "asaas.statement.type": "Tipo",
    "asaas.statement.value": "Valor",
    "asaas.statement.balanceAfter": "Saldo após lançamento",
    "asaas.statement.empty": "Nenhuma movimentação",
    "asaas.statement.emptyDescription":
      "Não há lançamentos no período selecionado.",
    "asaas.statement.total": "{{total}} movimentações encontradas",
    "asaas.pix.title": "Fazer Pix",
    "asaas.pix.description":
      "Envie saldo da sua conta Asaas para uma chave Pix após revisar e confirmar os dados.",
    "asaas.pix.cardDescription":
      "Transfira para CPF, CNPJ, e-mail, telefone ou chave aleatória.",
    "asaas.pix.keyType": "Tipo da chave",
    "asaas.pix.key": "Chave Pix de destino",
    "asaas.pix.phone": "Telefone",
    "asaas.pix.randomKey": "Chave aleatória",
    "asaas.pix.amount": "Valor",
    "asaas.pix.amountInvalid": "Informe um valor de Pix válido.",
    "asaas.pix.transferDescription": "Descrição (opcional)",
    "asaas.pix.warning":
      "Confira a chave e o valor. O envio usa dinheiro real da conta Asaas de produção e pode ser irreversível.",
    "asaas.pix.reviewAndSend": "Revisar e enviar Pix",
    "asaas.pix.confirmRecipient":
      "Confirma o Pix de {{value}} para {{name}} ({{document}}), no {{institution}}, chave {{key}}? Esta operação movimenta dinheiro real.",
    "asaas.pix.submitted":
      "Pix enviado ao Asaas. Acompanhe o status até a conclusão.",
    "asaas.pix.lastSubmission": "Último Pix enviado",
    "asaas.pix.history": "Pix enviados pelo Nexus",
    "asaas.pix.destination": "Destino",
    "asaas.pix.empty": "Nenhum Pix enviado",
    "asaas.pix.emptyDescription":
      "As transferências iniciadas por este plugin aparecerão aqui.",
    "asaas.pix.refreshStatus": "Atualizar status no Asaas",
    "asaas.pix.statusUpdated": "Status atualizado no Asaas.",
    "asaas.pix.authorization": "Autorização automática",
    "asaas.pix.authorization.NOT_REQUESTED": "Aguardando webhook",
    "asaas.pix.authorization.APPROVED": "Aprovada",
    "asaas.pix.authorization.REFUSED": "Recusada",
    "asaas.settings.title": "Configurar Asaas",
    "asaas.settings.description":
      "Gerencie a credencial usada pelo Worker privado do plugin.",
    "asaas.settings.cardDescription":
      "Adicione, teste, substitua ou apague a chave de API.",
    "asaas.settings.apiKey": "Chave de API de produção",
    "asaas.settings.apiKeyDescription":
      "A chave é validada com uma consulta de saldo antes de ser protegida como Worker Secret.",
    "asaas.settings.configured": "Configurada",
    "asaas.settings.notConfigured": "Não configurada",
    "asaas.settings.validateAndSave": "Validar e salvar",
    "asaas.settings.validateAndReplace": "Validar e substituir",
    "asaas.settings.testSaved": "Testar chave salva",
    "asaas.settings.saved": "Chave do Asaas validada e protegida.",
    "asaas.settings.deleted": "Chave do Asaas apagada.",
    "asaas.settings.delete": "Apagar chave",
    "asaas.settings.deleteConfirm":
      "Apagar a chave do Asaas? O plugin ficará desconectado até outra chave ser adicionada.",
    "asaas.settings.savePassword":
      "Confirme sua senha do Nexus para salvar a chave do Asaas:",
    "asaas.settings.deletePassword":
      "Confirme sua senha do Nexus para apagar a chave do Asaas:",
    "asaas.settings.invalidFormat":
      "Use uma chave de produção completa iniciada por $aact_prod_.",
    "asaas.settings.connectionOk":
      "Conexão confirmada. Saldo disponível: {{balance}}.",
    "asaas.settings.securityTitle": "Como a chave é protegida",
    "asaas.settings.securitySecret":
      "O valor é salvo como Worker Secret, não no banco de dados.",
    "asaas.settings.securityNeverReturned":
      "Depois de salva, a chave nunca é exibida ou devolvida pela API.",
    "asaas.settings.securityProduction":
      "Este plugin aceita somente chaves do ambiente de produção do Asaas.",
    "asaas.settings.securityRotate":
      "Revogue e gere uma nova chave no Asaas se ela for compartilhada fora de um gerenciador de segredos.",
    "asaas.settings.webhookTitle": "Autorização automática de Pix",
    "asaas.settings.webhookDescription":
      "Configure o webhook de autorização de saques do Asaas para eliminar a confirmação manual por token.",
    "asaas.settings.webhookUrl": "URL do webhook de autorização",
    "asaas.settings.webhookToken": "Token de autenticação do webhook",
    "asaas.settings.webhookTokenPlaceholder":
      "Gere ou informe um token secreto",
    "asaas.settings.generateToken": "Gerar token",
    "asaas.settings.saveWebhookToken": "Salvar token",
    "asaas.settings.replaceWebhookToken": "Substituir token",
    "asaas.settings.webhookSaved": "Token do webhook protegido com sucesso.",
    "asaas.settings.webhookDeleted": "Token do webhook apagado.",
    "asaas.settings.webhookInvalid":
      "O token do webhook deve ter entre 32 e 255 caracteres.",
    "asaas.settings.webhookCopyBeforeSave":
      "Copie este token antes de salvar. Depois ele não poderá ser exibido novamente.",
    "asaas.settings.copyToken": "Copiar token",
    "asaas.settings.copyUrl": "Copiar URL",
    "asaas.settings.copied": "Copiado.",
    "asaas.settings.webhookStepsTitle": "Ativação no Asaas",
    "asaas.settings.webhookStepOne":
      "Gere um token, copie-o e salve-o no plugin.",
    "asaas.settings.webhookStepTwo":
      "No Asaas, abra Menu do usuário > Integrações > Mecanismos de segurança e ative o webhook de autorização de saques.",
    "asaas.settings.webhookStepThree":
      "Informe a URL acima e o mesmo token no campo de autenticação do Asaas.",
    "asaas.settings.webhookScopeWarning":
      "Importante: ao ativar esse mecanismo, toda transferência criada via API será validada. O plugin aprova somente Pix que ele próprio registrou e cujos ID, valor e dados fornecidos pelo Asaas conferem; qualquer outra solicitação é recusada.",
    "asaas.settings.webhookSavePassword":
      "Confirme sua senha do Nexus para salvar o token do webhook Asaas:",
    "asaas.settings.webhookDeletePassword":
      "Confirme sua senha do Nexus para apagar o token do webhook Asaas:",
    "asaas.settings.webhookDeleteConfirm":
      "Apagar o token do webhook? O Asaas deixará de conseguir autorizar transferências automaticamente até a reconfiguração.",
    "errors.ASAAS_API_KEY_NOT_CONFIGURED":
      "Configure a chave de API do Asaas antes de continuar.",
    "errors.ASAAS_API_KEY_INVALID":
      "A chave de API do Asaas é inválida ou foi revogada.",
    "errors.ASAAS_API_KEY_FORMAT_INVALID":
      "A chave não tem o formato de produção esperado pelo Asaas.",
    "errors.ASAAS_PERSONAL_ACCOUNT_REQUIRED":
      "Esta chave não pertence a uma conta Asaas pessoa física.",
    "errors.ASAAS_RATE_LIMITED":
      "O Asaas limitou temporariamente as consultas. Aguarde e tente novamente.",
    "errors.PIX_KEY_INVALID": "A chave Pix informada é inválida.",
    "errors.PIX_VALUE_INVALID": "O valor do Pix é inválido.",
    "errors.INSUFFICIENT_BALANCE":
      "O saldo disponível no Asaas é menor que o valor do Pix.",
    "errors.ASAAS_TRANSFER_OUTCOME_UNKNOWN":
      "Não foi possível confirmar o resultado. Confira a conta Asaas antes de tentar outro Pix.",
    "errors.IDEMPOTENCY_KEY_REUSED":
      "Esta tentativa de Pix já foi registrada com outros dados.",
    "errors.STATEMENT_DATE_RANGE_INVALID": "O período do extrato é inválido.",
    "errors.STATEMENT_DATE_RANGE_TOO_LARGE":
      "Consulte no máximo 366 dias por vez.",
  },
  en: {
    "asaas.title": "Asaas account",
    "asaas.description":
      "View your personal account and move only the balance held at Asaas.",
    "asaas.refresh": "Refresh",
    "asaas.previous": "Previous",
    "asaas.next": "Next",
    "asaas.availableBalance": "Available balance",
    "asaas.connectionRequired": "Connect your Asaas account",
    "asaas.connectionRequiredDescription":
      "Configure a valid production API key to view balance and statement or send Pix.",
    "asaas.configure": "Configure API key",
    "asaas.statement.title": "Asaas statement",
    "asaas.statement.description":
      "Transactions that affected the account balance in the selected period.",
    "asaas.statement.cardDescription":
      "View credits, debits, fees and balance.",
    "asaas.statement.startDate": "Start date",
    "asaas.statement.finishDate": "End date",
    "asaas.statement.filter": "Search",
    "asaas.statement.movement": "Movement",
    "asaas.statement.type": "Type",
    "asaas.statement.value": "Amount",
    "asaas.statement.balanceAfter": "Balance after entry",
    "asaas.statement.empty": "No transactions",
    "asaas.statement.emptyDescription": "There are no entries in this period.",
    "asaas.statement.total": "{{total}} transactions found",
    "asaas.pix.title": "Send Pix",
    "asaas.pix.description":
      "Send your Asaas balance to a Pix key after reviewing and confirming the details.",
    "asaas.pix.cardDescription":
      "Transfer to CPF, CNPJ, email, phone or random key.",
    "asaas.pix.keyType": "Key type",
    "asaas.pix.key": "Destination Pix key",
    "asaas.pix.phone": "Phone",
    "asaas.pix.randomKey": "Random key",
    "asaas.pix.amount": "Amount",
    "asaas.pix.amountInvalid": "Enter a valid Pix amount.",
    "asaas.pix.transferDescription": "Description (optional)",
    "asaas.pix.warning":
      "Check the key and amount. This sends real money from the production Asaas account and may be irreversible.",
    "asaas.pix.reviewAndSend": "Review and send Pix",
    "asaas.pix.confirmRecipient":
      "Confirm a Pix of {{value}} to {{name}} ({{document}}) at {{institution}}, key {{key}}? This operation moves real money.",
    "asaas.pix.submitted": "Pix submitted to Asaas. Track it until completion.",
    "asaas.pix.lastSubmission": "Last submitted Pix",
    "asaas.pix.history": "Pix sent through Nexus",
    "asaas.pix.destination": "Destination",
    "asaas.pix.empty": "No Pix submitted",
    "asaas.pix.emptyDescription":
      "Transfers started by this plugin appear here.",
    "asaas.pix.refreshStatus": "Refresh status from Asaas",
    "asaas.pix.statusUpdated": "Status updated from Asaas.",
    "asaas.pix.authorization": "Automatic authorization",
    "asaas.pix.authorization.NOT_REQUESTED": "Awaiting webhook",
    "asaas.pix.authorization.APPROVED": "Approved",
    "asaas.pix.authorization.REFUSED": "Refused",
    "asaas.settings.title": "Configure Asaas",
    "asaas.settings.description":
      "Manage the credential used by the private plugin Worker.",
    "asaas.settings.cardDescription":
      "Add, test, replace or delete the API key.",
    "asaas.settings.apiKey": "Production API key",
    "asaas.settings.apiKeyDescription":
      "The key is validated with a balance request before it is protected as a Worker Secret.",
    "asaas.settings.configured": "Configured",
    "asaas.settings.notConfigured": "Not configured",
    "asaas.settings.validateAndSave": "Validate and save",
    "asaas.settings.validateAndReplace": "Validate and replace",
    "asaas.settings.testSaved": "Test saved key",
    "asaas.settings.saved": "Asaas key validated and protected.",
    "asaas.settings.deleted": "Asaas key deleted.",
    "asaas.settings.delete": "Delete key",
    "asaas.settings.deleteConfirm":
      "Delete the Asaas key? The plugin will remain disconnected until another key is added.",
    "asaas.settings.savePassword":
      "Confirm your Nexus password to save the Asaas key:",
    "asaas.settings.deletePassword":
      "Confirm your Nexus password to delete the Asaas key:",
    "asaas.settings.invalidFormat":
      "Use a complete production key starting with $aact_prod_.",
    "asaas.settings.connectionOk":
      "Connection confirmed. Available balance: {{balance}}.",
    "asaas.settings.securityTitle": "How the key is protected",
    "asaas.settings.securitySecret":
      "It is stored as a Worker Secret, not in the database.",
    "asaas.settings.securityNeverReturned":
      "After saving, the key is never displayed or returned by the API.",
    "asaas.settings.securityProduction":
      "This plugin accepts production Asaas API keys only.",
    "asaas.settings.securityRotate":
      "Revoke and issue a new Asaas key if it is shared outside a secret manager.",
    "asaas.settings.webhookTitle": "Automatic Pix authorization",
    "asaas.settings.webhookDescription":
      "Configure the Asaas withdrawal authorization webhook to eliminate manual token confirmation.",
    "asaas.settings.webhookUrl": "Authorization webhook URL",
    "asaas.settings.webhookToken": "Webhook authentication token",
    "asaas.settings.webhookTokenPlaceholder":
      "Generate or enter a secret token",
    "asaas.settings.generateToken": "Generate token",
    "asaas.settings.saveWebhookToken": "Save token",
    "asaas.settings.replaceWebhookToken": "Replace token",
    "asaas.settings.webhookSaved": "Webhook token stored securely.",
    "asaas.settings.webhookDeleted": "Webhook token deleted.",
    "asaas.settings.webhookInvalid":
      "The webhook token must be between 32 and 255 characters.",
    "asaas.settings.webhookCopyBeforeSave":
      "Copy this token before saving. It cannot be displayed again afterwards.",
    "asaas.settings.copyToken": "Copy token",
    "asaas.settings.copyUrl": "Copy URL",
    "asaas.settings.copied": "Copied.",
    "asaas.settings.webhookStepsTitle": "Enable it in Asaas",
    "asaas.settings.webhookStepOne":
      "Generate a token, copy it, and save it in the plugin.",
    "asaas.settings.webhookStepTwo":
      "In Asaas, open User menu > Integrations > Security mechanisms and enable the withdrawal authorization webhook.",
    "asaas.settings.webhookStepThree":
      "Enter the URL above and the same token in the Asaas authentication field.",
    "asaas.settings.webhookScopeWarning":
      "Important: once enabled, every transfer created through the API is validated. The plugin approves only Pix transfers it registered and whose ID, value, and details supplied by Asaas match; every other request is refused.",
    "asaas.settings.webhookSavePassword":
      "Confirm your Nexus password to save the Asaas webhook token:",
    "asaas.settings.webhookDeletePassword":
      "Confirm your Nexus password to delete the Asaas webhook token:",
    "asaas.settings.webhookDeleteConfirm":
      "Delete the webhook token? Asaas will be unable to authorize transfers automatically until it is configured again.",
    "errors.ASAAS_API_KEY_NOT_CONFIGURED": "Configure the Asaas API key first.",
    "errors.ASAAS_API_KEY_INVALID": "The Asaas API key is invalid or revoked.",
    "errors.ASAAS_API_KEY_FORMAT_INVALID":
      "The key does not match the expected Asaas production format.",
    "errors.ASAAS_PERSONAL_ACCOUNT_REQUIRED":
      "This key does not belong to a personal Asaas account.",
    "errors.ASAAS_RATE_LIMITED":
      "Asaas temporarily rate-limited requests. Try again later.",
    "errors.PIX_KEY_INVALID": "The Pix key is invalid.",
    "errors.PIX_VALUE_INVALID": "The Pix amount is invalid.",
    "errors.INSUFFICIENT_BALANCE":
      "The available Asaas balance is lower than the Pix amount.",
    "errors.ASAAS_TRANSFER_OUTCOME_UNKNOWN":
      "The result could not be confirmed. Check Asaas before sending another Pix.",
    "errors.IDEMPOTENCY_KEY_REUSED":
      "This Pix attempt was already registered with different data.",
    "errors.STATEMENT_DATE_RANGE_INVALID": "The statement period is invalid.",
    "errors.STATEMENT_DATE_RANGE_TOO_LARGE": "Query up to 366 days at a time.",
  },
} as const;
