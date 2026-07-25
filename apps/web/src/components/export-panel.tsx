'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { Alert, Button, Card } from './ui';

export function ExportPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [exportId, setExportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: () => api.requestExport(projectId),
    onSuccess: (res) => {
      setError(null);
      setExportId(res.exportId);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not start export'),
  });

  const { data: job } = useQuery({
    queryKey: ['export', exportId],
    queryFn: () => api.getExport(exportId as string),
    enabled: exportId !== null,
    // Poll until the job reaches a terminal state.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 1500;
    },
  });

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => requestMutation.mutate()} disabled={requestMutation.isPending}>
          {requestMutation.isPending ? 'Requesting…' : 'Export CSV'}
        </Button>
        {job ? (
          <span className="text-sm" data-testid="export-status">
            Status: <span className="font-medium">{job.status}</span>
          </span>
        ) : null}
        {job?.status === 'completed' && job.downloadUrl ? (
          <a
            href={job.downloadUrl}
            className="text-sm font-medium text-blue-600 underline"
            data-testid="export-download"
          >
            Download CSV
          </a>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {job?.status === 'failed' ? <Alert>Export failed. Please try again.</Alert> : null}
    </Card>
  );
}
