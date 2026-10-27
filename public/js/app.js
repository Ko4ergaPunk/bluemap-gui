import {
  boundsOfProject,
  confFileName,
  createEmptyProject,
  defaultMapSettings,
  importText,
  makeObject,
  makeSet,
  markersFileName,
  normalizeProject,
  projectFileName,
  projectStats,
  projectToConf,
  projectToJson,
  projectToMarkersJson,
  TYPE_LABELS
} from './config.js';
import { renderInspector as inspectorHtml, renderLayers as layersHtml } from './inspector.js';
import { initCanvas } from './canvas.js';
import { TileManager, createView } from './mapview.js';
import {
  $,
  $$,
  apiUrl,
  clamp,
  copyText,
  deepClone,
  downloadText,
  fmtDistance,
  joinUrl,
  normalizeBaseUrl,
  num,
  parseAnchor,
  plural,
  polylineLength,
  readFileText,
  resolveUrl,
  rgbToHex,
  slugify,
  uniqueId,
  vector2
} from './util.js';

const STORAGE_KEY = 'bluemap-config-studio-v1';
const DEFAULT_SOURCE = 'https://map.arzmine.ru';

const dom = {
  sourceUrl: $('#sourceUrl'),
  btnConnect: $('#btnConnect'),
  sourceStatus: $('#sourceStatus'),
  mapSelect: $('#mapSelect'),
  btnUndo: $('#btnUndo'),
  btnRedo: $('#btnRedo'),
  btnSave: $('#btnSave'),
  btnLoad: $('#btnLoad'),
  saveMenu: $('#saveMenu'),
  loadMenu: $('#loadMenu'),
  btnHelp: $('#btnHelp'),
  helpModal: $('#helpModal'),
  btnCloseHelp: $('#btnCloseHelp'),
  layersList: $('#layersList'),
  btnAddSet: $('#btnAddSet'),
  btnImportLive: $('#btnImportLive'),
  projectStats: $('#projectStats'),
  mapWrap: $('#mapWrap'),
  mapCanvas: $('#mapCanvas'),
  scaleBar: $('#scaleBar'),
  coords: $('#coords'),
  zoomInfo: $('#zoomInfo'),
  tileStatus: $('#tileStatus'),
  toolHint: $('#toolHint'),
  mapTooltip: $('#mapTooltip'),
  emptyMap: $('#emptyMap'),
  btnEmptyConnect: $('#btnEmptyConnect'),
  toolDock: $('#toolDock'),
  btnFit: $('#btnFit'),
  draftHud: $('#draftHud'),
  inspectorContent: $('#inspectorContent'),
  tabObject: $('#tabObject'),
  tabMap: $('#tabMap'),
  btnCenterSelected: $('#btnCenterSelected'),
  fileInput: $('#fileInput'),
  toasts: $('#toasts')
};

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.project) return { ...data, project: normalizeProject(data.project) };
    if (data?.format) return { project: normalizeProject(data), view: null, ui: null };
    return null;
  } catch {
    return null;
  }
}

const stored = loadStored();
let project = stored?.project || createEmptyProject(DEFAULT_SOURCE);
let view = createView();
if (stored?.view) {
  view.cx = num(stored.view.cx, view.cx);
  view.cz = num(stored.view.cz, view.cz);
  view.scale = clamp(num(stored.view.scale, view.scale), view.minScale, view.maxScale);
}

const editor = {
  tool: 'select',
  selected: null,
  activeSetId: project.sets[0]?.id || null,
  hover: null,
  hoverVertex: null,
  selectedVertex: null,
  draft: null,
  tab: 'object',
  snap: stored?.ui?.snap !== false,
  showGrid: stored?.ui?.showGrid !== false,
  showLabels: stored?.ui?.showLabels !== false,
  showPlayers: Boolean(stored?.ui?.showPlayers),
  newY: num(stored?.ui?.newY, 64),
  newColor: stored?.ui?.newColor || '#38bdf8',
  players: [],
  playerTimer: null,
  lastPointer: null
};

const source = {
  base: '',
  connected: false,
  loading: false,
  error: '',
  proxyAvailable: false,
  proxyChecked: false,
  settings: null,
  maps: [],
  mapId: project.source?.mapId || project.map?.id || 'world',
  mapSettings: null,
  mapRoot: '',
  liveRoot: '',
  mapDataRoot: '',
  liveDataRoot: '',
  firstConnect: !stored?.view
};

const history = {
  past: [],
  future: [],
  groupBefore: null
};

const tileManager = new TileManager(() => app.canvas?.requestDraw());

const app = {
  dom,
  view,
  editor,
  source,
  history,
  tileManager,
  get project() {
    return project;
  },
  set project(value) {
    project = value;
  },
  canvas: null
};

let saveTimer = null;
let drawQueued = false;

function serializedProject() {
  return JSON.stringify(project);
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveToStorage(), 450);
}

function saveToStorage({ silent = true } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      project,
      view: { cx: view.cx, cz: view.cz, scale: view.scale },
      ui: {
        snap: editor.snap,
        showGrid: editor.showGrid,
        showLabels: editor.showLabels,
        showPlayers: editor.showPlayers,
        newY: editor.newY,
        newColor: editor.newColor
      },
      savedAt: new Date().toISOString()
    }));
    return true;
  } catch {
    if (!silent) toast('Не удалось сохранить в браузере', 'err');
    return false;
  }
}

