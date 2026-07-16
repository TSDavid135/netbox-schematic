"use strict";
// AboutUI — the version badge (#pluginver, bottom-right) opens a modal with two
// tabs: «Последние изменения» (the real markdown changelog, language-aware) and
// «Обучение» (game-style tutorials: a topic tree on the left, case-driven docs
// on the right; on phones the tree takes the whole modal and a selected topic
// slides in with a back arrow).
//
// CONTENT lives in static markdown files next to the code (fetched lazily):
//   static/netbox_schematic/docs/<lang>/CHANGELOG.md
//   static/netbox_schematic/docs/<lang>/learn/<topic>.md
// <lang> — resolveLang(): the user's language once the planned language setting
// lands (localStorage "schematic.lang"), else the page/browser language; ru/en.
// A missing translation falls back to ru. Images: drop files into
// static/netbox_schematic/docs/img/ and reference ![подпись](../img/file.png).
// MAINTENANCE per release: add an entry to docs/*/CHANGELOG.md (see CHANGELOG.md header).

// Learn topics (order = the tree). key ↔ docs/<lang>/learn/<key>.md.
export const TOPICS = [
  { key: "model",   title: "Модель устройства" },
  { key: "catalog", title: "Каталог моделей" },
  { key: "device",  title: "Характеристики устройства" },
  { key: "cables",  title: "Кабели" },
  { key: "tree",    title: "Иерархия локаций и устройств" },
  { key: "schema",  title: "Схема" },
  { key: "details", title: "Детали" },
  { key: "edit",    title: "Режим редактирования" },
  { key: "racks",   title: "Стойки" },
  { key: "excel",   title: "Импорт / Экспорт" },
  { key: "header",  title: "Шапка страницы" },
];

// User language for docs: future in-app setting → page lang → browser. ru/en.
export function resolveLang() {
  let l = "";
  try { l = localStorage.getItem("schematic.lang") || ""; } catch (_) {}
  l = l || document.documentElement.lang || (navigator.language || "");
  return /^ru/i.test(l) ? "ru" : "en";
}

