export function formatReactionCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  return `${safeCount} ${safeCount === 1 ? 'reaction' : 'reactions'}.`;
}

export function beginReaction(state) {
  if (state.busy) return state;

  const liked = !state.liked;
  return {
    liked,
    count: Math.max(0, state.count + (liked ? 1 : -1)),
    busy: true,
    message: 'Saving reaction…',
    tone: 'neutral',
    previous: { liked: state.liked, count: state.count },
  };
}

export function applyLoadedCount(state, serverCount, mutationStarted) {
  if (mutationStarted) return state;

  const count = Math.max(0, Number(serverCount) || 0);
  return {
    liked: state.liked,
    count,
    busy: false,
    message: formatReactionCount(count),
    tone: 'neutral',
  };
}

export function resolveReaction(state, serverCount) {
  const count = Math.max(0, Number(serverCount) || 0);
  return {
    liked: state.liked,
    count,
    busy: false,
    message: `Reaction saved. ${formatReactionCount(count)}`,
    tone: 'success',
  };
}

export function rejectReaction(state) {
  return {
    liked: state.previous?.liked ?? state.liked,
    count: state.previous?.count ?? state.count,
    busy: false,
    message: 'Couldn’t save your reaction. Check your connection and try again.',
    tone: 'error',
  };
}

export function readStoredLike(storage, key) {
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeStoredLike(storage, key, liked) {
  try {
    storage.setItem(key, liked ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
