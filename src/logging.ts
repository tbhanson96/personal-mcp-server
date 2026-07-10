import { Request } from 'express';

const REDACTED = '[redacted]';
const SENSITIVE_KEYS = new Set([
  'access_token',
  'authorization',
  'code',
  'login_code',
  'refresh_token',
  'token',
]);

export function logInfo(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level: 'info',
    event,
    timestamp: new Date().toISOString(),
    ...sanitizeRecordForLog(details),
  }));
}

export function logError(event: string, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({
    level: 'error',
    event,
    timestamp: new Date().toISOString(),
    ...sanitizeRecordForLog(details),
  }));
}

export function requestLogDetails(request: Request) {
  return {
    method: request.method,
    path: request.path,
    originalUrl: request.originalUrl,
    ip: request.ip,
    userAgent: request.get('user-agent'),
    mcpMethod: request.body && typeof request.body === 'object' ? request.body.method : undefined,
    mcpId: request.body && typeof request.body === 'object' ? request.body.id : undefined,
  };
}

export function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : sanitizeForLog(entry),
  ]));
}

function sanitizeRecordForLog(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeForLog(value) as Record<string, unknown>;
}
