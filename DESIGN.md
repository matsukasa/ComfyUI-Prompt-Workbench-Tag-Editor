# Design System

## Direction

Dark creative-tool workbench. A restrained near-black canvas uses orange for the primary interaction accent and carries a functional supporting palette: violet for hair/style, cyan for color, amber for warnings, coral for category destinations, and emerald for success.

## Color

CSS tokens use OKLCH. Neutral surfaces are separated by spacing and thin dividers. Category branches inherit a hue, while focus, primary actions, active filters, and selected tags use the same orange interaction vocabulary. Destructive red is reserved for deletion.

## Typography

Inter, Yu Gothic UI, Meiryo UI, and system sans-serif fallback. Product text uses a compact fixed scale: 11px metadata, 12px controls, 13–15px rows and headings, 16px app title.

## Layout

Desktop reference viewport is 1440×1024. The shell is a toolbar and work area without a bottom action dock. Work area uses a 360px hierarchy sidebar and a kanban that keeps four lanes visible while exposing every additional small category through native horizontal scrolling and explicit previous/next controls. Below 1180px the sidebar narrows; below 760px it stacks above the kanban.

## Components

- Category rows: disclosure, level marker, bilingual label, count, baseline-change icon, and dedicated drag handle. Double-clicking a major or medium label opens editing. Empty major/medium categories can change level by drag; categories with children are blocked. Category drag destinations use insertion lines.
- Tag rows: compact square checkbox, prompt, Japanese translation, duplicate badge, baseline-change icon, and drag handle. Double-clicking the prompt opens tag editing. Moved, reordered, renamed, and added rows receive a subtle orange tint plus a change icon until reset.
- Lanes: category-colored header, search, visible-selection action, virtualized rows, exact drop indicator.
- Dialogs and toasts: native product vocabulary with explicit success, warning, and error icons.

## Motion

State transitions use 160ms ease-out. Drag overlays and drop indicators communicate movement. `prefers-reduced-motion` reduces all transitions to effectively instant.
