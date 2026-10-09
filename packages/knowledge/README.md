---
description: "Package map for Leon's documentary knowledge base tools, for users and maintainers composing Leon presets."
kind: "package-group"
---

# knowledge/ — Leon documentary knowledge base

English | [中文](README.zh.md)

## Summary

The `knowledge/` group gives a Leon agent read-only access to a local documentary knowledge base under a `.leon/knowledge` root. `tool-knowledge-base` exposes `knowledge_status` and `knowledge_search` over a JSON helper that ships with the package. The group is not part of the `dsh` base bundle; a Leon preset mounts it together with `dsh-explicit-target-policy`, which restricts the tools to the exact root the user named.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | What it provides |
|---|---|
| [`tool-knowledge-base/`](tool-knowledge-base/README.md) | Read-only `knowledge_status` and `knowledge_search` tools for one exact `.leon/knowledge` root |

-----

<a id="related-documentation"></a>
## Related documentation

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline these tools register into and the guard hooks that restrict them.
- [Explicit target policy](../guard/explicit-target-policy/README.md) — the guard that binds these tools to the root named in the latest direct human message.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-knowledge-base) — the model-facing schemas of both tools.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
