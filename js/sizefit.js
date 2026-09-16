/**
 * sizefit.js
 * ----------
 * Canvas वरून JPEG Blob बनवताना दिलेल्या [minKB, maxKB] मर्यादेत बसवणे —
 * headshot_refine.py मधील save_within_size_budget() / sheet_cutter.py मधील
 * save_under_size_limit() चा ब्राऊझर (Canvas) पोर्ट.
 *
 * canvas.toBlob() ऐसिंक्रोनस असल्याने हे सर्व async/await वापरते.
 */

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

function scaledCanvas(sourceCanvas, factor) {
  const w = Math.max(1, Math.round(sourceCanvas.width * factor));
  const h = Math.max(1, Math.round(sourceCanvas.height * factor));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  return out;
}

/**
 * जास्तीत जास्त quality (0.2 ते 1.0, पायरी 0.02) शोधते जिथे साईझ <= maxKB.
 * काहीच quality त्या मर्यादेत बसली नाही तर सर्वात कमी (0.2) वापरते.
 */
async function bestQualityUnderMax(canvas, maxKB) {
  let lastBlob = null, lastQuality = 0.2;
  for (let q = 100; q >= 20; q -= 2) {
    const quality = q / 100;
    const blob = await canvasToBlob(canvas, quality);
    const sizeKB = blob.size / 1024;
    lastBlob = blob;
    lastQuality = quality;
    if (sizeKB <= maxKB) return { blob, quality };
  }
  return { blob: lastBlob, quality: lastQuality };
}

/**
 * @param {HTMLCanvasElement} canvas  अंतिम (क्रॉप केलेली) इमेज असलेला canvas
 * @param {number} minKB
 * @param {number} maxKB
 * @returns {Promise<{blob: Blob, quality: number, sizeKB: number}>}
 */
async function saveWithinSizeBudget(canvas, minKB, maxKB) {
  let working = canvas;
  let { blob, quality } = await bestQualityUnderMax(working, maxKB);
  let sizeKB = blob.size / 1024;

  let attempts = 0;
  while (sizeKB > maxKB && attempts < 8) {
    working = scaledCanvas(working, 0.9);
    ({ blob, quality } = await bestQualityUnderMax(working, maxKB));
    sizeKB = blob.size / 1024;
    attempts++;
  }

  attempts = 0;
  while (sizeKB < minKB && attempts < 10) {
    working = scaledCanvas(working, 1.08);
    const blob100 = await canvasToBlob(working, 1.0);
    const size100KB = blob100.size / 1024;
    if (size100KB > maxKB) {
      ({ blob, quality } = await bestQualityUnderMax(working, maxKB));
      sizeKB = blob.size / 1024;
      break;
    }
    blob = blob100;
    quality = 1.0;
    sizeKB = size100KB;
    attempts++;
  }

  return { blob, quality, sizeKB };
}

/** कुठलीही साईझ-मर्यादा न लावता जास्तीत जास्त क्वालिटीत JPEG Blob बनवते. */
async function saveOriginalQuality(canvas, quality = 0.95) {
  const blob = await canvasToBlob(canvas, quality);
  return { blob, quality, sizeKB: blob.size / 1024 };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { canvasToBlob, scaledCanvas, bestQualityUnderMax, saveWithinSizeBudget, saveOriginalQuality };
}
