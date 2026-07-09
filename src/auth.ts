import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export function requireMcpAuth(apiKey: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (isAuthorized(request.header('authorization'), request.header('x-api-key'), apiKey)) {
      next();
      return;
    }

    response.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized.',
      },
      id: null,
    });
  };
}

export function isAuthorized(
  authorizationHeader: string | undefined,
  apiKeyHeader: string | undefined,
  expectedApiKey: string,
): boolean {
  return tokenMatches(bearerToken(authorizationHeader), expectedApiKey) ||
    tokenMatches(apiKeyHeader, expectedApiKey);
}

function bearerToken(header: string | undefined): string | undefined {
  const prefix = 'Bearer ';
  if (!header?.startsWith(prefix)) {
    return undefined;
  }

  return header.slice(prefix.length);
}

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) {
    return false;
  }

  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(candidateBytes, expectedBytes);
}
