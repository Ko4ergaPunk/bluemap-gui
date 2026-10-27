import { confFileName, projectStats, TYPE_LABELS } from './config.js';
import { attr, escapeHtml, fmt, fmtDistance, polylineLength } from './util.js';

const ICONS = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.6 7-11a7 7 0 1 0-14 0c0 4.4 7 11 7 11Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>',
  line: '<svg viewBox="0 0 24 24"><path d="M4 18 9 7l5 8 6-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shape: '<svg viewBox="0 0 24 24"><path d="m12 3 9 6.5-3.5 10h-11L3 9.5 12 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  extrude: '<svg viewBox="0 0 24 24"><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  select: '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.5L10 19 5 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};

function field(label, input) {
  return `<div class="field"><label>${label}</label>${input}</div>`;
}

function textInput(name, value, options = {}) {
  const { scope = 'object', type = 'text', placeholder = '', min, max, step } = options;
  return `<input type="${type}" data-scope="${scope}" data-field="${attr(name)}" value="${attr(value ?? '')}" placeholder="${attr(placeholder)}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} ${step != null ? `step="${step}"` : ''}>`;
}

function numberInput(name, value, options = {}) {
  return textInput(name, value, { ...options, type: 'number', step: options.step ?? 'any' });
}

function colorField(label, fieldName, value, alphaField, alphaValue, scope = 'object') {
  return `<div class="field">
    <label>${label}<span class="value">${Math.round(Number(alphaValue ?? 1) * 100)}%</span></label>
    <div class="field-row two">
      <input type="color" data-scope="${scope}" data-field="${attr(fieldName)}" value="${attr(value)}">
      <input type="range" min="0" max="1" step="0.01" data-scope="${scope}" data-field="${attr(alphaField)}" data-kind="number" value="${attr(alphaValue ?? 1)}">
    </div>
  </div>`;
}

function switchRow(label, fieldName, checked, scope = 'object') {
  return `<label class="switch-row">
    <span>${label}</span>
    <span>
      <input class="switch-input" type="checkbox" data-scope="${scope}" data-field="${attr(fieldName)}" ${checked ? 'checked' : ''}>
      <span class="switch"></span>
    </span>
  </label>`;
}

function setSelect(selectedId) {
  return `<div class="field"><label>Набор</label><select data-scope="object" data-field="__setId">
    ${projectSets(selectedId)}
  </select></div>`;
}

let setsForSelect = [];
function projectSets(selectedId) {
  return setsForSelect.map((set) => `<option value="${attr(set.id)}" ${set.id === selectedId ? 'selected' : ''}>${escapeHtml(set.label)}</option>`).join('');
}

function objectActions() {
  return `<div class="btn-row">
    <button class="btn" data-action="duplicate-object">${ICONS.copy} Дублировать</button>
    <button class="btn" data-action="center-object">${ICONS.locate} К центру</button>
  </div>
  <div class="btn-row">
    <button class="btn danger" data-action="delete-object">${ICONS.trash} Удалить объект</button>
  </div>`;
}

function commonMarkerFields(object) {
  return `<div class="section">
    <div class="section-title">Отображение</div>
    ${switchRow('Показывать в списке', 'listed', object.listed !== false)}
    ${object.type !== 'poi' ? switchRow('Depth test (скрывать за рельефом)', 'depthTest', Boolean(object.depthTest)) : ''}
    <div class="field-row two">
      ${field('Сортировка', numberInput('sorting', object.sorting))}
      ${field('Мин. дистанция', numberInput('minDistance', object.minDistance))}
    </div>
    ${field('Макс. дистанция', numberInput('maxDistance', object.maxDistance))}
    ${field('Описание (HTML)', `<textarea data-scope="object" data-field="detail" rows="3">${escapeHtml(object.detail || '')}</textarea>`)}
  </div>`;
}

