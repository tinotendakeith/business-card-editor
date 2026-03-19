let pdfjsLibPromise = null;

const state = {
    mode: "empty",
    image: null,
    imageName: "business-card",
    layers: [],
    selectedLayerId: null,
    draggingLayerId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    showGuides: true,
    eraseOriginalText: true,
    imagePixels: null,
    svgTemplate: null,
    svgWidth: 1200,
    svgHeight: 675,
    sourceFile: null
};

const canvas = document.getElementById("cardCanvas");
const ctx = canvas.getContext("2d");
const appShell = document.querySelector(".app-shell");
const fileUpload = document.getElementById("fileUpload");
const analyzeButton = document.getElementById("analyzeButton");
const addLayerButton = document.getElementById("addLayerButton");
const deleteLayerButton = document.getElementById("deleteLayerButton");
const exportPngButton = document.getElementById("exportPngButton");
const exportPdfButton = document.getElementById("exportPdfButton");
const toggleGuides = document.getElementById("toggleGuides");
const eraseOriginalToggle = document.getElementById("eraseOriginalToggle");
const layersList = document.getElementById("layersList");
const sourceMode = document.getElementById("sourceMode");
const statusText = document.getElementById("statusText");
const textValue = document.getElementById("textValue");
const fontFamily = document.getElementById("fontFamily");
const fontSize = document.getElementById("fontSize");
const fontWeight = document.getElementById("fontWeight");
const fontColor = document.getElementById("fontColor");
const opacity = document.getElementById("opacity");
const positionX = document.getElementById("positionX");
const positionY = document.getElementById("positionY");
const boxWidth = document.getElementById("boxWidth");
const rotation = document.getElementById("rotation");
const formFields = [textValue, fontFamily, fontSize, fontWeight, fontColor, opacity, positionX, positionY, boxWidth, rotation];

fileUpload.addEventListener("change", handleFileUpload);
analyzeButton.addEventListener("click", rerunCurrentMode);
addLayerButton.addEventListener("click", addManualLayer);
deleteLayerButton.addEventListener("click", deleteSelectedLayer);
exportPngButton.addEventListener("click", () => exportDesign("png"));
exportPdfButton.addEventListener("click", () => exportDesign("pdf"));
toggleGuides.addEventListener("change", () => {
    state.showGuides = toggleGuides.checked;
    renderCanvas();
});
eraseOriginalToggle.addEventListener("change", () => {
    state.eraseOriginalText = eraseOriginalToggle.checked;
    renderCanvas();
});
for (const field of formFields) {
    field.addEventListener("input", updateSelectedLayerFromForm);
}
canvas.addEventListener("pointerdown", onCanvasPointerDown);
canvas.addEventListener("pointermove", onCanvasPointerMove);
window.addEventListener("pointerup", onCanvasPointerUp);
window.addEventListener("resize", updateCanvasDisplaySize);

disableEditor(true);
drawEmptyCanvas();

function setStatus(message) {
    statusText.textContent = message;
}

function setModeLabel(message) {
    sourceMode.textContent = `Mode: ${message}`;
}


function updateLoadedLayoutState(isLoaded) {
    appShell.classList.toggle("has-upload", Boolean(isLoaded));
}
function disableEditor(disabled) {
    for (const field of formFields) {
        field.disabled = disabled;
    }
    deleteLayerButton.disabled = disabled;
}

async function handleFileUpload(event) {
    const file = (event.target.files || [])[0];
    if (!file) {
        return;
    }

    state.sourceFile = file;
    state.imageName = (file.name || "business-card").replace(/\.[^.]+$/, "");

    const extension = file.name.split(".").pop().toLowerCase();
    if (extension === "svg" || file.type === "image/svg+xml") {
        await loadSvgFile(file);
        return;
    }
    if (extension === "pdf" || file.type === "application/pdf") {
        await loadPdfFile(file);
        return;
    }
    await loadImageFile(file);
}

