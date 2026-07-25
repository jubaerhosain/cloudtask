'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { Button, Card, Spinner, Alert } from '../../components/ui';
import { api } from '../../lib/api';
import { useRequireAuth } from '../../lib/use-session';

export default function ProjectsPage(): React.ReactElement {
  const { ready } = useRequireAuth();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['projects'],
    queryFn: api.listProjects,
    enabled: ready,
  });

  if (!ready) return <Spinner />;

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link href="/projects/new">
          <Button>New project</Button>
        </Link>
      </div>

      {isLoading ? <Spinner /> : null}
      {isError ? <Alert>{(error as Error).message}</Alert> : null}

      {data && data.length === 0 ? (
        <Card>
          <p className="text-sm opacity-70">No projects yet. Create your first one.</p>
        </Card>
      ) : null}

      <ul className="space-y-2">
        {data?.map((project) => (
          <li key={project.id}>
            <Link href={`/projects/${project.id}`}>
              <Card className="hover:border-blue-400">
                <p className="font-medium">{project.name}</p>
                {project.description ? (
                  <p className="text-sm opacity-70">{project.description}</p>
                ) : null}
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