function pointList(object, listName, axes) {
  const points = object[listName] || [];
  return `<div class="section">
    <div class="section-title"><span>Точки · ${points.length}</span><button data-action="add-point" data-list="${listName}">+ добавить</button></div>
    <div class="point-list">
      ${points.map((point, index) => `
        <div class="point-row ${axes.length === 2 ? 'two' : ''}">
          <span class="idx">${index + 1}</span>
          ${axes.map((axis) => `<input type="number" step="any" data-scope="point" data-list="${listName}" data-index="${index}" data-axis="${axis}" value="${attr(fmt(point[axis], 2))}" title="${axis.toUpperCase()}">`).join('')}
          <button class="row-btn" data-action="remove-point" data-list="${listName}" data-index="${index}" title="Удалить точку">${ICONS.x}</button>
        </div>`).join('')}
    </div>
  </div>`;
}

function objectHeader(object, set) {
  return `<div class="section">
    <div class="section-title">
      <span>${TYPE_LABELS[object.type]}</span>
      <span class="badge">${escapeHtml(set.label)}</span>
    </div>
    ${field('Название', textInput('label', object.label))}
    ${setSelect(set.id)}
  </div>`;
}

function renderObjectInspector(object, set) {
  let html = objectHeader(object, set);

  if (object.type === 'poi') {
    html += `<div class="section">
      <div class="section-title">Позиция</div>
      <div class="field-row">
        ${field('X', numberInput('position.x', object.position.x))}
        ${field('Y', numberInput('position.y', object.position.y))}
        ${field('Z', numberInput('position.z', object.position.z))}
      </div>
      ${field('Цвет в редакторе', `<input type="color" data-scope="object" data-field="color" value="${attr(object.color || '#38bdf8')}">`)}
      ${field('Иконка для экспорта (URL)', textInput('icon', object.icon, { placeholder: 'assets/poi.svg' }))}
      <div class="field-row two">
        ${field('Смещение X', numberInput('anchor.x', object.anchor?.x ?? 25))}
        ${field('Смещение Y', numberInput('anchor.y', object.anchor?.y ?? 45))}
      </div>
      ${field('CSS-классы (через запятую)', textInput('classes', (object.classes || []).join(', ')))}
      ${commonMarkerFields(object)}
    </div>`;
  } else if (object.type === 'line') {
    html += `<div class="section">
      <div class="section-title">Стиль линии</div>
      ${colorField('Цвет линии', 'lineColor', object.lineColor, 'lineAlpha', object.lineAlpha)}
      <div class="field-row two">
        ${field('Толщина, px', numberInput('lineWidth', object.lineWidth, { min: 1, max: 30 }))}
        ${field('Длина', `<div class="object-card"><dl class="kv"><dt>2D</dt><dd>${fmtDistance(polylineLength(object.line, false))}</dd><dt>3D</dt><dd>${fmtDistance(polylineLength(object.line, true))}</dd></dl></div>`)}
      </div>
      ${field('Ссылка', textInput('link', object.link || '', { placeholder: 'https://…' }))}
      ${switchRow('Открывать в новой вкладке', 'newTab', Boolean(object.newTab))}
      ${commonMarkerFields(object)}
    </div>
    ${pointList(object, 'line', ['x', 'y', 'z'])}`;
  } else if (object.type === 'shape') {
    html += `<div class="section">
      <div class="section-title">Стиль области</div>
      ${colorField('Цвет линии', 'lineColor', object.lineColor, 'lineAlpha', object.lineAlpha)}
      ${colorField('Заливка', 'fillColor', object.fillColor, 'fillAlpha', object.fillAlpha)}
      <div class="field-row two">
        ${field('Толщина, px', numberInput('lineWidth', object.lineWidth, { min: 1, max: 30 }))}
        ${field('Высота Y', numberInput('shapeY', object.shapeY))}
      </div>
      ${field('Ссылка', textInput('link', object.link || '', { placeholder: 'https://…' }))}
      ${switchRow('Открывать в новой вкладке', 'newTab', Boolean(object.newTab))}
      ${commonMarkerFields(object)}
    </div>
    ${pointList(object, 'shape', ['x', 'z'])}`;
  } else {
    html += `<div class="section">
      <div class="section-title">Стиль объёма</div>
      ${colorField('Цвет линии', 'lineColor', object.lineColor, 'lineAlpha', object.lineAlpha)}
      ${colorField('Заливка', 'fillColor', object.fillColor, 'fillAlpha', object.fillAlpha)}
      <div class="field-row two">
        ${field('Толщина, px', numberInput('lineWidth', object.lineWidth, { min: 1, max: 30 }))}
        ${field('Мин. Y', numberInput('shapeMinY', object.shapeMinY))}
      </div>
      ${field('Макс. Y', numberInput('shapeMaxY', object.shapeMaxY))}
      ${field('Ссылка', textInput('link', object.link || '', { placeholder: 'https://…' }))}
      ${switchRow('Открывать в новой вкладке', 'newTab', Boolean(object.newTab))}
      ${commonMarkerFields(object)}
    </div>
    ${pointList(object, 'shape', ['x', 'z'])}`;
  }

  html += `<div class="section">${objectActions()}</div>`;
  return html;
}

