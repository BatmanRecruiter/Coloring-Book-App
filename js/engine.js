/*
 * Coloring Book Studio — image processing engine.
 *
 * Pure functions over {data, width, height} pixel buffers (RGBA), no DOM
 * dependencies, so the engine can run in the browser or under Node for tests.
 */
'use strict';

(function (global) {

  // ---------------------------------------------------------------- helpers

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function grayscale(data, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
    return g;
  }

  function boxPassH(src, dst, w, h, r) {
    const iw = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        dst[row + x] = sum * iw;
        sum += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
      }
    }
  }

  function boxPassV(src, dst, w, h, r) {
    const iw = 1 / (2 * r + 1);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += src[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum * iw;
        sum += src[clamp(y + r + 1, 0, h - 1) * w + x] - src[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }

  // Two chained box blurs approximate a Gaussian well enough for our use.
  function blur(channel, w, h, r, passes) {
    if (r <= 0) return channel;
    let a = Float32Array.from(channel);
    let b = new Float32Array(w * h);
    for (let p = 0; p < passes; p++) {
      boxPassH(a, b, w, h, r);
      boxPassV(b, a, w, h, r);
    }
    return a;
  }

  function sobelMagnitude(g, w, h) {
    const m = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1]
                 + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
        const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1]
                 + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
        m[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return m;
  }

  function dilate8(mask, w, h) {
    const out = new Uint8Array(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
        const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) out[yy * w + xx] = 1;
        }
      }
    }
    return out;
  }

  // Remove line pixels with at most one 8-connected line neighbour.
  function despeckle(mask, w, h, passes) {
    for (let p = 0; p < passes; p++) {
      const out = new Uint8Array(mask);
      let changed = false;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!mask[i]) continue;
          let neighbours = 0;
          const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
          const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              if ((yy !== y || xx !== x) && mask[yy * w + xx]) neighbours++;
            }
          }
          if (neighbours <= 1) { out[i] = 0; changed = true; }
        }
      }
      mask = out;
      if (!changed) break;
    }
    return mask;
  }

  // ------------------------------------------------------------ outline mode

  /**
   * Convert a photo into black outlines on white.
   * opts: detail 1..100, smooth 0..5 (blur radius px), thickness 1..4
   */
  function outline(img, opts) {
    opts = opts || {};
    const w = img.width, h = img.height;
    const detail = clamp(opts.detail == null ? 55 : opts.detail, 1, 100);
    const smooth = clamp(opts.smooth == null ? 1 : opts.smooth, 0, 6);
    const thickness = clamp(opts.thickness == null ? 1 : opts.thickness, 1, 4);

    let g = grayscale(img.data, w, h);
    if (smooth > 0) g = blur(g, w, h, smooth, 2);
    const mag = sobelMagnitude(g, w, h);

    // Percentile-based threshold: higher detail keeps more (weaker) edges.
    const step = Math.max(1, Math.floor((w * h) / 50000));
    const sample = [];
    for (let i = 0; i < mag.length; i += step) sample.push(mag[i]);
    sample.sort((a, b) => a - b);
    const q = lerp(0.985, 0.84, detail / 100);
    let thr = sample[Math.min(sample.length - 1, Math.floor(q * sample.length))];
    // Absolute floor keeps banding in smooth gradients from becoming lines.
    thr = Math.max(thr, lerp(34, 14, detail / 100));

    let mask = new Uint8Array(w * h);
    for (let i = 0; i < mag.length; i++) mask[i] = mag[i] >= thr ? 1 : 0;
    mask = despeckle(mask, w, h, 2);
    for (let t = 1; t < thickness; t++) mask = dilate8(mask, w, h);

    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
      const v = mask[i] ? 26 : 255;
      out[j] = out[j + 1] = out[j + 2] = v;
      out[j + 3] = 255;
    }
    return { data: out, width: w, height: h };
  }

  // ----------------------------------------------------- colour quantization

  function kmeansQuantize(data, w, h, k) {
    const n = w * h;
    const step = Math.max(1, Math.floor(n / 30000));
    const pts = [];
    for (let i = 0; i < n; i += step) {
      const j = i * 4;
      pts.push(data[j], data[j + 1], data[j + 2]);
    }
    const m = pts.length / 3;
    k = Math.min(k, m);

    // Deterministic farthest-point init, seeded from the mean colour.
    const cent = new Float64Array(k * 3);
    let mr = 0, mg = 0, mb = 0;
    for (let p = 0; p < m; p++) { mr += pts[p * 3]; mg += pts[p * 3 + 1]; mb += pts[p * 3 + 2]; }
    mr /= m; mg /= m; mb /= m;
    let seed = 0, bestD = Infinity;
    for (let p = 0; p < m; p++) {
      const dr = pts[p * 3] - mr, dg = pts[p * 3 + 1] - mg, db = pts[p * 3 + 2] - mb;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; seed = p; }
    }
    cent[0] = pts[seed * 3]; cent[1] = pts[seed * 3 + 1]; cent[2] = pts[seed * 3 + 2];
    const minD = new Float64Array(m).fill(Infinity);
    for (let c = 1; c < k; c++) {
      const cr = cent[(c - 1) * 3], cg = cent[(c - 1) * 3 + 1], cb = cent[(c - 1) * 3 + 2];
      let far = 0, farD = -1;
      for (let p = 0; p < m; p++) {
        const dr = pts[p * 3] - cr, dg = pts[p * 3 + 1] - cg, db = pts[p * 3 + 2] - cb;
        const d = dr * dr + dg * dg + db * db;
        if (d < minD[p]) minD[p] = d;
        if (minD[p] > farD) { farD = minD[p]; far = p; }
      }
      cent[c * 3] = pts[far * 3]; cent[c * 3 + 1] = pts[far * 3 + 1]; cent[c * 3 + 2] = pts[far * 3 + 2];
    }

    // Lloyd iterations on the sample.
    const assign = new Int32Array(m);
    const sums = new Float64Array(k * 3);
    const counts = new Int32Array(k);
    for (let iter = 0; iter < 14; iter++) {
      sums.fill(0); counts.fill(0);
      let moved = 0;
      for (let p = 0; p < m; p++) {
        const r = pts[p * 3], gg = pts[p * 3 + 1], b = pts[p * 3 + 2];
        let bi = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const dr = r - cent[c * 3], dg = gg - cent[c * 3 + 1], db = b - cent[c * 3 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; bi = c; }
        }
        if (assign[p] !== bi) { assign[p] = bi; moved++; }
        sums[bi * 3] += r; sums[bi * 3 + 1] += gg; sums[bi * 3 + 2] += b;
        counts[bi]++;
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] > 0) {
          cent[c * 3] = sums[c * 3] / counts[c];
          cent[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
          cent[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
        }
      }
      if (moved === 0 && iter > 0) break;
    }

    // Assign every pixel to its nearest centroid.
    const labels = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const r = data[j], gg = data[j + 1], b = data[j + 2];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - cent[c * 3], dg = gg - cent[c * 3 + 1], db = b - cent[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; bi = c; }
      }
      labels[i] = bi;
    }

    const palette = [];
    for (let c = 0; c < k; c++) {
      palette.push([Math.round(cent[c * 3]), Math.round(cent[c * 3 + 1]), Math.round(cent[c * 3 + 2])]);
    }
    return { labels, palette };
  }

  // ------------------------------------------------------- label-map cleanup

  // 3x3 majority vote over the label map; ties keep the centre pixel.
  function modeFilter(labels, w, h, k, passes) {
    const counts = new Int32Array(k);
    for (let p = 0; p < passes; p++) {
      const src = Int32Array.from(labels);
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
          let best = src[y * w + x];
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) counts[src[yy * w + xx]]++;
          }
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              const l = src[yy * w + xx];
              if (counts[l] > counts[best]) best = l;
            }
          }
          labels[y * w + x] = best;
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) counts[src[yy * w + xx]] = 0;
          }
        }
      }
    }
    return labels;
  }

  function connectedComponents(labels, w, h) {
    const n = w * h;
    const comp = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    const sizes = [];
    const colors = [];
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      const label = labels[i];
      let sp = 0, size = 0;
      stack[sp++] = i;
      comp[i] = count;
      while (sp > 0) {
        const p = stack[--sp];
        size++;
        const x = p % w, y = (p - x) / w;
        if (x > 0 && comp[p - 1] < 0 && labels[p - 1] === label) { comp[p - 1] = count; stack[sp++] = p - 1; }
        if (x < w - 1 && comp[p + 1] < 0 && labels[p + 1] === label) { comp[p + 1] = count; stack[sp++] = p + 1; }
        if (y > 0 && comp[p - w] < 0 && labels[p - w] === label) { comp[p - w] = count; stack[sp++] = p - w; }
        if (y < h - 1 && comp[p + w] < 0 && labels[p + w] === label) { comp[p + w] = count; stack[sp++] = p + w; }
      }
      sizes.push(size);
      colors.push(label);
      count++;
    }
    return { comp, count, sizes, colors };
  }

  // Absorb regions smaller than minSize into the neighbour they share the
  // longest border with (preferring neighbours that are themselves big).
  function mergeSmallRegions(labels, w, h, minSize, rounds) {
    for (let r = 0; r < rounds; r++) {
      const { comp, count, sizes, colors } = connectedComponents(labels, w, h);
      const tally = new Array(count).fill(null);
      let anySmall = false;

      const touch = (i, ni) => {
        const c = comp[i], nc = comp[ni];
        if (c === nc) return;
        if (sizes[c] < minSize) {
          anySmall = true;
          (tally[c] || (tally[c] = new Map())).set(nc, (tally[c] ? tally[c].get(nc) || 0 : 0) + 1);
        }
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (x < w - 1) { touch(i, i + 1); touch(i + 1, i); }
          if (y < h - 1) { touch(i, i + w); touch(i + w, i); }
        }
      }
      if (!anySmall) break;

      const newLabel = new Int32Array(count);
      for (let c = 0; c < count; c++) newLabel[c] = colors[c];
      for (let c = 0; c < count; c++) {
        const t = tally[c];
        if (!t) continue;
        let bestNc = -1, bestScore = -1;
        for (const [nc, border] of t) {
          const big = sizes[nc] >= minSize ? 1 : 0;
          const score = big * 1e9 + border;
          if (score > bestScore) { bestScore = score; bestNc = nc; }
        }
        if (bestNc >= 0) newLabel[c] = colors[bestNc];
      }
      for (let i = 0; i < labels.length; i++) labels[i] = newLabel[comp[i]];
    }
    return labels;
  }

  // ------------------------------------------------ boundaries and numbering

  function boundaryMask(labels, w, h) {
    const b = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if ((x < w - 1 && labels[i] !== labels[i + 1]) ||
            (y < h - 1 && labels[i] !== labels[i + w])) b[i] = 1;
      }
    }
    return b;
  }

  // Chamfer 3-4 distance (in ~pixels) to the nearest region boundary or
  // image edge. Used to find a roomy interior spot for each number.
  function distanceToBoundary(labels, w, h) {
    const n = w * h;
    const INF = 1 << 29;
    const d = new Int32Array(n).fill(INF);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
            labels[i] !== labels[i + 1] || labels[i] !== labels[i + w] ||
            labels[i] !== labels[i - 1] || labels[i] !== labels[i - w]) d[i] = 0;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 3);
        if (y > 0) {
          v = Math.min(v, d[i - w] + 3);
          if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
          if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
        }
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
        if (y < h - 1) {
          v = Math.min(v, d[i + w] + 3);
          if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
          if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
        }
        d[i] = v;
      }
    }
    return d;
  }

  // ---------------------------------------------------- paint-by-numbers mode

  /**
   * Convert a photo into a paint-by-numbers page.
   * opts: colors 2..32, simplify 0..100, thickness 1..3
   * Returns { lines, filled, width, height, palette, numbers }
   *   palette: [{num, rgb: [r,g,b]}] in legend order
   *   numbers: [{x, y, size, num}] label placements in pixel coords
   */
  function paintByNumbers(img, opts) {
    opts = opts || {};
    const w = img.width, h = img.height, n = w * h;
    const k = clamp(opts.colors == null ? 8 : opts.colors, 2, 32);
    const simplify = clamp(opts.simplify == null ? 45 : opts.simplify, 0, 100);
    const thickness = clamp(opts.thickness == null ? 1 : opts.thickness, 1, 3);

    // Light pre-blur knocks out sensor noise before clustering.
    let data = img.data;
    {
      const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 4) { r[i] = data[j]; g[i] = data[j + 1]; b[i] = data[j + 2]; }
      const rb = blur(r, w, h, 1, 1), gb = blur(g, w, h, 1, 1), bb = blur(b, w, h, 1, 1);
      const smoothed = new Uint8ClampedArray(n * 4);
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        smoothed[j] = rb[i]; smoothed[j + 1] = gb[i]; smoothed[j + 2] = bb[i]; smoothed[j + 3] = 255;
      }
      data = smoothed;
    }

    const { labels, palette: rawPalette } = kmeansQuantize(data, w, h, k);
    const kActual = rawPalette.length;

    modeFilter(labels, w, h, kActual, 1 + Math.round(simplify / 50));
    const minSize = Math.max(12, Math.round(n * lerp(0.00015, 0.0035, simplify / 100)));
    mergeSmallRegions(labels, w, h, minSize, 3);
    modeFilter(labels, w, h, kActual, 1);
    mergeSmallRegions(labels, w, h, minSize, 1);

    // Compact the palette to the colours that survived, lightest first.
    const used = new Set();
    for (let i = 0; i < n; i++) used.add(labels[i]);
    const order = [...used].sort((a, b) => {
      const la = 0.299 * rawPalette[a][0] + 0.587 * rawPalette[a][1] + 0.114 * rawPalette[a][2];
      const lb = 0.299 * rawPalette[b][0] + 0.587 * rawPalette[b][1] + 0.114 * rawPalette[b][2];
      return lb - la;
    });
    const numberOf = new Int32Array(kActual).fill(0);
    const palette = order.map((label, idx) => {
      numberOf[label] = idx + 1;
      return { num: idx + 1, rgb: rawPalette[label] };
    });

    // Number placement: the deepest interior point of each region.
    const { comp, count, sizes, colors } = connectedComponents(labels, w, h);
    const dist = distanceToBoundary(labels, w, h);
    const bestDist = new Int32Array(count).fill(-1);
    const bestIdx = new Int32Array(count).fill(-1);
    for (let i = 0; i < n; i++) {
      const c = comp[i];
      if (dist[i] > bestDist[c]) { bestDist[c] = dist[i]; bestIdx[c] = i; }
    }
    const numbers = [];
    for (let c = 0; c < count; c++) {
      const radius = bestDist[c] / 3;
      if (sizes[c] < minSize || radius < 4.2 || bestIdx[c] < 0) continue;
      const i = bestIdx[c];
      numbers.push({
        x: i % w,
        y: Math.floor(i / w),
        size: clamp(Math.round(radius * 1.15), 9, 34),
        num: numberOf[colors[c]],
      });
    }

    // Render the two output layers.
    let bounds = boundaryMask(labels, w, h);
    for (let t = 1; t < thickness; t++) bounds = dilate8(bounds, w, h);

    const lines = new Uint8ClampedArray(n * 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = bounds[i] ? 40 : 255;
      lines[j] = lines[j + 1] = lines[j + 2] = v;
      lines[j + 3] = 255;
    }

    const filled = new Uint8ClampedArray(n * 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const rgb = rawPalette[labels[i]];
      const shade = bounds[i] ? 0.55 : 1;
      filled[j] = rgb[0] * shade;
      filled[j + 1] = rgb[1] * shade;
      filled[j + 2] = rgb[2] * shade;
      filled[j + 3] = 255;
    }

    return {
      lines: { data: lines, width: w, height: h },
      filled: { data: filled, width: w, height: h },
      width: w,
      height: h,
      palette,
      numbers,
    };
  }

  const engine = { outline, paintByNumbers };
  global.CBEngine = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;

})(typeof window !== 'undefined' ? window : globalThis);
