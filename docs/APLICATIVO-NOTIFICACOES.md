# Aplicativo e notificações no celular

Na versão web por HTTPS, entre no MultiOLX e abra **Aplicativo e notificações**, no menu de contas.

1. Toque em **Instalar aplicativo**. Se a instalação não abrir, use o menu ⋮ do Chrome → **Instalar aplicativo** ou **Adicionar à tela inicial**.
2. Abra o aplicativo pelo novo ícone e entre, se necessário.
3. No mesmo menu, toque em **Ativar notificações** e permita o pedido do navegador.
4. Use **Enviar notificação de teste** para conferir o recebimento naquele aparelho.

O servidor envia Web Push mesmo com a página fechada. A VPS, as sessões das contas e a conexão com a internet precisam continuar disponíveis. Contas suspensas pelo limite de páginas atualizam em rodízio, portanto podem avisar com atraso. A entrega também depende da rede, da permissão do navegador e das configurações de bateria/notificações do celular.

O contador interno e a Badging API usam o número de **conversas não lidas**. Não é uma contagem inventada de mensagens: OLX e Facebook nem sempre informam a quantidade. No Android, o navegador e o launcher controlam o balão do ícone; alguns mostram número, outros ponto. No Samsung, confira **Configurações → Notificações → Configurações avançadas → Selos nos ícones de aplicativos**, quando essa opção estiver disponível. O site não consegue impor a cor ou o número exibido pelo sistema.

Os avisos não incluem o texto das mensagens. Tocar em um aviso abre a conversa correspondente, pedindo login se a sessão do painel expirou. Ao sair da conta do painel pelo botão **Sair**, as notificações daquele dispositivo são desativadas; fechar a janela mantém a inscrição. **Desativar notificações neste dispositivo** preserva as inscrições dos outros aparelhos.

Quando nenhum dispositivo estiver vendo o painel, o detalhe aberto é fechado após uma breve tolerância. As contas permanecem conectadas e acompanhadas na lista, sem manter uma conversa aberta só para marcá-la como vista.

As chaves VAPID e as inscrições são geradas automaticamente e persistidas criptografadas em `notifications.enc`, no volume de dados existente. Preserve o volume e a chave de criptografia nos deployments. Nenhuma chave adicional precisa ser copiada para o Easypanel. O service worker não armazena páginas autenticadas, históricos ou imagens do navegador em cache offline.

Limites: os avisos acompanham as novas mensagens identificáveis na leitura pública dos sites. Alterações de layout, sessão expirada ou dados não disponibilizados pela plataforma podem impedir essa identificação; o painel mostra o estado de cada conta. A primeira importação de histórico antigo não dispara uma sequência de notificações.