function toast(message, kind = 'info', timeout = 3800) {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  dom.toasts.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

function beginGroup() {
  if (history.groupBefore == null) history.groupBefore = serializedProject();
}

function endGroup() {
  if (history.groupBefore == null) return;
  const before = history.groupBefore;
  history.groupBefore = null;
  if (before !== serializedProject()) {
    history.past.push(before);
    if (history.past.length > 120) history.past.shift();
    history.future = [];
    updateHistoryButtons();
  }
}

function pushHistory(before) {
  if (before == null || before === serializedProject()) return;
  history.past.push(before);
  if (history.past.length > 120) history.past.shift();
  history.future = [];
  updateHistoryButtons();
}

function mutate(fn, options = {}) {
  const before = serializedProject();
  fn();
  pushHistory(before);
  afterChange(options);
}

function afterChange({ layers = true, inspector = false, stats = true } = {}) {
  updateSelectionValidity();
  if (layers) renderLayers();
  if (inspector) renderInspector();
  if (stats) renderStats();
  saveSoon();
  requestDraw();
}

function updateSelectionValidity() {
  if (!editor.selected) return;
  if (editor.selected.kind === 'set') {
    if (!project.sets.some((set) => set.id === editor.selected.id)) editor.selected = null;
  } else {
    const set = project.sets.find((item) => item.id === editor.selected.setId);
    if (!set?.objects.some((item) => item.id === editor.selected.id)) editor.selected = null;
  }
  if (editor.activeSetId && !project.sets.some((set) => set.id === editor.activeSetId)) {
    editor.activeSetId = project.sets[0]?.id || null;
  }
  if (editor.selectedVertex) {
    const set = project.sets.find((item) => item.id === editor.selectedVertex.setId);
    const object = set?.objects.find((item) => item.id === editor.selectedVertex.objectId);
    const list = object && object.type !== 'poi' ? (object.type === 'line' ? object.line : object.shape) : null;
    if (!list || editor.selectedVertex.index < 0 || editor.selectedVertex.index >= list.length) {
      editor.selectedVertex = null;
    }
  }
}

function updateHistoryButtons() {
  dom.btnUndo.disabled = history.past.length === 0;
  dom.btnRedo.disabled = history.future.length === 0;
}

function undo() {
  if (!history.past.length) return;
  history.future.push(serializedProject());
  project = normalizeProject(JSON.parse(history.past.pop()));
  editor.selected = null;
  editor.selectedVertex = null;
  app.project = project;
  afterChange({ inspector: true });
  updateHistoryButtons();
  renderMapSelect();
  updateSourceUi();
  toast('Отменено', 'info', 1200);
}

function redo() {
  if (!history.future.length) return;
  history.past.push(serializedProject());
  project = normalizeProject(JSON.parse(history.future.pop()));
  editor.selected = null;
  editor.selectedVertex = null;
  app.project = project;
  afterChange({ inspector: true });
  updateHistoryButtons();
  renderMapSelect();
  updateSourceUi();
  toast('Повторено', 'info', 1200);
}

function activeSet() {
  let set = project.sets.find((item) => item.id === editor.activeSetId);
  if (set) return set;
  set = project.sets[0];
  if (set) {
    editor.activeSetId = set.id;
    return set;
  }
  set = makeSet({ id: uniqueId('set-1', []), label: 'Маркеры' });
  project.sets.push(set);
  editor.activeSetId = set.id;
  return set;
}

function findSelected() {
  if (editor.selected?.kind !== 'object') return null;
  const set = project.sets.find((item) => item.id === editor.selected.setId);
  const object = set?.objects.find((item) => item.id === editor.selected.id);
  return set && object ? { set, object } : null;
}

function selectedSet() {
  if (editor.selected?.kind !== 'set') return null;
  return project.sets.find((set) => set.id === editor.selected.id) || null;
}

function selectObject(set, object) {
  if (editor.selectedVertex && (editor.selectedVertex.setId !== set.id || editor.selectedVertex.objectId !== object.id)) {
    editor.selectedVertex = null;
  }
  editor.selected = { kind: 'object', setId: set.id, id: object.id };
  editor.activeSetId = set.id;
  renderLayers();
  renderInspector({ resetScroll: true });
  requestDraw();
}

function selectSet(set) {
  editor.selectedVertex = null;
  editor.selected = { kind: 'set', id: set.id };
  editor.activeSetId = set.id;
  renderLayers();
  renderInspector({ resetScroll: true });
  requestDraw();
}

function clearSelection() {
  editor.selected = null;
  editor.selectedVertex = null;
  renderLayers();
  renderInspector({ resetScroll: true });
  requestDraw();
}

function setSourceStatus(text, kind = '') {
  dom.sourceStatus.textContent = text;
  dom.sourceStatus.className = `source-status ${kind}`;
}

function updateSourceUi() {
  if (source.loading) setSourceStatus('подключение…', 'wait');
  else if (source.error) setSourceStatus(source.error, 'warn');
  else if (source.connected) {
    const count = source.maps.length;
    const word = count === 1 ? 'карта' : count < 5 ? 'карты' : 'карт';
    setSourceStatus(`${count} ${word} · подключено`, 'ok');
  }
  else if (source.mapRoot) setSourceStatus('карта без settings.json', 'err');
  else setSourceStatus('не подключено');
  dom.emptyMap.hidden = Boolean(source.mapRoot);
}

function renderMapSelect() {
  const maps = source.maps || [];
  dom.mapSelect.innerHTML = '';
  if (!maps.length) {
    const option = document.createElement('option');
    option.textContent = 'нет карт';
    dom.mapSelect.appendChild(option);
    dom.mapSelect.disabled = true;
    return;
  }
  for (const map of maps) {
    const option = document.createElement('option');
    option.value = map.id;
    option.textContent = map.name || map.id;
    dom.mapSelect.appendChild(option);
  }
  dom.mapSelect.value = source.mapId;
  dom.mapSelect.disabled = false;
}

function renderLayers() {
  dom.layersList.innerHTML = layersHtml(project, editor);
}

function renderInspector({ resetScroll = false } = {}) {
  const scroll = dom.inspectorContent.scrollTop;
  dom.tabObject.classList.toggle('active', editor.tab === 'object');
  dom.tabMap.classList.toggle('active', editor.tab === 'map');
  dom.inspectorContent.innerHTML = inspectorHtml({ project, editor, source, tileManager });
  dom.btnCenterSelected.hidden = editor.tab === 'map';
  dom.inspectorContent.scrollTop = resetScroll ? 0 : scroll;
}

function renderStats() {
  const stats = projectStats(project);
  dom.projectStats.textContent = `${stats.sets} ${plural(stats.sets, 'набор', 'набора', 'наборов')} · ${stats.objects} ${plural(stats.objects, 'объект', 'объекта', 'объектов')} · ${stats.points} ${plural(stats.points, 'точка', 'точки', 'точек')}`;
  updateHistoryButtons();
}

function updateToolUi() {
  $$('.tool-btn[data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === editor.tool);
  });
  dom.mapWrap.classList.remove('tool-select', 'tool-pan', 'tool-marker', 'tool-line', 'tool-shape', 'tool-extrude', 'tool-ruler');
  dom.mapWrap.classList.add(`tool-${editor.tool}`);
  const hints = {
    select: 'ЛКМ — выбрать · перетаскивание — переместить · Delete — удалить точку/объект · ПКМ/пробел — панорама · колесо — масштаб',
    marker: 'Клик — поставить маркер · Esc — выбрать · высота Y задаётся в инспекторе',
    line: 'Клик — точки · клик по линии/области — вставить точку · двойной клик или Enter — готово · Esc — отмена',
    shape: 'Клик — вершины · закройте на первой точке или Enter · Esc — отмена',
    extrude: 'Клик — вершины объёма · Enter или двойной клик — готово · Esc — отмена',
    ruler: 'Клик — измерить отрезки · Enter — оставить · Esc — очистить · Backspace — убрать точку',
    pan: 'Перетаскивание — панорама · колесо — масштаб'
  };
  dom.toolHint.textContent = hints[editor.tool] || hints.select;
}