async function rerunCurrentMode() {
    if (!state.sourceFile) {
        return;
    }
    if (state.mode === "svg") {
        await loadSvgFile(state.sourceFile);
        return;
    }
    if (state.mode === "pdf") {
        await loadPdfFile(state.sourceFile);
        return;
    }
    if (state.mode === "image") {
        await loadImageFile(state.sourceFile, true);
    }
}

async function loadSvgFile(file) {
    setModeLabel("SVG true-text editing");
    setStatus("Loading SVG and extracting text objects...");

    const svgText = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") {
        throw new Error("Invalid SVG file.");
    }

    normalizeSvgRoot(root);
    assignSvgTextIds(root);
    const dimensions = getSvgDimensions(root);
    state.svgWidth = dimensions.width;
    state.svgHeight = dimensions.height;
    state.svgTemplate = root.outerHTML;
    state.image = null;
    state.imagePixels = null;
    state.svgPreviewRoot = root.cloneNode(true);
    normalizeSvgRoot(state.svgPreviewRoot);
    state.svgPreviewRoot.setAttribute("viewBox", `${dimensions.minX} ${dimensions.minY} ${dimensions.width} ${dimensions.height}`);
    state.svgPreviewRoot.setAttribute("width", String(dimensions.width));
    state.svgPreviewRoot.setAttribute("height", String(dimensions.height));
    svgPreviewHost.innerHTML = "";
    svgPreviewHost.appendChild(state.svgPreviewRoot);

    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    updateCanvasDisplaySize();

    state.layers = await extractSvgTextLayers(state.svgPreviewRoot, dimensions);
    state.selectedLayerId = state.layers[0] ? state.layers[0].id : null;
    state.mode = "svg";
    finalizeLoadedFile();
    setStatus(`SVG loaded with ${state.layers.length} editable text layer${state.layers.length === 1 ? "" : "s"}.`);
}
async function loadPdfFile(file) {
    setModeLabel("PDF extracted-text editing");
    setStatus("Loading PDF page and extracting text items...");

    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await getPdfjs();
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const renderCanvas = document.createElement("canvas");
    renderCanvas.width = viewport.width;
    renderCanvas.height = viewport.height;
    const renderCtx = renderCanvas.getContext("2d", { willReadFrequently: true });
    await page.render({ canvasContext: renderCtx, viewport }).promise;

    const textContent = await page.getTextContent();
    state.layers = extractPdfTextLayers(textContent, viewport, pdfjsLib);
    state.selectedLayerId = state.layers[0] ? state.layers[0].id : null;
    state.mode = "pdf";

    await loadBaseImage(renderCanvas.toDataURL("image/png"), viewport.width, viewport.height);
    finalizeLoadedFile();
    setStatus(`PDF loaded from page 1 with ${state.layers.length} extracted text item${state.layers.length === 1 ? "" : "s"}.`);
}

async function loadImageFile(file, rerun = false) {
    setModeLabel("Image OCR fallback");
    setStatus(rerun ? "Re-running OCR on image..." : "Loading image and running OCR...");

    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    await loadBaseImage(dataUrl, image.width, image.height);
    state.mode = "image";

    const result = await Tesseract.recognize(dataUrl, "eng", {
        logger: (message) => {
            if (message.status === "recognizing text" && typeof message.progress === "number") {
                setStatus(`Running OCR... ${Math.round(message.progress * 100)}%`);
            }
        }
    });

    state.layers = buildImageLayersFromOCR(result.data);
    state.selectedLayerId = state.layers[0] ? state.layers[0].id : null;
    finalizeLoadedFile();
    setStatus(`Image loaded with ${state.layers.length} OCR text block${state.layers.length === 1 ? "" : "s"}.`);
}

async function loadBaseImage(src, width, height) {
    const image = await loadImage(src);
    const pixelCanvas = document.createElement("canvas");
    pixelCanvas.width = width;
    pixelCanvas.height = height;
    const pixelCtx = pixelCanvas.getContext("2d", { willReadFrequently: true });
    pixelCtx.drawImage(image, 0, 0, width, height);

    state.image = image;
    state.imagePixels = pixelCtx.getImageData(0, 0, width, height);
    canvas.width = width;
    canvas.height = height;
    updateCanvasDisplaySize();
}

