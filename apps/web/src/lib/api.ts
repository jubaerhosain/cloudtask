import type {
  CreateExportResponse,
  CreateProjectRequest,
  CreateTaskRequest,
  ExportResponse,
  LoginRequest,
  LoginResponse,
  ProjectResponse,
  ProjectSummary,
  RegisterRequest,
  TaskListQuery,
  TaskListResponse,
  TaskResponse,
  UpdateProjectRequest,
  UpdateTaskRequest,
  UserPublic,
} from '@cloudtask/contracts';

import { request } from './api-client';

export const api = {
  // Auth
  register: (body: RegisterRequest) =>
    request<UserPublic>('/auth/register', { method: 'POST', body, auth: false }),
  login: (body: LoginRequest) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body, auth: false }),

  // Projects
  listProjects: () => request<ProjectResponse[]>('/projects'),
  getProject: (id: string) => request<ProjectResponse>(`/projects/${id}`),
  createProject: (body: CreateProjectRequest) =>
    request<ProjectResponse>('/projects', { method: 'POST', body }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    request<ProjectResponse>(`/projects/${id}`, { method: 'PATCH', body }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  // Tasks
  listTasks: (projectId: string, query: Partial<TaskListQuery> = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return request<TaskListResponse>(`/projects/${projectId}/tasks${qs ? `?${qs}` : ''}`);
  },
  getSummary: (projectId: string) =>
    request<ProjectSummary>(`/projects/${projectId}/summary`),
  createTask: (projectId: string, body: CreateTaskRequest) =>
    request<TaskResponse>(`/projects/${projectId}/tasks`, { method: 'POST', body }),
  updateTask: (id: string, body: UpdateTaskRequest) =>
    request<TaskResponse>(`/tasks/${id}`, { method: 'PATCH', body }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  // Exports
  requestExport: (projectId: string) =>
    request<CreateExportResponse>(`/projects/${projectId}/exports`, { method: 'POST' }),
  getExport: (id: string) => request<ExportResponse>(`/exports/${id}`),
};
