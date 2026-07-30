# Device model

A model is a device's "blueprint": which ports it has (kind, type, count, side on the node) and how tall it is in units. Devices **are born with the model's ports**: create a camera and it already has an eth and a power inlet; create a PDU and it has an inlet and eight outlets. Change the model and all of its devices change.

Your own models live under the manufacturer «Схематика» (Schematic) — those are the only ones you can edit.

## Scenario: your own model from scratch

1. Header → **Каталог** (catalog) → the square «+» button.
2. Name the model (for example «Коммутатор 16P», a 16-port switch) and set its height in U.
3. An empty node and the port editor appear in the preview. Add rows: `Интерфейс · 1G медь · 16` (interface · 1G copper · 16), `Power (ввод) · 1` (power · inlet · 1).
4. **«Сохранить в тип»** (save to type) — the ports are written into the model. From now on devices of this model are created with their ports already in place.

## Scenario: the model has the wrong ports

You imported devices, but the camera model is empty (⚠ in the catalog):

1. Каталог → open the model with the ⚠.
2. Set up the port rows and click «Сохранить в тип».
3. **«Применить ко всем (N)»** (apply to all (N)) — the missing ports are added to all N devices. Existing ports, their cables and IPs are not touched.

## Scenario: give devices their correct ports back

After the import the cameras' port was named `eth1`, while the model gives «1». Каталог → **«↦ По роли»** (by role) → role «Камера» (camera) + model «IP-камера» (IP camera). Ports are matched **by number**: an occupied `eth1` becomes «1» and keeps its cable, spare free ports are deleted, missing ones are added. If an occupied port's type doesn't match the model, the type is left as it is and you get a warning.

## Scenario: a device across several rack shelves

How many shelves a device takes up is decided by the **model's height** — the «Высота, U» (height, U) field in the catalog editor. Set a model to 2 and **all** of its devices take two shelves each (every device of one model has the same height, that's how NetBox works). If one of them doesn't have enough room in its rack, NetBox refuses and names it — free up the shelf above it first. A single non-standard device gets its own model of the height you need.

## Scenario: one node at a time (⋮)

Changing something on **one** device is easier right on the diagram: turn on edit mode (✏️) and click **⋮** on the node:

- **Модель** (model) — change the model of this particular device without opening its details: ports are brought in line with the new model by number, occupied ones keep their cables (a type mismatch gives a warning).
- **Порты** (ports) — shift the sequence numbers of the **free** ports in a category (occupied ones are not touched): handy when patch cords have moved and the numbering has "drifted".
- **Изменить** (edit) — the full device parameter form: name, status, role, rack, unit, serial number, description.

## Port side

Every row in the editor has a «Сторона» (side): **авто** (auto — interfaces and outlets on top, inlets and consoles at the bottom), **сверху** (top) or **снизу** (bottom). Front/rear pairs and Wi-Fi don't get a side — theirs is fixed by their very meaning.
