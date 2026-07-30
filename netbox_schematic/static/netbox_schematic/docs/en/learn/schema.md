# Schema

The main canvas. Everything selected in the tree is drawn here: racks as columns, devices as nodes with port dots, cables as wires.

## Navigation

- Wheel / pinch — zoom; dragging the background — panning.
- On a touch screen: one finger — panning, two — zoom. Tooltips open on tap.

## Nodes

A node is a device card. On the left — a colored role stripe; on top — the **name** (click for details) and the model; off-rack devices also get a type icon (camera, PC, router…).

- Along the edges — **port dots**: color and shape follow the port type (legend in the schema settings), a filled dot means the port is taken; hover/tap — a tooltip with the type, the link direction and the IP.
- Row labels («ИНТЕРФЕЙСЫ» — interfaces, «ПИТАНИЕ» — power, «FRONT», «REAR») show which ports are where; an inlet and outlets sharing one row stand apart from each other.
- A stack badge to the left of the name means the device is in a stack (VirtualChassis); the number is how many members it has.
- In edit mode the node gets a **⋮** menu — targeted actions on the device: model, port numbers, parameters (in detail — the "Device model" topic).

## How the layout works

- **Racks** — columns; the devices inside them run top to bottom by unit.
- **Off-rack devices** — "pockets" to the right of the racks of their own server room, grouped into frames by type: Камеры, ПК, Точки доступа… (cameras, PCs, access points).
- **Power** — in rows under the racks: «Питание» (power: PDUs, UPSes), «Стабилизаторы» (stabilizers), «Силовые щиты» (power panels). The electrical chain reads bottom to top: panel → stabilizer → UPS/PDU → racks.
- **Frames**: dashed borders around server rooms and sites; everything that belongs to a room stays inside its frame.

## Views and wires

- The **Физический / Беспроводной** (physical / wireless) view — a toggle in the header: copper and optical ports, or radio interfaces and Wi-Fi links.
- Wire styles: smooth or angular, over the nodes or under them — settings in the schema panel.
- Port dots are colored by type (legend in the schema settings): network, front/rear, inlets, outlets, feeds, consoles.

## Scenario: look at the path of a single device

Click a device in the **tree** — a single-device view opens: the node and the "whiskers" of its links. A tap on a port adds its neighbor, another tap — further along the chain. That is how you wander the network from any point. To go back — click a server room in the tree.
