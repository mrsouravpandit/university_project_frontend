// script.js — Frontend logic (vanilla)
// - Validates file type & size
// - Shows preview
// - Uses fetchWithTimeout
// - Interprets backend responses (including low-confidence / non-potato cases)

const fileInput = document.getElementById("file-input");
const fileDrop = document.getElementById("file-drop");
const previewRow = document.getElementById("preview-row");
const previewImg = document.getElementById("preview-img");
const analyzeBtn = document.getElementById("analyze-btn");
const analyzeBtn2 = document.getElementById("analyze-btn-2");
const chooseBtn = document.getElementById("choose-btn");
const statusEl = document.getElementById("status");
const spinner = document.getElementById("spinner");
const resultEl = document.getElementById("result");
const resultClass = document.getElementById("result-class");
const resultConfidence = document.getElementById("result-confidence");
const explain = document.getElementById("explain");

// Configure
const API_URL = "https://b-aackend.onrender.com/predict";
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MIN_DIM = 64; // minimal resolution for reasonable prediction
const CONFIDENCE_THRESHOLD = 0.70; // below this treat as "unrecognized"

// helpers
function setStatus(msg, isError = false) {
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#c23b3b" : "";
}

function showSpinner(show = true) {
    spinner.hidden = !show;
}

function resetResult() {
    resultEl.hidden = true;
    resultClass.textContent = "—";
    resultConfidence.textContent = "—";
    explain.hidden = true;
}

// fetch timeout wrapper
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 15000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const resp = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return resp;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

// validate file
function validateFile(file) {
    if (!file) return "No file selected.";
    if (!file.type.startsWith("image/")) return "Please choose an image file (jpg, png).";
    if (file.size > MAX_SIZE) return "File is too large. Max 5MB.";
    return null;
}

function readImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// green ratio heuristic — quick check whether image likely contains greenery
async function greenRatioHeuristic(file) {
    // read tiny image via canvas
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const w = 64, h = 64;
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;
            let gSum = 0, total = 0;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i + 1], b = data[i + 2];
                gSum += g;
                total += (r + g + b) / 3;
            }
            const ratio = gSum / (total + 1e-9);
            resolve(ratio); // higher = greener
        };
        img.onerror = () => resolve(0);
        img.src = URL.createObjectURL(file);
    });
}

// UI events
fileInput.addEventListener("change", async (e) => {
    resetResult();
    setStatus("");
    const file = fileInput.files[0];
    const err = validateFile(file);
    if (err) {
        setStatus(err, true);
        fileInput.value = "";
        return;
    }

    // check dimensions
    try {
        const dims = await readImageDimensions(file);
        if (dims.width < MIN_DIM || dims.height < MIN_DIM) {
            setStatus("Image resolution is too small. Use a clearer picture.", true);
            fileInput.value = "";
            return;
        }
    } catch (e) {
        setStatus("Couldn't read image. Try another file.", true);
        fileInput.value = "";
        return;
    }

    // show preview
    previewImg.src = URL.createObjectURL(file);
    previewRow.hidden = false;
    analyzeBtn.disabled = false;
    analyzeBtn2.disabled = false;
    document.getElementById("initial-actions").hidden = true;
});

// clicking the drop area triggers file input
fileDrop.addEventListener("click", () => fileInput.click());
chooseBtn?.addEventListener("click", () => {
    // allow re-choose
    fileInput.click();
});

// analyze (either button)
async function onAnalyzeClick() {
    resetResult();
    setStatus("");
    const file = fileInput.files[0];
    const err = validateFile(file);
    if (err) { setStatus(err, true); return; }

    // quick green heuristic for leaf-like images
    setStatus("Checking image...");
    const greenRatio = await greenRatioHeuristic(file); // ~0.3+ tends to be greenish
    // threshold tuned conservatively:
    if (greenRatio < 0.18) {
        // still allow user to force, but warn
        setStatus("Image doesn't look like a leaf — analysis may be inaccurate.", true);
        explain.hidden = false;
    }

    // send to backend
    setStatus("Analyzing image — please wait...");
    showSpinner(true);

    const form = new FormData();
    form.append("file", file);

    try {
        const resp = await fetchWithTimeout(API_URL, {
            method: "POST",
            body: form,
            timeout: 20000
        });

        if (!resp.ok) {
            let txt = await resp.text().catch(() => "Server error");
            try {
                const json = JSON.parse(txt);
                setStatus(json.detail || txt, true);
            } catch {
                setStatus(txt || "Server error", true);
            }
            showSpinner(false);
            return;
        }

        const data = await resp.json();
        showSpinner(false);

        if (!data.class || typeof data.confidence !== "number") {
            setStatus("Unexpected server response.", true);
            return;
        }

        // If model is not confident -> treat as unrecognized
        if (data.confidence < CONFIDENCE_THRESHOLD) {
            setStatus("Model confidence is low — image might not be a potato leaf or is unclear.", true);
            explain.hidden = false;
        } else {
            setStatus("");
        }

        resultClass.textContent = data.class;
        resultConfidence.textContent = `${(data.confidence * 100).toFixed(1)}%`;
        resultEl.hidden = false;

    } catch (err) {
        showSpinner(false);
        if (err.name === "AbortError") setStatus("Request timed out. Try again later.", true);
        else setStatus("Network error. Check your connection or try again.", true);
        console.error(err);
    }
}

analyzeBtn?.addEventListener("click", onAnalyzeClick);
analyzeBtn2?.addEventListener("click", onAnalyzeClick);

// reset initial UI when choosing another file
fileInput.addEventListener("input", () => {
    // nothing extra — handled above
});

// disable initial analyze until file chosen
document.addEventListener("DOMContentLoaded", () => {
    analyzeBtn?.setAttribute("disabled", "true");
    analyzeBtn2?.setAttribute("disabled", "true");
});
