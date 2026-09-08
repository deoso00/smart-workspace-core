/**
 * Layer: Application. Local guest identity — no login required.
 * A random key is generated once per browser and used as `owner_key`.
 */
const KEY = "zanto.guest.key";
const NAME = "zanto.guest.name";

export function getGuestKey(): string {
  if (typeof window === "undefined") return "server";
  let key = window.localStorage.getItem(KEY);
  if (!key) {
    key = `guest_${crypto.randomUUID()}`;
    window.localStorage.setItem(KEY, key);
  }
  return key;
}

export function getGuestName(): string {
  if (typeof window === "undefined") return "Guest";
  return window.localStorage.getItem(NAME) ?? "Guest";
}

export function setGuestName(name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NAME, name);
}
