import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAction, useApi, useResource, useSession } from '../api/react';
import { Icon } from '../components/Icon';

type State = { id: string; saved: boolean; liked: boolean; likeCount: number };

export function useExperienceActions(ids: string[]) {
  const api = useApi();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const action = useAction();
  const key = [...new Set(ids)].sort().slice(0, 50).join(',');
  const result = useResource<State[]>(
    key && session.user ? '/me/experience-actions?ids=' + key : null,
    true,
  );
  function toggle(id: string, kind: 'saved' | 'liked') {
    if (!session.user) {
      navigate(
        '/welcome?next=' +
          encodeURIComponent(location.pathname + location.search),
      );
      return;
    }
    const state = result.data?.find((item) => item.id === id);
    if (!state) return;
    void action.run(async () => {
      await api.request(
        `/me/${kind === 'saved' ? 'saved' : 'likes'}/experiences/${id}`,
        {
          method: state[kind] ? 'DELETE' : 'PUT',
          private: true,
        },
      );
      if (api.getSnapshot().generation === session.generation) result.reload();
    });
  }
  return {
    states: result.data ?? [],
    toggle,
    busy: action.busy || result.loading,
    error: action.error ?? result.error,
    retry: result.reload,
  };
}

export function ExperienceActions({
  id,
  compact = false,
}: {
  id: string;
  compact?: boolean;
}) {
  const actions = useExperienceActions([id]);
  const state = actions.states.find((item) => item.id === id);
  return (
    <div
      className={`experience-actions ${compact ? 'reel-social-actions' : ''}`}
    >
      <button
        className="button button-secondary"
        disabled={actions.busy}
        aria-pressed={state?.saved ?? false}
        onClick={() => actions.toggle(id, 'saved')}
      >
        <Icon name="bookmark" size={compact ? 26 : 20} />
        <span className={compact ? 'sr-only' : ''}>
          {state?.saved ? 'Saved' : 'Save'}
        </span>
      </button>
      <button
        className="button button-secondary"
        disabled={actions.busy}
        aria-pressed={state?.liked ?? false}
        aria-label={`${state?.liked ? 'Liked' : 'Like'}${state ? ' ' + state.likeCount : ''}`}
        onClick={() => actions.toggle(id, 'liked')}
      >
        <Icon name="heart" size={compact ? 26 : 20} />
        <span className={compact ? 'sr-only' : ''}>
          {state?.liked ? 'Liked' : 'Like'}
        </span>
        {state && <span>{state.likeCount}</span>}
      </button>
      {state?.saved && !compact && (
        <Link className="text-link" to="/saved">
          View saved experiences
        </Link>
      )}
      {actions.error && (
        <p role="alert">
          {actions.error.message}
          <button className="text-link" onClick={actions.retry}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
