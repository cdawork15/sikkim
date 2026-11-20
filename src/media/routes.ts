import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { bearerToken } from '../accounts/model.js';
import { object, revision, text, uuid } from '../catalogue/model.js';
import { assetService } from './assets.js';
import {
  idParams,
  noQuery,
  pageQuery,
  revisionBody,
  uploadSchema,
  variantNames,
  variantTypes,
  mediaInvalid,
  type UploadIntent,
  type Variant,
} from './model.js';

const variantParams = object(
  {
    id: uuid,
    variant: { type: 'string', enum: variantNames },
  },
  ['id', 'variant'],
);
const signatureQuery = object(
  {
    expires: { type: 'string', pattern: '^[0-9]{1,12}$' },
    signature: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  },
  ['expires', 'signature'],
);

type SignedRequest = {
  Params: { id: string; variant: Variant };
  Querystring: { expires: string; signature: string };
};

export function byteRange(value: string | undefined, size: number) {
  if (!value) {
    return undefined;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) {
    throw mediaInvalid('Use one valid byte range.');
  }
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= size
  ) {
    throw mediaInvalid('This byte range is not available.');
  }
  return { start, end };
}

export function registerMedia(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const service = assetService(database, config);
  app.post<{ Body: UploadIntent }>(
    '/v1/me/media',
    {
      bodyLimit: 32768,
      schema: { body: uploadSchema, querystring: noQuery },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await service.create(
          bearerToken(request.headers.authorization),
          request.body,
        ),
      }),
  );
  for (const prefix of ['me', 'admin'] as const) {
    app.get<{ Querystring: { after?: string } }>(
      `/v1/${prefix}/media`,
      {
        schema: { querystring: pageQuery },
      },
      (request) =>
        service.list(
          bearerToken(request.headers.authorization),
          request.query.after,
          prefix === 'admin',
        ),
    );
  }
  app.get<{ Params: { id: string } }>(
    '/v1/me/media/:id',
    {
      schema: { params: idParams, querystring: noQuery },
    },
    async (request) => ({
      data: await service.detail(
        bearerToken(request.headers.authorization),
        request.params.id,
      ),
    }),
  );

  void app.register(async (upload) => {
    upload.addContentTypeParser(
      'application/octet-stream',
      (_request, payload, done) => {
        done(null, payload);
      },
    );
    upload.put<{
      Params: { id: string };
      Querystring: { expires: string; signature: string };
      Body: Readable;
    }>(
      '/v1/me/media/:id/content',
      {
        bodyLimit: 52428800,
        schema: { params: idParams, querystring: signatureQuery },
        onRequest: async (request) => {
          if (request.headers['content-type'] !== 'application/octet-stream') {
            throw mediaInvalid('Upload the file as application/octet-stream.');
          }
          bearerToken(request.headers.authorization);
        },
      },
      async (request, reply) => {
        await service.upload(
          bearerToken(request.headers.authorization),
          request.params.id,
          request.query.expires,
          request.query.signature,
          request.body,
        );
        return reply.code(202).send({ data: { state: 'processing' } });
      },
    );
  });
  for (const action of ['retry', 'remove'] as const) {
    app.post<{ Params: { id: string }; Body: { revision: number } }>(
      `/v1/me/media/:id/${action}`,
      {
        schema: { params: idParams, querystring: noQuery, body: revisionBody },
      },
      async (request, reply) => {
        await service[action](
          bearerToken(request.headers.authorization),
          request.params.id,
          request.body.revision,
        );
        return reply
          .code(action === 'retry' ? 202 : 204)
          .send(
            action === 'retry' ? { data: { state: 'processing' } } : undefined,
          );
      },
    );
  }
  app.post<{
    Params: { id: string };
    Body: { revision: number; action: 'approved' | 'rejected'; reason: string };
  }>(
    '/v1/admin/media/:id/decisions',
    {
      schema: {
        params: idParams,
        querystring: noQuery,
        body: object(
          {
            revision,
            action: {
              type: 'string',
              enum: ['approved', 'rejected'],
            },
            reason: text(1000),
          },
          ['revision', 'action', 'reason'],
        ),
      },
    },
    async (request, reply) => {
      await service.review(
        bearerToken(request.headers.authorization),
        request.params.id,
        request.body.revision,
        request.body.action,
        request.body.reason,
        request.id,
      );
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { id: string; variant: Variant } }>(
    '/v1/me/media/:id/:variant/preview',
    {
      schema: { params: variantParams, querystring: noQuery },
    },
    async (request) => ({
      data: await service.preview(
        bearerToken(request.headers.authorization),
        request.params.id,
        request.params.variant,
      ),
    }),
  );
  for (const prefix of ['', 'me/'] as const) {
    app.get<SignedRequest>(
      `/v1/${prefix}media/:id/:variant`,
      {
        schema: { params: variantParams, querystring: signatureQuery },
      },
      async (request, reply) => {
        const file = await service.download(
          request.params.id,
          request.params.variant,
          request.query.expires,
          request.query.signature,
          prefix ? bearerToken(request.headers.authorization) : undefined,
        );
        let range;
        try {
          range = byteRange(request.headers.range, file.size);
        } catch {
          return reply
            .code(416)
            .header('content-range', `bytes */${file.size}`)
            .send();
        }
        reply
          .type(variantTypes[request.params.variant])
          .header(
            'cross-origin-resource-policy',
            prefix ? 'same-origin' : 'cross-origin',
          )
          .header('accept-ranges', 'bytes')
          .header('content-disposition', 'inline');
        if (range) {
          reply
            .code(206)
            .header(
              'content-range',
              `bytes ${range.start}-${range.end}/${file.size}`,
            )
            .header('content-length', range.end - range.start + 1);
        } else {
          reply.header('content-length', file.size);
        }
        return reply.send(file.stream(range));
      },
    );
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let maintenance: Promise<void> | undefined;
  if (config.media) {
    app.addHook('onReady', async () => {
      await service.recover();
      timer = setInterval(() => {
        if (maintenance) {
          return;
        }
        maintenance = service
          .recover()
          .catch(() => app.log.warn('Media cleanup will retry.'))
          .finally(() => {
            maintenance = undefined;
          });
      }, 60000);
      timer.unref();
    });
  }
  return async () => {
    clearInterval(timer);
    await maintenance;
    await service.close();
  };
}
