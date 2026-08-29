import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginManifest } from '@promptiris/plugin-sdk';
import { defineLazyPlugin } from './lazy-plugin.js';

const directories = new Set<string>();
const manifest: PluginManifest = {
  id: 'fixture/lazy',
  version: '1.0.0',
  type: 'pipeline',
  entrypoint: './plugin.mjs',
};

async function temporaryPackage(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'promptiris-lazy-plugin-'));
  directories.add(directory);
  return directory;
}

async function pluginModule(directory: string, declaredManifest = manifest): Promise<void> {
  await writeFile(
    join(directory, 'plugin.mjs'),
    `export default {
      manifest: ${JSON.stringify(declaredManifest)},
      activate() { return { async invoke() { return {}; } }; }
    };`,
  );
}

afterEach(async () => {
  const owned = [...directories];
  directories.clear();
  await Promise.all(owned.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('lazy Plugin loading', () => {
  it('does not resolve or execute an entrypoint before authorized activation', async () => {
    const directory = await temporaryPackage();
    let authorizations = 0;
    const registration = defineLazyPlugin({
      manifest,
      packageRoot: directory,
      authorize(request) {
        authorizations += 1;
        expect(request).toMatchObject({ pluginId: manifest.id });
        expect(request.entrypoint).toMatch(/^file:/);
        return true;
      },
    });

    await pluginModule(directory);
    const implementation = await registration.activate();

    expect(authorizations).toBe(1);
    await expect(
      implementation.invoke({
        contributionId: 'transform',
        input: { schemaVersion: '1', content: [] },
        revision: 0,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});
  });

  it('authorizes before module evaluation', async () => {
    const directory = await temporaryPackage();
    const marker = join(directory, 'evaluated');
    await writeFile(
      join(directory, 'plugin.mjs'),
      `import { writeFileSync } from 'node:fs';
       writeFileSync(${JSON.stringify(marker)}, 'evaluated');
       export default { manifest: ${JSON.stringify(manifest)}, activate() { return { async invoke() { return {}; } }; } };`,
    );
    const registration = defineLazyPlugin({
      manifest,
      packageRoot: directory,
      authorize: () => false,
    });

    let denied: unknown;
    try {
      await registration.activate();
    } catch (error: unknown) {
      denied = error;
    }
    expect(denied).toStrictEqual(new Error('Plugin loading denied'));
    expect(Object.hasOwn(denied as object, 'cause')).toBe(false);
    await expect(readFile(marker, 'utf8')).rejects.toThrow();
  });

  it('rejects traversal, absolute entrypoints, and mismatched registrations', async () => {
    const directory = await temporaryPackage();
    await pluginModule(directory, { ...manifest, id: 'fixture/impostor' });

    await expect(
      defineLazyPlugin({ manifest, packageRoot: directory, authorize: () => true }).activate(),
    ).rejects.toThrow('Plugin loading failed');
    await expect(
      defineLazyPlugin({
        manifest: { ...manifest, entrypoint: '../outside.mjs' },
        packageRoot: directory,
        authorize: () => true,
      }).activate(),
    ).rejects.toThrow('Plugin loading failed');
    await expect(
      defineLazyPlugin({
        manifest: { ...manifest, entrypoint: join(directory, 'plugin.mjs') },
        packageRoot: directory,
        authorize: () => true,
      }).activate(),
    ).rejects.toThrow('Plugin loading failed');
  });

  it('rejects every invalid entrypoint boundary with a safe causal Error', async () => {
    const directory = await temporaryPackage();
    const invalid: PluginManifest[] = [
      { id: manifest.id, version: manifest.version, type: manifest.type },
      { ...manifest, entrypoint: 'plugin.mjs' },
      { ...manifest, entrypoint: '../plugin.mjs' },
    ];

    for (const candidate of invalid) {
      const activation = defineLazyPlugin({
        manifest: candidate,
        packageRoot: directory,
        authorize: () => true,
      }).activate();
      await expect(activation).rejects.toMatchObject({
        message: 'Plugin loading failed',
        cause: { message: 'Plugin entrypoint is invalid' },
      });
    }
    await expect(
      defineLazyPlugin({ manifest, packageRoot: '.', authorize: () => true }).activate(),
    ).rejects.toMatchObject({
      message: 'Plugin loading failed',
      cause: { message: 'Plugin entrypoint is invalid' },
    });
  });

  it('rejects a realpath escape before authorization', async () => {
    const directory = await temporaryPackage();
    const outside = await temporaryPackage();
    await pluginModule(outside);
    await symlink(join(outside, 'plugin.mjs'), join(directory, 'plugin.mjs'));
    let authorizations = 0;

    await expect(
      defineLazyPlugin({
        manifest,
        packageRoot: directory,
        authorize: () => {
          authorizations += 1;
          return true;
        },
      }).activate(),
    ).rejects.toMatchObject({
      message: 'Plugin loading failed',
      cause: { message: 'Plugin entrypoint is invalid' },
    });
    expect(authorizations).toBe(0);
  });

  it('rejects an entrypoint resolving to the package parent itself', async () => {
    const parent = await temporaryPackage();
    const directory = join(parent, 'package');
    await mkdir(directory);
    await symlink(parent, join(directory, 'plugin.mjs'));

    await expect(
      defineLazyPlugin({ manifest, packageRoot: directory, authorize: () => true }).activate(),
    ).rejects.toMatchObject({
      message: 'Plugin loading failed',
      cause: { message: 'Plugin entrypoint is invalid' },
    });
  });

  it.each([
    ['missing default', 'export const value = 1;'],
    ['null default', 'export default null;'],
    ['missing manifest', 'export default { activate() { return {}; } };'],
    ['null manifest', 'export default { manifest: null, activate() { return {}; } };'],
    [
      'non-callable activation',
      `export default { manifest: ${JSON.stringify(manifest)}, activate: 1 };`,
    ],
  ])('rejects a malformed imported registration: %s', async (_name, source) => {
    const directory = await temporaryPackage();
    await writeFile(join(directory, 'plugin.mjs'), source);

    await expect(
      defineLazyPlugin({ manifest, packageRoot: directory, authorize: () => true }).activate(),
    ).rejects.toMatchObject({
      message: 'Plugin loading failed',
      cause: { message: 'Plugin registration does not match its manifest' },
    });
  });

  it('freezes the authorization request and wraps authorization failure', async () => {
    const directory = await temporaryPackage();
    await pluginModule(directory);
    const registration = defineLazyPlugin({
      manifest,
      packageRoot: directory,
      authorize(request) {
        expect(Object.isFrozen(request)).toBe(true);
        throw new Error('policy unavailable');
      },
    });

    await expect(registration.activate()).rejects.toMatchObject({
      message: 'Plugin loading failed',
      cause: { message: 'policy unavailable' },
    });
  });
});
