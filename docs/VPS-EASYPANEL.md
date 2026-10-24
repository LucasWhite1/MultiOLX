# MultiOLX na VPS com Easypanel

Esta versão fornece painel HTTP autenticado, interface responsiva e acesso ao navegador OLX que roda no servidor. O mesmo motor Electron mantém as sessões isoladas e executa os chats e a publicação. Não depende de deixar seu computador ou o navegador do celular aberto.

## O que é compartilhado

Há um administrador e um espaço de trabalho: todos os dispositivos autorizados veem as mesmas contas e rascunhos. Não é uma plataforma com clientes/empresas separados. Para evitar cliques e navegações conflitantes, um dispositivo por vez controla o navegador; os outros podem consultar informações. Use **Liberar controle** na tela remota ou aguarde 60 segundos sem operações do dispositivo anterior.

## Preparação

1. As credenciais geradas nesta preparação estão em `data/vps-credentials.txt` no seu computador. Para uma instalação nova que ainda não tenha esse arquivo, execute `npm run credentials`. O comando cria `data/vps-credentials.txt`, que é ignorado pelo Git. Não sobrescreve um arquivo existente. O arquivo contém seu usuário, senha forte gerada e as variáveis necessárias. Guarde-o em local privado.
2. Escolha um subdomínio, por exemplo `multiolx.seudominio.com.br`, apontado para a VPS.
3. No Easypanel, crie um projeto e um serviço **Compose**, com origem **Git**, URL `https://github.com/LucasWhite1/MultiOLX`, branch `codex/facebook-marketplace` (versão com Marketplace e correções de inicialização), Build Path `/` e Docker Compose File **`compose.yml`**. O Compose constrói a imagem pelo Dockerfile e aplica o perfil de sandbox necessário. Se o repositório for privado, adicione a chave SSH pública mostrada pelo serviço como deploy key somente de leitura no GitHub. Use a URL SSH `git@github.com:LucasWhite1/MultiOLX.git` quando usar essa chave.
4. Em **Environment**, habilite **Create .env file** e configure as variáveis abaixo com os valores do arquivo privado:

```dotenv
MULTIOLX_PUBLIC_URL=https://multiolx.seudominio.com.br
MULTIOLX_ADMIN_USER=admin
MULTIOLX_ADMIN_PASSWORD_HASH=valor_gerado_no_arquivo
MULTIOLX_ENCRYPTION_KEY=valor_gerado_no_arquivo
PORT=3000
```

`MULTIOLX_WEB=1` e `MULTIOLX_BROWSER_DATA_DIR=/data` já estão na imagem. `DEEPSEEK_API_KEY` é opcional; também é possível salvar a chave na interface autenticada.

5. O `compose.yml` já monta o volume persistente **`multiolx-data`** em **`/data`**. Preserve essa definição e não use uma pasta temporária. O processo da imagem usa UID/GID 1000:1000; se utilizar bind mount, prepare sua propriedade/permissões para esse usuário. O volume nomeado inicializa com a propriedade do diretório da imagem.
6. Em **Domains**, configure o domínio com HTTPS, serviço interno **`multiolx`**, porta **3000** e protocolo interno HTTP. Não publique as portas do X11 ou qualquer acesso gráfico direto. Só o painel autenticado fica exposto. O endereço em `MULTIOLX_PUBLIC_URL` deve corresponder exatamente à origem usada pelo navegador, sem subcaminho.
7. Faça **Deploy**. Verifique os logs: `MULTIOLX_WEB_READY port=3000` confirma a inicialização HTTP. O healthcheck é `GET /healthz` e não contém dados de contas.
8. Abra o domínio e entre com o usuário e a senha do arquivo privado.

O Dockerfile usa usuário não privilegiado, sandbox por user namespaces do Chromium, Xvfb local sem porta TCP e gerenciador de janelas dentro do container. O Compose remove todas as capabilities e impede elevação de privilégios. O perfil `deploy/chromium-seccomp.json`, derivado do padrão do Moby, permite os syscalls de namespaces e chroot necessários ao sandbox. O helper legado SUID não é utilizado. As exigências de user namespaces do host precisam ser atendidas; não adicione `--no-sandbox` ou modo privilegiado para esconder um erro de inicialização. Consulte a seção de diagnóstico se o host impedir o sandbox.

A seleção `--disable-setuid-sandbox` acontece no comando de lançamento do Electron, antes de carregar o JavaScript. Defini-la apenas com `app.commandLine.appendSwitch` é tarde para a inicialização do zygote. Isso seleciona o sandbox por namespaces; não desativa esse sandbox. O Compose de produção não publica portas no host: use o proxy HTTPS do Easypanel, apontando para o serviço interno `multiolx:3000`. A porta 3000 do host pode já pertencer ao próprio painel. O arquivo `compose.local.yml` mantém a publicação em localhost apenas para desenvolvimento.

## Primeiro acesso às contas OLX

Crie um perfil, abra-o e faça o login diretamente na página da OLX exibida no painel. As verificações de identidade/segurança continuam sendo concluídas pela pessoa. Janelas de login Google, quando abertas pela OLX, aparecem no mesmo visualizador remoto; **Fechar janela de login** fecha apenas esse popup.

No celular, toque no campo da OLX e use o campo inferior para inserir texto. Ele começa mascarado para senhas; use **Mostrar texto** se estiver redigindo uma mensagem. Os botões Tab, Apagar, Enter e Esc ajudam a navegar. As setas rolam a página. Fotos dos anúncios são escolhidas no editor do MultiOLX, diretamente do dispositivo, e enviadas uma por vez para reduzir memória e tamanho das requisições.

