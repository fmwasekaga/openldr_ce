import { useEffect, useState } from 'react';
import { fetchReport, type ReportResult } from '../api';

export function useReport(id: string, params: Record<string, string> = {}) {
  const [state, setState] = useState<{ loading: boolean; error?: string; result?: ReportResult }>({ loading: true });
  const key = `${id}?${new URLSearchParams(params).toString()}`;
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    fetchReport(id, params)
      .then((result) => { if (active) setState({ loading: false, result }); })
      .catch((err: unknown) => { if (active) setState({ loading: false, error: err instanceof Error ? err.message : String(err) }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