function renderSetInspector(set) {
  const stats = projectStats({ sets: [set] });
  return `<div class="section">
    <div class="section-title"><span>Набор маркеров</span><span class="badge">${set.objects.length}</span></div>
    ${field('Название', textInput('label', set.label, { scope: 'set' }))}
    <div class="field-row two">
      ${field('Сортировка', numberInput('sorting', set.sorting, { scope: 'set' }))}
      ${field('Объектов', `<div class="object-card"><dl class="kv"><dt>всего</dt><dd>${set.objects.length}</dd><dt>точек</dt><dd>${stats.points}</dd></dl></div>`)}
    </div>
    ${switchRow('Можно скрыть в меню', 'toggleable', set.toggleable !== false, 'set')}
    ${switchRow('Скрыт по умолчанию', 'defaultHidden', Boolean(set.defaultHidden), 'set')}
    ${switchRow('Видим в редакторе', 'visible', set.visible !== false, 'set')}
  </div>
  <div class="section">
    <div class="section-title">Действия</div>
    <div class="btn-row">
      <button class="btn" data-action="add-marker-to-set">${ICONS.pin} Маркер</button>
      <button class="btn" data-action="add-line-to-set">${ICONS.line} Линия</button>
    </div>
    <div class="btn-row">
      <button class="btn" data-action="add-shape-to-set">${ICONS.shape} Область</button>
      <button class="btn" data-action="add-extrude-to-set">${ICONS.extrude} Объём</button>
    </div>
    <div class="btn-row">
      <button class="btn danger" data-action="delete-set">${ICONS.trash} Удалить набор</button>
    </div>
    <p class="hint">Новые объекты добавляются в этот набор. Чтобы нарисовать объект, выберите инструмент на панели карты.</p>
  </div>`;
}

