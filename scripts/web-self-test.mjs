import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import electron from 'electron';
const { passwordHash } = createRequire(import.meta.url)('../browser/server-vault.cjs');
const root = await mkdtemp(path.join(tmpdir(), 'multiolx-web-test-'));
const password = randomBytes(20).toString('base64url');
const env = {
  ...process.env,
  MULTIOLX_WEB: '1',
  MULTIOLX_BROWSER_DATA_DIR: root,
  MULTIOLX_ADMIN_USER: 'admin',
  MULTIOLX_ADMIN_PASSWORD_HASH: passwordHash(password),
  MULTIOLX_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  MULTIOLX_TEST_PASSWORD: password,
  MULTIOLX_ALLOW_HTTP: '1',
  PORT: '3179',
  MULTIOLX_PUBLIC_URL: 'http://127.0.0.1:3179',
  MULTIOLX_BIND_HOST: '127.0.0.1',
  DEEPSEEK_API_KEY: '',
};
delete env.ELECTRON_RUN_AS_NODE;
try {
  for (const stage of ['--web-self-test', '--web-restore-test']) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(electron, ['browser/main.cjs', stage], {
        env,
        stdio: 'inherit',
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('Teste web excedeu 90 segundos.'));
      }, 90000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    if (result !== 0) {
      process.exitCode = Number(result) || 1;
      break;
    }
  }
} finally {
  if (
    path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith('multiolx-web-test-')
  )
    throw Error('Destino de teste inválido.');
  await rm(root, { recursive: true, force: true });
}
