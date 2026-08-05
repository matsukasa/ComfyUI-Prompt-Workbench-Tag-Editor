# Prototype Instructions

## Design Context

- Visual target: the selected colorful Category Kanban mockup generated in this project session.
- Keep the dense dark ComfyUI base, four color-coded small-category lanes, colored hierarchy branches, and left drag navigator. Do not restore the removed bottom selection dock.
- Tags may move across major and medium branches by auto-expanding the tree and dropping on a final small category.
- Category drag rules are level-safe: major reorders with major and can become medium by dropping on a medium row; medium can change major parent and can become major through the dedicated root drop zone; small can change medium parent. Major/medium level conversion is allowed only when the dragged category has no children, otherwise show an error asking the user to move children first.
- Color always has a redundant icon, label, outline, checkbox, or shape cue.
- Show every small-category lane. Keep four lanes visible at the desktop reference width and make additional lanes reachable with native horizontal scrolling plus explicit left/right controls.
- Use orange as the primary accent for focus, selection, active filters, and primary actions while retaining category-specific lane colors.
- Do not add a bottom destination selector, bulk move controls, selected-only control, or delete strip.
- Edit major, medium, and small category names by double-clicking either visible label, then use compact in-row Japanese/English fields with save and cancel actions; never use a browser dialog for category editing.
- Tag selection controls must remain compact square checkboxes. Edit a tag by double-clicking the tag name; do not add a per-row edit menu or instructional copy for this gesture.
- Double-clicking either a tag name or its Japanese translation must open direct in-row editing for both values. Use compact in-row save and cancel actions; never use a browser dialog for tag editing.
- Japanese tag translations must wrap within the available translation column and remain fully visible. Rows use measured variable heights; do not truncate translations with ellipses.
- Keep moved, reordered, renamed, and newly added items visually distinguishable from the loaded baseline with a subtle orange tint plus a redundant change icon. Category drag previews must stay centered on the pointer, and major/medium destinations must use exact insertion lines instead of whole-row hover boxes.
- Match Prompt Workbench's save flow: offer `上書き保存` and `別名で保存`. Overwrite only a file opened through a writable File System Access API handle and only after explicit confirmation; otherwise disable overwrite and direct the user to save as.
- Whenever showing generated mockups or screenshots, include a direct clickable link to the original image file so it can be opened at full size.
- For right-pane tag rows, use the selected cool/warm typography direction: English prompt tags in cyan-white code text and Japanese translations in amber-peach text, with darker light-mode equivalents and no per-row cards or color bands.
- Focus the lane containing the most recently selected tag: 31% focused / 23% neighboring lanes at desktop width and 38% / 31% at medium width. Lock the focus to the source lane during drag so the destination never moves under the pointer.
- Tag drag previews stay centered on the pointer and use only a short directional afterimage that fades after about 200ms. Use a precise orange insertion line, compact direction icon, brief moved-row pulse, and an undo action in the success toast; never show a persistent cursor trail or tree-to-lane connector.
- Dragging tags and every category level (major, medium, and small) uses the same clearly audible synthesized feedback: an airy tube-like "カシュッ" pickup sound with little low-end pop, a short dry "カッ" click whenever the effective insertion destination changes, and a gentle landing sound after a successful drop. Never play insertion sounds on every pointer move or play a success sound for cancelled or invalid drops. Keep an accessible persistent operation-sound toggle in Settings.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
