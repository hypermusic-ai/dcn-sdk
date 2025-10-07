import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { generate } from 'openapi-typescript-codegen';

// Recreate __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = resolve(__dirname, '..', '..');
const spec = resolve(root, 'spec', 'api.yaml');        // spec/api.yaml
const out = resolve(__dirname, '..', 'src', 'generated');

if (!existsSync(spec)) {
  throw new Error(`Spec not found at ${spec}`);
}

await generate({
  input: spec,
  output: out,
  httpClient: 'fetch',         // lightweight; can switch to 'axios' (?)
  useUnionTypes: true,
  exportSchemas: true,
  postfixServices: 'Api',      // e.g., VersionApi, AuthApi
  clientName: 'DcnGeneratedClient'
});
