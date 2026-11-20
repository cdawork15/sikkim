import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { bearerToken } from '../accounts/model.js';
import {
  bookingStatuses,
  roleFilters,
  leadStages,
  leadVerdicts,
  noteKinds,
  siteVisits,
  type LeadInput,
  type LeadPatch,
  type LeadStage,
} from './model.js';
import { adminService } from './service.js';

const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', additionalProperties: false, properties, required });
const noQuery = object({});
const uuid = { type: 'string', format: 'uuid' };
const nullableUuid = { anyOf: [uuid, { type: 'null' }] };
const optionalText = (maxLength: number) => ({ type: 'string', maxLength });
const cursor = { type: 'string', minLength: 1, maxLength: 200 };
const search = { type: 'string', minLength: 1, maxLength: 120 };
const idParams = object({ id: uuid }, ['id']);
const revision = { type: 'integer', minimum: 1, maximum: 2147483646 };

const leadProperties = {
  code: { anyOf: [{ type: 'string', maxLength: 16 }, { type: 'null' }] },
  name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  experienceIdea: optionalText(200),
  district: optionalText(40),
  locality: optionalText(80),
  categoryCode: {
    anyOf: [{ type: 'string', maxLength: 24 }, { type: 'null' }],
  },
  contactName: optionalText(80),
  phone: optionalText(20),
  email: optionalText(254),
  contactSource: optionalText(200),
  contactConfirmed: { type: 'boolean' },
  stage: { type: 'string', enum: leadStages },
  verdict: { type: 'string', enum: leadVerdicts },
  siteVisit: { type: 'string', enum: siteVisits },
  mediaReceived: { type: 'boolean' },
  rightsConfirmed: { type: 'boolean' },
  agreementSigned: { type: 'boolean' },
  writeupFinal: { type: 'boolean' },
  ownerId: nullableUuid,
  hostId: nullableUuid,
  nextFollowUp: {
    anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }],
  },
};

export function registerAdmin(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const service = adminService(database, config);
  const token = (headers: { authorization?: string | undefined }) =>
    bearerToken(headers.authorization);

  app.get(
    '/v1/admin/queue',
    { schema: { querystring: noQuery } },
    async (req) => ({ data: await service.queue(token(req.headers)) }),
  );
  app.get(
    '/v1/admin/overview',
    { schema: { querystring: noQuery } },
    async (req) => ({ data: await service.overview(token(req.headers)) }),
  );

  app.get<{
    Querystring: {
      stage?: LeadStage;
      district?: string;
      q?: string;
      followUpDue?: 'true';
      after?: string;
    };
  }>(
    '/v1/admin/leads',
    {
      schema: {
        querystring: object({
          stage: { type: 'string', enum: leadStages },
          district: { type: 'string', minLength: 1, maxLength: 40 },
          q: search,
          followUpDue: { type: 'string', enum: ['true'] },
          after: cursor,
        }),
      },
    },
    async (req) =>
      service.listLeads(token(req.headers), {
        ...req.query,
        followUpDue: req.query.followUpDue === 'true',
      }),
  );
  app.post<{ Body: LeadInput }>(
    '/v1/admin/leads',
    {
      schema: {
        querystring: noQuery,
        body: object(leadProperties, ['name']),
      },
    },
    async (req, reply) =>
      reply.code(201).send({
        data: await service.createLead(token(req.headers), req.body, req.id),
      }),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/admin/leads/:id',
    { schema: { querystring: noQuery, params: idParams } },
    async (req) => ({
      data: await service.getLead(token(req.headers), req.params.id),
    }),
  );
  app.patch<{ Params: { id: string }; Body: LeadPatch }>(
    '/v1/admin/leads/:id',
    {
      schema: {
        querystring: noQuery,
        params: idParams,
        body: {
          ...object({ ...leadProperties, revision }, ['revision']),
          minProperties: 2,
        },
      },
    },
    async (req) => ({
      data: await service.updateLead(
        token(req.headers),
        req.params.id,
        req.body,
        req.id,
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: { kind: string; body: string } }>(
    '/v1/admin/leads/:id/notes',
    {
      schema: {
        querystring: noQuery,
        params: idParams,
        body: object(
          {
            kind: { type: 'string', enum: noteKinds },
            body: {
              type: 'string',
              minLength: 1,
              maxLength: 2000,
              pattern: '\\S',
            },
          },
          ['kind', 'body'],
        ),
      },
    },
    async (req, reply) =>
      reply.code(201).send({
        data: await service.addLeadNote(
          token(req.headers),
          req.params.id,
          req.body,
          req.id,
        ),
      }),
  );

  app.get<{ Querystring: { q?: string; role?: string; after?: string } }>(
    '/v1/admin/users',
    {
      schema: {
        querystring: object({
          q: search,
          role: { type: 'string', enum: roleFilters },
          after: cursor,
        }),
      },
    },
    async (req) => service.listUsers(token(req.headers), req.query),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/admin/users/:id',
    { schema: { querystring: noQuery, params: idParams } },
    async (req) => ({
      data: await service.getUser(token(req.headers), req.params.id),
    }),
  );
  app.post<{
    Params: { id: string };
    Body: { status: 'active' | 'suspended' };
  }>(
    '/v1/admin/users/:id/status',
    {
      schema: {
        querystring: noQuery,
        params: idParams,
        body: object(
          { status: { type: 'string', enum: ['active', 'suspended'] } },
          ['status'],
        ),
      },
    },
    async (req) => ({
      data: await service.setStatus(
        token(req.headers),
        req.params.id,
        req.body.status,
        req.id,
      ),
    }),
  );

  app.get<{ Querystring: { q?: string; status?: string; after?: string } }>(
    '/v1/admin/bookings',
    {
      schema: {
        querystring: object({
          q: search,
          status: { type: 'string', enum: bookingStatuses },
          after: cursor,
        }),
      },
    },
    async (req) => service.listBookings(token(req.headers), req.query),
  );
}
