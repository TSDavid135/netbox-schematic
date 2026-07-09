"use strict";
// Мобильная адаптация — поведение выезжающих блоков. Вся РАСКЛАДКА в
// css/responsive.css (media-queries); здесь только тумблеры классов на <body>:
//   body.nav-open   — открыт сайдбар-drawer;
//   body.sheet-open — открыта шторка деталей снизу.
// На десктопе эти классы ни на что не влияют (правила — внутри media-queries),
// а #navtoggle display:none → кликнуть нельзя. Поэтому модуль безопасен везде и
// подключается отдельным <script> (не через main.js), работает на всех холстах.

const body = document.body;
const close = () => body.classList.remove("nav-open", "sheet-open");

// ☰ → открыть/закрыть drawer (и погасить шторку, чтобы не было двух сразу).
const nav = document.getElementById("navtoggle");
if (nav) nav.addEventListener("click", e => {
  e.stopPropagation();
  // В режиме «Выбрать» дерево закрывать нельзя (сначала «Отмена»).
  if (body.classList.contains("nav-open") && body.classList.contains("tree-selecting")) return;
  body.classList.remove("sheet-open");
  body.classList.toggle("nav-open");
});

// Переключатель схемы в шапке (нативный <select> → на iOS штатный пикер с liquid
// glass). Смена значения → переход на выбранную схему. Список схем в сайдбаре убран.
const cswitch = document.getElementById("canvas-switch");
if (cswitch) cswitch.addEventListener("change", e => { if (e.target.value) location.href = e.target.value; });

// Стрелка «ещё» в шапке (мобилка) → раскрыть/свернуть вторую строку доп-контролов.
const more = document.getElementById("topbar-more");
if (more) more.addEventListener("click", e => { e.stopPropagation(); body.classList.toggle("topbar-expanded"); });

// Скрим — закрывает drawer, шторку деталей и шторку блока стоек (свернуть + выйти
// из правки стойки).
const scrim = document.getElementById("mobile-scrim");
if (scrim) scrim.addEventListener("click", () => {
  if (body.classList.contains("tree-selecting")) return;   // в режиме «Выбрать» дерево не закрываем
  close();
  body.classList.add("rack-collapsed");
  body.classList.remove("rack-edit");
});

// Тап по узлу дерева / переключателю холста в drawer → строим схему и закрываем
// drawer (сразу виден результат). Обработчик самого узла отрабатывает как обычно.
const sidebar = document.getElementById("sidebar");
if (sidebar) sidebar.addEventListener("click", e => {
  if (body.classList.contains("tree-selecting")) return;   // в режиме выбора drawer не закрываем
  if (e.target.closest(".tree-loc, .tree-rack, .tree-site, .tree-sitegroup, .tree-dev, .it-node, .cnav"))
    body.classList.remove("nav-open");
});

// Тап по «открывающему карточку» элементу → показать шторку деталей. Саму деталь
// заполняют свои обработчики (device.show / _showNet); мы лишь поднимаем шторку
// после их микротаска. Класс на десктопе — no-op (шторка только в media-query).
document.addEventListener("click", e => {
  if (e.target.closest(".node .nm, .it-net, .net-block, .nb-cap, .nc-corner, .net-chip"))
    setTimeout(() => body.classList.add("sheet-open"), 0);
});

// Тач: потянуть шторку ВНИЗ за палец (детали / блок стоек). Пока палец на экране —
// шторка ведётся за ним и НЕ закрывается (можно водить вверх-вниз сколько угодно);
// закрывается ТОЛЬКО когда отпустил ниже порога, иначе — плавно возвращается.
// Тянуть можно лишь от верха прокрутки контента (иначе это обычный скролл).
// scrollerSel — внутренний прокручиваемый элемент (#rackpane сам не скроллится,
// скроллится #racks); null → скроллится сама шторка (#detail/#ipam-detail).
const swipeClose = (id, scrollerSel, onClose) => {
  const el = document.getElementById(id);
  if (!el) return;
  let sy = 0, dy = 0, arm = false, dragging = false;
  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) { arm = false; return; }
    const scroller = scrollerSel ? el.querySelector(scrollerSel) : el;
    arm = (scroller ? scroller.scrollTop : 0) <= 2;   // тянуть — только от верха
    sy = e.touches[0].clientY; dy = 0; dragging = false;
  }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (!arm) return;
    dy = e.touches[0].clientY - sy;
    if (dy > 0) {                          // тянут вниз — ведём шторку, контент не скроллим
      if (!dragging) { dragging = true; el.style.transition = "none"; }
      e.preventDefault();
      el.style.transform = "translateY(" + dy + "px)";
    } else if (dragging) {                 // вернулись к верху — держим у открытого положения
      el.style.transform = "translateY(0)";
    }
  }, { passive: false });
  const end = () => {
    if (!dragging) { arm = false; return; }
    dragging = false;
    const h = el.getBoundingClientRect().height || 400;
    const shouldClose = dy > Math.min(150, h * 0.3);   // отпустил ниже порога → закрыть
    el.style.transition = "";               // вернуть CSS-анимацию (0.24s)
    if (shouldClose) onClose();             // класс уйдёт → CSS увезёт шторку вниз (плавно)
    el.style.transform = "";                // снять inline → едем к CSS-цели (открыто/закрыто)
    dy = 0; arm = false;
  };
  el.addEventListener("touchend", end, { passive: true });
  el.addEventListener("touchcancel", end, { passive: true });
};
swipeClose("detail", null, () => body.classList.remove("sheet-open"));
swipeClose("ipam-detail", null, () => body.classList.remove("sheet-open"));
swipeClose("rackpane", "#racks", () => { body.classList.add("rack-collapsed"); body.classList.remove("rack-edit"); });

// Esc — закрыть оверлеи.
document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
