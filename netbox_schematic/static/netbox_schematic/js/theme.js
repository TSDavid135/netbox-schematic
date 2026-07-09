"use strict";
// Смена темы (тёмная по умолчанию, выбор в localStorage).
import { $ } from "./core.js";

function applyThemeIcon() {
  const light = document.documentElement.classList.contains("light");
  // Иконка NetBox — лампочка: горит в светлой теме, погашена в тёмной.
  $("#themetoggle").innerHTML = `<i class="mdi mdi-${light ? "lightbulb-on-outline" : "lightbulb-outline"}"></i>`;
}

export function initTheme() {
  $("#themetoggle").addEventListener("click", () => {
    const light = document.documentElement.classList.toggle("light");
    localStorage.setItem("schematic-theme", light ? "light" : "dark");
    applyThemeIcon();
  });
  applyThemeIcon();
}
