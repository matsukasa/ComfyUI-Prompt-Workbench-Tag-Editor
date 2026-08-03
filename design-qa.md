# Design QA

## Source of truth

- Visual target: `C:\Users\mtkw0\.codex\generated_images\019fc355-5c9b-74a3-982e-dea41670ab18\exec-d8906ee6-b62e-489a-84d3-33ef55f16db2.png`
- Target size: 1488 × 1058 px (same 1.406 aspect ratio as the test viewport)
- Primary state: dark theme, hierarchy tree open, dense tag lanes, colorful semantic accents

## Implementation evidence

- Screenshot: `docs/implementation-1440x1024.png`
- Viewport: 1440 × 1024 px
- Data state: the actual bundled `tag_catalog.json` loaded (3,623 tags / 168 categories)
- Screenshot test: `tests/e2e/editor.spec.ts`

## Comparison

The reference and implementation screenshots were inspected together at their native sizes. The implementation preserves the reference's dark ComfyUI-like base, left hierarchy tree, dense small-category lanes, top file/history/search controls, semantic lane colors, orange interaction accents, and visible drag handles. The ambiguous bottom bulk-action dock was intentionally removed.

Intentional differences:

- The reference illustrates four lanes. The implementation keeps four lanes in the desktop viewport, renders every small category, and exposes additional lanes through native horizontal scrolling and explicit previous/next controls. The production screenshot uses the actual 23-lane `身につける物` category after one horizontal move.
- The reference freezes a drag-in-progress state with arrows and a drop zone. The implementation shows those affordances only during a real drag so the resting UI stays readable.
- The implementation uses slightly quieter surface fills than the concept while retaining saturated borders, headers, badges, selection states, and feedback colors for legibility with real data.

## Focused evidence

No additional crop was required. The important hierarchy tree, lane headers, tag rows, toolbar, and bulk-action dock are simultaneously visible in the full 1440 × 1024 screenshot.

## Findings

- P0: none
- P1: none
- P2: none
- Informational: direct Chrome-extension inspection was unavailable because the ChatGPT Chrome extension was not installed in the selected Chrome profile. The same Chrome channel was exercised through the established Playwright E2E suite instead.

## Comparison history

1. Compared the concept against the minimal sample catalog. Visual structure and color semantics matched, but the sample was too sparse for a meaningful density check.
2. Re-captured with the actual bundled catalog at 1440 × 1024 and compared again. Dense rows, scrolling regions, hierarchy depth, and the dock-free work area remained aligned and uncropped.
3. Re-captured the actual 23-lane category after horizontal navigation. Four full lanes and the next lane edge remain visible, while the lane count and directional controls make the additional content discoverable.

## Final result

passed
