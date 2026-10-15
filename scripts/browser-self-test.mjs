import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import electron from 'electron';
const root = await mkdtemp(path.join(tmpdir(), 'multiolx-browser-test-'));
await mkdir('artifacts', { recursive: true });
try {
  const env = {
    ...process.env,
    MULTIOLX_BROWSER_DATA_DIR: root,
    MULTIOLX_BROWSER_SCREENSHOT: path.resolve('artifacts/multiolx-browser.png'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const stage of ['--self-test', '--self-test-restore']) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(electron, ['browser/main.cjs', stage], {
        env,
        stdio: 'inherit',
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Teste do navegador excedeu 60 segundos.'));
      }, 60000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    process.exitCode = result ?? 1;
    if (process.exitCode !== 0) break;
  }
} finally {
  if (
    path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith('multiolx-browser-test-')
  )
    throw new Error('Diretório de teste fora do destino esperado.');
  await rm(root, { recursive: true, force: true });
}
