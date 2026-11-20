import type { PoolClient } from 'pg';

export async function audit(
  client: PoolClient,
  userId: string,
  action: string,
  requestId: string,
  entityType = 'user',
  entityId = userId,
) {
  await client.query(
    `
      INSERT INTO public.audit_logs (
          actor_id,
          action,
          entity_type,
          entity_id,
          request_id
        )
      VALUES
        ($1, $2, $3, $4, $5)
    `,
    [userId, action, entityType, entityId, requestId],
  );
}