function renderMapInspector({ project, editor, source, tileManager }) {
  const map = project.map;
  const sourceLabel = source.base || 'не подключено';
  const mapOptions = source.maps || [];
  return `<div class="section">
    <div class="section-title"><span>Источник</span><span class="badge">${source.connected ? 'online' : 'offline'}</span></div>
    ${field('Ссылка BlueMap', `<input type="text" data-scope="source" data-field="url" value="${attr(source.base || project.source.url || 'https://map.arzmine.ru')}">`)}
    <div class="field-row two">
      ${field('Карта на сервере', `<select data-scope="source" data-field="mapId">${mapOptions.length ? mapOptions.map((item) => `<option value="${attr(item.id)}" ${item.id === source.mapId ? 'selected' : ''}>${escapeHtml(item.name || item.id)}</option>`).join('') : `<option>${escapeHtml(source.mapId)}</option>`}</select>`)}
      ${field('Тайлы', `<div class="object-card"><dl class="kv"><dt>загружено</dt><dd>${tileManager.lastStats.loaded}/${tileManager.lastStats.visible}</dd><dt>уровень</dt><dd>LOD ${tileManager.lastStats.lod || '—'}</dd></dl></div>`)}
    </div>
    <div class="btn-row">
      <button class="btn" data-action="reconnect">Подключить</button>
      <button class="btn" data-action="import-live">${ICONS.copy} Маркеры с карты</button>
    </div>
    <p class="hint">Корень: ${escapeHtml(sourceLabel)}${source.connected ? '' : `. Резервный режим: карта «${escapeHtml(source.mapId)}».`}</p>
  </div>

  <div class="section">
    <div class="section-title"><span>Файл карты</span><span class="badge">.conf</span></div>
    ${field('ID карты / файл', textInput('id', map.id, { scope: 'map' }))}
    ${field('Название в меню', textInput('name', map.name, { scope: 'map' }))}
    <div class="field-row two">
      ${field('Папка мира', textInput('world', map.world, { scope: 'map' }))}
      ${field('Сортировка', numberInput('sorting', map.sorting, { scope: 'map' }))}
    </div>
    ${field('Измерение', textInput('dimension', map.dimension, { scope: 'map' }))}
    <div class="field-row two">
      ${field('Старт X', numberInput('startPos.x', map.startPos.x, { scope: 'map' }))}
      ${field('Старт Z', numberInput('startPos.z', map.startPos.z, { scope: 'map' }))}
    </div>
    <div class="btn-row">
      <button class="btn" data-action="start-at-view">${ICONS.locate} Старт = центр карты</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Освещение и цвета</div>
    <div class="field-row two">
      ${field('Небо', `<input type="color" data-scope="map" data-field="skyColor" value="${attr(map.skyColor)}">`)}
      ${field('Пустота', `<input type="color" data-scope="map" data-field="voidColor" value="${attr(map.voidColor)}">`)}
    </div>
    <div class="field-row two">
      ${field('Небесный свет', numberInput('skyLight', map.skyLight, { scope: 'map', min: 0, max: 1, step: 0.01 }))}
      ${field('Фоновый свет', numberInput('ambientLight', map.ambientLight, { scope: 'map', min: 0, max: 1, step: 0.01 }))}
    </div>
    ${field('Убрать пещеры ниже Y', numberInput('removeCavesBelowY', map.removeCavesBelowY, { scope: 'map' }))}
  </div>

  <div class="section">
    <div class="section-title">Виды и рендер</div>
    ${switchRow('Перспективный вид', 'perspective', map.perspective !== false, 'map')}
    ${switchRow('Плоский вид', 'flat', map.flat !== false, 'map')}
    ${switchRow('Свободный полёт', 'freeFlight', map.freeFlight !== false, 'map')}
    ${switchRow('Детальный слой (hires)', 'hires', map.hires !== false, 'map')}
    ${switchRow('Сетка в редакторе', 'showGrid', editor.showGrid, 'editor')}
    ${switchRow('Подписи объектов', 'showLabels', editor.showLabels, 'editor')}
    ${switchRow('Игроки онлайн', 'showPlayers', editor.showPlayers, 'editor')}
  </div>

  <div class="section">
    <div class="section-title">Экспорт</div>
    <div class="btn-row">
      <button class="btn primary" data-action="download-conf">${ICONS.copy} Скачать .conf</button>
    </div>
    <div class="btn-row">
      <button class="btn" data-action="download-markers">markers.json</button>
      <button class="btn" data-action="download-project">проект</button>
    </div>
    <p class="hint">Имя файла: <code>${escapeHtml(confFileName(project))}</code>. Положите его в <code>config/bluemap/maps/</code> и перезапустите BlueMap.</p>
  </div>`;
}

