# @deepseek-ai/dsh-client-ui-work-dashboard

English | [中文](README.zh.md)

This package fills the optional root-scoped `conversation.hero.dashboard` seat with the Leon Work overview on blank sessions. It derives project count, running work, pending interaction, completed work, and the three most recent conversations from the existing Workspace and Session projections. The dashboard does not synthesize provider, GPU, or API health that the browser cannot authoritatively observe.

The package owns only product presentation and navigation. `Nova tarefa` delegates to the Workspace runtime, recent rows delegate to the Session runtime, and the conversation package keeps ownership of the resident composer and the active-task surface. A session-header `Revisar memória` action opens the workspace-isolated candidate queue and delegates immutable accept or reject decisions to the Host Remote; it does not write final memory. Brazilian Portuguese is product-authored beside complete English and Simplified Chinese dictionaries. Removing this package from the Web composition restores the ordinary dashboard-free Hero and removes the review control without changing either domain.

## Model Experience

None, as the dashboard reads browser projections and invokes navigation or local review actions without adding its copy, candidates, or state to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Runtime health is explanatory rather than live** — model, GPU, Ollama, and cloud-provider health need an authoritative client projection before the dashboard can present status without guessing. The active model remains disclosed by the existing composer chip.
- **Recent work is intentionally compact** — the first version shows at most three nonblank, nonarchived, ordinary sessions. Deliverables, scheduled work, final-memory persistence, and permission audit cards remain separate milestones.
