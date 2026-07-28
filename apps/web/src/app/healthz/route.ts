import { NextResponse } from 'next/server';

/**
 * Liveness probe for the web service — the ALB web target group polls this.
 *
 * Deliberately NOT under /api/: the ALB listener routes /api/* to the api
 * service, which would shadow this route for any traffic arriving through the
 * load balancer. /healthz falls through to the web target group instead.
 *
 * Static-render is disabled so the response is produced by the running server
 * on every request; a prerendered file would keep returning 200 from the CDN
 * layer even if the Node process were wedged.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    { status: 'ok' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