function updateDraftHud() {
  if (editor.tool === 'ruler' && project.ruler.points.length) {
    dom.draftHud.hidden = false;
    dom.draftHud.classList.add('accent');
    dom.draftHud.textContent = `Линейка: ${project.ruler.points.length} т. · ${fmtDistance(polylineLength(project.ruler.points, false))} · Enter — оставить, Esc — очистить`;
    return;
  }
  if (editor.draft) {
    dom.draftHud.hidden = false;
    dom.draftHud.classList.add('accent');
    dom.draftHud.textContent = `${editor.draft.points.length} точек · двойной клик / Enter — готово · Esc — отмена`;
    return;
  }
  dom.draftHud.hidden = true;
}

function setTool(tool) {
  if (!['select', 'marker', 'line', 'shape', 'extrude', 'ruler', 'pan'].includes(tool)) return;
  if (editor.draft) cancelDraft();
  editor.tool = tool;
  editor.hover = null;
  editor.hoverVertex = null;
  editor.selectedVertex = null;
  updateToolUi();
  updateDraftHud();
  requestDraw();
}

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    app.canvas?.requestDraw();
  });
}

function roundCoord(value) {
  return editor.snap ? Math.round(value) : Math.round(value * 100) / 100;
}

function createMarkerAt(world) {
  const set = activeSet();
  const object = makeObject('poi', {
    id: uniqueId(slugify(`marker-${set.objects.length + 1}`, 'marker'), set.objects.map((item) => item.id)),
    label: `Маркер ${set.objects.length + 1}`,
    position: { x: roundCoord(world.x), y: editor.newY, z: roundCoord(world.z) },
    color: editor.newColor
  });
  const before = serializedProject();
  set.objects.push(object);
  pushHistory(before);
  selectObject(set, object);
  afterChange({ inspector: true });
  toast('Маркер добавлен', 'ok', 1400);
}

function addDraftPoint(world) {
  const point = { x: roundCoord(world.x), z: roundCoord(world.z) };
  if (!editor.draft) {
    editor.draft = { tool: editor.tool, points: [point], cursor: { ...point } };
    updateDraftHud();
    requestDraw();
    return;
  }
  const last = editor.draft.points[editor.draft.points.length - 1];
  if (last && Math.hypot(last.x - point.x, last.z - point.z) < 0.01) return;
  if ((editor.draft.tool === 'shape' || editor.draft.tool === 'extrude') && editor.draft.points.length >= 3) {
    const first = editor.draft.points[0];
    const firstScreen = app.canvas?.worldToScreen(first.x, first.z);
    const pointScreen = app.canvas?.worldToScreen(point.x, point.z);
    if (firstScreen && pointScreen && Math.hypot(firstScreen.x - pointScreen.x, firstScreen.y - pointScreen.y) < 12) {
      finishDraft();
      return;
    }
  }
  editor.draft.points.push(point);
  updateDraftHud();
  requestDraw();
}

function insertPointIntoObject({ set, object, index, point }) {
  const list = object.type === 'line' ? object.line : object.shape;
  if (!list || index < 0 || index > list.length) return;
  const before = serializedProject();
  list.splice(index, 0, point);
  pushHistory(before);
  selectObject(set, object);
  editor.selectedVertex = { setId: set.id, objectId: object.id, index };
  afterChange({ inspector: true });
  toast('Точка добавлена', 'ok', 1200);
}

function finishDraft() {
  const draft = editor.draft;
  if (!draft) return;
  if (draft.points.length < 2 || ((draft.tool === 'shape' || draft.tool === 'extrude') && draft.points.length < 3)) {
    cancelDraft(true);
    return;
  }
  const set = activeSet();
  let object;
  if (draft.tool === 'line') {
    object = makeObject('line', {
      id: uniqueId(slugify(`line-${set.objects.length + 1}`, 'line'), set.objects.map((item) => item.id)),
      label: `Линия ${set.objects.length + 1}`,
      line: draft.points.map((point) => ({ x: point.x, y: editor.newY, z: point.z }))
    });
  } else if (draft.tool === 'extrude') {
    object = makeObject('extrude', {
      id: uniqueId(slugify(`extrude-${set.objects.length + 1}`, 'extrude'), set.objects.map((item) => item.id)),
      label: `Объём ${set.objects.length + 1}`,
      shape: draft.points.map((point) => ({ x: point.x, z: point.z })),
      shapeMinY: editor.newY - 10,
      shapeMaxY: editor.newY + 10
    });
  } else {
    object = makeObject('shape', {
      id: uniqueId(slugify(`area-${set.objects.length + 1}`, 'area'), set.objects.map((item) => item.id)),
      label: `Область ${set.objects.length + 1}`,
      shape: draft.points.map((point) => ({ x: point.x, z: point.z })),
      shapeY: editor.newY
    });
  }
  const before = serializedProject();
  set.objects.push(object);
  editor.draft = null;
  pushHistory(before);
  selectObject(set, object);
  afterChange({ inspector: true });
  updateDraftHud();
  toast(`Добавлено: ${object.label}`, 'ok', 1600);
}

function cancelDraft(silent = false) {
  if (!editor.draft) return;
  editor.draft = null;
  if (!silent) toast('Рисование отменено', 'info', 1300);
  updateDraftHud();
  requestDraw();
}

function handleCanvasClick(world, screenX, screenY) {
  if (editor.tool === 'marker') {
    createMarkerAt(world);
    return;
  }
  if (editor.tool === 'line') {
    if (!editor.draft) {
      const insertion = app.canvas?.findInsertionAt(screenX, screenY);
      if (insertion) {
        insertPointIntoObject(insertion);
        return;
      }
    }
    addDraftPoint(world);
    return;
  }
  if (editor.tool === 'shape' || editor.tool === 'extrude') {
    addDraftPoint(world);
    return;
  }
  if (editor.tool === 'ruler') {
    const point = { x: roundCoord(world.x), z: roundCoord(world.z) };
    const points = project.ruler.points;
    const last = points[points.length - 1];
    if (last && Math.hypot(last.x - point.x, last.z - point.z) < 0.01) return;
    points.push(point);
    updateDraftHud();
    requestDraw();
    saveSoon();
  }
}

function normalizeDraftAfterDoubleClick() {
  const draft = editor.draft;
  if (!draft) return;
  if (draft.points.length >= 2) {
    const last = draft.points[draft.points.length - 1];
    const prev = draft.points[draft.points.length - 2];
    if (Math.hypot(last.x - prev.x, last.z - prev.z) < 0.2) draft.points.pop();
  }
  if (draft.points.length >= 2) finishDraft();
  else cancelDraft(true);
}

function moveSelected(dx, dz) {
  const found = findSelected();
  if (!found) return;
  const before = serializedProject();
  const object = found.object;
  if (object.type === 'poi') {
    object.position.x += dx;
    object.position.z += dz;
  } else {
    const list = object.type === 'line' ? object.line : object.shape;
    for (const point of list) {
      point.x += dx;
      point.z += dz;
    }
  }
  pushHistory(before);
  afterChange({ inspector: true });
}

