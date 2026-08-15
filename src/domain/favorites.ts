export interface FavoriteSettings {
  favorites: string[];
}

export const FAVORITES_STORAGE_KEY = "prompt-workbench:favorites";

export function favoriteTagKey(value: string): string {
  return String(value || "").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function sanitizeFavorites(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = favoriteTagKey(String(value || ""));
    if (key) seen.add(key);
    if (seen.size >= 20000) break;
  }
  return [...seen].sort();
}

export function parseFavoriteSettings(value: unknown): FavoriteSettings {
  if (Array.isArray(value)) return { favorites: sanitizeFavorites(value) };
  if (value && typeof value === "object" && "favorites" in value) {
    return { favorites: sanitizeFavorites((value as { favorites?: unknown }).favorites) };
  }
  return { favorites: [] };
}

export function readFavoriteSettings(): FavoriteSettings {
  if (typeof window === "undefined") return { favorites: [] };
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return { favorites: [] };
    return parseFavoriteSettings(JSON.parse(raw));
  } catch {
    return { favorites: [] };
  }
}

export function writeFavoriteSettings(settings: FavoriteSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({ favorites: sanitizeFavorites(settings.favorites) }),
    );
  } catch {
    // Favorites are user convenience data; catalog editing must continue if storage is unavailable.
  }
}

export function toggleFavorite(values: Iterable<string>, value: string): string[] {
  const next = new Set(sanitizeFavorites([...values]));
  const key = favoriteTagKey(value);
  if (!key) return [...next].sort();
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return [...next].sort();
}

