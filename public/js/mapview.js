import { apiUrl, clamp } from './util.js';

function splitNumberToPath(value) {
  let result = '';
  let number = Number(value) || 0;
  if (number < 0) {
    number = -number;
    result += '-';
  }
  const digits = String(number);
  for (const digit of digits) result += `${digit}/`;
  return result;
}

export function tilePath(x, z) {
  const text = `x${splitNumberToPath(x)}z${splitNumberToPath(z)}`;
  return text.slice(0, -1);
}

export function pickLod(scale, lodFactor = 5, lodCount = 3) {
  const tileSize = 500;
  let lod = 1;
  while (lod < lodCount) {
    const tilePixelSize = tileSize * (lodFactor ** (lod - 1)) * scale;
    if (tilePixelSize >= 240) break;
    lod += 1;
  }
  return lod;
}

export class TileManager {
  constructor(onUpdate = () => {}) {
    this.onUpdate = onUpdate;
    this.cache = new Map();
    this.queue = [];
    this.active = 0;
    this.generation = 0;
    this.maxActive = 10;
    this.mapRoot = '';
    this.tileSize = 500;
    this.lodFactor = 5;
    this.lodCount = 3;
    this.useProxy = true;
    this.proxyAvailable = true;
    this.lastStats = { visible: 0, loaded: 0, pending: 0, error: 0, lod: 1 };
    this.currentLod = 1;
    this.currentWorldTile = 500;
  }

  configure({ mapRoot, tileSize, lodFactor, lodCount, useProxy = true }) {
    this.mapRoot = String(mapRoot || '').replace(/\/+$/, '');
    this.tileSize = Number(tileSize) || 500;
    this.lodFactor = Number(lodFactor) || 5;
    this.lodCount = Number(lodCount) || 3;
    this.useProxy = Boolean(useProxy);
    this.reset();
  }

  reset() {
    this.generation += 1;
    for (const entry of this.cache.values()) {
      entry.img.onload = null;
      entry.img.onerror = null;
      entry.img.src = '';
    }
    this.cache.clear();
    this.queue = [];
    this.active = 0;
  }

  directUrl(lod, x, z) {
    return `${this.mapRoot}/tiles/${lod}/${tilePath(x, z)}.png`;
  }

  proxyUrl(url) {
    return `${apiUrl('api/proxy')}?url=${encodeURIComponent(url)}`;
  }

  entryUrl(entry) {
    if (this.useProxy && this.proxyAvailable && !entry.retriedProxy) return this.proxyUrl(entry.direct);
    return entry.direct;
  }

  startEntry(entry) {
    if (entry.started || entry.done) return;
    entry.started = true;
    this.active += 1;
    entry.img.onload = () => {
      entry.loaded = true;
      entry.done = true;
      entry.started = false;
      this.active = Math.max(0, this.active - 1);
      this.drain();
      this.onUpdate();
    };
    entry.img.onerror = () => {
      entry.started = false;
      if (this.useProxy && this.proxyAvailable && !entry.retriedProxy) {
        entry.retriedProxy = true;
        entry.started = false;
        entry.img.onload = null;
        entry.img.onerror = null;
        entry.started = true;
        this.active += 1;
        entry.img.onload = () => {
          entry.loaded = true;
          entry.done = true;
          entry.started = false;
          this.active = Math.max(0, this.active - 1);
          this.drain();
          this.onUpdate();
        };
        entry.img.onerror = () => {
          entry.error = true;
          entry.errorTime = performance.now();
          entry.done = true;
          entry.started = false;
          this.active = Math.max(0, this.active - 1);
          this.drain();
          this.onUpdate();
          const generation = this.generation;
          setTimeout(() => {
            if (generation === this.generation && this.cache.get(entry.key) === entry) this.onUpdate();
          }, 15000);
        };
        entry.img.src = entry.direct;
        return;
      }
      entry.error = true;
      entry.errorTime = performance.now();
      entry.done = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
      this.onUpdate();
      const generation = this.generation;
      setTimeout(() => {
        if (generation === this.generation && this.cache.get(entry.key) === entry) this.onUpdate();
      }, 15000);
    };
    entry.img.src = this.entryUrl(entry);
  }

