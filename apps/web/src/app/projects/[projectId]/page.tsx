'use client';

import type { TaskPriority, TaskStatus } from '@cloudtask/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { ExportPanel } from '../../../components/export-panel';
import { SummaryCards } from '../../../components/summary-cards';
import { TaskForm } from '../../../components/task-form';
import { TaskTable } from '../../../components/task-table';
import { Alert, Button, Input, Select, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/use-session';

interface Filters {
  status?: TaskStatus;
  priority?: TaskPriority;
  search: string;
}

export default function ProjectDetailPage(): React.ReactElement {
  const { ready } = useRequireAuth();
  const projectId = String(useParams().projectId);
  const [filters, setFilters] = useState<Filters>({ search: '' });

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: ready,
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks', projectId, filters],
    queryFn: () =>
      api.listTasks(projectId, {
        status: filters.status,
        priority: filters.priority,
        search: filters.search || undefined,
      }),
    enabled: ready,
  });

  if (!ready) return <Spinner />;
  if (projectQuery.isLoading) return <Spinner />;
  if (projectQuery.isError) return <Alert>{(projectQuery.error as Error).message}</Alert>;

  const project = projectQuery.data!;

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {project.description ? <p className="opacity-70">{project.description}</p> : null}
        </div>
        <div className="flex gap-2">
          <Link href={`/projects/${projectId}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
          <Link href="/projects">
            <Button variant="secondary">Back</Button>
          </Link>
        </div>
      </div>

      <SummaryCards projectId={projectId} />
      <ExportPanel projectId={projectId} />
      <TaskForm projectId={projectId} />

      <section className="space-y-3">
        <h2 className="font-semibold">Tasks</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Status</span>
            <Select
              value={filters.status ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: (e.target.value || undefined) as TaskStatus }))
              }
            >
              <option value="">All</option>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Priority</span>
            <Select
              value={filters.priority ?? ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  priority: (e.target.value || undefined) as TaskPriority,
                }))
              }
            >
              <option value="">All</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Search</span>
            <Input
              placeholder="Search by title"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </label>
        </div>

        {tasksQuery.isLoading ? (
          <Spinner />
        ) : tasksQuery.isError ? (
          <Alert>{(tasksQuery.error as Error).message}</Alert>
        ) : (
          <TaskTable projectId={projectId} tasks={tasksQuery.data?.items ?? []} />
        )}
      </section>
    </div>
  );
}
