import assert from 'node:assert/strict';
import test from 'node:test';

let reactions;
try {
  reactions = await import('../src/scripts/reaction-state.mjs');
} catch {
  reactions = null;
}

const requireModule = () => {
  assert.ok(reactions, 'reaction-state module must exist');
  return reactions;
};

test('starts a like optimistically and remembers the prior state', () => {
  const { beginReaction } = requireModule();
  assert.deepEqual(beginReaction({ liked: false, count: 4, busy: false, message: '', tone: 'neutral' }), {
    liked: true,
    count: 5,
    busy: true,
    message: 'Saving reaction…',
    tone: 'neutral',
    previous: { liked: false, count: 4 },
  });
});

test('starts an unlike without allowing a negative count', () => {
  const { beginReaction } = requireModule();
  assert.equal(beginReaction({ liked: true, count: 0, busy: false, message: '' }).count, 0);
});

test('ignores re-entry while a mutation is busy', () => {
  const { beginReaction } = requireModule();
  const state = { liked: true, count: 5, busy: true, message: 'Saving reaction…', previous: { liked: false, count: 4 } };
  assert.equal(beginReaction(state), state);
});

test('reconciles a successful mutation with the server count', () => {
  const { resolveReaction } = requireModule();
  const state = { liked: true, count: 5, busy: true, message: 'Saving reaction…', previous: { liked: false, count: 4 } };
  assert.deepEqual(resolveReaction(state, 7), { liked: true, count: 7, busy: false, message: 'Reaction saved. 7 reactions.', tone: 'success' });
});

test('rolls back an unsuccessful mutation', () => {
  const { rejectReaction } = requireModule();
  const state = { liked: true, count: 5, busy: true, message: 'Saving reaction…', previous: { liked: false, count: 4 } };
  assert.deepEqual(rejectReaction(state), {
    liked: false,
    count: 4,
    busy: false,
    message: 'Couldn’t save your reaction. Check your connection and try again.',
    tone: 'error',
  });
});

test('ignores a stale initial count after a mutation starts', () => {
  const { applyLoadedCount } = requireModule();
  const state = { liked: true, count: 5, busy: false, message: 'Reaction saved. 5 reactions.', tone: 'success' };
  assert.equal(applyLoadedCount(state, 2, true), state);
  assert.deepEqual(applyLoadedCount(state, 7, false), {
    liked: true,
    count: 7,
    busy: false,
    message: '7 reactions.',
    tone: 'neutral',
  });
});

test('formats singular reaction counts naturally', () => {
  const { formatReactionCount } = requireModule();
  assert.equal(formatReactionCount(1), '1 reaction.');
  assert.equal(formatReactionCount(2), '2 reactions.');
});

test('tolerates unavailable local storage', () => {
  const { readStoredLike, writeStoredLike } = requireModule();
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readStoredLike(storage, 'liked:test'), false);
  assert.equal(writeStoredLike(storage, 'liked:test', true), false);
});
