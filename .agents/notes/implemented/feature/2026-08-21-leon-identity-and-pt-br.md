# Agent Note: Leon identity and Brazilian Portuguese default

Status: implemented

English | [中文](2026-08-21-leon-identity-and-pt-br.zh.md)

## Problem

The The Lions Informática fork needs a product identity distinct from the upstream DeepSeek presentation and a Brazilian Portuguese interface that remains usable when upstream feature packages add English copy before a Portuguese counterpart exists. Replacing rendered text after React mounts would leave accessibility labels, persisted language selection, and dynamic plugin registrations inconsistent.

## Decision

The browser-brand plugin occupies the existing sidebar and conversation brand slots with an original lion SVG, the The Lions Informática wordmark, and Leon as the highlighted product name whenever the product composition mounts it. Build profiles do not disable these occupants, so ordinary local and official builds share the same Leon identity. The renderer also uses `Leon — The Lions Informática` as its title when a build supplies no `DSH_CLIENT_TITLE`, preventing the browser tab from reverting to upstream fallback branding. The components use the shared Web theme tokens, so the mark and wordmark remain legible in light, dark, and system themes without a second theme service or global stylesheet.

The locale service ships `pt` beside `zh` and `en`, exposes `Português (Brasil)` in the language selector, writes `pt-BR` to the document language, and uses Brazilian Portuguese when neither a persisted choice nor a supported browser language exists. English remains the missing-dictionary fallback so a newly added upstream key stays readable.

Feature namespaces continue to require complete Chinese and English dictionaries and may register native `pt` entries. When the active locale is `pt` and a feature has no native entry, the locale package translates the resolved English template through one Brazilian Portuguese pack. Native Portuguese always wins, placeholders remain part of the template, and untranslated upstream additions remain visible in English rather than collapsing to a key.

## Alternatives considered

**Rename every `@deepseek-ai/dsh-*` package.** Rejected because package identifiers are internal dependency addresses rather than rendered product identity; changing hundreds of manifests and imports would increase merge conflicts with upstream without improving the Leon interface.

**Require a Portuguese dictionary in every feature package immediately.** Rejected because the language identifier would turn every upstream copy addition into a cross-repository compile failure. Optional native dictionaries plus a central pack let high-value features own precise copy while preserving a readable fallback during upstream synchronization.

**Translate the mounted DOM.** Rejected because post-render replacement cannot reliably update accessibility names, command copy captured at registration time, or the locale service snapshot, and it would fight React on every render.

## Testing

Locale tests pin the `pt` selector entry, Brazilian Portuguese provisional default, `pt-BR` document language, explicit Host persistence, English dictionary fallback, central translation pack, and interpolation behavior. Brand tests pin the accessible Leon label, wordmark text, requested mark dimensions, ordinary local-build activation, declaration order, HMR collapse, and teardown. Renderer tests pin Leon as the browser-title fallback when no build-time title is provided.

## Consequences

Leon starts in Brazilian Portuguese and carries The Lions Informática identity through the plugin composition points the upstream application already owns, including ordinary local builds. Upstream synchronization keeps stable package addresses and a readable English safety path. The cost is maintaining the central Portuguese table for feature copy that has not moved to a native dictionary; inline strings outside the locale service remain a separate migration task.