function finalizeLoadedFile() {
    analyzeButton.disabled = false;
    exportPngButton.disabled = false;
    exportPdfButton.disabled = false;
    updateLoadedLayoutState(true);
    renderLayers();
    syncForm();
    renderCanvas();
}
function normalizeSvgRoot(root) {
    if (!root.getAttribute("xmlns")) {
        root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    if (!root.getAttribute("xmlns:xlink")) {
        root.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    }
}

function assignSvgTextIds(root) {
    const textNodes = root.querySelectorAll("text");
    textNodes.forEach((node, index) => {
        node.setAttribute("data-card-editor-id", `svg-text-${index + 1}`);
    });
}

function getSvgDimensions(root) {
    const viewBox = (root.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
    if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
        return { minX: viewBox[0], minY: viewBox[1], width: viewBox[2], height: viewBox[3] };
    }
    const width = parseSvgLength(root.getAttribute("width")) || 1200;
    const height = parseSvgLength(root.getAttribute("height")) || 675;
    root.setAttribute("viewBox", `0 0 ${width} ${height}`);
    return { minX: 0, minY: 0, width, height };
}

function parseSvgLength(value) {
    if (!value) {
        return 0;
    }
    const match = `${value}`.match(/[\d.]+/);
    return match ? Number(match[0]) : 0;
}

function removeSvgText(root) {
    root.querySelectorAll("text").forEach((node) => node.remove());
    return root;
}

async function extractSvgTextLayers(root, dimensions) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const layers = [];
    const textNodes = Array.from(root.querySelectorAll("text"));

    textNodes.forEach((textNode, textIndex) => {
        const baseId = textNode.getAttribute("data-card-editor-id") || `svg-text-${textIndex + 1}`;
        const leafTspans = Array.from(textNode.querySelectorAll("tspan")).filter((node) => !node.querySelector("tspan") && (node.textContent || "").trim());
        const candidates = leafTspans.length ? leafTspans : [textNode];

        candidates.forEach((node, lineIndex) => {
            const rawText = (node.textContent || "").replace(/\s+/g, " ").trim();
            if (!rawText) {
                return;
            }

            let box;
            try {
                box = node.getBBox();
            } catch (error) {
                box = { x: 0, y: 0, width: 120, height: 24 };
            }

            const matrix = typeof node.getCTM === "function" ? node.getCTM() : (typeof textNode.getCTM === "function" ? textNode.getCTM() : null);
            const computed = window.getComputedStyle(node);
            const metrics = getRenderedBoxMetrics(box, matrix);
            const fontSize = clamp(metrics.height * 0.82 || parseFloat(computed.fontSize) || 24, 12, dimensions.height * 0.16);
            const fontFamily = normalizeFontFamily(computed.fontFamily || textNode.getAttribute("font-family") || "Arial, sans-serif");
            const fontWeight = normalizeFontWeight(computed.fontWeight || textNode.getAttribute("font-weight") || "400");
            const color = normalizeColor(computed.fill || textNode.getAttribute("fill") || "#1e356b");
            const opacity = numberValue(computed.opacity || textNode.getAttribute("opacity") || 1, 1);
            const anchor = (computed.textAnchor || textNode.getAttribute("text-anchor") || "start").toLowerCase();
            const point = { x: metrics.left, y: metrics.bottom };
            const width = Math.max(40, metrics.width || Math.round(rawText.length * fontSize * 0.55));
            const x = anchor === "middle" ? point.x - width / 2 : anchor === "end" ? point.x - width : point.x;

            layers.push({
                id: `${baseId}-${lineIndex + 1}`,
                text: rawText,
                x,
                y: point.y,
                width,
                fontSize,
                fontFamily,
                fontWeight,
                color,
                backgroundColor: "#ffffff",
                opacity,
                rotation: matrix ? getMatrixRotation(matrix) : 0,
                originalBox: null,
                source: { kind: "svg", nodeId: baseId, nodeRef: node }
            });
        });
    });

    return layers;
}
function normalizeSvgLayersToCanvas(layers, dimensions) {
    return layers.map((layer) => ({
        ...layer,
        x: clamp(layer.x, 0, Math.max(0, dimensions.width - 20)),
        y: clamp(layer.y, layer.fontSize, Math.max(layer.fontSize, dimensions.height - 10)),
        width: clamp(layer.width, 60, dimensions.width * 0.9),
        fontSize: clamp(layer.fontSize, 12, dimensions.height * 0.12)
    }));
}

