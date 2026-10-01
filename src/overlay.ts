import St from "gi://St";

import * as utils from "./utils.js";

// Hatch matching the lp-builder SlotOverlay reference:
// 8px spacing, 1px diagonal lines running / (315deg stripes).
// Color follows the active hint color (hint-color-rgba setting).
const HATCH_SPACING = 8;
const HATCH_LINE_WIDTH = 1;
const HATCH_ALPHA = 0.85;

// Fallback hatch color when the hint color is invalid or too dark to see.
const FALLBACK_HATCH: [number, number, number] = [
  53 / 255,
  132 / 255,
  228 / 255,
];

function parse_rgb(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => parseInt(part.trim(), 10));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part)))
    return null;
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
}

export function hatch_color(
  get_hint_color: () => string,
): [number, number, number] {
  try {
    const hint = get_hint_color();
    if (utils.is_dark(hint)) return FALLBACK_HATCH;
    return parse_rgb(hint) ?? FALLBACK_HATCH;
  } catch (_) {
    return FALLBACK_HATCH;
  }
}

function paint_hatch(area: any, get_hint_color: () => string) {
  let cr: any = null;
  try {
    cr = area.get_context();
  } catch (_) {
    return;
  }
  if (!cr) return;

  let width = 0;
  let height = 0;
  try {
    [width, height] = area.get_surface_size();
  } catch (_) {
    try {
      cr.$dispose();
    } catch (_) {}
    return;
  }
  if (!width || !height) {
    try {
      cr.$dispose();
    } catch (_) {}
    return;
  }

  try {
    if (cr.save) cr.save();
    const [r, g, b] = hatch_color(get_hint_color);
    cr.setLineWidth(HATCH_LINE_WIDTH);
    cr.setSourceRGBA(r, g, b, HATCH_ALPHA);
    for (let x = -height; x < width + height; x += HATCH_SPACING) {
      cr.moveTo(x, height);
      cr.lineTo(x + height, 0);
    }
    cr.stroke();
    if (cr.restore) cr.restore();
  } finally {
    try {
      cr.$dispose();
    } catch (_) {}
  }
}

export function create_tiling_overlay(get_hint_color: () => string): any {
  const overlay = new St.DrawingArea({
    style_class: "slop-shell-overlay",
    visible: false,
  });
  try {
    overlay.connect("repaint", () => paint_hatch(overlay, get_hint_color));
    overlay.connect("notify::allocation", () => {
      try {
        overlay.queue_repaint();
      } catch (_) {}
    });
  } catch (_) {}
  return overlay;
}

export function refresh_overlay(overlay: any) {
  try {
    if (overlay && overlay.queue_repaint) overlay.queue_repaint();
  } catch (_) {}
}
