exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public.experience_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      experience_id uuid NOT NULL REFERENCES public.experiences(id),
      request_key uuid NOT NULL,
      request_hash char(64) NOT NULL,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      timezone varchar(64) NOT NULL CHECK (timezone = 'Asia/Kolkata'),
      booking_deadline timestamptz NOT NULL,
      cancellation_hours integer NOT NULL CHECK (cancellation_hours BETWEEN 0 AND 720),
      reschedule_hours integer NOT NULL CHECK (reschedule_hours BETWEEN 0 AND 720),
      capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
      price_paise integer NOT NULL CHECK (price_paise >= 0),
      currency char(3) NOT NULL CHECK (currency = 'INR'),
      policy_id uuid NOT NULL,
      experience_revision integer NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (experience_id, request_key),
      UNIQUE (experience_id, id),
      FOREIGN KEY (experience_id, policy_id) REFERENCES public.policies(experience_id, id),
      CHECK (ends_at > starts_at AND booking_deadline <= starts_at)
    );
    CREATE INDEX experience_slots_dates_idx ON public.experience_slots(experience_id, starts_at, id);

    CREATE TABLE public.seat_holds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slot_id uuid NOT NULL REFERENCES public.experience_slots(id),
      user_id uuid NOT NULL REFERENCES public.users(id),
      request_key uuid NOT NULL,
      quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
      expires_at timestamptz NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'released', 'expired')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (user_id, request_key)
    );
    CREATE INDEX seat_holds_capacity_idx ON public.seat_holds(slot_id, expires_at) WHERE status = 'active';

    CREATE TABLE public.bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reference varchar(24) NOT NULL UNIQUE,
      user_id uuid NOT NULL REFERENCES public.users(id),
      hold_id uuid NOT NULL UNIQUE REFERENCES public.seat_holds(id),
      experience_id uuid NOT NULL REFERENCES public.experiences(id),
      slot_id uuid NOT NULL,
      quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
      contact_name varchar(80) NOT NULL CHECK (length(btrim(contact_name)) > 0),
      contact_email varchar(254) NOT NULL,
      guests jsonb NOT NULL CHECK (jsonb_typeof(guests) = 'array' AND jsonb_array_length(guests) = quantity),
      snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
      confirmation_hash char(64) NOT NULL,
      total_paise integer NOT NULL DEFAULT 0 CHECK (total_paise = 0),
      currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
      status varchar(16) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'no_show')),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (experience_id, slot_id) REFERENCES public.experience_slots(experience_id, id)
    );
    CREATE INDEX bookings_capacity_idx ON public.bookings(slot_id) WHERE status = 'confirmed';
    CREATE INDEX bookings_owner_idx ON public.bookings(user_id, id);

    CREATE TABLE public.tickets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id uuid NOT NULL REFERENCES public.bookings(id),
      token char(64) NOT NULL UNIQUE,
      status varchar(16) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'revoked', 'checked_in')),
      checked_in_by uuid REFERENCES public.users(id),
      checked_in_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((status = 'checked_in') = (checked_in_at IS NOT NULL AND checked_in_by IS NOT NULL))
    );
    CREATE UNIQUE INDEX tickets_current_idx ON public.tickets(booking_id) WHERE status <> 'revoked';

    -- Append-only changes are also the durable event source for notification issue #10.
    -- No guest names, email addresses or ticket tokens are copied to these events.
    CREATE TABLE public.booking_changes (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      booking_id uuid NOT NULL REFERENCES public.bookings(id),
      actor_id uuid NOT NULL REFERENCES public.users(id),
      action varchar(24) NOT NULL CHECK (action IN ('confirmed', 'cancelled', 'rescheduled', 'checked_in', 'no_show')),
      old_slot_id uuid REFERENCES public.experience_slots(id),
      new_slot_id uuid NOT NULL REFERENCES public.experience_slots(id),
      reason varchar(1000),
      request_key uuid,
      request_hash char(64),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (booking_id, request_key)
    );
    CREATE INDEX booking_changes_history_idx ON public.booking_changes(booking_id, sequence);
    GRANT SELECT, INSERT ON public.experience_slots, public.seat_holds, public.bookings, public.tickets, public.booking_changes TO sikkim_app;
    GRANT UPDATE (capacity, status, revision) ON public.experience_slots TO sikkim_app;
    GRANT UPDATE (status) ON public.seat_holds TO sikkim_app;
    GRANT UPDATE (slot_id, status, revision) ON public.bookings TO sikkim_app;
    GRANT UPDATE (status, checked_in_by, checked_in_at) ON public.tickets TO sikkim_app;
    GRANT USAGE ON SEQUENCE public.booking_changes_sequence_seq TO sikkim_app;
  `);
};
exports.down = false;
