'use client';

import { updateProjectSchema, type UpdateProjectRequest } from '@cloudtask/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, Button, Field, Input, Spinner, Textarea } from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { ApiError } from '../../../../lib/api-client';
import { useRequireAuth } from '../../../../lib/use-session';

export default function EditProjectPage(): React.ReactElement {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = String(useParams().projectId);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: ready,
  });

  const { register, handleSubmit, reset, formState } = useForm<UpdateProjectRequest>({
    resolver: zodResolver(updateProjectSchema),
  });

  useEffect(() => {
    if (project) reset({ name: project.name, description: project.description ?? '' });
  }, [project, reset]);

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteProject(projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      router.replace('/projects');
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.updateProject(projectId, values);
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      router.replace(`/projects/${projectId}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not update project');
    }
  });

  const onDelete = (): void => {
    if (window.confirm('Delete this project and all its tasks? This cannot be undone.')) {
      deleteMutation.mutate();
    }
  };

  if (!ready || isLoading) return <Spinner />;

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4">
      <h1 className="text-2xl font-bold">Edit project</h1>
      {formError ? <Alert>{formError}</Alert> : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" error={formState.errors.name?.message}>
          <Input {...register('name')} />
        </Field>
        <Field label="Description" error={formState.errors.description?.message}>
          <Textarea rows={3} {...register('description')} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={formState.isSubmitting}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
      <hr className="border-gray-200 dark:border-gray-700" />
      <Button variant="danger" onClick={onDelete} disabled={deleteMutation.isPending}>
        {deleteMutation.isPending ? 'Deleting…' : 'Delete project'}
      </Button>
    </div>
  );
}
