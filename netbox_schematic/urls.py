from django.urls import path

from .views import (SchematicView, SchematicGraphView, SchematicImportView,
                    SchematicExportView, SchematicFormsView, SchematicAuditView)

urlpatterns = [
    # Empty path = the infrastructure canvas (the 'schematic' name is kept
    # for backward compatibility with old links to the plugin).
    path('', SchematicView.as_view(canvas='infra'), name='schematic'),
    path('network/', SchematicView.as_view(canvas='network'), name='network'),
    path('virtualization/', SchematicView.as_view(canvas='virtualization'), name='virtualization'),
    path('vpn/', SchematicView.as_view(canvas='vpn'), name='vpn'),
    # Fast scope loading in a single request (see SchematicGraphView) —
    # /plugins/schematic/graph/?rack_id=…&site_id=…
    path('graph/', SchematicGraphView.as_view(), name='graph'),
    # "Patchen/Unpatchen" Excel import (preview/commit) — /plugins/schematic/import/
    path('import/', SchematicImportView.as_view(), name='import'),
    # Export of the selected scope to the same xlsx template — /plugins/schematic/export/
    path('export/', SchematicExportView.as_view(), name='export'),
    # Excel forms registered by this plugin and by others — /plugins/schematic/forms/
    path('forms/', SchematicFormsView.as_view(), name='forms'),
    # Campus audit — what's missing and where — /plugins/schematic/audit/
    path('audit/', SchematicAuditView.as_view(), name='audit'),
]
