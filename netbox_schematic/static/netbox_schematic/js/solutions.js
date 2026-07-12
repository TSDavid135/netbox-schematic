"use strict";
// Catalog of «ready-made solutions» — single source for the «+» palette, the
// right-click «Добавить» menu, node icons and logical contours by type. We
// DON'T ask for the device type (the solution IS the type); on add we ask for a
// name + the number of network and power ports.
//
// Solution fields:
//   key        — id within the category
//   label      — caption (palette button / menu item)
//   icon       — mdi icon (palette + node on the schema)
//   kind       — "device" (default) | "rack" | "panel"
//   model      — DeviceType name in the catalog (created on demand under
//                MANUFACTURER); only for kind="device"
//   role       — device role name (created on demand); roleColor — its color
//   group      — logical-contour caption on the schema (devices in one group
//                merge into a single contour «<group> · <локация>»)
//   net        — default number of network interfaces (fallback when no ports)
//   power      — default number of power ports
//   ports      — (opt., INSTEAD of net) port groups with TYPES for a device:
//                [{ kind, type, count, prefix, label }]
//                  kind   — "interface" | "power" | "poweroutlet" | "console"
//                  type   — NetBox type for interface (e.g. "1000base-t" copper /
//                           "1000base-x-sfp" fiber); not needed for the rest
//                  count  — default count (editable in the modal)
//                  prefix — port-name prefix ("eth"→eth1, "Розетка "→«Розетка 1»)
//                  label  — counter-field caption in the add modal
//
// The file sits next to the plugin — edit without touching logic.
export const MANUFACTURER = "Схематика";

