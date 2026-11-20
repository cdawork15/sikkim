exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX audit_logs_entity_time_idx
      ON public.audit_logs (entity_type, entity_id, created_at DESC);

    CREATE INDEX audit_logs_request_idx ON public.audit_logs (request_id);
  `);
};
exports.down = false;
