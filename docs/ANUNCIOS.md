# Anúncio base e variações por conta

O botão **Anúncios** abre o editor local do MultiOLX Browser. Não depende do painel antigo ou de um servidor. A integração opcional com DeepSeek auxilia o preenchimento das características na OLX; título e descrição continuam sendo os dados salvos no rascunho.

## DeepSeek Flash

Em **Anúncios → IA para preencher características**, configure a chave, habilite a integração e use **Testar conexão**. A chave fica em `deepseek.enc` no diretório privado do aplicativo, protegida pelo cofre do Windows; nunca é devolvida à interface nem enviada à OLX. Em um ambiente de servidor, a chave também pode vir de `DEEPSEEK_API_KEY`.

O identificador solicitado é `deepseek-v4-flash`. A [documentação atual da DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/) informa que esse nome é um alias atendido pelo Flash atual. O modelo efetivamente retornado pela API aparece na configuração após uma consulta.

A IA recebe somente título, descrição, categoria de referência, opções da característica e a primeira foto do produto. Não recebe sessão, cookies, conversas, perfil ou endereço da conta. O processo principal consulta a API e aceita apenas uma opção existente, com confiança declarada de pelo menos 90%; isso ajuda a filtrar dúvidas, mas não substitui a revisão humana. Opções dependentes são recolhidas novamente após cada seleção. Condição já selecionada é preservada. Dados ausentes param para conferência, sem inventar estado de conservação, bateria ou autenticidade.

Use **Informações para a IA** para registrar fatos adicionais uma única vez, como condição, lacre, marca ou capacidade. Esse campo é compartilhado entre as contas e também aceita variações. Ele é enviado à IA e não é acrescentado automaticamente à descrição pública. Condição não preenchida exige informação explícita no título, descrição ou nesse campo; embalagem aparentemente intacta na foto não basta para afirmar que o produto é novo.

O seletor **Condição do produto** fica no cadastro, antes da publicação: Novo, Usado - Excelente, Usado - Bom, Recondicionado ou Com defeito ou avarias. A condição base é herdada pelas contas e pode ser personalizada. Com a IA habilitada para Produtos, a revisão e o preparo exigem essa seleção antes de abrir o site. O valor declarado é aplicado diretamente à opção correspondente da OLX, sem pedir à IA para adivinhar.

Categorias de referência são interpretadas semanticamente pela IA, pois a OLX pode usar um nome mais amplo: por exemplo, perfumes em Moda e beleza / Beleza e Cuidados Pessoais. Sem IA, a conferência manual continua disponível. A IA apenas escolhe características; o publicador executa o envio autorizado pelo botão Publicar. Não contrata destaques nem preenche dados pessoais. Erros de chave, saldo, limite ou timeout são informados sem reproduzir a resposta bruta do provedor.

