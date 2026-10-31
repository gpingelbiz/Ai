// Greg's identity must never reach a client speaker reel. File paths are infrastructure, not copy: the operator's
// home folder (/Users/gregpingel/...) is masked before the check, so a client's files on Greg's Mac do not trip it,
// while his name, handle or brand anywhere in the text still does.
const IDENTITY = /greg\s*pingel|officialgregpingel|pingel/i;
const PATH_VALUE = /^(?:file:\/\/)?\/(?:Users|home)\/[^/\s]+\/[^\n]*$/;

// Only a value that IS a path is masked; path-shaped words inside display copy are still checked.
export const maskHome = (text) => PATH_VALUE.test(String(text)) ? String(text).replace(/^((?:file:\/\/)?\/(?:Users|home)\/)[^/]+/, "$1local") : String(text);

export const hasGregIdentity = (text) => IDENTITY.test(maskHome(text));

/** Every string value (nested) that carries Greg's identity, as dotted paths like "plan.items.3.card.name". */
export function identityLeaks(value, at = "") {
  if (typeof value === "string") return hasGregIdentity(value) ? [at || "text"] : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => identityLeaks(child, at ? `${at}.${key}` : key));
}
