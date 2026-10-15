import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { dataDirectory } = createRequire(import.meta.url)('../browser/data-directory.cjs');
function fixture(run: (ctx: any) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multiolx-data-test-'));
  const ctx = {
    platform: 'win32',
    home: path.join(root, 'home'),
    appData: path.join(root, 'roaming'),
    localAppData: path.join(root, 'local'),
    override: '',
  };
  try {
    run(ctx);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function catalog(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'profiles.json'),
    JSON.stringify([{ id: crypto.randomUUID(), name: 'Perfil salvo' }]),
  );
}
it('migra os dados redirecionados do Codex para um caminho estável, sem apagar a origem', () =>
  fixture((ctx) => {
    const source = path.join(
      ctx.localAppData,
      'Packages',
      'OpenAI.Codex_example',
      'LocalCache',
      'Roaming',
      'MultiOLX Browser',
    );
    catalog(source);
    fs.writeFileSync(path.join(source, 'session-fixture.enc'), Buffer.from([10, 20, 30]));
    fs.writeFileSync(path.join(source, 'Local State'), 'encrypted-key-placeholder');
    const storage = path.join(source, 'Partitions', 'account-fixture', 'Local Storage');
    fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(path.join(storage, 'state'), 'native-session');
    fs.mkdirSync(path.join(source, 'Cache'));
    fs.writeFileSync(path.join(source, 'lockfile'), 'lock');
    const result = dataDirectory(ctx);
    expect(result.root).toBe(path.join(ctx.home, '.multiolx', 'browser'));
    expect(result.migratedFrom).toBe(source);
    expect(fs.readFileSync(path.join(result.root, 'session-fixture.enc'))).toEqual(
      Buffer.from([10, 20, 30]),
    );
    expect(fs.readFileSync(path.join(result.root, 'Local State'), 'utf8')).toBe(
      'encrypted-key-placeholder',
    );
    expect(
      fs.readFileSync(
        path.join(result.root, 'Partitions', 'account-fixture', 'Local Storage', 'state'),
        'utf8',
      ),
    ).toBe('native-session');
    expect(fs.existsSync(path.join(result.root, 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(result.root, 'lockfile'))).toBe(false);
    expect(fs.existsSync(path.join(source, 'profiles.json'))).toBe(true);
    expect(dataDirectory(ctx)).toEqual({ root: result.root });
  }));
it('migra o AppData tradicional e preserva um destino já existente', () =>
  fixture((ctx) => {
    const source = path.join(ctx.appData, 'MultiOLX Browser');
    catalog(source);
    const result = dataDirectory(ctx);
    const before = fs.readFileSync(path.join(result.root, 'profiles.json'), 'utf8');
    catalog(source);
    expect(dataDirectory(ctx)).toEqual({ root: result.root });
    expect(fs.readFileSync(path.join(result.root, 'profiles.json'), 'utf8')).toBe(before);
  }));
it('não altera os caminhos explícitos de testes/VPS nem o padrão Linux', () =>
  fixture((ctx) => {
    const custom = path.join(ctx.home, 'custom');
    expect(dataDirectory({ ...ctx, override: custom })).toEqual({ root: custom });
    expect(dataDirectory({ ...ctx, platform: 'linux' })).toEqual({
      root: path.join(ctx.appData, 'MultiOLX Browser'),
    });
    expect(fs.existsSync(custom)).toBe(false);
  }));
it('recusa sobrescrever um destino com dados e catálogo ausente', () =>
  fixture((ctx) => {
    const root = path.join(ctx.home, '.multiolx', 'browser');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'session.enc'), 'preservar');
    expect(() => dataDirectory(ctx)).toThrow('sem catálogo');
    expect(fs.readFileSync(path.join(root, 'session.enc'), 'utf8')).toBe('preservar');
  }));
