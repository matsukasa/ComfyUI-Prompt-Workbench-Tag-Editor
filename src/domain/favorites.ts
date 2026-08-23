export interface FavoriteSettings {
  favorites: string[];
  favoriteTagSets: string[];
}

export const FAVORITES_STORAGE_KEY = "prompt-workbench:favorites";

export function favoriteTagKey(value: string): string {
  return String(value || "").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function favoriteTagSetKey(value: string): string {
  return favoriteTagKey(value);
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
  if (Array.isArray(value)) return { favorites: sanitizeFavorites(value), favoriteTagSets: [] };
  if (value && typeof value === "object" && "favorites" in value) {
    const settings = value as { favorites?: unknown; favoriteTagSets?: unknown };
    return {
      favorites: sanitizeFavorites(settings.favorites),
      favoriteTagSets: sanitizeFavorites(settings.favoriteTagSets).slice(0, 2000),
    };
  }
  return { favorites: [], favoriteTagSets: [] };
}

export function readFavoriteSettings(): FavoriteSettings {
  if (typeof window === "undefined") return { favorites: [], favoriteTagSets: [] };
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return { favorites: [], favoriteTagSets: [] };
    return parseFavoriteSettings(JSON.parse(raw));
  } catch {
    return { favorites: [], favoriteTagSets: [] };
  }
}

export function writeFavoriteSettings(settings: FavoriteSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({
        favorites: sanitizeFavorites(settings.favorites),
        favoriteTagSets: sanitizeFavorites(settings.favoriteTagSets).slice(0, 2000),
      }),
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

export function syncFavoritesToCatalog(values: Iterable<string>, prompts: Iterable<string>): string[] {
  const available = new Set(sanitizeFavorites([...prompts]));
  return sanitizeFavorites([...values]).filter((key) => available.has(key));
}
