# What's new

## 0.69.18
- Learning: the "Schema" topic gained a nodes section (ports, stack badge, the ⋮ menu); "Device model" — a scenario for per-node actions (⋮ → Model / Ports / Edit).

## 0.69.17
- Device height is governed by the **model**: the "Height, U" field in the catalog editor (applies to every device of the model; NetBox refuses when one of them lacks room). Multi-shelf click-selection in the rack is gone — a click places the device on that shelf, and it takes as many shelves as its model's height says.
- The "NU" column is gone from the catalog list (height shows in the editor and in the model picker at creation).

## 0.69.16
- "Features" became **Learning**: a topic tree on the left, mechanics explained with worked examples on the right (on phones the list comes first, a topic opens full-screen).
- "What's new" now reads the real changelog file and follows the user's language (ready for the upcoming language setting).
- The "· U1" unit tag is gone from schema nodes — the unit is visible in device details and in the rack view.

## 0.69.15
- Power inlet and outlets sharing one node row now stand apart from each other.
- The version badge became a button: what's new and learning.

## 0.69.14
- Every port row in the catalog got a side picker: auto / top / bottom. Applies to the preview immediately, to devices after "Save to type".

## 0.69.13
- PDUs, UPSes and stabilizers now distribute power through **outlets** (one round inlet). Device power ports plug into outlets — the chain panel → stabilizer → UPS → PDU → devices closes.
- Adding a device asks only for a name — ports come from the type's model (edited in the Catalog).
- Power rows (Power → Stabilizers → Power panels) stack under their server room, inside its contour.
- "Распредщиток" renamed to "Щиток".

## 0.69.12
- Feed ports on a panel are numbered 1..N (the feed name stays in its row).
- The "models without ports" warning is a visible block in the catalog, not a hover hint.

## 0.69.10–0.69.11
- Power equipment gathers into a "Power" block under the racks (not the right-side pockets).
- ⚠ on port-less «Схематика» models — in the catalog list and on the Catalog button.

## 0.69.7–0.69.9
- Applying a model matches ports by **number**: an occupied imported `eth1` becomes the model's "1", no duplicates; occupied ports keep their type — you get a warning instead.
- Fixed port selection on touch screens: the rings of the selected port and its targets are visible again.

## 0.69.0–0.69.6
- Mobile: tap tooltips, one tap — port and cable, second tap — the whole path; selection survives pan and zoom.
- Paths trace from peripherals through patch panels to the switch (all port kinds).
- Device catalog: own models, ports by kind, apply to all devices of a type or by role.
- Port tooltip shows the destination, port type and IP address.

## Earlier
- Excel import/export (Patched/Unpatched), connection audit.
- Switch stacks (VirtualChassis), Wi-Fi links, providers (Circuits).
- IPAM canvas: networks, prefixes, interface IPs, VLAN highlighting.
- Power: panels, feeds, power tracing.