function deleteSelectedObject() {
  const found = findSelected();
  if (!found) return;
  const before = serializedProject();
  found.set.objects = found.set.objects.filter((item) => item.id !== found.object.id);
  editor.selected = null;
  editor.selectedVertex = null;
  pushHistory(before);
  afterChange({ inspector: true });
  toast(`Удалено: ${found.object.label}`, 'info', 1600);
}

function duplicateSelectedObject() {
  const found = findSelected();
  if (!found) return;
  const clone = deepClone(found.object);
  clone.id = uniqueId(slugify(`${clone.type}-${found.set.objects.length + 1}`, clone.type), found.set.objects.map((item) => item.id));
  clone.label = `${clone.label} копия`;
  if (clone.type === 'poi') {
    clone.position.x += 5;
    clone.position.z += 5;
  } else {
    const list = clone.type === 'line' ? clone.line : clone.shape;
    for (const point of list) {
      point.x += 5;
      point.z += 5;
    }
  }
  const before = serializedProject();
  found.set.objects.push(clone);
  pushHistory(before);
  selectObject(found.set, clone);
  afterChange({ inspector: true });
}

function addPointToList(listName) {
  const found = findSelected();
  if (!found) return;
  const object = found.object;
  const before = serializedProject();
  if (listName === 'line') {
    const last = object.line[object.line.length - 1] || { x: 0, y: editor.newY, z: 0 };
    object.line.push({ x: roundCoord(last.x + 10), y: num(last.y, editor.newY), z: roundCoord(last.z) });
  } else {
    const last = object.shape[object.shape.length - 1] || { x: 0, z: 0 };
    object.shape.push({ x: roundCoord(last.x + 10), z: roundCoord(last.z) });
  }
  pushHistory(before);
  afterChange({ inspector: true });
}

function removePoint(listName, index) {
  const found = findSelected();
  if (!found) return;
  const object = found.object;
  const list = listName === 'line' ? object.line : object.shape;
  if (list.length <= (listName === 'line' ? 2 : 3)) {
    toast('Нельзя удалить последнюю точку', 'warn');
    return;
  }
  const before = serializedProject();
  list.splice(index, 1);
  if (editor.selectedVertex && editor.selectedVertex.objectId === object.id && editor.selectedVertex.setId === found.set.id) {
    if (editor.selectedVertex.index === index) editor.selectedVertex = null;
    else if (editor.selectedVertex.index > index) editor.selectedVertex.index -= 1;
  }
  pushHistory(before);
  afterChange({ inspector: true });
}

function deleteSelectedVertex() {
  const vertex = editor.selectedVertex;
  if (!vertex) return false;
  const set = project.sets.find((item) => item.id === vertex.setId);
  const object = set?.objects.find((item) => item.id === vertex.objectId);
  if (!set || !object || object.type === 'poi') {
    editor.selectedVertex = null;
    requestDraw();
    return true;
  }
  const listName = object.type === 'line' ? 'line' : 'shape';
  const list = object[listName];
  const minimum = listName === 'line' ? 2 : 3;
  if (!list || vertex.index < 0 || vertex.index >= list.length) {
    editor.selectedVertex = null;
    requestDraw();
    return true;
  }
  if (list.length <= minimum) {
    toast('Нельзя удалить последнюю точку', 'warn');
    return true;
  }
  const before = serializedProject();
  list.splice(vertex.index, 1);
  editor.selectedVertex = null;
  pushHistory(before);
  afterChange({ inspector: true });
  toast('Точка удалена', 'info', 1200);
  return true;
}

function addSet() {
  const before = serializedProject();
  const id = uniqueId(`set-${project.sets.length + 1}`, project.sets.map((item) => item.id));
  const set = makeSet({ id, label: `Набор ${project.sets.length + 1}` });
  project.sets.push(set);
  pushHistory(before);
  selectSet(set);
  afterChange({ inspector: true });
}

function deleteSet(set) {
  if (!set) return;
  if (!confirm(`Удалить набор «${set.label}» и все объекты в нём?`)) return;
  const before = serializedProject();
  project.sets = project.sets.filter((item) => item.id !== set.id);
  if (editor.selected?.kind === 'set' && editor.selected.id === set.id) editor.selected = null;
  if (editor.selected?.kind === 'object' && editor.selected.setId === set.id) editor.selected = null;
  if (editor.activeSetId === set.id) editor.activeSetId = project.sets[0]?.id || null;
  pushHistory(before);
  afterChange({ inspector: true });
}

function addObjectToSet(type) {
  const found = selectedSet() || activeSet();
  const center = app.canvas?.screenToWorld(view.width / 2, view.height / 2) || { x: 0, z: 0 };
  const base = {
    id: uniqueId(slugify(`${type}-${found.objects.length + 1}`, type), found.objects.map((item) => item.id)),
    label: `${TYPE_LABELS[type]} ${found.objects.length + 1}`
  };
  let object;
  if (type === 'poi') {
    object = makeObject('poi', { ...base, position: { x: roundCoord(center.x), y: editor.newY, z: roundCoord(center.z) }, color: editor.newColor });
  } else if (type === 'line') {
    object = makeObject('line', {
      ...base,
      line: [
        { x: roundCoord(center.x - 15), y: editor.newY, z: roundCoord(center.z) },
        { x: roundCoord(center.x + 15), y: editor.newY, z: roundCoord(center.z) }
      ]
    });
  } else if (type === 'shape') {
    object = makeObject('shape', {
      ...base,
      shape: [
        { x: roundCoord(center.x - 12), z: roundCoord(center.z - 12) },
        { x: roundCoord(center.x + 12), z: roundCoord(center.z - 12) },
        { x: roundCoord(center.x + 12), z: roundCoord(center.z + 12) },
        { x: roundCoord(center.x - 12), z: roundCoord(center.z + 12) }
      ],
      shapeY: editor.newY
    });
  } else {
    object = makeObject('extrude', {
      ...base,
      shape: [
        { x: roundCoord(center.x - 12), z: roundCoord(center.z - 12) },
        { x: roundCoord(center.x + 12), z: roundCoord(center.z - 12) },
        { x: roundCoord(center.x + 12), z: roundCoord(center.z + 12) },
        { x: roundCoord(center.x - 12), z: roundCoord(center.z + 12) }
      ],
      shapeMinY: editor.newY - 10,
      shapeMaxY: editor.newY + 10
    });
  }
  const before = serializedProject();
  found.objects.push(object);
  pushHistory(before);
  selectObject(found, object);
  afterChange({ inspector: true });
}

