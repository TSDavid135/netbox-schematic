"use strict";
// Смена темы (тёмная по умолчанию, выбор в localStorage).
import { $ } from "./core.js";

function applyThemeIcon() {
  const light = document.documentElement.classList.contains("light");
  $("#themetoggle").innerHTML = `<i class="mdi mdi-${light ? "weather-night" : "white-balance-sunny"}"></i>`;
}

export function initTheme() {
  $("#themetoggle").addEventListener("click", () => {
    const light = document.documentElement.classList.toggle("light");
    localStorage.setItem("schematic-theme", light ? "light" : "dark");
    applyThemeIcon();
  });
  applyThemeIcon();
}
