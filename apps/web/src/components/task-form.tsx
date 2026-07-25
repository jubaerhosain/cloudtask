'use client';

import { createTaskSchema, type CreateTaskRequest } from '@cloudtask/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { api } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { Alert, Button, Field, Input, Select } from './ui';

export function TaskForm({ projectId }: { projectId: string }): React.ReactElement {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTaskRequest>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { status: 'todo', priority: 'medium' },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateTaskRequest) => api.createTask(projectId, values),
    onSuccess: async () => {
      reset({ title: '', description: '', status: 'todo', priority: 'medium', dueDate: '' });
      await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['summary', projectId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create task'),
  });

  const onSubmit = handleSubmit((values) => {
    setError(null);
    mutation.mutate(values);
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="font-semibold">Add task</h2>
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Title" error={errors.title?.message}>
        <Input {...register('title')} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="Status">
          <Select {...register('status')}>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select {...register('priority')}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <Field label="Due date" error={errors.dueDate?.message}>
          <Input
            type="date"
            {...register('dueDate', { setValueAs: (v: string) => (v === '' ? undefined : v) })}
          />
        </Field>
      </div>
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Adding…' : 'Add task'}
      </Button>
    </form>
  );
}
