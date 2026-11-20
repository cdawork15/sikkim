import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError } from './client';
import type { Envelope } from './types';

const Context = createContext<ApiClient | null>(null);
export function ApiProvider({
  children,
  client,
}: {
  children: ReactNode;
  client?: ApiClient;
}) {
  const [instance] = useState(
    () => client ?? new ApiClient(import.meta.env.VITE_API_BASE_URL || '/v1'),
  );
  return <Context.Provider value={instance}>{children}</Context.Provider>;
}
export function useApi() {
  const client = useContext(Context);
  if (!client) throw new Error('API provider is missing');
  return client;
}
export function useSession() {
  const client = useApi();
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}
export function useResource<T>(path: string | null, privateRequest = false) {
  const client = useApi();
  const session = useSession();
  const [revision, setRevision] = useState(0);
  const key = `${path}:${privateRequest ? session.generation : ''}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    result?: Envelope<T>;
    error?: Error;
  }>({ key: '' });
  useEffect(() => {
    if (!path || (privateRequest && !session.user)) return;
    const controller = new AbortController();
    void client
      .request<T>(path, { private: privateRequest, signal: controller.signal })
      .then(
        (result) => {
          if (!controller.signal.aborted) setState({ key, result });
        },
        (error) => {
          if (!controller.signal.aborted) setState({ key, error });
        },
      );
    return () => controller.abort();
  }, [client, path, privateRequest, key, session.user?.id]);
  const current = state.key === key ? state : undefined;
  return {
    data: current?.result?.data,
    page: current?.result?.page,
    error: current?.error,
    loading: !!path && !(privateRequest && !session.user) && !current,
    reload: () => setRevision((value) => value + 1),
    replace: (data: T) => setState({ key, result: { data } }),
  };
}
export function useAction() {
  const client = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(task: () => Promise<void>, success = '') {
    if (lock.current) return;
    lock.current = true;
    const generation = client.getSnapshot().generation;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      await task();
      if (mounted.current && generation === client.getSnapshot().generation)
        setMessage(success);
    } catch (failure) {
      if (mounted.current && generation === client.getSnapshot().generation)
        setError(
          failure instanceof Error
            ? failure
            : new ApiError(0, 'FAILED', 'Please try again.'),
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, message, run };
}
