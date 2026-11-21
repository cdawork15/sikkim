// Small building blocks shared by the Operations workspace and the CRM views.
import type { ReactNode } from 'react';
import { bandLabels, type LeadScore } from '../api/admin';
import type { ApiClient } from '../api/client';

export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="ops-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export type Tone = 'plain' | 'ok' | 'warn' | 'red';

export function Badge({
  tone = 'plain',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={`ops-badge ${tone}`}>{children}</span>;
}

export const stageTone = (stage: string): Tone =>
  stage === 'live' || stage === 'agreed' || stage === 'onboarding'
    ? 'ok'
    : stage === 'declined'
      ? 'red'
      : stage === 'paused'
        ? 'warn'
        : 'plain';

const bandTone: Record<LeadScore['band'], Tone> = {
  hot: 'red',
  warm: 'warn',
  cold: 'plain',
  live: 'ok',
  closed: 'plain',
};

export function ScoreBadge({ score }: { score: LeadScore }) {
  return (
    <Badge tone={bandTone[score.band]}>
      <span className="sr-only">Lead score </span>
      {score.score} · {bandLabels[score.band]}
    </Badge>
  );
}

/** Fetches a private file with the session token and saves it. */
export async function downloadFile(
  api: ApiClient,
  path: string,
  filename: string,
) {
  const file = await api.request<Blob>(path, {
    private: true,
    responseType: 'blob',
  });
  const url = URL.createObjectURL(file.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
