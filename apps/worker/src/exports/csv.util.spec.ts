import { tasksToCsv } from './csv.util';
import { Task } from '../database/entities/task.entity';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    projectId: 'proj-1',
    ownerId: 'user-1',
    title: 'Title',
    description: null,
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('tasksToCsv', () => {
  it('emits only the header row for no tasks', () => {
    const csv = tasksToCsv([]);
    expect(csv).toBe('id,title,description,status,priority,dueDate,createdAt,updatedAt\r\n');
  });

  it('renders a task row with ISO timestamps and blanks for nulls', () => {
    const csv = tasksToCsv([makeTask({ id: 'abc', title: 'Do it', status: 'done', priority: 'high' })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,title,description,status,priority,dueDate,createdAt,updatedAt');
    expect(lines[1]).toBe(
      'abc,Do it,,done,high,,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z',
    );
  });

  it('escapes fields containing commas, quotes, and newlines', () => {
    const csv = tasksToCsv([
      makeTask({ title: 'a,b', description: 'has "quotes"\nand newline' }),
    ]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"has ""quotes""\nand newline"');
  });
});
