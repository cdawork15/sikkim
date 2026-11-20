import { joins, visible } from '../catalogue/visibility.js';

export const approvedAsset = `
  m.state = 'ready'
  AND m.moderation = 'approved'
  AND m.purpose = 'public_content'
  AND EXISTS (
    SELECT 1
    FROM public.users media_owner
    WHERE media_owner.id = m.owner_id
      AND media_owner.status = 'active'
      AND NOT media_owner.is_demo
  )
`;

export const visibleStory = `
  s.status = 'published'
  AND s.expires_at > clock_timestamp()
  AND sh.status = 'approved'
  AND sh.approved_until > clock_timestamp()
  AND su.status = 'active'
  AND NOT su.is_demo
  AND EXISTS (
    SELECT 1
    FROM public.story_items si
    WHERE si.story_id = s.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.story_items si
    JOIN public.media_assets m ON m.id = si.asset_id
    WHERE si.story_id = s.id
      AND NOT (${approvedAsset} AND m.owner_id = sh.user_id)
  )
`;

export const linkedPublicAsset = `
  ${approvedAsset}
  AND (
    EXISTS (
      SELECT 1
      ${joins}
      JOIN public.experience_media em ON em.experience_id = e.id
      WHERE em.asset_id = m.id
        AND ${visible}
    )
    OR EXISTS (
      SELECT 1
      FROM public.stories s
      JOIN public.hosts sh ON sh.id = s.host_id
      JOIN public.users su ON su.id = sh.user_id
      JOIN public.story_items si ON si.story_id = s.id
      WHERE si.asset_id = m.id
        AND ${visibleStory}
    )
  )
`;
