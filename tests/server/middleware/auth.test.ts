import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { checkAuth, getAuthToken, isPathProtected } from '../../../src/server/middleware/auth.js';

function mockReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as IncomingMessage;
}

function mockRes(): {
  res: ServerResponse;
  status: () => number;
  body: () => string;
  header: () => Record<string, string | number | string[] | undefined>;
} {
  let s = 200;
  let b = '';
  let h: Record<string, string | number | string[] | undefined> = {};
  const res = {
    writeHead: (code: number, headers?: Record<string, string | number | string[] | undefined>) => {
      s = code;
      if (headers) h = headers;
      return res;
    },
    end: (body?: string) => {
      if (body) b = body;
      return res;
    },
  } as unknown as ServerResponse;
  return { res, status: () => s, body: () => b, header: () => h };
}

describe('isPathProtected', () => {
  it('returns true for /web', () => assert.strictEqual(isPathProtected('/web'), true));
  it('returns true for /web/sub', () => assert.strictEqual(isPathProtected('/web/sub'), true));
  it('returns true for /api/config', () => assert.strictEqual(isPathProtected('/api/config'), true));
  it('returns false for /stats', () => assert.strictEqual(isPathProtected('/stats'), false));
  it('returns false for /v1/messages', () => assert.strictEqual(isPathProtected('/v1/messages'), false));
  it('returns false for /logs', () => assert.strictEqual(isPathProtected('/logs'), false));
});

describe('checkAuth', () => {
  const saved = process.env['CMR_WEB_AUTH_TOKEN'];

  beforeEach(() => { delete process.env['CMR_WEB_AUTH_TOKEN']; });
  afterEach(() => { if (saved) process.env['CMR_WEB_AUTH_TOKEN'] = saved; else delete process.env['CMR_WEB_AUTH_TOKEN']; });

  it('allows all when no token set', () => {
    const { res } = mockRes();
    assert.strictEqual(checkAuth(mockReq('/web'), res), true);
    assert.strictEqual(checkAuth(mockReq('/api/config'), res), true);
  });

  it('allows /stats without auth when token is set', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    assert.strictEqual(checkAuth(mockReq('/stats'), mockRes().res), true);
  });

  it('allows /v1/messages without auth', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    assert.strictEqual(checkAuth(mockReq('/v1/messages'), mockRes().res), true);
  });

  it('allows /web with valid Bearer token', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    assert.strictEqual(checkAuth(mockReq('/web', { authorization: 'Bearer s' }), mockRes().res), true);
  });

  it('blocks /web with wrong token', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    const { res, status } = mockRes();
    assert.strictEqual(checkAuth(mockReq('/web', { authorization: 'Bearer wrong' }), res), false);
    assert.ok(status() === 401 || status() === 302);
  });

  it('allows /web with valid cookie', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    assert.strictEqual(checkAuth(mockReq('/web', { cookie: 'cmr_token=s' }), mockRes().res), true);
  });

  it('blocks /api/config without token', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    const { res, status } = mockRes();
    assert.strictEqual(checkAuth(mockReq('/api/config'), res), false);
    assert.ok(status() === 401 || status() === 302);
  });

  it('allows /web/login when token is set', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    assert.strictEqual(checkAuth(mockReq('/web/login'), mockRes().res), true);
  });

  it('302 redirect for browser requests', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    const { res, status, header } = mockRes();
    checkAuth(mockReq('/web', { accept: 'text/html' }), res);
    assert.strictEqual(status(), 302);
    assert.strictEqual(header()['Location'], '/web/login');
  });

  it('401 for API requests', () => {
    process.env['CMR_WEB_AUTH_TOKEN'] = 's';
    const { res, status, body } = mockRes();
    checkAuth(mockReq('/api/config', { accept: 'application/json' }), res);
    assert.strictEqual(status(), 401);
    assert.strictEqual(JSON.parse(body()).error, 'Unauthorized');
  });
});

describe('getAuthToken', () => {
  it('returns null when not set', () => {
    delete process.env['CMR_WEB_AUTH_TOKEN'];
    assert.strictEqual(getAuthToken(), null);
  });
});
