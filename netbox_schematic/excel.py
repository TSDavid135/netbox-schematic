# -*- coding: utf-8 -*-
"""
excel.py — pluggable Excel forms for import/export.

A "form" describes ONE spreadsheet layout declaratively. Columns are matched by
NAME (label + aliases, fuzzy), never by position, so a user may rename, reorder
or insert columns and the import still works. Positions are used only when
WRITING, to reproduce the original template.

Third-party plugins add their own form by subclassing ExcelForm and calling
register_form() — nothing in the core needs to change:

    from netbox_schematic.excel import Col, ExcelForm, register_form

    @register_form
    class MyForm(ExcelForm):
        id = "my-form"
        label = "My cabling sheet"
        columns = [
            Col("location", "Room", aliases=["серверная", "Technikraum"], pos=1),
            Col("socket",   "Outlet", aliases=["розетка", "Dose"], pos=2),
        ]
        def build_plan(self, records, **o): ...
        def apply_plan(self, plan, site, **o): ...
        def collect(self, **scope): ...
"""

import datetime
import difflib
import io
import re

# ── column matching ──────────────────────────────────────────────────────────

_PUNCT = re.compile(r"[^0-9a-zA-Zа-яёА-ЯЁäöüßÄÖÜ ]+")
MATCH_THRESHOLD = 0.72


def norm(text):
    """Fold a header caption to a comparable form: lowercase, ё→е, no punctuation."""
    s = str(text or "").lower().replace("ё", "е").replace("ß", "ss")
    s = _PUNCT.sub(" ", s)
    return " ".join(s.split())


def score(cell_text, name):
    """0..1 similarity of a header cell against one candidate column name.

    Short tokens only ever match exactly: a data cell "SW" must not be mistaken
    for the caption "sw port", and "pf"/"tel"/"kst" are too small for fuzz.
    """
    a, b = norm(cell_text), norm(name)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if min(len(a), len(b)) < 4:
        return 0.0
    if b in a or a in b:
        return 0.92
    return difflib.SequenceMatcher(None, a, b).ratio()


class Col:
    """One column of a form.

    label   — caption written on export (and the primary name to match on import)
    sub     — optional second header line (e.g. the Russian caption)
    aliases — other spellings/languages accepted on import
    pos     — 1-based column index used on export (keeps the template's shape)
    after   — this column has NO caption of its own because the header cell is
              merged with the previous one; find it right of column `after`
    """

    def __init__(self, key, label="", sub="", aliases=(), pos=None, after=None, label_en=""):
        self.key = key
        self.label = label
        self.sub = sub
        self.aliases = tuple(aliases)
        self.pos = pos
        self.after = after
        self.label_en = label_en   # English caption (export lang="en")

    def header(self, lang="ru"):
        """Caption written on export for the chosen language."""
        return (self.label_en or self.label) if lang == "en" else self.label

    @property
    def names(self):
        # An `after`-anchored column shares its header cell with the previous one
        # (merged), so its apparent caption ("№ порта") is ambiguous — drop the
        # generic `sub` and keep only explicit aliases. If the sheet does give it
        # a real caption, the alias still finds it; otherwise `after` resolves it.
        if self.after:
            return tuple(n for n in self.aliases if n)
        return tuple(n for n in (self.label, self.sub) + self.aliases if n)

    def best(self, cell_text):
        return max((score(cell_text, n) for n in self.names), default=0.0)


def cell_str(v):
    """openpyxl cell value → string.

    Excel silently turns switch references like "6902/1/08" into a DATE (that is
    a valid Y/M/D), so a datetime is turned back into "year/month/day". Whole
    floats ("10.0") lose the tail.
    """
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return "%d/%d/%02d" % (v.year, v.month, v.day)
    if isinstance(v, datetime.date):
        return v.strftime("%d.%m.%Y")
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


# ── the form base class ──────────────────────────────────────────────────────