function readStyleMap(node) {
    const style = node.getAttribute("style") || "";
    return style.split(";").reduce((accumulator, part) => {
        const bits = part.split(":");
        if (bits.length === 2) {
            accumulator[bits[0].trim()] = bits[1].trim();
        }
        return accumulator;
    }, {});
}

function parseSvgTransformToMatrix(transformValue) {
    let matrix = createIdentityMatrix();
    const value = `${transformValue || ""}`;
    const regex = /(matrix|translate|scale|rotate)\(([^)]+)\)/gi;
    let match;
    while ((match = regex.exec(value))) {
        const fn = match[1].toLowerCase();
        const values = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
        let next = createIdentityMatrix();
        if (fn === "matrix" && values.length >= 6) {
            next = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
        }
        if (fn === "translate") {
            next = { a: 1, b: 0, c: 0, d: 1, e: values[0] || 0, f: values[1] || 0 };
        }
        if (fn === "scale") {
            next = { a: values[0] || 1, b: 0, c: 0, d: values[1] || values[0] || 1, e: 0, f: 0 };
        }
        if (fn === "rotate") {
            const angle = ((values[0] || 0) * Math.PI) / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            next = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        }
        matrix = multiplySvgMatrices(matrix, next);
    }
    return matrix;
}

function createIdentityMatrix() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplySvgMatrices(left, right) {
    return {
        a: left.a * right.a + left.c * right.b,
        b: left.b * right.a + left.d * right.b,
        c: left.a * right.c + left.c * right.d,
        d: left.b * right.c + left.d * right.d,
        e: left.a * right.e + left.c * right.f + left.e,
        f: left.b * right.e + left.d * right.f + left.f
    };
}

function getCumulativeSvgMatrix(node) {
    let matrix = createIdentityMatrix();
    let current = node;
    while (current && current.nodeType === 1 && current.nodeName.toLowerCase() !== "svg") {
        matrix = multiplySvgMatrices(parseSvgTransformToMatrix(current.getAttribute("transform") || ""), matrix);
        current = current.parentNode;
    }
    return matrix;
}

function applyMatrixToPoint(matrix, x, y) {
    return {
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getRenderedBoxMetrics(box, matrix) {
    const corners = matrix ? [
        applyMatrixToPoint(matrix, box.x, box.y),
        applyMatrixToPoint(matrix, box.x + box.width, box.y),
        applyMatrixToPoint(matrix, box.x, box.y + box.height),
        applyMatrixToPoint(matrix, box.x + box.width, box.y + box.height)
    ] : [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x, y: box.y + box.height },
        { x: box.x + box.width, y: box.y + box.height }
    ];

    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);

    return {
        left,
        right,
        top,
        bottom,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
    };
}

function getMatrixFontScale(matrix) {
    return Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d), 1);
}

function getMatrixRotation(matrix) {
    return Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
}

function normalizeFontFamily(value) {
    const family = `${value || ""}`.trim();
    if (!family) {
        return "Arial, sans-serif";
    }
    const lowered = family.toLowerCase();
    if (lowered.includes('plus jakarta')) {
        return "'Plus Jakarta Sans', sans-serif";
    }
    if (lowered.includes('source sans')) {
        return "'Source Sans 3', sans-serif";
    }
    if (lowered.includes('helvetica')) {
        return "'Helvetica Neue', Arial, sans-serif";
    }
    if (lowered.includes('times')) {
        return "'Times New Roman', serif";
    }
    if (lowered.includes('georgia')) {
        return "Georgia, serif";
    }
    if (lowered.includes('courier')) {
        return "'Courier New', monospace";
    }
    if (lowered.includes('arial')) {
        return "Arial, sans-serif";
    }
    return family;
}