function setNested(target, path, value) {
  const keys = path.split('.');
  let current = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function fieldValue(target) {
  if (target.type === 'checkbox') return target.checked;
  if (target.type === 'number' || target.type === 'range') return Number(target.value);
  return target.value;
}

function applyInspectorField(target) {
  const scope = target.dataset.scope;
  const field = target.dataset.field;
  if (!scope || !field) return;
  const value = fieldValue(target);
  if ((target.type === 'number' || target.type === 'range') && !Number.isFinite(value)) return;

  if (scope === 'defaults') {
    if (field === 'y') editor.newY = value;
    if (field === 'color') editor.newColor = value;
    saveSoon();
    return;
  }

  if (scope === 'editor') {
    if (field === 'showGrid') editor.showGrid = Boolean(value);
    if (field === 'showLabels') editor.showLabels = Boolean(value);
    if (field === 'showPlayers') {
      editor.showPlayers = Boolean(value);
      if (editor.showPlayers) loadPlayers();
      else {
        clearInterval(editor.playerTimer);
        editor.playerTimer = null;
        editor.players = [];
      }
    }
    if (field === 'snap') editor.snap = Boolean(value);
    saveSoon();
    requestDraw();
    return;
  }

  if (scope === 'source') {
    if (field === 'url') project.source.url = value;
    if (field === 'mapId') selectMap(value);
    saveSoon();
    return;
  }

  if (scope === 'map') {
    if (field === 'startPos.x') setNested(project.map.startPos, 'x', value);
    else setNested(project.map, field, value);
    saveSoon();
    renderStats();
    requestDraw();
    return;
  }

  if (scope === 'set') {
    const set = selectedSet();
    if (!set) return;
    set[field] = value;
    renderLayers();
    saveSoon();
    requestDraw();
    return;
  }

  const found = findSelected();
  if (!found) return;
  const object = found.object;

  if (field === '__setId') {
    const targetSet = project.sets.find((set) => set.id === value);
    if (targetSet && targetSet.id !== found.set.id) {
      found.set.objects = found.set.objects.filter((item) => item.id !== object.id);
      object.id = uniqueId(object.id, targetSet.objects.map((item) => item.id));
      targetSet.objects.push(object);
      editor.selected = { kind: 'object', setId: targetSet.id, id: object.id };
      editor.activeSetId = targetSet.id;
      afterChange({ inspector: true });
    }
    return;
  }

  if (field === 'classes') {
    object.classes = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  } else if (field === 'position.x' || field === 'position.y' || field === 'position.z') {
    setNested(object.position, field.split('.')[1], value);
  } else if (field === 'anchor.x' || field === 'anchor.y') {
    setNested(object.anchor, field.split('.')[1], value);
  } else {
    setNested(object, field, value);
  }

  if (field === 'label') renderLayers();
  saveSoon();
  requestDraw();
}

function applyPointField(target) {
  const found = findSelected();
  if (!found) return;
  const listName = target.dataset.list;
  const index = Number(target.dataset.index);
  const axis = target.dataset.axis;
  const value = Number(target.value);
  if (!Number.isFinite(value)) return;
  const list = listName === 'line' ? found.object.line : found.object.shape;
  if (!list?.[index]) return;
  list[index][axis] = value;
  requestDraw();
  saveSoon();
}

function onInspectorInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  if (target.dataset.scope === 'point') applyPointField(target);
  else applyInspectorField(target);
}

function onInspectorChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  if (target.dataset.scope === 'point') {
    applyPointField(target);
    return;
  }
  const before = serializedProject();
  applyInspectorField(target);
  if (before !== serializedProject()) pushHistory(before);
  if (target.dataset.field === '__setId' || target.type === 'checkbox' || target.tagName === 'SELECT' || target.type === 'color') {
    renderInspector();
    renderLayers();
  }
}

function onInspectorClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'delete-object') deleteSelectedObject();
  else if (action === 'duplicate-object') duplicateSelectedObject();
  else if (action === 'center-object') centerSelected();
  else if (action === 'delete-set') deleteSet(selectedSet());
  else if (action === 'add-point') addPointToList(button.dataset.list);
  else if (action === 'remove-point') removePoint(button.dataset.list, Number(button.dataset.index));
  else if (action === 'add-marker-to-set') addObjectToSet('poi');
  else if (action === 'add-line-to-set') addObjectToSet('line');
  else if (action === 'add-shape-to-set') addObjectToSet('shape');
  else if (action === 'add-extrude-to-set') addObjectToSet('extrude');
  else if (action === 'reconnect') connectSource(project.source.url || dom.sourceUrl.value, { silent: false });
  else if (action === 'import-live') importLiveMarkers();
  else if (action === 'start-at-view') {
    const before = serializedProject();
    project.map.startPos = { x: Math.round(view.cx), z: Math.round(view.cz) };
    pushHistory(before);
    afterChange({ inspector: true });
  } else if (action === 'download-conf') downloadConf();
  else if (action === 'download-markers') downloadMarkers();
  else if (action === 'download-project') downloadProject();
}

function centerSelected() {
  const found = findSelected();
  if (!found) {
    app.canvas?.fitProject();
    return;
  }
  const object = found.object;
  const points = object.type === 'poi' ? [object.position] : object.type === 'line' ? object.line : object.shape;
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = object.type === 'poi' ? 1.3 : clamp(Math.min(view.width / Math.max(60, maxX - minX), view.height / Math.max(60, maxZ - minZ)) / 3, 0.2, 2.5);
  app.canvas?.centerOn((minX + maxX) / 2, (minZ + maxZ) / 2, scale);
}

function downloadConf() {
  downloadText(confFileName(project), projectToConf(project), 'text/plain;charset=utf-8');
  toast(`Скачан ${confFileName(project)}`, 'ok');
}

function downloadMarkers() {
  downloadText(markersFileName(project), projectToMarkersJson(project), 'application/json;charset=utf-8');
  toast(`Скачан ${markersFileName(project)}`, 'ok');
}

function downloadProject() {
  downloadText(projectFileName(project), projectToJson(project), 'application/json;charset=utf-8');
  toast(`Скачан ${projectFileName(project)}`, 'ok');
}

function replaceProject(next, options = {}) {
  const before = serializedProject();
  project = normalizeProject(next);
  app.project = project;
  editor.selected = null;
  editor.activeSetId = project.sets[0]?.id || null;
  editor.tab = 'object';
  project.source.url = project.source.url || source.base || DEFAULT_SOURCE;
  dom.sourceUrl.value = project.source.url;
  source.mapId = project.source.mapId || project.map.id;
  source.firstConnect = false;
  pushHistory(before);
  afterChange({ inspector: true });
  renderMapSelect();
  updateSourceUi();
  if (options.center) app.canvas?.centerOn(project.map.startPos.x, project.map.startPos.z, view.scale);
}