// Tiny markdown renderer for OUR docs: #..#### headings (shifted one level down —
// the modal owns h1), -/1. lists, **b**, *i*, `code`, images, links, ---, paragraphs.
export function mdToHtml(md) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => s
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, a, src) => `<img alt="${a}" src="${src}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");
  let html = "", list = null, para = [];
  const flushP = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const flushL = () => { if (list) { html += list.html + (list.ol ? "</ol>" : "</ul>"); list = null; } };
  for (const raw of esc(md).split(/\r?\n/)) {
    const l = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    const li = /^[-*]\s+(.*)$/.exec(l);
    const oli = /^\d+[.)]\s+(.*)$/.exec(l);
    if (h) { flushP(); flushL(); const lv = h[1].length + 1; html += `<h${lv}>${inline(h[2])}</h${lv}>`; }
    else if (/^---+\s*$/.test(l)) { flushP(); flushL(); html += "<hr>"; }
    else if (li || oli) {
      flushP();
      const ol = !!oli;
      if (!list || list.ol !== ol) { flushL(); list = { ol, html: ol ? "<ol>" : "<ul>" }; }
      list.html += `<li>${inline((oli || li)[1])}</li>`;
    } else if (!l.trim()) { flushP(); flushL(); }
    else para.push(l.trim());
  }
  flushP(); flushL();
  return html;
}

export class AboutUI {
  constructor(app) { this.app = app; this._cache = {}; }

  bind() {
    const badge = document.getElementById("pluginver");
    if (!badge) return;
    badge.classList.add("clickable");
    badge.title = "Что нового и обучение";
    badge.addEventListener("click", () => this.open());
  }

  open() {
    this._ensureDom();
    this.el.classList.add("open");
  }
  close() { if (this.el) this.el.classList.remove("open"); }

  // docs/<lang>/<rel>; missing translation (or fetch error) falls back to ru.
  async _doc(rel) {
    const lang = resolveLang();
    const key = lang + ":" + rel;
    if (this._cache[key] != null) return this._cache[key];
    const load = async l => {
      const r = await fetch(new URL(`../docs/${l}/${rel}`, import.meta.url));
      if (!r.ok) throw new Error(r.status);
      return r.text();
    };
    let text;
    try { text = await load(lang); }
    catch (_) {
      try { text = lang === "ru" ? null : await load("ru"); } catch (_) { text = null; }
    }
    if (text == null) text = "# ¯\\_(ツ)_/¯\n\nДокумент не загрузился. Обнови страницу или проверь установку плагина.";
    this._cache[key] = text;
    return text;
  }

  _ensureDom() {
    if (this.el) return;
    const badge = document.getElementById("pluginver");
    const ver = badge ? badge.textContent.trim() : "";
    const el = document.createElement("div");
    el.id = "about-bg";
    el.className = "abt-bg";
    el.innerHTML = `
      <div class="abt-modal">
        <div class="abt-head">
          <button class="abt-tab active" data-tab="log">Последние изменения</button>
          <button class="abt-tab" data-tab="learn">Обучение</button>
          <span class="abt-ver">${ver}</span>
          <button class="abt-close" title="Закрыть (Esc)">✕</button>
        </div>
        <div class="abt-body"></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    el.querySelector(".abt-close").addEventListener("click", () => this.close());
    el.addEventListener("mousedown", e => { if (e.target === el) this.close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && el.classList.contains("open")) this.close(); });
    el.querySelectorAll(".abt-tab").forEach(tab => tab.addEventListener("click", () => {
      el.querySelectorAll(".abt-tab").forEach(t => t.classList.toggle("active", t === tab));
      this._renderTab(tab.dataset.tab);
    }));
    this._renderTab("log");
  }

  async _renderTab(tab) {
    const body = this.el.querySelector(".abt-body");
    if (tab === "learn") { this._renderLearn(body); return; }
    body.innerHTML = `<div class="abt-md abt-log"><p class="abt-mut">загружаю…</p></div>`;
    const md = await this._doc("CHANGELOG.md");
    body.innerHTML = `<div class="abt-md abt-log">${mdToHtml(md)}</div>`;
    body.scrollTop = 0;
  }

  // «Обучение»: topic tree left, doc right. Mobile (CSS ≤760px): the tree fills
  // the modal; picking a topic slides the doc in, «←» returns to the tree.
  _renderLearn(body) {
    body.innerHTML = `
      <div class="abt-learn">
        <div class="abt-topics">
          ${TOPICS.map(t => `<button class="abt-topic" data-key="${t.key}">${t.title}</button>`).join("")}
        </div>
        <div class="abt-doc">
          <div class="abt-doc-head">
            <button class="abt-back" title="К списку тем"><i class="mdi mdi-arrow-left"></i></button>
            <span class="abt-doc-title"></span>
          </div>
          <div class="abt-md abt-doc-body"><p class="abt-mut">выбери тему слева</p></div>
        </div>
      </div>`;
    const learn = body.querySelector(".abt-learn");
    body.querySelector(".abt-back").addEventListener("click", () => learn.classList.remove("doc"));
    body.querySelectorAll(".abt-topic").forEach(b => b.addEventListener("click", async () => {
      body.querySelectorAll(".abt-topic").forEach(x => x.classList.toggle("active", x === b));
      learn.classList.add("doc");   // mobile: slide the tree away
      const t = TOPICS.find(x => x.key === b.dataset.key);
      body.querySelector(".abt-doc-title").textContent = t.title;
      const docBody = body.querySelector(".abt-doc-body");
      docBody.innerHTML = `<p class="abt-mut">загружаю…</p>`;
      docBody.innerHTML = mdToHtml(await this._doc(`learn/${t.key}.md`));
      docBody.scrollTop = 0;
    }));
    // Desktop nicety: open the first topic right away (mobile stays on the tree).
    if (window.matchMedia && !window.matchMedia("(max-width: 760px)").matches) {
      const first = body.querySelector(".abt-topic");
      if (first) first.click();
      learn.classList.remove("doc");
    }
  }
}
