"use strict";
// ModeManager: три независимых режима правки.
// Раньше был один флаг body.edit. Теперь три: tree / rack / schema — по
// одному на блок. Кнопка .modebtn несёт data-mode и переключает СВОЙ режим.
// Класс на <body>: `<mode>-edit`. Слушатели подписываются на смену режима.

import { $ } from "./core.js";

export const MODES = ["tree", "rack", "schema", "detail"];

class ModeManager {
  constructor() {
    this.listeners = { tree: [], rack: [], schema: [], detail: [] };
    // делегирование: любой клик по .modebtn переключает её режим
    document.addEventListener("click", ev => {
      const btn = ev.target.closest(".modebtn");
      if (!btn) return;
      ev.preventDefault();
      this.toggle(btn.dataset.mode || "schema");
    });
  }
  cls(mode) { return mode + "-edit"; }
  on(mode) { return document.body.classList.contains(this.cls(mode)); }
  toggle(mode) {
    const active = document.body.classList.toggle(this.cls(mode));
    // синхронизируем aria у всех кнопок этого режима
    document.querySelectorAll(`.modebtn[data-mode="${mode}"]`).forEach(b =>
      b.setAttribute("aria-pressed", active ? "true" : "false"));
    (this.listeners[mode] || []).forEach(fn => fn(active));
  }
  // подписка на смену конкретного режима (для перерисовки блока)
  onChange(mode, fn) { (this.listeners[mode] || (this.listeners[mode] = [])).push(fn); }
  // при (пере)рендере блока привести aria его кнопок в актуальное состояние
  syncButtons(mode) {
    const active = this.on(mode);
    document.querySelectorAll(`.modebtn[data-mode="${mode}"]`).forEach(b =>
      b.setAttribute("aria-pressed", active ? "true" : "false"));
  }
}

export const Mode = new ModeManager();