class ExcelForm:
    id = ""
    label = ""
    columns = ()

    title = None            # merged caption written on row 1 (export)
    sheet_name = None       # worksheet tab name (export); defaults to `label`
    header_row = 1          # row that carries `label` captions (export)
    sub_row = None          # optional row for `sub` captions (export)
    scan_rows = 30          # how deep to look for the header when importing
    key_columns = ()        # columns that must be present for a row to count
    template = None         # optional .xlsx in forms/templates/ — export fills THIS
                            # (exact title/header/merges/styling) instead of building
                            # the sheet from scratch. Data rows land after the header.

    # ── domain hooks (implemented by concrete forms) ──
    def build_plan(self, records, **opts):
        raise NotImplementedError

    def apply_plan(self, plan, site, **opts):
        raise NotImplementedError

    def collect(self, **scope):
        raise NotImplementedError

    def placement(self, plan):
        """Optional: rack layout for the import dialog (racks + standalone
        devices). Default — nothing to arrange."""
        return {"racks": [], "standalone": []}

    def warnings(self, plan):
        """Optional: inconsistencies to show in the preview — [{"row", "msg"}].
        They don't block the import; they tell the user what WON'T be created.
        Form-specific (the patch sheet and the power sheet check different
        things), so it must never be hardwired to one form's checker."""
        return []

    def conflicts(self, plan, site):
        """Optional: what the plan collides with in `site` (rendered as the
        keep/overwrite table). Default — no collisions to report."""
        return {"devices": [], "occupancy": {}, "columns": []}

    @classmethod
    def importable(cls):
        """False for export-only layouts (they never implemented build_plan)."""
        return cls.build_plan is not ExcelForm.build_plan


# ── registry ────────────────────────────────────────────────────────────────

_FORMS = {}


def register_form(cls):
    """Class decorator: make a form discoverable by the import/export UI."""
    if not cls.id:
        raise ValueError("ExcelForm needs a non-empty id")
    _FORMS[cls.id] = cls
    return cls


def all_forms():
    autodiscover()
    return dict(_FORMS)


def get_form(form_id=None):
    autodiscover()
    if form_id:
        cls = _FORMS.get(form_id)
        if cls is None:
            raise KeyError("unknown Excel form: %r" % form_id)
        return cls()
    if not _FORMS:
        raise KeyError("no Excel forms registered")
    return next(iter(_FORMS.values()))()


_discovered = False


def autodiscover():
    """Import the bundled forms once; third parties register from their AppConfig."""
    global _discovered
    if _discovered:
        return
    _discovered = True
    from . import forms  # noqa: F401  (importing registers the bundled forms)


# ── reading ─────────────────────────────────────────────────────────────────

def _find_header(ws, form, max_col):
    """Return (header_end_row, {col.key: 1-based column index}).

    Headers may span several rows (a German line and a Russian one), so the text
    of rows 1..header_end is concatenated per column before matching.
    """
    scan = min(ws.max_row or 1, form.scan_rows)
    grid = [[cell_str(ws.cell(r, c).value) for c in range(1, max_col + 1)]
            for r in range(1, scan + 1)]

    named = [c for c in form.columns if c.names]

    # A header row matches at least TWO different columns. One match is noise —
    # a data cell ("SW", "Internet") can look like a caption by accident.
    header_end = 0
    for r in range(scan):
        hits = {col.key for c in range(max_col) for col in named
                if col.best(grid[r][c]) >= MATCH_THRESHOLD}
        if len(hits) >= 2:
            header_end = r + 1
    if not header_end:
        return 0, {}

    merged = [" ".join(x for x in (grid[r][c] for r in range(header_end)) if x)
              for c in range(max_col)]

    # Global greedy assignment: strongest (column, header) pairs win first, so a
    # weak match cannot steal a spreadsheet column from a strong one.
    pairs = []
    for col in named:
        for i, text in enumerate(merged):
            if not text:
                continue
            s = col.best(text)
            if s >= MATCH_THRESHOLD:
                pairs.append((s, col.key, i))
    pairs.sort(key=lambda p: -p[0])

    mapping, taken = {}, set()
    for _s, key, i in pairs:
        if key in mapping or i in taken:
            continue
        mapping[key] = i + 1
        taken.add(i)

    # Columns whose header cell is merged with the previous one carry no caption
    # of their own — they sit immediately to the right of their anchor.
    for col in form.columns:
        if col.key not in mapping and col.after and col.after in mapping:
            mapping[col.key] = mapping[col.after] + 1
    return header_end, mapping


def detect_form(file_or_path, default="patchen"):
    """Guess which registered form a workbook is laid out in — so the import can
    take a Патчен sheet or a «Питание» sheet without asking. Scores every form by
    how many of ITS columns the header actually matches (key columns must be
    among them, else the form can't drive an import); ties go to the form with
    more matched columns, then to `default`.
    Read-only: the caller re-opens the file to parse it."""
    best, best_score = None, 0
    for cls in all_forms().values():         # registry holds CLASSES (get_form instantiates)
        # Export-only layouts (e.g. «universal») can't drive an import.
        if not cls.importable():
            continue
        form = cls()
        try:
            records, meta = read_records(file_or_path, form)
        except Exception:
            continue
        finally:
            try:
                file_or_path.seek(0)      # rewind the upload for the next probe
            except Exception:
                pass
        keys = form.key_columns or ()
        mapping = meta.get("columns") or {}
        if keys and not all(k in mapping for k in keys):
            continue
        if not records:
            continue
        score_ = len(mapping) + (2 if keys else 0)
        if score_ > best_score:
            best, best_score = form, score_
    return best or get_form(default)


