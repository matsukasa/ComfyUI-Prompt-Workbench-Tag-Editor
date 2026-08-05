import { expect, it, vi } from "vitest";
import { createDragSoundController } from "../../src/audio/dragSounds";

it("plays one pickup, distinct insertion ticks, and one successful drop", () => {
  const play = vi.fn();
  const sounds = createDragSoundController(play);
  sounds.start(true);
  sounds.moveTo("tag-target:first", true, 100);
  sounds.moveTo("tag-target:first", true, 200);
  sounds.moveTo("tag-target:second", true, 120);
  sounds.moveTo("tag-target:third", true, 160);
  sounds.finish(true, true);

  expect(play.mock.calls.map(([kind]) => kind)).toEqual(["pickup", "tick", "tick", "drop"]);
});

it("stays silent when disabled and does not confirm a cancelled or invalid drop", () => {
  const play = vi.fn();
  const sounds = createDragSoundController(play);
  sounds.start(false);
  sounds.moveTo("category-target:first", false, 100);
  sounds.finish(false, false);
  sounds.start(true);
  sounds.cancel();

  expect(play).toHaveBeenCalledOnce();
  expect(play).toHaveBeenCalledWith("pickup", true);
});
