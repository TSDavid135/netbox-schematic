from importlib.metadata import PackageNotFoundError, version as _pkg_version

from netbox.plugins import PluginConfig

try:
    # Single source of truth: the installed wheel's version (pyproject). Avoids the
    # config drifting from the package (it used to be a hardcoded, stale "0.1.0").
    _VERSION = _pkg_version("netbox-schematic")
except PackageNotFoundError:   # running from a source checkout without an install
    _VERSION = "0.68.46"


class SchematicConfig(PluginConfig):
    name = 'netbox_schematic'
    verbose_name = 'Схематика'
    description = 'A visual builder for racks, cable routes, power and IP space in NetBox'
    version = _VERSION
    author = 'David Kad'
    base_url = 'schematic'
    # Excel import/export uses dcim.PortMapping (NetBox migration 0222_port_mappings),
    # which landed in 4.5 — below that NetBox refuses to load the plugin with a clear
    # message instead of crashing at import time. See «NetBox compatibility» in README.
    min_version = '4.5.0'


config = SchematicConfig
