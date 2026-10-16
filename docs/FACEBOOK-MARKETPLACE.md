# Facebook Marketplace — conexão inicial

A versão OLX anterior está preservada na tag `stable-olx-2026-10-16` (commit `f311850`), no GitHub e no ZIP privado `data/MultiOLX-estavel-OLX-2026-10-16.zip`. O backup privado de metadados, fotos e cofres criptografados anteriores está em `data/versao-estavel-OLX-2026-10-16/`. Não contém dependências instaladas nem é uma cópia completa dos caches nativos. Esses arquivos privados não são enviados ao Git. Feche o aplicativo e preserve os dados atuais antes de qualquer restauração.

O desenvolvimento do Facebook fica na branch `codex/facebook-marketplace`, separada da versão estável.

O botão **Conectar Facebook Marketplace** cria um perfil com sessão própria e abre a interface pública do Marketplace para login manual. Senha e verificação são preenchidas diretamente no Facebook. A navegação desse perfil é restrita a Facebook e Messenger; perfis OLX mantêm sua restrição anterior. As contas Facebook não são oferecidas como destinos para publicar anúncios OLX.

Após o login, os chats unificados leem exclusivamente a caixa **Marketplace**, nas abas Compra e Venda, ou a pasta com cabeçalho **Marketplace** na interface pública do Facebook. A lista geral do Messenger não é uma fonte de conversas. O aplicativo pode abrir o menu Messenger e selecionar sua pasta Marketplace; não importa as linhas pessoais exibidas antes dessa seleção. A leitura para se a identificação dessa origem não puder ser confirmada.

Os identificadores são os links públicos `/messages/t/<id>/` presentes nessa pasta. A caixa principal reutiliza esses identificadores quando o contato e anúncio permitem uma correspondência única; novas linhas recebem uma chave local por aba e legenda e são abertas pela própria linha nativa. Correspondências ambíguas são ignoradas. Nome, anúncio, prévia, horário, prefixo “Você:” e indicação explícita de não lida vêm do DOM. Não há extração de tokens, chamadas a APIs internas ou leitura do estado React. Não é inventada quantidade de mensagens quando o Facebook mostra apenas uma indicação de não lida. Sem sinal explícito de autoria ou leitura, o estado permanece desconhecido.

Selecionar uma conversa usa seu link dentro da pasta, abrindo o chat nativo para resposta manual. Voltar com Esc ou pelo botão fecha os painéis de conversa identificados pelo banner Marketplace e mantém a lista. Painéis pessoais não são fechados ou importados. Não há envio automático de mensagens nesta integração.

A coleta mantém até 200 resumos por conta e percorre a rolagem da pasta em rodadas limitadas quando a conta está em segundo plano. Histórico ainda não carregado pelo Facebook pode exigir novas atualizações. O limite geral de páginas ativas continua valendo: contas suspensas atualizam em rodízio, sem garantia de recebimento contínuo. Apenas uma conta Facebook é conectada pelo botão inicial nesta versão.

Validação real inicial: 29 conversas Marketplace reconhecidas, com indicador de não lida e prévias de mensagens próprias. Testes locais cobrem uma mensagem pessoal fora da pasta (que não pode ser importada), identificação de origem, abertura na sessão correta, Esc e novas mensagens não lidas após fechar. Nenhuma mensagem de teste foi enviada pela conta real.
