/** Typed Node module-loader stand-in that serves workspace plugin modules from a map. */

import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'

/**
 * Build a loader whose `import` returns the mapped module and whose other hooks
 * fail loudly, because the Loader under test only imports plugin modules.
 * @param modules - specifier to module namespace.
 * @returns a complete `ModuleLoaderV2` for `ctx.loader.internal`.
 */
export function moduleLoaderFake(modules: ReadonlyMap<string, unknown>): ModuleLoaderV2 {
  const unused = (hook: string) => (): never => {
    throw new Error(`module loader fake: unexpected ${hook} call`)
  }
  return {
    version: 'v2',
    loadCache: new Map() as ModuleLoaderV2['loadCache'],
    import(specifier: string) {
      if (!modules.has(specifier)) return Promise.reject(new Error(`unexpected Loader import: ${specifier}`))
      return Promise.resolve(modules.get(specifier))
    },
    register: unused('register'),
    getOrCreateModuleJob: unused('getOrCreateModuleJob'),
    resolveSync: unused('resolveSync'),
    load: unused('load'),
  }
}
