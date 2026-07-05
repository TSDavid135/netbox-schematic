from netbox.plugins import PluginMenuItem

menu_items = (
    PluginMenuItem(
        link='plugins:netbox_schematic:schematic',
        link_text='Инфраструктура',
    ),
    PluginMenuItem(
        link='plugins:netbox_schematic:network',
        link_text='Сети',
    ),
    PluginMenuItem(
        link='plugins:netbox_schematic:virtualization',
        link_text='Виртуализация',
    ),
    PluginMenuItem(
        link='plugins:netbox_schematic:vpn',
        link_text='Туннели',
    ),
)