export const SOLUTIONS = {
  periph: {
    label: "Потребитель", icon: "mdi-desktop-tower-monitor",
    items: [
      // Sockets — like a patch panel: front↔rear pairs (jacks). Node with ports on
      // top (rear → to wall/panel) and bottom (front → to device); trace runs through.
      { key: "sockets", label: "Розетки", icon: "mdi-ethernet", model: "Сетевые розетки", role: "Розетки", roleColor: "78909c", group: "Розетки", power: 0,
        ports: [{ kind: "frontrear", type: "8p8c", count: 2, prefix: "Розетка ", label: "Гнёзд (отверстий)" }] },
      { key: "pc", label: "ПК", icon: "mdi-desktop-classic", model: "Рабочая станция", role: "ПК", roleColor: "2196f3", group: "Персональные компьютеры", net: 1, power: 1 },
      { key: "laptop", label: "Ноутбук", icon: "mdi-laptop", model: "Ноутбук", role: "Ноутбук", roleColor: "03a9f4", group: "Ноутбуки", net: 1, power: 1 },
      { key: "printer", label: "Принтер", icon: "mdi-printer", model: "Принтер", role: "Принтер", roleColor: "9c27b0", group: "Принтеры", net: 1, power: 1 },
      { key: "camera", label: "Камера", icon: "mdi-cctv", model: "IP-камера", role: "Камера", roleColor: "607d8b", group: "Камеры", net: 1, power: 1 },
      { key: "tv", label: "ТВ", icon: "mdi-television", model: "Телевизор", role: "ТВ", roleColor: "3f51b5", group: "Телевизоры", net: 1, power: 1 },
      { key: "phone", label: "Телефон", icon: "mdi-deskphone", model: "IP-телефон", role: "Телефон", roleColor: "00bcd4", group: "Телефоны", net: 1, power: 1 },
      { key: "cnc", label: "Станок", icon: "mdi-robot-industrial", model: "Станок с ЧПУ", role: "Станок", roleColor: "795548", group: "Станки", net: 1, power: 1 },
      { key: "pos", label: "Касса", icon: "mdi-cash-register", model: "POS-терминал", role: "Касса", roleColor: "e91e63", group: "Кассы / терминалы", net: 1, power: 1 },
      { key: "sensor", label: "Датчик", icon: "mdi-motion-sensor", model: "Датчик", role: "Датчик", roleColor: "9e9d24", group: "Датчики", net: 1, power: 0 },
      { key: "other", label: "Оборуд.", icon: "mdi-devices", model: "Оборудование", role: "Оборудование", roleColor: "78909c", group: "Прочее оборудование", net: 1, power: 1 },
    ],
  },
  switch: {
    label: "Сетевое оборудование", icon: "mdi-router-wireless",
    items: [
      { key: "router", label: "Роутер", icon: "mdi-router", model: "Маршрутизатор", role: "Роутер", roleColor: "4caf50", group: "Маршрутизаторы", net: 4, power: 1 },
      { key: "switch", label: "Коммутатор", icon: "mdi-switch", model: "Коммутатор", role: "Коммутатор", roleColor: "8bc34a", group: "Коммутаторы", net: 24, power: 1 },
      { key: "ap", label: "Точка дост.", icon: "mdi-access-point", model: "Точка доступа", role: "Точка доступа", roleColor: "009688", group: "Точки доступа", net: 1, power: 1 },
      { key: "firewall", label: "Firewall", icon: "mdi-shield-outline", model: "Межсетевой экран", role: "Межсетевой экран", roleColor: "d32f2f", group: "Межсетевые экраны", net: 4, power: 1 },
      { key: "media", label: "Медиаконв.", icon: "mdi-swap-horizontal", model: "Медиаконвертер", role: "Медиаконвертер", roleColor: "607d8b", group: "Медиаконвертеры", power: 1,
        ports: [
          { kind: "interface", type: "1000base-t", count: 1, prefix: "eth", label: "Медных (RJ45)" },
          { kind: "interface", type: "1000base-x-sfp", count: 1, prefix: "sfp", label: "Оптических (SFP)" },
        ] },
      { key: "patch", label: "Патч-панель", icon: "mdi-format-align-justify", model: "Патч-панель", role: "Патч-панель", roleColor: "9e9e9e", group: "Патч-панели", power: 0,
        // A real panel: front↔rear pairs with mapping (kind "frontrear") — NetBox
        // runs the trace THROUGH the panel, so the switch→switch path is visible.
        // type — connector (8p8c copper / lc fiber), not the interface type.
        ports: [
          { kind: "frontrear", type: "8p8c", count: 24, prefix: "Порт ",    label: "Медных (RJ45)" },
          { kind: "frontrear", type: "lc",   count: 0,  prefix: "Оптопорт ", label: "Оптических (LC)" },
        ] },
      { key: "provider", label: "Провайдер", icon: "mdi-web", model: "Провайдер (WAN)", role: "Провайдер", roleColor: "ff9800", group: "Провайдеры", net: 1, power: 0 },
    ],
  },
  controller: {
    label: "Контроллеры", icon: "mdi-developer-board",
    items: [
      { key: "wlc", label: "WLAN-контроллер", icon: "mdi-access-point-network", model: "WLAN-контроллер", role: "WLAN-контроллер", roleColor: "009688", group: "WLAN-контроллеры", power: 1,
        ports: [{ kind: "interface", type: "1000base-t", count: 2, prefix: "eth", label: "Аплинков" }] },
      { key: "acs", label: "СКУД", icon: "mdi-lock", model: "Контроллер СКУД", role: "Контроллер СКУД", roleColor: "5c6bc0", group: "СКУД", power: 1,
        ports: [
          { kind: "interface", type: "1000base-t", count: 1, prefix: "eth", label: "Сетевых" },
          { kind: "interface", type: "other", count: 4, prefix: "Дверь ", label: "Дверей / считывателей" },
        ] },
      { key: "plc", label: "Автоматизация", icon: "mdi-home-automation", model: "Контроллер автоматизации", role: "Контроллер автоматизации", roleColor: "7e57c2", group: "Автоматизация", power: 1,
        ports: [
          { kind: "interface", type: "1000base-t", count: 1, prefix: "eth", label: "Сетевых" },
          { kind: "interface", type: "other", count: 8, prefix: "IO", label: "Входов / выходов (I/O)" },
        ] },
      { key: "ctrl", label: "Другой", icon: "mdi-developer-board", model: "Контроллер", role: "Контроллер", roleColor: "78909c", group: "Контроллеры", power: 1,
        ports: [{ kind: "interface", type: "1000base-t", count: 8, prefix: "eth", label: "Портов" }] },
    ],
  },
  power: {
    label: "Силовое оборудование", icon: "mdi-flash",
    items: [
      { key: "pdu", label: "PDU", icon: "mdi-power-socket", model: "PDU", role: "PDU", roleColor: "ff9800", group: "PDU", net: 0, power: 8 },
      { key: "ups", label: "ИБП", icon: "mdi-battery-charging", model: "ИБП", role: "ИБП", roleColor: "ff5722", group: "ИБП", net: 1, power: 2 },
      { key: "avr", label: "Стабилизатор", icon: "mdi-sine-wave", model: "Стабилизатор напряжения", role: "Стабилизатор", roleColor: "ff9800", group: "Стабилизаторы", net: 0, power: 2 },
      { key: "panel", label: "Распредщиток", icon: "mdi-electric-switch", kind: "panel" },
    ],
  },
  rack: {
    label: "Стойки", icon: "mdi-server-network",
    items: [
      { key: "rack", label: "Стойка", icon: "mdi-server", kind: "rack" },
    ],
  },
};

