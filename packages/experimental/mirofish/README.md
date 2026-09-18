# `@deepseek-ai/dsh-experimental-mirofish`

English | [中文](README.zh.md)

Optional Leon integration for a separately running [MiroFish](https://github.com/666ghj/MiroFish) backend. The package exposes `mirofish_simulate`, which uploads the supplied seed text, builds a MiroFish graph, prepares and runs a bounded simulation, and returns the generated Markdown report.

## Configuration

```yaml
- id: mirofish
  name: '@deepseek-ai/dsh-experimental-mirofish'
  config:
    enabled: true
    baseUrl: 'http://127.0.0.1:5001'
    maxRounds: 40
```

The tool is disabled unless `enabled: true` is set by the composition. Each execution requests the shared Leon approval service before sending the seed to MiroFish. The client never starts Docker, installs dependencies, or stores API keys.

`baseUrl` points to the MiroFish Flask backend. The official deployment uses port `5001` for the backend and `3000` for its separate frontend. MiroFish must be configured and running independently, including its LLM API and Zep Cloud settings. The bridge uses the documented graph, simulation, and report endpoints and polls asynchronous tasks with cancellation and bounded wait limits.

## Safety and limits

The result is a simulation report, not a guaranteed prediction. Seeds are limited by `maxSeedChars`, reports by `maxReportChars`, each request by `timeoutMs`, and each asynchronous stage by `maxWaitMs`. The default simulation cap is 40 rounds because the upstream project warns that simulations can consume significant LLM resources.

The package is private and keeps MiroFish process and licensing boundaries separate from the Leon core. MiroFish remains an external AGPL-3.0 application; this package only communicates with its HTTP API.

## Model Experience

### MiroFish simulation tool

#### What the model sees

One optional tool, `mirofish_simulate`, whose schema asks for the seed text to simulate. The tool result carries the generated Markdown report; failures return the bridge's bounded error text rather than partial simulation output.

#### Token effect

The seed argument is bounded by `maxSeedChars` and the returned report by `maxReportChars`, so one call cannot push an unbounded document into the context.

#### KV Cache effect

None; the tool adds no prompt prefix and its result arrives as an ordinary tool result.

## Known Limitations and Deferred Work

- **External backend lifecycle** — Leon never starts, monitors, or upgrades the MiroFish server; an absent or misconfigured backend surfaces only when the tool is called.
- **Upstream model quality is opaque** — report content depends on MiroFish's own LLM and Zep configuration, which this package cannot validate.
- **License boundary** — MiroFish is AGPL-3.0; the bridge communicates over HTTP only and does not embed upstream code.
