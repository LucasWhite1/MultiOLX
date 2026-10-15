# Sandbox Chromium no container

`chromium-seccomp.json` deriva do perfil padrão do [Moby](https://github.com/moby/profiles/blob/main/seccomp/default.json), obtido em 15/10/2026. A licença original está em `LICENSE.moby`.

Modificação: preserva as regras dos demais syscalls e permite `clone`, `clone3`, `setns`, `unshare` e `chroot` para o sandbox por user namespaces. O container continua não privilegiado, com `cap_drop: ALL` e `no-new-privileges:true`; o Electron mantém `app.enableSandbox()` e as páginas remotas não recebem Node/preload. O helper SUID legado é dispensado; não é usado `--no-sandbox`.

O syscall `chroot` é necessário ao zygote dentro do novo user namespace; sem ele, o Chromium falhou em `sys_chroot("/proc/self/fdinfo/")`. Ele não concede privilégios ao usuário 1000 no namespace do host.

O Docker padrão deste ambiente bloqueou `unshare -Ur` com `Operation not permitted`. Com o perfil, o comando passou usando UID 1000 e nenhuma capability. O Compose aplica o perfil a partir do arquivo do repositório. O host precisa permitir user namespaces para esse container; não é necessário desabilitar globalmente o seccomp ou conceder SYS_ADMIN.
