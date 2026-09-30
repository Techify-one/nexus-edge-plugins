# Meeting Recorder

Plugin privado do Nexus Edge para gravação recuperável no navegador, upload de
áudio e ingestão por bot do Telegram. O R2 é opcional: sem ele, gravações no
navegador e áudios do Telegram são transcritos em memória e descartados após a
transcrição; com ele, novas gravações e uploads podem ser retidos e reproduzidos
em um bucket privado. O banco ativo guarda metadados, estados e transcrições.

Requer Nexus Core `1.1.0-beta.8` ou superior. Essa versão inclui a interface de
gestão de convidados e as traduções de suas permissões; versões anteriores não
possuem essa superfície no frontend.

## Origens suportadas

- microfone e aba + microfone em Chrome/Edge desktop;
- upload manual de WebM/Opus, Ogg/Opus, MP3, MP4/M4A e WAV de até 20 MiB;
- mensagens `voice` e `audio` de um bot do Telegram. Cada usuário cria um link
  pessoal de 15 minutos na tela de configurações, abre o bot e toca em
  **Iniciar**; o ID é associado sem precisar ser descoberto ou digitado. Um
  usuário autorizado também pode criar convites individuais para outras
  pessoas; os áudios delas entram na biblioteca de quem convidou.

Convites valem uma única vez e expiram em sete dias. O link completo é exibido
somente na criação e apenas seu hash SHA-256 fica no banco. A tela lista
convites pendentes e pessoas ativas, registra a última atividade e permite
revogar o acesso sem apagar gravações anteriores. As permissões
`meeting_recorder.telegram_member.*` separam leitura, criação de convites,
remoção e administração global para que o Core controle quais usuários podem
convidar ou gerenciar terceiros.

Durante cada ingestão o bot confirma o recebimento, avisa quando a transcrição
começa e responde com o resultado e o link direto da gravação. Falhas também
são informadas no chat com um código seguro e uma orientação de recuperação.

O token do bot e o segredo do webhook são Worker secrets configurados pela
tela do plugin. Eles não entram no banco, no manifesto ou no pacote portátil.
A tela valida a identidade do bot, verifica e corrige a URL canônica do webhook,
mostra o link direto `https://t.me/<username>` e permite trocar ou desconectar o
bot. O bot confirma o vínculo e o recebimento dos áudios na própria conversa.
Somente ID, nome, username, vínculo do usuário e URL verificada, nunca o token
ou o código pessoal em claro, são mantidos como metadados no banco.

## Modos de armazenamento

- **Sem R2:** o plugin instala somente com D1/PostgreSQL e Workers AI. Grava
  microfone ou aba no navegador em partes de 20 segundos e aceita áudio do
  Telegram. Transcreve cada parte e mantém o áudio temporariamente no IndexedDB
  do navegador até a confirmação; depois descarta os bytes. A transcrição fica
  no banco. Gravações antigas não ganham áudio se o R2 for ativado depois.
- **Com R2:** um administrador ativa o bucket nas configurações com um token
  temporário limitado a `Workers R2 Storage → Edit`. A ativação não reinstala o
  plugin e libera retenção de novas gravações, upload e player.

Mudar de aba ou minimizar normalmente mantém a captura enquanto a página está
aberta. Fechar ou recarregar interrompe a captura e dispara o aviso padrão do
navegador. Ao retornar, segmentos locais pendentes podem ser recuperados e a
mesma sessão pode continuar após nova autorização de microfone ou aba. O áudio
gravado durante o fechamento não pode ser recuperado. A recuperação depende do
mesmo navegador e perfil; limpar dados do site remove as partes ainda pendentes.

## Desenvolvimento

```bash
pnpm --filter @techify/plugin-meeting-recorder build
PLUGIN_SIGNING_PRIVATE_KEY=... pnpm --filter @techify/plugin-meeting-recorder package
```

O Worker não possui URL pública própria. APIs autenticadas passam por
`/api/v1/p/meeting_recorder/*`; o webhook do Telegram passa pelo gateway
limitado `/api/v1/public/p/meeting_recorder/telegram/webhook`.
