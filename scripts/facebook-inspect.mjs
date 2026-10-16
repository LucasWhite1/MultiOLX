import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import electron from 'electron';
const [action = 'inspect', text] = process.argv.slice(2);
if (!['inspect', 'close', 'ensure', 'scroll', 'open-thread', 'structure'].includes(action))
  throw Error('Ação inválida.');
const resultFile = 'artifacts/facebook-inbox-inspection.json';
const before = (await stat(resultFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
await writeFile(
  'artifacts/facebook-command.json',
  JSON.stringify({
    action: action === 'ensure' ? 'read' : action,
    text,
    ensure: action === 'ensure',
  }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve) =>
  spawn(electron, ['browser/main.cjs', '--inspect-facebook-inbox'], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  }).on('close', resolve),
);
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  if ((await stat(resultFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs > before) {
    const r = JSON.parse(await readFile(resultFile, 'utf8'));
    console.log(
      JSON.stringify(
        {
          ...r,
          links: r.links?.map(({ text, label, href }) => ({ text, label, href })),
          controls: r.controls?.slice(0, 7).map(({ role, label, text, spans, attributes }) => ({
            role,
            label,
            text,
            spans,
            attributes,
          })),
          chatRegions: r.chatRegions?.map(({ html, ...r }) => r),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
throw Error('A inspeção do Marketplace não respondeu em 30 segundos.');
