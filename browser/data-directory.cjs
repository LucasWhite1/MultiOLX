const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { profileId, profileName } = require('./policy.cjs');

function catalogAt(directory) {
  try {
    const file = path.join(directory, 'profiles.json');
    const profiles = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      !Array.isArray(profiles) ||
      profiles.some((p) => profileId(p.id) !== p.id || profileName(p.name) !== p.name)
    )
      return null;
    return { directory, count: profiles.length, modified: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

function dataDirectory({
  platform = process.platform,
  home,
  appData,
  localAppData,
  override = process.env.MULTIOLX_BROWSER_DATA_DIR,
}) {
  if (override) return { root: path.resolve(override) };
  const legacy = path.join(appData, 'MultiOLX Browser');
  if (platform !== 'win32') return { root: legacy };
  // AppData is virtualized for children of the Store-packaged Codex app.
  // A home-relative directory has the same identity when launched from Explorer.
  const root = path.join(home, '.multiolx', 'browser');
  if (fs.existsSync(root)) {
    if (fs.existsSync(path.join(root, 'profiles.json'))) return { root };
    if (fs.readdirSync(root).length)
      throw Error(
        'A pasta de dados MultiOLX existe sem catálogo. Os dados foram preservados; confira a pasta antes de continuar.',
      );
  }
  const candidates = [];
  if (localAppData) {
    const packages = path.join(localAppData, 'Packages');
    if (fs.existsSync(packages)) {
      for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
        if (entry.isDirectory() && /^OpenAI\.Codex_/.test(entry.name))
          candidates.push(
            path.join(packages, entry.name, 'LocalCache', 'Roaming', 'MultiOLX Browser'),
          );
      }
    }
  }
  candidates.push(legacy);
  const source = candidates
    .map(catalogAt)
    .filter((item) => item?.count > 0)
    .sort((a, b) => b.modified - a.modified)[0];
  if (!source) return { root };
  fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
  const staging = root + '.migration-' + randomUUID();
  const excluded = new Set([
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'GrShaderCache',
    'ShaderCache',
    'GPUPersistentCache',
    'lockfile',
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'DevToolsActivePort',
  ]);
  try {
    fs.cpSync(source.directory, staging, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (file) => !excluded.has(path.basename(file)) && !file.endsWith('.tmp'),
    });
    const copied = catalogAt(staging);
    if (!copied || copied.count !== source.count)
      throw Error('A cópia do catálogo não foi validada.');
    fs.writeFileSync(
      path.join(staging, 'migration.json'),
      JSON.stringify({
        from: source.directory,
        at: new Date().toISOString(),
        profiles: source.count,
      }),
      { mode: 0o600 },
    );
    // Never replace a populated destination. The original directory is left intact.
    if (fs.existsSync(root)) fs.rmdirSync(root);
    fs.renameSync(staging, root);
    return { root, migratedFrom: source.directory };
  } catch (error) {
    throw new Error(
      'Não foi possível migrar os dados do MultiOLX. A origem e a cópia de segurança foram preservadas. ' +
        error.message,
    );
  }
}
module.exports = { dataDirectory };
