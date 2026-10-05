import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const stage = join(output, 'package');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version))
  throw new Error('Invalid release version');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

// Compile our code, while leaving host helpers to Pi's module mapping.
// Splitting preserves the lazy, explicitly opted-in compatibility tools.
const result = await Bun.build({
  entrypoints: [join(root, 'src/index.ts')],
  outdir: join(stage, 'dist'),
  target: 'node',
  format: 'esm',
  splitting: true,
  sourcemap: 'none',
  external: ['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent'],
});
if (!result.success) throw new AggregateError(result.logs, 'Extension compilation failed');
const cli = await Bun.build({
  entrypoints: [join(root, 'src/cli.ts')],
  outdir: join(stage, 'dist'),
  target: 'node',
  format: 'esm',
  splitting: false,
  metafile: true,
  sourcemap: 'none',
});
if (!cli.success) throw new AggregateError(cli.logs, 'CLI compilation failed');
// Preserve notices for every third-party package that contributed to the CLI bundle.
const dependencies = new Set<string>();
for (const input of Object.keys(cli.metafile?.inputs ?? {})) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(root, input));
  while (directory.includes('node_modules')) {
    if (await Bun.file(join(directory, 'package.json')).exists()) {
      const info = await Bun.file(join(directory, 'package.json')).json();
      if (info.name) {
        dependencies.add(directory);
        break;
      }
    }
    directory = dirname(directory);
  }
}
for (const directory of [...dependencies].sort()) {
  const info = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const notices = (await readdir(directory)).filter((name) =>
    /^(LICENSE|LICENCE|COPYING)(?:[.-]|$)/i.test(name),
  );
  if (!notices.length) throw new Error(`Missing third-party license: ${info.name}`);
  const destination = join(stage, 'THIRD_PARTY_LICENSES', info.name.replaceAll('/', '__'));
  await mkdir(destination, { recursive: true });
  for (const notice of notices) await cp(join(directory, notice), join(destination, notice));
}
const releaseManifest = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  type: 'module',
  license: manifest.license,
  keywords: manifest.keywords,
  main: './dist/index.js',
  exports: { '.': './dist/index.js' },
  files: [
    'dist',
    'assets',
    'source',
    'README.md',
    'LICENSE',
    'SECURITY.md',
    'SKILL.md',
    'THIRD_PARTY_LICENSES',
  ],
  bin: { 'pipellm-pi-provider': './dist/cli.js' },
  engines: { node: '>=22' },
  pi: { extensions: ['./dist/index.js'] },
  peerDependencies: { '@earendil-works/pi-ai': '*', '@earendil-works/pi-coding-agent': '*' },
  peerDependenciesMeta: {
    '@earendil-works/pi-ai': { optional: true },
    '@earendil-works/pi-coding-agent': { optional: true },
  },
  repository: manifest.repository,
  homepage: manifest.homepage,
  bugs: manifest.bugs,
};
await writeFile(join(stage, 'package.json'), JSON.stringify(releaseManifest, null, 2) + '\n');
await cp(join(root, 'distribution/README.md'), join(stage, 'README.md'));
await cp(join(root, 'distribution/SKILL.md'), join(stage, 'SKILL.md'));
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));
await cp(join(root, 'SECURITY.md'), join(stage, 'SECURITY.md'));
await cp(join(root, 'assets'), join(stage, 'assets'), { recursive: true });

// An explicit allowlist keeps private state and development dependencies out.
const sources = [
  'src',
  'assets',
  '.prettierrc.json',
  'bunfig.toml',
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'scripts',
  'distribution',
  'tests',
  'AGENTS.md',
  'SKILL.md',
  'SPEC.md',
  'llms.txt',
  'LICENSE',
  'SECURITY.md',
];
await mkdir(join(stage, 'source'), { recursive: true });
for (const path of sources)
  await cp(join(root, path), join(stage, 'source', path), { recursive: true });
await cp(join(root, 'distribution/README.md'), join(stage, 'source/README.md'));
console.log(`Compiled Pi package: ${stage}`);

if (process.argv.includes('--pack')) {
  const filename = `${manifest.name}-${manifest.version}.tgz`;
  const archive = join(output, filename);
  const pack = Bun.spawn(
    [process.execPath, 'pm', 'pack', '--filename', archive, '--ignore-scripts', '--quiet'],
    { cwd: stage, stdout: 'pipe', stderr: 'pipe' },
  );
  const [exit, stderr] = await Promise.all([
    pack.exited,
    new Response(pack.stderr).text(),
    new Response(pack.stdout).text(),
  ]);
  if (exit !== 0) throw new Error(`Packing failed: ${stderr}`);
  const bytes = await readFile(archive);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const template = await readFile(join(root, 'distribution/install.sh.in'), 'utf8');
  const installer =
    template.replaceAll('@VERSION@', manifest.version).replaceAll('@SHA256@', digest) +
    bytes.toString('base64').replace(/.{1,76}/g, '$&\n');
  const installerName = `${manifest.name}-${manifest.version}-install.sh`;
  const latestInstallerName = `${manifest.name}-install.sh`;
  await writeFile(join(output, installerName), installer, { mode: 0o755 });
  await writeFile(join(output, latestInstallerName), installer, { mode: 0o755 });
  const installerDigest = createHash('sha256').update(installer).digest('hex');
  await writeFile(
    join(output, 'SHA256SUMS'),
    `${digest}  ${filename}\n${installerDigest}  ${installerName}\n${installerDigest}  ${latestInstallerName}\n`,
  );
  console.log(`Distributable archive: ${archive}`);
  console.log(`One-command installer: ${join(output, installerName)}`);
  console.log(`Latest-release installer: ${join(output, latestInstallerName)}`);
  console.log(`SHA256 checksums: ${join(output, 'SHA256SUMS')}`);
}
