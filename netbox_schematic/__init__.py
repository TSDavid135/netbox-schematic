from netbox.plugins import PluginConfig


class SchematicConfig(PluginConfig):
    name = 'netbox_schematic'
    verbose_name = 'Схематика'
    description = 'Визуальный конструктор стоек и кабельных трасс'
    version = '0.1.0'
    author = 'kadim'
    base_url = 'schematic'


config = SchematicConfig
