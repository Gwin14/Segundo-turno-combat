// Server-side PostHog events: the authoritative match facts (rooms, rounds,
// results, disconnects, server load). Off unless POSTHOG_PROJECT_TOKEN and
// POSTHOG_HOST are set, so local runs without a .env send nothing.
import { PostHog } from "posthog-node";

let client; // undefined = not initialised yet, null = disabled

function getClient() {
  if (client === undefined) {
    const token = process.env.POSTHOG_PROJECT_TOKEN;
    const host = process.env.POSTHOG_HOST;
    client = token && host ? new PostHog(token, { host }) : null;
    if (client) client.on("error", (err) => console.error("PostHog:", err.message || err));
  }
  return client;
}

export const analyticsEnabled = () => !!getClient();
export const environment = () => (process.env.RENDER || process.env.NODE_ENV === "production" ? "prod" : "dev");

// Browser config injected into index.html (the project token is public by design).
export function browserConfig() {
  const token = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  return token && host ? { token, host } : {};
}

// Every event is tagged with the app, so the game's data can be separated
// from other sites sharing the PostHog project. No person profiles are
// created server-side; events still join the browser's anonymous id.
export function track(distinctId, event, properties = {}) {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId,
    event,
    properties: { app: "segundo-turno", ambiente: environment(), origem_evento: "servidor", ...properties,
      $process_person_profile: false },
  });
}

export async function shutdownAnalytics() {
  if (client) await client.shutdown();
}
