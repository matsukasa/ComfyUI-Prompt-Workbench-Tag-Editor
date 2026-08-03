# Prototype Instructions

## Design Context

- Visual target: the selected colorful Category Kanban mockup generated in this project session.
- Keep the dense dark ComfyUI base, four color-coded small-category lanes, colored hierarchy branches, left drag navigator, and persistent bottom selection dock.
- Tags may move across major and medium branches by auto-expanding the tree and dropping on a final small category.
- Category drag rules are level-safe: major reorders with major; medium can change major parent; small can change medium parent.
- Color always has a redundant icon, label, outline, checkbox, or shape cue.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
