'use client';

import type { TaskResponse, TaskStatus } from '@cloudtask/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import { Button, Card, Select } from './ui';

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export function TaskTable({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: TaskResponse[];
}): React.ReactElement {
  const queryClient = useQueryClient();

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['summary', projectId] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      api.updateTask(id, { status }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: invalidate,
  });

  const onDelete = (task: TaskResponse): void => {
    if (window.confirm(`Delete task “${task.title}”?`)) deleteMutation.mutate(task.id);
  };

  if (tasks.length === 0) {
    return (
      <Card>
        <p className="text-sm opacity-70">No tasks match the current filters.</p>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th className="p-2">Title</th>
            <th className="p-2">Status</th>
            <th className="p-2">Priority</th>
            <th className="p-2">Due</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-b border-gray-100 dark:border-gray-800">
              <td className="p-2 font-medium">{task.title}</td>
              <td className="p-2">
                <Select
                  value={task.status}
                  onChange={(e) =>
                    statusMutation.mutate({ id: task.id, status: e.target.value as TaskStatus })
                  }
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="p-2 capitalize">{task.priority}</td>
              <td className="p-2">{task.dueDate ?? '—'}</td>
              <td className="p-2 text-right">
                <Button variant="danger" onClick={() => onDelete(task)}>
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
