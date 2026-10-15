import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { passwordHash } = createRequire(import.meta.url)('../browser/server-vault.cjs');
const root = await mkdtemp(path.join(tmpdir(), 'multiolx-docker-test-'));
const id = randomUUID(),
  volume = 'multiolx-test-' + id,
  image = process.argv[2] || 'multiolx:vps-test';
const containers = [];
const password = randomBytes(20).toString('base64url');
const environment = `MULTIOLX_PUBLIC_URL=http://127.0.0.1:3000\nMULTIOLX_ALLOW_HTTP=1\nMULTIOLX_ADMIN_USER=admin\nMULTIOLX_ADMIN_PASSWORD_HASH=${passwordHash(password)}\nMULTIOLX_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nMULTIOLX_TEST_PASSWORD=${password}\nMULTIOLX_BROWSER_DATA_DIR=/data/multiolx-web-test-run\nMULTIOLX_TEST_ARTIFACTS=/data/web-test-artifacts\n`;
const envFile = path.join(root, 'test.env');
await writeFile(envFile, environment, { mode: 0o600 });
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || result.stdout || 'Docker falhou.');
  return (result.stdout + (args[0] === 'logs' ? result.stderr : '')).trim();
}
try {
  docker(['volume', 'create', volume]);
  for (const [index, stage] of ['--web-self-test', '--web-restore-test', null].entries()) {
    const name = 'multiolx-smoke-' + id + '-' + index;
    containers.push(name);
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--shm-size=1g',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--security-opt',
      'seccomp=' + path.resolve('deploy/chromium-seccomp.json'),
      '--env-file',
      envFile,
      '-v',
      volume + ':/data',
      image,
      '/app/scripts/container-start.sh',
      ...(stage ? [stage] : []),
    ]);
    if (!stage) {
      const deadline = Date.now() + 30000;
      let healthy = false;
      while (Date.now() < deadline) {
        const probe = spawnSync(
          'docker',
          [
            'exec',
            name,
            'node',
            '-e',
            "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
          ],
          { stdio: 'ignore' },
        );
        if (probe.status === 0) {
          healthy = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!healthy) throw Error('Serviço normal não ficou saudável.');
      docker(['stop', '--time', '35', name]);
      if (docker(['inspect', '--format', '{{.State.ExitCode}}', name]) !== '0')
        throw Error('Encerramento gracioso falhou.');
      console.log(
        'MULTIOLX_DOCKER_SHUTDOWN_OK: serviço saudável e encerramento com SIGTERM preservando o runtime até salvar.',
      );
      continue;
    }
    const code = await new Promise((resolve, reject) => {
      const child = spawn('docker', ['wait', name], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('Teste Docker excedeu 90 segundos.'));
      }, 90000);
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        resolve(Number(output.trim()));
      });
    });
    const logs = docker(['logs', name]);
    console.log(logs);
    if (code !== 0 || !logs.includes(index === 0 ? 'MULTIOLX_WEB_OK' : 'MULTIOLX_WEB_RESTART_OK'))
      throw Error('A verificação do container falhou.');
  }
  console.log(
    'MULTIOLX_DOCKER_OK: navegador com sandbox, login, imagem, entradas, celular e persistência em volume entre containers.',
  );
} finally {
  for (const name of containers) spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
  if (
    path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith('multiolx-docker-test-')
  )
    throw Error('Diretório temporário inválido.');
  await rm(root, { recursive: true, force: true });
}
