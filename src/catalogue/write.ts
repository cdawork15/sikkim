import { approvedAsset } from '../media/visibility.js';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AccountError } from '../accounts/model.js';
import { audit } from '../db/audit.js';
import { requirePublishableHost } from '../hosts/service.js';
import { requireStaff } from '../accounts/roles.js';
import { changed, invalid, missing, type Draft, type Review } from './model.js';

export async function requireReviewer(client: PoolClient, userId: string) {
  await requireStaff(
    client,
    userId,
    'Only an authorised reviewer can do this.',
  );
}

export async function privateDetail(
  client: PoolClient,
  id: string,
  userId?: string,
) {
  const row = (
    await client.query(
      `
        SELECT
          e.id,
          e.host_id AS "hostId",
          e.slug,
          e.title,
          e.description,
          e.area_code AS area,
          e.meeting_point AS "meetingPoint",
          e.duration_minutes AS "durationMinutes",
          e.price_paise AS "pricePaise",
          e.currency,
          e.min_participants AS "minParticipants",
          e.max_participants AS "maxParticipants",
          e.difficulty,
          e.inclusions,
          e.exclusions,
          e.preparation,
          e.accessibility,
          e.accessibility_notes AS "accessibilityNotes",
          e.source_kind AS "sourceKind",
          e.source_reference AS "sourceReference",
          e.status,
          e.revision,
          e.featured_rank AS "featuredRank",
          e.updated_at AS "updatedAt",
          u.is_demo AS "isDemo",
          ARRAY(
            SELECT category_code
            FROM public.experience_categories
            WHERE experience_id = e.id
            ORDER BY category_code
          ) AS categories,
          CASE
            WHEN p.id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'id',
              p.id,
              'version',
              p.version,
              'cancellation',
              p.cancellation,
              'safety',
              p.safety,
              'participation',
              p.participation
            )
          END AS policy
        FROM public.experiences e
          JOIN public.hosts h ON h.id = e.host_id
          JOIN public.users u ON u.id = h.user_id
          LEFT JOIN public.policies p ON p.id = e.policy_id
        WHERE e.id = $1
          AND (
            $2::uuid IS NULL
            OR h.user_id = $2
          )
      `,
      [id, userId ?? null],
    )
  ).rows[0];
  if (!row) {
    throw missing();
  }
  const history = (
    await client.query(
      `
        SELECT
          revision,
          action,
          reason,
          provider_reference AS "providerReference",
          source_verified AS "sourceVerified",
          created_at AS "createdAt"
        FROM public.experience_reviews
        WHERE experience_id = $1
        ORDER BY revision
      `,
      [id],
    )
  ).rows;
  return { ...row, history };
}

async function validateTaxonomy(client: PoolClient, draft: Draft) {
  if (
    draft.area &&
    !(
      await client.query(
        'SELECT 1 FROM public.areas WHERE code=$1 AND active',
        [draft.area],
      )
    ).rowCount
  ) {
    throw invalid('Choose an active area.');
  }
  const categories = draft.categories ?? [];
  if (
    (
      await client.query(
        `
          SELECT code
          FROM public.categories
          WHERE code = ANY ($1::text[])
            AND active
        `,
        [categories],
      )
    ).rowCount !== categories.length
  ) {
    throw invalid('Choose active categories without duplicates.');
  }
  if ((draft.minParticipants ?? 1) > (draft.maxParticipants ?? 10)) {
    throw invalid('Minimum group size cannot exceed maximum group size.');
  }
}

