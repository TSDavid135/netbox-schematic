"use strict";
// Ядро: общее состояние, утилиты, константы
// Все менеджеры импортируют отсюда. state — единый источник рантайм-данных
// (менеджеры хранят в нём свои коллекции и DOM-ссылки, как раньше).

export const $ = s => document.querySelector(s);

export const state = {
  base: "", token: "",
  regions: [], siteGroups: [], sites: [], locations: [], prefixes: [],
  powerPanels: [], powerFeeds: [],   // силовые щиты и фидеры (дерево + слой питания)
  wirelessLinks: [],                 // радио-линки между интерфейсами (слой «Wireless»)
  circuits: [], circuitTerms: [],    // провайдерские каналы + терминации (слой «Circuits»)
  circuitProviders: [], circuitTypes: [],   // справочники для назначения circuit
  ipamPrefixes: [], ipamIps: [], ipamLocations: [],   // холст «Сеть / IPAM»
  roles: {}, dtypes: {},
  racks: [], group: [], groupKey: null,
  scope: null,                       // выбранная область {type:'region'|'site'|'location', id, name}
  devices: [], devRack: {}, devCol: {}, devNodeIdx: {},
  ports: {},
  ipsByIface: {},                    // id интерфейса → [IP] (тултип/паспорт)
  nodeEls: {}, rackDevEls: {}, rackBoxEls: {}, rackColEls: {},
  rackOcc: {}, rackLay: {},
  cables: [],
  cableTypes: [],         // [{value,label}] из OPTIONS /api/dcim/cables/ (loadCableTypes)
  activeLayer: null,      // активный слой-подсветка {kind,id,portKeys} (layers.js)
  _vlanIndex: null,       // Map vid → {vlan,portKeys} для панели слоёв и тултипов
  pending: null,          // {otype,id,label,el} — выбранный порт (первый конец кабеля)
  drag: null,             // {type,id,name} — перетаскиваемый узел дерева
  linkCtx: null,          // контекст открытого мини-меню связи
  zoom: 1,
  modalSubmit: null,
  toolsCollapsed: true,   // блок «UI» на схеме изначально свёрнут
  filterCollapsed: true,  // блок «Fl» (фильтр по ролям/кабелям) изначально свёрнут
  paletteCollapsed: true, // палитра «+» (правый нижний угол) изначально свёрнута
  viewMode: "phys",       // режим отображения схемы: "phys" | "net" (свитч на схеме)
  wireStyle: "round",     // стиль проводов: "round" (дуги) | "angular" (углы + мостики)
  wirePath: "short",      // трасса углов: "short" (напрямую) | "extend" (в обход нод)
  hiddenRoles: {},        // {roleId: true} — скрытые роли узлов (фильтр, CSS-скрытие)
  hiddenFams: {},         // {family: true}  — скрытые семейства кабелей
};

export const PORT_KINDS = [
  { ep: "interfaces",           otype: "dcim.interface",         cls: "p-iface", label: "интерфейсы" },
  { ep: "front-ports",          otype: "dcim.frontport",         cls: "p-front", label: "front" },
  { ep: "rear-ports",           otype: "dcim.rearport",          cls: "p-rear",  label: "rear" },
  { ep: "console-ports",        otype: "dcim.consoleport",       cls: "p-con",   label: "console" },
  { ep: "console-server-ports", otype: "dcim.consoleserverport", cls: "p-consrv", label: "console-server" },
  { ep: "power-ports",          otype: "dcim.powerport",         cls: "p-pin",   label: "питание" },
  { ep: "power-outlets",        otype: "dcim.poweroutlet",       cls: "p-pout",  label: "розетки" },
];
export const KIND_RU = { "dcim.interface": "сетевой интерфейс", "dcim.frontport": "front-порт панели",
  "dcim.rearport": "rear-порт панели (магистраль)", "dcim.powerport": "ввод питания",
  "dcim.poweroutlet": "розетка питания", "dcim.consoleport": "консольный порт",
  "dcim.consoleserverport": "порт консоль-сервера", "dcim.powerfeed": "фидер питания (щит)" };