function renderEmptyInspector({ project, editor }) {
  const stats = projectStats(project);
  return `<div class="empty-state">
    ${ICONS.select}
    <b>Ничего не выбрано</b>
    <p>Кликните по объекту на карте или в списке слоёв, чтобы изменить его свойства.</p>
  </div>
  <div class="section">
    <div class="section-title">Новый объект</div>
    ${field('Высота Y по умолчанию', numberInput('y', editor.newY, { scope: 'defaults' }))}
    ${field('Цвет маркера по умолчанию', `<input type="color" data-scope="defaults" data-field="color" value="${attr(editor.newColor)}">`)}
    ${switchRow('Привязка к блокам', 'snap', editor.snap, 'editor')}
    <p class="hint">Инструменты: <kbd>V</kbd> выбор, <kbd>P</kbd> маркер, <kbd>L</kbd> линия, <kbd>G</kbd> область, <kbd>E</kbd> объём, <kbd>R</kbd> линейка.</p>
  </div>
  <div class="section">
    <div class="section-title">Проект</div>
    <div class="object-card">
      <dl class="kv">
        <dt>Наборов</dt><dd>${stats.sets}</dd>
        <dt>Объектов</dt><dd>${stats.objects}</dd>
        <dt>Точек</dt><dd>${stats.points}</dd>
        <dt>Карта</dt><dd>${escapeHtml(project.map.id)}</dd>
      </dl>
    </div>
  </div>`;
}

export function renderInspector(context) {
  const { project, editor, source, tileManager } = context;
  setsForSelect = project.sets;
  if (editor.tab === 'map') return renderMapInspector(context);
  if (editor.selected?.kind === 'object') {
    const set = project.sets.find((item) => item.id === editor.selected.setId);
    const object = set?.objects.find((item) => item.id === editor.selected.id);
    if (set && object) return renderObjectInspector(object, set);
  }
  if (editor.selected?.kind === 'set') {
    const set = project.sets.find((item) => item.id === editor.selected.id);
    if (set) return renderSetInspector(set);
  }
  return renderEmptyInspector(context);
}

export function renderLayers(project, editor) {
  if (!project.sets.length) {
    return `<div class="empty-layers"><b>Пока нет слоёв</b>Создайте набор маркеров и начните расставлять объекты на карте.</div>`;
  }
  return project.sets.map((set) => {
    const selectedSet = editor.selected?.kind === 'set' && editor.selected.id === set.id;
    const selectedObject = editor.selected?.kind === 'object' && editor.selected.setId === set.id;
    const color = set.objects.find((item) => item.type !== 'poi' || item.color)?.color || set.objects.find((item) => item.lineColor)?.lineColor || '#38bdf8';
    return `<div class="set-row ${selectedSet || selectedObject ? 'selected' : ''}" data-action="select-set" data-set="${attr(set.id)}">
      <button class="eye ${set.visible === false ? 'off' : ''}" data-action="toggle-set" data-set="${attr(set.id)}" title="Показать/скрыть набор в редакторе">${eyeIcon(set.visible !== false)}</button>
      <span class="dot" style="background:${attr(color)}"></span>
      <span class="set-name">${escapeHtml(set.label)}</span>
      <span class="badge">${set.objects.length}</span>
    </div>
    <div class="object-list">
      ${set.objects.map((object) => {
        const selected = editor.selected?.kind === 'object' && editor.selected.setId === set.id && editor.selected.id === object.id;
        return `<div class="object-row ${selected ? 'selected' : ''}" data-action="select-object" data-set="${attr(set.id)}" data-id="${attr(object.id)}">
          ${typeIcon(object.type)}
          <span class="object-name">${escapeHtml(object.label || TYPE_LABELS[object.type])}</span>
          <button class="eye ${object.visible === false ? 'off' : ''}" data-action="toggle-object" data-set="${attr(set.id)}" data-id="${attr(object.id)}" title="Показать/скрыть объект в редакторе">${eyeIcon(object.visible !== false)}</button>
        </div>`;
      }).join('')}
      ${set.objects.length === 0 ? '<div class="empty-layers" style="padding:8px 6px;font-size:10px">пусто</div>' : ''}
    </div>`;
  }).join('');
}

const EYE = '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="m4 4 16 16M9.9 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.8M6.2 8A17 17 0 0 0 2.5 12S6 18 12 18c1 0 2-.2 2.8-.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

function eyeIcon(visible) {
  return visible ? EYE : EYE_OFF;
}

function typeIcon(type) {
  const map = { poi: 'pin', line: 'line', shape: 'shape', extrude: 'extrude' };
  return `<span class="type-icon ${type}">${ICONS[map[type]] || ICONS.select}</span>`;
}