export async function saveDraft(
  client: PoolClient,
  userId: string,
  draft: Draft,
  requestId: string,
  id?: string,
  revision?: number,
) {
  const host = (
    await client.query(
      'SELECT id,status FROM public.hosts WHERE user_id=$1 FOR UPDATE',
      [userId],
    )
  ).rows[0];
  if (!host) {
    throw new AccountError(
      403,
      'HOST_REQUIRED',
      'Create your host profile first.',
    );
  }
  if (host.status === 'suspended') {
    throw new AccountError(
      403,
      'HOST_NOT_ELIGIBLE',
      'This host account is suspended.',
    );
  }
  let existing;
  if (id) {
    existing = (
      await client.query(
        `
          SELECT
            id,
            revision,
            status,
            policy_id
          FROM public.experiences
          WHERE id = $1
            AND host_id = $2
          FOR UPDATE
        `,
        [id, host.id],
      )
    ).rows[0];
    if (!existing) {
      throw missing();
    }
    if (existing.revision !== revision) {
      throw changed();
    }
    if (existing.status === 'review') {
      throw new AccountError(
        409,
        'EXPERIENCE_LOCKED',
        'Wait for the review decision before editing.',
      );
    }
  }
  await validateTaxonomy(client, draft);
  const experienceId = id ?? randomUUID();
  if (!id) {
    const prefix =
      draft.title
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100) || 'experience';
    await client.query(
      `
        INSERT INTO public.experiences (id, host_id, slug, title)
        VALUES
          ($1, $2, $3, $4)
      `,
      [experienceId, host.id, `${prefix}-${experienceId}`, draft.title.trim()],
    );
  }
  let policyId = existing?.policy_id ?? null;
  if (draft.policy) {
    const old = (
      await client.query(
        `
          SELECT
            cancellation,
            safety,
            participation
          FROM public.policies
          WHERE id = $1
        `,
        [policyId],
      )
    ).rows[0];
    const policy = {
      cancellation: draft.policy.cancellation.trim(),
      safety: draft.policy.safety.trim(),
      participation: draft.policy.participation.trim(),
    };
    if (
      !old ||
      Object.keys(policy).some(
        (k) => old[k] !== policy[k as keyof typeof policy],
      )
    ) {
      policyId = (
        await client.query(
          `
            INSERT INTO public.policies (
                experience_id,
                version,
                cancellation,
                safety,
                participation
              )
            SELECT
              $1,
              COALESCE(max(version), 0) + 1,
              $2,
              $3,
              $4
            FROM public.policies
            WHERE experience_id = $1
            RETURNING id
          `,
          [
            experienceId,
            policy.cancellation,
            policy.safety,
            policy.participation,
          ],
        )
      ).rows[0].id;
    }
  }
  await client.query(
    `
      UPDATE public.experiences
      SET
        title = $2,
        description = $3,
        area_code = $4,
        meeting_point = $5,
        duration_minutes = $6,
        price_paise = $7,
        min_participants = $8,
        max_participants = $9,
        difficulty = $10,
        inclusions = $11,
        exclusions = $12,
        preparation = $13,
        accessibility = $14,
        accessibility_notes = $15,
        source_kind = $16,
        source_reference = $17,
        policy_id = $18,
        status = 'draft',
        featured_rank = NULL,
        revision = revision + $19,
        updated_at = clock_timestamp()
      WHERE id = $1
    `,
    [
      experienceId,
      draft.title.trim(),
      draft.description?.trim() ?? '',
      draft.area ?? null,
      draft.meetingPoint?.trim() ?? '',
      draft.durationMinutes ?? null,
      draft.pricePaise ?? null,
      draft.minParticipants ?? 1,
      draft.maxParticipants ?? 10,
      draft.difficulty ?? 'unknown',
      draft.inclusions ?? [],
      draft.exclusions ?? [],
      draft.preparation?.trim() ?? '',
      draft.accessibility ?? 'unknown',
      draft.accessibilityNotes?.trim() ?? '',
      draft.sourceKind ?? 'direct',
      draft.sourceReference?.trim() ?? '',
      policyId,
      id ? 1 : 0,
    ],
  );
  await client.query(
    'DELETE FROM public.experience_categories WHERE experience_id=$1',
    [experienceId],
  );
  await client.query(
    `
      INSERT INTO public.experience_categories (experience_id, category_code)
      SELECT
        $1,
        unnest($2::text[])
    `,
    [experienceId, draft.categories ?? []],
  );
  await audit(
    client,
    userId,
    'experience.draft_saved',
    requestId,
    'experience',
    experienceId,
  );
  return privateDetail(client, experienceId, userId);
}

export function assertComplete(row: Awaited<ReturnType<typeof privateDetail>>) {
  if (
    !row.description ||
    !row.area ||
    !row.meetingPoint ||
    !row.durationMinutes ||
    row.pricePaise === null ||
    !row.categories.length ||
    !row.policy ||
    (row.accessibility === 'accessible' && !row.accessibilityNotes) ||
    (row.sourceKind === 'district' && !row.sourceReference)
  ) {
    throw new AccountError(
      400,
      'EXPERIENCE_INCOMPLETE',
      'Add the experience details, area, meeting point, duration, ' +
        'price, categories and all three policies. Accessible offers need ' +
        'notes; district proposals need a source.',
    );
  }
}

async function record(
  client: PoolClient,
  id: string,
  userId: string,
  action: string,
  requestId: string,
  review?: Review,
) {
  await client.query(
    `
      INSERT INTO public.experience_reviews (
          experience_id,
          revision,
          action,
          actor_id,
          reason,
          provider_reference,
          source_verified,
          snapshot
        )
      SELECT
        id,
        revision,
        $3,
        $2,
        $4,
        $5,
        $6,
        (to_jsonb(e) - 'search_document') || jsonb_build_object(
          'categories',
          ARRAY(
            SELECT category_code
            FROM public.experience_categories
            WHERE experience_id = e.id
            ORDER BY category_code
          )
        )
      FROM public.experiences e
      WHERE id = $1
    `,
    [
      id,
      userId,
      action,
      review?.reason.trim() ?? null,
      review?.providerReference?.trim() ?? null,
      review?.sourceVerified ?? false,
    ],
  );
  await audit(
    client,
    userId,
    `experience.${action}`,
    requestId,
    'experience',
    id,
  );
}

