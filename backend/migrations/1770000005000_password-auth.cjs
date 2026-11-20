exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public.auth_passwords (
      user_id uuid PRIMARY KEY REFERENCES public.users (id),
      password_hash varchar(160) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    COMMENT ON TABLE public.auth_passwords
      IS 'Password credentials only. Email identifiers in auth_identities are unverified.';
    GRANT SELECT, INSERT ON public.auth_passwords TO sikkim_app;
  `);
};
exports.down = false;
