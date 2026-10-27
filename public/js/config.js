import { parseHocon } from './hocon.js';
import {
  alphaFromColorObject,
  bbox,
  colorFromObject,
  colorToParts,
  deepClone,
  normalizeHex,
  num,
  objectCenter,
  round,
  slugify,
  uniqueId,
  vector2,
  vector3
} from './util.js';

export const PROJECT_FORMAT = 'bluemap-gui';
export const PROJECT_VERSION = 1;

export const TYPE_LABELS = {
  poi: 'Маркер',
  line: 'Линия',
  shape: 'Область',
  extrude: 'Объём'
};

export function defaultMapSettings() {
  return {
    id: 'world',
    name: 'world (overworld)',
    world: 'world',
    dimension: 'minecraft:overworld',
    sorting: 0,
    startPos: { x: 0, z: 0 },
    skyColor: '#7dabff',
    voidColor: '#000000',
    skyLight: 1,
    ambientLight: 0.1,
    removeCavesBelowY: 55,
    perspective: true,
    flat: true,
    freeFlight: true,
    hires: true,
    storage: 'file'
  };
}

function anchor2(value, fallback = { x: 25, y: 45 }) {
  if (!value || typeof value !== 'object') return { ...fallback };
  return { x: num(value.x, fallback.x), y: num(value.y, fallback.y) };
}

export function makeSet(options = {}) {
  return {
    id: options.id || 'set-1',
    label: options.label || 'Новый набор',
    toggleable: options.toggleable !== false,
    defaultHidden: Boolean(options.defaultHidden),
    sorting: num(options.sorting, 0),
    visible: options.visible !== false,
    objects: Array.isArray(options.objects) ? options.objects : []
  };
}

export function createEmptyProject(sourceUrl = 'https://map.arzmine.ru') {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    source: {
      url: sourceUrl,
      mapId: 'world'
    },
    map: defaultMapSettings(),
    sets: [makeSet({ id: 'set-1', label: 'Маркеры' })],
    ruler: { points: [], visible: true }
  };
}

const OBJECT_DEFAULTS = {
  poi: {
    label: 'Новый маркер',
    detail: '',
    icon: 'assets/poi.svg',
    anchor: { x: 25, y: 45 },
    minDistance: 0,
    maxDistance: 10000000,
    listed: true,
    sorting: 0,
    classes: [],
    color: '#38bdf8',
    visible: true
  },
  line: {
    label: 'Новая линия',
    detail: '',
    lineWidth: 3,
    lineColor: '#fb923c',
    lineAlpha: 1,
    depthTest: false,
    minDistance: 0,
    maxDistance: 10000000,
    listed: true,
    sorting: 0,
    link: '',
    newTab: false,
    visible: true
  },
  shape: {
    label: 'Новая область',
    detail: '',
    lineWidth: 3,
    lineColor: '#34d399',
    lineAlpha: 1,
    fillColor: '#34d399',
    fillAlpha: 0.22,
    shapeY: 64,
    depthTest: false,
    minDistance: 0,
    maxDistance: 10000000,
    listed: true,
    sorting: 0,
    link: '',
    newTab: false,
    visible: true
  },
  extrude: {
    label: 'Новый объём',
    detail: '',
    lineWidth: 3,
    lineColor: '#a78bfa',
    lineAlpha: 1,
    fillColor: '#a78bfa',
    fillAlpha: 0.22,
    shapeMinY: 54,
    shapeMaxY: 74,
    depthTest: true,
    minDistance: 0,
    maxDistance: 10000000,
    listed: true,
    sorting: 0,
    link: '',
    newTab: false,
    visible: true
  }
};

