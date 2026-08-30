/**
 * Public-network destination policy for anonymous HTTP(S) retrieval. URL
 * parsing catches literal-address aliases; DNS answers are checked before a
 * transport receives them.
 * @module @deepseek-ai/dsh-web-fetch-http/network-policy
 */

import { lookup as nodeLookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { WebError } from '@deepseek-ai/dsh-web'

/** One validated address that a transport may connect to. */
export interface PublicAddress {
  readonly address: string
  readonly family: 4 | 6
}

/** DNS lookup dependency used to test mixed and changing answers. */
export type LookupAll = (hostname: string) => Promise<readonly LookupAddress[]>

const IPV4_NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  IPV4_NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
}

const IPV6_NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['::', 8],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['100:0:0:1::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  IPV6_NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
}

/** Remove URL brackets and a DNS root label before classification. */
function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  return unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed
}

/**
 * Return whether an address is globally routable under the provider's
 * conservative denylist. Invalid input is never public.
 *
 * @param address - Canonical IPv4 or IPv6 text.
 * @returns `true` only for an address outside non-public and special-use ranges.
 */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !IPV4_NON_PUBLIC.check(address, 'ipv4')
  if (family === 6) return !IPV6_NON_PUBLIC.check(address, 'ipv6')
  return false
}

/**
 * Reject localhost aliases and non-public IP literals before DNS or transport
 * work. The WHATWG URL parser has already canonicalized legacy IPv4 forms such
 * as decimal, octal, hexadecimal, and shortened dotted notation.
 *
 * @param hostname - `URL.hostname` from a validated HTTP(S) URL.
 */
export function assertPublicUrlHostname(hostname: string): void {
  const normalized = normalizeHostname(hostname).toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    throw blockedDestination()
  }
  const family = isIP(normalized)
  if (family !== 0 && !isPublicIpAddress(normalized)) {
    throw blockedDestination()
  }
}

/**
 * Resolve and validate every address for one request hop. A mixed public/private
 * answer is rejected in full; the returned list is the only list the transport
 * may use, preventing a second DNS lookup from changing the destination.
 *
 * @param url - Validated HTTP(S) URL for the current request or redirect hop.
 * @param lookupAll - DNS implementation; defaults to Node's system resolver.
 * @returns Deduplicated public addresses approved for the connection.
 */
export async function resolvePublicDestination(
  url: URL,
  lookupAll: LookupAll = systemLookupAll,
): Promise<readonly PublicAddress[]> {
  const hostname = normalizeHostname(url.hostname)
  assertPublicUrlHostname(hostname)

  const literalFamily = isIP(hostname)
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: hostname, family: literalFamily }]
  }

  const answers = await lookupAll(hostname)
  if (answers.length === 0) {
    throw new WebError('web fetch DNS lookup returned no addresses', 'WEB_PROVIDER_ERROR')
  }

  const approved: PublicAddress[] = []
  const seen = new Set<string>()
  for (const answer of answers) {
    const parsedFamily = isIP(answer.address)
    if ((answer.family !== 4 && answer.family !== 6) || parsedFamily !== answer.family) {
      throw new WebError('web fetch DNS lookup returned an invalid address', 'WEB_PROVIDER_ERROR')
    }
    if (!isPublicIpAddress(answer.address)) throw blockedDestination()
    const key = `${answer.family}:${answer.address}`
    if (!seen.has(key)) {
      seen.add(key)
      approved.push({ address: answer.address, family: answer.family })
    }
  }
  return approved
}

/**
 * Resolve all system addresses without reordering the operating-system answer.
 *
 * @param hostname - Canonical DNS hostname.
 * @returns Every address returned by the system resolver.
 */
export async function systemLookupAll(hostname: string): Promise<readonly LookupAddress[]> {
  return await nodeLookup(hostname, { all: true, order: 'verbatim' })
}

/** Keep blocked-target diagnostics free of resolved private-address details. */
function blockedDestination(): WebError {
  return new WebError('web fetch blocked a non-public network destination', 'WEB_BLOCKED_URL')
}
