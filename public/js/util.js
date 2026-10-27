export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function debounce(fn, wait = 200) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function attr(value) {
  return escapeHtml(value);
}

export function slugify(value, fallback = 'item') {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };
  const text = String(value ?? '').toLowerCase().split('').map((char) => map[char] ?? char).join('');
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || fallback;
}

export function uniqueId(base, used) {
  const set = used instanceof Set ? used : new Set(used || []);
  let id = base;
  let i = 2;
  while (set.has(id)) {
    id = `${base}-${i}`;
    i += 1;
  }
  return id;
}

export function normalizeBaseUrl(input) {
  let text = String(input || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  url.hash = '';
  url.search = '';
  if (url.pathname.endsWith('/index.html')) url.pathname = url.pathname.slice(0, -10);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function resolveUrl(value, base) {
  if (!value) return '';
  try {
    return new URL(value, `${base.replace(/\/+$/, '')}/`).toString();
  } catch {
    return value;
  }
}

export function joinUrl(base, ...parts) {
  const cleaned = parts.filter(Boolean).map((part) => String(part).replace(/^\/+|\/+$/g, ''));
  return `${base.replace(/\/+$/, '')}/${cleaned.join('/')}`;
}

export function apiUrl(path) {
  return new URL(String(path).replace(/^\/+/, ''), document.baseURI).toString();
}

export function parseAnchor(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length !== 10) {
    return parts[0] ? { mapId: parts[0] } : null;
  }
  return {
    mapId: parts[0],
    x: Number(parts[1]),
    y: Number(parts[2]),
    z: Number(parts[3]),
    distance: Number(parts[4]),
    rotation: Number(parts[5]),
    angle: Number(parts[6]),
    tilt: Number(parts[7]),
    ortho: Number(parts[8]),
    view: parts[9]
  };
}

export function hexToRgb(hex) {
  let value = String(hex || '#000000').trim();
  if (value.startsWith('#')) value = value.slice(1);
  if (value.length === 3) value = value.split('').map((char) => char + char).join('');
  if (value.length === 4) value = value.slice(0, 3).split('').map((char) => char + char).join('') + value.slice(3).repeat(2);
  if (value.length === 8) value = value.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(value)) value = '000000';
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

export function rgbToHex(r, g, b) {
  const part = (value) => clamp(Math.round(Number(value) || 0), 0, 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function colorFromObject(value, fallback = '#38bdf8') {
  if (!value) return fallback;
  if (typeof value === 'string') return value.startsWith('#') ? value : fallback;
  if (typeof value === 'object' && 'r' in value) {
    return rgbToHex(value.r, value.g, value.b);
  }
  return fallback;
}

export function alphaFromColorObject(value, fallback = 1) {
  if (!value || typeof value !== 'object') return fallback;
  const alpha = Number(value.a);
  return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : fallback;
}

export function colorToParts(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return { r, g, b, a: Math.round(clamp(alpha, 0, 1) * 1000) / 1000 };
}

export function cssColor(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function fmt(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const rounded = Number(num.toFixed(digits));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function fmtDistance(value) {
  const num = Number(value) || 0;
  if (num >= 10000) return `${Math.round(num / 100) / 10} км`;
  if (num >= 1000) return `${(num / 1000).toFixed(2)} км`;
  return `${num.toFixed(num < 10 ? 1 : 0)} бл.`;
}

export function distance2d(a, b) {
  return Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.z ?? 0) - (a.z ?? 0));
}

export function distance3d(a, b) {
  return Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0), (b.z ?? 0) - (a.z ?? 0));
}

export function polylineLength(points, threeD = false) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += threeD ? distance3d(points[i - 1], points[i]) : distance2d(points[i - 1], points[i]);
  }
  return total;
}

export function bbox(points) {
  const xs = points.map((p) => Number(p.x) || 0);
  const zs = points.map((p) => Number(p.z) || 0);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs)
  };
}

export function centroid(points) {
  if (!points.length) return { x: 0, z: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + (Number(p.x) || 0), z: acc.z + (Number(p.z) || 0) }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}

export function objectCenter(object) {
  if (object.type === 'poi') {
    return { x: Number(object.position?.x) || 0, y: Number(object.position?.y) || 0, z: Number(object.position?.z) || 0 };
  }
  if (object.type === 'line') {
    const points = object.line || [];
    const box = bbox(points);
    const ys = points.map((p) => Number(p.y) || 0);
    return {
      x: (box.minX + box.maxX) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      z: (box.minZ + box.maxZ) / 2
    };
  }
  const points = object.shape || [];
  const box = bbox(points);
  const y = object.type === 'extrude'
    ? ((Number(object.shapeMinY) || 0) + (Number(object.shapeMaxY) || 0)) / 2
    : Number(object.shapeY) || 0;
  return { x: (box.minX + box.maxX) / 2, y, z: (box.minZ + box.maxZ) / 2 };
}

export function objectBounds(object) {
  if (object.type === 'poi') {
    const p = object.position || { x: 0, z: 0 };
    return { minX: Number(p.x) || 0, maxX: Number(p.x) || 0, minZ: Number(p.z) || 0, maxZ: Number(p.z) || 0 };
  }
  const points = object.type === 'line' ? object.line : object.shape;
  return bbox(points || []);
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read error'));
    reader.readAsText(file, 'utf-8');
  });
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  return ok;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeHex(value, fallback = '#38bdf8') {
  let text = String(value || '').trim();
  if (!text.startsWith('#')) text = `#${text}`;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    text = `#${text.slice(1).split('').map((char) => char + char).join('')}`;
  }
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

export function num(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function vector2(value, fallback = { x: 0, z: 0 }) {
  if (Array.isArray(value)) return { x: num(value[0], fallback.x), z: num(value[1], fallback.z) };
  if (value && typeof value === 'object') return { x: num(value.x, fallback.x), z: num(value.z, fallback.z) };
  return { ...fallback };
}

export function vector3(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (Array.isArray(value)) {
    return { x: num(value[0], fallback.x), y: num(value[1], fallback.y), z: num(value[2], fallback.z) };
  }
  if (value && typeof value === 'object') {
    return { x: num(value.x, fallback.x), y: num(value.y, fallback.y), z: num(value.z, fallback.z) };
  }
  return { ...fallback };
}

export function plural(value, one, few, many) {
  const number = Math.abs(Number(value) || 0);
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function titleCase(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
