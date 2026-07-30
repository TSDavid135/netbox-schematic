# Racks

The rack view (the tab above the schema) — the physical side: units, shelves, who stands where.

## Reading it

- A rack is a frame with numbered units; devices are tiles as tall as their own U (a 2U model is a tile two shelves high).
- Long empty ranges are collapsed into «⇕ N» — hover to see which units they are; in edit mode they expand.
- Hovering a unit shows its number and whether it is taken; clicking a device opens its details and highlights the node on the schema.

## Scenario: put a device into a rack

1. Turn on ✏️ and click a free unit — it lights up green (click again to cancel).
2. «Занять место?» (take this spot?) → **Да** (yes) → name, model, role → «Создать» (create).
3. The device takes as many shelves as the **height of its model** (you can see it in the list: «Коммутатор (1U)» — switch, «Сервер (2U)» — server) — the unit you clicked becomes the bottom shelf.

Height is a property of the **model**, the same for every device of that model; it is edited in the catalog («Высота, U» — height in units). To make an existing device take more shelves, raise the height of its model there (NetBox refuses if the neighbouring shelf is taken) or give it a model of the height you need (details → pencil → «Тип»).

## Scenario: build a stack right at creation time

The device creation window has a list of stacks on the right: pick an existing VirtualChassis and the new switch joins it as a member (the position is taken from the «/N» suffix of the name).

## Moving

To move a device to another rack/unit — details → pencil (the «Стойка» and «Юнит» fields — rack and unit), or drag the device onto the rack you want in the tree.
