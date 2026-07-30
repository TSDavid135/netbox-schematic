# Cables

## Reading links

- **Tap/click a port** — the port itself, its counterpart and the cable between them light up; everything else dims. The tooltip gives the port type, where the link goes and the IP.
- **A second tap on the same port** — **the whole path**: from the camera through the socket and the patch panel to the switch port. Works from any type of port.
- Tapping an empty spot clears the selection. Panning and zooming do **not** reset the selection.

## Building a cable

1. Turn on **edit mode** (✏️ in the header).
2. Click a **free** port — it gets a red ring, and compatible targets light up green.
3. Click the second port, pick the cable type (медь/оптика/питание — copper/fiber/power; the list depends on the pair of ports) — the cable is created.

Clicking an **occupied** port in edit mode opens the link menu: view, delete, reconnect.

## What connects to what

- network interface ↔ interface, front port of a patch panel/socket;
- front ↔ interfaces and front; rear ↔ rear (a trunk between panels);
- **power inlet ↔ outlet or a power panel feed** (inlet to inlet — never: both of them "consume");
- console ↔ console server.

A patch panel and a socket are "pass-through": the path runs straight through them, which is why a second tap shows the whole chain up to the switch.

## Scenario: power a rack

1. Create a feed on the power panel («+ добавить фидер» — add feed — on the power panel card in edit mode).
2. The feed's port (on the left of the power panel card) → the stabilizer's inlet.
3. The stabilizer's outlet → the UPS inlet, the UPS outlet → the PDU inlet.
4. The PDU's outlets → the devices' inlets. The «Питание» (power) layer shows the whole chain at once.

## Layers

The layers button in the header: Питание, Console, VLAN-подсветка (VLAN highlighting), Wi-Fi, Circuits — each layer highlights its own links and ports without getting in the way of the others.
