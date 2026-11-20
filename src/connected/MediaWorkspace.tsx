import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAction, useApi, useResource, useSession } from '../api/react';
import type { OwnedExperience } from '../api/types';
import { ErrorNotice, Loading, PagedList, RequireAccount } from './shared';

type Asset = {
  id: string;
  revision: number;
  purpose: string;
  kind: 'image' | 'video';
  state: string;
  moderation: string;
  author: string;
  sourceUrl: string;
  licenceUrl: string;
  permissionNote: string;
  place: string;
  altText: string;
  failureCode: string | null;
  reviewReason: string | null;
  variants: string[];
  uploadUrl: string | null;
};
type Placement = { assetId: string; purpose: 'gallery' | 'cover' | 'reel' };
type Frame = { assetId: string; caption: string };
type Story = {
  id: string;
  title: string;
  revision: number;
  status: string;
  frames: Frame[];
};

function privateMediaPath(value: string) {
  if (!/^\/v1\/me\/media\/[0-9a-f-]+\//i.test(value))
    throw new Error('Invalid media link.');
  return value.slice(3);
}
function AssetTile({
  asset: initial,
  admin,
  changed,
}: {
  asset: Asset;
  admin: boolean;
  changed: () => void;
}) {
  const api = useApi();
  const { generation } = useSession();
  const action = useAction();
  const result = useResource<Asset>(
    !admin && ['uploading', 'processing'].includes(initial.state)
      ? '/me/media/' + initial.id
      : null,
    true,
  );
  const asset = result.data ?? initial;
  const [preview, setPreview] = useState<string>();
  const previewRef = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);
  useEffect(() => {
    if (!['uploading', 'processing'].includes(asset.state)) return;
    const timer = setTimeout(result.reload, 1500);
    return () => clearTimeout(timer);
  }, [asset, result.data]);
  async function showPreview() {
    const variant = asset.kind === 'video' ? 'video' : 'image';
    const link = await api.request<{ url: string }>(
      `/me/media/${asset.id}/${variant}/preview`,
      {
        method: 'POST',
        private: true,
      },
    );
    const blob = await api.request<Blob>(privateMediaPath(link.data.url), {
      private: true,
      responseType: 'blob',
    });
    if (!mounted.current || generation !== api.getSnapshot().generation) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(blob.data);
    previewRef.current = url;
    setPreview(url);
  }
  return (
    <section className="api-panel api-form media-asset">
      <h2>{asset.altText}</h2>
      <p>
        {asset.state} · {asset.moderation} · {asset.purpose.replace('_', ' ')}
      </p>
      <p>
        {asset.author} · {asset.place}
      </p>
      <p>
        <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
        {' · '}
        <a href={asset.licenceUrl} target="_blank" rel="noreferrer">
          Licence
        </a>
      </p>
      {admin && <p>{asset.permissionNote}</p>}
      {asset.reviewReason && <p>Review: {asset.reviewReason}</p>}
      {asset.failureCode && (
        <p>
          Processing failed. Check the file and captions, then retry or remove
          it.
        </p>
      )}
      <ErrorNotice error={action.error ?? result.error} />
      {asset.state === 'ready' && (
        <button
          className="button button-secondary"
          disabled={action.busy}
          onClick={() => void action.run(showPreview)}
        >
          Preview file
        </button>
      )}
      {preview &&
        (asset.kind === 'video' ? (
          <video
            src={preview}
            controls
            playsInline
            aria-label={asset.altText}
          />
        ) : (
          <img src={preview} alt={asset.altText} />
        ))}
      {admin && asset.state === 'ready' && (
        <form
          className="api-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void action.run(async () => {
              await api.request(`/admin/media/${asset.id}/decisions`, {
                method: 'POST',
                private: true,
                body: {
                  revision: asset.revision,
                  action: form.get('decision'),
                  reason: form.get('reason'),
                },
              });
              changed();
            });
          }}
        >
          <label>
            Decision
            <select name="decision">
              <option value="rejected">Reject / remove approval</option>
              <option value="approved">Approve</option>
            </select>
          </label>
          <label>
            Reason
            <textarea name="reason" required maxLength={1000} />
          </label>
          <button className="button button-primary" disabled={action.busy}>
            Save decision
          </button>
        </form>
      )}
      {!admin && (
        <div className="experience-actions">
          {asset.state === 'failed' && (
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.request(`/me/media/${asset.id}/retry`, {
                    method: 'POST',
                    private: true,
                    body: { revision: asset.revision },
                  });
                  changed();
                })
              }
            >
              Retry processing
            </button>
          )}
          {!['uploading', 'processing'].includes(asset.state) && (
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.request(`/me/media/${asset.id}/remove`, {
                    method: 'POST',
                    private: true,
                    body: { revision: asset.revision },
                  });
                  changed();
                })
              }
            >
              Remove file
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function MediaWorkspace({ admin = false }: { admin?: boolean }) {
  const api = useApi();
  const action = useAction();
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((value) => value + 1);
  return (
    <div className="page interior-page media-workspace">
      <RequireAccount admin={admin}>
        <Link to={admin ? '/review' : '/hosting'}>← Workspace</Link>
        <h1>{admin ? 'Review photos and videos' : 'Your photos and videos'}</h1>
        {!admin && (
          <>
            <p>Local testing only. Do not upload real identity documents.</p>
            <form
              className="api-panel api-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void action.run(async () => {
                  const file = data.get('file') as File;
                  if (!file?.size)
                    throw new Error('Choose a photo or a video.');
                  const captions = data.get('captions') as File;
                  if (captions?.size > 20000)
                    throw new Error('Captions must be 20 KB or smaller.');
                  const intent = await api.request<Asset>('/me/media', {
                    method: 'POST',
                    private: true,
                    body: {
                      purpose: data.get('purpose'),
                      contentType: file.type,
                      bytes: file.size,
                      author: data.get('author'),
                      sourceUrl: data.get('sourceUrl'),
                      licenceUrl: data.get('licenceUrl'),
                      permissionNote: data.get('permissionNote'),
                      place: data.get('place'),
                      altText: data.get('altText'),
                      ...(file.type.startsWith('video/')
                        ? { captions: await captions.text() }
                        : {}),
                    },
                  });
                  try {
                    await api.request(
                      privateMediaPath(intent.data.uploadUrl!),
                      { method: 'PUT', private: true, body: file },
                    );
                    form.reset();
                  } finally {
                    changed();
                  }
                }, 'Upload received. Processing will finish shortly.');
              }}
            >
              <label>
                Who can see this?
                <select name="purpose">
                  <option value="public_content">Public after approval</option>
                  <option value="private_evidence">
                    Private test evidence
                  </option>
                </select>
              </label>
              <label>
                Photo or video
                <input
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                  required
                />
              </label>
              <p>Images: up to 10 MB. Videos: up to 50 MB and 60 seconds.</p>
              <label>
                English captions for videos (.vtt)
                <input name="captions" type="file" accept=".vtt,text/vtt" />
              </label>
              {(
                [
                  'author',
                  'sourceUrl',
                  'licenceUrl',
                  'place',
                  'altText',
                ] as const
              ).map((name) => (
                <label key={name}>
                  {
                    {
                      author: 'Creator’s name',
                      sourceUrl: 'Original source link',
                      licenceUrl: 'Licence link',
                      place: 'Where was this recorded?',
                      altText: 'Describe the photo or video',
                    }[name]
                  }
                  <input
                    name={name}
                    type={name.endsWith('Url') ? 'url' : 'text'}
                    required
                    maxLength={
                      name.endsWith('Url')
                        ? 2000
                        : name === 'altText'
                          ? 500
                          : 160
                    }
                  />
                </label>
              ))}
              <label>
                Why can we use this? Include the permission or licence details.
                <textarea name="permissionNote" required maxLength={2000} />
              </label>
              <ErrorNotice error={action.error} />
              {action.message && <p role="status">{action.message}</p>}
              <button className="button button-primary" disabled={action.busy}>
                {action.busy ? 'Uploading…' : 'Upload file'}
              </button>
            </form>
          </>
        )}
        <PagedList<Asset>
          key={revision}
          path={admin ? '/admin/media' : '/me/media'}
          privateRequest
          render={(asset) => (
            <AssetTile asset={asset} admin={admin} changed={changed} />
          )}
        />
      </RequireAccount>
    </div>
  );
}

