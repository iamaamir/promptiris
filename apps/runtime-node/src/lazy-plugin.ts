import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  definePlugin,
  type PluginImplementation,
  type PluginManifest,
  type PluginRegistration,
} from '@promptiris/plugin-sdk';

/** @public */
export interface PluginLoadRequest {
  readonly pluginId: string;
  readonly entrypoint: string;
}

/** @public */
export interface LazyPluginOptions {
  readonly manifest: PluginManifest;
  readonly packageRoot: string;
  readonly authorize: (request: PluginLoadRequest) => boolean | Promise<boolean>;
}

function safeError(message: string, cause?: unknown): Error {
  return cause === undefined ? new Error(message) : new Error(message, { cause });
}

function isRegistration(value: unknown): value is PluginRegistration {
  if (typeof value !== 'object' || value === null) return false;
  const activate: unknown = Reflect.get(value, 'activate');
  return typeof activate === 'function';
}

async function authorizedEntrypoint(options: LazyPluginOptions): Promise<string> {
  const entrypoint = options.manifest.entrypoint;
  if (
    entrypoint === undefined ||
    !entrypoint.startsWith('./') ||
    isAbsolute(entrypoint) ||
    !isAbsolute(options.packageRoot)
  ) {
    throw safeError('Plugin entrypoint is invalid');
  }
  const root = await realpath(options.packageRoot);
  const candidate = await realpath(resolve(root, entrypoint));
  const fromRoot = relative(root, candidate);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw safeError('Plugin entrypoint is invalid');
  }
  const request = Object.freeze({
    pluginId: options.manifest.id,
    entrypoint: pathToFileURL(candidate).href,
  });
  if (!(await options.authorize(request))) throw safeError('Plugin loading denied');
  return request.entrypoint;
}

async function loadImplementation(options: LazyPluginOptions): Promise<PluginImplementation> {
  try {
    const entrypoint = await authorizedEntrypoint(options);
    const namespace: unknown = await import(entrypoint);
    const registration: unknown =
      typeof namespace === 'object' && namespace !== null
        ? Reflect.get(namespace, 'default')
        : undefined;
    if (
      !isRegistration(registration) ||
      !isDeepStrictEqual(registration.manifest, options.manifest)
    ) {
      throw new TypeError('Plugin registration does not match its manifest');
    }
    return await registration.activate();
  } catch (error) {
    if (error instanceof Error && error.message === 'Plugin loading denied') throw error;
    throw safeError('Plugin loading failed', error);
  }
}

/** @public */
export function defineLazyPlugin(options: LazyPluginOptions): PluginRegistration {
  const manifest = definePlugin(options.manifest);
  const owned = Object.freeze({ ...options, manifest });
  return Object.freeze({
    manifest,
    activate: () => loadImplementation(owned),
  });
}
