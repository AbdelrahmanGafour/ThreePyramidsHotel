/**
 * What counts as a JSON body, for the admin media routes that take one.
 *
 * One rule, shared because getting it subtly wrong in a second place is
 * exactly the failure this exists to prevent. A null prototype is accepted
 * because `JSON.parse` with a reviver can produce one; a Date, Map, Set or
 * class instance is an object whose fields would not survive a JSON
 * round-trip, so it is not a body this API was sent.
 *
 * A predicate rather than a throwing check: each feature raises its own
 * error with its own locked code, and which code that is does not belong
 * here. Nothing in this file imports anything.
 */
export function isPlainJsonObject(body: unknown): body is Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(body);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a body carries exactly one named key, and that key is present.
 *
 * "Present" is the whole of the check: the value itself is judged by the
 * domain rule that owns it, never here. Presence matters on its own because
 * omitting a field and asking to clear it are different requests —
 * `{"altText": null}` says clear it, and a body without the key at all says
 * nothing, which is not a request this kind of route accepts.
 *
 * A second key is refused whatever it says, including one that happens to
 * agree with what the route was going to do anyway: a body reaching for a
 * control an endpoint does not offer is still a body claiming that control.
 */
export function hasExactlyKey(body: Record<string, unknown>, key: string): boolean {
  const keys = Object.keys(body);

  return keys.length === 1 && keys[0] === key;
}
