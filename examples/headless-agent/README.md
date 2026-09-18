# headless-agent

English | [中文](README.zh.md)

This directory owns the replay and real-model test composition for a headless coding agent: DeepSeek V4 + local bash and filesystem tools + subagent delegation + workflows and fresh-agent Ralph iteration + `todo_write` + JSONL persistence. It explicitly mounts the shared agent spine, one root agent, persistence, and checkpoint policy; it is not a second product entry point.

## Run it

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm dsh --profile headless "fix the failing test in this workspace"
```

The product command is [`dsh --profile headless`](../../apps/cli/README.md): it accepts one nonblank task, creates and persists a fresh session, prints the final assistant text, and exits.

Snapshot suites run this directory's configuration through [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts), an unexported test-only process that emits canonical session events as JSONL before its result record. That stream is test infrastructure, not a supported CLI output format. Child sessions surface only through parent tool events and results.

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) replaces the local filesystem and subprocess providers with one shared E2B sandbox while retaining `dsh-bash-local` and the same model-facing tools. Put `E2B_API_KEY` beside `DEEPSEEK_API_KEY` in the gitignored root `.env`, then run the credential-gated live composition, which drives FS, Bash, PTY, and LSP in one sandbox and proves final deletion:

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

The overlay creates the same absolute cwd inside the sandbox, but it does not upload or mount the host workspace. File and Bash mutations exist only in E2B; Cordis, model calls, agent/session state, session logs, skills, and SDK buffers remain on the host. The composition kills its sandbox on timeout and disposal. It is a provider-composition POC, not a whole-harness migration or a workspace-sync feature.

## Advanced configuration

[`advanced.cordis.yml`](advanced.cordis.yml) adds Code Mode and the Cordis tools to the test composition.

## Host-bound collective laboratory

[`collective-host.cordis.yml`](collective-host.cordis.yml) is an experimental import-idempotency demonstration: Lead, one investigator and one reviewer use separate native sessions with one generation at a time. The host persists their functional identities before inference. Limits are 48 calls and 15 minutes, including eight final reviewer-only calls. This does not enable the normal profile or provide a general coding mission.

Verify a local llama.cpp server at `127.0.0.1:8097` serving the `qwen3.5:4b` alias before invoking the [CLI runtime bridge](../../apps/cli/README.md). The alias does not require Ollama. The configuration grants no shell, arbitrary file access, memory promotion or cloud fallback. Use a new empty mission directory. The host reuses native tasks and peer evidence; it never closes missing work merely to pass review. A blocked mission remains blocked even if its artifact passes.

The runner accepts `status`, `pause` and terminal `stop` on stdin. After exit, the same runtime/config/directory support `status`, `stop` and an explicit `resume` of a paused mission within its original deadline. Repeated handoff requests are suppressed within a run unless artifact, task or collaboration evidence changes. A leftover owner lock requires process inspection, not automatic deletion. The normal profile is unchanged; exit this laboratory and use the normal launcher to return.

[`collective-host-v2.cordis.yml`](collective-host-v2.cordis.yml) is a separate variant with the same prompts, model route, limits and final verifier. It adds an admission check to the host-bound reviewer's task completion: a successful verification of the current digest must follow receipt of peer evidence. A premature completion request returns an actionable error without changing the task. This variant does not replace prior results. Cold-resume preservation of a pending inbox and cross-process handoff deduplication are not validated by the successful-completion smoke test.
