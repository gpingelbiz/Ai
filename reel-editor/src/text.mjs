/** Shared text helpers: one HTML escaper and one word normalizer for every module. */
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Lower-case, letters and digits of any script plus & $ ', so "café" and "Ghost P&L" survive and "it's" stays one token. */
export const norm = (t) => String(t).toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}&$']/gu, "");
