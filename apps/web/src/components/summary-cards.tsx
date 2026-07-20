'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { Card } from './ui';

export function SummaryCards({ projectId }: { projectId: string }): React.ReactElement {
  const { data } = useQuery({
    queryKey: ['summary', projectId],
    queryFn: () => api.getSummary(projectId),
  });

  const cells: { label: string; value: number }[] = [
    { label: 'Total', value: data?.total ?? 0 },
    { label: 'To do', value: data?.todo ?? 0 },
    { label: 'In progress', value: data?.inProgress ?? 0 },
    { label: 'Done', value: data?.done ?? 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((cell) => (
        <Card key={cell.label} className="text-center">
          <p className="text-2xl font-bold">{cell.value}</p>
          <p className="text-xs opacity-70">{cell.label}</p>
        </Card>
      ))}
    </div>
  );
}