function MediaPicker({
  selected,
  toggle,
}: {
  selected: string[];
  toggle: (asset: Asset) => void;
}) {
  return (
    <details className="api-panel">
      <summary>Choose your ready photos and videos</summary>
      <Link to="/hosting/media">Upload a new file</Link>
      <PagedList<Asset>
        path="/me/media"
        privateRequest
        render={(asset) =>
          asset.state === 'ready' && asset.purpose === 'public_content' ? (
            <label className="api-panel">
              <input
                type="checkbox"
                checked={selected.includes(asset.id)}
                onChange={() => toggle(asset)}
              />
              {asset.altText} · {asset.kind} · {asset.moderation}
            </label>
          ) : (
            <p>
              {asset.altText} · {asset.state}
            </p>
          )
        }
      />
    </details>
  );
}

export function ExperienceMediaEditor() {
  const { id = '' } = useParams();
  const experience = useResource<OwnedExperience>(
    '/me/experiences/' + id,
    true,
  );
  const media = useResource<Placement[]>(
    '/me/experiences/' + id + '/media',
    true,
  );
  return (
    <div className="page interior-page">
      <RequireAccount>
        <Link to={'/hosting/experiences/' + id}>← Experience</Link>
        <h1>Experience photos and reel</h1>
        {(experience.loading || media.loading) && <Loading />}
        <ErrorNotice error={experience.error ?? media.error} />
        {experience.data && media.data && (
          <Placements
            key={experience.data.revision}
            experience={experience.data}
            initial={media.data}
            reload={() => {
              experience.reload();
              media.reload();
            }}
          />
        )}
      </RequireAccount>
    </div>
  );
}
function Placements({
  experience,
  initial,
  reload,
}: {
  experience: OwnedExperience;
  initial: Placement[];
  reload: () => void;
}) {
  const [items, setItems] = useState(initial);
  const api = useApi();
  const action = useAction();
  return (
    <>
      <p>Changing media returns this experience to draft for a fresh review.</p>
      <MediaPicker
        selected={items.map((item) => item.assetId)}
        toggle={(asset) =>
          setItems((current) =>
            current.some((item) => item.assetId === asset.id)
              ? current.filter((item) => item.assetId !== asset.id)
              : current.length < 12
                ? [
                    ...current,
                    {
                      assetId: asset.id,
                      purpose: asset.kind === 'video' ? 'reel' : 'gallery',
                    },
                  ]
                : current,
          )
        }
      />
      <ol className="api-form">
        {items.map((item, index) => (
          <li key={item.assetId}>
            <label>
              Media {index + 1}
              <select
                value={item.purpose}
                onChange={(event) =>
                  setItems((values) =>
                    values.map((row) =>
                      row.assetId === item.assetId
                        ? {
                            ...row,
                            purpose: event.target.value as Placement['purpose'],
                          }
                        : row,
                    ),
                  )
                }
              >
                <option value="gallery">Gallery</option>
                <option value="cover">Cover photo</option>
                <option value="reel">Reel</option>
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={index === 0}
              onClick={() =>
                setItems((values) => {
                  const next = [...values];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  return next;
                })
              }
            >
              Move up
            </button>
          </li>
        ))}
      </ol>
      <ErrorNotice error={action.error} />
      <button
        className="button button-primary"
        disabled={action.busy || experience.status === 'review'}
        onClick={() =>
          void action.run(async () => {
            await api.request(`/me/experiences/${experience.id}/media`, {
              method: 'PUT',
              private: true,
              body: { revision: experience.revision, items },
            });
            reload();
          })
        }
      >
        Save media order
      </button>
    </>
  );
}