A relação de perfumes com a categoria ampla foi conferida na [própria listagem de perfumes e colônias da OLX](https://www.olx.com.br/beleza-e-saude/perfumes-e-colonias). Esse contexto é fornecido ao modelo para evitar que ele invente uma categoria separada quando o formulário disponibiliza apenas o tipo residual Outros.

Se a própria OLX falhar na identificação e abrir o seletor de categorias, a IA também pode escolher a hierarquia entre os cartões e subcategorias efetivamente visíveis. São permitidos até cinco níveis; opções inexistentes, escolhas incertas ou ausência de transição param com uma mensagem de conferência, sem repetir indefinidamente.

## Criar uma vez

1. Preencha tipo de anúncio, título, descrição, preço, CEP e categoria de referência no anúncio base.
2. Adicione fotos uma vez. A primeira é a capa; as setas alteram a ordem. A biblioteca usa JPG, PNG e WebP, otimiza para JPEG com até 1920 pixels no maior lado e preserva a proporção. Os originais escolhidos não são alterados.
3. Selecione as contas desejadas ou use Todas/Nenhuma.
4. Abra uma conta e marque Personalizar apenas no campo que deseja variar. Desmarcar volta a usar o valor base. Usar todo o anúncio base remove todas as variações daquela conta.
5. Use Revisar detalhes para comparar o resultado completo, se desejar. Clique em Publicar em N contas para iniciar o envio automático nas contas selecionadas.

O título e a descrição não precisam ser repetidos. Alterações na base chegam às contas que herdam aquele campo; substituições explícitas permanecem intactas. As fotos são compartilhadas. É possível manter vários rascunhos. Alterações são salvas automaticamente após uma breve pausa e ao fechar normalmente o aplicativo. Rascunhos incompletos podem ser salvos; pendências impedem preparar a publicação.

## Formulário da OLX

Abrir na OLX e preencher usa a sessão da conta indicada e o fluxo público **desapega**. O aplicativo inicia o anúncio e seleciona o tipo escolhido. Aplica título, fotos, descrição, CEP e preço nas etapas reconhecidas. Reconhece o seletor oculto de fotos que aceita extensões (.jpg, .jpeg etc.), aguarda progresso/carregamento e o botão Continuar, e espera o processamento pela IA da OLX. A descrição salva substitui o texto gerado pelo site.

A barra no rodapé indica o avanço do cadastro inteiro (por exemplo, 30% na etapa de fotos). Ela não é tratada como upload pendente. O preparo observa o processamento fora dessa navegação, as prévias das fotos inseridas e a liberação do botão Continuar; imagens de publicidade não impedem o avanço.

Na etapa de características, continua sem inventar atributos opcionais quando a categoria de referência coincide com o texto apresentado pela OLX. Categoria divergente ou características obrigatórias param para conferência. Na etapa da Garantia da OLX, o fluxo continua pela introdução, desmarca Entrega pela OLX e confirma Tenho outros motivos na pergunta de recusa. Nome, nascimento e outras exigências pessoais pausam apenas aquela conta para preenchimento direto. O modo de revisão individual continua disponível em Revisar detalhes.

Na página final de destaques, seleciona **Anunciar sem destacar**, verifica a opção gratuita e aciona **Finalizar anúncio** automaticamente após confirmar os campos e fotos. O formulário completo em uma única página também é reconhecido. A fila executa até duas contas simultâneas, respeitando o limite de páginas configurado (limite 1 executa uma por vez). As páginas de publicação ficam protegidas do rodízio de chats enquanto o trabalho está ativo. O painel mostra progresso e resultado por conta. Cancelar interrompe contas pendentes e o próximo passo das contas ativas; um envio já clicado continua sendo conferido para impedir duplicação.

## Resultado e retomada

Preparado não significa publicado. O envio fica incerto até a confirmação pública **Anúncio enviado com sucesso!**. Essa confirmação registra **SUBMITTED**, que significa recebido para processamento. Sem confirmação, o estado continua incerto; nenhum dos dois é repetido automaticamente. O estado **PUBLISHED** só é comprovado pela lista de publicados com título, preço, situação e link do anúncio correspondente. Antes de cada execução, o publicador consulta a lista de publicados na sessão correta. Se encontrar o anúncio correspondente, registra o link e não cria outro. Se a consulta falhar, interrompe aquela conta. O conciliador de manutenção também permite fazer essa leitura isoladamente. Preparos de uma execução anterior também exigem conferência. Na revisão, os botões Conferi na OLX registram o resultado informado pela pessoa; não comprovam aprovação/ativação automática pela plataforma. Confirmar que não foi enviado libera nova preparação. Editar o conteúdo local não edita um anúncio já enviado.

Os limites/validações do site continuam sendo aplicados. A [ajuda oficial de publicação](https://ajuda.olx.com.br/s/article/como-publicar-anuncio) informa título de até 90 caracteres, descrição de até 6000, fotos até 5 MB e pelo menos uma foto; categorias comuns têm até 6 imagens e Autos/Imóveis até 20. Limites de anúncios e recusas são decisões da OLX. Consulte as [regras de publicação](https://ajuda.olx.com.br/s/article/regras) para uso das contas e anúncios.

## Persistência e testes

Rascunhos, variações, resultados e miniaturas ficam em announcements.enc; fotos otimizadas em listing-photos/<UUID>.enc, no diretório privado %APPDATA%/MultiOLX Browser. Tudo usa o mesmo cofre do sistema operacional das cópias de sessão. Identificadores de conta/foto, versões concorrentes e o emissor IPC são validados; páginas remotas não recebem preload ou acesso ao catálogo.

Testes unitários verificam herança, personalização, revisão, validação, espera de fotos/IA, categoria, pausa de identidade, retomada e preservação de resultados. O teste de runtime cobre duas contas fictícias, foto importada e criptografada, interface/revisão, formulário local em uma página e em etapas, seletor oculto por extensões, controles ocultos, redirecionamento para cadastro, seleção gratuita, confirmação de envio, conciliação, bloqueio de repetição e restauração em outro processo. O teste também executa duas contas simultaneamente até a finalização, desmarca a entrega, confirma a recusa, escolhe a opção gratuita e verifica que repetir a fila não repete o envio. As fixtures não publicam anúncios reais.

Em 15/10/2026 foi percorrido manualmente o fluxo real autorizado pelo usuário: iPhone 14 com duas fotos próprias, descrição salva, preço R$ 1.950 e CEP informado. Os dados pessoais foram concluídos pelo titular. Após Finalizar anúncio na opção gratuita, a OLX confirmou o envio e a lista da conta mostrou **PUBLICADO**, ID **1544482698**. Esse anúncio real validou o percurso; a automação corrigida foi exercitada em fixtures para evitar criar um anúncio duplicado. Outras categorias e exigências da conta podem abrir etapas adicionais que pedem intervenção.

O teste do publicador em lote nas contas reais encontrou o perfume já publicado em ambas: Teste/Maria (1544499540) e teste 2/Jorge (1544501733). A conciliação registrou PUBLISHED e preservou os anúncios, sem novo envio. O percurso automático completo, incluindo duas contas simultâneas, recusa de entrega e finalização gratuita, foi validado nas sessões de teste isoladas do Electron.

Correção dos seletores em segundo plano: menus de características renderizados em portais podem permanecer montados durante a saída, com data-state=closed. A leitura ignora esses menus e cópias aria-hidden, usa o menu aberto correspondente ao campo e confere o valor após selecionar. O teste de runtime mantém portais fechados na página para reproduzir esse caso sem publicação real.

Na conferência real da caixa de som Aiwa, as escolhas Boombox / Outros / Novo foram aplicadas e confirmadas no formulário. A lista de publicados passou a mostrar o produto em ambas as contas: Teste/Maria 1544511303 e teste 2/Jorge 1544509302. A última execução de diagnóstico apenas conciliou esses anúncios existentes, sem novo envio. O diálogo de entrega aberto durante animação também passou a usar o estado público data-state=open; a fixture mantém opacidade inicial zero para reproduzir o caso em segundo plano.
