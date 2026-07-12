# tests

Server-side checks for netbox-schematic. They talk to a live NetBox (ORM + URL
routing), so run them **from a NetBox checkout** with the plugin installed.

| File | What it does | DB writes |
|------|--------------|-----------|
| `check_compat.py` | Version-compatibility probe: the model fields, own endpoints and NetBox REST routes the plugin assumes (see `../check.md`). Prints `OK/FAIL/WARN`. | none (introspection + URL resolve) |
| `test_release.py` | Release smoke test: import-conflict detection (join on socket), «Без замены/Заменить» re-cabling, export filling the real template, the rack duplicate-slot fix, wireless delete order. | inside one transaction, **rolled back** (`_tx.py`) |
| `_tx.py` | Real-rollback helper for shell scripts (autocommit off → `rollback()` actually undoes). | — |

## Run

```bash
cd /opt/netbox/netbox            # (or your NetBox dir)
PY=/opt/netbox/venv/bin/python   # the NetBox venv python

# compatibility (read-only) — point sys.path at this folder for _tx:
$PY manage.py shell -c "exec(open('/path/to/tests/check_compat.py').read())"

# release smoke test (rolled back):
$PY manage.py shell -c "import sys; sys.path.insert(0,'/path/to/tests'); exec(open('/path/to/tests/test_release.py').read())"
```

`check_compat.py` is the one to run when trying the plugin on a **different NetBox
version** — every `FAIL` names a changed field/endpoint that needs a shim.
