import { useEffect, useRef, useState } from "react";
import { type AuthorSubmission, api } from "../../../api";

export function useDraftCoverAndHistory(projectId: string, workingRevisionId: string | null) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverNonce, setCoverNonce] = useState(0);
  const [submissions, setSubmissions] = useState<AuthorSubmission[]>([]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [historyNonce, setHistoryNonce] = useState(0);
  const coverRequest = useRef<{ generation: number } | null>(null);
  const historyRequest = useRef<{ generation: number } | null>(null);

  useEffect(() => {
    let active = true;
    const request = { generation: coverNonce };
    coverRequest.current = request;
    let objectUrl: string | null = null;
    if (!workingRevisionId) {
      setCoverUrl(null);
      return;
    }
    api
      .authorCover(projectId, workingRevisionId)
      .then((blob) => {
        if (!active || coverRequest.current !== request) return;
        objectUrl = URL.createObjectURL(blob);
        setCoverUrl(objectUrl);
      })
      .catch(() => {
        if (active && coverRequest.current === request) setCoverUrl(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, workingRevisionId, coverNonce]);

  useEffect(() => {
    let active = true;
    const request = { generation: historyNonce };
    historyRequest.current = request;
    api
      .authorSubmissions(projectId)
      .then((response) => {
        if (!active || historyRequest.current !== request) return;
        setSubmissions(response.items);
        setSubmissionError(null);
      })
      .catch((reason: unknown) => {
        if (!active || historyRequest.current !== request) return;
        setSubmissions([]);
        setSubmissionError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId, historyNonce]);

  return { coverUrl, setCoverNonce, submissions, submissionError, setHistoryNonce };
}
