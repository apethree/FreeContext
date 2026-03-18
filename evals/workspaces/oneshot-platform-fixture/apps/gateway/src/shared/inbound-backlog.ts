import type { Pool } from "pg";

export type InboundBacklogEvent = {
  tenantId: string;
  eventId: string;
  eventType: string;
  payloadRef: string | null;
  payloadJson: unknown;
  createdAtMs: number;
};

export async function addInboundBacklog(
  pg: Pool,
  event: Omit<InboundBacklogEvent, "createdAtMs">,
): Promise<void> {
  await pg.query(
    `INSERT INTO inbound_backlog (tenant_id, event_id, event_type, payload_ref, payload_json, created_at_ms)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (tenant_id, event_id) DO NOTHING`,
    [
      event.tenantId,
      event.eventId,
      event.eventType,
      event.payloadRef,
      JSON.stringify(event.payloadJson ?? {}),
      Date.now(),
    ],
  );
}

export async function claimInboundBacklog(
  pg: Pool,
  tenantId: string,
  limit = 100,
): Promise<InboundBacklogEvent[]> {
  const result = await pg.query<{
    tenant_id: string;
    event_id: string;
    event_type: string;
    payload_ref: string | null;
    payload_json: unknown;
    created_at_ms: number;
  }>(
    `SELECT tenant_id, event_id, event_type, payload_ref, payload_json, created_at_ms
     FROM inbound_backlog
     WHERE tenant_id = $1 AND delivered_at_ms IS NULL
     ORDER BY created_at_ms ASC
     LIMIT $2`,
    [tenantId, limit],
  );

  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    eventId: row.event_id,
    eventType: row.event_type,
    payloadRef: row.payload_ref,
    payloadJson: row.payload_json,
    createdAtMs: row.created_at_ms,
  }));
}

export async function markInboundBacklogDelivered(
  pg: Pool,
  tenantId: string,
  eventId: string,
): Promise<void> {
  await pg.query(
    `UPDATE inbound_backlog SET delivered_at_ms = $3 WHERE tenant_id = $1 AND event_id = $2`,
    [tenantId, eventId, Date.now()],
  );
}
