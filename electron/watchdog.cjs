// The decision part of the desktop server watchdog, kept free of Electron so it can be tested.
const DOWN_MS = 30000; // wait this long before restarting, so a deliberate restart is never fought
const WINDOW_MS = 600000;
const MAX_RESTARTS = 3; // per window: a server that cannot start must not loop

/** state: { downSince, restarts[] }. Returns the next state and whether to restart the server now. */
function decide(state, up, now) {
  if (up) return { state: { downSince: 0, restarts: state.restarts }, restart: false };
  const downSince = state.downSince || now;
  if (now - downSince < DOWN_MS) return { state: { downSince, restarts: state.restarts }, restart: false };
  const recent = state.restarts.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_RESTARTS) return { state: { downSince, restarts: recent }, restart: false };
  return { state: { downSince: 0, restarts: [...recent, now] }, restart: true };
}

module.exports = { decide, DOWN_MS, WINDOW_MS, MAX_RESTARTS };
