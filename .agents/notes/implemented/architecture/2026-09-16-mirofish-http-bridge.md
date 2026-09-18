# Agent Note: MiroFish HTTP bridge for Leon

Status: implemented

English | [中文](2026-09-16-mirofish-http-bridge.zh.md)

## Problem

Leon needs access to MiroFish's crowd-simulation reports without embedding the upstream application. MiroFish is AGPL-3.0, carries its own Python environment, LLM API, and Zep Cloud configuration, and its simulation lifecycle is long-running and resource-heavy. Copying its source into the Leon tree would import the license, the runtime, and an upgrade burden the harness cannot own.

## Alternatives considered

- **Vendor MiroFish source into the repository** — rejected: AGPL-3.0 would reach code it does not own, and the Python runtime plus Docker stack would become a maintained dependency of the harness.
- **Manage the MiroFish process from Leon** — rejected: starting Docker, installing dependencies, and holding MiroFish credentials are operator responsibilities; the bridge keeps them outside Leon.
- **HTTP bridge to an independently running backend** — adopted: the operator runs MiroFish, Leon calls only its documented API, and the license boundary stays at the wire.

## Decision

Leon exposes the `mirofish_simulate` tool only through the shipped Leon preset. The tool calls a separately running MiroFish Flask backend over its documented HTTP API and does not copy MiroFish source, start Docker, install Python dependencies, or store MiroFish credentials.

The workflow is ontology generation, graph construction, simulation preparation, simulation execution, and report generation. Asynchronous graph, preparation, simulation, and report stages are polled with a shared AbortSignal, per-request timeout, per-stage wait limit, and a 40-round default cap.

## Safety

The seed text is uploaded to the configured MiroFish backend, so execution calls the shared approval service before the first request. A rejected, cancelled, or unavailable approval fails closed. The tool describes the output as a simulation report rather than a guaranteed prediction.

The default endpoint is `http://127.0.0.1:5001`, matching the upstream backend container mapping. The generic Web bundle carries the dependency, while the Leon preset enables the tool with conservative limits. Other profiles do not expose it.

## Consequences

The Leon installation must run MiroFish independently and provide its required LLM and Zep configuration. MiroFish remains an AGPL-3.0 application with its own frontend, backend, Python environment, and operational lifecycle. The bridge is private and MIT-licensed within the Leon repository, and communicates only through the MiroFish API.

The tool returns project, graph, simulation, and report identifiers plus bounded Markdown report content. It does not delete MiroFish projects or reports, mutate Zep directly, or enable graph-memory updates from simulation activity.

## Verification

Keyless tests cover URL normalization and successful/error response envelopes. Typecheck and the package build cover the tool schema, approval call, API workflow, and bundle registration. A live smoke test requires a running MiroFish backend with valid LLM and Zep credentials and is not part of the default keyless suite.
