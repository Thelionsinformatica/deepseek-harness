---
description: "Brazilian Portuguese language pack for the browser client, for maintainers deploying a Portuguese interface or updating its translations."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-language-pt-br

English | [中文](README.zh.md)

## Summary

Client language pack that adds Brazilian Portuguese (`pt-BR`) to the browser interface. It registers the language with English as its fallback and a pt-BR dictionary for every client namespace that ships English text, so a browser whose preferred language is Portuguese opens in pt-BR and the Language row offers it explicitly. A key the pack does not translate yet shows its English text, never the raw key.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the host row; the Client loader activates the browser half at boot, before the interface renders:

```yaml
- id: language-pt-br
  name: '@deepseek-ai/dsh-client-language-pt-br'
```

The `dsh-leon` bundle mounts it. After an upstream upgrade, run `pnpm run leon:locale-coverage` to list English keys the pack does not translate yet, keys upstream removed, and placeholder mismatches; `--strict` makes any of them fail the command.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`src/client/index.ts`](src/client/index.ts) calls `ctx.locale.addLanguage` with id `pt-BR`, label `Português (Brasil)`, and fallback `en`, then registers each dictionary from [`src/client/dictionaries.ts`](src/client/dictionaries.ts) through the single-locale `ctx.locale.register(namespace, 'pt-BR', dictionary)` form. Every registration is a context effect, so disposing the plugin removes the language and its dictionaries. Values keep the `{name}` placeholders of their English source; command tokens such as `/goal` stay untranslated because users type them.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the browser interface: the pack changes interface text only and never reaches a model request.

#### KV Cache effect

None; no prompt text, tool schema, or request option depends on the interface language.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Dynamic strings stay English** — about twenty texts that the client builds at runtime from templates or concatenation are not in a static dictionary, so the coverage script cannot see them.
- **Onboarding artwork** — the onboarding illustration set has English and Chinese variants only; pt-BR shows the English artwork.
- **Package and plugin metadata** — titles and descriptions declared in package `locale/*.json` files are not part of this pack.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative. The dictionaries were translated from the English dictionaries that `scripts/leon-locale-coverage.ts` extracts; keep a translation edit in the same commit as any coverage change it answers.

</details>
