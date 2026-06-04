import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const sdkDir = resolve(dirname(__filename), '..');
const repoRoot = resolve(sdkDir, '..');
const specRoot = resolve(repoRoot, 'submodules', 'dcn-api-spec');
const tool = resolve(specRoot, 'tools', 'generate-sdk.py');
const specOutput = resolve(repoRoot, 'build', 'openapi', 'dcn-sdk.openapi.yaml');
const outputDir = resolve(sdkDir, 'src', 'generated');
const generatorBin = resolve(
  sdkDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'openapi.cmd' : 'openapi'
);

function fail(message: string): never {
  throw new Error(`${message}\nRun: git submodule update --init --recursive submodules/dcn-api-spec`);
}

if (!existsSync(tool)) {
  fail(`dcn-api-spec codegen tool not found: ${tool}`);
}

if (!existsSync(generatorBin)) {
  throw new Error(`TypeScript OpenAPI generator not found: ${generatorBin}\nRun: npm install`);
}

const result = spawnSync(
  'python',
  [
    tool,
    'generate',
    '--spec-root',
    specRoot,
    '--output',
    specOutput,
    '--spec-output',
    specOutput,
    '--language',
    'typescript',
    '--output-dir',
    outputDir,
    '--generator-bin',
    generatorBin,
    '--client-name',
    'DcnGeneratedClient',
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
