#!/usr/bin/env node
// JS (Node-only) sibling of python/scripts/bundle-openapi.py.
//
// Merges every services/*/openapi.yaml under a dcn-api-spec checkout into one
// OpenAPI 3.0.3 document: collects tags, concatenates paths, and hoists
// $ref'd schemas/securitySchemes into components. Output is JSON, ready for
// openapi-typescript-codegen. This exists so the SDK chain client can be
// regenerated without any Python dependency.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function deepCopy(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function pascal(value) {
    let out = '';
    let upperNext = true;
    for (const ch of value) {
        if (/[a-zA-Z0-9]/.test(ch)) {
            out += upperNext ? ch.toUpperCase() : ch;
            upperNext = false;
        } else {
            upperNext = true;
        }
    }
    return out || 'Schema';
}

function sortObject(obj) {
    const out = {};
    for (const key of Object.keys(obj).sort()) out[key] = obj[key];
    return out;
}

function pointerLookup(doc, pointer) {
    if (!pointer) return doc;
    if (!pointer.startsWith('/')) throw new Error(`Only JSON pointer refs are supported: #${pointer}`);
    let current = doc;
    for (const raw of pointer.replace(/^\//, '').split('/')) {
        const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (current === null || typeof current !== 'object' || !(part in current)) {
            throw new Error(`Invalid JSON pointer: #${pointer}`);
        }
        current = current[part];
    }
    return current;
}

class SpecBundler {
    constructor(specRoot) {
        this.specRoot = path.resolve(specRoot);
        this.documents = new Map();
        this.schemaComponents = {};
        this.securityComponents = {};
    }

    bundle({ title, version, dropOptions }) {
        const serviceSpecs = this.serviceSpecs();
        if (serviceSpecs.length === 0) {
            throw new Error(`No service specs found under ${path.join(this.specRoot, 'services')}`);
        }

        const first = this.load(serviceSpecs[0]);
        const bundled = {
            openapi: '3.0.3',
            info: { title, version },
            servers: first.servers ?? [],
            security: [],
            tags: [],
            paths: {},
            components: { securitySchemes: {}, schemas: {} },
        };

        const seenTags = new Set();
        for (const specPath of serviceSpecs) {
            const doc = this.load(specPath);
            for (const tag of doc.tags ?? []) {
                const name = tag?.name;
                if (typeof name === 'string' && !seenTags.has(name)) {
                    bundled.tags.push(deepCopy(tag));
                    seenTags.add(name);
                }
            }

            const paths = doc.paths ?? {};
            for (const p of Object.keys(paths).sort()) {
                const pathItem = paths[p];
                if (pathItem === null || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;
                let resolved = this.resolveNode(pathItem, specPath);
                if (dropOptions) {
                    resolved = Object.fromEntries(
                        Object.entries(resolved).filter(([key]) => key.toLowerCase() !== 'options')
                    );
                }
                if (!Object.keys(resolved).some((key) => HTTP_METHODS.has(key.toLowerCase()))) continue;
                if (p in bundled.paths) throw new Error(`Duplicate path in service specs: ${p}`);
                bundled.paths[p] = resolved;
            }
        }

        bundled.components.securitySchemes = sortObject(this.securityComponents);
        bundled.components.schemas = sortObject(this.schemaComponents);
        if (Object.keys(bundled.components.securitySchemes).length === 0) delete bundled.components.securitySchemes;
        if (Object.keys(bundled.components.schemas).length === 0) delete bundled.components.schemas;
        if (Object.keys(bundled.components).length === 0) delete bundled.components;

        return bundled;
    }

    serviceSpecs() {
        const dir = path.join(this.specRoot, 'services');
        if (!fs.existsSync(dir)) return [];
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(dir, entry.name, 'openapi.yaml'))
            .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
            .sort();
    }

    load(p) {
        const resolved = path.resolve(p);
        this.requireInsideSpecRoot(resolved);
        if (!this.documents.has(resolved)) {
            const data = yaml.load(fs.readFileSync(resolved, 'utf8')) ?? {};
            if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error(`OpenAPI document is not an object: ${resolved}`);
            }
            this.documents.set(resolved, data);
        }
        return this.documents.get(resolved);
    }

    resolveNode(node, currentFile) {
        if (Array.isArray(node)) return node.map((item) => this.resolveNode(item, currentFile));
        if (node === null || typeof node !== 'object') return deepCopy(node);
        if (typeof node.$ref === 'string') return this.resolveRef(node.$ref, currentFile);
        const out = {};
        for (const [key, value] of Object.entries(node)) out[key] = this.resolveNode(value, currentFile);
        return out;
    }

    resolveRef(ref, currentFile) {
        const [refFile, pointer] = this.splitRef(ref, currentFile);
        const targetDoc = this.load(refFile);
        const target = pointerLookup(targetDoc, pointer);

        if (pointer.startsWith('/components/securitySchemes/')) {
            const name = pointer.split('/').pop();
            this.securityComponents[name] = this.resolveNode(target, refFile);
            return { $ref: `#/components/securitySchemes/${name}` };
        }

        if (this.isSchemaFile(refFile)) {
            const name = this.schemaName(target, refFile);
            const resolved = this.resolveNode(target, refFile);
            if (!(name in this.schemaComponents)) {
                this.schemaComponents[name] = resolved;
            } else if (JSON.stringify(this.schemaComponents[name]) !== JSON.stringify(resolved)) {
                throw new Error(`Conflicting OpenAPI schema component name '${name}' from ${refFile}`);
            }
            return { $ref: `#/components/schemas/${name}` };
        }

        return this.resolveNode(target, refFile);
    }

    splitRef(ref, currentFile) {
        const hashIndex = ref.indexOf('#');
        const filePart = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
        const pointer = hashIndex === -1 ? '' : ref.slice(hashIndex + 1);
        const refFile =
            filePart === ''
                ? path.resolve(currentFile)
                : path.resolve(path.dirname(currentFile), filePart);
        this.requireInsideSpecRoot(refFile);
        return [refFile, pointer];
    }

    requireInsideSpecRoot(p) {
        const relative = path.relative(this.specRoot, path.resolve(p));
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
        throw new Error(`OpenAPI $ref path escapes spec root: ${p}`);
    }

    isSchemaFile(p) {
        const relative = path.relative(this.specRoot, path.resolve(p));
        if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
        const parts = relative.split(path.sep);
        return parts.includes('schemas') && ['.yaml', '.yml', '.json'].includes(path.extname(p));
    }

    schemaName(schema, p) {
        if (schema && typeof schema === 'object' && typeof schema.title === 'string') {
            return pascal(schema.title);
        }
        return pascal(path.basename(p, path.extname(p)));
    }
}

function parseArgs(argv) {
    const args = { title: 'DCN Chain API', version: '0.2.0', keepOptions: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        switch (arg) {
            case '--spec-root':
                args.specRoot = argv[++i];
                break;
            case '--output':
                args.output = argv[++i];
                break;
            case '--title':
                args.title = argv[++i];
                break;
            case '--version':
                args.version = argv[++i];
                break;
            case '--keep-options':
                args.keepOptions = true;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!args.specRoot) throw new Error('--spec-root is required');
    if (!args.output) throw new Error('--output is required');
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const servicesDir = path.join(path.resolve(args.specRoot), 'services');
    if (!fs.existsSync(servicesDir)) {
        throw new Error(
            `Missing dcn-api-spec services at ${args.specRoot}. ` +
                'Run: git submodule update --init --recursive'
        );
    }
    const bundled = new SpecBundler(args.specRoot).bundle({
        title: args.title,
        version: args.version,
        dropOptions: !args.keepOptions,
    });
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(bundled, null, 2)}\n`, 'utf8');
    process.stdout.write(`Bundled OpenAPI spec -> ${args.output}\n`);
}

main();
