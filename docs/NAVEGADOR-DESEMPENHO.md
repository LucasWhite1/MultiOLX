# Correção de abertura e modo leve

## Abertura da conversa

O navegador passou a selecionar o item da própria lista da OLX. Ele deixou de recarregar o documento completo com a URL `?chat-id=...`, preservando o cliente de chat já inicializado. A seleção continua vinculada ao perfil e à sessão de origem, e não envia mensagens.

A leitura distingue a lista, a conversa aberta, a abertura em andamento, uma caixa vazia confirmada e falhas de autenticação/conexão. A ausência da lista lateral no layout estreito da OLX não significa, por si só, perda da sessão. Há prazo de abertura de 15 segundos para evitar um estado de carregamento sem explicação. Recarregar, na conversa unificada, reabre a lista inicial daquele perfil para recuperação manual.

O filtro de navegação se aplica à janela principal e deixa de sinalizar redirecionamentos de frames auxiliares como erro da conta. Continua bloqueando navegação principal para destinos fora dos domínios autorizados. O aviso promocional específico para abrir o aplicativo oficial pode ser dispensado pelo botão nativo “Agora não”; isso não trata desafios ou verificações de segurança.

A apresentação de novidades do chat (“Evoluímos pra você negociar…”) também pode ser fechada pelo controle nativo de fechar. Diálogos não relacionados não são dispensados por essa rotina.

Em janelas menores, a conversa selecionada ocupa a área principal e o botão **Conversas unificadas** retorna à caixa conjunta. Em janelas maiores, a lista e a conversa permanecem lado a lado. O zoom normal da página é ajustado para manter o layout de desktop do chat numa área menor; isso não modifica o user agent nem as identificações do motor.

## Memória e várias contas

- Padrão de duas páginas ativas, ajustável no cabeçalho para 4, 6 ou 8.
- Uma página por perfil, compartilhada entre os acessos individual e unificado.
- Ao atingir o limite, a página menos usada e fora da visualização entra em espera. A sessão e os resumos são preservados. A página em uso e perfis com janelas de login abertas não são escolhidos para suspensão.
- Contas em espera são consultadas em rodízio. Não existe mais o recorte silencioso que consultava apenas os três primeiros perfis.
- O chat visível é lido a cada cinco segundos e páginas de fundo a cada quinze. Uma conta em espera não mantém uma conexão de chat continuamente ativa. Com mais contas, sua atualização depende do tempo do rodízio e do carregamento de cada site.
- Páginas ocultas usam o controle normal de atividades em segundo plano do Electron. Recebem dimensões válidas para evitar inicialização num viewport de tamanho zero.
- O aplicativo só publica uma nova lista para a interface quando seu conteúdo, estados ou recursos mudam, evitando reconstruir centenas de linhas sem necessidade.
- As cópias de cookies só são regravadas quando há mudanças. Os resumos são preservados em `inbox.enc`, criptografados com o cofre do sistema, e restaurados como contas em espera.
- A janela mostra uma estimativa da memória dos processos do aplicativo. Essa soma não é uma promessa de consumo máximo nem uma comparação antes/depois.

O limite de páginas é um orçamento de recursos, não o número de contas cadastradas. Não há um número universal de contas que funcionará sem travar: histórico, mídia, quantidade de mensagens, RAM disponível e outras aplicações alteram o custo. Aumentar o limite mantém mais contas ativas, mas aumenta o uso de memória; reduzir o limite aumenta o tempo de atualização das contas em espera.

## Verificação

O teste de runtime usa oito perfis fictícios, mantém no máximo duas páginas e confere a preservação dos resumos após suspensão. Também verifica que a seleção nativa não gera novas requisições do documento principal, preserva a sessão correta e diferencia conversa aberta de erro de conexão. As sessões continuam sendo restauradas depois de reiniciar o processo.

No teste real de 15/10/2026, a seleção pela lista abriu uma conversa com o campo de mensagem disponível e sem os blocos de carregamento. Nenhuma mensagem foi enviada pelo agente. Isso valida a abertura observada; o teste com oito perfis é simulado e não comprova a capacidade para oito ou mais contas reais em qualquer máquina.

Referências de implementação: [eventos de navegação do Electron](https://www.electronjs.org/docs/latest/api/web-contents#event-will-redirect), [desempenho no Electron](https://www.electronjs.org/docs/latest/tutorial/performance).

## Recursos visuais de fundo

O modo de economia adia novas requisições de imagens e mídia originadas no documento principal do chat quando sua página está oculta. Também aplica CSS reversível para interromper animações/transições e suspender a renderização dos placeholders de publicidade identificados. Ao exibir a página, remove esse CSS e tenta carregar imagens/mídia adiadas, sem recarregar a conversa. Uma imagem já carregada não é removida da memória por esse mecanismo; o orçamento de páginas continua sendo o controle principal de memória. Não são bloqueados documentos, scripts, XHR, WebSockets, estilos, fontes, login ou imagens de verificações Cloudflare/Google. O usuário pode desativar a economia no cabeçalho.

O teste de runtime confirma que imagens não chegam ao handler de recursos de uma página oculta e ficam disponíveis ao exibi-la; também verifica que a seleção de conversa não gera nova requisição do documento. Isso demonstra o comportamento de carregamento, não uma redução percentual de RAM em contas reais.

Referência: [interceptação por tipo de recurso no Electron](https://www.electronjs.org/docs/latest/api/web-request).
