# Model catalog

The **«Каталог»** (catalog) button in the header is the library of every NetBox device type. On the left, a list grouped by manufacturer; on the right, a preview: how the model will look as a node on the diagram — in both views at once (Физический and Беспроводной, physical and wireless).

- The search at the top matches on model and manufacturer.
- «Схематика» (Schematic) models are marked «правится» (editable) — you can change their ports and height.
- A **⚠** on a model means «портов нет» (no ports): applying a model like that gives you nothing. Open it and click «Сохранить в тип» (save to type). A yellow banner above the list reminds you about such models, and a ⚠ on the «Каталог» button itself tells you that they exist at all.

## Buttons under the preview

- **«Сохранить в тип»** — write the port rows (along with the height and the sides) into the model. Devices are not touched.
- **«Применить ко всем (N)»** (apply to all (N)) — save, and add the missing ports to all N devices of the model. Nothing is deleted.
- **«↦ По роли»** (by role, in the catalog header) — assign the model to every device with that role and bring their ports in line with it: by number, occupied ports keep their cable, spare free ones are deleted.
- **Корзина** (trash) — delete the model (NetBox won't let you while devices of that model exist).

## Scenario: look at someone else's model

Models from other manufacturers (imported ones, for example) open read-only: the preview and the set of ports are visible, there is no editor. Want the same thing as your own — create one with «+» and repeat the rows.

## On a phone

The list and the preview are two screens: tapping a model takes you to the preview, the «←» arrow brings you back to the list.
