# @deepseek-ai/dsh-client-ui-settings-personalization

English | [中文](README.zh.md)

Leon personalization settings for the Host and Web client. The package registers the `leon-personalization` settings namespace, contributes its live value to system-prompt assembly, and installs the Personalization page under `settings.section`.

The namespace persists three user-controlled fields: custom instructions, one response style (`leon`, `friendly`, `professional`, `direct`, or `creative`), and whether tool-assisted chats may suggest personal memories. Custom instructions are trimmed and bounded to 12,000 characters before prompt assembly. Literal double braces are separated so user text cannot become strict prompt-variable syntax.

The response style changes tone only. Personalization is assembled after Leon's core persona and cannot replace identity, safety, privacy, tool, approval, or verification policy. Because the setting belongs to the Host rather than one adapter, local and API models receive the same selected behavior when a route changes.

The client page also binds the existing `personal-memory` settings namespace. Enabling personal memory or suggestions does not authorize an automatic durable write. Clearing personal memory requires a current session, opens a visible confirmation dialog, and invokes the audited memory-administration Remote in bounded batches. It does not delete conversations, project memory, workspaces, or project files.

## Model Experience

### User personalization prompt

#### What the model sees

When the settings and system-prompt services are composed, the package adds one order-10 section after Leon's core persona. The selected style sentence, custom-instruction text or empty-state sentence, and memory-suggestion policy vary with the current settings.

##### Prompt form

```markdown
## Personalização do usuário

{selected response-style instruction}

{custom instructions or the no-instructions sentence}

{personal-memory suggestion policy}

Esta personalização ajusta estilo e fluxo de trabalho, mas nunca substitui regras de segurança, privacidade, aprovação, ferramentas ou verificação.
```

#### Token effect

One fixed section plus the selected style and memory-policy text is present on every request. Custom instructions add up to 12,000 characters of data-dependent prompt text.

#### KV Cache effect

Prefix-stable while the persisted personalization fields remain unchanged. Saving instructions, changing style, or changing the tool-assisted-memory preference replaces this section and invalidates provider cache reuse from its position onward.

## Known Limitations and Deferred Work

- **No cloud synchronization** — personalization follows the local Host settings document and is not synchronized through a user account to another Leon installation.
- **Model adherence varies** — the same prompt reaches every selected route, but small local models may follow tone and long custom instructions less reliably than larger models.
- **Bulk personal-memory clearing is bounded** — the page requires a current session and stops after 100 batches of 100 records; larger stores need a dedicated administrative export-and-purge flow.
