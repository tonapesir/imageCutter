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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { detectOuterBorder };
}
