/** Non-render helpers for one-off ids and shuffles (keeps component bodies pure). */

export function currentTimeMs() {
  return Date.now();
}

export function uniqueToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function shuffleInPlace<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [items[index], items[swap]] = [items[swap]!, items[index]!];
  }
  return items;
}