export function makeObject(type, options = {}) {
  const base = {
    id: options.id || `object-${Date.now().toString(36)}`,
    type,
    ...deepClone(OBJECT_DEFAULTS[type] || OBJECT_DEFAULTS.poi),
    ...options
  };
  if (type === 'poi') {
    base.position = vector3(options.position, { x: 0, y: 64, z: 0 });
    base.anchor = anchor2(options.anchor);
    base.classes = Array.isArray(options.classes) ? options.classes.map(String) : [];
  }
  if (type === 'line') {
    const points = Array.isArray(options.line) && options.line.length >= 2
      ? options.line.map((point) => vector3(point, { x: 0, y: 64, z: 0 }))
      : options.points || [{ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }];
    base.line = points.map((point) => vector3(point, { x: 0, y: 64, z: 0 }));
    delete base.points;
  }
  if (type === 'shape' || type === 'extrude') {
    const points = Array.isArray(options.shape) && options.shape.length >= 3
      ? options.shape.map((point) => vector2(point, { x: 0, z: 0 }))
      : options.points || [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    base.shape = points.map((point) => ({ x: num(point.x, 0), z: num(point.z, 0) }));
    delete base.points;
  }
  return base;
}

export function normalizeObject(raw, typeHint = null, fallbackId = 'object') {
  if (!raw || typeof raw !== 'object') return null;
  const declaredType = raw.type == null ? '' : String(raw.type).toLowerCase();
  if (declaredType && !['poi', 'line', 'shape', 'extrude', 'marker', 'polygon', 'html'].includes(declaredType)) return null;
  if (declaredType === 'html') return null;
  let type = typeHint || declaredType;
  if (type === 'marker') type = 'poi';
  if (type === 'polygon') type = 'shape';
  if (!['poi', 'line', 'shape', 'extrude'].includes(type)) {
    if (Array.isArray(raw.line)) type = 'line';
    else if (Array.isArray(raw.shape)) {
      type = raw.shapeMinY != null || raw.shapeMinY === 0 || raw['shape-min-y'] != null ? 'extrude' : 'shape';
    } else if (raw.position) type = 'poi';
    else return null;
  }

  const get = (...keys) => {
    for (const key of keys) {
      if (raw[key] !== undefined) return raw[key];
    }
    return undefined;
  };

  const object = makeObject(type, {
    id: String(raw.id || fallbackId),
    label: String(get('label') ?? TYPE_LABELS[type]),
    detail: String(get('detail') ?? ''),
    visible: get('visible') !== false,
    listed: get('listed') !== false,
    sorting: num(get('sorting'), 0),
    minDistance: num(get('minDistance', 'min-distance'), 0),
    maxDistance: num(get('maxDistance', 'max-distance'), 10000000)
  });

  object.id = String(raw.id || fallbackId);
  object.label = String(get('label') ?? TYPE_LABELS[type]);
  object.detail = String(get('detail') ?? '');

  if (type === 'poi') {
    object.position = vector3(get('position'), { x: 0, y: 64, z: 0 });
    object.icon = String(get('icon') ?? 'assets/poi.svg');
    object.anchor = anchor2(get('anchor'));
    object.classes = String(get('classes') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (Array.isArray(get('classes'))) object.classes = get('classes').map(String);
    object.color = normalizeHex(get('color'), '#38bdf8');
  } else {
    object.lineWidth = num(get('lineWidth', 'line-width'), type === 'poi' ? 1 : 3);
    object.lineColor = colorFromObject(get('lineColor', 'line-color'), type === 'line' ? '#fb923c' : '#34d399');
    object.lineAlpha = get('lineAlpha') != null ? num(get('lineAlpha'), 1) : alphaFromColorObject(get('lineColor', 'line-color'), 1);
    object.depthTest = Boolean(get('depthTest', 'depth-test'));
    object.link = String(get('link') ?? '');
    object.newTab = Boolean(get('newTab', 'new-tab'));
  }

  if (type === 'line') {
    const points = get('line', 'points');
    object.line = (Array.isArray(points) ? points : []).map((point) => vector3(point, { x: 0, y: 64, z: 0 }));
    if (object.line.length < 2) object.line = [{ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }];
  }

  if (type === 'shape' || type === 'extrude') {
    const points = get('shape', 'points');
    object.shape = (Array.isArray(points) ? points : []).map((point) => vector2(point, { x: 0, z: 0 }));
    if (object.shape.length < 3) {
      object.shape = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    }
    object.fillColor = colorFromObject(get('fillColor', 'fill-color'), object.lineColor);
    object.fillAlpha = get('fillAlpha') != null ? num(get('fillAlpha'), 0.22) : alphaFromColorObject(get('fillColor', 'fill-color'), 0.22);
    object.shapeY = num(get('shapeY', 'shape-y'), 64);
    if (type === 'extrude') {
      object.shapeMinY = num(get('shapeMinY', 'shape-min-y'), 54);
      object.shapeMaxY = num(get('shapeMaxY', 'shape-max-y'), 74);
    }
  }

  return object;
}

export function normalizeSet(raw, fallbackId = 'set', usedIds = new Set()) {
  const id = uniqueId(String(raw?.id || fallbackId), usedIds);
  usedIds.add(id);
  const objects = Array.isArray(raw?.objects) ? raw.objects : [];
  const objectIds = new Set();
  return makeSet({
    id,
    label: String(raw?.label || 'Набор маркеров'),
    toggleable: raw?.toggleable !== false,
    defaultHidden: Boolean(raw?.defaultHidden ?? raw?.['default-hidden']),
    sorting: num(raw?.sorting, 0),
    visible: raw?.visible !== false,
    objects: objects
      .map((object) => normalizeObject(object, null, 'object'))
      .filter(Boolean)
      .map((object) => {
        object.id = uniqueId(object.id || 'object', objectIds);
        objectIds.add(object.id);
        return object;
      })
  });
}

export function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyProject();
  const project = createEmptyProject(raw.source?.url || 'https://map.arzmine.ru');
  project.format = PROJECT_FORMAT;
  project.version = PROJECT_VERSION;
  project.savedAt = raw.savedAt || new Date().toISOString();
  project.source = {
    url: String(raw.source?.url || 'https://map.arzmine.ru'),
    mapId: String(raw.source?.mapId || raw.map?.id || 'world')
  };
  project.map = {
    ...defaultMapSettings(),
    ...(raw.map && typeof raw.map === 'object' ? raw.map : {})
  };
  project.map.id = String(project.map.id || project.source.mapId || 'world');
  project.map.startPos = vector2(project.map.startPos, { x: 0, z: 0 });
  project.map.skyColor = normalizeHex(project.map.skyColor, '#7dabff');
  project.map.voidColor = normalizeHex(project.map.voidColor, '#000000');
  const usedSetIds = new Set();
  project.sets = Array.isArray(raw.sets) && raw.sets.length
    ? raw.sets.map((set, index) => normalizeSet(set, `set-${index + 1}`, usedSetIds))
    : [makeSet({ id: 'set-1', label: 'Маркеры' })];
  project.ruler = {
    points: Array.isArray(raw.ruler?.points) ? raw.ruler.points.map((point) => vector2(point, { x: 0, z: 0 })) : [],
    visible: raw.ruler?.visible !== false
  };
  project.baseConfig = raw.baseConfig && typeof raw.baseConfig === 'object' && !Array.isArray(raw.baseConfig)
    ? deepClone(raw.baseConfig)
    : null;
  return project;
}

function markerSetsRoot(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.markerSets && typeof data.markerSets === 'object') return data.markerSets;
  if (data.markers && typeof data.markers === 'object' && !data.type) return { 'imported-set': data };
  if (data['marker-sets'] && typeof data['marker-sets'] === 'object') return data['marker-sets'];
  const values = Object.values(data);
  if (values.length && values.every((value) => value && typeof value === 'object' && ('markers' in value || 'label' in value))) {
    return data;
  }
  return null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function setsFromMarkerSets(root) {
  if (!root || typeof root !== 'object') return [];
  const sets = [];
  const usedSetIds = new Set();
  for (const [setKey, rawSet] of Object.entries(root)) {
    if (!rawSet || typeof rawSet !== 'object') continue;
    const set = makeSet({
      id: uniqueId(String(setKey || 'set'), usedSetIds),
      label: String(rawSet.label || setKey || 'Набор маркеров'),
      toggleable: rawSet.toggleable !== false,
      defaultHidden: Boolean(rawSet.defaultHidden ?? rawSet['default-hidden']),
      sorting: num(rawSet.sorting, 0),
      visible: true
    });
    usedSetIds.add(set.id);
    const usedObjectIds = new Set();
    const markerSource = {
      ...safeObject(rawSet.markers),
      ...safeObject(rawSet.shapes)
    };
    for (const [markerKey, rawMarker] of Object.entries(markerSource)) {
      if (!rawMarker || typeof rawMarker !== 'object') continue;
      const object = normalizeObject({ ...rawMarker, id: markerKey }, null, markerKey);
      if (!object) continue;
      object.id = uniqueId(String(markerKey || object.id), usedObjectIds);
      usedObjectIds.add(object.id);
      set.objects.push(object);
    }
    sets.push(set);
  }
  return sets;
}

function mapFieldsFromConfig(raw) {
  const get = (...keys) => {
    for (const key of keys) {
      if (raw[key] !== undefined) return raw[key];
    }
    return undefined;
  };
  const map = {};
  const name = get('name');
  const world = get('world');
  const dimension = get('dimension');
  const sorting = get('sorting');
  const startPos = get('start-pos', 'startPos');
  const skyColor = get('sky-color', 'skyColor');
  const voidColor = get('void-color', 'voidColor');
  const skyLight = get('sky-light', 'skyLight');
  const ambientLight = get('ambient-light', 'ambientLight');
  const removeCaves = get('remove-caves-below-y', 'removeCavesBelowY');
  const perspective = get('enable-perspective-view', 'perspective');
  const flat = get('enable-flat-view', 'flat');
  const freeFlight = get('enable-free-flight-view', 'freeFlight');
  const hires = get('enable-hires', 'hires');
  const storage = get('storage');
  if (name != null) map.name = String(name);
  if (world != null) map.world = String(world);
  if (dimension != null) map.dimension = String(dimension);
  if (sorting != null) map.sorting = num(sorting, 0);
  if (startPos) map.startPos = vector2(startPos, { x: 0, z: 0 });
  if (skyColor != null) map.skyColor = normalizeHex(skyColor, '#7dabff');
  if (voidColor != null) map.voidColor = normalizeHex(voidColor, '#000000');
  if (skyLight != null) map.skyLight = num(skyLight, 1);
  if (ambientLight != null) map.ambientLight = num(ambientLight, 0.1);
  if (removeCaves != null) map.removeCavesBelowY = num(removeCaves, 55);
  if (perspective != null) map.perspective = Boolean(perspective);
  if (flat != null) map.flat = Boolean(flat);
  if (freeFlight != null) map.freeFlight = Boolean(freeFlight);
  if (hires != null) map.hires = Boolean(hires);
  if (storage != null) map.storage = String(storage);
  return map;
}

export function importText(text, filename = '') {
  const source = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('Файл пуст');

  if (source.startsWith('{') || source.startsWith('[')) {
    let data;
    try {
      data = JSON.parse(source);
    } catch (error) {
      throw new Error(`Некорректный JSON: ${error.message}`);
    }
    if (data?.format === PROJECT_FORMAT) {
      return { type: 'project', project: normalizeProject(data) };
    }
    const root = markerSetsRoot(data);
    if (root) {
      const hasMap = ['name', 'world', 'dimension', 'sorting', 'start-pos', 'startPos', 'sky-color', 'skyColor', 'void-color', 'voidColor', 'sky-light', 'skyLight', 'ambient-light', 'ambientLight', 'remove-caves-below-y', 'removeCavesBelowY', 'enable-perspective-view', 'enable-flat-view', 'enable-free-flight-view', 'enable-hires', 'storage'].some((key) => data[key] != null);
      return {
        type: 'markers',
        sets: setsFromMarkerSets(root),
        map: hasMap ? mapFieldsFromConfig(data) : null,
        rawConfig: hasMap ? data : undefined
      };
    }
    if (Array.isArray(data)) {
      const sets = data.map((set, index) => normalizeSet(set, `set-${index + 1}`));
      return { type: 'markers', sets };
    }
    throw new Error('Не найдены marker-sets: это не конфиг BlueMap и не файл маркеров');
  }

  let parsed;
  try {
    parsed = parseHocon(source);
  } catch (error) {
    throw new Error(`Не удалось разобрать конфиг: ${error.message}`);
  }
  const root = markerSetsRoot(parsed);
  const map = mapFieldsFromConfig(parsed);
  if (!root && !Object.keys(map).length) {
    throw new Error('В конфиге не найдены ни marker-sets, ни параметры карты');
  }
  const result = {
    type: 'conf',
    sets: root ? setsFromMarkerSets(root) : [],
    map,
    rawConfig: parsed
  };
  if (filename) result.filename = filename;
  return result;
}

function quote(value) {
  return JSON.stringify(String(value ?? ''));
}

function number(value, fallback = 0) {
  const result = Number(value);
  if (!Number.isFinite(result)) return String(fallback);
  if (Number.isInteger(result)) return String(result);
  return String(round(result, 4));
}

function colorValue(hex, alpha) {
  const parts = colorToParts(hex, alpha);
  return `{ r: ${parts.r}, g: ${parts.g}, b: ${parts.b}, a: ${number(parts.a, 1)} }`;
}

function colorObject(hex, alpha) {
  return colorToParts(hex, alpha);
}

function point3List(points, indent) {
  const lines = points.map((point) => `${indent}{ x: ${number(point.x)}, y: ${number(point.y)}, z: ${number(point.z)} }`);
  return `[\n${lines.join('\n')}\n${indent.slice(0, -2)}]`;
}

function point2List(points, indent) {
  const lines = points.map((point) => `${indent}{ x: ${number(point.x)}, z: ${number(point.z)} }`);
  return `[\n${lines.join('\n')}\n${indent.slice(0, -2)}]`;
}

function commonMarkerFields(object, indent, includePosition = true) {
  const lines = [];
  if (includePosition) {
    const center = objectCenter(object);
    lines.push(`${indent}position: { x: ${number(center.x)}, y: ${number(center.y)}, z: ${number(center.z)} }`);
  }
  lines.push(`${indent}label: ${quote(object.label || TYPE_LABELS[object.type])}`);
  if (object.detail) lines.push(`${indent}detail: ${quote(object.detail)}`);
  lines.push(`${indent}listed: ${object.listed !== false ? 'true' : 'false'}`);
  lines.push(`${indent}sorting: ${number(object.sorting, 0)}`);
  lines.push(`${indent}min-distance: ${number(object.minDistance, 0)}`);
  lines.push(`${indent}max-distance: ${number(object.maxDistance, 10000000)}`);
  return lines;
}

function markerToConf(object, indent) {
  const lines = [];
  if (object.type === 'poi') {
    lines.push(`${indent}type: "poi"`);
    lines.push(...commonMarkerFields(object, indent));
    if (object.icon && object.icon !== 'assets/poi.svg') lines.push(`${indent}icon: ${quote(object.icon)}`);
    else lines.push(`${indent}icon: "assets/poi.svg"`);
    const anchor = anchor2(object.anchor);
    lines.push(`${indent}anchor: { x: ${number(anchor.x)}, y: ${number(anchor.y)} }`);
    if (object.classes?.length) {
      lines.push(`${indent}classes: [${object.classes.map((item) => quote(item)).join(', ')}]`);
    }
    return lines.join('\n');
  }

  if (object.type === 'line') {
    const points = object.line || [];
    lines.push(`${indent}type: "line"`);
    lines.push(...commonMarkerFields(object, indent));
    lines.push(`${indent}line: ${point3List(points, `${indent}  `)}`);
    lines.push(`${indent}new-tab: ${object.newTab ? 'true' : 'false'}`);
    lines.push(`${indent}depth-test: ${object.depthTest ? 'true' : 'false'}`);
    lines.push(`${indent}line-width: ${number(object.lineWidth, 3)}`);
    lines.push(`${indent}line-color: ${colorValue(object.lineColor, object.lineAlpha)}`);
    return lines.join('\n');
  }

  const points = object.shape || [];
  lines.push(`${indent}type: ${quote(object.type)}`);
  lines.push(...commonMarkerFields(object, indent));
  lines.push(`${indent}shape: ${point2List(points, `${indent}  `)}`);
  if (object.type === 'shape') {
    lines.push(`${indent}shape-y: ${number(object.shapeY, 64)}`);
  } else {
    lines.push(`${indent}shape-min-y: ${number(object.shapeMinY, 54)}`);
    lines.push(`${indent}shape-max-y: ${number(object.shapeMaxY, 74)}`);
  }
  lines.push(`${indent}holes: []`);
  lines.push(`${indent}new-tab: ${object.newTab ? 'true' : 'false'}`);
  lines.push(`${indent}depth-test: ${object.depthTest ? 'true' : 'false'}`);
  lines.push(`${indent}line-width: ${number(object.lineWidth, 3)}`);
  lines.push(`${indent}line-color: ${colorValue(object.lineColor, object.lineAlpha)}`);
  lines.push(`${indent}fill-color: ${colorValue(object.fillColor, object.fillAlpha)}`);
  return lines.join('\n');
}

function confKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(String(key)) ? String(key) : quote(key);
}

