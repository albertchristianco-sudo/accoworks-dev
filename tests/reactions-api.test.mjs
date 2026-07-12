import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/reactions.js';

function environment(initial = '0') {
  const writes = [];
  return {
    writes,
    env: {
      REACTIONS: {
        async get() { return initial; },
        async put(key, value) { writes.push({ key, value }); },
      },
    },
  };
}

test('rejects unsupported reaction actions without changing the count', async () => {
  const { env, writes } = environment('4');
  const request = new Request('https://accoworks.dev/api/reactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'example-note', action: 'boost' }),
  });

  const response = await onRequestPost({ request, env });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'bad action' });
  assert.deepEqual(writes, []);
});

test('accepts explicit like and unlike actions', async () => {
  for (const [action, expected] of [['like', '5'], ['unlike', '3']]) {
    const { env, writes } = environment('4');
    const request = new Request('https://accoworks.dev/api/reactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'example-note', action }),
    });

    const response = await onRequestPost({ request, env });

    assert.equal(response.status, 200);
    assert.deepEqual(writes, [{ key: 'likes:example-note', value: expected }]);
  }
});
