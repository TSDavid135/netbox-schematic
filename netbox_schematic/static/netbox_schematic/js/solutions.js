"use strict";
// Справочник «готовых решений» — единый источник для палитры «+», меню ПКМ
// «Добавить», иконок узлов и логических контуров по типам. НЕ спрашиваем тип
// устройства (это и есть готовое решение); при добавлении спрашиваем имя +
// число сетевых портов и портов питания.
//
// Поля решения:
//   key        — идентификатор в категории
//   label      — подпись (кнопка палитры / пункт меню)
//   icon       — mdi-иконка (палитра + узел на схеме)
//   kind       — "device" (по умолч.) | "rack" | "panel"
//   model      — имя DeviceType в справочнике (создаётся при нужде под
//                производителем MANUFACTURER); только для kind="device"
//   role       — имя роли устройства (создаётся при нужде), roleColor — её цвет
//   group      — подпись логического контура на схеме (устройства одного group
//                группируются в один контур «<group> · <локация>»)
//   net        — сколько сетевых интерфейсов создать по умолчанию
//   power      — сколько портов питания создать по умолчанию
//
// Файл лежит рядом с плагином — правится без изменения логики.
export const MANUFACTURER = "Схематика";

export const SOLUTIONS = {
  periph: {
    label: "Потребитель", icon: "mdi-desktop-tower-monitor",
    items: [
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
      { key: "media", label: "Медиаконв.", icon: "mdi-swap-horizontal", model: "Медиаконвертер", role: "Медиаконвертер", roleColor: "607d8b", group: "Медиаконвертеры", net: 2, power: 1 },
      { key: "patch", label: "Патч-панель", icon: "mdi-format-align-justify", model: "Патч-панель", role: "Патч-панель", roleColor: "9e9e9e", group: "Патч-панели", net: 24, power: 0 },
      { key: "provider", label: "Провайдер", icon: "mdi-web", model: "Провайдер (WAN)", role: "Провайдер", roleColor: "ff9800", group: "Провайдеры", net: 1, power: 0 },
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

// Порядок вкладок палитры / категорий меню «Добавить».
export const SOLUTION_CATS = ["periph", "switch", "power", "rack"];

// Порядок категорий при упаковке контуров off-rack (сетевое ближе к стойкам,
// периферия — дальше вправо; small_fix: «ПК поодаль от роутеров»).
const CAT_ORDER = { switch: 0, power: 1, periph: 2, rack: 3 };

// role (в нижнем регистре) → {icon, group, cat} — из справопечника решений.
const ROLE_INFO = {};
for (const cat of SOLUTION_CATS)
  for (const it of (SOLUTIONS[cat].items || []))
    if (it.role) ROLE_INFO[it.role.toLowerCase()] = { icon: it.icon, group: it.group || it.role, cat };

// Иконка узла по устройству: сперва по роли из справочника, затем эвристика по
// роли/имени/модели. Общая для схемы и дерева.
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
  return "mdi-server";
}

// Логическая группа устройства (для контуров off-rack): {key, label, order}.
// По роли из справочника; иначе по роли/модели (своя группа), order — в конец.
export function catalogGroup(dev) {
  const rn = ((dev.role && dev.role.name) || "").toLowerCase();
  const info = ROLE_INFO[rn];
  if (info) return { key: info.group, label: info.group, order: CAT_ORDER[info.cat] ?? 9 };
  const label = (dev.role && dev.role.name) || (dev.device_type && dev.device_type.model) || "Прочее";
  return { key: "role:" + label.toLowerCase(), label, order: 9 };
}