function normalizeFontWeight(value) {
    const weight = `${value || "400"}`.toLowerCase();
    if (weight === 'normal') {
        return '400';
    }
    if (weight === 'bold') {
        return '700';
    }
    return /^\d+$/.test(weight) ? weight : '400';
}

function normalizeColor(value) {
    if (!value || value === "none") {
        return "#1e356b";
    }
    if (value.startsWith("#")) {
        return value;
    }
    const rgbMatch = value.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (rgbMatch) {
        return rgbToHex(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
    }
    return "#1e356b";
}

function extractPdfTextLayers(textContent, viewport, pdfjsLib) {
    return textContent.items.map((item, index) => {
        const transformed = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const x = transformed[4];
        const y = transformed[5];
        const fontSize = Math.max(12, Math.hypot(transformed[0], transformed[1]));
        return {
            id: `pdf-text-${index + 1}`,
            text: (item.str || "").trim(),
            x,
            y,
            width: Math.max(50, (item.width || 20) * viewport.scale),
            fontSize,
            fontFamily: "Arial, sans-serif",
            fontWeight: "400",
            color: "#1e356b",
            backgroundColor: sampleBackgroundColor({ x, y: y - fontSize, width: (item.width || 20) * viewport.scale, height: fontSize * 1.2 }),
            opacity: 1,
            rotation: 0,
            originalBox: { x, y: y - fontSize, width: Math.max(50, (item.width || 20) * viewport.scale), height: fontSize * 1.2 },
            source: { kind: "pdf" }
        };
    }).filter((layer) => layer.text);
}

function buildImageLayersFromOCR(data) {
    return (data.lines || []).map((line, index) => {
        const text = (line.text || "").replace(/\s+/g, " ").trim();
        if (!text) {
            return null;
        }
        const box = normalizeBox(line.bbox || {});
        return {
            id: `ocr-text-${index + 1}`,
            text,
            x: box.x,
            y: box.y + box.height,
            width: Math.max(60, box.width),
            fontSize: Math.max(18, Math.round(box.height * 0.8)),
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: "500",
            color: sampleTextColor(box),
            backgroundColor: sampleBackgroundColor(box),
            opacity: 1,
            rotation: 0,
            originalBox: box,
            source: { kind: "image" }
        };
    }).filter(Boolean);
}

function normalizeBox(bbox) {
    const x0 = Math.max(0, Math.floor(bbox.x0 || 0));
    const y0 = Math.max(0, Math.floor(bbox.y0 || 0));
    const x1 = Math.max(x0 + 1, Math.floor(bbox.x1 || x0 + 1));
    const y1 = Math.max(y0 + 1, Math.floor(bbox.y1 || y0 + 1));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function sampleTextColor(box) {
    const pixels = collectPixels(box, false);
    if (!pixels.length) {
        return "#1e356b";
    }
    pixels.sort((a, b) => luminance(a) - luminance(b));
    return averagePixels(pixels.slice(0, Math.max(1, Math.floor(pixels.length * 0.3))));
}

function sampleBackgroundColor(box) {
    const pixels = collectPixels(expandBox(box, 16), true, box);
    if (!pixels.length) {
        return "#ffffff";
    }
    return averagePixels(pixels);
}

function expandBox(box, padding) {
    return {
        x: Math.max(0, box.x - padding),
        y: Math.max(0, box.y - padding),
        width: box.width + padding * 2,
        height: box.height + padding * 2
    };
}

function collectPixels(box, outerRingOnly, innerBox) {
    if (!state.imagePixels) {
        return [];
    }
    const pixels = [];
    const imageWidth = state.imagePixels.width;
    const imageHeight = state.imagePixels.height;
    const data = state.imagePixels.data;
    const startX = Math.max(0, Math.floor(box.x));
    const startY = Math.max(0, Math.floor(box.y));
    const endX = Math.min(imageWidth, Math.ceil(box.x + box.width));
    const endY = Math.min(imageHeight, Math.ceil(box.y + box.height));

    for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
            if (outerRingOnly && innerBox) {
                const inside = x >= innerBox.x && x <= innerBox.x + innerBox.width && y >= innerBox.y && y <= innerBox.y + innerBox.height;
                if (inside) {
                    continue;
                }
            }
            const index = (y * imageWidth + x) * 4;
            pixels.push({ r: data[index], g: data[index + 1], b: data[index + 2] });
        }
    }
    return pixels;
}

