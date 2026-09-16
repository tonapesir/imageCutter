/**
 * headshot.js
 * -----------
 * passport_crop.py चा शब्दशः JS पोर्ट — कापलेल्या फोटोभोवतीचा पांढरा स्कॅन-मार्जिन
 * व छापील फ्रेम/मॅट काढून फक्त हेडशॉट ठेवते. कधीही rotate/retouch/beautify करत नाही.
 *
 * इनपुट: {data:Uint8ClampedArray (RGBA, कॅनव्हासच्या ImageData सारखे), width, height}
 * कुठलाही DOM/Canvas वापर नाही (फक्त plain pixel array), त्यामुळे Node.js मध्ये
 * युनिट-टेस्ट करता येते.
 */

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  // OpenCV परंपरेप्रमाणे H:0-179, S/V:0-255 स्केलमध्ये परत करतो (पायथॉन कोडशी तुलना सोपी जावी म्हणून)
  return [h / 2, s * 255, v * 255];
}

/** True जिथे पिक्सेल पांढऱ्या/जवळपास-पांढऱ्या स्कॅनर पेपरसारखा दिसतो. */
function paperMask(rgba, width, height) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const [, s, v] = rgbToHsv(rgba[p], rgba[p + 1], rgba[p + 2]);
    mask[i] = (s < 45 && v > 190) ? 1 : 0;
  }
  return mask;
}

/** Separable box-filter आधारित binary dilate (OR over neighbourhood). */
function dilate(mask, width, height, k) {
  const half = Math.floor(k / 2);
  const tmp = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  // rows
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let v = 0;
      const lo = Math.max(0, x - half), hi = Math.min(width - 1, x + half);
      for (let xx = lo; xx <= hi; xx++) { if (mask[row + xx]) { v = 1; break; } }
      tmp[row + x] = v;
    }
  }
  // cols
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = 0;
      const lo = Math.max(0, y - half), hi = Math.min(height - 1, y + half);
      for (let yy = lo; yy <= hi; yy++) { if (tmp[yy * width + x]) { v = 1; break; } }
      out[y * width + x] = v;
    }
  }
  return out;
}

/** Separable box-filter आधारित binary erode (AND over neighbourhood). */
function erode(mask, width, height, k) {
  const half = Math.floor(k / 2);
  const tmp = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let v = 1;
      const lo = Math.max(0, x - half), hi = Math.min(width - 1, x + half);
      for (let xx = lo; xx <= hi; xx++) { if (!mask[row + xx]) { v = 0; break; } }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = 1;
      const lo = Math.max(0, y - half), hi = Math.min(height - 1, y + half);
      for (let yy = lo; yy <= hi; yy++) { if (!tmp[yy * width + x]) { v = 0; break; } }
      out[y * width + x] = v;
    }
  }
  return out;
}

function morphClose(mask, width, height, k, iterations = 3) {
  let m = mask;
  for (let i = 0; i < iterations; i++) m = dilate(m, width, height, k);
  for (let i = 0; i < iterations; i++) m = erode(m, width, height, k);
  return m;
}
function morphOpen(mask, width, height, k, iterations = 1) {
  let m = mask;
  for (let i = 0; i < iterations; i++) m = erode(m, width, height, k);
  for (let i = 0; i < iterations; i++) m = dilate(m, width, height, k);
  return m;
}

/** paper नसलेल्या (म्हणजे फोटो+फ्रेम असलेल्या) सर्वात मोठ्या भागाचा bounding box. */
function findOuterBbox(rgba, width, height) {
  const mask = paperMask(rgba, width, height);
  const nonPaper = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) nonPaper[i] = mask[i] ? 0 : 1;

  const k = Math.max(3, Math.round(Math.min(width, height) * 0.01) | 1);
  let cleaned = morphClose(nonPaper, width, height, k, 3);
  cleaned = morphOpen(cleaned, width, height, k, 1);

  // largest connected-component bounding box (8-connectivity, union-find — border.js प्रमाणेच)
  const n = width * height;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (!cleaned[idx]) continue;
      if (x > 0 && cleaned[idx - 1]) union(idx, idx - 1);
      if (y > 0) {
        const up = idx - width;
        if (cleaned[up]) union(idx, up);
        if (x > 0 && cleaned[up - 1]) union(idx, up - 1);
        if (x < width - 1 && cleaned[up + 1]) union(idx, up + 1);
      }
    }
  }

  const bboxes = new Map();
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (!cleaned[idx]) continue;
      const root = find(idx);
      let b = bboxes.get(root);
      if (!b) { b = { minX: x, minY: y, maxX: x, maxY: y }; bboxes.set(root, b); }
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }

  if (bboxes.size === 0) return { x: 0, y: 0, w: width, h: height };

  let best = null, bestArea = -1;
  for (const b of bboxes.values()) {
    const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
    const area = w * h;
    if (area > bestArea) { bestArea = area; best = { x: b.minX, y: b.minY, w, h }; }
  }

  if (best.w < 0.1 * width || best.h < 0.1 * height) {
    return { x: 0, y: 0, w: width, h: height };
  }
  return best;
}

