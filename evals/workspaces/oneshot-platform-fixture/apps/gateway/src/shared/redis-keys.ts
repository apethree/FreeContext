export const redisKeys = {
  tenantOwner: (tenantId: string) => `tenant:owner:${tenantId}`,
  sessionSeq: (tenantId: string, sessionId: string) => `seq:${tenantId}:${sessionId}`,
  eventSeq: (tenantId: string) => `evseq:${tenantId}`,
  fastIdempotency: (tenantId: string, key: string) => `idem:fast:${tenantId}:${key}`,
  deliveryDedup: (tenantId: string, eventId: string) => `deliver:dedup:${tenantId}:${eventId}`,
  presence: (tenantId: string, connId: string) => `presence:${tenantId}:${connId}`,
  tenantEventsChannel: (tenantId: string) => `tenant:events:${tenantId}`,
  tokenCache: (tenantId: string, userId: string, provider: string) => `token:${tenantId}:${userId}:${provider}`,
  turnLease: (tenantId: string, sessionId: string) => `lease:${tenantId}:${sessionId}`,
};
