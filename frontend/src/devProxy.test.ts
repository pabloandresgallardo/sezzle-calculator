import { describe, expect, it } from 'vitest';
import { resolveProxyTargets } from './devProxy';

describe('resolveProxyTargets', () => {
  it('uses the local defaults', () => {
    expect(resolveProxyTargets({})).toEqual({
      java: 'http://localhost:8090',
      go: 'http://localhost:8091',
    });
  });

  it('uses the new variables', () => {
    expect(
      resolveProxyTargets({ VITE_JAVA_TARGET: 'http://j:1', VITE_GO_TARGET: 'http://g:2' }),
    ).toEqual({
      java: 'http://j:1',
      go: 'http://g:2',
    });
  });

  it('accepts the deprecated VITE_API_PROXY_TARGET for Java only', () => {
    expect(resolveProxyTargets({ VITE_API_PROXY_TARGET: 'http://old:9' })).toEqual({
      java: 'http://old:9',
      go: 'http://localhost:8091',
    });
  });

  it('prefers VITE_JAVA_TARGET over the deprecated variable', () => {
    expect(
      resolveProxyTargets({
        VITE_JAVA_TARGET: 'http://new:1',
        VITE_API_PROXY_TARGET: 'http://old:9',
      }).java,
    ).toBe('http://new:1');
  });
});
