# -*- coding: utf-8 -*-
"""Real rollback for `manage.py shell -c` scripts.

`transaction.savepoint()` is a no-op outside an atomic block (autocommit),
so `savepoint_rollback()` silently commits everything. Leaving autocommit
opens a genuine transaction that `rollback()` can undo — and a crash rolls
back too, because the connection dies with the shell.
"""
from django.db import transaction


def begin():
    transaction.set_autocommit(False)


def rollback(*models):
    """Undo everything, then prove the objects really vanished."""
    transaction.rollback()
    transaction.set_autocommit(True)
    left = ["%s=%d" % (m.__name__, m.objects.filter(**q).count())
            for m, q in models]
    print("rolled back (leftovers: %s)" % (", ".join(left) or "none checked"))