function hoconValue(value, indent = '') {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((item) => !item || typeof item !== 'object')) {
      return `[${value.map((item) => hoconValue(item, '')).join(', ')}]`;
    }
    const items = value.map((item) => `${inner}${hoconValue(item, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    if (entries.every(([, item]) => !item || typeof item !== 'object')) {
      return `{ ${entries.map(([key, item]) => `${confKey(key)}: ${hoconValue(item, '')}`).join(', ')} }`;
    }
    const lines = entries.map(([key, item]) => `${inner}${confKey(key)}: ${hoconValue(item, inner)}`);
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(round(value, 6)) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return 'null';
  return quote(String(value));
}

function stringifyHoconObject(object) {
  return Object.entries(object)
    .map(([key, value]) => `${confKey(key)}: ${hoconValue(value, '')}`)
    .join('\n');
}

function confHeader(project) {
  return [
    '##                          ##',
    '##         BlueMap          ##',
    '##        Map-Config        ##',
    '##                          ##',
    '',
    `# Сгенерировано BlueMap Config Studio ${new Date().toISOString().slice(0, 10)}`,
    `# ${project.source?.url || 'https://map.arzmine.ru'}`,
    ''
  ].join('\n');
}

function stripConfigAliases(raw) {
  for (const key of [
    'marker-sets', 'markerSets', 'marker_sets',
    'startPos', 'skyColor', 'voidColor', 'skyLight', 'ambientLight',
    'removeCavesBelowY', 'enablePerspectiveView', 'enableFlatView',
    'enableFreeFlightView', 'enableHires'
  ]) {
    delete raw[key];
  }
}

