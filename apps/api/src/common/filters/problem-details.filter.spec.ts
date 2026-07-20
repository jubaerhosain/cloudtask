import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';

import { ProblemDetailsFilter } from './problem-details.filter';

interface CapturedResponse {
  status: jest.Mock;
  type: jest.Mock;
  json: jest.Mock;
}

function mockResponse(): CapturedResponse {
  const json = jest.fn();
  const type = jest.fn().mockReturnValue({ json });
  const status = jest.fn().mockReturnValue({ type });
  return { status, type, json };
}

function mockHost(req: unknown, res: unknown): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();
  const req = { id: 'req-123', url: '/api/v1/projects/1', originalUrl: '/api/v1/projects/1' };

  it('formats an HttpException as RFC 7807 with the requestId', () => {
    const res = mockResponse();
    filter.catch(new NotFoundException('Project was not found'), mockHost(req, res));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.type).toHaveBeenCalledWith('application/problem+json');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('/problems/not-found'),
        title: 'Not Found',
        status: 404,
        detail: 'Project was not found',
        instance: '/api/v1/projects/1',
        requestId: 'req-123',
      }),
    );
  });

  it('hides internals for unknown errors and logs them', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = mockResponse();

    filter.catch(new Error('secret database connection string leaked'), mockHost(req, res));

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual(
      expect.objectContaining({ status: 500, detail: 'An unexpected error occurred' }),
    );
    expect(JSON.stringify(body)).not.toContain('secret database connection string');
    expect(logSpy).toHaveBeenCalled();
  });
});
