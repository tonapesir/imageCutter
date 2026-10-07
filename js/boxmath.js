/**
 * boxmath.js
 * ----------
 * sheet_cutter.py मधील Transform / compute_transform() / box_to_pixels() चा JS पोर्ट.
 * कुठलाही DOM/Canvas वापर नाही — Node.js मध्ये युनिट-टेस्ट करता येते.
 *
 * Transform आता सर्वसाधारण affine आहे: px = a*x + b*y + e, py = c*x + d*y + f.
 * साधा scale+offset (रोटेशन नसलेला) हा त्याचाच विशेष प्रकार (b=c=0).
 */

function borderTransform(border, outerBorderPt) {
  const [bx0, btop, bx1, bbottom] = outerBorderPt;
  const a = border.w / (bx1 - bx0);
  const d = border.h / (bbottom - btop);
  const e = border.x - bx0 * a;
  const f = border.y - btop * d;
  return { a, b: 0, c: 0, d, e, f };
}

/** >=3 जुळणाऱ्या बिंदूंवरून (PDF pt-space -> पिक्सेल-space) सर्वसाधारण affine
 * transform (least-squares fit) काढतो — किंचित रोटेशन/स्क्यू सुद्धा भरून काढतो. */
function affineTransformFromPoints(srcPts, dstPts) {
  const n = srcPts.length;
  const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const Atb = new Array(6).fill(0);

  for (let i = 0; i < n; i++) {
    const [x, y] = srcPts[i];
    const [px, py] = dstPts[i];
    const row1 = [x, y, 0, 0, 1, 0]; // -> px
    const row2 = [0, 0, x, y, 0, 1]; // -> py
    for (let r = 0; r < 6; r++) {
      Atb[r] += row1[r] * px + row2[r] * py;
      for (let c = 0; c < 6; c++) {
        AtA[r][c] += row1[r] * row1[c] + row2[r] * row2[c];
      }
    }
  }

  const sol = solveLinearSystem(AtA, Atb);
  const [a, b, c, d, e, f] = sol;
  return { a, b, c, d, e, f };
}

/** Gaussian elimination (partial pivoting) ने Ax=b सोडवतो — A: n x n, b: n length array. */
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

function applyTransform(t, x, y) {
  return [t.a * x + t.b * y + t.e, t.c * x + t.d * y + t.f];
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

/** border transform ने बॉर्डरचेच pt-कोऑर्डिनेट्स मॅप केल्यास सापडलेल्या बॉर्डर-बॉक्सशी जुळतात का (sanity-check). */
function transformsAgree(marksT, borderPx, outerBorderPt, tolFrac = 0.03) {
  const { x, y, w, h } = borderPx;
  const [bx0, btop, bx1, bbottom] = outerBorderPt;
  const [px0, py0] = applyTransform(marksT, bx0, btop);
  const [px1, py1] = applyTransform(marksT, bx1, bbottom);
  const tol = tolFrac * Math.max(w, h);
  return (
    Math.abs(px0 - x) < tol && Math.abs(py0 - y) < tol &&
    Math.abs(px1 - (x + w)) < tol && Math.abs(py1 - (y + h)) < tol
  );
}

const CORNER_KEYS = ["top_left", "top_right", "bottom_left", "bottom_right"];

/**
 * स्कॅन इमेज व PDF टेम्प्लेट यांच्यातील अचूक कोऑर्डिनेशन (transform) ठरवतो —
 * sheet_cutter.py च्या compute_transform() प्रमाणेच प्राधान्यक्रम:
 *   1. बॉर्डर + कोपरा-टिंब दोन्ही सापडले व जुळले -> टिंब-आधारित affine (रोटेशनसकट)
 *   2. जुळले नाहीत -> सुरक्षिततेसाठी बॉर्डर-आधारित transform
 *   3. फक्त एकच सापडले -> तेच वापरतो
 *   4. काहीच न सापडल्यास त्रुटी
 */
function computeCombinedTransform(borderPx, marksPx, boxes) {
  const ob = boxes.outer_border;
  const outerBorderPt = [ob.x0, ob.top, ob.x1, ob.bottom];
  const marksPt = boxes.corner_marks || {};

  const commonKeys = CORNER_KEYS.filter((k) => marksPx[k] && marksPt[k]);
  let marksTransform = null;
  if (commonKeys.length >= 3) {
    const src = commonKeys.map((k) => [marksPt[k].cx, marksPt[k].cy]);
    const dst = commonKeys.map((k) => marksPx[k]);
    marksTransform = affineTransformFromPoints(src, dst);
  }

  if (marksTransform && borderPx) {
    if (transformsAgree(marksTransform, borderPx, outerBorderPt)) return marksTransform;
    return borderTransform(borderPx, outerBorderPt);
  }
  if (marksTransform) return marksTransform;
  if (borderPx) return borderTransform(borderPx, outerBorderPt);

  throw new Error("ना बाहेरील बॉर्डर, ना कोपऱ्यातील टिंब सापडले. स्कॅन नीट तपासा.");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    borderTransform, affineTransformFromPoints, applyTransform, boxToPixels,
    transformsAgree, computeCombinedTransform, CORNER_KEYS,
  };
}