export async function submit(
  client: PoolClient,
  userId: string,
  id: string,
  revision: number,
  requestId: string,
) {
  const host = (
    await client.query(
      `
        SELECT id
        FROM public.hosts
        WHERE user_id = $1
          AND status = 'approved'
          AND approved_until > clock_timestamp()
        FOR UPDATE
      `,
      [userId],
    )
  ).rows[0];
  if (!host) {
    throw new AccountError(
      403,
      'HOST_NOT_ELIGIBLE',
      'Host approval is required before submitting an experience.',
    );
  }
  const row = await privateDetail(client, id, userId);
  if (row.revision !== revision) {
    throw changed();
  }
  if (!['draft', 'rejected', 'hidden'].includes(row.status)) {
    throw new AccountError(
      409,
      'EXPERIENCE_LOCKED',
      'Only a draft, rejected or hidden experience can be submitted.',
    );
  }
  assertComplete(row);
  await validateMedia(client, id);
  await validateTaxonomy(client, row);
  await client.query(
    `
      UPDATE public.experiences
      SET
        status = 'review',
        revision = revision + 1,
        updated_at = clock_timestamp()
      WHERE id = $1
    `,
    [id],
  );
  await record(client, id, userId, 'submitted', requestId);
  return privateDetail(client, id, userId);
}

export async function decide(
  client: PoolClient,
  userId: string,
  id: string,
  review: Review,
  requestId: string,
) {
  await requireReviewer(client, userId);
  // Avoid crossed reviewer-account locks when two admins also own experiences.
  if (
    !(
      await client.query(
        `
          SELECT pg_try_advisory_xact_lock(hashtext ('catalogue-review')) AS locked
        `,
      )
    ).rows[0].locked
  ) {
    throw new AccountError(
      409,
      'REVIEW_BUSY',
      'Another review is finishing. Try again shortly.',
    );
  }
  const owner = (
    await client.query(
      `
        SELECT h.user_id
        FROM public.experiences e
          JOIN public.hosts h ON h.id = e.host_id
        WHERE e.id = $1
      `,
      [id],
    )
  ).rows[0];
  if (!owner) {
    throw missing();
  }
  if (owner.user_id === userId) {
    throw new AccountError(
      403,
      'FORBIDDEN',
      'Another reviewer must review your experience.',
    );
  }
  if (review.action === 'published') {
    await requirePublishableHost(client, owner.user_id);
  }
  await client.query(
    'SELECT id FROM public.experiences WHERE id=$1 FOR UPDATE',
    [id],
  );
  const row = await privateDetail(client, id);
  if (row.revision !== review.revision) {
    throw changed();
  }
  if (
    review.action === 'hidden'
      ? row.status !== 'published'
      : row.status !== 'review'
  ) {
    throw new AccountError(
      409,
      'EXPERIENCE_LOCKED',
      'This decision does not match the current status.',
    );
  }
  if (review.action === 'published') {
    assertComplete(row);
    await validateMedia(client, id);
    await validateTaxonomy(client, row);
    if (
      !review.providerReference?.trim() ||
      (row.sourceKind === 'district' && review.sourceVerified !== true)
    ) {
      throw invalid(
        'Record the verified provider, and confirm the source for district proposals.',
      );
    }
  } else if (
    review.providerReference !== undefined ||
    review.sourceVerified !== undefined ||
    review.featuredRank !== undefined
  ) {
    throw invalid(
      'Verification and featured order are only accepted when publishing.',
    );
  }
  await client.query(
    `
      UPDATE public.experiences
      SET
        status = $2::text,
        revision = revision + 1,
        updated_at = clock_timestamp(),
        featured_rank = $3,
        published_at = CASE
          WHEN $2::text = 'published' THEN clock_timestamp()
          ELSE published_at
        END
      WHERE id = $1
    `,
    [
      id,
      review.action,
      review.action === 'published' ? (review.featuredRank ?? null) : null,
    ],
  );
  await record(client, id, userId, review.action, requestId, review);
  return privateDetail(client, id);
}

async function validateMedia(client: PoolClient, id: string) {
  const invalidMedia = await client.query(
    `
      SELECT 1
      FROM public.experience_media em
        JOIN public.media_assets m ON m.id = em.asset_id
      WHERE em.experience_id = $1
        AND NOT (${approvedAsset})
      LIMIT 1
    `,
    [id],
  );
  if (invalidMedia.rowCount) {
    throw invalid(
      'All attached media must be ready and approved before review.',
    );
  }
}
