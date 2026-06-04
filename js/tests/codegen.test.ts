import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const jsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(jsDir, '..');
const specRoot = resolve(repoRoot, 'submodules', 'dcn-api-spec');
const jsBundler = resolve(jsDir, 'scripts', 'bundle-openapi.mjs');
const pythonBundler = resolve(repoRoot, 'python', 'scripts', 'bundle-openapi.py');

function pythonCommand(): string | undefined {
    for (const command of ['python', 'python3']) {
        const result = spawnSync(command, ['-c', 'import yaml'], { encoding: 'utf8' });
        if (result.status === 0) return command;
    }
    return undefined;
}

const python = pythonCommand();
const maybeIt = python === undefined ? it.skip : it;

describe('OpenAPI bundler generation parity', () => {
    maybeIt('keeps the JS and Python SDK bundlers in lockstep', () => {
        const dir = mkdtempSync(join(tmpdir(), 'dcn-openapi-parity-'));
        const jsOut = join(dir, 'js.json');
        const pyOut = join(dir, 'py.json');
        try {
            const jsResult = spawnSync(
                'node',
                [jsBundler, '--spec-root', specRoot, '--output', jsOut],
                { cwd: repoRoot, encoding: 'utf8' }
            );
            expect(jsResult.status, jsResult.stderr).toBe(0);

            const pyResult = spawnSync(
                python as string,
                [pythonBundler, '--spec-root', specRoot, '--output', pyOut, '--format', 'json'],
                { cwd: repoRoot, encoding: 'utf8' }
            );
            expect(pyResult.status, pyResult.stderr).toBe(0);

            expect(JSON.parse(readFileSync(pyOut, 'utf8'))).toEqual(JSON.parse(readFileSync(jsOut, 'utf8')));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