/** काळ्या/लाल/गडद रंगाच्या फ्रेमसारखे दिसणारे पिक्सेल (निळा वगळून — निळी पार्श्वभूमी सामान्य असते). */
function frameColorMask(rgba, width, height) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const [h, s, v] = rgbToHsv(rgba[p], rgba[p + 1], rgba[p + 2]);
    const dark = v < 100;
    const saturatedNonBlue = (s > 100) && (v > 80) && ((h < 95) || (h > 150));
    mask[i] = (dark || saturatedNonBlue) ? 1 : 0;
  }
  return mask;
}

function lineThickness(getVal, len, maxTh, minGap = 8) {
  let lastTrue = -1, consecutiveFalse = 0;
  const limit = Math.min(maxTh, len);
  for (let i = 0; i < limit; i++) {
    if (getVal(i)) { lastTrue = i; consecutiveFalse = 0; }
    else { consecutiveFalse++; if (consecutiveFalse >= minGap) break; }
  }
  return lastTrue + 1;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function estimateFrameThickness(rgba, width, height, maxFrac = 0.14, minGap = 8, upperFrac = 0.4) {
  const mask = frameColorMask(rgba, width, height);
  const maxTh = Math.max(4, Math.round(Math.min(width, height) * maxFrac));
  const samples = [];

  for (let x = 0; x < width; x++) {
    samples.push(lineThickness((i) => mask[i * width + x], height, maxTh, minGap));
  }

  const upperH = Math.max(1, Math.floor(height * upperFrac));
  for (let yy = 0; yy < upperH; yy++) {
    const rowStart = yy * width;
    samples.push(lineThickness((i) => mask[rowStart + i], width, maxTh, minGap));
    samples.push(lineThickness((i) => mask[rowStart + (width - 1 - i)], width, maxTh, minGap));
  }

  const thickness = Math.round(median(samples));
  if (thickness <= 2) return 0;

  const hardCap = Math.max(4, Math.round(Math.min(width, height) * 0.08));
  return Math.min(thickness, hardCap);
}

function stripPrintedFrame(rgba, width, height, maxFrac = 0.14) {
  const t = estimateFrameThickness(rgba, width, height, maxFrac);
  if (t <= 0) return { x: 0, y: 0, w: width, h: height };
  const x0 = t, y0 = t, x1 = width - t, y1 = height - t;
  if ((x1 - x0) < 0.5 * width || (y1 - y0) < 0.5 * height) {
    return { x: 0, y: 0, w: width, h: height };
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * पूर्ण पाईपलाईन: पांढरा मार्जिन काढून, नंतर फ्रेम असल्यास काढते.
 * @returns {{x:number,y:number,w:number,h:number}} मूळ (rgba,width,height) च्या सापेक्ष अंतिम क्रॉप-रीजन
 */
function cropToPhotograph(rgba, width, height) {
  const stage1 = findOuterBbox(rgba, width, height);

  // stage1 प्रदेशाचा उप-buffer काढून त्यावरच frame estimation करतो (Python प्रमाणेच)
  const subW = stage1.w, subH = stage1.h;
  const sub = new Uint8ClampedArray(subW * subH * 4);
  for (let y = 0; y < subH; y++) {
    const srcRow = (stage1.y + y) * width + stage1.x;
    const dstRow = y * subW;
    for (let x = 0; x < subW; x++) {
      const s = (srcRow + x) * 4, d = (dstRow + x) * 4;
      sub[d] = rgba[s]; sub[d + 1] = rgba[s + 1]; sub[d + 2] = rgba[s + 2]; sub[d + 3] = rgba[s + 3];
    }
  }

  const stage2 = stripPrintedFrame(sub, subW, subH);
  return {
    x: stage1.x + stage2.x,
    y: stage1.y + stage2.y,
    w: stage2.w,
    h: stage2.h,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    rgbToHsv, paperMask, dilate, erode, morphClose, morphOpen,
    findOuterBbox, frameColorMask, estimateFrameThickness, stripPrintedFrame,
    cropToPhotograph,
  };
}
