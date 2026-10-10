import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from '../apps/desktop/resources/dsh/tavily-web-search.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tavily DSH web provider', () => {
  it('registers into ctx.web and returns normalized safe sources', async () => {
    let provider;
    let key = 'synthetic-first-key';
    const resolve = vi.fn(async () => ({ value: key, source: 'test' }));
    apply({ web: { registerSearchProvider(value) { provider = value; } }, get: () => ({ resolve }) }, {
      apiKeyEnv: { get: () => 'TAVILY_API_KEY' }, maxResults: { get: () => 5 }
    });
    const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ results: [
      { title: 'Result', url: 'https://example.com/page', content: 'Snippet' },
      { title: 'Unsafe', url: 'file:///private', content: 'Drop me' },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', request);

    expect(provider.available()).toBe(true);
    await expect(provider.search({ query: 'latest', maxResults: 3 })).resolves.toEqual({
      sources: [{ title: 'Result', url: 'https://example.com/page', snippet: 'Snippet' }],
      truncated: false,
    });
    expect(request).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({
      method: 'POST', redirect: 'error',
    }));
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ query: 'latest', max_results: 3 });
    key = 'synthetic-second-key';
    await provider.search({ query: 'next', maxResults: 8 });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic-second-key');
    expect(JSON.parse(request.mock.calls[1][1].body).max_results).toBe(5);
  });
});