function applyKnownMapToRaw(raw, map) {
  const start = vector2(map.startPos, { x: 0, z: 0 });
  raw.world = map.world || 'world';
  raw.dimension = map.dimension || 'minecraft:overworld';
  raw.name = map.name || map.id || 'world';
  raw.sorting = num(map.sorting, 0);
  raw['start-pos'] = { x: num(start.x, 0), z: num(start.z, 0) };
  raw['sky-color'] = map.skyColor || '#7dabff';
  raw['void-color'] = map.voidColor || '#000000';
  raw['sky-light'] = num(map.skyLight, 1);
  raw['ambient-light'] = num(map.ambientLight, 0.1);
  raw['remove-caves-below-y'] = num(map.removeCavesBelowY, 55);
  raw['enable-perspective-view'] = map.perspective !== false;
  raw['enable-flat-view'] = map.flat !== false;
  raw['enable-free-flight-view'] = map.freeFlight !== false;
  raw['enable-hires'] = map.hires !== false;
  raw.storage = map.storage || 'file';
}

function markerSetsBlock(project) {
  const sets = project.sets || [];
  if (!sets.length) return 'marker-sets: {}';
  const lines = ['marker-sets: {'];
  sets.forEach((set, setIndex) => {
    lines.push('');
    lines.push(`  ${quote(set.id || `set-${setIndex + 1}`)}: {`);
    lines.push(`    label: ${quote(set.label || 'Набор маркеров')}`);
    lines.push(`    toggleable: ${set.toggleable !== false ? 'true' : 'false'}`);
    lines.push(`    default-hidden: ${set.defaultHidden ? 'true' : 'false'}`);
    lines.push(`    sorting: ${number(set.sorting, 0)}`);
    lines.push('    markers: {');
    (set.objects || []).forEach((object, objectIndex) => {
      lines.push('');
      lines.push(`      ${quote(object.id || `object-${objectIndex + 1}`)}: {`);
      lines.push(markerToConf(object, '        '));
      lines.push('      }');
    });
    if (set.objects?.length) lines.push('');
    lines.push('    }');
    lines.push('  }');
  });
  lines.push('');
  lines.push('}');
  return lines.join('\n');
}