As contas cadastradas no desktop Windows não são importadas automaticamente. Seus arquivos `.enc` usam o cofre do Windows e não podem ser copiados para o cofre da VPS. A implantação começa com um espaço novo; conecte novamente as contas no servidor. O IP da VPS e o ambiente Linux podem exigir verificação adicional da OLX. Não houve validação de publicação com contas reais em sua VPS; os testes de implantação usam contas e páginas fictícias.

## Persistência, atualizações e acesso

- Os perfis, dados do navegador, fotos, rascunhos e resultados ficam em `/data`.
- O cofre de rascunhos, fotos, chaves da IA e snapshots de sessão usa AES-256-GCM com `MULTIOLX_ENCRYPTION_KEY`. Os arquivos nativos do perfil Chromium também ficam no volume; proteja o volume e seus backups, pois contêm dados de autenticação.
- **Não altere ou perca a chave de criptografia depois de cadastrar dados.** Ela não deve ir para o Git e deve ser guardada separadamente do backup do volume.
- Para atualizar, envie os commits ao Git e faça Deploy, preservando o volume e as mesmas variáveis. O auto deploy do Easypanel é opcional. Feche tarefas em andamento antes de atualizar: um envio cujo resultado ficou incerto exige conferência na OLX antes de repetir.
- Faça backups do volume e das configurações/segredos. Teste a restauração em um ambiente separado.
- Para trocar a senha, gere um novo hash com o utilitário, copie somente `MULTIOLX_ADMIN_PASSWORD_HASH` para o Easypanel e reinicie. **Mantenha a chave de criptografia antiga.** Pode gerar um novo arquivo com `npm run credentials -- data/nova-senha.txt`; não substitua a chave antiga pela chave desse novo arquivo.
- A sessão do painel expira após uma hora sem requisições autenticadas ou após 12 horas desde o login. Reiniciar o serviço exige novo login no painel; isso não encerra deliberadamente as sessões OLX persistidas.
- O painel exige HTTPS em produção, cookie HttpOnly/Secure/SameSite, origem exata e token CSRF nas operações. Há limite para tentativas de login. Não há cadastro público nem senha padrão no código.

## Rodar por Compose

Copie `.env.example` para `.env` e preencha com seus valores privados. O exemplo `compose.yml` usa um volume nomeado, memória compartilhada de 1 GB e encerramento com prazo de 45 segundos. Configure um proxy HTTPS na frente e use a origem HTTPS correspondente. No Easypanel, use o serviço Compose para aplicar as opções de sandbox deste repositório; não basta importar apenas o Dockerfile em um serviço App. Para publicar uma porta local durante desenvolvimento, use também `compose.local.yml`.

```sh
docker compose build
docker compose up -d
docker compose logs -f multiolx
# Somente para acesso direto no próprio host:
# docker compose -f compose.yml -f compose.local.yml up -d
```

Em um teste estritamente local, é possível usar `MULTIOLX_PUBLIC_URL=http://127.0.0.1:3000` e `MULTIOLX_ALLOW_HTTP=1`. A exceção HTTP aceita apenas localhost/127.0.0.1; não é uma configuração para acesso público.

## Diagnóstico

- **Falha antes de `MULTIOLX_WEB_READY`:** consulte os logs do container. Hash ausente, chave inválida, volume sem permissão ou sandbox bloqueado fazem a inicialização falhar explicitamente. Em erros `Operation not permitted` de namespace ou `sys_chroot`, confira se foi usado o Compose com `deploy/chromium-seccomp.json`, em vez de iniciar apenas a imagem com o perfil Docker padrão.
- **Origem não autorizada:** confira o domínio em `MULTIOLX_PUBLIC_URL`, incluindo esquema e porta quando houver. A aplicação espera estar na raiz do domínio.
- **Cofre incompatível:** preserve os arquivos e a chave original. Não apague o volume para tentar corrigir; não misture dados criptografados pelo Windows com o cofre da VPS.
- **Outro dispositivo controlando:** use Liberar controle no primeiro dispositivo ou espere a concessão expirar.
- **Tela remota em branco:** confira se há uma conta selecionada e se Xvfb/openbox estão funcionando. A transmissão só ocorre quando o visualizador está aberto e a página do cliente está visível.
- **Publicação pausada:** veja o resultado da conta. Login, verificações e características desconhecidas podem exigir ação; nenhum envio incerto é repetido automaticamente.

## Testes

`npm test` verifica autenticação, isolamento dos comandos, CSRF, expiração/logout, controle entre dispositivos, limite de tentativas e cofre autenticado, além das funções do desktop. `npm run test:browser` mantém as regressões do Electron. `npm run test:web` inicia o servidor real em perfil temporário, faz login pela interface, envia foto e rascunho, verifica layouts de 390 e 1380 pixels e testa imagem, teclado e cliques no navegador remoto. Um segundo processo confere a restauração. O teste inclui também popup de login, sua interação e fechamento. `npm run test:docker` repete esse percurso dentro da imagem Linux, verifica o volume em um segundo container e confere o encerramento com SIGTERM sem matar o display antes de salvar. Esses testes não acessam contas reais da OLX.

Fontes: [Compose service do Easypanel](https://easypanel.io/docs/services/compose), [captura e entrada no Electron](https://www.electronjs.org/docs/latest/api/web-contents), [sandbox do Electron](https://www.electronjs.org/docs/latest/tutorial/sandbox).
