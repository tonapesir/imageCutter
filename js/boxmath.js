/**
 * boxmath.js
 * ----------
 * sheet_cutter.py मधील compute_transform() व box_to_pixels() चा शब्दशः JS पोर्ट.
 * कुठलाही DOM/Canvas वापर नाही — Node.js मध्ये युनिट-टेस्ट करता येते.
 */

function computeTransform(border, outerBorderPt, pageWidthPt, pageHeightPt) {
  const [bx0, btop, bx1, bbottom] = outerBorderPt;
  const scaleX = border.w / (bx1 - bx0);
  const scaleY = border.h / (bbottom - btop);
  const offsetX = border.x - bx0 * scaleX;
  const offsetY = border.y - btop * scaleY;
  return { scaleX, scaleY, offsetX, offsetY };
}

function applyTransform(t, x, y) {
  return [x * t.scaleX + t.offsetX, y * t.scaleY + t.offsetY];
}

function boxToPixels(box, t, marginPx = 0) {
  const [x0, y0] = applyTransform(t, box.x0, box.top);
  const [x1, y1] = applyTransform(t, box.x1, box.bottom);
  return [
    Math.round(x0) + marginPx,
    Math.round(y0) + marginPx,
    Math.round(x1) - marginPx,
    Math.round(y1) - marginPx,
  ];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeTransform, applyTransform, boxToPixels };
}