// Order of palette tabs / «Добавить» menu categories.
export const SOLUTION_CATS = ["periph", "switch", "controller", "power", "rack"];

// Category order when packing off-rack contours (network closer to the racks,
// peripherals further right; small_fix: «ПК поодаль от роутеров»).
const CAT_ORDER = { switch: 0, controller: 1, power: 2, periph: 3, rack: 4 };

// role (lowercased) → {icon, group, cat} — from the solutions catalog.
const ROLE_INFO = {};
for (const cat of SOLUTION_CATS)
  for (const it of (SOLUTIONS[cat].items || []))
    if (it.role) ROLE_INFO[it.role.toLowerCase()] = { icon: it.icon, group: it.group || it.role, cat };

// Node icon for a device: first by catalog role, then a heuristic on
// role/name/model. Shared by the schema and the tree.
export function iconForDevice(dev) {
  const rn = ((dev.role && dev.role.name) || "").toLowerCase();
  if (ROLE_INFO[rn]) return ROLE_INFO[rn].icon;
  const s = ((dev.role && dev.role.name) || "") + " " + (dev.name || "") +
    " " + ((dev.device_type && dev.device_type.model) || "");
  if (/provider|провайдер/i.test(s)) return "mdi-web";
  if (/camera|камер/i.test(s)) return "mdi-cctv";
  if (/router|роутер|маршрут/i.test(s)) return "mdi-router";
  if (/switch|коммут|свич/i.test(s)) return "mdi-switch";
  if (/\bpc\b|пк|компьютер|десктоп|рабочая\s*станц/i.test(s)) return "mdi-desktop-classic";
  if (/laptop|ноут/i.test(s)) return "mdi-laptop";
  if (/print|принтер/i.test(s)) return "mdi-printer";
  if (/\btv\b|телевизор|тв/i.test(s)) return "mdi-television";
  if (/phone|телефон/i.test(s)) return "mdi-deskphone";
  if (/ups|ибп/i.test(s)) return "mdi-battery-charging";
  if (/pdu|розет/i.test(s)) return "mdi-power-socket";
  if (/patch|пач|панель/i.test(s)) return "mdi-format-align-justify";
  if (/point|точк\s*дост/i.test(s)) return "mdi-access-point";
  if (/wlan|wlc|беспровод.*контрол/i.test(s)) return "mdi-access-point-network";
  if (/скуд|контроль\s*доступ/i.test(s)) return "mdi-lock";
  if (/контроллер|controller|автоматизац|\bплк\b|\bplc\b/i.test(s)) return "mdi-developer-board";
  return "mdi-server";
}

// Device's logical group (for off-rack contours): {key, label, order}. By
// catalog role; else by role/model (own group), order — last.
export function catalogGroup(dev) {
  const rn = ((dev.role && dev.role.name) || "").toLowerCase();
  const info = ROLE_INFO[rn];
  // Sockets — FIRST among off-rack (user places them «ahead of everything that
  // appears right of the racks»); the rest — by category order.
  if (info) return { key: info.group, label: info.group,
    order: rn === "розетки" ? -1 : (CAT_ORDER[info.cat] ?? 9) };
  const label = (dev.role && dev.role.name) || (dev.device_type && dev.device_type.model) || "Прочее";
  return { key: "role:" + label.toLowerCase(), label, order: 9 };
}
