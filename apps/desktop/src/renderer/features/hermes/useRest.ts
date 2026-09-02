import { useCallback, useEffect, useState } from 'react';

/** Read a dashboard REST resource with a manual reload. */
export function useRest<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    window.hermes.rest
      .get<T>(path)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(String(e)));
  }, [path]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}