// Матрица совместимости концов кабеля (как COMPATIBLE_TERMINATION_TYPES в NetBox)
export const COMPAT = {
  "dcim.interface":         ["dcim.interface", "dcim.frontport", "dcim.rearport", "circuits.circuittermination"],
  "dcim.frontport":         ["dcim.interface", "dcim.frontport", "dcim.rearport", "dcim.consoleport", "dcim.consoleserverport", "circuits.circuittermination"],
  "dcim.rearport":          ["dcim.interface", "dcim.frontport", "dcim.rearport", "dcim.consoleport", "dcim.consoleserverport", "circuits.circuittermination"],
  "dcim.consoleport":       ["dcim.consoleserverport", "dcim.frontport", "dcim.rearport"],
  "dcim.consoleserverport": ["dcim.consoleport", "dcim.frontport", "dcim.rearport"],
  "dcim.powerport":   ["dcim.poweroutlet", "dcim.powerfeed"],
  "dcim.poweroutlet": ["dcim.powerport"],
  "dcim.powerfeed":   ["dcim.powerport"],
};

// Типы кабеля
// Список ТИПОВ (value+label) НЕ хардкодим — он тянется из NetBox через
// OPTIONS /api/dcim/cables/ (см. loadCableTypes в api.js) и кладётся в
// state.cableTypes как плоский [{value,label}]. В NetBox это статический
// ChoiceSet (CableTypeChoices), отдельной таблицы/эндпоинта-списка нет,
// но DRF отдаёт его choices в ответе OPTIONS — это и есть источник правды.
//
// В плагине остаётся только то, чего в API НЕТ: сопоставление типа с
// «семейством» (для цвета провода и группировки в форме). Определяем по
// ПРЕФИКСУ значения, а не по полному перечню — тогда новый тип (cat9, om6…)
// автоматически попадёт в своё семейство без правок плагина.
const FAMILY_RULES = [
  [/^cat\d|^mrj21/, "copper"],   // медь · витая пара
  [/^dac-/, "dac"],              // медь · DAC (twinax)
  [/^coax|^rg-|^lmr-/, "coax"],  // медь · коаксиал
  [/^mmf/, "mmf"],               // оптика · многомод
  [/^smf/, "smf"],               // оптика · одномод
  [/^aoc/, "aoc"],               // оптика · активная
  [/^power/, "power"],           // питание
  [/^usb/, "usb"],               // USB
];
// Семейство типа кабеля (ключ цвета/группы). Пусто/неизвестно → "default".
export function cableFamily(type) {
  if (!type) return "default";
  for (const [re, fam] of FAMILY_RULES) if (re.test(type)) return fam;
  return "default";
}
// Человекочитаемое имя семейства — заголовок <optgroup> в форме выбора типа.
export const FAMILY_LABEL = {
  copper: "Медь · витая пара", dac: "Медь · DAC", coax: "Медь · коаксиал",
  mmf: "Оптика · многомод", smf: "Оптика · одномод", aoc: "Оптика · активная",
  power: "Питание", usb: "USB", default: "Прочее",
};
// Порядок семейств в выпадающем списке.
export const FAMILY_ORDER = ["copper", "dac", "coax", "mmf", "smf", "aoc", "power", "usb", "default"];
// Какие семейства уместны для данного вида соединения. "power" — только
// питание (power-порт ↔ розетка/фид); "data" — всё, кроме питания. Тип
// соединения выводим из otype портов (см. cableFamiliesFor).
const POWER_FAMILY = "power";
export function cableFamiliesFor(otypeA, otypeB) {
  const isPower = (otypeA + otypeB).includes("power");
  return isPower
    ? new Set([POWER_FAMILY])                                  // питание — только power
    : new Set(FAMILY_ORDER.filter(f => f !== POWER_FAMILY));   // данные — всё, кроме power
}
// Группирует плоский state.cableTypes по семействам → [{group,opts:[[v,l],…]}]
// для <optgroup>. Порядок групп — FAMILY_ORDER, порядок опций — как из API.
// allowFams (Set) — если задан, оставляем только эти семейства.
export function cableTypeGroups(allowFams) {
  const byFam = {};
  for (const { value, label } of (state.cableTypes || [])) {
    const fam = cableFamily(value);
    if (allowFams && !allowFams.has(fam)) continue;
    (byFam[fam] ||= []).push([value, label]);
  }
  return FAMILY_ORDER
    .filter(fam => byFam[fam])
    .map(fam => ({ group: FAMILY_LABEL[fam], opts: byFam[fam] }));
}

// Геометрия
export const UNIT_H = 22;
export const GAP_MIN = 3;        // подряд пустых юнитов, начиная с которого сворачиваем
export const GAP_H = 26;         // высота свёрнутой полосы «↕ N»
export const COL_W = 350, COL_GAP = 170, NODE_GAP = 74, BOX_PAD = 16;
export const DOT = 16, STEP = 21, EXTRA = 400;

