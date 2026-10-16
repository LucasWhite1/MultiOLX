# MultiOLX Browser

Aplicativo desktop para acessar contas OLX em sessões isoladas e reunir suas conversas em uma caixa de entrada. O MultiOLX Browser substitui o painel web antigo. Não precisa de servidor local, PostgreSQL, Redis, extensão ou Playwright.

## Executar

Instale Node.js e execute no diretório do projeto:

```powershell
npm ci
npm run setup
npm start
```

No Windows, também pode abrir **Abrir MultiOLX Browser.cmd** depois da instalação. Electron usa os binários oficiais; o lockfile fixa a versão instalada.

Crie um perfil por conta, selecione-o e faça login diretamente na OLX. **Chats unificados** reúne as conversas; os botões dos perfis mantêm o acesso individual. A sessão de cada conta fica em uma partição própria, independente do Chrome pessoal. Fechar uma página para economizar memória preserva a sessão; sair da OLX, expiração ou revogação podem exigir novo login.

O **× ao lado do perfil** abre a confirmação de remoção. Remove o perfil e o login salvo deste MultiOLX e o retira dos rascunhos. A conta e os anúncios na OLX não são excluídos. Metadados de remoção impedem que o perfil reapareça ao reiniciar; cópias de segurança antigas não são alteradas.

## VPS e celular

A versão web usa login e senha, interface responsiva e os navegadores executando no servidor. A implantação está preparada com Dockerfile, volume persistente, healthcheck e configuração do Easypanel. Consulte [o guia completo](docs/VPS-EASYPANEL.md). Gere suas credenciais com `npm run credentials`; elas ficam no arquivo privado `data/vps-credentials.txt` e não são enviadas ao Git.

## Anúncios

O botão **Anúncios** permite criar um conteúdo base, escolher contas e personalizar apenas os campos desejados. Inclui fotos compartilhadas, rascunhos criptografados, revisão por conta e preparo assistido no formulário da OLX. O botão Publicar envia automaticamente nas contas selecionadas, com até duas contas em paralelo, publicação gratuita e entrega pela OLX desmarcada. Cada conta mostra seu próprio progresso e resultado. Veja [o fluxo e os limites](docs/ANUNCIOS.md).

## Atendimento

Pressione **Esc** em uma conversa aberta pelos chats unificados para voltar à lista, mesmo com o foco dentro da OLX. Voltar pelo botão ou trocar de conta também encerra o detalhe da conversa anterior: a conta permanece na lista de chats, sem manter aquela conversa aberta em segundo plano. As sessões continuam salvas.

- **Ponto roxo — Não visualizada:** reproduz o indicador nativo da OLX. Atualmente a lista real informa um ponto, sem quantidade de mensagens; o aplicativo não inventa um número.
- **Laranja — Visualizada · aguarda sua resposta:** última mensagem identificada como recebida e conversa lida.
- **Azul / Você:** última mensagem identificada como enviada pela própria conta.
- **Visualizada · autoria não identificada:** a OLX informa que foi lida, mas a autoria da última mensagem ainda não foi confirmada.
- **Estado não identificado:** o site ainda não forneceu os sinais necessários.

Há filtros por atendimento, conta e texto. A autoria é confirmada pela última bolha renderizada da conversa, quando o histórico mais recente está carregado e corresponde à prévia. A lista nativa não fornece autoria suficiente para classificar todas as conversas antigas de imediato. O aplicativo não abre todas as conversas automaticamente, pois isso poderia marcá-las como lidas. O estado confirmado é salvo com o resumo e invalidado quando a prévia/horário muda. “Visualizada” indica leitura pela conta ou exibição confirmada no navegador; não comprova que uma pessoa leu o texto nem que o destinatário leu sua resposta.

## Desempenho

**Economizar em segundo plano** adia novas imagens e mídia dos chats ocultos e suspende animações e a renderização dos espaços de publicidade. Ao exibir a conta, os recursos que falharam por adiamento podem carregar novamente, sem reiniciar o cliente de chat. Documentos, scripts, estilos, fontes, XHR e WebSockets continuam disponíveis. Login, verificações e outros sites não recebem esse corte.

O limite padrão é **2 páginas ativas**, ajustável para 4, 6 ou 8. As contas excedentes preservam a sessão e os resumos e atualizam em rodízio; não mantêm recebimento contínuo quando suspensas. Com mais contas, o atraso do rodízio aumenta. Não há garantia de um número máximo de contas ou economia percentual de RAM: scripts e conexões do chat continuam tendo custo.

## Dados

No Windows, perfis e sessões ficam em **%USERPROFILE%/.multiolx/browser**, fora deste repositório. Esse caminho é o mesmo ao abrir pelo atalho ou pelo Codex da Microsoft Store. Na primeira abertura, os dados anteriores de AppData (incluindo a pasta redirecionada do Codex) são copiados para o novo local; a origem é preservada. Cookies e resumos adicionais usam o cofre do sistema operacional. Não compartilhe esse diretório: contém sessões autenticadas. Faça backup com o aplicativo fechado. A configuração `MULTIOLX_BROWSER_DATA_DIR` continua definindo o diretório dos testes e do servidor.

O painel antigo foi desativado e seu código movido para **legacy-panel/**, ignorado pelo Git, após a exclusão em lote ser bloqueada pela revisão automática. A pasta de legado não participa da execução, testes ou dependências. Os dados antigos e o arquivo local de configuração foram preservados. O botão Abrir painel e a ponte para localhost:3001 foram retirados. O servidor antigo e seus containers PostgreSQL/Redis foram encerrados, preservando os volumes.

Esta versão é desktop. Hospedagem multiusuário em VPS/Easypanel exige outro projeto de execução remota; o aplicativo não vira um serviço web apenas ao colocá-lo em Docker.

## Verificação

```powershell
npm run check
npm test
npm run test:browser
```

Os testes de runtime usam perfis temporários e páginas locais, sem acessar contas reais. Cobrem isolamento/restauração de sessão em outro processo, busca/filtros, leitura/autoria, abertura de conversa pelo cliente nativo, retorno com Esc, encerramento do detalhe em segundo plano, novas mensagens não lidas após voltar, adiamento/restauração de imagens e 8 perfis simulados com no máximo 2 páginas ativas. As capturas de teste ficam em artifacts/ e não entram no Git.

Detalhes: [navegador](docs/MULTIOLX-BROWSER.md), [chats unificados](docs/CHATS-UNIFICADOS.md), [desempenho](docs/NAVEGADOR-DESEMPENHO.md).
