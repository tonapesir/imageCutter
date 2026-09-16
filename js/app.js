/**
 * app.js
 * ------
 * Photo / Signature Crop Tool — Web आवृत्ती.
 * एकापेक्षा जास्त स्कॅन टेम्प्लेट अपलोड करून, प्रत्येकातील ९ फोटो+सही कापून,
 * फोटोमधून पुढे फ्रेम/मार्जिन काढून अंतिम हेडशॉट बनवून, सर्व एका ZIP मध्ये
 * डाउनलोड करता येते. सर्व प्रोसेसिंग पूर्णपणे ब्राऊझरमध्येच (क्लायंट-साईड) होते
 * — कुठलीही इमेज सर्व्हरला पाठवली जात नाही.
 */

const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/bmp", "image/tiff"];

let BOXES = null;
let uploadedFiles = []; // [{file, name}]
let pageResults = [];   // [{name, photoCanvases:[9], signCanvases:[9], headshotCanvases:[9], error}]

const els = {};

function $(id) { return document.getElementById(id); }

async function loadConfig() {
  const res = await fetch("config/boxes.json");
  if (!res.ok) throw new Error("config/boxes.json लोड करता आले नाही");
  BOXES = await res.json();
}

function fileToImageBitmap(file) {
  return createImageBitmap(file);
}

function bitmapToCanvas(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

function grayscaleFromCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    gray[i] = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
  }
  return gray;
}

function cropCanvas(sourceCanvas, x0, y0, x1, y1) {
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(sourceCanvas, x0, y0, w, h, 0, 0, w, h);
  return out;
}

/** एका स्कॅन पानावर टप्पा 1 (फोटो+सही कापणे) व टप्पा 2 (हेडशॉट रिफाईन) चालवते. */
async function processPage(file) {
  const bitmap = await fileToImageBitmap(file);
  const pageCanvas = bitmapToCanvas(bitmap);
  const gray = grayscaleFromCanvas(pageCanvas);
  const border = detectOuterBorder(gray, pageCanvas.width, pageCanvas.height, 180);

  const ob = BOXES.outer_border;
  const transform = computeTransform(
    border, [ob.x0, ob.top, ob.x1, ob.bottom], BOXES.page_width_pt, BOXES.page_height_pt
  );

  const photoCanvases = [];
  const signCanvases = [];
  const headshotCanvases = [];

  for (const box of BOXES.photo_boxes) {
    const [x0, y0, x1, y1] = boxToPixels(box, transform);
    const photo = cropCanvas(pageCanvas, x0, y0, x1, y1);
    photoCanvases.push(photo);

    // टप्पा 2: मार्जिन/फ्रेम काढून हेडशॉट
    const ctx = photo.getContext("2d");
    const imgData = ctx.getImageData(0, 0, photo.width, photo.height);
    const region = cropToPhotograph(imgData.data, photo.width, photo.height);
    const headshot = cropCanvas(photo, region.x, region.y, region.x + region.w, region.y + region.h);
    headshotCanvases.push(headshot);
  }

  for (const box of BOXES.sign_boxes) {
    const [x0, y0, x1, y1] = boxToPixels(box, transform);
    signCanvases.push(cropCanvas(pageCanvas, x0, y0, x1, y1));
  }

  return { photoCanvases, signCanvases, headshotCanvases, pageWidth: pageCanvas.width, pageHeight: pageCanvas.height };
}

function outputModeKB() {
  const mode = document.querySelector('input[name="outputMode"]:checked').value;
  return mode === "limit40" ? { min: 20, max: 40 } : { min: 0, max: 10_000 };
}

async function encodeCanvas(canvas) {
  const { min, max } = outputModeKB();
  if (min === 0 && max >= 10_000) {
    return saveOriginalQuality(canvas, 0.95);
  }
  return saveWithinSizeBudget(canvas, min, max);
}

// ------------------------------------------------------------------ UI ---

function renderFileList() {
  els.fileList.innerHTML = "";
  uploadedFiles.forEach((f, i) => {
    const li = document.createElement("li");
    li.textContent = f.name;
    li.dataset.index = i;
    li.addEventListener("click", () => selectFileRow(i));
    els.fileList.appendChild(li);
  });
}