function averagePixels(pixels) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const pixel of pixels) {
        r += pixel.r;
        g += pixel.g;
        b += pixel.b;
    }
    return rgbToHex(r / pixels.length, g / pixels.length, b / pixels.length);
}

function luminance(pixel) {
    return pixel.r * 0.2126 + pixel.g * 0.7152 + pixel.b * 0.0722;
}

function rgbToHex(r, g, b) {
    const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function addManualLayer() {
    if (!state.image) {
        setStatus("Upload a file first.");
        return;
    }
    const layer = {
        id: `manual-${crypto.randomUUID()}`,
        text: "New text",
        x: Math.round(canvas.width * 0.1),
        y: Math.round(canvas.height * 0.2),
        width: Math.round(canvas.width * 0.3),
        fontSize: Math.max(24, Math.round(canvas.height * 0.05)),
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontWeight: "700",
        color: "#1e356b",
        backgroundColor: "#ffffff",
        opacity: 1,
        rotation: 0,
        originalBox: null,
        source: { kind: "manual" }
    };
    state.layers.push(layer);
    state.selectedLayerId = layer.id;
    renderLayers();
    syncForm();
    renderCanvas();
}

function deleteSelectedLayer() {
    if (!state.selectedLayerId) {
        return;
    }
    state.layers = state.layers.filter((layer) => layer.id !== state.selectedLayerId);
    state.selectedLayerId = state.layers[0] ? state.layers[0].id : null;
    renderLayers();
    syncForm();
    renderCanvas();
}

function getSelectedLayer() {
    return state.layers.find((layer) => layer.id === state.selectedLayerId) || null;
}

function renderLayers() {
    layersList.innerHTML = "";
    if (!state.layers.length) {
        layersList.innerHTML = '<p class="empty-state">Detected or extracted text blocks will appear here.</p>';
        return;
    }
    for (const layer of state.layers) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `layer-chip${layer.id === state.selectedLayerId ? " active" : ""}`;
        button.innerHTML = `<strong>${escapeHtml(truncate(layer.text, 42))}</strong><span>${Math.round(layer.x)}, ${Math.round(layer.y)} | ${layer.fontSize}px</span>`;
        button.addEventListener("click", () => {
            state.selectedLayerId = layer.id;
            renderLayers();
            syncForm();
            renderCanvas();
        });
        layersList.appendChild(button);
    }
}

function syncForm() {
    const layer = getSelectedLayer();
    disableEditor(!layer);
    if (!layer) {
        textValue.value = "";
        fontFamily.value = "Arial, sans-serif";
        fontSize.value = "";
        fontWeight.value = "400";
        fontColor.value = "#1e356b";
        opacity.value = "1";
        positionX.value = "";
        positionY.value = "";
        boxWidth.value = "";
        rotation.value = "0";
        return;
    }
    textValue.value = layer.text;
    fontFamily.value = layer.fontFamily;
    fontSize.value = layer.fontSize;
    fontWeight.value = `${layer.fontWeight}`;
    fontColor.value = layer.color;
    opacity.value = layer.opacity;
    positionX.value = Math.round(layer.x);
    positionY.value = Math.round(layer.y);
    boxWidth.value = Math.round(layer.width);
    rotation.value = layer.rotation;
}

