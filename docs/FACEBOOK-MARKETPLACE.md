# Facebook Marketplace — conexão inicial

A versão OLX anterior está preservada na tag `stable-olx-2026-10-16` (commit `f311850`), no GitHub e no ZIP privado `data/MultiOLX-estavel-OLX-2026-10-16.zip`. O backup privado de metadados, fotos e cofres criptografados anteriores está em `data/versao-estavel-OLX-2026-10-16/`. Não contém dependências instaladas nem é uma cópia completa dos caches nativos. Esses arquivos privados não são enviados ao Git. Feche o aplicativo e preserve os dados atuais antes de qualquer restauração.

O desenvolvimento do Facebook fica na branch `codex/facebook-marketplace`, separada da versão estável.

O botão **Conectar Facebook Marketplace** cria um perfil com sessão própria e abre a interface pública do Marketplace para login manual. Senha e verificação são preenchidas diretamente no Facebook. A navegação desse perfil é restrita a Facebook e Messenger; perfis OLX mantêm sua restrição anterior. As contas Facebook não são oferecidas como destinos para publicar anúncios OLX.

Nesta etapa, a leitura/unificação de mensagens Facebook está desativada. Após o login, será necessário identificar e validar a caixa exclusiva do Marketplace na conta real, incluindo a distinção das conversas pessoais. Nenhum chat pessoal é importado por esta etapa. O botão Chat abre o destino Marketplace; a disponibilidade e o redirecionamento dependem da sessão e da interface fornecida pelo Facebook.
