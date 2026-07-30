# Device specs

Clicking a **device name** (on a node, in the tree or in the rack view) opens the details panel on the right — the device's spec sheet.

## What's in the spec sheet

- Header: name, model, role, rack and unit, status, serial number.
- **Порты** (ports) — all of them, by kind, with their occupancy: for an occupied port you can see where the cable goes; clicking the row highlights the link on the diagram.
- **IP-адреса** (IP addresses) on interfaces — green chips. The «+ адрес» (+ address) button assigns an IP right here (or on the node in the Беспроводной (wireless) / network view).
- **Стек** (stack): if this is a switch, you can assemble a VirtualChassis: pick the members, set their positions, one of them becomes the master. Member names must differ (NetBox requires uniqueness within a site).

## Editing (the pencil in the spec sheet header)

Opens the full form: name, status, role, model, platform, site / server room / rack / unit / side, serial number, description. This is how a device is moved to another rack or unit.

- The unit is **one** position (the bottom one); how many shelves the device takes up is decided by **its model's height** (Каталог (catalog) → «Высота, U», height in U) — the same for every device of the model.
- Changing the model here changes the type only; to bring the ports in line with the new model use Каталог → «По роли» (by role), or change the model on the node itself in edit mode.

## Scenario: give a camera an IP

1. Click the camera's name → details.
2. In the interface row, «+ адрес» → enter `10.0.1.15/24`.
3. The IP appears as a chip and shows up in the port's tooltip on the diagram.

## Scenario: add a non-standard port

Details → «+ порт» (+ port): name, kind (сетевой / патч-пара / ввод питания / розетка / консоль — network / front-rear pair / power inlet / outlet / console) and type. For a one-off port this is faster than changing the model.

While you edit, the panel keeps its scroll position — handy for changing several fields in a row.