function updateSelectedLayerFromForm() {
    const layer = getSelectedLayer();
    if (!layer) {
        return;
    }
    layer.text = textValue.value;
    layer.fontFamily = fontFamily.value;
    layer.fontSize = numberValue(fontSize.value, layer.fontSize);
    layer.fontWeight = `${fontWeight.value}`;
    layer.color = fontColor.value;
    layer.opacity = numberValue(opacity.value, layer.opacity);
    layer.x = numberValue(positionX.value, layer.x);
    layer.y = numberValue(positionY.value, layer.y);
    layer.width = Math.max(10, numberValue(boxWidth.value, layer.width));
    layer.rotation = numberValue(rotation.value, layer.rotation);
    renderLayers();
    renderCanvas();
}

function renderCanvas() {
    if (state.mode === "svg" && state.svgPreviewRoot) {
        renderSvgPreview();
        return;
    }
    svgPreviewHost.classList.remove("is-active");
    canvas.style.display = "block";
    if (!state.image) {
        drawEmptyCanvas();
        return;
    }
    drawComposition(ctx, { includeGuides: state.showGuides });
}
function drawComposition(targetCtx, options) {
    targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
    targetCtx.drawImage(state.image, 0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
    if (state.eraseOriginalText && state.mode !== "svg") {
        for (const layer of state.layers) {
            drawLayerMask(targetCtx, layer);
        }
    }
    for (const layer of state.layers) {
        if (options.includeGuides) {
            drawLayerGuide(targetCtx, layer);
        }
        drawLayerText(targetCtx, layer);
    }
}

function renderSvgPreview() {
    svgPreviewHost.classList.add("is-active");
    canvas.style.display = "none";
    if (!state.svgPreviewRoot) {
        return;
    }

    for (const layer of state.layers) {
        if (!layer.source || layer.source.kind !== "svg" || !layer.source.nodeRef) {
            continue;
        }
        const node = layer.source.nodeRef;
        node.textContent = layer.text;
        node.setAttribute("data-card-editor-selected", layer.id === state.selectedLayerId && state.showGuides ? "true" : "false");
    }
}
function drawEmptyCanvas() {
    updateLoadedLayoutState(false);
    canvas.width = 1200;
    canvas.height = 675;
    updateCanvasDisplaySize();
    ctx.fillStyle = "#f6f7fa";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#6c7891";
    ctx.font = "600 34px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Upload an SVG, PDF, or image business card", canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = "400 22px 'Source Sans 3', sans-serif";
    ctx.fillText("SVG will edit real text objects. PDF and images use extracted text layers.", canvas.width / 2, canvas.height / 2 + 32);
    ctx.textAlign = "left";
}

function drawLayerMask(targetCtx, layer) {
    if (!layer.originalBox) {
        return;
    }
    const box = expandBox(layer.originalBox, Math.max(4, Math.round(layer.fontSize * 0.2)));
    targetCtx.save();
    targetCtx.fillStyle = layer.backgroundColor || "#ffffff";
    targetCtx.globalAlpha = 0.97;
    targetCtx.fillRect(box.x, box.y, box.width, box.height);
    targetCtx.restore();
}

function drawLayerGuide(targetCtx, layer) {
    targetCtx.save();
    targetCtx.translate(layer.x, layer.y);
    targetCtx.rotate((layer.rotation * Math.PI) / 180);
    targetCtx.strokeStyle = layer.id === state.selectedLayerId ? "rgba(242, 161, 0, 0.95)" : "rgba(30, 53, 107, 0.55)";
    targetCtx.lineWidth = 2;
    targetCtx.setLineDash([8, 6]);
    targetCtx.strokeRect(0, -layer.fontSize, layer.width, layer.fontSize * 1.3);
    targetCtx.restore();
}

function drawLayerText(targetCtx, layer) {
    targetCtx.save();
    targetCtx.translate(layer.x, layer.y);
    targetCtx.rotate((layer.rotation * Math.PI) / 180);
    targetCtx.fillStyle = hexToRgba(layer.color, layer.opacity);
    targetCtx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
    targetCtx.textBaseline = "alphabetic";
    wrapText(targetCtx, layer.text, 0, 0, layer.width, layer.fontSize * 1.08);
    targetCtx.restore();
}

function hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const value = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wrapText(targetCtx, text, x, y, maxWidth, lineHeight) {
    const paragraphs = `${text}`.split(/\n/);
    let cursorY = y;
    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (!words.length) {
            cursorY += lineHeight;
            continue;
        }
        let line = "";
        for (const word of words) {
            const testLine = line ? `${line} ${word}` : word;
            if (targetCtx.measureText(testLine).width > maxWidth && line) {
                targetCtx.fillText(line, x, cursorY);
                line = word;
                cursorY += lineHeight;
            } else {
                line = testLine;
            }
        }
        if (line) {
            targetCtx.fillText(line, x, cursorY);
            cursorY += lineHeight;
        }
    }
}