def read_records(file_or_path, form):
    """Spreadsheet → (records, meta). records = [{col.key: str}] from the data rows."""
    from openpyxl import load_workbook
    wb = load_workbook(file_or_path, data_only=True, read_only=True)
    ws = wb.active
    max_col = max(ws.max_column or 1, max((c.pos or 0) for c in form.columns), 1)

    header_end, mapping = _find_header(ws, form, max_col)
    if not mapping:
        wb.close()
        raise ValueError("не удалось распознать шапку — колонки не совпали ни с одной формой")

    keys = form.key_columns or tuple(c.key for c in form.columns)
    records, skipped = [], 0
    for r in range(header_end + 1, (ws.max_row or 0) + 1):
        rec = {c.key: (cell_str(ws.cell(r, mapping[c.key]).value) if c.key in mapping else "")
               for c in form.columns}
        if not any(rec.get(k) for k in keys):
            skipped += 1
            continue
        rec["row"] = r
        records.append(rec)
    wb.close()

    missing = [c.key for c in form.columns if c.names and c.key not in mapping]
    return records, {"form": form.id, "header_end": header_end, "skipped": skipped,
                     "sheet": ws.title, "columns": mapping, "missing": missing}


# ── writing ─────────────────────────────────────────────────────────────────

def _template_path(form):
    """Absolute path to the form's export template (.xlsx in forms/templates/), or
    None if the form ships none / the file is missing."""
    name = getattr(form, "template", None)
    if not name:
        return None
    import os
    from . import forms
    p = os.path.join(os.path.dirname(forms.__file__), "templates", name)
    return p if os.path.exists(p) else None


def write_workbook(form, records, lang="ru"):
    """records ({col.key: value}) → .xlsx bytes. If the form ships a real template,
    fill THAT (its exact title / multi-row header / merges / styling); otherwise
    build the sheet from the column defs. lang picks captions for the built sheet."""
    path = _template_path(form)
    if path:
        try:
            return write_from_template(form, records, path)
        except Exception:
            pass   # any template glitch → fall back to the generated sheet
    return _build_workbook(form, records, lang)


def write_from_template(form, records, path):
    """Fill the form's real .xlsx template with data rows, so the export looks
    EXACTLY like the sheet users import. Column→cell mapping reuses the SAME header
    detection as import (so a reordered/renamed template still lines up); rows land
    right after the detected header. No captions are written — they're in the template."""
    from openpyxl import load_workbook
    wb = load_workbook(path)                       # keep the template's styles/merges
    ws = wb.active
    max_col = max(ws.max_column or 1, max((c.pos or 0) for c in form.columns), 1)
    header_end, mapping = _find_header(ws, form, max_col)
    if not mapping:
        return _build_workbook(form, records)      # template unreadable → generated sheet
    first = header_end + 1
    for i, rec in enumerate(records):
        for c in form.columns:
            col = mapping.get(c.key)
            if col and rec.get(c.key, "") != "":
                ws.cell(first + i, col, rec[c.key])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_workbook(form, records, lang="ru"):
    """Generate the sheet from the form's column defs (used when there's no template)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    cols = list(form.columns)
    for i, c in enumerate(cols, start=1):
        if c.pos is None:
            c.pos = i
    ncol = max(c.pos for c in cols)

    wb = Workbook()
    ws = wb.active
    # Excel forbids : \ / ? * [ ] in a sheet name, and caps it at 31 chars.
    raw = form.sheet_name or form.label or form.id
    ws.title = re.sub(r"[:\\/?*\[\]]", "-", raw)[:31].strip() or "Sheet1"

    if form.title:
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
        t = ws.cell(1, 1, form.title)
        t.font = Font(bold=True, size=14)
        t.alignment = Alignment(horizontal="center")

    fill = PatternFill("solid", fgColor="DDE7F0")
    for c in cols:
        cell = ws.cell(form.header_row, c.pos, c.header(lang))
        cell.font = Font(bold=True)
        cell.fill = fill
        cell.alignment = Alignment(horizontal="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(c.pos)].width = 15
        if form.sub_row and c.sub:
            s = ws.cell(form.sub_row, c.pos, c.sub)
            s.font = Font(italic=True, size=9, color="607080")
            s.alignment = Alignment(horizontal="center", wrap_text=True)

    first_data = (form.sub_row or form.header_row) + 1
    for i, rec in enumerate(records):
        for c in cols:
            v = rec.get(c.key, "")
            if v != "":
                ws.cell(first_data + i, c.pos, v)
    ws.freeze_panes = "A%d" % first_data

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
