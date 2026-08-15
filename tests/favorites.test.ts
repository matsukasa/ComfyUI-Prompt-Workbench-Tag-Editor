import { expect, it } from "vitest";
import {
  favoriteTagKey,
  parseFavoriteSettings,
  sanitizeFavorites,
  toggleFavorite,
} from "../src/domain/favorites";

it("normalizes favorites into shared prompt keys", () => {
  expect(favoriteTagKey(" Looking_At_Viewer ")).toBe("looking_at_viewer");
  expect(sanitizeFavorites([" Standing ", "standing", "", "arms up"])).toEqual([
    "arms up",
    "standing",
  ]);
});

it("accepts the shared favorites JSON format", () => {
  expect(parseFavoriteSettings({ favorites: ["long_hair", "Long_Hair"] })).toEqual({
    favorites: ["long_hair"],
  });
  expect(parseFavoriteSettings(["short_hair"])).toEqual({ favorites: ["short_hair"] });
});

it("toggles favorite keys without touching catalog data", () => {
  const added = toggleFavorite([], "long_hair");
  expect(added).toEqual(["long_hair"]);
  expect(toggleFavorite(added, "Long_Hair")).toEqual([]);
});

