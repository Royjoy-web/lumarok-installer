// ============================================================
// LumaRoK — core/retry.js
// Exponential backoff retry orchestrator.
// Depends on: Trace
// ============================================================
const Retry = (() => {
  /**
   * Retry an async fn with exponential backoff + jitter.
   * @param {Function} fn          Async function to retry
   * @param {Object}   opts
   * @param {number}   opts.max    Max attempts (default 4)
   * @param {number}   opts.base   Base delay ms (default 1000)
   * @param {number}   opts.cap    Max delay ms (default 30000)
   * @param {string}   opts.tag    Trace tag
   * @param {Function} opts.onRetry  Called before each retry: (attempt, delay, err) => void
   * @param {Function} opts.bail   If fn(err) returns true, stop immediately
   */
  async function attempt(fn, opts = {}) {
    const { max = 4, base = 1000, cap = 30000, tag = 'retry', onRetry, bail } = opts;
    let lastErr;
    for (let i = 0; i < max; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (bail && bail(err)) throw err;
        if (i === max - 1) break;
        const delay = Math.min(cap, base * Math.pow(2, i) + Math.random() * base * 0.5);
        Trace.warn(tag, { attempt: i + 1, delay: Math.round(delay), err: err.message });
        if (onRetry) onRetry(i + 1, delay, err);
        await _sleep(delay);
      }
    }
    throw lastErr;
  }

  /**
   * Poll until predicate returns truthy or timeout.
   * @param {Function} predicate   Async fn → boolean (or truthy value returned)
   * @param {Object}   opts
   * @param {number}   opts.interval  Poll interval ms (default 5000)
   * @param {number}   opts.timeout   Total timeout ms (default 90000)
   * @param {string}   opts.tag
   * @param {Function} opts.onTick    Called each poll: (elapsed) => void
   */
  async function poll(predicate, opts = {}) {
    const { interval = 5000, timeout = 90000, tag = 'poll', onTick } = opts;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const result = await predicate();
        if (result) return result;
      } catch (err) {
        Trace.warn(tag, { err: err.message });
      }
      const elapsed = Date.now() - (deadline - timeout);
      if (onTick) onTick(elapsed);
      await _sleep(interval);
    }
    throw new Error(`Poll timeout after ${timeout}ms [${tag}]`);
  }

  const _sleep = ms => new Promise(r => setTimeout(r, ms));

  return { attempt, poll };
})();
