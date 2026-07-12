"use strict";
// ModeManager: three independent edit modes.
// Previously one body.edit flag; now three (tree / rack / schema), one per
// block. A .modebtn carries data-mode and toggles ITS mode. Body class:
// `<mode>-edit`. Listeners subscribe to mode changes.

import { $ } from "./core.js";

class ModeManager {
  constructor() {
    this.listeners = { tree: [], rack: [], schema: [], detail: [] };
    // delegation: any .modebtn click toggles its mode
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
    // sync aria on all buttons of this mode
    document.querySelectorAll(`.modebtn[data-mode="${mode}"]`).forEach(b =>
      b.setAttribute("aria-pressed", active ? "true" : "false"));
    (this.listeners[mode] || []).forEach(fn => fn(active));
  }
  // subscribe to a mode change (to redraw the block)
  onChange(mode, fn) { (this.listeners[mode] || (this.listeners[mode] = [])).push(fn); }
  // on (re)render, refresh the block's button aria
  syncButtons(mode) {
    const active = this.on(mode);
    document.querySelectorAll(`.modebtn[data-mode="${mode}"]`).forEach(b =>
      b.setAttribute("aria-pressed", active ? "true" : "false"));
  }
}

export const Mode = new ModeManager();
