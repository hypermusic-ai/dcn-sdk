import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const sdkDir = resolve(dirname(__filename), '..');
const repoRoot = resolve(sdkDir, '..');
const specRoot = resolve(repoRoot, 'submodules', 'dcn-api-spec');
const specOutput = resolve(repoRoot, 'build', 'openapi', 'dcn-sdk.openapi.yaml');
const outputDir = resolve(sdkDir, 'src', 'generated');
const bundleOpenapi = resolve(sdkDir, 'scripts', 'bundle-openapi.mjs');
const generatorBin = resolve(
  sdkDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'openapi.cmd' : 'openapi'
);

function fail(message: string): never {
  throw new Error(
    `${message}\nRun: git submodule update --init --recursive submodules/dcn-api-spec`
  );
}

if (!existsSync(resolve(specRoot, 'services'))) {
  fail(`dcn-api-spec services not found: ${resolve(specRoot, 'services')}`);
}

if (!existsSync(bundleOpenapi)) {
  throw new Error(`SDK OpenAPI bundler not found: ${bundleOpenapi}`);
}

if (!existsSync(generatorBin)) {
  throw new Error(`TypeScript OpenAPI generator not found: ${generatorBin}\nRun: npm install`);
}

const bundleResult = spawnSync(
  'node',
  [
    bundleOpenapi,
    '--spec-root',
    specRoot,
    '--output',
    specOutput,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

if (bundleResult.status !== 0) {
  process.exit(bundleResult.status ?? 1);
}

const result = spawnSync(
  generatorBin,
  [
    '--input',
    specOutput,
    '--output',
    outputDir,
    '--client',
    'fetch',
    '--useUnionTypes',
    '--exportSchemas',
    'true',
    '--postfixServices',
    'Api',
    '--name',
    'DcnGeneratedClient',
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
