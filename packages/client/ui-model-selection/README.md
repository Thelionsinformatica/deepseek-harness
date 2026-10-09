# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

Model selection plugin, browser half: two entries share one per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`). For ordinary sessions, the `/model` popupSelect contribution and the composer's `conversation.input.model` seat both load `session.models` and submit `session.selectModel` through the same `ModelDirectory`. The composer opens a searchable provider-grouped catalog; provider ids, model ids, names, and descriptions are searchable. Hovering or focusing a model displays its Host-reported input modalities, context capacity, default output cap, and reasoning levels. Missing metadata and prices are explicitly unknown, not inferred from a model name. The current exact model supplies adapter-owned effort names, descriptions, and default; `/model` applies that default and the composer can choose any advertised effort.

The Host-reported provider/model/reasoning `ModelSelection` is the single selection fact, but it is echoed only when the exact provider/model pair remains in the advertised groups; an absent catalog row leaves the routable selection intact while the trigger prompts `Select model`, no stale row is synthesized, and no Effort row is shown until the user picks an advertised model. Directory loads and selections share a generation counter so an older response never overwrites a newer one; a connection reset drops every resident projection and repulls the Host-restored selection before display. Provider-local metadata failures list inline while usable groups stay selectable, and selection failures retain the prior selection and directory.

When the Host reports that no adapter serves the session's route (`session.models.routable`), this plugin raises a composer block through `ctx.conversation.blocks` and the input goes inert with this plugin's own copy; recovering clears it without a reload. It follows `routable` and nothing else: a `null` — before the first load, or after one failed — never blocks, or a slow Host would lock a working composer, and catalog membership never blocks either, because a route serving a model it stopped advertising is missing from the groups yet perfectly usable. The trigger's own `Select model` fallback still covers that case, which is display, not a gate.

Directories are per-session, resolved lazily through `ctx.modelDirectories.directoryFor(sessionId)`, and disposed with the session scope. Addressed subagent sessions expose neither entry, and their directory rejects loads, selections, and reconnect refreshes, because ordinary Agent-bound model RPCs would activate persisted child history outside the direct-parent continuation path.

Every resident directory refetches directly on forwarded `llm/adapters-updated` and `settings/document-updated` owner events. Provider topology, provider catalogs, and the default selection therefore converge without the Host or client runtime deriving a separate model-change alias.

The menu offers `Leon Adaptive` when the Host exposes adaptive routing and `Leon Team` when configured coordinator roles are returned. Adaptive uses the deployment's routing policy. Team uses the registered coordinator and delegated worker, review, and vision routes; the panel displays those configured roles but does not start a mission, force delegation, or guarantee review of each reply. An explicit model or effort selects manual mode. The trigger displays the accepted mode beside the actual route and refreshes automatic routes at turn start and durable failover. Opening any panel does not select a model, change deployment defaults, or grant external consent; external consent appears only for a declared failover route. Routing mode is process-local and restarting the Host restores its configured default.

The `/client` exports are the plugin body (`apply`/`inject`), `ModelDirectoryResolver`, `ModelDirectory` with its state fields, and the seat's injected face type.

## Model Experience

Indirectly, through the `session.selectModel` RPC available to ordinary sessions, both entries submit the complete `ModelSelection` that the Host snapshots at the next prompt-assembly boundary, so the following request uses the selected provider, model, and effort while a running step keeps its assembled selection; the selection becomes durable only when the existing request header records a request that consumes it, and menu interaction adds no prompt content.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **Catalog presence is not live health** — the list describes configured models and the current provider adapter. It does not prove that a server process is running, a model artifact is present, or the model is loaded in memory.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.
