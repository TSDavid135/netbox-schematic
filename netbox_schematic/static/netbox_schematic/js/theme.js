"use strict";
// Theme toggle — dark by default, choice saved in localStorage.
import { $ } from "./core.js";

function applyThemeIcon() {
  const light = document.documentElement.classList.contains("light");
  // The bulb shows the ACTION, not the current state: in dark it's lit ("turn the
  // light on"), in light it's off ("turn it off").
  $("#themetoggle").innerHTML = `<i class="mdi mdi-${light ? "lightbulb-outline" : "lightbulb-on-outline"}"></i>`;
}

export function initTheme() {
  $("#themetoggle").addEventListener("click", () => {
    const light = document.documentElement.classList.toggle("light");
    localStorage.setItem("schematic-theme", light ? "light" : "dark");
    applyThemeIcon();
  });
  applyThemeIcon();
}
