# Writing a custom Excel form

The plugin's Excel **import** and **export** run on a small pluggable registry. A
form is one Python class that describes a spreadsheet's columns and knows how to
turn rows into NetBox objects (import) and objects back into rows (export). Drop
your class into the `forms/` package and it shows up automatically in the import
and export dialogs — no changes to the views, URLs, or JavaScript.

The built-in `PatchenForm` (`forms/patchen.py`) is a full working example.

## Where forms live

```
netbox_schematic/
  excel.py            # the engine: ExcelForm, Col, register_form, the matcher
  forms/
    __init__.py       # imports every form module so registration runs
    patchen.py        # the built-in "Patchen / Unpatchen" form
    your_form.py      # <- your form goes here
```

`forms/__init__.py` imports each module; importing a module runs its
`@register_form` decorator. Add one line there for your module:

```python
from . import your_form  # noqa: F401
```

## Anatomy of a form

```python
from ..excel import ExcelForm, Col, register_form

@register_form
class InventoryForm(ExcelForm):
    id = "inventory"                     # unique slug (used in the API + dialogs)
    label = "Инвентаризация устройств"   # human name shown in the pickers
    title = "Инвентаризация"             # merged caption written on export row 1
    sheet_name = "Устройства"            # worksheet tab name on export
    header_row = 3                       # row that carries the column captions
    key_columns = ("name",)             # a row without these is skipped on import

    columns = [
        #   key       label (caption)   sub (2nd line)  aliases (import synonyms)
        Col("name",   "Gerät",          "устройство",   ["device", "имя", "name"]),
        Col("role",   "Rolle",          "роль",         ["role", "тип"]),
        Col("rack",   "Schrank",        "стойка",       ["rack", "шкаф", "dvs"]),
        Col("unit",   "HE",             "юнит",         ["unit", "u", "position"]),
    ]
```

### `Col` — one column

| arg       | meaning |
|-----------|---------|
| `key`     | the field name your `build_plan`/`collect` use |
| `label`   | caption written on **export**, and the primary name matched on **import** |
| `sub`     | optional second header line (e.g. the Russian caption) |
| `aliases` | other spellings/languages accepted on **import** (order-independent) |
| `pos`     | 1-based column index to force on export (keeps a fixed template's shape) |
| `after`   | for a column whose header cell is merged into the previous one — found to the right of column `after` |

The importer matches header cells to columns **by name**, not by position, so a
renamed or reordered sheet still imports. Matching is fuzzy (case-, ё/е- and
punctuation-insensitive) with a similarity threshold; add real-world spellings to
`aliases` when users type something unexpected.

## The three hooks

A concrete form implements up to three methods. Import needs the first two,
export needs the third — implement only what your form supports.

```python
    def build_plan(self, records, **opts):
        """records: list[dict] keyed by your Col.key. Return (plan, summary).
        Pure data-shaping only — NO database writes here (this runs for the
        preview too). `plan` is whatever apply_plan expects."""
        ...

    def apply_plan(self, plan, site, **opts):
        """Create/find NetBox objects for `plan` inside `site`. Runs in the
        caller's transaction; be idempotent (get_or_create) so re-import doesn't
        duplicate. Return a stats dict, e.g. {"dev": 12, "cable": 8}."""
        ...

    def collect(self, **scope):
        """EXPORT: return list[dict] (one per row) for the selected scope.
        scope arrives as location_ids / rack_ids / site_ids / device_ids."""
        ...
```

`records` for import and the dicts from `collect` both use your `Col.key`s, so a
clean round-trip (export → import) is just matching keys.

Keep domain logic in its own module and let the form delegate — `PatchenForm`
forwards to `importer.py` / `exporter.py` rather than inlining everything.

## How it reaches the UI

Once registered, the engine exposes your form with no extra wiring:

- `GET /plugins/schematic/forms/` — lists every form (id, label, columns) for the
  dialogs to build their pickers.
- `POST /plugins/schematic/import/` with `form=<id>` — preview then commit.
- `POST /plugins/schematic/export/` with `form=<id>` — writes the workbook via
  your `columns` (captions from `label`/`sub`, order from `pos`).

## Checklist

- [ ] class subclasses `ExcelForm`, decorated with `@register_form`
- [ ] unique `id`, a `label`, and a `columns` list of `Col`s
- [ ] `key_columns` set so junk rows are ignored on import
- [ ] `build_plan` + `apply_plan` for import (idempotent writes)
- [ ] `collect` for export
- [ ] module imported in `forms/__init__.py`
