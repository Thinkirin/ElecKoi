// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const bundles = JSON.parse(readFileSync(resolve('apps/desktop/resources/dsh/runtime-manifest.json'), 'utf8')).desktopProfile.bundles;
const bundleManifest = (name) => JSON.parse(readFileSync(resolve(name.replace('@eleckoi/', 'packages/') + '/package.json'), 'utf8'));
const developerInterfaces = (name) => bundleManifest(name).eleckoi?.developerInterfaces ?? [];
function packageSource(name) {
    const root = resolve(name.replace('@eleckoi/', 'packages/') + '/src');
    const files = [];
    const visit = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory())
                visit(path);
            else if (/\.(?:[cm]?js|tsx?|d\.ts)$/.test(entry.name))
                files.push(readFileSync(path, 'utf8'));
        }
    };
    visit(root);
    return files.join('\n');
}
function inventory(face) {
    let registration;
    const entries = [];
    runInNewContext(readFileSync(resolve('packages/dsh-client-shell/src/client.js'), 'utf8'), {
        AbortController,
        window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
    });
    registration.factory((name) => name === 'react' ? React : primitives).apply({
        effect: () => { },
        reflect: { provide: () => () => {} },
        slots: {
            provideRoot: () => () => {},
            entriesOfSlot: () => [{ options: { key: 'plugins' }, inject: () => face }],
            inject: (_name, factory) => factory(),
            register: (options, component) => { entries.push({ options, component }); return () => { }; },
        },
    });
    return entries;
}
async function withDetail(run) {
    let snapshot = {
        packages: bundles.map(name => ({ name, enabled: true, developerInterfaces: developerInterfaces(name), rows: [{
                    rowId: 'example', entryId: 'example-entry', moduleName: name, enabled: true, phase: 'active',
                    meta: { title: { zh: '测试组件' } },
                }] })), busy: [],
    };
    const listeners = new Set();
    const face = {
        hooks: { pluginManager: {
                getSnapshot: () => snapshot,
                subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            } },
        resolveText: (value) => typeof value === 'string' ? value : value.zh,
        setRowEnabled: vi.fn(),
    };
    const entries = inventory(face).filter(entry => entry.options.name === 'plugins.bundle.config');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let current = bundles[0];
    const show = async (name) => {
        current = name;
        const entry = entries.find(candidate => candidate.options.key === name);
        expect(entry, name).toBeDefined();
        await act(async () => root.render(entry.component()));
    };
    const update = async (row, protection = {}, busy = []) => act(async () => {
        snapshot = {
            packages: [{ name: current, enabled: true, developerInterfaces: developerInterfaces(current), ...protection, rows: row ? [row] : [] }],
            busy,
        };
        listeners.forEach(listener => listener());
    });
    try {
        await run(container, show, update, face);
    }
    finally {
        await act(async () => root.unmount());
        container.remove();
    }
}
describe('ElecKoi built-in bundle details', () => {
    it('keeps enabled installation bundles in the official plugin detail index', () => {
        const source = readFileSync(resolve('node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js'), 'utf8');
        expect(source).toContain('pkg.enabled || pkg.installed || pkg.optional || pkg.error !== void 0');
    });
    it('publishes shipped bundles even when they are not installed into the user profile', () => {
        let registration;
        let rootComponent;
        let firstEffect = true;
        const effects = [];
        const observable = (value) => ({ subscribe: () => () => { }, getSnapshot: () => value });
        const face = {
            hooks: {
                pluginManager: observable({ status: 'ready', packages: bundles.map(name => ({ name, installed: false, optional: false, enabled: name !== bundles.at(-1), meta: { title: { zh: name } } })) }),
                configLedger: observable({ items: [] }),
            }, resolveText: (value) => value.zh,
        };
        const slots = {
            provideRoot: () => () => { }, subscribe: () => () => { }, getVersion: () => 1,
            entriesOfSlot: (name) => name === 'main' ? [{ options: { key: 'plugins' }, inject: () => face }] : [],
            inject: (_name, register) => register(),
            register: (options, component) => { if (options.name === 'root')
                rootComponent = component; return () => { }; },
        };
        const react = {
            lazy: () => () => null, createElement: () => null,
            useState: () => [null, () => { }], useMemo: (calculate) => calculate(),
            useSyncExternalStore: (_subscribe, read) => read(),
            useEffect: (run, deps) => effects.push({ run, deps }),
        };
        const original = window.__ModuleLoader__;
        try {
            ;
            window.__ModuleLoader__ = { load: (value) => { registration = value; } };
            runInNewContext(readFileSync(resolve('packages/dsh-client-shell/src/client.js'), 'utf8'), { window, CustomEvent, AbortController });
            registration.factory((name) => name === 'react' ? react : primitives).apply({
                slots, reflect: { provide: () => () => { } },
                effect: (run) => { if (firstEffect) {
                    firstEffect = false;
                    run();
                } },
            });
            rootComponent({
                slots,
                layout: {
                    panelInfo: observable({ activePanelId: 'plugins' }),
                    rightbarInfo: observable({ shown: false }),
                    setViewportWidth: () => { },
                    setRightbar: () => { },
                },
                locale: observable({ revision: 0 }),
                renderSlot: () => null,
            });
            let published;
            const receive = (event) => { published = event.detail; };
            window.addEventListener('eleckoi:dsh-plugins:state', receive);
            const dispose = effects.find(effect => effect.deps?.[1] === slots).run();
            expect(published.entries.map((entry) => entry.id)).toEqual(bundles);
            expect(published.entries.every((entry) => entry.kind === 'package' && entry.group === 'eleckoi')).toBe(true);
            dispose();
            window.removeEventListener('eleckoi:dsh-plugins:state', receive);
        }
        finally {
            window.__ModuleLoader__ = original;
        }
    });
    it('uses actual declared bundle identities without fabricated plugin items', () => {
        const entries = inventory({});
        expect(entries.filter(entry => entry.options.name === 'plugins.item')).toHaveLength(0);
        expect(entries.filter(entry => entry.options.name === 'plugins.bundle.config').map(entry => entry.options.key)).toEqual(bundles);
    });
    it('projects real observable phases, counts and enable actions', async () => {
        await withDetail(async (container, show, update, face) => {
            await show(bundles[0]);
            expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('运行组件 1');
            expect(container.textContent).toContain('运行中');
            expect(container.textContent).not.toContain('Client');
            await act(async () => container.querySelector('[role="switch"]').click());
            expect(face.setRowEnabled).toHaveBeenCalledWith('example-entry', false);
            for (const [phase, label] of [['loading', '加载中'], ['failed', '加载失败'], ['unloading', '卸载中'], [null, '未运行']]) {
                await update({ rowId: 'actual', entryId: 'actual', moduleName: bundles[0], enabled: true, phase });
                expect(container.textContent).toContain(label);
                expect(container.querySelector('[data-plugin-row]')?.getAttribute('data-plugin-row')).toBe('actual');
            }
            await update({ rowId: 'off', entryId: 'off', moduleName: bundles[0], enabled: false, phase: null });
            expect(container.textContent).toContain('已停用');
            await update(null);
            expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe('运行组件 0');
        });
    });
    it('respects core protection and active management operations', async () => {
        await withDetail(async (container, show, update, face) => {
            await show(bundles[0]);
            for (const protection of [{ readOnlyReason: 'management-required' }, {}]) {
                await update({ rowId: 'core', entryId: 'core', moduleName: bundles[0], enabled: true, phase: 'active' }, protection, protection.readOnlyReason ? [] : ['row:core']);
                expect(container.querySelector('[role="switch"]')?.disabled).toBe(true);
                await act(async () => container.querySelector('[role="switch"]').click());
            }
            expect(face.setRowEnabled).not.toHaveBeenCalled();
        });
    });
    it('separates interfaces by their actual declaring package and supports keyboard tabs', async () => {
        await withDetail(async (container, show) => {
            const ids = new Set();
            for (const name of bundles) {
                await show(name);
                const declared = developerInterfaces(name);
                const tabs = container.querySelectorAll('[role="tab"]');
                expect(tabs[0].getAttribute('aria-selected')).toBe('true');
                expect(tabs[1].textContent, name).toBe(`开发接口 ${declared.length}`);
                tabs[0].focus();
                await act(async () => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
                expect(document.activeElement).toBe(tabs[1]);
                expect(container.querySelector('[data-component-kind="component"]')).toBeNull();
                expect(container.querySelector('[role="switch"]')).toBeNull();
                const rows = container.querySelectorAll('[data-component-kind="interface"]');
                expect(rows).toHaveLength(declared.length);
                if (rows.length) {
                    const source = packageSource(name);
                    for (const row of rows) {
                        const id = row.dataset.pluginRow;
                        expect(ids.has(id), id).toBe(false);
                        ids.add(id);
                        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const declaration = declared.find(item => item.id === id);
                        expect(declaration, id).toBeDefined();
                        if (declaration.kind === 'ui-slot') {
                            expect(source, id).toMatch(new RegExp(`(?:["']${escapedId}["']|\\b${escapedId}\\b)\\s*:\\s*\\{\\s*kind\\s*:`));
                        }
                        else if (declaration.kind === 'service') {
                            expect(source, id).toMatch(new RegExp(`(?:ctx(?:\\.reflect)?\\.provide\\(|super\\(ctx,\\s*)["']${escapedId}["']`));
                        }
                        else if (declaration.kind === 'contribution') {
                            expect(declaration.relation).toBe('contributes');
                            expect(declaration.owner).toBeTruthy();
                            for (const member of declaration.members ?? [])
                                expect(source, `${id}:${member}`).toContain(member);
                        }
                        expect(row.dataset.interfaceKind).toBe(declaration.kind);
                        expect(row.textContent).toContain(declaration.title);
                        expect(row.textContent).toContain(id);
                        if (declaration.scope === 'session-maybe') {
                            expect(row.textContent).toContain('会话可为空');
                            expect(row.textContent).not.toContain('session-maybe');
                        }
                    }
                }
                expect(document.getElementById(tabs[1].getAttribute('aria-controls'))?.hidden).toBe(false);
                await act(async () => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
                expect(document.activeElement).toBe(tabs[0]);
            }
            expect(ids.size).toBe(bundles.reduce((total, name) => total + developerInterfaces(name).length, 0));
        });
    });
    it('transports package-declared developer interfaces through the official manager', () => {
        const hostSource = readFileSync(resolve('node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js'), 'utf8');
        const clientSource = readFileSync(resolve('node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js'), 'utf8');
        expect(hostSource).toContain('manifest.eleckoi?.developerInterfaces');
        expect(hostSource).toContain('{ developerInterfaces: interfaces }');
        expect(clientSource).toContain('{ developerInterfaces: bundle.developerInterfaces }');
    });
    it('classifies patched upstream packages as adaptations', () => {
        const source = readFileSync(resolve('packages/dsh-client-shell/src/client.js'), 'utf8');
        const workspace = parseYaml(readFileSync(resolve('pnpm-workspace.yaml'), 'utf8'));
        for (const spec of Object.keys(workspace.patchedDependencies)) {
            const split = spec.lastIndexOf('@');
            const packageName = split > 0 ? spec.slice(0, split) : spec;
            if (packageName === '@deepseek-ai/dsh-typert-generator')
                continue;
            expect(source, spec).toContain("['" + packageName + "',");
        }
        expect(workspace.patchedDependencies['@deepseek-ai/dsh-typert-generator@0.2.0-rc.2'])
            .toBe('patches/@deepseek-ai__dsh-typert-generator@0.2.0-rc.2.patch');
    });
});
