# Design System

## Direction

Dark creative-tool workbench. A restrained near-black canvas carries a functional full palette: violet for hair/style, cyan for color, amber for fringe/warnings, coral for accessories and destinations, emerald for success.

## Color

CSS tokens use OKLCH. Neutral surfaces are separated by spacing and thin dividers. Category branches inherit a hue, while selected tags always use the same cyan selection vocabulary. Destructive red is reserved for deletion.

## Typography

Inter, Yu Gothic UI, Meiryo UI, and system sans-serif fallback. Product text uses a compact fixed scale: 11px metadata, 12px controls, 13–15px rows and headings, 16px app title.

## Layout

Desktop reference viewport is 1440×1024. The shell is toolbar, work area, and persistent selection dock. Work area uses a 360px hierarchy sidebar and a four-lane horizontally resilient kanban. Below 1180px the sidebar narrows; below 760px it stacks above the kanban.

## Components

- Category rows: disclosure, level marker, bilingual label, count, dedicated drag handle.
- Tag rows: checkbox, prompt, Japanese translation, duplicate badge, drag handle, action button.
- Lanes: category-colored header, search, visible-selection action, virtualized rows, exact drop indicator.
- Selection dock: count, hierarchical destination, move alternatives, selected-only filter, deletion, preview.
- Dialogs and toasts: native product vocabulary with explicit success, warning, and error icons.

## Motion

State transitions use 160ms ease-out. Drag overlays and drop indicators communicate movement. `prefers-reduced-motion` reduces all transitions to effectively instant.
