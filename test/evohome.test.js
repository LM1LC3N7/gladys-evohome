// The real transport against a loopback HTTP server, and the error mapping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  EvohomeError,
  errorCode,
  errorFor,
  errorReason,
  httpRequest,
  networkError,
  parseAnswer,
  parseRetryAfter,
} from '../src/evohome.js';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a request: method, headers, body; the answer whatever its status', async (t) => {
  let seen;
  const base = await serve(t, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { method: req.method, url: req.url, auth: req.headers.authorization, body };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('{"id":"1"}');
    });
  });
  const answer = await httpRequest(`${base}/WebAPI/emea/api/v1/x?y=1`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: '{"a":1}',
  });
  assert.equal(answer.status, 201);
  assert.equal(answer.body, '{"id":"1"}');
  assert.deepEqual(seen, {
    method: 'PUT',
    url: '/WebAPI/emea/api/v1/x?y=1',
    auth: 'Bearer t',
    body: '{"a":1}',
  });
});

test('a silent server times out, a huge answer is cut, a closed port is a network error', async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/big') {
      res.writeHead(200);
      res.end('x'.repeat(2048));
    }
    // /slow never answers
  });
  await assert.rejects(httpRequest(`${base}/slow`, { timeout: 50 }), { kind: 'timeout' });
  await assert.rejects(httpRequest(`${base}/big`, { maxBytes: 1024 }), { kind: 'size' });
  await assert.rejects(httpRequest('http://127.0.0.1:1/'), { kind: 'network' });
});

test('the errors of the answers', () => {
  const token = { token: true };
  const at = (status, body, headers) => ({ status, body: JSON.stringify(body), headers });
  assert.equal(errorFor(at(400, { error: 'invalid_grant' }), token).kind, 'refused');
  assert.equal(
    errorFor(at(400, { error: 'invalid_grant' }), { token: true, refresh: true }).kind,
    'refresh_refused',
  );
  const limited = errorFor(
    at(429, { error: 'attempt_limit_exceeded' }, { 'retry-after': '60' }),
    token,
  );
  assert.deepEqual(
    [limited.kind, limited.login, limited.retryAfter],
    ['rate_limited', true, 60_000],
  );
  assert.equal(errorFor(at(401, [{ code: 'Unauthorized' }])).kind, 'unauthorized');
  assert.equal(errorFor(at(403, [])).kind, 'forbidden');
  assert.equal(errorFor({ status: 404, body: '<html></html>' }).kind, 'not_found');
  const rejected = errorFor(at(400, [{ code: 'InvalidInput', message: 'Invalid Input.' }]));
  assert.deepEqual(
    [rejected.kind, rejected.message],
    ['rejected', 'request refused: InvalidInput'],
  );
  assert.equal(errorFor(at(500, { message: 'An error has occurred.' })).kind, 'unavailable');
  assert.equal(errorFor(at(418, {})).kind, 'http');
  assert.equal(errorCode('[{"code":"TooManyRequests"}]'), 'TooManyRequests');
  assert.equal(errorCode('not json'), undefined);
});

test('reasons never carry the request, Retry-After in seconds or as a date', () => {
  assert.equal(
    errorReason(new EvohomeError('unavailable', 'down', { status: 503 })),
    'down (HTTP 503)',
  );
  assert.equal(errorReason(networkError({ code: 'ENOTFOUND' })), 'unknown host name');
  assert.equal(errorReason(new Error('plain')), 'plain');
  assert.equal(parseRetryAfter('120'), 120_000);
  assert.equal(parseRetryAfter('Fri, 16 Oct 2026 10:01:00 GMT', Date.UTC(2026, 9, 16, 10)), 60_000);
  assert.equal(parseRetryAfter(''), undefined);
  assert.equal(parseRetryAfter('later'), undefined);
});

test('answers must be the JSON expected', () => {
  assert.deepEqual(parseAnswer('{"a":1}'), { a: 1 });
  assert.deepEqual(parseAnswer('[1]', { array: true }), [1]);
  assert.throws(() => parseAnswer('[1]'), { kind: 'bad_response' });
  assert.throws(() => parseAnswer('<html>'), { kind: 'bad_response' });
});