async function checkProxy(force = false) {
  if (source.proxyChecked && !force) return source.proxyAvailable;
  source.proxyChecked = true;
  if (!location.protocol.startsWith('http')) {
    source.proxyAvailable = false;
    return false;
  }
  try {
    const response = await fetch(apiUrl('api/health'), { cache: 'no-store' });
    source.proxyAvailable = response.ok;
  } catch {
    source.proxyAvailable = false;
  }
  return source.proxyAvailable;
}

async function fetchJson(url) {
  const attempts = [];
  if (source.proxyAvailable) attempts.push(`${apiUrl('api/proxy')}?url=${encodeURIComponent(url)}`);
  attempts.push(url);
  let lastError = null;
  for (let round = 0; round < 2; round += 1) {
    for (const attempt of attempts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 22000);
      try {
        const response = await fetch(attempt, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        return JSON.parse(text);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (round === 0) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw lastError || new Error('network error');
}

async function connectSource(rawUrl, { silent = false } = {}) {
  const text = String(rawUrl || '').trim();
  const hashIndex = text.indexOf('#');
  const anchor = hashIndex >= 0 ? parseAnchor(text.slice(hashIndex)) : parseAnchor(location.hash);
  const base = normalizeBaseUrl(text);
  if (!base) {
    toast('Укажите корректную ссылку на BlueMap', 'err');
    return;
  }

  await checkProxy(true);
  const previousBase = source.base;
  const newSource = Boolean(previousBase) && previousBase !== base;
  source.base = base;
  source.loading = true;
  source.error = '';
  project.source.url = base;
  dom.sourceUrl.value = base;
  updateSourceUi();
  saveSoon();

  try {
    const settings = await fetchJson(`${base}/settings.json`);
    const mapDataRoot = resolveUrl(settings.mapDataRoot || 'maps', base);
    const liveDataRoot = resolveUrl(settings.liveDataRoot || settings.mapDataRoot || 'maps', base);
    source.settings = settings;
    source.mapDataRoot = mapDataRoot;
    source.liveDataRoot = liveDataRoot;
    const ids = Array.isArray(settings.maps) && settings.maps.length ? settings.maps : [source.mapId || 'world'];
    const maps = await Promise.all(ids.map(async (id) => {
      try {
        const mapSettings = await fetchJson(joinUrl(mapDataRoot, id, 'settings.json'));
        return { id, name: mapSettings.name || id, settings: mapSettings };
      } catch {
        return { id, name: id, settings: null };
      }
    }));
    source.maps = maps;
    source.connected = true;
    source.error = '';
    let chosen = anchor?.mapId || source.mapId || project.source.mapId;
    if (!maps.some((item) => item.id === chosen)) chosen = maps[0]?.id || source.mapId;
    await applyMap(chosen, { anchor, first: source.firstConnect || newSource, newSource });
    source.firstConnect = false;
    if (!silent) toast(`Карта подключена: ${maps.length} шт.`, 'ok');
  } catch (error) {
    source.connected = false;
    source.error = 'settings.json недоступен';
    source.mapDataRoot = resolveUrl('maps', base);
    source.liveDataRoot = source.mapDataRoot;
    source.maps = [{ id: source.mapId || project.source.mapId || 'world', name: source.mapId || 'world', settings: null }];
    await applyMap(source.mapId || project.source.mapId || 'world', { anchor, fallback: true });
    if (!silent) toast('settings.json не загрузился — включён резервный режим. Тайлы загружаются напрямую.', 'warn', 6500);
    else toast('Нет доступа к settings.json — карта загружается в резервном режиме.', 'warn', 5000);
  } finally {
    source.loading = false;
    updateSourceUi();
    renderMapSelect();
    saveSoon();
    requestDraw();
  }
}

async function applyMap(id, { anchor = null, first = false, fallback = false, newSource = false } = {}) {
  const entry = source.maps.find((map) => map.id === id) || source.maps[0] || { id, name: id, settings: null };
  const previousSourceId = source.mapId;
  const idWasSynced = !project.map.id || project.map.id === previousSourceId;
  const isNewMap = source.firstConnect || newSource || entry.id !== previousSourceId;
  const previousName = source.mapSettings?.name;
  const defaultName = defaultMapSettings().name;
  const nameWasSynced = !project.map.name || project.map.name === previousName || project.map.name === defaultName;
  source.mapId = entry.id;
  source.mapSettings = entry.settings;
  project.source.mapId = entry.id;
  if (idWasSynced) project.map.id = entry.id;
  source.mapRoot = joinUrl(source.mapDataRoot, entry.id);
  source.liveRoot = joinUrl(source.liveDataRoot, entry.id);

  const lowres = entry.settings?.lowres || {};
  const tileSize = Number(lowres.tileSize?.[0] ?? lowres.tileSize?.x ?? 500);
  const lodFactor = Number(lowres.lodFactor ?? 5);
  const lodCount = Number(lowres.lodCount ?? 3);
  tileManager.configure({
    mapRoot: source.mapRoot,
    tileSize,
    lodFactor,
    lodCount,
    useProxy: source.proxyAvailable
  });
  tileManager.proxyAvailable = source.proxyAvailable;

  if (entry.settings) {
    const settings = entry.settings;
    if (settings.name && nameWasSynced) project.map.name = settings.name;
    const start = settings.startPos;
    if (isNewMap && Array.isArray(start) && start.length >= 2) project.map.startPos = { x: num(start[0], 0), z: num(start[1], 0) };
    else if (isNewMap && start && typeof start === 'object') project.map.startPos = vector2(start, { x: 0, z: 0 });
    if (isNewMap) {
      if (settings.sorting != null) project.map.sorting = num(settings.sorting, project.map.sorting);
      if (Array.isArray(settings.skyColor) && settings.skyColor.length >= 3) {
        project.map.skyColor = rgbToHex(settings.skyColor[0] * 255, settings.skyColor[1] * 255, settings.skyColor[2] * 255);
      }
      if (Array.isArray(settings.voidColor) && settings.voidColor.length >= 3) {
        project.map.voidColor = rgbToHex(settings.voidColor[0] * 255, settings.voidColor[1] * 255, settings.voidColor[2] * 255);
      }
      if (settings.ambientLight != null) project.map.ambientLight = num(settings.ambientLight, project.map.ambientLight);
      if (settings.skyLight != null) project.map.skyLight = num(settings.skyLight, project.map.skyLight);
      if (settings.perspectiveView != null) project.map.perspective = Boolean(settings.perspectiveView);
      if (settings.flatView != null) project.map.flat = Boolean(settings.flatView);
      if (settings.freeFlightView != null) project.map.freeFlight = Boolean(settings.freeFlightView);
    }
  } else if (fallback && !project.map.name) {
    project.map.name = `${entry.id} (резерв)`;
  }

  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.z)) {
    const scale = Number.isFinite(anchor.distance) && anchor.distance > 0
      ? clamp(560 / anchor.distance, 0.02, 4)
      : 0.6;
    app.canvas?.centerOn(anchor.x, anchor.z, scale);
  } else if (first || !stored) {
    app.canvas?.centerOn(project.map.startPos.x, project.map.startPos.z, 0.5);
  }

  if (editor.showPlayers) loadPlayers();
  updateSourceUi();
  renderMapSelect();
  renderInspector();
  saveSoon();
  requestDraw();
}

async function selectMap(id) {
  if (!id || id === source.mapId) return;
  await applyMap(id, { first: true });
  toast(`Карта: ${source.mapSettings?.name || id}`, 'info', 1600);
}

async function loadPlayers() {
  if (!source.liveRoot) return;
  clearInterval(editor.playerTimer);
  editor.playerTimer = null;
  try {
    const data = await fetchJson(`${source.liveRoot}/live/players.json`);
    editor.players = Array.isArray(data.players) ? data.players : [];
    requestDraw();
  } catch {
    editor.players = [];
    requestDraw();
  }
  if (editor.showPlayers) {
    editor.playerTimer = setInterval(() => {
      if (editor.showPlayers) loadPlayers();
    }, 10000);
  }
}

async function importLiveMarkers() {
  if (!source.liveRoot) {
    toast('Сначала подключите карту BlueMap', 'warn');
    return;
  }
  try {
    const data = await fetchJson(`${source.liveRoot}/live/markers.json`);
    const imported = importText(JSON.stringify(data), 'markers.json');
    if (!imported.sets?.length) {
      toast('На карте нет live-маркеров', 'warn');
      return;
    }
    applyImport(imported, 'markers.json');
  } catch {
    toast('Не удалось загрузить live/markers.json', 'err');
  }
}

function applyImport(result, filename = '') {
  const before = serializedProject();
  source.firstConnect = false;
  if (result.type === 'project') {
    project = normalizeProject(result.project);
    app.project = project;
    editor.selected = null;
    editor.activeSetId = project.sets[0]?.id || null;
    source.mapId = project.source.mapId || project.map.id;
    source.base = normalizeBaseUrl(project.source.url) || source.base;
    dom.sourceUrl.value = project.source.url;
    pushHistory(before);
    afterChange({ inspector: true });
    renderMapSelect();
    updateSourceUi();
    toast('Проект загружен', 'ok');
    connectSource(project.source.url, { silent: true }).then(() => {
      setTimeout(() => app.canvas?.fitProject(), 100);
    });
    return;
  }

  if (result.rawConfig) project.baseConfig = result.rawConfig;
  if (result.map) {
    project.map = { ...project.map, ...result.map };
    if (filename.endsWith('.conf')) {
      const base = filename.split('/').pop().replace(/\.conf$/i, '');
      if (base) project.map.id = base;
    }
  }

  if (result.sets?.length) {
    const hasObjects = project.sets.some((set) => set.objects.length);
    const replace = !hasObjects || confirm('Заменить текущие маркеры импортированными?\nOK — заменить, Отмена — добавить к текущим.');
    if (replace) {
      project.sets = result.sets;
      editor.selected = null;
      editor.activeSetId = project.sets[0]?.id || null;
    } else {
      const used = new Set(project.sets.map((set) => set.id));
      for (const set of result.sets) {
        set.id = uniqueId(set.id, used);
        used.add(set.id);
        set.label = `${set.label} (импорт)`;
        project.sets.push(set);
      }
    }
  }

  pushHistory(before);
  afterChange({ inspector: true });
  renderMapSelect();
  if (result.sets?.length) setTimeout(() => app.canvas?.fitProject(), 60);
  toast(result.sets?.length ? `Импортировано ${result.sets.length} ${plural(result.sets.length, 'набор', 'набора', 'наборов')}` : 'Параметры карты обновлены', 'ok');
}

async function onFileChosen(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await readFileText(file);
    const result = importText(text, file.name);
    applyImport(result, file.name);
  } catch (error) {
    toast(`Ошибка импорта: ${error.message}`, 'err', 6000);
  }
}

