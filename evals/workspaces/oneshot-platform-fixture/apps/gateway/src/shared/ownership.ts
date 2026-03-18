import type { Redis } from "ioredis";
import type { TenantOwnershipLease } from "./types.js";
import { redisKeys } from "./redis-keys.js";

const ACQUIRE_LEASE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local ownerId = ARGV[3]
local leaseId = ARGV[4]

local raw = redis.call('GET', key)
local nextEpoch = 1

if raw then
  local current = cjson.decode(raw)
  if current.expiresAtMs and tonumber(current.expiresAtMs) > now then
    if current.ownerId ~= ownerId then
      return {0, raw}
    end
    -- Same owner with an active lease: keep lease id/epoch stable so existing
    -- actor heartbeats do not get invalidated by additional websocket upgrades.
    redis.call('PEXPIRE', key, ttlMs)
    return {1, raw}
  else
    nextEpoch = (tonumber(current.epoch) or 0) + 1
  end
end

local next = cjson.encode({
  ownerId = ownerId,
  leaseId = leaseId,
  epoch = nextEpoch,
  expiresAtMs = now + ttlMs
})
redis.call('SET', key, next, 'PX', ttlMs)
return {1, next}
`;

const RENEW_LEASE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local ownerId = ARGV[3]
local leaseId = ARGV[4]

local raw = redis.call('GET', key)
if not raw then
  return {0, nil}
end

local current = cjson.decode(raw)
if current.ownerId ~= ownerId or current.leaseId ~= leaseId then
  return {0, raw}
end

local next = cjson.encode({
  ownerId = current.ownerId,
  leaseId = current.leaseId,
  epoch = current.epoch,
  expiresAtMs = now + ttlMs
})
redis.call('SET', key, next, 'PX', ttlMs)
return {1, next}
`;

const RELEASE_LEASE_LUA = `
local key = KEYS[1]
local ownerId = ARGV[1]
local leaseId = ARGV[2]

local raw = redis.call('GET', key)
if not raw then
  return 1
end

local current = cjson.decode(raw)
if current.ownerId ~= ownerId or current.leaseId ~= leaseId then
  return 0
end

redis.call('DEL', key)
return 1
`;

function parseLease(raw: string | null): TenantOwnershipLease | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TenantOwnershipLease;
    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.leaseId !== "string" ||
      typeof parsed.epoch !== "number" ||
      typeof parsed.expiresAtMs !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class OwnershipLeaseManager {
  constructor(
    private readonly redis: Redis,
    private readonly ownerId: string,
    private readonly ttlMs: number,
  ) {}

  async read(tenantId: string): Promise<TenantOwnershipLease | null> {
    const raw = await this.redis.get(redisKeys.tenantOwner(tenantId));
    return parseLease(raw);
  }

  async acquire(tenantId: string): Promise<{ acquired: boolean; lease: TenantOwnershipLease | null }> {
    const leaseId = crypto.randomUUID();
    const now = Date.now();
    const result = await this.redis.eval(
      ACQUIRE_LEASE_LUA,
      1,
      redisKeys.tenantOwner(tenantId),
      String(now),
      String(this.ttlMs),
      this.ownerId,
      leaseId,
    ) as [number, string | null];

    const acquired = Number(result[0]) === 1;
    const lease = parseLease(result[1]);
    return { acquired, lease };
  }

  async renew(tenantId: string, leaseId: string): Promise<{ renewed: boolean; lease: TenantOwnershipLease | null }> {
    const result = await this.redis.eval(
      RENEW_LEASE_LUA,
      1,
      redisKeys.tenantOwner(tenantId),
      String(Date.now()),
      String(this.ttlMs),
      this.ownerId,
      leaseId,
    ) as [number, string | null];

    const renewed = Number(result[0]) === 1;
    const lease = parseLease(result[1]);
    return { renewed, lease };
  }

  async release(tenantId: string, leaseId: string): Promise<boolean> {
    const released = await this.redis.eval(
      RELEASE_LEASE_LUA,
      1,
      redisKeys.tenantOwner(tenantId),
      this.ownerId,
      leaseId,
    ) as number;
    return Number(released) === 1;
  }

  assertOwnership(lease: TenantOwnershipLease | null): void {
    if (!lease) {
      throw new Error("tenant ownership lease missing");
    }
    if (lease.ownerId !== this.ownerId) {
      throw new Error(`tenant owned by another machine: ${lease.ownerId}`);
    }
    if (lease.expiresAtMs <= Date.now()) {
      throw new Error("tenant ownership lease expired");
    }
  }
}
