# Location and device hierarchy

The tree on the left is a map of everything: **regions → site groups → sites → server rooms → racks, power panels and devices**. Clicking a node loads that area onto the schema: a server room is one room, a site is all of its server rooms, a region is everything at once with frames.

## What the tree can do

- **Click** — load an area (the current one is highlighted).
- **Right click / long press** — the «Добавить» (Add) menu: a server room, a rack, a power panel, a feed, a device from the ready-solutions palette.
- **Drag and drop**: a device → into a rack or a server room; a rack → into another server room; a power panel → into a server room; a feed → into another power panel. The schema redraws itself.
- The icons hint at the type: rack, power panel, PDU, switch — each has its own.

## Scenario: a new server room from scratch

1. Right-click a site → «Добавить» → «Серверная» (server room), give it a name.
2. Right-click the server room → «Стойка» (rack) — a column appears on the schema.
3. From the same menu — «Силовой щит» (power panel), and inside the panel — a feed.
4. Devices — from the «+» palette on the schema or from that same menu.

## Scenario: a device is in the wrong server room

Drag it in the tree onto the right server room (or rack). Cables survive the move — but on the schema a link between server rooms becomes "cross-room" and runs outside the frame.

## Search and filter

The search box in the header finds devices/racks by name and jumps to them. The role filter hides everything unnecessary on the schema (for example, show only cameras and switches).
