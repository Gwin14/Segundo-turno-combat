// Browser-side PostHog: menu flow, training matches, controls and sound.
// The SDK loads after the game, so it never delays the first frame, and the
// game plays on if an ad blocker stops it. Disabled when the server has no
// POSTHOG_* variables (window.__PH__ is then empty).
const cfg = window.__PH__ || {};
const enabled = !!(cfg.token && cfg.host);
const env = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname) ? "dev" : "prod";
let ph = null;
const queue = [];

// A stable anonymous id of our own, so the game server can tag its events with
// the same id even before (or without) the SDK loading.
let pid = null;
try { pid = localStorage.getItem("st_pid"); } catch {}
if (!pid) {
  pid = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try { localStorage.setItem("st_pid", pid); } catch {}
}

export const distinctId = () => (ph ? ph.get_distinct_id() : pid);

export async function initAnalytics(superProps = {}) {
  if (!enabled) return;
  try {
    const { default: posthog } = await import("/vendor/posthog.js");
    posthog.init(cfg.token, {
      api_host: cfg.host,
      defaults: "2026-08-30",
      bootstrap: { distinctID: pid },
    });
    posthog.register({ app: "segundo-turno", ambiente: env, origem_evento: "navegador", ...superProps });
    ph = posthog;
    for (const [event, props] of queue.splice(0)) ph.capture(event, props);
  } catch {
    // blocked or offline: analytics is optional
  }
}

export function track(event, props = {}) {
  if (!enabled) return;
  if (ph) ph.capture(event, props);
  else if (queue.length < 100) queue.push([event, props]);
}
