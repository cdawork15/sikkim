export const visible = `
  e.status = 'published'
  AND e.policy_id IS NOT NULL
  AND h.status = 'approved'
  AND h.approved_until > clock_timestamp()
  AND u.status = 'active'
  AND NOT u.is_demo
  AND a.active
  AND EXISTS (
    SELECT 1
    FROM public.experience_categories ec
    JOIN public.categories c ON c.code = ec.category_code
    WHERE ec.experience_id = e.id AND c.active
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.experience_categories ec
    JOIN public.categories c ON c.code = ec.category_code
    WHERE ec.experience_id = e.id AND NOT c.active
  )
`;

export const joins = `
  FROM public.experiences e
  JOIN public.hosts h ON h.id = e.host_id
  JOIN public.users u ON u.id = h.user_id
  JOIN public.areas a ON a.code = e.area_code
`;
