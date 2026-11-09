/**
 * One timer for every relative time on a page: each `<Text>` and `live` copy waiting for its text to
 * change waits here, and the timer is set for the soonest. A page of five hundred times sets one.
 */

type Waiting = { at: number; run: () => void };

const waiting = new Set<Waiting>();
let timer: ReturnType<typeof setTimeout> | undefined;
let timerAt = Infinity;
let watching = false;
// `setTimeout` takes a delay in a signed 32-bit integer, about 24.8 days; a longer one fires at once.
const LONGEST = 2 ** 31 - 1;

function check() {
  const now = Date.now();
  for (const w of waiting) {
    if (w.at > now) continue;
    waiting.delete(w);
    w.run();
  }
  plan();
}

function plan() {
  let soonest = Infinity;
  for (const w of waiting) soonest = Math.min(soonest, w.at);
  if (soonest === timerAt) return;
  clearTimeout(timer);
  timerAt = soonest;
  timer = soonest === Infinity ? undefined : setTimeout(check, Math.min(Math.max(soonest - Date.now(), 0), LONGEST));
}

/**
 * Runs `run` once `delay` milliseconds have passed. Returns what cancels it. A hidden tab's timers are
 * held back, so what came due while it was hidden runs once it shows.
 */
export function wait(delay: number, run: () => void): () => void {
  if (!watching && typeof document !== 'undefined') {
    watching = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }
  const w = { at: Date.now() + delay, run };
  waiting.add(w);
  plan();
  return () => {
    waiting.delete(w);
    plan();
  };
}