export function StoryWorkspace() {
  const api = useApi();
  const action = useAction();
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<Story>();
  const [title, setTitle] = useState('');
  const [frames, setFrames] = useState<Frame[]>([]);
  const reload = () => setRevision((value) => value + 1);
  return (
    <div className="page interior-page">
      <RequireAccount>
        <Link to="/hosting">← Host workspace</Link>
        <h1>Your Community stories</h1>
        <p>
          Stories stay in Community for 24 hours. Publishing needs an approved
          host and approved media.
        </p>
        <form
          className="api-panel api-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await api.request(
                '/me/stories' + (editing ? '/' + editing.id : ''),
                {
                  method: editing ? 'PUT' : 'POST',
                  private: true,
                  body: {
                    title,
                    frames,
                    ...(editing ? { revision: editing.revision } : {}),
                  },
                },
              );
              setEditing(undefined);
              setTitle('');
              setFrames([]);
              reload();
            }, 'Story draft saved.');
          }}
        >
          <label>
            Story title
            <input
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <MediaPicker
            selected={frames.map((frame) => frame.assetId)}
            toggle={(asset) =>
              setFrames((current) =>
                current.some((frame) => frame.assetId === asset.id)
                  ? current.filter((frame) => frame.assetId !== asset.id)
                  : current.length < 8
                    ? [...current, { assetId: asset.id, caption: '' }]
                    : current,
              )
            }
          />
          {frames.map((frame, index) => (
            <div key={frame.assetId}>
              <label>
                Frame {index + 1} caption
                <input
                  maxLength={500}
                  value={frame.caption}
                  onChange={(event) =>
                    setFrames((values) =>
                      values.map((row) =>
                        row.assetId === frame.assetId
                          ? { ...row, caption: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                disabled={index === 0}
                onClick={() =>
                  setFrames((values) => {
                    const next = [...values];
                    [next[index - 1], next[index]] = [
                      next[index]!,
                      next[index - 1]!,
                    ];
                    return next;
                  })
                }
              >
                Move up
              </button>
            </div>
          ))}
          <button className="button button-primary" disabled={action.busy}>
            {editing ? 'Save changes' : 'Save story draft'}
          </button>
          {editing && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setEditing(undefined);
                setTitle('');
                setFrames([]);
              }}
            >
              Cancel editing
            </button>
          )}
        </form>
        <ErrorNotice error={action.error} />
        {action.message && <p role="status">{action.message}</p>}
        <PagedList<Story>
          key={revision}
          path="/me/stories"
          privateRequest
          render={(story) => (
            <section className="api-panel">
              <h2>{story.title}</h2>
              <p>{story.status}</p>
              <div className="experience-actions">
                {story.status === 'draft' && (
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setEditing(story);
                      setTitle(story.title);
                      setFrames(story.frames);
                    }}
                  >
                    Edit draft
                  </button>
                )}
                {story.status !== 'hidden' && (
                  <button
                    className="button button-primary"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await api.request(
                          `/me/stories/${story.id}/${story.status === 'draft' ? 'publish' : 'hide'}`,
                          {
                            method: 'POST',
                            private: true,
                            body: { revision: story.revision },
                          },
                        );
                        reload();
                      })
                    }
                  >
                    {story.status === 'draft'
                      ? 'Publish for 24 hours'
                      : 'Hide story'}
                  </button>
                )}
              </div>
            </section>
          )}
        />
      </RequireAccount>
    </div>
  );
}
