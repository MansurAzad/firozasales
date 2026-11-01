import { describe, expect, it } from 'vitest';
import { resolvePath } from '@tanstack/react-router';
import { getRouter } from '../router';

describe('anonymous SPA shell URL', () => {
  it('preserves the /auth/ URL requested by production prerender', () => {
    const router = getRouter();
    expect(resolvePath({ basepath: '/', base: '/', to: '/auth/', trailingSlash: router.options.trailingSlash })).toBe('/auth/');
  });

  it('continues to accept existing login links without a trailing slash', () => {
    const router = getRouter();
    expect(resolvePath({ basepath: '/', base: '/', to: '/auth', trailingSlash: router.options.trailingSlash })).toBe('/auth');
  });
});