let selectedIndex = -1;

async function selectFileRow(i) {
  selectedIndex = i;
  [...els.fileList.children].forEach((li, idx) => li.classList.toggle("active", idx === i));
  els.status.textContent = `${uploadedFiles[i].name} लोड होत आहे...`;

  try {
    const bitmap = await fileToImageBitmap(uploadedFiles[i].file);
    const pageCanvas = bitmapToCanvas(bitmap);
    const gray = grayscaleFromCanvas(pageCanvas);
    const border = detectOuterBorder(gray, pageCanvas.width, pageCanvas.height, 180);
    const ob = BOXES.outer_border;
    const transform = computeTransform(
      border, [ob.x0, ob.top, ob.x1, ob.bottom], BOXES.page_width_pt, BOXES.page_height_pt
    );

    drawPreviewWithBoxes(pageCanvas, transform);

    const result = pageResults[i] || await processPage(uploadedFiles[i].file).then((r) => (pageResults[i] = r));
    renderCropGrid(result);
    els.status.textContent = `${uploadedFiles[i].name} तयार.`;
  } catch (e) {
    els.status.textContent = `Preview अयशस्वी: ${e.message}`;
    console.error(e);
  }
}

function drawPreviewWithBoxes(pageCanvas, transform) {
  const draw = document.createElement("canvas");
  draw.width = pageCanvas.width;
  draw.height = pageCanvas.height;
  const ctx = draw.getContext("2d");
  ctx.drawImage(pageCanvas, 0, 0);

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgb(214,39,39)";
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "rgb(214,39,39)";
  BOXES.photo_boxes.forEach((box, i) => {
    const [x0, y0, x1, y1] = boxToPixels(box, transform);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillText(String(i + 1), x0 + 6, Math.max(24, y0 - 6));
  });
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgb(30,90,220)";
  BOXES.sign_boxes.forEach((box) => {
    const [x0, y0, x1, y1] = boxToPixels(box, transform);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  });

  const cw = els.previewWrap.clientWidth || 520;
  const ch = els.previewWrap.clientHeight || 680;
  const scale = Math.min(cw / draw.width, ch / draw.height);
  els.previewCanvas.width = Math.round(draw.width * scale);
  els.previewCanvas.height = Math.round(draw.height * scale);
  const pctx = els.previewCanvas.getContext("2d");
  pctx.clearRect(0, 0, els.previewCanvas.width, els.previewCanvas.height);
  pctx.drawImage(draw, 0, 0, els.previewCanvas.width, els.previewCanvas.height);
}

function renderCropGrid(result) {
  els.cropGrid.innerHTML = "";
  for (let i = 0; i < result.headshotCanvases.length; i++) {
    const cell = document.createElement("div");
    cell.className = "crop-cell";

    const img1 = document.createElement("img");
    img1.src = result.headshotCanvases[i].toDataURL("image/jpeg", 0.85);
    img1.alt = `Headshot ${i + 1}`;
    img1.title = "अंतिम हेडशॉट";

    const img2 = document.createElement("img");
    img2.src = result.signCanvases[i].toDataURL("image/jpeg", 0.85);
    img2.className = "sign-thumb";
    img2.alt = `Sign ${i + 1}`;

    const label = document.createElement("div");
    label.className = "crop-label";
    label.textContent = `Box ${i + 1}`;

    cell.appendChild(img1);
    cell.appendChild(img2);
    cell.appendChild(label);
    els.cropGrid.appendChild(cell);
  }
}