function newProject() {
  if (!confirm('Начать новый проект? Текущие объекты будут удалены (их можно вернуть через Ctrl+Z).')) return;
  const before = serializedProject();
  project = createEmptyProject(source.base || DEFAULT_SOURCE);
  app.project = project;
  editor.selected = null;
  editor.activeSetId = project.sets[0]?.id || null;
  project.source.url = source.base || DEFAULT_SOURCE;
  project.source.mapId = source.mapId || project.source.mapId;
  project.map.id = source.mapId || project.map.id;
  if (source.mapSettings?.name) project.map.name = source.mapSettings.name;
  const start = source.mapSettings?.startPos;
  if (Array.isArray(start) && start.length >= 2) project.map.startPos = { x: num(start[0], 0), z: num(start[1], 0) };
  else if (start && typeof start === 'object') project.map.startPos = vector2(start, { x: 0, z: 0 });
  dom.sourceUrl.value = project.source.url;
  source.mapId = project.source.mapId;
  source.firstConnect = true;
  history.past.push(before);
  history.future = [];
  afterChange({ inspector: true });
  renderMapSelect();
  updateSourceUi();
  toast('Новый проект', 'ok');
}

function toggleSet(set) {
  set.visible = set.visible === false;
  saveSoon();
  renderLayers();
  requestDraw();
}

function toggleObject(set, object) {
  object.visible = object.visible === false;
  saveSoon();
  renderLayers();
  requestDraw();
}

function onLayersClick(event) {
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const set = project.sets.find((item) => item.id === action.dataset.set);
  if (!set) return;
  if (action.dataset.action === 'toggle-set') {
    event.stopPropagation();
    toggleSet(set);
    return;
  }
  if (action.dataset.action === 'select-set') {
    selectSet(set);
    return;
  }
  const object = set.objects.find((item) => item.id === action.dataset.id);
  if (!object) return;
  if (action.dataset.action === 'toggle-object') {
    event.stopPropagation();
    toggleObject(set, object);
    return;
  }
  if (action.dataset.action === 'select-object') selectObject(set, object);
}

function onLayersDoubleClick(event) {
  const row = event.target.closest('[data-action="select-object"]');
  if (!row) return;
  const set = project.sets.find((item) => item.id === row.dataset.set);
  const object = set?.objects.find((item) => item.id === row.dataset.id);
  if (!object) return;
  selectObject(set, object);
  centerSelected();
}

