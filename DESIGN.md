# Design System

## Direction

Dark creative-tool workbench. A restrained near-black canvas uses orange for the primary interaction accent and carries a functional supporting palette: violet for hair/style, cyan for color, amber for warnings, coral for category destinations, and emerald for success.

## Color

CSS tokens use OKLCH. Neutral surfaces are separated by spacing and thin dividers. Category branches inherit a hue, while focus, primary actions, active filters, and selected tags use the same orange interaction vocabulary. Destructive red is reserved for deletion.

Tag rows use a cool/warm text pair from the selected visual: English prompt tags are crisp cyan-white code text, while Japanese translations use readable amber-peach text. Light mode switches both roles to darker equivalents that preserve the same distinction.

## Typography

Inter, Yu Gothic UI, Meiryo UI, and system sans-serif fallback. Product text uses a compact fixed scale: 11px metadata, 12px controls, 13–15px rows and headings, 16px app title.

## Layout

Desktop reference viewport is 1440×1024. The shell is a toolbar and work area without a bottom action dock. Work area uses a 360px hierarchy sidebar and a kanban that keeps four lanes visible while exposing every additional small category through native horizontal scrolling and explicit previous/next controls. Below 1180px the sidebar narrows; below 760px it stacks above the kanban.

## Components

- Category rows: disclosure, level marker, bilingual label, count, baseline-change icon, and dedicated drag handle. Double-clicking a major or medium label opens editing. Empty major/medium categories can change level by drag; categories with children are blocked. Category drag destinations use insertion lines.
- Tag rows: compact square checkbox, prompt, Japanese translation, duplicate badge, baseline-change icon, and drag handle. Double-clicking either text field switches both values to direct in-row editing with compact save and cancel actions; tag editing never opens a dialog. Moved, reordered, renamed, and added rows receive a subtle orange tint plus a change icon until reset.
- Japanese translations wrap to their full text and determine a measured variable row height; English prompt tags remain single-line and may ellipsize when space is limited.
- Lanes: category-colored header, search, visible-selection action, virtualized rows, exact drop indicator.
- Dialogs and toasts: native product vocabulary with explicit success, warning, and error icons.

## Motion

State transitions use 160ms ease-out. Selecting a tag widens its working lane while keeping neighboring lanes visible; drag start locks that layout to prevent moving targets. Tag drag overlays stay centered on the pointer, show two subtle directional afterimages that fade after 200ms, and magnetize visually at a valid destination. Exact orange insertion lines and direction icons remain the primary destination cue. A moved row pulses for 600ms, then retains the persistent baseline-change tint and icon. `prefers-reduced-motion` removes afterimages, pulses, row displacement, and lane resizing while preserving lines, icons, and change colors.