async function processFiles(files) {
  if (!files.length) {
    alert("आधी एक किंवा अधिक फाईल्स निवडा.");
    return;
  }

  els.progress.max = files.length;
  els.progress.value = 0;
  els.progress.classList.remove("hidden");
  els.downloadBtn.disabled = true;

  const zip = new JSZip();
  const photoFolder = zip.folder("Photo");
  const signFolder = zip.folder("Sign");
  const finalFolder = zip.folder("Photo_Final");

  let donePhoto = 0, doneSign = 0, doneHeadshot = 0;
  const failed = [];

  for (let i = 0; i < files.length; i++) {
    const { file, name } = files[i];
    const stem = name.replace(/\.[^.]+$/, "");
    els.status.textContent = `टप्पा 1+2: ${name} प्रोसेस होत आहे (${i + 1}/${files.length})...`;

    try {
      const result = pageResults[i] || await processPage(file);
      pageResults[i] = result;

      for (let b = 0; b < result.photoCanvases.length; b++) {
        const { blob } = await encodeCanvas(result.photoCanvases[b]);
        photoFolder.file(`${stem}_${b + 1}_p.jpg`, blob);
        donePhoto++;
      }
      for (let b = 0; b < result.signCanvases.length; b++) {
        const { blob } = await encodeCanvas(result.signCanvases[b]);
        signFolder.file(`${stem}_${b + 1}_s.jpg`, blob);
        doneSign++;
      }
      for (let b = 0; b < result.headshotCanvases.length; b++) {
        const { blob } = await encodeCanvas(result.headshotCanvases[b]);
        finalFolder.file(`${stem}_${b + 1}_p.jpg`, blob);
        doneHeadshot++;
      }
    } catch (e) {
      failed.push(`${name}: ${e.message}`);
      console.error(e);
    }

    els.progress.value = i + 1;
  }

  els.status.textContent = `पूर्ण: ${donePhoto} फोटो, ${doneSign} सह्या, ${doneHeadshot} अंतिम हेडशॉट तयार.` +
    (failed.length ? ` ⚠️ अयशस्वी: ${failed.length}` : "");

  if (failed.length) {
    console.warn("अयशस्वी फाईल्स:\n" + failed.join("\n"));
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  els.downloadBtn.disabled = false;
  els.downloadBtn.onclick = () => {
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Cropped_Output.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  els.progress.classList.add("hidden");
}

function addFiles(fileList) {
  for (const file of fileList) {
    if (!SUPPORTED_TYPES.includes(file.type) && !/\.(jpe?g|png|bmp|tiff?)$/i.test(file.name)) continue;
    uploadedFiles.push({ file, name: file.name });
    pageResults.push(null);
  }
  renderFileList();
  if (uploadedFiles.length && selectedIndex === -1) selectFileRow(0);
}

function init() {
  els.folderInput = $("folderInput");
  els.filesInput = $("filesInput");
  els.dropZone = $("dropZone");
  els.fileList = $("fileList");
  els.previewWrap = $("previewWrap");
  els.previewCanvas = $("previewCanvas");
  els.cropGrid = $("cropGrid");
  els.status = $("status");
  els.progress = $("progress");
  els.processAllBtn = $("processAllBtn");
  els.processSelectedBtn = $("processSelectedBtn");
  els.downloadBtn = $("downloadBtn");

  els.folderInput.addEventListener("change", (e) => addFiles(e.target.files));
  els.filesInput.addEventListener("change", (e) => addFiles(e.target.files));

  ["dragenter", "dragover"].forEach((evt) =>
    els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.dropZone.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.remove("drag"); })
  );
  els.dropZone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  els.processAllBtn.addEventListener("click", () => processFiles(uploadedFiles));
  els.processSelectedBtn.addEventListener("click", () => {
    if (selectedIndex === -1) { alert("आधी एक फाईल निवडा."); return; }
    processFiles([uploadedFiles[selectedIndex]]);
  });

  loadConfig()
    .then(() => { els.status.textContent = "टेम्प्लेट फोल्डर किंवा फाईल्स निवडा."; })
    .catch((e) => { els.status.textContent = `Config लोड अयशस्वी: ${e.message}`; });
}

document.addEventListener("DOMContentLoaded", init);

// ऑटोमेटेड टेस्टिंगसाठी hook (browser इतर काही वापरत नाही)
if (typeof window !== "undefined") {
  window.__test = { processPage, addFilesDirect: (f) => addFiles(f), processFiles, getUploadedFiles: () => uploadedFiles };
}