export function projectToConf(project) {
  const raw = project.baseConfig && typeof project.baseConfig === 'object' && !Array.isArray(project.baseConfig)
    ? deepClone(project.baseConfig)
    : {};
  stripConfigAliases(raw);
  applyKnownMapToRaw(raw, project.map || defaultMapSettings());
  return `${confHeader(project)}\n${stringifyHoconObject(raw)}\n\n${markerSetsBlock(project)}\n`;
}

function markersJsonObject(project) {
  const sets = {};
  for (const set of project.sets || []) {
    const markers = {};
    for (const object of set.objects || []) {
      const center = objectCenter(object);
      const common = {
        detail: object.detail || object.label,
        newTab: Boolean(object.newTab),
        minDistance: num(object.minDistance, 0),
        maxDistance: num(object.maxDistance, 10000000),
        type: object.type,
        label: object.label || TYPE_LABELS[object.type],
        position: { x: round(center.x, 3), y: round(center.y, 3), z: round(center.z, 3) },
        sorting: num(object.sorting, 0),
        listed: object.listed !== false
      };
      if (object.link) common.link = object.link;

      if (object.type === 'poi') {
        markers[object.id] = {
          classes: object.classes || [],
          detail: object.detail || object.label,
          icon: object.icon || 'assets/poi.svg',
          anchor: anchor2(object.anchor),
          minDistance: num(object.minDistance, 0),
          maxDistance: num(object.maxDistance, 10000000),
          type: 'poi',
          label: object.label,
          position: { x: round(center.x, 3), y: round(center.y, 3), z: round(center.z, 3) },
          sorting: num(object.sorting, 0),
          listed: object.listed !== false
        };
      } else if (object.type === 'line') {
        markers[object.id] = {
          ...common,
          line: (object.line || []).map((point) => ({ x: round(point.x, 3), y: round(point.y, 3), z: round(point.z, 3) })),
          depthTest: Boolean(object.depthTest),
          lineWidth: num(object.lineWidth, 3),
          lineColor: colorObject(object.lineColor, object.lineAlpha)
        };
      } else if (object.type === 'shape') {
        markers[object.id] = {
          ...common,
          shape: (object.shape || []).map((point) => ({ x: round(point.x, 3), z: round(point.z, 3) })),
          holes: [],
          shapeY: num(object.shapeY, 64),
          depthTest: Boolean(object.depthTest),
          lineWidth: num(object.lineWidth, 3),
          lineColor: colorObject(object.lineColor, object.lineAlpha),
          fillColor: colorObject(object.fillColor, object.fillAlpha)
        };
      } else {
        markers[object.id] = {
          ...common,
          shape: (object.shape || []).map((point) => ({ x: round(point.x, 3), z: round(point.z, 3) })),
          holes: [],
          shapeMinY: num(object.shapeMinY, 54),
          shapeMaxY: num(object.shapeMaxY, 74),
          depthTest: Boolean(object.depthTest),
          lineWidth: num(object.lineWidth, 3),
          lineColor: colorObject(object.lineColor, object.lineAlpha),
          fillColor: colorObject(object.fillColor, object.fillAlpha)
        };
      }
    }
    sets[set.id] = {
      label: set.label || 'Набор маркеров',
      toggleable: set.toggleable !== false,
      defaultHidden: Boolean(set.defaultHidden),
      sorting: num(set.sorting, 0),
      markers
    };
  }
  return { markerSets: sets };
}

