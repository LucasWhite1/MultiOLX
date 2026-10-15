import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import electron from 'electron';
const args = Object.fromEntries(
  Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [
    process.argv[2 + i * 2].replace(/^--/, ''),
    process.argv[3 + i * 2],
  ]),
);
const commandFile = 'artifacts/listing-walkthrough-command.json',
  resultFile = 'artifacts/listing-walkthrough-result.json';
const previous = JSON.parse(await readFile(commandFile, 'utf8'));
const command = {
  action: args.action || 'snapshot',
  owner: args.owner || previous.owner,
  waitMs: Number(args.wait || 1000),
};
for (const field of [
  'text',
  'label',
  'tag',
  'id',
  'name',
  'value',
  'draftId',
  'url',
  'confirmedUnsent',
])
  if (args[field] !== undefined) command[field] = args[field];
if (args.field) {
  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  const draft = result.drafts.find((d) => d.id === (args.draftId || result.drafts[0]?.id));
  command.value = draft.base[args.field];
}
const before = (await stat(resultFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
await writeFile(commandFile, JSON.stringify(command));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['browser/main.cjs', '--listing-walkthrough'], {
  env,
  windowsHide: true,
  stdio: 'ignore',
});
child.on('error', (error) => {
  process.stderr.write(error.message);
  process.exitCode = 1;
});
const until = Date.now() + 120000;
let result;
do {
  await new Promise((resolve) => setTimeout(resolve, 150));
  if ((await stat(resultFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs > before) {
    try {
      result = JSON.parse(await readFile(resultFile, 'utf8'));
      break;
    } catch {}
  }
} while (Date.now() < until);
if (!result) throw new Error('O navegador não devolveu a etapa em 120 segundos.');
console.log(
  JSON.stringify({ action: result.action, error: result.error, page: result.page }, null, 2),
);
