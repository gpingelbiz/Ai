// Greg's identity must never reach a client speaker reel. File paths are infrastructure, not copy: the operator's
// home folder (/Users/gregpingel/...) is masked before the check, so a client's files on Greg's Mac do not trip it,
// while his name, handle or brand anywhere in the text still does.
const IDENTITY = /greg\s*pingel|officialgregpingel|pingel/i;
const HOME_SEGMENT = /(^|[\s"'(=/:])(?:\/Users|\/home)\/[^/\s"']+(?=\/)/g;

export const maskHome = (text) => String(text).replace(HOME_SEGMENT, "$1/Users/local");

export const hasGregIdentity = (text) => IDENTITY.test(maskHome(text));

/** Every string value (nested) that carries Greg's identity, as dotted paths like "plan.items.3.card.name". */
export function identityLeaks(value, at = "") {
  if (typeof value === "string") return hasGregIdentity(value) ? [at || "text"] : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => identityLeaks(child, at ? `${at}.${key}` : key));
}
