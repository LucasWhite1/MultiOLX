# MultiOLX Browser

Aplicativo desktop dedicado em Electron/Chromium, com interface local própria e páginas da OLX em uma área de navegação separada. É uma primeira versão do navegador, não um fork do código do Chromium. Substitui o painel web antigo; o envio de respostas continua diretamente na interface nativa da OLX.

Agora oferece [chats unificados](CHATS-UNIFICADOS.md) dos perfis conectados, com busca, filtro por conta e abertura da conversa na sessão de origem. O acesso individual continua disponível. A lista foi verificada com dois perfis reais em 15/10/2026.

## Executar no Windows

```powershell
npm ci
node node_modules/electron/install.js
npm run browser
```

O binário vem das versões oficiais do Electron no GitHub. O instalador verifica o checksum publicado no pacote. O projeto usa Electron 44.7.2, fixado no lockfile. A instalação do binário é separada porque essa versão não o baixa automaticamente ao instalar o pacote npm.

1. Crie um perfil com o nome da conta.
2. Selecione esse perfil. O aplicativo abre a OLX para login manual.
3. Use os botões OLX e Chat para navegar. Voltar, avançar e recarregar operam somente o perfil selecionado.
4. Você pode manter vários perfis abertos e alternar entre eles. Cookies e armazenamento de um perfil não são compartilhados com os outros ou com seu Chrome pessoal.

Nenhuma senha OLX é solicitada pelo aplicativo. O login acontece diretamente na página do provedor. O padrão do motor Electron/Chromium é mantido, inclusive seu user agent. Não se removem indicadores de automação, não se alteram fingerprints e não se contornam certificados, desafios ou bloqueios.

## Persistência

Os dados ficam em `%APPDATA%/MultiOLX Browser`, fora do Git e do diretório do Chrome pessoal. `profiles.json` contém somente os nomes e UUIDs locais. Cada sessão usa uma partição persistente própria do Chromium.

Além da persistência nativa do motor, cookies são salvos a cada 30 segundos e antes de encerrar em arquivos `session-<UUID>.enc`, usando `safeStorage` e o cofre de credenciais do sistema. Essas cópias permitem restaurar cookies de sessão após reiniciar o aplicativo. O aplicativo mantém essas cópias no diretório privado do próprio navegador. Falha na persistência durante o encerramento mantém o aplicativo aberto e mostra o erro. Uma queda forçada pode perder alterações recentes.

Isso não equivale a criptografar o perfil completo: o Chromium também mantém seu armazenamento nativo no volume de dados. Proteja o usuário do sistema e o disco. Expiração, logout e revogação pela OLX podem invalidar o login mesmo com os arquivos preservados. Em Linux, um backend `basic_text` não é aceito como cofre de criptografia; será necessário configurar um keyring apropriado.

## Segurança da aplicação

A página remota não recebe Node.js, preload ou API de IPC. A interface local recebe uma ponte restrita, e cada chamada valida o emissor e o frame. Sandbox, isolamento de contexto, validação de certificados e segurança de origem permanecem ativos. Navegação de topo e popups aceitam apenas HTTPS nos domínios OLX e de login Google indicados em `browser/policy.cjs`. Downloads e permissões adicionais estão desativados nesta primeira versão.

O Electron não é o Chrome oficial: Google e OLX podem rejeitar login ou acesso nesse aplicativo. Uma janela personalizada não comprova compatibilidade geral com a plataforma. A leitura do chat foi validada com dois perfis reais em 15/10/2026; isso não garante aceitação futura ou de outros fluxos.

## Testes

`npx vitest run tests/dedicated-browser.test.ts` verifica nomes/identificadores, restrições de URLs e parâmetros de restauração de cookies.

`npm run test:browser` inicia o runtime oficial em um diretório temporário, carrega a interface local, testa a ponte IPC, criação/renomeação de perfis, navegação numa fixture interceptada, fechamento e isolamento de cookies entre duas sessões. Depois encerra o processo, inicia outro e verifica a restauração do catálogo e do cookie fictício a partir da cópia criptografada. Gera `artifacts/multiolx-browser.png`. Não abre OLX/Google e não usa dados pessoais. O diretório temporário é removido ao terminar.

## VPS e escala

O aplicativo mantém perfis independentes no mesmo processo para um administrador. Isso ainda não constitui isolamento entre clientes. A operação na VPS requer serviço de navegador com desktop/acesso remoto protegido, volume próprio por usuário, gerenciamento de processos, autenticação e autorização por workspace. Electron pode executar em Linux, mas esta versão não possui configuração Docker/Easypanel, keyring e acesso remoto preparados para clientes.

O navegador precisa continuar rodando em um computador. O painel web antigo foi desativado; esta versão não oferece acesso pelo celular. As contas suspensas atualizam por rodízio e não mantêm uma conexão contínua.

Referências técnicas: [segurança no Electron](https://www.electronjs.org/docs/latest/tutorial/security), [sessões e partições](https://www.electronjs.org/docs/latest/api/session), [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view).
