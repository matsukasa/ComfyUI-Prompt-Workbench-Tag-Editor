import { afterEach, expect, it, vi } from "vitest";
import {
  favoriteTagKey,
  favoriteSettingsPayload,
  mergeFavoriteSettings,
  parseFavoriteSettings,
  readSharedFavoriteSettings,
  sanitizeFavorites,
  syncFavoritesToCatalog,
  toggleFavorite,
  writeSharedFavoriteSettings,
} from "../src/domain/favorites";

afterEach(() => {
  vi.restoreAllMocks();
});

it("normalizes favorites into shared prompt keys", () => {
  expect(favoriteTagKey(" Looking_At_Viewer ")).toBe("looking_at_viewer");
  expect(sanitizeFavorites([" Standing ", "standing", "", "arms up"])).toEqual([
    "arms up",
    "standing",
  ]);
});

it("accepts the shared favorites JSON format", () => {
  expect(parseFavoriteSettings({
    schema: "prompt-workbench/favorites",
    version: 1,
    favorites: ["long_hair", "Long_Hair"],
  })).toEqual({
    favorites: ["long_hair"],
    favoriteTagSets: [],
  });
  expect(parseFavoriteSettings(["short_hair"])).toEqual({ favorites: ["short_hair"], favoriteTagSets: [] });
  expect(parseFavoriteSettings({ favorites: [], favoriteTagSets: ["set-a", "Set-A"] })).toEqual({
    favorites: [],
    favoriteTagSets: ["set-a"],
  });
  expect(parseFavoriteSettings({ schema: "other", version: 1, favorites: ["ignored"] })).toEqual({
    favorites: [],
    favoriteTagSets: [],
  });
});

it("merges shared favorites with the local fallback cache", () => {
  expect(mergeFavoriteSettings(
    { favorites: ["long_hair", "solo"], favoriteTagSets: ["set-b"] },
    { favorites: ["Solo", "short_hair"], favoriteTagSets: ["set-a", "set-b"] },
  )).toEqual({
    favorites: ["long_hair", "short_hair", "solo"],
    favoriteTagSets: ["set-a", "set-b"],
  });
});

it("serializes favorites with the shared schema", () => {
  expect(favoriteSettingsPayload({
    favorites: ["Long_Hair", "long_hair"],
    favoriteTagSets: ["set-a"],
  })).toEqual({
    schema: "prompt-workbench/favorites",
    version: 1,
    favorites: ["long_hair"],
    favoriteTagSets: ["set-a"],
  });
});

it("reads shared favorite settings from the local server route", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      schema: "prompt-workbench/favorites",
      version: 1,
      favorites: ["solo"],
      favoriteTagSets: ["set-a"],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(readSharedFavoriteSettings()).resolves.toEqual({
    favorites: ["solo"],
    favoriteTagSets: ["set-a"],
  });
  expect(fetchMock).toHaveBeenCalledWith("/prompt-workbench-data/favorites", { cache: "no-store" });
});

it("writes shared favorite settings to the local server route", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);

  await expect(writeSharedFavoriteSettings({ favorites: ["solo"], favoriteTagSets: ["set-a"] })).resolves.toBe(true);
  expect(fetchMock).toHaveBeenCalledWith("/prompt-workbench-data/favorites", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema: "prompt-workbench/favorites",
      version: 1,
      favorites: ["solo"],
      favoriteTagSets: ["set-a"],
    }),
  });
});

it("toggles favorite keys without touching catalog data", () => {
  const added = toggleFavorite([], "long_hair");
  expect(added).toEqual(["long_hair"]);
  expect(toggleFavorite(added, "Long_Hair")).toEqual([]);
});

it("syncs favorites to tags in the loaded catalog", () => {
  expect(syncFavoritesToCatalog(["long_hair", "old_tag", "solo"], ["solo", "long_hair"])).toEqual([
    "long_hair",
    "solo",
  ]);
});
