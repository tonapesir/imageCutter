/**
 * border.js
 * ---------
 * स्कॅन पानावरील सर्वात मोठी (बाहेरील फ्रेमची) आयताकृती बाह्यरेषा शोधणे —
 * sheet_cutter.py मधील detect_outer_border() चा JS पोर्ट.
 *
 * Python आवृत्ती cv2.threshold + cv2.findContours वापरून "सर्वात मोठ्या
 * area च्या contour" चा bounding rect घेते. Browser मध्ये कुठलाही OpenCV
 * dependency न वापरता तेच परिणाम मिळावेत म्हणून इथे connected-component
 * (8-connectivity, union-find) पद्धत वापरली आहे: थ्रेशोल्ड केलेल्या
 * (शाई-रंगाच्या) पिक्सेल्सचे स्वतंत्र गट शोधून, प्रत्येक गटाच्या bounding-box
 * area वरून सर्वात मोठा गट निवडला जातो — पातळ आयताकृती फ्रेमसाठी हे
 * cv2.contourArea (enclosed area) च्या जवळपास बरोबर असते, कारण फ्रेमची
 * bounding-box area इतर कुठल्याही लहान अक्षर/खुणांपेक्षा खूप मोठी असते.
 *
 * निव्वळ pixel array वर काम करते (कुठलाही DOM/Canvas वापर नाही), त्यामुळे
 * Node.js मध्ये सुद्धा युनिट-टेस्ट करता येते.
 */

/**
 * @param {Uint8Array|Uint8ClampedArray} gray  grayscale pixels, length = width*height
 * @param {number} width
 * @param {number} height
 * @param {number} threshold  यापेक्षा गडद (कमी) असलेले पिक्सेल "शाई" मानले जातात
 * @returns {{x:number,y:number,w:number,h:number}}
 */
function detectOuterBorder(gray, width, height, threshold = 180) {
  const n = width * height;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const isInk = new Uint8Array(n);
  for (let i = 0; i < n; i++) isInk[i] = gray[i] < threshold ? 1 : 0;

  // दोन-पास कनेक्टेड-कॉम्पोनंट लेबलिंग (8-connectivity): वरील तीन शेजारी + डावा
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (!isInk[idx]) continue;
      if (x > 0 && isInk[idx - 1]) union(idx, idx - 1);
      if (y > 0) {
        const up = idx - width;
        if (isInk[up]) union(idx, up);
        if (x > 0 && isInk[up - 1]) union(idx, up - 1);
        if (x < width - 1 && isInk[up + 1]) union(idx, up + 1);
      }
    }
  }

  const bboxes = new Map(); // root -> {minX,minY,maxX,maxY,count}
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (!isInk[idx]) continue;
      const root = find(idx);
      let b = bboxes.get(root);
      if (!b) {
        b = { minX: x, minY: y, maxX: x, maxY: y, count: 0 };
        bboxes.set(root, b);
      }
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
      b.count++;
    }
  }

  if (bboxes.size === 0) {
    throw new Error("पानावरील बाहेरील फ्रेम सापडली नाही. स्कॅन नीट तपासा.");
  }

  let best = null, bestArea = -1;
  for (const b of bboxes.values()) {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = { x: b.minX, y: b.minY, w, h };
    }
  }
  return best;
}

/** Separable min-filter आधारित binary erode (स्वतंत्र, लहान उपयोगासाठी इथेच ठेवलेला). */
function erodeMask(mask, width, height, k) {
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

/**
 * पानाच्या चारही कोपऱ्यांजवळ ठळक (भरीव, काळा) चौकोनी टिंब शोधतो — sheet_cutter.py
 * मधील detect_corner_marks() चा JS पोर्ट.
 *
 * टिंब बऱ्याचदा बाहेरील बॉर्डरलाच खेटून छापलेले असते, त्यामुळे थ्रेशोल्ड केल्यावर
 * टिंब व बॉर्डर-रेषा एकाच जोडलेल्या आकारात मिसळतात. उपाय: तीव्र erosion —
 * पातळ बॉर्डर-रेषा पूर्ण पुसल्या जातात, पण भरीव चौकोनी टिंब टिकून राहते.
 *
 * @returns {{top_left?:[number,number], top_right?:[number,number], bottom_left?:[number,number], bottom_right?:[number,number]}}
 */
function detectCornerMarks(gray, width, height, searchFrac = 0.14) {
  const win = Math.max(20, Math.round(Math.min(width, height) * searchFrac));
  const kSize = Math.max(3, Math.round(win * 0.025) | 1);

  const regions = {
    top_left: [0, 0],
    top_right: [width - win, 0],
    bottom_left: [0, height - win],
    bottom_right: [width - win, height - win],
  };

  const marks = {};
  for (const key of Object.keys(regions)) {
    let [rx, ry] = regions[key];
    rx = Math.max(0, rx);
    ry = Math.max(0, ry);
    const pw = Math.min(win, width - rx);
    const ph = Math.min(win, height - ry);
    if (pw <= 0 || ph <= 0) continue;

    const mask = new Uint8Array(pw * ph);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        mask[y * pw + x] = gray[(ry + y) * width + (rx + x)] < 100 ? 1 : 0;
      }
    }
    const eroded = erodeMask(mask, pw, ph, kSize);

    // सर्वात मोठा जोडलेला तुकडा शोधतो (union-find, 8-connectivity)
    const n = pw * ph;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

    for (let y = 0; y < ph; y++) {
      const row = y * pw;
      for (let x = 0; x < pw; x++) {
        const idx = row + x;
        if (!eroded[idx]) continue;
        if (x > 0 && eroded[idx - 1]) union(idx, idx - 1);
        if (y > 0) {
          const up = idx - pw;
          if (eroded[up]) union(idx, up);
          if (x > 0 && eroded[up - 1]) union(idx, up - 1);
          if (x < pw - 1 && eroded[up + 1]) union(idx, up + 1);
        }
      }
    }

    const comps = new Map(); // root -> {sumX,sumY,count,minX,minY,maxX,maxY}
    for (let y = 0; y < ph; y++) {
      const row = y * pw;
      for (let x = 0; x < pw; x++) {
        const idx = row + x;
        if (!eroded[idx]) continue;
        const root = find(idx);
        let c = comps.get(root);
        if (!c) { c = { sumX: 0, sumY: 0, count: 0, minX: x, minY: y, maxX: x, maxY: y }; comps.set(root, c); }
        c.sumX += x; c.sumY += y; c.count++;
        if (x < c.minX) c.minX = x;
        if (x > c.maxX) c.maxX = x;
        if (y < c.minY) c.minY = y;
        if (y > c.maxY) c.maxY = y;
      }
    }

    let best = null, bestArea = 0;
    for (const c of comps.values()) {
      if (c.count > bestArea) { bestArea = c.count; best = c; }
    }
    if (!best || bestArea < 0.0005 * win * win) continue;

    const bw = best.maxX - best.minX + 1, bh = best.maxY - best.minY + 1;
    if (bh === 0 || bw / bh < 0.4 || bw / bh > 2.5) continue;

    const cx = rx + best.sumX / best.count;
    const cy = ry + best.sumY / best.count;
    marks[key] = [cx, cy];
  }

  return marks;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { detectOuterBorder, detectCornerMarks };
}
