# Agent Note: Pin web fetch connections to validated public addresses

Status: implemented

English | [中文](2026-08-28-web-fetch-public-network-pinning.zh.md)

## Problem

`web_fetch` accepted any HTTP(S) URL and delegated DNS plus connection setup to platform `fetch`. Scheme, credential, size, timeout, and redirect checks did not stop a model-supplied hostname from resolving to loopback, link-local metadata, a private service, or another special-use address. Resolving a hostname for validation and then invoking ordinary `fetch` would still leave a DNS rebinding race because the transport could resolve the name again.

Same-origin redirects need the same protection as an initial request. A hostname can return a public address for the first hop and a private address for the next hop without changing the URL origin.

## Decision

`@deepseek-ai/dsh-web-fetch-http` permits only public-network destinations and enforces that decision at URL parsing, DNS resolution, and connection setup.

The URL check rejects localhost names and non-public IP literals after WHATWG canonicalization, including decimal, octal, hexadecimal, shortened IPv4, IPv4-mapped IPv6, transition prefixes, and private or special-use ranges. Hostnames are resolved with all answers. One non-public or malformed answer rejects the complete destination rather than selecting a public sibling.

Each request hop creates a fresh Undici dispatcher whose connector lookup returns only the validated answer set. The original hostname remains the HTTP Host and TLS verification name, but socket creation cannot perform a second DNS lookup or connect elsewhere. The dispatcher is released only after the response body is consumed or cancelled. Every allowed same-origin redirect repeats URL validation, DNS validation, and dispatcher creation.

The anonymous provider has no private-network bypass. Intentional intranet access belongs in a separate connector with explicit permissions.

## Alternatives considered

**Block suspicious hostname prefixes.** Rejected because alternative literal forms, arbitrary DNS names, IPv6, and rebinding bypass string checks.

**Resolve and validate, then call platform `fetch` normally.** Rejected because connection setup performs another lookup, leaving a time-of-check/time-of-use gap.

**Discard private answers from a mixed DNS result and use a public answer.** Rejected because an attacker controls answer ordering and rotation; rejecting the full set produces a stable security decision.

**Allow a configuration switch for private networks.** Rejected because the provider is the anonymous public-web implementation. A bypass would silently turn a broadly available model tool back into an internal-network request primitive.

## Consequences

`WEB_BLOCKED_URL` covers literal and DNS-derived non-public destinations without disclosing the resolved private address. Public sites retain HTTP status, redirect, decoding, timeout, abort, and size-limit behavior through Undici.

Tests pin alternative IPv4 forms, IPv4/IPv6 special ranges, mixed DNS results, malformed answers, connector address pinning, per-hop rebinding rejection, dispatcher cleanup, and the package's existing transport behavior. The policy is intentionally conservative: workflows for loopback, private, documentation, benchmark, transition, or reserved networks require another permissioned capability.

The keyless ACP web-fetch snapshot therefore selects a separate test-only provider that accepts only its exact loopback fixture URL. It still exercises the real model-facing fetch tool and Markdown rendering without adding a private-network bypass to the production provider.
