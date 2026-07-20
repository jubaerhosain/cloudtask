import { Task } from '../database/entities/task.entity';

const HEADER = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'dueDate',
  'createdAt',
  'updatedAt',
] as const;

/** Escapes a CSV field per RFC 4180 (quote if it contains ", comma, or newline). */
function escape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Renders tasks as a UTF-8, CRLF-delimited CSV (spec §6.5). */
export function tasksToCsv(tasks: Task[]): string {
  const rows = tasks.map((t) => [
    t.id,
    t.title,
    t.description ?? '',
    t.status,
    t.priority,
    t.dueDate ?? '',
    t.createdAt.toISOString(),
    t.updatedAt.toISOString(),
  ]);
  return [HEADER, ...rows]
    .map((row) => row.map((cell) => escape(String(cell))).join(','))
    .join('\r\n')
    .concat('\r\n');
}
