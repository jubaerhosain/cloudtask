'use client';

import { createProjectSchema, type CreateProjectRequest } from '@cloudtask/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, Button, Field, Input, Spinner, Textarea } from '../../../components/ui';
import { api } from '../../../lib/api';
import { ApiError } from '../../../lib/api-client';
import { useRequireAuth } from '../../../lib/use-session';

export default function NewProjectPage(): React.ReactElement {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectRequest>({ resolver: zodResolver(createProjectSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const project = await api.createProject(values);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      router.replace(`/projects/${project.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create project');
    }
  });

  if (!ready) return <Spinner />;

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4">
      <h1 className="text-2xl font-bold">New project</h1>
      {formError ? <Alert>{formError}</Alert> : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" error={errors.name?.message}>
          <Input {...register('name')} />
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <Textarea rows={3} {...register('description')} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
