import {
  centroid,
  clamp,
  cssColor,
  deepClone,
  distance2d,
  escapeHtml,
  fmt,
  fmtDistance,
  normalizeHex,
  polylineLength
} from './util.js';
import { clampView, niceStep } from './mapview.js';
import { TYPE_LABELS } from './config.js';

function findSelected(app) {
  const selected = app.editor.selected;
  if (!selected || selected.kind !== 'object') return null;
  const set = app.project.sets.find((item) => item.id === selected.setId);
  const object = set?.objects.find((item) => item.id === selected.id);
  return set && object ? { set, object } : null;
}

export function initCanvas(app) {
  const { dom, view, editor } = app;
  const ctx = dom.mapCanvas.getContext('2d');
  const tileManager = app.tileManager;
  const pointer = {
    down: false,
    button: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    mode: null,
    moved: false,
    drag: null,
    panView: null,
    space: false
  };
  let drawQueued = false;
  const iconCache = new Map();

  function resolveIcon(url) {
    const value = String(url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    const base = app.source?.base || app.project?.source?.url;
    if (!base) return value;
    return `${base.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;
  }

  function getIcon(url) {
    if (!url) return null;
    let entry = iconCache.get(url);
    if (!entry) {
      const img = new Image();
      entry = { img, loaded: false, error: false };
      img.onload = () => {
        entry.loaded = true;
        requestDraw();
      };
      img.onerror = () => {
        entry.error = true;
        requestDraw();
      };
      img.src = url;
      iconCache.set(url, entry);
    }
    return entry.loaded ? entry.img : null;
  }

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }

  function resize() {
    const rect = dom.mapWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    view.width = width;
    view.height = height;
    dom.mapCanvas.width = Math.round(width * dpr);
    dom.mapCanvas.height = Math.round(height * dpr);
    dom.mapCanvas.style.width = `${width}px`;
    dom.mapCanvas.style.height = `${height}px`;
    requestDraw();
  }

  function worldToScreen(x, z) {
    return {
      x: (Number(x) - view.cx) * view.scale + view.width / 2,
      y: (Number(z) - view.cz) * view.scale + view.height / 2
    };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - view.width / 2) / view.scale + view.cx,
      z: (y - view.height / 2) / view.scale + view.cz
    };
  }

  function roundCoord(value) {
    return editor.snap ? Math.round(value) : Math.round(value * 100) / 100;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = '#050b14';
    ctx.fillRect(0, 0, view.width, view.height);
    tileManager.draw(ctx, view);
    if (editor.showGrid) drawGrid();
    if (editor.showPlayers) drawPlayers();
    drawObjects();
    drawDraft();
    drawRuler();
    drawSelection();
    updateHud();
  }

  function drawGrid() {
    const step = niceStep(92 / view.scale, 1);
    const minX = view.cx - (view.width / 2) / view.scale;
    const maxX = view.cx + (view.width / 2) / view.scale;
    const minZ = view.cz - (view.height / 2) / view.scale;
    const maxZ = view.cz + (view.height / 2) / view.scale;
    const startX = Math.ceil(minX / step) * step;
    const startZ = Math.ceil(minZ / step) * step;
    const major = step * 5;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    for (let x = startX; x <= maxX; x += step) {
      const screen = worldToScreen(x, view.cz);
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 0.0001;
      ctx.strokeStyle = isMajor ? 'rgba(148, 184, 226, 0.16)' : 'rgba(148, 184, 226, 0.065)';
      ctx.beginPath();
      ctx.moveTo(Math.round(screen.x) + 0.5, 0);
      ctx.lineTo(Math.round(screen.x) + 0.5, view.height);
      ctx.stroke();
      if (isMajor) {
        const text = fmt(x, 0);
        const width = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(7, 13, 24, 0.6)';
        ctx.fillRect(screen.x + 4, view.height - 18, width + 6, 14);
        ctx.fillStyle = 'rgba(141, 162, 192, 0.72)';
        ctx.fillText(text, screen.x + 7, view.height - 16);
      }
    }
    for (let z = startZ; z <= maxZ; z += step) {
      const screen = worldToScreen(view.cx, z);
      const isMajor = Math.abs(z / major - Math.round(z / major)) < 0.0001;
      ctx.strokeStyle = isMajor ? 'rgba(148, 184, 226, 0.16)' : 'rgba(148, 184, 226, 0.065)';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(screen.y) + 0.5);
      ctx.lineTo(view.width, Math.round(screen.y) + 0.5);
      ctx.stroke();
      if (isMajor) {
        const text = fmt(z, 0);
        const width = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(7, 13, 24, 0.6)';
        ctx.fillRect(7, screen.y + 4, width + 6, 14);
        ctx.fillStyle = 'rgba(141, 162, 192, 0.72)';
        ctx.fillText(text, 10, screen.y + 6);
      }
    }
    ctx.restore();
  }

  function drawPlayers() {
    for (const player of editor.players || []) {
      const point = player.position;
      if (!point) continue;
      const screen = worldToScreen(point.x, point.z);
      if (screen.x < -40 || screen.x > view.width + 40 || screen.y < -40 || screen.y > view.height + 40) continue;
      const hue = hashString(player.name || player.uuid || 'player') % 360;
      const color = `hsl(${hue} 85% 62%)`;
      ctx.save();
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(4, 10, 18, 0.9)';
      ctx.stroke();
      drawLabel(player.name || 'player', screen.x + 9, screen.y - 7, color, { small: true });
      ctx.restore();
    }
  }

  function hashString(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return Math.abs(hash);
  }

  function drawObjects() {
    for (const set of app.project.sets) {
      if (set.visible === false) continue;
      for (const object of set.objects) {
        if (object.visible === false) continue;
        drawObject(object, set);
      }
    }
  }

  function drawObject(object, set) {
    if (object.type === 'poi') {
      drawPoi(object, set);
      return;
    }
    const points = object.type === 'line' ? object.line : object.shape;
    if (!points || points.length < 2) return;
    const selected = editor.selected?.kind === 'object' && editor.selected.setId === set.id && editor.selected.id === object.id;
    const hovered = editor.hover?.setId === set.id && editor.hover?.id === object.id;
    ctx.save();
    ctx.beginPath();
    points.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.z);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    if (object.type !== 'line') ctx.closePath();
    if (object.type !== 'line') {
      ctx.fillStyle = cssColor(object.fillColor || object.lineColor, object.fillAlpha ?? 0.22);
      ctx.fill();
    }
    if (selected || hovered) {
      ctx.strokeStyle = cssColor(object.lineColor, 0.28);
      ctx.lineWidth = Math.max(6, (object.lineWidth || 3) + 6);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.strokeStyle = cssColor(object.lineColor, object.lineAlpha ?? 1);
    ctx.lineWidth = Math.max(1, Number(object.lineWidth) || 3);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (object.type === 'extrude') ctx.setLineDash([9, 5]);
    ctx.stroke();
    ctx.restore();
    if (editor.showLabels || selected || hovered) {
      const center = object.type === 'line' ? points[Math.floor(points.length / 2)] : centroid(points);
      const screen = worldToScreen(center.x, center.z);
      drawLabel(object.label || TYPE_LABELS[object.type], screen.x, screen.y, cssColor(object.lineColor, 1), { selected, center: true });
    }
  }

  function drawPoi(object, set) {
    const screen = worldToScreen(object.position.x, object.position.z);
    if (screen.x < -80 || screen.x > view.width + 80 || screen.y < -80 || screen.y > view.height + 80) return;
    const selected = editor.selected?.kind === 'object' && editor.selected.setId === set.id && editor.selected.id === object.id;
    const hovered = editor.hover?.setId === set.id && editor.hover?.id === object.id;
    const color = normalizeHex(object.color, '#38bdf8');
    const custom = object.icon && object.icon !== 'assets/poi.svg' ? getIcon(resolveIcon(object.icon)) : null;
    if (custom) {
      const anchor = object.anchor || { x: 25, y: 45 };
      const left = screen.x - Number(anchor.x || 0);
      const top = screen.y - Number(anchor.y || 0);
      if (selected || hovered) {
        ctx.save();
        ctx.strokeStyle = cssColor(color, 0.9);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(left - 3, top - 3, custom.naturalWidth + 6, custom.naturalHeight + 6);
        ctx.restore();
      }
      ctx.drawImage(custom, left, top);
    } else {
      drawPin(screen.x, screen.y, color, selected || hovered);
    }
    if (editor.showLabels || selected || hovered) {
      drawLabel(object.label || 'Маркер', screen.x + 10, screen.y - 28, color, { small: true });
    }
  }

  function drawPin(x, y, color, highlighted) {
    ctx.save();
    if (highlighted) {
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(color, 0.12);
      ctx.fill();
      ctx.strokeStyle = cssColor(color, 0.6);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-3, -8, -11, -14, -11, -23);
    ctx.bezierCurveTo(-11, -32, -6, -37, 0, -37);
    ctx.bezierCurveTo(6, -37, 11, -32, 11, -23);
    ctx.bezierCurveTo(11, -14, 3, -8, 0, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(6, 14, 24, 0.85)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -24, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 14, 24, 0.8)';
    ctx.fill();
    ctx.restore();
  }

  function drawLabel(text, x, y, color, options = {}) {
    const { selected = false, center = false, small = false } = options;
    if (!text) return;
    const label = text.length > 34 ? `${text.slice(0, 32)}…` : text;
    ctx.save();
    ctx.font = `${small ? 10 : 11}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(label);
    const height = small ? 16 : 18;
    const padding = 5;
    const left = center ? x - metrics.width / 2 - padding : x;
    const top = y - height / 2;
    ctx.fillStyle = 'rgba(5, 12, 22, 0.74)';
    roundRect(left, top, metrics.width + padding * 2, height, 5);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      roundRect(left, top, metrics.width + padding * 2, height, 5);
      ctx.stroke();
    }
    ctx.fillStyle = selected ? '#fff' : color;
    ctx.fillText(label, left + padding, y + 0.5);
    ctx.restore();
  }

  function roundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawSelection() {
    const found = findSelected(app);
    if (!found) return;
    if (found.set.visible === false || found.object.visible === false) return;
    const { object } = found;
    if (object.type === 'poi') return;
    const points = object.type === 'line' ? object.line : object.shape;
    points.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.z);
      const isHover = editor.hoverVertex?.index === index;
      ctx.save();
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, isHover ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? '#fff' : '#0d1727';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cssColor(object.lineColor, 1);
      ctx.stroke();
      if (index === 0) {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = cssColor(object.lineColor, 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawDraft() {
    const draft = editor.draft;
    if (!draft) return;
    const points = draft.points;
    const cursor = draft.cursor;
    if (!points.length) return;
    const screenPoints = points.map((point) => worldToScreen(point.x, point.z));
    const color = draft.tool === 'line' ? '#fb923c' : draft.tool === 'extrude' ? '#a78bfa' : '#34d399';
    ctx.save();
    ctx.beginPath();
    screenPoints.forEach((screen, index) => {
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    if (cursor) {
      const screen = worldToScreen(cursor.x, cursor.z);
      ctx.lineTo(screen.x, screen.y);
    }
    if (draft.tool !== 'line') {
      ctx.fillStyle = cssColor(color, 0.12);
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const screen of screenPoints) {
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1727';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRuler() {
    const points = app.project.ruler?.points || [];
    if (!points.length) return;
    const cursor = editor.tool === 'ruler' && editor.lastPointer ? screenToWorld(editor.lastPointer.x, editor.lastPointer.y) : null;
    const all = cursor ? [...points, cursor] : points;
    ctx.save();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    all.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.z);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    points.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.z);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1727';
      ctx.fill();
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (index > 0) {
        const previous = points[index - 1];
        const mid = { x: (point.x + previous.x) / 2, z: (point.z + previous.z) / 2 };
        const midScreen = worldToScreen(mid.x, mid.z);
        drawLabel(fmtDistance(distance2d(previous, point)), midScreen.x, midScreen.y, '#fde68a', { center: true, small: true });
      }
    });
    if (points.length >= 2) {
      const last = points[points.length - 1];
      const lastScreen = worldToScreen(last.x, last.z);
      drawLabel(`итого ${fmtDistance(polylineLength(points, false))}`, lastScreen.x, lastScreen.y - 24, '#facc15', { center: true });
    }
    ctx.restore();
  }

  function updateHud() {
    const pointerWorld = editor.lastPointer ? screenToWorld(editor.lastPointer.x, editor.lastPointer.y) : { x: view.cx, z: view.cz };
    dom.coords.textContent = `x ${fmt(pointerWorld.x, 0)} · z ${fmt(pointerWorld.z, 0)}`;
    dom.zoomInfo.textContent = `${Math.round(view.scale * 100)}%`;
    const stats = tileManager.lastStats;
    dom.tileStatus.textContent = stats.visible
      ? `тайлы: ${stats.loaded}/${stats.visible} · LOD ${stats.lod}${stats.pending ? ' · загрузка' : ''}`
      : 'тайлы: —';
    const nice = niceStep(120 / view.scale, 1);
    const width = clamp(nice * view.scale, 30, 180);
    dom.scaleBar.querySelector('i').style.width = `${width}px`;
    dom.scaleBar.querySelector('span').textContent = `${fmt(nice, nice < 10 ? 1 : 0)} блоков`;
    if (app.updateDraftHud) app.updateDraftHud();
  }

  function centerOn(x, z, scale = null) {
    view.cx = Number(x) || 0;
    view.cz = Number(z) || 0;
    if (scale != null) view.scale = clamp(scale, view.minScale, view.maxScale);
    clampView(view);
    app.saveSoon();
    requestDraw();
  }

  function fitBounds(bounds, padding = 90) {
    if (!bounds) {
      centerOn(app.project.map?.startPos?.x || 0, app.project.map?.startPos?.z || 0, 0.5);
      return;
    }
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxZ - bounds.minZ);
    const span = Math.max(w, h);
    if (span < 8) {
      view.scale = 1.5;
    } else {
      const scale = clamp(Math.min((view.width - padding * 2) / w, (view.height - padding * 2) / h), view.minScale, 3.2);
      view.scale = Number.isFinite(scale) && scale > 0 ? Math.max(0.12, scale) : 0.8;
    }
    view.cx = (bounds.minX + bounds.maxX) / 2;
    view.cz = (bounds.minZ + bounds.maxZ) / 2;
    app.saveSoon();
    requestDraw();
  }

  function fitProject() {
    fitBounds(app.boundsOfProject());
  }

  function zoomAt(px, py, factor) {
    const before = screenToWorld(px, py);
    view.scale = clamp(view.scale * factor, view.minScale, view.maxScale);
    const after = screenToWorld(px, py);
    view.cx += before.x - after.x;
    view.cz += before.z - after.z;
    app.saveSoon();
    requestDraw();
  }

  function hitTestVertex(screenX, screenY) {
    const found = findSelected(app);
    if (!found) return null;
    const { object } = found;
    const points = object.type === 'poi' ? [] : object.type === 'line' ? object.line : object.shape;
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = worldToScreen(points[index].x, points[index].z);
      if (Math.hypot(point.x - screenX, point.y - screenY) <= 9) return { index, object, set: found.set };
    }
    return null;
  }

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    if (!length) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / length;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function testObjectHit(set, object, screenX, screenY) {
    if (object.visible === false) return false;
    if (object.type === 'poi') {
      const screen = worldToScreen(object.position.x, object.position.z);
      return screenX >= screen.x - 15 && screenX <= screen.x + 15 && screenY >= screen.y - 41 && screenY <= screen.y + 8;
    }
    const points = object.type === 'line' ? object.line : object.shape;
    if (!points?.length) return false;
    const screenPoints = points.map((point) => worldToScreen(point.x, point.z));
    if (object.type !== 'line' && pointInPolygon(screenX, screenY, screenPoints)) return true;
    const width = Math.max(6, (Number(object.lineWidth) || 3) + 4);
    for (let i = 1; i < screenPoints.length; i += 1) {
      if (distanceToSegment(screenX, screenY, screenPoints[i - 1].x, screenPoints[i - 1].y, screenPoints[i].x, screenPoints[i].y) <= width) return true;
    }
    if (object.type !== 'line' && distanceToSegment(screenX, screenY, screenPoints[screenPoints.length - 1].x, screenPoints[screenPoints.length - 1].y, screenPoints[0].x, screenPoints[0].y) <= width) return true;
    return false;
  }

  function hitTestObject(screenX, screenY) {
    const sets = app.project.sets.slice().reverse();
    for (const set of sets) {
      if (set.visible === false) continue;
      for (let objectIndex = set.objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
        const object = set.objects[objectIndex];
        if (object.type === 'poi' && testObjectHit(set, object, screenX, screenY)) return { set, object };
      }
    }
    for (const set of sets) {
      if (set.visible === false) continue;
      for (let objectIndex = set.objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
        const object = set.objects[objectIndex];
        if (object.type !== 'poi' && testObjectHit(set, object, screenX, screenY)) return { set, object };
      }
    }
    return null;
  }

  function pointerPosition(event) {
    const rect = dom.mapCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function updateHover(screenX, screenY) {
    const vertex = hitTestVertex(screenX, screenY);
    editor.hoverVertex = vertex ? { index: vertex.index } : null;
    const hit = vertex ? { set: vertex.set, object: vertex.object } : hitTestObject(screenX, screenY);
    if (hit) {
      editor.hover = { setId: hit.set.id, id: hit.object.id };
      const type = TYPE_LABELS[hit.object.type];
      const center = hit.object.type === 'poi' ? hit.object.position : hit.object.type === 'line' ? hit.object.line[0] : hit.object.shape[0];
      dom.mapTooltip.hidden = false;
      dom.mapTooltip.innerHTML = `${escapeHtml(hit.object.label || type)}<small>${type} · ${fmt(center.x, 0)}, ${fmt(center.z, 0)}</small>`;
      dom.mapTooltip.style.left = `${screenX}px`;
      dom.mapTooltip.style.top = `${screenY}px`;
    } else {
      editor.hover = null;
      dom.mapTooltip.hidden = true;
    }
  }

  function objectDeltaFromPointer(startObject, startWorld, currentWorld) {
    const dx = currentWorld.x - startWorld.x;
    const dz = currentWorld.z - startWorld.z;
    if (startObject.type === 'poi') {
      startObject.position.x = roundCoord(startObject.position.x + dx);
      startObject.position.z = roundCoord(startObject.position.z + dz);
      return;
    }
    const list = startObject.type === 'line' ? startObject.line : startObject.shape;
    for (const point of list) {
      point.x = roundCoord(point.x + dx);
      point.z = roundCoord(point.z + dz);
    }
  }

  function startPan(screenX, screenY) {
    pointer.mode = 'pan';
    pointer.panView = { cx: view.cx, cz: view.cz, scale: view.scale, x: screenX, y: screenY };
    dom.mapWrap.classList.add('panning');
  }

  function onPointerDown(event) {
    if (![0, 1, 2].includes(event.button)) return;
    const screen = pointerPosition(event);
    const world = screenToWorld(screen.x, screen.y);
    pointer.down = true;
    pointer.button = event.button;
    pointer.startX = screen.x;
    pointer.startY = screen.y;
    pointer.lastX = screen.x;
    pointer.lastY = screen.y;
    pointer.moved = false;
    pointer.mode = null;
    pointer.drag = null;

    if (event.button === 1 || event.button === 2 || pointer.space || editor.tool === 'pan') {
      event.preventDefault();
      startPan(screen.x, screen.y);
      dom.mapCanvas.setPointerCapture?.(event.pointerId);
      return;
    }

    if (editor.tool === 'select') {
      const vertex = hitTestVertex(screen.x, screen.y);
      if (vertex) {
        pointer.mode = 'drag-vertex';
        pointer.drag = { object: vertex.object, set: vertex.set, index: vertex.index, start: deepClone(vertex.object), startWorld: world };
        app.beginGroup();
        app.selectObject(vertex.set, vertex.object);
        dom.mapCanvas.setPointerCapture?.(event.pointerId);
        return;
      }
      const hit = hitTestObject(screen.x, screen.y);
      if (hit) {
        pointer.mode = 'drag-object';
        pointer.drag = { object: hit.object, set: hit.set, start: deepClone(hit.object), startWorld: world };
        app.beginGroup();
        app.selectObject(hit.set, hit.object);
        dom.mapCanvas.setPointerCapture?.(event.pointerId);
        return;
      }
      pointer.mode = 'maybe-pan';
      dom.mapCanvas.setPointerCapture?.(event.pointerId);
      return;
    }

    pointer.mode = 'maybe-pan';
    dom.mapCanvas.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    const screen = pointerPosition(event);
    const world = screenToWorld(screen.x, screen.y);
    editor.lastPointer = screen;

    if (pointer.down && pointer.mode === 'maybe-pan') {
      if (Math.hypot(screen.x - pointer.startX, screen.y - pointer.startY) > 4) {
        pointer.mode = 'pan';
        pointer.moved = true;
        startPan(pointer.startX, pointer.startY);
      }
    }

    if (pointer.mode === 'pan' && pointer.down) {
      const start = pointer.panView;
      view.cx = start.cx - (screen.x - start.x) / view.scale;
      view.cz = start.cz - (screen.y - start.y) / view.scale;
      app.saveSoon();
      requestDraw();
    } else if ((pointer.mode === 'drag-object' || pointer.mode === 'drag-vertex') && pointer.down && pointer.drag) {
      pointer.moved = true;
      const drag = pointer.drag;
      const clone = deepClone(drag.start);
      if (pointer.mode === 'drag-object') {
        objectDeltaFromPointer(clone, drag.startWorld, world);
        Object.assign(drag.object, clone);
      } else {
        const listName = clone.type === 'line' ? 'line' : 'shape';
        const list = clone[listName];
        const point = list[drag.index];
        point.x = roundCoord(point.x + (world.x - drag.startWorld.x));
        point.z = roundCoord(point.z + (world.z - drag.startWorld.z));
        Object.assign(drag.object, clone);
      }
      requestDraw();
      app.renderLayers();
    } else {
      updateHover(screen.x, screen.y);
    }

    if (editor.draft) editor.draft.cursor = { x: roundCoord(world.x), z: roundCoord(world.z) };
    if (editor.tool === 'ruler' || editor.draft) requestDraw();
  }

  function onPointerUp(event) {
    if (!pointer.down) return;
    const screen = pointerPosition(event);
    const world = screenToWorld(screen.x, screen.y);
    const mode = pointer.mode;
    const moved = pointer.moved;
    pointer.down = false;
    dom.mapWrap.classList.remove('panning');

    if (mode === 'pan') {
      pointer.mode = null;
    } else if (mode === 'drag-object' || mode === 'drag-vertex') {
      app.endGroup();
      app.renderInspector();
      app.renderLayers();
      app.saveSoon();
      pointer.mode = null;
    } else if (mode === 'maybe-pan') {
      pointer.mode = null;
      if (!moved && event.button === 0) {
        if (editor.tool === 'select') app.clearSelection();
        else app.handleCanvasClick(world, screen.x, screen.y);
      }
    } else {
      pointer.mode = null;
    }
    pointer.drag = null;
    pointer.panView = null;
    updateHover(screen.x, screen.y);
    app.updateDraftHud();
    requestDraw();
  }

  function onWheel(event) {
    event.preventDefault();
    const screen = pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 0.0014);
    zoomAt(screen.x, screen.y, factor);
  }

  function onPointerLeave() {
    editor.lastPointer = null;
    dom.mapTooltip.hidden = true;
  }

  dom.mapCanvas.addEventListener('pointerdown', onPointerDown);
  dom.mapCanvas.addEventListener('pointermove', onPointerMove);
  dom.mapCanvas.addEventListener('pointerup', onPointerUp);
  dom.mapCanvas.addEventListener('pointercancel', onPointerUp);
  dom.mapCanvas.addEventListener('pointerleave', onPointerLeave);
  dom.mapCanvas.addEventListener('wheel', onWheel, { passive: false });
  dom.mapCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      pointer.space = true;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') pointer.space = false;
  });
  window.addEventListener('blur', () => {
    pointer.space = false;
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(dom.mapWrap);
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    requestDraw,
    resize,
    worldToScreen,
    screenToWorld,
    centerOn,
    fitBounds,
    fitProject,
    zoomAt,
    draw
  };
}
