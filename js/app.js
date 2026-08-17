/* Coloring Book Studio — UI wiring. */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);

  const els = {
    dropZone: $('dropZone'), fileInput: $('fileInput'), sampleBtn: $('sampleBtn'),
    modeOutline: $('modeOutline'), modePbn: $('modePbn'),
    outlineControls: $('outlineControls'), pbnControls: $('pbnControls'),
    outputSize: $('outputSize'),
    detail: $('detail'), smooth: $('smooth'), thickness: $('thickness'),
    colors: $('colors'), simplify: $('simplify'), pbnThickness: $('pbnThickness'),
    showNumbers: $('showNumbers'), showFilled: $('showFilled'), showOriginal: $('showOriginal'),
    downloadBtn: $('downloadBtn'), downloadLegendBtn: $('downloadLegendBtn'), printBtn: $('printBtn'),
    emptyState: $('emptyState'), canvasWrap: $('canvasWrap'),
    canvas: $('resultCanvas'), busy: $('busy'), busyText: $('busyText'),
    legend: $('legend'), legendItems: $('legendItems'),
  };
  const ctx = els.canvas.getContext('2d');

  const state = {
    source: null,        // HTMLImageElement or HTMLCanvasElement
    sourceData: null,    // ImageData at the current output size
    mode: 'outline',     // 'outline' | 'pbn'
    result: null,        // engine output for the current mode/settings
    resultMode: null,
  };

  // Live slider value readouts.
  for (const [input, out] of [
    ['detail', 'detailOut'], ['smooth', 'smoothOut'], ['thickness', 'thicknessOut'],
    ['colors', 'colorsOut'], ['simplify', 'simplifyOut'], ['pbnThickness', 'pbnThicknessOut'],
  ]) {
    $(input).addEventListener('input', () => { $(out).value = $(input).value; });
  }

  // ------------------------------------------------------------ image input

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); setSource(img); };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Sorry, that image could not be read.'); };
    img.src = url;
  }

  els.dropZone.addEventListener('click', () => els.fileInput.click());
  els.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener('change', () => loadFile(els.fileInput.files[0]));

  for (const evt of ['dragover', 'dragenter']) {
    document.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
  }
  for (const evt of ['dragleave', 'drop']) {
    document.addEventListener(evt, (e) => { e.preventDefault(); els.dropZone.classList.remove('dragover'); });
  }
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', (e) => {
    for (const item of e.clipboardData ? e.clipboardData.items : []) {
      if (item.type.startsWith('image/')) { loadFile(item.getAsFile()); break; }
    }
  });

  els.sampleBtn.addEventListener('click', () => setSource(makeSampleImage()));

  function makeSampleImage() {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 750;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 480);
    sky.addColorStop(0, '#7ec4e8'); sky.addColorStop(1, '#cfeaf7');
    g.fillStyle = sky; g.fillRect(0, 0, 1000, 480);
    g.fillStyle = '#f7d154'; g.beginPath(); g.arc(830, 110, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    for (const [cx, cy, s] of [[220, 110, 1], [520, 70, 0.8], [680, 160, 0.65]]) {
      g.beginPath();
      g.arc(cx, cy, 34 * s, 0, Math.PI * 2);
      g.arc(cx + 38 * s, cy - 12 * s, 42 * s, 0, Math.PI * 2);
      g.arc(cx + 84 * s, cy, 32 * s, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#8fbf6a'; g.beginPath();
    g.moveTo(0, 480); g.quadraticCurveTo(260, 350, 520, 470); g.lineTo(520, 750); g.lineTo(0, 750); g.fill();
    g.fillStyle = '#6da84e'; g.beginPath();
    g.moveTo(380, 500); g.quadraticCurveTo(700, 360, 1000, 490); g.lineTo(1000, 750); g.lineTo(380, 750); g.fill();
    // house
    g.fillStyle = '#e8d9b8'; g.fillRect(150, 430, 190, 150);
    g.fillStyle = '#c05a4a'; g.beginPath();
    g.moveTo(130, 430); g.lineTo(245, 340); g.lineTo(360, 430); g.fill();
    g.fillStyle = '#7a5236'; g.fillRect(225, 500, 45, 80);
    g.fillStyle = '#9fd8ef'; g.fillRect(175, 460, 38, 38); g.fillRect(285, 460, 38, 38);
    // tree
    g.fillStyle = '#7a5236'; g.fillRect(660, 440, 34, 130);
    g.fillStyle = '#4e8a3c'; g.beginPath();
    g.arc(677, 400, 78, 0, Math.PI * 2);
    g.arc(620, 440, 52, 0, Math.PI * 2);
    g.arc(735, 440, 52, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  // -------------------------------------------------------------- pipeline

  function setSource(imgOrCanvas) {
    state.source = imgOrCanvas;
    state.sourceData = null;
    els.emptyState.hidden = true;
    els.canvasWrap.hidden = false;
    reprocess();
  }

  function sourceImageData() {
    if (state.sourceData) return state.sourceData;
    const src = state.source;
    const sw = src.naturalWidth || src.width;
    const sh = src.naturalHeight || src.height;
    const maxDim = parseInt(els.outputSize.value, 10);
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const w = Math.max(2, Math.round(sw * scale));
    const h = Math.max(2, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    state.sourceData = g.getImageData(0, 0, w, h);
    return state.sourceData;
  }

  let debounceTimer = null;
  function scheduleReprocess() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reprocess, 280);
  }

  function reprocess() {
    if (!state.source) return;
    els.busyText.textContent = state.mode === 'pbn' ? 'Finding colors and regions…' : 'Tracing outlines…';
    els.busy.hidden = false;
    // Let the busy overlay paint before the (synchronous) heavy lifting.
    setTimeout(() => {
      try {
        const img = sourceImageData();
        if (state.mode === 'outline') {
          state.result = CBEngine.outline(img, {
            detail: +els.detail.value,
            smooth: +els.smooth.value,
            thickness: +els.thickness.value,
          });
        } else {
          state.result = CBEngine.paintByNumbers(img, {
            colors: +els.colors.value,
            simplify: +els.simplify.value,
            thickness: +els.pbnThickness.value,
          });
        }
        state.resultMode = state.mode;
        render();
      } catch (err) {
        console.error(err);
        alert('Something went wrong while processing the image.');
      } finally {
        els.busy.hidden = true;
      }
    }, 30);
  }

  // -------------------------------------------------------------- rendering

  function putBuffer(buf) {
    els.canvas.width = buf.width;
    els.canvas.height = buf.height;
    ctx.putImageData(new ImageData(buf.data, buf.width, buf.height), 0, 0);
  }

  function drawNumbers(numbers) {
    ctx.fillStyle = '#8c8c8c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const nItem of numbers) {
      ctx.font = `600 ${nItem.size}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText(String(nItem.num), nItem.x, nItem.y);
    }
  }

  function render() {
    const r = state.result;
    if (!r) return;

    if (els.showOriginal.checked) {
      const img = sourceImageData();
      els.canvas.width = img.width;
      els.canvas.height = img.height;
      ctx.putImageData(img, 0, 0);
    } else if (state.resultMode === 'outline') {
      putBuffer(r);
    } else {
      putBuffer(els.showFilled.checked ? r.filled : r.lines);
      if (!els.showFilled.checked && els.showNumbers.checked) drawNumbers(r.numbers);
    }

    const isPbn = state.resultMode === 'pbn' && !els.showOriginal.checked;
    els.legend.hidden = !isPbn;
    if (isPbn) renderLegend(r.palette);

    els.downloadBtn.disabled = false;
    els.printBtn.disabled = false;
    els.downloadLegendBtn.hidden = state.resultMode !== 'pbn';
    els.downloadLegendBtn.disabled = state.resultMode !== 'pbn';
  }

  function renderLegend(palette) {
    els.legendItems.innerHTML = '';
    for (const { num, rgb } of palette) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      sw.style.color = lum > 140 ? '#333' : '#fff';
      sw.textContent = num;
      const label = document.createElement('span');
      label.textContent = `${num} — rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      item.append(sw, label);
      els.legendItems.appendChild(item);
    }
  }

  // ----------------------------------------------------------------- modes

  function setMode(mode) {
    state.mode = mode;
    els.modeOutline.classList.toggle('active', mode === 'outline');
    els.modePbn.classList.toggle('active', mode === 'pbn');
    els.modeOutline.setAttribute('aria-selected', mode === 'outline');
    els.modePbn.setAttribute('aria-selected', mode === 'pbn');
    els.outlineControls.hidden = mode !== 'outline';
    els.pbnControls.hidden = mode !== 'pbn';
    if (state.source) reprocess();
  }
  els.modeOutline.addEventListener('click', () => setMode('outline'));
  els.modePbn.addEventListener('click', () => setMode('pbn'));

  // Setting changes → recompute (or just re-render for view-only toggles).
  for (const id of ['detail', 'smooth', 'thickness', 'colors', 'simplify', 'pbnThickness']) {
    $(id).addEventListener('input', scheduleReprocess);
  }
  els.outputSize.addEventListener('change', () => { state.sourceData = null; reprocess(); });
  for (const el of [els.showNumbers, els.showFilled, els.showOriginal]) {
    el.addEventListener('change', render);
  }

  // --------------------------------------------------------------- exports

  function downloadCanvas(canvas, name) {
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  els.downloadBtn.addEventListener('click', () => {
    const name = state.resultMode === 'pbn' ? 'paint-by-numbers.png' : 'coloring-page.png';
    downloadCanvas(els.canvas, name);
  });

  els.downloadLegendBtn.addEventListener('click', () => {
    const r = state.result;
    if (!r || state.resultMode !== 'pbn') return;
    const pad = 24, sw = 34, gap = 14, perRow = Math.max(1, Math.floor((r.width - pad * 2) / (sw + 110)));
    const rows = Math.ceil(r.palette.length / perRow);
    const legendH = pad + rows * (sw + gap) + 8;

    const c = document.createElement('canvas');
    c.width = r.width;
    c.height = r.height + legendH;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.putImageData(new ImageData(r.lines.data, r.width, r.height), 0, 0);
    if (els.showNumbers.checked) {
      g.fillStyle = '#8c8c8c'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const nItem of r.numbers) {
        g.font = `600 ${nItem.size}px "Segoe UI", Arial, sans-serif`;
        g.fillText(String(nItem.num), nItem.x, nItem.y);
      }
    }
    g.strokeStyle = '#ddd';
    g.beginPath(); g.moveTo(pad, r.height + 6); g.lineTo(r.width - pad, r.height + 6); g.stroke();
    g.textAlign = 'left'; g.textBaseline = 'middle';
    r.palette.forEach(({ num, rgb }, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = pad + col * (sw + 110);
      const y = r.height + pad + row * (sw + gap);
      g.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      g.fillRect(x, y, sw, sw);
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.strokeRect(x + 0.5, y + 0.5, sw - 1, sw - 1);
      g.fillStyle = '#333';
      g.font = '600 16px "Segoe UI", Arial, sans-serif';
      g.fillText(String(num), x + sw + 10, y + sw / 2);
    });
    downloadCanvas(c, 'paint-by-numbers-with-key.png');
  });

  els.printBtn.addEventListener('click', () => window.print());

})();
