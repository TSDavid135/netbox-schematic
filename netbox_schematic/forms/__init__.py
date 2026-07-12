# -*- coding: utf-8 -*-
"""Bundled Excel forms. Importing this package registers them.

Third-party plugins register their own forms from their AppConfig.ready():

    from netbox_schematic.excel import register_form
    from .my_form import MyForm            # decorated with @register_form
"""

from . import patchen   # noqa: F401
from . import universal  # noqa: F401
