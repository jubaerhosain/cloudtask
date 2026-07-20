/** Base URI for RFC 7807 problem `type` values. */
export const PROBLEM_TYPE_BASE = 'https://cloudtask.example/problems';

/** Reflector metadata key marking a route as public (skips the JWT guard). */
export const IS_PUBLIC_KEY = 'cloudtask:isPublic';

/** Regex for accepting an incoming x-request-id (guards against header/log
 * injection); anything else is replaced with a generated UUID. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
