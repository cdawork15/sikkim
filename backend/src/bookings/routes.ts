import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { bearerToken } from '../accounts/model.js';
import { object, revision, text, uuid } from '../catalogue/model.js';
import {
  changeSchema,
  confirmationSchema,
  holdSchema,
  idParams,
  noQuery,
  pageQuery,
  slotSchema,
  type Change,
  type Confirmation,
  type HoldInput,
  type Move,
  type SlotInput,
} from './model.js';
import { cancelSlot, createSlot, listSlots, updateSlot } from './slots.js';
import {
  cancelBooking,
  confirm,
  createHold,
  releaseHold,
  reschedule,
} from './reservations.js';
import {
  detail,
  occupied,
  ownedExperience,
  publicSlot,
  slot,
} from './store.js';
import { checkIn, noShow, ticket } from './tickets.js';

export function registerBookings(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const access = accountAccess(database, config);
  const privateSchema = { params: idParams, querystring: noQuery };

  app.get<{ Params: { id: string } }>(
    '/v1/me/slots/:id',
    { schema: privateSchema },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        async (client, principal) => {
          const selected = await slot(client, request.params.id);
          await ownedExperience(
            client,
            selected.experience_id,
            principal.userId,
          );
          return {
            ...publicSlot(
              selected,
              selected.capacity - (await occupied(client, selected.id)),
            ),
            experienceId: selected.experience_id,
          };
        },
      ),
    }),
  );

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/v1/experiences/:id/slots',
    { schema: { params: idParams, querystring: pageQuery } },
    (request) =>
      database.transaction((client) =>
        listSlots(client, request.params.id, request.query.after),
      ),
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/v1/me/experiences/:id/slots',
    { schema: { params: idParams, querystring: pageQuery } },
    (request) =>
      access(bearerToken(request.headers.authorization), (client, p) =>
        listSlots(client, request.params.id, request.query.after, p.userId),
      ),
  );
  app.post<{ Params: { id: string }; Body: SlotInput }>(
    '/v1/me/experiences/:id/slots',
    { schema: { ...privateSchema, body: slotSchema } },
    async (request, reply) =>
      reply.code(201).send({
        data: await access(
          bearerToken(request.headers.authorization),
          (client, p) =>
            createSlot(
              client,
              p.userId,
              request.params.id,
              request.body,
              request.id,
            ),
        ),
      }),
  );
  app.put<{
    Params: { id: string };
    Body: { revision: number; capacity: number; status: 'open' | 'closed' };
  }>(
    '/v1/me/slots/:id',
    {
      schema: {
        ...privateSchema,
        body: object(
          {
            revision,
            capacity: { type: 'integer', minimum: 1, maximum: 1000 },
            status: { type: 'string', enum: ['open', 'closed'] },
          },
          ['revision', 'capacity', 'status'],
        ),
      },
    },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) =>
          updateSlot(
            client,
            p.userId,
            request.params.id,
            request.body,
            request.id,
          ),
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: Change }>(
    '/v1/me/slots/:id/cancel',
    { schema: { ...privateSchema, body: changeSchema } },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) =>
          cancelSlot(
            client,
            p.userId,
            request.params.id,
            request.body,
            request.id,
          ),
      ),
    }),
  );
  app.post<{ Body: HoldInput }>(
    '/v1/me/seat-holds',
    { schema: { querystring: noQuery, body: holdSchema } },
    async (request, reply) =>
      reply.code(201).send({
        data: await access(
          bearerToken(request.headers.authorization),
          (client, p) => createHold(client, p.userId, request.body),
        ),
      }),
  );
  app.post<{ Params: { id: string } }>(
    '/v1/me/seat-holds/:id/release',
    { schema: { ...privateSchema, body: noQuery } },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) => releaseHold(client, p.userId, request.params.id),
      ),
    }),
  );
  app.post<{ Body: Confirmation }>(
    '/v1/me/bookings',
    { schema: { querystring: noQuery, body: confirmationSchema } },
    async (request, reply) =>
      reply.code(201).send({
        data: await access(
          bearerToken(request.headers.authorization),
          (client, p) => confirm(client, p.userId, request.body, request.id),
        ),
      }),
  );
  app.get<{
    Querystring: { after?: string; status?: string; experienceId?: string };
  }>(
    '/v1/me/bookings',
    {
      schema: {
        querystring: object({
          after: uuid,
          status: { type: 'string', enum: ['upcoming', 'past', 'cancelled'] },
          experienceId: uuid,
        }),
      },
    },
    (request) =>
      access(bearerToken(request.headers.authorization), async (client, p) => {
        const rows = (
          await client.query(
            `
        SELECT b.id,b.reference,b.quantity,b.status,b.revision,b.snapshot->>'title' AS title,
          b.experience_id AS "experienceId",b.slot_id AS "slotId",
          b.total_paise AS "totalPaise",b.currency,s.starts_at AS "startsAt",s.ends_at AS "endsAt",s.timezone
        FROM public.bookings b JOIN public.experience_slots s ON s.id=b.slot_id
        WHERE b.user_id=$1 AND ($2::uuid IS NULL OR b.id>$2)
          AND ($3::text IS NULL OR
            ($3='cancelled' AND b.status='cancelled') OR
            ($3='upcoming' AND b.status='confirmed' AND s.ends_at>clock_timestamp()) OR
            ($3='past' AND b.status<>'cancelled' AND s.ends_at<=clock_timestamp()))
          AND ($4::uuid IS NULL OR b.experience_id=$4)
        ORDER BY b.id LIMIT 21
      `,
            [
              p.userId,
              request.query.after ?? null,
              request.query.status ?? null,
              request.query.experienceId ?? null,
            ],
          )
        ).rows;
        return {
          data: rows.slice(0, 20),
          page: { nextCursor: rows.length > 20 ? rows[19].id : null },
        };
      }),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/me/bookings/:id',
    { schema: privateSchema },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) => detail(client, request.params.id, p.userId),
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/me/bookings/:id/ticket',
    { schema: privateSchema },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) => ticket(client, p.userId, request.params.id),
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: Change }>(
    '/v1/me/bookings/:id/cancel',
    { schema: { ...privateSchema, body: changeSchema } },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) =>
          cancelBooking(
            client,
            p.userId,
            request.params.id,
            request.body,
            request.id,
          ),
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: Move }>(
    '/v1/me/bookings/:id/reschedule',
    {
      schema: {
        ...privateSchema,
        body: object(
          { revision, reason: text(1000), slotId: uuid, requestKey: uuid },
          ['revision', 'reason', 'slotId', 'requestKey'],
        ),
      },
    },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) =>
          reschedule(
            client,
            p.userId,
            request.params.id,
            request.body,
            request.id,
          ),
      ),
    }),
  );
  app.post<{ Body: { token: string } }>(
    '/v1/me/check-ins',
    {
      schema: {
        querystring: noQuery,
        body: object({ token: { type: 'string', pattern: '^[0-9a-f]{64}$' } }, [
          'token',
        ]),
      },
    },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) =>
          checkIn(client, p.userId, request.body.token, request.id),
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: { revision: number } }>(
    '/v1/me/host-bookings/:id/no-show',
    { schema: { ...privateSchema, body: object({ revision }, ['revision']) } },
    async (request) => ({
      data: await access(
        bearerToken(request.headers.authorization),
        (client, p) =>
          noShow(
            client,
            p.userId,
            request.params.id,
            request.body.revision,
            request.id,
          ),
      ),
    }),
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/v1/me/slots/:id/bookings',
    { schema: { params: idParams, querystring: pageQuery } },
    (request) =>
      access(bearerToken(request.headers.authorization), async (client, p) => {
        const selected = await slot(client, request.params.id);
        await ownedExperience(client, selected.experience_id, p.userId);
        const rows = (
          await client.query(
            `
        SELECT b.id,b.reference,b.quantity,b.status,b.revision,b.contact_name AS "contactName",
          b.guests,t.status AS "ticketStatus"
        FROM public.bookings b LEFT JOIN public.tickets t ON t.booking_id=b.id AND t.status<>'revoked'
        WHERE b.slot_id=$1 AND ($2::uuid IS NULL OR b.id>$2) ORDER BY b.id LIMIT 51
      `,
            [selected.id, request.query.after ?? null],
          )
        ).rows;
        return {
          data: rows.slice(0, 50),
          page: { nextCursor: rows.length > 50 ? rows[49].id : null },
        };
      }),
  );
}
