import { useCallback, useEffect, useState } from "react";
import { Report } from "@medical-report-system/shared";
import { api } from "../api/client";
import axios from "axios";

function is404(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

export function useReport(reportId?: string) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);

    try {
      // 1) Try fetching by report ID
      const response = await api.get<Report>(`/reports/${reportId}`).catch(async (err) => {
        if (!is404(err)) throw err;
        // 2) Try fetching by study ID
        return api.get<Report>(`/reports/by-study/${reportId}`);
      });
      setReport(response.data);
    } catch (err) {
      if (is404(err)) {
        // 3) No report exists for this study — auto-create a draft
        try {
          const createResponse = await api.post<Report>("/reports", { studyId: reportId });
          setReport(createResponse.data);
        } catch (createErr) {
          setError((createErr as Error).message);
        }
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { report, loading, error, refresh };
}