  drain() {
    while (this.active < this.maxActive && this.queue.length) {
      const entry = this.queue.shift();
      if (!entry || entry.done) continue;
      this.startEntry(entry);
    }
  }

  get(lod, x, z) {
    const key = `${lod}/${x}/${z}`;
    const existing = this.cache.get(key);
    if (existing) {
      if (existing.error && performance.now() - (existing.errorTime || 0) > 15000) {
        this.cache.delete(key);
      } else {
        existing.used = performance.now();
        return existing.loaded ? existing.img : null;
      }
    }
    const direct = this.directUrl(lod, x, z);
    const entry = {
      key,
      img: new Image(),
      direct,
      loaded: false,
      error: false,
      done: false,
      started: false,
      retriedProxy: false,
      used: performance.now(),
      generation: this.generation
    };
    entry.img.decoding = 'async';
    this.cache.set(key, entry);
    this.queue.push(entry);
    this.drain();
    this.evict();
    return null;
  }

  evict() {
    if (this.cache.size <= 140) return;
    const entries = Array.from(this.cache.values()).sort((a, b) => a.used - b.used);
    const remove = entries.slice(0, 45);
    for (const entry of remove) {
      if (entry.started && !entry.done) continue;
      entry.img.onload = null;
      entry.img.onerror = null;
      entry.img.src = '';
      this.cache.delete(entry.key);
    }
  }

  draw(ctx, view) {
    if (!this.mapRoot) {
      this.lastStats = { visible: 0, loaded: 0, pending: 0, error: 0, lod: 0 };
      return;
    }

    const { cx, cz, scale, width, height } = view;
    const lod = pickLod(scale, this.lodFactor, this.lodCount);
    const worldTile = this.tileSize * (this.lodFactor ** (lod - 1));
    const minX = cx - (width / 2) / scale;
    const maxX = cx + (width / 2) / scale;
    const minZ = cz - (height / 2) / scale;
    const maxZ = cz + (height / 2) / scale;
    const startX = Math.floor(minX / worldTile);
    const endX = Math.floor(maxX / worldTile);
    const startZ = Math.floor(minZ / worldTile);
    const endZ = Math.floor(maxZ / worldTile);
    this.currentLod = lod;
    this.currentWorldTile = worldTile;

    let visible = 0;
    let loaded = 0;
    let pending = 0;
    let error = 0;

    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = scale < 1.1;

    for (let z = startZ; z <= endZ; z += 1) {
      for (let x = startX; x <= endX; x += 1) {
        visible += 1;
        const img = this.get(lod, x, z);
        if (img) {
          loaded += 1;
          const screenX = (x * worldTile - cx) * scale + width / 2;
          const screenZ = (z * worldTile - cz) * scale + height / 2;
          const size = worldTile * scale;
          ctx.drawImage(img, 0, 0, this.tileSize, this.tileSize, screenX - 0.5, screenZ - 0.5, size + 1, size + 1);
        } else {
          const entry = this.cache.get(`${lod}/${x}/${z}`);
          if (entry?.error) error += 1;
          else pending += 1;
        }
      }
    }

    ctx.imageSmoothingEnabled = smoothing;
    this.lastStats = { visible, loaded, pending, error, lod };
  }
}

export function niceStep(targetPixels, min = 1) {
  const raw = targetPixels;
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const scaled = raw / power;
  let nice;
  if (scaled <= 1) nice = 1;
  else if (scaled <= 2) nice = 2;
  else if (scaled <= 5) nice = 5;
  else nice = 10;
  return Math.max(min, nice * power);
}

export function createView() {
  return {
    cx: 0,
    cz: 0,
    scale: 0.5,
    minScale: 0.02,
    maxScale: 12,
    width: 1,
    height: 1
  };
}

export function clampView(view) {
  view.scale = clamp(view.scale, view.minScale, view.maxScale);
  return view;
}
