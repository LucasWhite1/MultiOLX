# Chats unificados no MultiOLX Browser

O botão **Chats unificados** reúne os resumos das conversas dos perfis do navegador. A visão abre automaticamente quando já existem perfis cadastrados. Os botões de cada perfil continuam disponíveis para acesso individual; o botão **Chat** usa a mesma página de chat que alimenta a visão unificada.

## Uso

- Cada conversa mostra contato, anúncio, prévia, horário textual da OLX e o nome do perfil de origem.
- A busca procura em contato, anúncio, prévia e perfil. O filtro permite selecionar uma conta.
- Ao escolher uma conversa, seu chat nativo abre na área à direita com a sessão do perfil correto. O cabeçalho identifica a conta usada. Para responder, utilize o campo do próprio chat da OLX.
- Para alternar de conta individualmente, selecione seu perfil na lateral. Para voltar à lista conjunta, clique em **Chats unificados**.
- A atualização lê o chat visível a cada cinco segundos e páginas de fundo a cada quinze. As contas em espera entram em rodízio; seu intervalo de atualização aumenta com a quantidade de contas. O botão ↻ solicita uma nova consulta e pode retomar uma conta que exigiu intervenção.

## Isolamento e limites

Uma conversa é identificada pelo par perfil + identificador da OLX. Contatos ou identificadores iguais em duas contas não são fundidos. A navegação nunca escolhe a conta a partir do nome do contato ou do anúncio.

A lista usa os elementos de chat renderizados pela OLX, até 200 por perfil. O [modo leve](NAVEGADOR-DESEMPENHO.md) mantém duas páginas ativas por padrão, com limite ajustável; as outras contas ficam em espera com sessão e resumos preservados. Não pagina nem importa todo o histórico. As prévias não viram mensagens completas, contagens de não lidas ou provas de envio. Alterações observadas na prévia/horário passam ao topo; a primeira leitura conserva a ordem dentro de cada perfil e intercala os perfis, sem inventar datas completas.

O histórico completo e a composição de mensagens permanecem na página nativa. O envio é feito diretamente na OLX; o painel web antigo foi desativado. O aplicativo precisa continuar aberto para manter essas páginas e a leitura. Não há serviço de nuvem ou acesso pelo celular implementado neste recurso.

Caixa vazia só é aceita quando a OLX exibe o estado vazio observado. Carregamento incompleto preserva a última leitura. Login necessário, mudança de estrutura e bloqueios interrompem a leitura daquele perfil e deixam seus resumos anteriores identificados como última leitura. Uma falha de uma conta não apaga as conversas das demais.

## Verificação

- Testes unitários: namespace por perfil, duplicatas, links externos, caixas vazias e preservação em falha.
- `npm run test:browser`: duas sessões fictícias com o mesmo identificador de conversa, extração em DOM interceptado, busca, filtro por conta, abertura na sessão correta, acesso individual, bloqueio e caixa vazia. Nenhuma mensagem real é enviada.
- Teste real em 15/10/2026: perfis locais **Teste** e **teste 2**, ambos com chat reconhecido. Na validação inicial, o primeiro exibiu caixa vazia e o segundo forneceu 61 resumos. Em conferência posterior, o primeiro tinha uma conversa e o segundo 61. O funcionamento do chat individual no segundo foi confirmado pelo usuário. O envio de mensagens não foi testado pelo agente.

As prévias ficam em memória e em uma cópia criptografada `inbox.enc` no diretório privado do aplicativo. Capturas de tela de validação podem conter conteúdo privado e ficam em `artifacts/`, ignorado pelo Git. O modo opcional `--inbox-report` imprime apenas nome do perfil, estado e quantidade; não imprime textos de conversas, cookies ou tokens.

## Indicadores e filtros de atendimento

A lista oferece filtros por não visualizadas, visualizadas que aguardam resposta, última enviada por você, visualizadas com autoria ainda não identificada e estado desconhecido. O ponto roxo acompanha o indicador real da OLX, respeitando visibility:hidden nos pontos de conversas lidas. Iniciais numéricas do avatar não são interpretadas como quantidade. A lista atual não informa um contador.

A autoria vem da bolha de mensagem nativa no histórico recente, e só é associada à conversa quando sua prévia corresponde à lista. Abrir uma conversa não a marca localmente como lida antes de carregar seu conteúdo. O estado de leitura nativo também pode refletir acesso em outro aparelho. A confirmação de autoria persiste criptografada, é isolada por conta e perde validade quando a prévia/horário muda. Se uma prévia e um horário forem idênticos entre duas mensagens diferentes, a lista por si só não permite distinguir esses eventos.

Não se abrem conversas antigas em massa para preencher estados, pois isso alteraria a leitura na OLX. Conversas sem evidência suficiente aparecem como autoria/estado não identificado.