export function projectToMarkersJson(project) {
  return JSON.stringify(markersJsonObject(project), null, 2);
}

export function projectToJson(project) {
  const data = deepClone(project);
  data.format = PROJECT_FORMAT;
  data.version = PROJECT_VERSION;
  data.savedAt = new Date().toISOString();
  return JSON.stringify(data, null, 2);
}

export function confFileName(project) {
  return `${slugify(project.map?.id || project.map?.name || 'map', 'map')}.conf`;
}

export function markersFileName(project) {
  return `${slugify(project.map?.id || project.map?.name || 'map', 'map')}-markers.json`;
}

export function projectFileName(project) {
  return `${slugify(project.map?.id || project.map?.name || 'map', 'map')}.bmgui.json`;
}

export function projectStats(project) {
  let objects = 0;
  let points = 0;
  for (const set of project.sets || []) {
    objects += set.objects?.length || 0;
    for (const object of set.objects || []) {
      points += object.type === 'poi' ? 1 : (object.type === 'line' ? object.line?.length || 0 : object.shape?.length || 0);
    }
  }
  return { sets: project.sets?.length || 0, objects, points };
}

export function boundsOfProject(project) {
  const objects = (project.sets || []).flatMap((set) => (set.visible !== false ? set.objects || [] : []));
  if (!objects.length && !(project.ruler?.points?.length)) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const object of objects) {
    const points = object.type === 'poi' ? [object.position] : (object.type === 'line' ? object.line : object.shape);
    if (!points?.length) continue;
    const box = bbox(points);
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minZ = Math.min(minZ, box.minZ);
    maxZ = Math.max(maxZ, box.maxZ);
  }
  for (const point of project.ruler?.points || []) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ };
}
