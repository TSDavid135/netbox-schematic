# Edit mode

The **✏️** button in the header. Without it the schema is "read only": look, select, trace paths. With it — you build.

## What it opens up on the schema

- **Cables**: click a free port → a red ring, green targets → a second click → the cable type → done.
- **The link menu** on taken ports: delete or re-connect the cable.
- **«+ добавить фидер»** (add feed) right on the panel card.
- **The model bar on a node**: change the device model without going into the details — the ports are brought in line with the new model (by number; taken ones are kept).
- **Shifting port numbers** («Порты» on the node — shift free-port numbers): the free ports of a category get new numbering — handy after a patch cord has moved.

## What it opens up on racks

Clicking free units builds a **range** (green highlight), «Занять место?» (take the space?) → «Да» (yes) → a device is created on those units. More detail — the "Racks" topic.

## Safeguards

- While the model picker or the number shift is open, no new links are created (so that a click on a port does not "build a cable" by accident).
- When a model is applied, taken ports are not renamed into a conflict and do not change type — you only get a warning.
- Deleting a cable does not touch the ports or the IPs.

Turn ✏️ off — and the schema is safe for "just looking" again.
