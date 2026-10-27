// Client for the optional global leaderboard served by /api/scores.

let enabled = null;

export async function fetchScores() {
  try {
    const r = await fetch('api/scores', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    enabled = !!data.enabled;
    return data;
  } catch {
    enabled = false;
    return { enabled: false, scores: [] };
  }
}

export function onlineAvailable() {
  return enabled;
}

export async function submitScore(name, replay) {
  const r = await fetch('api/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, replay }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'submit failed');
  return data;
}