function onCanvasPointerDown(event) {
    const layer = hitTest(event);
    if (!layer) {
        return;
    }
    state.selectedLayerId = layer.id;
    const point = getCanvasPoint(event);
    state.draggingLayerId = layer.id;
    state.dragOffsetX = point.x - layer.x;
    state.dragOffsetY = point.y - layer.y;
    canvas.setPointerCapture(event.pointerId);
    renderLayers();
    syncForm();
    renderCanvas();
}

function onCanvasPointerMove(event) {
    if (!state.draggingLayerId) {
        return;
    }
    const layer = getSelectedLayer();
    if (!layer) {
        return;
    }
    const point = getCanvasPoint(event);
    layer.x = Math.round(point.x - state.dragOffsetX);
    layer.y = Math.round(point.y - state.dragOffsetY);
    syncForm();
    renderLayers();
    renderCanvas();
}

function onCanvasPointerUp(event) {
    if (state.draggingLayerId) {
        state.draggingLayerId = null;
        try {
            canvas.releasePointerCapture(event.pointerId);
        } catch (error) {
        }
    }
}

function hitTest(event) {
    const point = getCanvasPoint(event);
    for (let index = state.layers.length - 1; index >= 0; index -= 1) {
        const layer = state.layers[index];
        const box = { left: layer.x, top: layer.y - layer.fontSize, right: layer.x + layer.width, bottom: layer.y + layer.fontSize * 0.4 };
        if (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) {
            return layer;
        }
    }
    return null;
}

function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
}
async function exportDesign(type) {
    if (!(state.image || state.svgPreviewRoot)) {
        return;
    }

    const scale = 3;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width * scale;
    exportCanvas.height = canvas.height * scale;
    const exportCtx = exportCanvas.getContext("2d");

    if (state.mode === "svg" && state.svgPreviewRoot) {
        renderSvgPreview();
        const svgMarkup = state.svgPreviewRoot.outerHTML;
        const svgImage = await loadImage(svgMarkupToDataUrl(svgMarkup));
        exportCtx.drawImage(svgImage, 0, 0, exportCanvas.width, exportCanvas.height);
    } else {
        exportCtx.scale(scale, scale);
        drawComposition(exportCtx, { includeGuides: false });
    }

    if (type === "png") {
        downloadDataUrl(exportCanvas.toDataURL("image/png", 1), `${state.imageName}-edited.png`);
        setStatus("PNG exported.");
        return;
    }

    const jsPDF = window.jspdf.jsPDF;
    const orientation = exportCanvas.width >= exportCanvas.height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(exportCanvas.toDataURL("image/png", 1), "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save(`${state.imageName}-edited.pdf`);
    setStatus("PDF exported.");
}
function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
}

function updateCanvasDisplaySize() {
    const frame = document.querySelector(".canvas-frame");
    if (!frame || !canvas.width || !canvas.height) {
        return;
    }
    const availableWidth = Math.max(320, frame.clientWidth - 40);
    const ratio = canvas.width / canvas.height;
    const displayWidth = Math.min(availableWidth, canvas.width);
    const displayHeight = displayWidth / ratio;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    svgPreviewHost.style.width = `${displayWidth}px`;
    svgPreviewHost.style.height = `${displayHeight}px`;
}
async function getPdfjs() {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
    }
    return pdfjsLibPromise;
}

function svgMarkupToDataUrl(markup) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

function truncate(value, maxLength) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function numberValue(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(value) {
    return `${value}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

