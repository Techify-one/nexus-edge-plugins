# Publicação do marketplace

O arquivo `nexus-marketplace.json` é o índice consumido pelo Nexus Edge. Cada
release aponta para um asset GitHub imutável chamado `<id>.plugin.zip`, na tag
`<id>-v<versão>`.

## Fluxo oficial

1. Atualize o plugin e sua versão SemVer.
2. Abra um pull request e aguarde o workflow de validação.
3. Depois do merge, execute manualmente **Publish marketplace**.
4. O workflow valida todo o repositório, cria os pacotes assinados, publica ou
   confere as releases e atualiza o catálogo assinado.

A chave privada é o secret `PLUGIN_SIGNING_PRIVATE_KEY`, codificado como
PKCS#8 DER em base64url. Ela não pode ser impressa nem armazenada no
repositório. `PLUGIN_SIGNING_KEY_ID` identifica a geração da chave e não é
secreto.

## Rotação e revogação

Para uma rotação planejada, publique primeiro um catálogo ainda assinado pela
chave confiável que introduza a nova identidade editorial, aguarde a
sincronização das instalações e só então passe a assinar releases com a chave
nova. Em comprometimento, revogue a fonte/chave no painel, publique um aviso de
segurança por um canal independente e não substitua assets de releases antigas.

Marketplaces adicionais usam o mesmo formato. O administrador cadastra
`owner/repository` e um `ref`; o Core busca somente o catálogo no GitHub,
verifica assinatura, editor, hash, origem e compatibilidade antes de oferecer a
instalação.
