// Every account can add a password and sign in with it or with a one-time code.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.auth_passwords
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
    COMMENT ON TABLE public.auth_passwords
      IS 'Optional password for an account. Sign in with it using any of the account''s email or phone identities.';
    GRANT UPDATE (password_hash, updated_at) ON public.auth_passwords TO sikkim_app;
  `);
};
exports.down = false;