function setupMenus() {
  const closeMenus = () => {
    dom.saveMenu.hidden = true;
    dom.loadMenu.hidden = true;
    dom.btnSave.setAttribute('aria-expanded', 'false');
    dom.btnLoad.setAttribute('aria-expanded', 'false');
  };
  const toggle = (menu, button) => {
    const willOpen = menu.hidden;
    closeMenus();
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
  };
  dom.btnSave.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle(dom.saveMenu, dom.btnSave);
  });
  dom.btnLoad.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle(dom.loadMenu, dom.btnLoad);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap')) closeMenus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenus();
  });
  dom.saveMenu.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    closeMenus();
    if (action === 'download-conf') downloadConf();
    else if (action === 'download-markers') downloadMarkers();
    else if (action === 'download-project') downloadProject();
    else if (action === 'copy-conf') {
      try {
        await copyText(projectToConf(project));
        toast('Конфиг скопирован в буфер обмена', 'ok');
      } catch {
        toast('Не удалось скопировать', 'err');
      }
    } else if (action === 'save-browser') {
      if (saveToStorage({ silent: false })) toast('Сохранено в браузере', 'ok');
    }
  });
  dom.loadMenu.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    closeMenus();
    if (action === 'open-file') dom.fileInput.click();
    else if (action === 'import-live') importLiveMarkers();
    else if (action === 'new-project') newProject();
  });
}

function onGlobalKeyDown(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if (!dom.helpModal.hidden) {
    if (event.key === 'Escape') dom.helpModal.hidden = true;
    return;
  }
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 's') {
    event.preventDefault();
    downloadConf();
    return;
  }
  if (key === 'delete' || key === 'backspace') {
    if (editor.tool === 'ruler' && project.ruler.points.length) {
      project.ruler.points.pop();
      updateDraftHud();
      saveSoon();
      requestDraw();
      event.preventDefault();
      return;
    }
    if (editor.draft) {
      cancelDraft();
      event.preventDefault();
      return;
    }
    if (editor.selectedVertex) {
      deleteSelectedVertex();
      event.preventDefault();
      return;
    }
    if (editor.selected?.kind === 'object') {
      deleteSelectedObject();
      event.preventDefault();
    }
    return;
  }
  if (key === 'escape') {
    if (editor.draft) cancelDraft();
    else if (editor.tool === 'ruler' && project.ruler.points.length) {
      project.ruler.points = [];
      updateDraftHud();
      saveSoon();
      requestDraw();
    } else if (editor.selected) clearSelection();
    else setTool('select');
    return;
  }
  if (key === 'enter') {
    if (editor.draft) finishDraft();
    else if (editor.tool === 'ruler') updateDraftHud();
    return;
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === 'v') setTool('select');
    else if (key === 'p') setTool('marker');
    else if (key === 'l') setTool('line');
    else if (key === 'g') setTool('shape');
    else if (key === 'e') setTool('extrude');
    else if (key === 'r') setTool('ruler');
    else if (key === 'h') setTool('pan');
    else if (key === 'f') app.canvas?.fitProject();
  }
  if (event.key.startsWith('Arrow') && editor.selected?.kind === 'object') {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') moveSelected(-step, 0);
    else if (event.key === 'ArrowRight') moveSelected(step, 0);
    else if (event.key === 'ArrowUp') moveSelected(0, -step);
    else if (event.key === 'ArrowDown') moveSelected(0, step);
    event.preventDefault();
  }
}

function setupEvents() {
  dom.btnConnect.addEventListener('click', () => connectSource(dom.sourceUrl.value, { silent: false }));
  dom.btnEmptyConnect.addEventListener('click', () => connectSource(dom.sourceUrl.value || project.source.url || DEFAULT_SOURCE, { silent: false }));
  dom.sourceUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connectSource(dom.sourceUrl.value, { silent: false });
  });
  dom.mapSelect.addEventListener('change', () => selectMap(dom.mapSelect.value));
  dom.btnUndo.addEventListener('click', undo);
  dom.btnRedo.addEventListener('click', redo);
  dom.btnAddSet.addEventListener('click', addSet);
  dom.btnImportLive.addEventListener('click', importLiveMarkers);
  dom.btnFit.addEventListener('click', () => app.canvas?.fitProject());
  dom.btnHelp.addEventListener('click', () => { dom.helpModal.hidden = false; });
  dom.btnCloseHelp.addEventListener('click', () => { dom.helpModal.hidden = true; });
  dom.helpModal.addEventListener('click', (event) => {
    if (event.target === dom.helpModal) dom.helpModal.hidden = true;
  });
  dom.fileInput.addEventListener('change', onFileChosen);
  dom.layersList.addEventListener('click', onLayersClick);
  dom.layersList.addEventListener('dblclick', onLayersDoubleClick);
  dom.inspectorContent.addEventListener('input', onInspectorInput);
  dom.inspectorContent.addEventListener('change', onInspectorChange);
  dom.inspectorContent.addEventListener('click', onInspectorClick);
  dom.inspectorContent.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) beginGroup();
  });
  dom.inspectorContent.addEventListener('focusout', endGroup);
  dom.tabObject.addEventListener('click', () => {
    editor.tab = 'object';
    renderInspector({ resetScroll: true });
  });
  dom.tabMap.addEventListener('click', () => {
    editor.tab = 'map';
    renderInspector({ resetScroll: true });
  });
  dom.btnCenterSelected.addEventListener('click', centerSelected);
  dom.toolDock.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-tool]')?.dataset.tool;
    if (tool) setTool(tool);
  });
  dom.mapCanvas.addEventListener('dblclick', () => {
    if (editor.tool === 'ruler') {
      if (project.ruler.points.length >= 2) {
        const last = project.ruler.points[project.ruler.points.length - 1];
        const prev = project.ruler.points[project.ruler.points.length - 2];
        if (Math.hypot(last.x - prev.x, last.z - prev.z) < 0.2) project.ruler.points.pop();
        saveSoon();
        requestDraw();
      }
      return;
    }
    if (editor.draft) normalizeDraftAfterDoubleClick();
  });
  window.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('beforeunload', () => saveToStorage());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.helpModal.hidden) dom.helpModal.hidden = true;
  });
}

function handleEmptyMap() {
  if (!source.base) {
    dom.sourceUrl.value = project.source.url || DEFAULT_SOURCE;
  }
}

async function boot() {
  dom.sourceUrl.value = project.source.url || DEFAULT_SOURCE;
  handleEmptyMap();
  app.canvas = initCanvas(app);
  app.boundsOfProject = () => boundsOfProject(project);
  setupEvents();
  setupMenus();
  updateToolUi();
  renderLayers();
  renderInspector();
  renderStats();
  renderMapSelect();
  updateSourceUi();
  updateHistoryButtons();
  requestDraw();

  await checkProxy();
  if (project.source.url) {
    connectSource(project.source.url, { silent: true });
  }
}

boot();

Object.assign(app, {
  beginGroup,
  endGroup,
  saveSoon,
  afterChange,
  selectObject,
  clearSelection,
  handleCanvasClick,
  updateDraftHud,
  renderLayers,
  renderInspector,
  boundsOfProject: () => boundsOfProject(project)
});

if (typeof window !== 'undefined') window.bluemapStudio = app;
