---
description: "Composer Web button that switches the session-scoped web access grant, for maintainers composing Leon's web consent."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-access

English | [中文](README.zh.md)

## Summary

Client control in the conversation composer that shows and switches the session's web access grant owned by `dsh-web-access`. The button reflects the host `webAccess` projection rather than an optimistic local copy, runs `/web on` or `/web off`, and stays hidden where the host service is not composed.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the host row together with `dsh-web-access`:

```yaml
- id: ui-web-access
  name: '@deepseek-ai/dsh-client-ui-web-access'
```

<a id="understand-the-implementation"></a>
## Understand the implementation

[`src/client/index.ts`](src/client/index.ts) registers the button in the `conversation.input.right` list slot and injects a `toggleWebAccess` face that executes the human command through the command Remote. [`src/client/WebAccessControl.tsx`](src/client/WebAccessControl.tsx) renders the globe button from `useProjection('webAccess')`.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the browser interface: the control never reaches a model request.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Command-backed** — the toggle reuses `/web`, so a deployment without a command runtime shows the state but cannot switch it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative. Ported from Leon's fork onto the 0.2.1 client slot API.

</details>