const TR = { "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y",
  "к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h",
  "ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya" };
export function slugify(name) {
  return name.toLowerCase().split("").map(ch => TR[ch] !== undefined ? TR[ch] : ch).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

// mk(tag, props, ...children): фабрика DOM-элементов. props — объект:
//   className/id/text/html — спец-поля; on:{event:fn} — слушатели;
//   dataset:{k:v}; style:{k:v}; остальное — как атрибуты.
export function mk(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "className") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k === "style") Object.assign(e.style, v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
export const px = v => parseFloat(v) || 0;
// Переключатель режима — надпись по центру сверху блока: «Просмотр» (мягкая
// синяя тень на ховере) ↔ «Редактирование» (мягкий оранжевый овал-подсветка,
// всегда виден). Клик тоглит режим. Сохраняем класс .modebtn + data-mode +
// aria-pressed — вся обвязка (modes.js, main.js) работает по ним. extra —
// доп. класс для позиционирования в конкретном блоке (напр. schem-mid).
export const modeBtn = (mode, extra = "") =>
  `<button class="modebtn modeswitch ${extra}" data-mode="${mode}" aria-pressed="false" title="Переключить режим: просмотр / редактирование"><span class="ms-view"><i class="mdi mdi-eye"></i> Просмотр</span><span class="ms-edit-full"><i class="mdi mdi-pencil"></i> Редактирование</span><span class="ms-edit-short"><i class="mdi mdi-pencil"></i> Редакт.</span></button>`;
// Блёклый цвет из hex роли ("607d8b" → "rgba(96,125,139,a)").
export function softColor(hex, a = 0.16) {
  const h = (hex || "607d8b").replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
// Ключ порта/терминации в state.ports.
export const portKey = (type, id) => type + ":" + id;
export const termKey = t => portKey(t.object_type, t.object_id);
// Сворачиваемая панель: клик по head тогглит .collapsed и пишет флаг в state.
export function collapsible(root, head, stateKey) {
  if (state[stateKey]) root.classList.add("collapsed");
  head.addEventListener("click", () => {
    root.classList.toggle("collapsed");
    state[stateKey] = root.classList.contains("collapsed");
  });
}
// Название выбранной области (регион / площадка / серверная) — для заголовков
// панелей «Стойки : …» и «Схема соединений : …». Показывает, ОТКУДА загружена
// схема (см. state.scope). Запасной путь — по старому ключу groupKey.
export function currentLocationName() {
  if (state.scope && state.scope.name) return state.scope.name;
  const locId = (state.groupKey || "").replace(/^\w+:/, "");
  const loc = state.locations.find(l => String(l.id) === String(locId));
  return loc ? loc.name : "";
}

// Кастомный тултип
const tip = $("#tip");
// Тач/узкий экран: тултип фиксируем чуть НИЖЕ центра (палец не перекрывает порт) и
// даём крестик — на тач нет mouseleave, чтобы закрыть.
const tipTouch = () => matchMedia("(pointer: coarse)").matches || innerWidth <= 760;
export function attachTip(el, htmlFn) {
  const move = ev => {
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 310) + "px";
    tip.style.top = (ev.clientY + 16) + "px";
  };
  el.addEventListener("mouseenter", ev => {
    // В режиме правки схемы тултип не нужен (клик по порту = связь, а не инфо).
    if (document.body.classList.contains("schema-edit")) return;
    tip.innerHTML = htmlFn();
    if (tipTouch()) {
      tip.classList.add("tip-fixed");
      tip.style.left = "50%"; tip.style.top = "60%"; tip.style.transform = "translateX(-50%)";
      tip.insertAdjacentHTML("afterbegin", `<button class="tip-close" aria-label="Закрыть">&times;</button>`);
      const c = tip.querySelector(".tip-close");
      if (c) c.addEventListener("click", e => {
        e.stopPropagation();
        tip.style.display = "none";
        // Закрытие тултипа снимает и подсветку кабеля/трассы (слушает schema.js).
        document.dispatchEvent(new Event("schematic:tipclose"));
      });
    } else {
      tip.classList.remove("tip-fixed");
      tip.style.transform = "";
      move(ev);
    }
    tip.style.display = "block";
  });
  el.addEventListener("mousemove", ev => { if (!tipTouch()) move(ev); });
  el.addEventListener("mouseleave", () => { if (!tipTouch()) tip.style.display = "none"; });
}
