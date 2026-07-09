import { describe, expect, it } from 'vitest';
import { isAuthorized } from '../src/auth.js';

describe('isAuthorized', () => {
  it('accepts exact bearer and x-api-key credentials', () => {
    expect(isAuthorized('Bearer secret', undefined, 'secret')).toBe(true);
    expect(isAuthorized(undefined, 'secret', 'secret')).toBe(true);
  });

  it('rejects missing, malformed, and non-exact credentials', () => {
    expect(isAuthorized(undefined, undefined, 'secret')).toBe(false);
    expect(isAuthorized('Bearer wrong', undefined, 'secret')).toBe(false);
    expect(isAuthorized('Bearer secretx', undefined, 'secret')).toBe(false);
    expect(isAuthorized('Basic secret', undefined, 'secret')).toBe(false);
    expect(isAuthorized('bearer secret', undefined, 'secret')).toBe(false);
    expect(isAuthorized(undefined, 'secretx', 'secret')).toBe(false);
  });
});
