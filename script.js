// ===== Telegram Web App =====
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ===== Supabase =====
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Пользователь =====
const tgUser = tg.initDataUnsafe?.user;
const USER_ID = tgUser?.id?.toString() || ('guest_' + Date.now());
const USER_FIRST_NAME = tgUser?.first_name || '';
const USER_LAST_NAME = tgUser?.last_name || '';
const USER_NAME_FULL = `${USER_FIRST_NAME} ${USER_LAST_NAME}`.trim() || 'Гость';
const USER_USERNAME = tgUser?.username || null;
const USER_PHOTO = tgUser?.photo_url || null;

// ===== Константы =====
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_SHORT = ['ЯНВ','ФЕВ','МАР','АПР','МАЯ','ИЮН','ИЮЛ','АВГ','СЕН','ОКТ','НОЯ','ДЕК'];
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WEEKDAYS_SHORT = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];

// ===== State =====
let CATEGORIES = {}; // {slug: {label, color}}
let EVENTS = [];
let MY_REGISTRATIONS = []; // массив event_id
let isAdmin = false;
let currentDate = new Date();
let selectedDate = null;
let currentEvent = null;
let currentTab = 'calendar';
let editingEventId = null;
let editingCatId = null;
let formIsOnline = false;
let formImageDataUrl = null;
let formImageFile = null;
let formLocations = [];
let showPastInCalendarList = false;
let showPastInEvents = false;
let showPastInOnline = false;

// ===== Utils =====
function fmtDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function isSameDay(d1, d2) {
  return d1.getFullYear()===d2.getFullYear() && d1.getMonth()===d2.getMonth() && d1.getDate()===d2.getDate();
}
function isToday(d) { return isSameDay(d, new Date()); }
function isPast(ev) {
  const endStr = ev.end_time || '23:59';
  const eventEnd = new Date(`${ev.event_date}T${endStr}:00`);
  return eventEnd < new Date();
}
function isPastDay(d) {
  const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59);
  return endOfDay < new Date() && !isToday(d);
}
function dateToHuman(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}
function dateToHumanCaps(dateStr, time) {
  const d = new Date(dateStr);
  const wd = WEEKDAYS_SHORT[d.getDay()];
  const m = MONTHS_SHORT[d.getMonth()];
  return `${d.getDate()} ${m} ${d.getFullYear()} · ${wd}${time?` · ${time}`:''}`;
}
function eventsOn(dateKey) { return EVENTS.filter(e => e.event_date === dateKey); }
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
function getInitials(name) {
  return name.split(' ').filter(Boolean).slice(0,2).map(s => s[0]?.toUpperCase() || '').join('') || '?';
}
function getRegCount(eventId) {
  return EVENTS.find(e => e.id === eventId)?._regCount || 0;
}
function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function showError(msg) {
  if (tg.showAlert) tg.showAlert(msg); else alert(msg);
}
function showConfirm(msg) {
  return new Promise(resolve => {
    if (tg.showConfirm) tg.showConfirm(msg, resolve);
    else resolve(confirm(msg));
  });
}

// ===== INIT =====
async function init() {
  await Promise.all([
    loadCategories(),
    checkAdmin(),
    loadEvents()
  ]);
  await loadMyRegistrations();
  renderCalendar();
  renderEventsList();
  renderEventsCards();
  renderWebinars();
  renderProfile();
  setupEventListeners();
}

async function loadCategories() {
  const { data, error } = await db.from('categories').select('*').order('sort_order');
  if (error) { console.error('cat load:', error); return; }
  CATEGORIES = {};
  (data || []).forEach(c => {
    CATEGORIES[c.slug] = { id: c.id, label: c.label, color: c.color, sort_order: c.sort_order };
  });
}

async function checkAdmin() {
  const { data } = await db.from('admins').select('user_id').eq('user_id', USER_ID).maybeSingle();
  if (data) {
    isAdmin = true;
    document.getElementById('adminMenu').classList.remove('hidden');
  }
}

async function loadEvents() {
  const { data, error } = await db.from('events').select('*').order('event_date', { ascending: true });
  if (error) { console.error('events load:', error); return; }
  EVENTS = data || [];
  // Подгружаем счётчики регистраций
  const { data: regs } = await db.from('registrations').select('event_id');
  const counts = {};
  (regs || []).forEach(r => { counts[r.event_id] = (counts[r.event_id] || 0) + 1; });
  EVENTS.forEach(e => { e._regCount = counts[e.id] || 0; });
}

async function loadMyRegistrations() {
  const { data } = await db.from('registrations').select('event_id').eq('user_id', USER_ID);
  MY_REGISTRATIONS = (data || []).map(r => r.event_id);
}

// ===== CALENDAR =====
function renderCalendar() {
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  document.getElementById('monthTitle').textContent = `${MONTHS[m].toUpperCase()} ${y}`;

  const firstDay = new Date(y, m, 1);
  let startWd = firstDay.getDay() - 1;
  if (startWd < 0) startWd = 6;
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const daysInPrev = new Date(y, m, 0).getDate();

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  for (let i = startWd-1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'day-cell other-month';
    cell.innerHTML = `<span class="day-num">${daysInPrev-i}</span>`;
    grid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(y, m, day);
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (isToday(date)) cell.classList.add('today');
    if (isPastDay(date)) cell.classList.add('past');

    const dateKey = fmtDateKey(date);
    const evs = eventsOn(dateKey);
    if (evs.length > 0) cell.classList.add('has-event');
    if (selectedDate && isSameDay(date, selectedDate)) cell.classList.add('selected');

    let dotsHtml = '';
    if (evs.length > 0) {
      dotsHtml = '<div class="day-dots">';
      const cats = [...new Set(evs.map(e => e.category_slug))].slice(0, 3);
      cats.forEach(slug => {
        if (slug === 'webinar') dotsHtml += '<div class="dot-online"></div>';
        else {
          const color = CATEGORIES[slug]?.color || '#005EF2';
          dotsHtml += `<div class="dot" style="background:${color};"></div>`;
        }
      });
      dotsHtml += '</div>';
    }

    cell.innerHTML = `<span class="day-num">${day}</span>${dotsHtml}`;
    cell.addEventListener('click', () => {
      selectedDate = (selectedDate && isSameDay(selectedDate, date)) ? null : date;
      renderCalendar();
      renderEventsList();
    });
    grid.appendChild(cell);
  }

  const totalCells = startWd + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let day = 1; day <= remaining; day++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell other-month';
    cell.innerHTML = `<span class="day-num">${day}</span>`;
    grid.appendChild(cell);
  }
}

function eventDateBoxClass(slug) {
  if (slug === 'webinar') return 'online';
  return '';
}
function eventDateBoxStyle(slug) {
  if (slug === 'webinar') return '';
  const color = CATEGORIES[slug]?.color || '#005EF2';
  return `background: ${color};`;
}
function categoryLabel(slug) {
  return CATEGORIES[slug]?.label || slug;
}

function renderEventRow(ev) {
  const d = new Date(ev.event_date);
  const past = isPast(ev);
  const cls = eventDateBoxClass(ev.category_slug);
  const style = eventDateBoxStyle(ev.category_slug);
  const place = (ev.locations?.[0]?.name) || (ev.is_online ? 'Zoom' : '');
  const row = document.createElement('div');
  row.className = 'event-row' + (past ? ' past' : '');
  row.innerHTML = `
    <div class="event-date-box ${cls}" style="${style}">
      <div class="day-big">${d.getDate()}</div>
      <div class="month-small">${MONTHS_SHORT[d.getMonth()]}</div>
    </div>
    <div class="event-meta">
      <span class="event-badge ${ev.is_online ? 'online' : ''}">${escapeHtml(categoryLabel(ev.category_slug))}</span>
      <p class="event-title">${escapeHtml(ev.title)}</p>
      <p class="event-info">${ev.start_time?.slice(0,5) || ''} · ${escapeHtml(place)}${ev.capacity ? ` · ${getRegCount(ev.id)} уч.` : ''}</p>
    </div>
  `;
  row.addEventListener('click', () => openEvent(ev));
  return row;
}

function renderEventsList() {
  const list = document.getElementById('eventsList');
  const title = document.getElementById('listTitle');
  list.innerHTML = '';

  if (selectedDate) {
    const filtered = eventsOn(fmtDateKey(selectedDate));
    title.textContent = `События ${dateToHuman(fmtDateKey(selectedDate))}`;
    if (filtered.length === 0) {
      list.innerHTML = '<p class="loading">Мероприятий нет</p>';
      return;
    }
    filtered.forEach(ev => list.appendChild(renderEventRow(ev)));
    return;
  }

  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  const monthEvents = EVENTS.filter(e => {
    const d = new Date(e.event_date);
    return d.getFullYear()===y && d.getMonth()===m;
  });
  title.textContent = `События Федерации ИЖС в ${MONTHS_GEN[m]} ${y}`;

  const upcoming = monthEvents.filter(e => !isPast(e));
  const past = monthEvents.filter(e => isPast(e));

  if (monthEvents.length === 0) {
    list.innerHTML = '<p class="loading">Мероприятий нет</p>';
    return;
  }

  if (upcoming.length > 0) {
    upcoming.forEach(ev => list.appendChild(renderEventRow(ev)));
  } else if (past.length > 0) {
    const note = document.createElement('p');
    note.className = 'loading';
    note.textContent = 'Предстоящих мероприятий нет';
    list.appendChild(note);
  }

  if (past.length > 0) {
    const toggle = document.createElement('button');
    toggle.className = 'past-toggle';
    toggle.innerHTML = showPastInCalendarList
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>Скрыть прошедшие · ${past.length}`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>Показать прошедшие · ${past.length}`;
    toggle.onclick = () => { showPastInCalendarList = !showPastInCalendarList; renderEventsList(); };
    list.appendChild(toggle);

    if (showPastInCalendarList) {
      past.reverse().forEach(ev => list.appendChild(renderEventRow(ev)));
    }
  }
}

// ===== EVENTS TAB (offline only) =====
function eventCardHtml(ev) {
  const d = new Date(ev.event_date);
  const wd = WEEKDAYS_SHORT[d.getDay()];
  const dateStr = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${wd} · ${ev.start_time?.slice(0,5) || ''}`;
  const placeStr = ev.locations?.[0]?.name || '';
  const totalReg = getRegCount(ev.id);
  const past = isPast(ev);

  return `
    <div class="event-card-large ${past ? 'past' : ''}" onclick="openEventById(${ev.id})">
      <div class="event-card-poster">
        <span class="event-card-poster-badge">${past ? 'Завершено' : escapeHtml(categoryLabel(ev.category_slug))}</span>
        ${ev.image_url ? `<img src="${escapeHtml(ev.image_url)}" alt="">` : ''}
      </div>
      <div class="event-card-body">
        <p class="event-card-title">${escapeHtml(ev.title)}</p>
        <div class="event-card-meta">
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>${dateStr}</span>
          ${placeStr ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(placeStr)}</span>` : ''}
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>${totalReg}</span>
        </div>
      </div>
    </div>
  `;
}

function renderEventsCards() {
  const list = document.getElementById('eventsCardsList');
  const all = EVENTS.filter(e => !e.is_online);
  const upcoming = all.filter(e => !isPast(e));
  const past = all.filter(e => isPast(e));
  document.getElementById('eventsHeaderSub').textContent =
    `${upcoming.length} предстоящих${past.length ? ' · ' + past.length + ' прошедших' : ''}`;

  let html = '';
  if (upcoming.length === 0 && past.length === 0) {
    html = '<p class="loading">Мероприятий пока нет</p>';
  } else {
    if (upcoming.length > 0) {
      html += upcoming.map(eventCardHtml).join('');
    } else {
      html += '<p class="loading">Предстоящих мероприятий нет</p>';
    }
    if (past.length > 0) {
      html += `<button class="past-toggle" onclick="showPastInEvents=!showPastInEvents; renderEventsCards();">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="${showPastInEvents ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/>
        </svg>
        ${showPastInEvents ? 'Скрыть прошедшие' : 'Показать прошедшие'} · ${past.length}
      </button>`;
      if (showPastInEvents) html += past.reverse().map(eventCardHtml).join('');
    }
  }
  list.innerHTML = html;
}

// ===== ONLINE TAB =====
function webinarRowHtml(w) {
  const d = new Date(w.event_date);
  const past = isPast(w);
  return `
    <div class="webinar-row ${past ? 'past' : ''}" onclick="openEventById(${w.id})">
      <div class="webinar-thumb">${getInitials(w.speaker_name || '?')}</div>
      <div style="flex:1; min-width:0;">
        <span class="webinar-time">${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${w.start_time?.slice(0,5) || ''}${past ? ' · ЗАВЕРШЁН' : ''}</span>
        <p class="webinar-name">${escapeHtml(w.speaker_name || '')}</p>
        <p class="webinar-topic">${escapeHtml(w.title)}</p>
        <p class="webinar-role">${escapeHtml(w.speaker_role || '')}</p>
      </div>
    </div>
  `;
}

function renderWebinars() {
  const list = document.getElementById('webinarList');
  const all = EVENTS.filter(e => e.is_online);
  const upcoming = all.filter(e => !isPast(e));
  const past = all.filter(e => isPast(e));
  document.getElementById('onlineHeaderSub').textContent =
    `${upcoming.length} предстоящих${past.length ? ' · ' + past.length + ' прошедших' : ''}`;

  let html = '';
  if (upcoming.length === 0 && past.length === 0) {
    html = '<p class="loading">Вебинаров пока нет</p>';
  } else {
    if (upcoming.length > 0) html += upcoming.map(webinarRowHtml).join('');
    else html += '<p class="loading">Предстоящих вебинаров нет</p>';

    if (past.length > 0) {
      html += `<button class="past-toggle" onclick="showPastInOnline=!showPastInOnline; renderWebinars();">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="${showPastInOnline ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/>
        </svg>
        ${showPastInOnline ? 'Скрыть прошедшие' : 'Показать прошедшие'} · ${past.length}
      </button>`;
      if (showPastInOnline) html += past.reverse().map(webinarRowHtml).join('');
    }
  }
  list.innerHTML = html;
}

// ===== EVENT CARD =====
async function openEvent(ev) {
  currentEvent = ev;
  const cat = CATEGORIES[ev.category_slug];
  const dateLine = dateToHumanCaps(ev.event_date, `${ev.start_time?.slice(0,5) || ''}${ev.end_time ? ' — '+ev.end_time.slice(0,5) : ''}`);
  const past = isPast(ev);

  let html = '';
  if (ev.is_online) {
    html = `
      <div style="background:#f6f7fb; padding:14px;">
        <button class="back-btn dark" onclick="closeEvent()">‹ Назад</button>
      </div>
      <div class="card-body">
        <span class="event-badge online" style="margin-bottom:10px;">${escapeHtml(categoryLabel(ev.category_slug))}${past ? ' · ЗАВЕРШЁН' : ''}</span>
        <p class="event-date-line" style="color:${cat?.color || '#005EF2'}; opacity:1;">${dateLine}</p>
        <p class="event-title-big" style="color:${cat?.color === '#FFFFFF' ? '#005EF2' : (cat?.color || '#005EF2')}; margin-bottom:14px;">${escapeHtml(ev.title)}</p>

        ${ev.speaker_name ? `
          <div class="speaker-card">
            <div class="speaker-avatar">${getInitials(ev.speaker_name)}</div>
            <div>
              <p class="speaker-name">${escapeHtml(ev.speaker_name)}</p>
              <p class="speaker-role">${escapeHtml(ev.speaker_role || '')}</p>
            </div>
          </div>
        ` : ''}

        ${ev.description ? `<p class="event-description">${escapeHtml(ev.description)}</p>` : ''}

        ${past ? `
          <div style="display:flex; align-items:center; gap:8px; padding:12px 14px; background:#f1efe8; border-radius:10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#888;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style="font-size:13px; color:#555; font-weight:500;">Вебинар завершён</span>
          </div>
        ` : `
          ${ev.zoom_url ? `
            <a href="${escapeHtml(ev.zoom_url)}" target="_blank" style="text-decoration:none;">
              <button class="btn-primary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                Подключиться к Zoom
              </button>
            </a>
          ` : ''}
          <button class="btn-secondary" onclick="addToCalendar(${ev.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>
            Добавить в мой календарь
          </button>
        `}

        ${isAdmin ? `<button class="btn-secondary" onclick="editEvent(${ev.id})" style="margin-top:8px;">Редактировать</button>` : ''}
      </div>
    `;
  } else {
    const totalReg = getRegCount(ev.id);
    const isRegistered = MY_REGISTRATIONS.includes(ev.id);
    const heroStyle = ev.image_url
      ? `background-image: url('${escapeHtml(ev.image_url)}');`
      : '';
    const heroClass = ev.image_url ? 'has-image' : '';

    html = `
      <div class="event-hero ${heroClass}" style="${heroStyle}">
        <button class="back-btn" onclick="closeEvent()">‹ Назад</button>
        <span class="cat-pill">${escapeHtml(categoryLabel(ev.category_slug))}</span>
        <div>
          <p class="event-date-line">${dateLine}</p>
          <p class="event-title-big">${escapeHtml(ev.title)}</p>
        </div>
      </div>
      <div class="card-body">
        ${ev.description ? `<p class="event-description">${escapeHtml(ev.description)}</p>` : ''}

        <div class="info-tiles">
          <div class="info-tile">
            <p class="tile-label">Дата · Время</p>
            <p class="tile-value">${dateToHuman(ev.event_date)}</p>
            <p class="tile-value" style="color:#888; font-weight:500; margin-top:2px;">${ev.start_time?.slice(0,5) || ''}${ev.end_time?' — '+ev.end_time.slice(0,5):''}</p>
          </div>
          <div class="info-tile">
            <p class="tile-label">Участников</p>
            <p class="tile-value accent">${totalReg}${ev.capacity ? ' / '+ev.capacity : ''}</p>
          </div>
        </div>

        ${ev.locations?.length ? `
          <p class="section-label" style="margin-top:18px;">Место${ev.locations.length>1?' · '+ev.locations.length:''}</p>
          ${ev.locations.map(loc => loc.name ? `
            <a href="${escapeHtml(loc.mapUrl || '#')}" target="_blank" class="location-link">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span class="location-name">${escapeHtml(loc.name)}</span>
              ${loc.mapUrl ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` : ''}
            </a>
          ` : '').join('')}
        ` : ''}

        ${past ? `
          <div style="display:flex; align-items:center; gap:8px; padding:12px 14px; background:#f1efe8; border-radius:10px; margin-top:16px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#888;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style="font-size:13px; color:#555; font-weight:500;">Мероприятие завершено${isRegistered ? ' · Вы участвовали' : ''}</span>
          </div>
        ` : `
          <button class="btn-primary" onclick="${isRegistered ? 'cancelRegistration()' : 'openModal()'}" style="margin-top:16px;">
            ${isRegistered ? 'Отменить регистрацию' : 'Участвовать'}
          </button>
          <button class="btn-secondary" onclick="addToCalendar(${ev.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>
            Добавить в мой календарь
          </button>
        `}

        ${isAdmin ? `<button class="btn-secondary" onclick="editEvent(${ev.id})" style="margin-top:8px;">Редактировать</button>` : ''}

        <div class="section-divider">
          <p class="section-label">Участники · ${totalReg}</p>
          <div id="participantsList"><p class="loading">Загрузка...</p></div>
        </div>
      </div>
    `;
  }

  document.getElementById('eventDetails').innerHTML = html;
  showScreen('event');

  if (!ev.is_online) {
    await loadParticipants(ev.id);
  }
}

async function loadParticipants(eventId) {
  const { data, error } = await db.from('registrations')
    .select('full_name, company_name, telegram_username, telegram_photo_url')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  const list = document.getElementById('participantsList');
  if (!list) return;
  if (error || !data) { list.innerHTML = '<p class="loading">Не удалось загрузить</p>'; return; }
  if (data.length === 0) { list.innerHTML = '<p class="loading">Пока никто не зарегистрировался</p>'; return; }

  list.innerHTML = data.slice(0, 50).map(p => {
    const initials = getInitials(p.full_name);
    const avatar = p.telegram_photo_url
      ? `<div class="avatar" style="background-image:url('${escapeHtml(p.telegram_photo_url)}');"></div>`
      : `<div class="avatar gradient">${initials}</div>`;
    return `
      <div class="participant-row">
        ${avatar}
        <div class="participant-info">
          <p class="participant-name">${escapeHtml(p.full_name)}</p>
          <p class="participant-company">${escapeHtml(p.company_name || '')}</p>
        </div>
      </div>
    `;
  }).join('');
}

function closeEvent() {
  showScreen(currentTab === 'admin' ? 'admin' : currentTab);
}

// ===== REGISTRATION =====
function openModal() {
  if (!currentEvent) return;
  document.getElementById('modalEventName').textContent = `На «${currentEvent.title}»`;
  document.getElementById('inputFio').value = USER_NAME_FULL;
  document.getElementById('inputCompany').value = '';
  document.getElementById('regModal').classList.add('active');
}

function closeModal() {
  document.getElementById('regModal').classList.remove('active');
}

async function confirmRegistration() {
  if (!currentEvent) return;
  const fio = document.getElementById('inputFio').value.trim();
  const comp = document.getElementById('inputCompany').value.trim();
  if (!fio) { showError('Заполни ФИО'); return; }

  const { error } = await db.from('registrations').insert({
    event_id: currentEvent.id,
    user_id: USER_ID,
    full_name: fio,
    company_name: comp,
    telegram_username: USER_USERNAME,
    telegram_photo_url: USER_PHOTO
  });

  if (error) { showError('Не удалось зарегистрироваться: ' + error.message); return; }
  tg.HapticFeedback?.notificationOccurred('success');
  closeModal();
  showToast('Вы зарегистрированы ✓');
  await loadEvents();
  await loadMyRegistrations();
  await openEvent(EVENTS.find(e => e.id === currentEvent.id));
  renderEventsCards();
  renderProfile();
  renderEventsList();
}

async function cancelRegistration() {
  if (!currentEvent) return;
  const ok = await showConfirm('Точно отменить регистрацию?');
  if (!ok) return;

  const { error } = await db.from('registrations').delete()
    .eq('event_id', currentEvent.id)
    .eq('user_id', USER_ID);

  if (error) { showError('Не удалось отменить: ' + error.message); return; }
  tg.HapticFeedback?.notificationOccurred('success');
  showToast('Регистрация отменена');
  await loadEvents();
  await loadMyRegistrations();
  await openEvent(EVENTS.find(e => e.id === currentEvent.id));
  renderEventsCards();
  renderProfile();
}

// ===== PROFILE =====
function profileEventRow(ev) {
  const d = new Date(ev.event_date);
  const past = isPast(ev);
  const cls = eventDateBoxClass(ev.category_slug);
  const style = eventDateBoxStyle(ev.category_slug);
  return `
    <div class="event-row ${past ? 'past' : ''}">
      <div class="event-date-box ${cls}" style="${style}" onclick="openEventById(${ev.id})">
        <div class="day-big">${d.getDate()}</div>
        <div class="month-small">${MONTHS_SHORT[d.getMonth()]}</div>
      </div>
      <div class="event-meta" onclick="openEventById(${ev.id})">
        <p class="event-title">${escapeHtml(ev.title)}</p>
        <p class="event-info">${escapeHtml(ev.locations?.[0]?.name || (ev.is_online ? 'Zoom' : ''))} · ${ev.start_time?.slice(0,5) || ''}</p>
      </div>
      ${past ? '' : `
        <button class="cal-add-btn" onclick="event.stopPropagation(); addToCalendar(${ev.id});" title="Добавить в календарь">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>
        </button>
      `}
    </div>
  `;
}

function renderProfile() {
  const initials = getInitials(USER_NAME_FULL);
  const avatarEl = document.getElementById('profileAvatar');
  if (USER_PHOTO) {
    avatarEl.style.backgroundImage = `url('${USER_PHOTO}')`;
    avatarEl.textContent = '';
  } else {
    avatarEl.textContent = initials;
  }
  document.getElementById('profileName').textContent = USER_NAME_FULL;
  document.getElementById('profileCompany').textContent = USER_USERNAME ? '@' + USER_USERNAME : '';

  const myEvs = EVENTS.filter(e => MY_REGISTRATIONS.includes(e.id));
  const upcoming = myEvs.filter(e => !isPast(e));
  const past = myEvs.filter(e => isPast(e)).reverse();

  document.getElementById('myRegLabel').textContent = `Предстоящие · ${upcoming.length}`;

  let html = '';
  if (upcoming.length === 0) {
    html += '<p class="loading">Предстоящих регистраций нет</p>';
  } else {
    html += upcoming.map(profileEventRow).join('');
  }
  if (past.length > 0) {
    html += `<p class="section-label" style="margin-top:18px;">История · ${past.length}</p>`;
    html += past.map(profileEventRow).join('');
  }
  document.getElementById('myRegistrations').innerHTML = html;
}

// ===== ADD TO CALENDAR =====
function addToCalendar(eventId) {
  const ev = EVENTS.find(e => e.id === eventId);
  if (!ev) return;
  const start = new Date(`${ev.event_date}T${ev.start_time || '10:00'}`);
  const end = ev.end_time
    ? new Date(`${ev.event_date}T${ev.end_time}`)
    : new Date(start.getTime() + 60*60*1000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  const place = ev.locations?.map(l => l.name).filter(Boolean).join('; ') || (ev.is_online ? ev.zoom_url || '' : '');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Federation IZHS//Calendar//RU
BEGIN:VEVENT
UID:izhs-${ev.id}@federationigs.ru
DTSTAMP:${fmt(new Date())}
DTSTART:${fmt(start)}
DTEND:${fmt(end)}
SUMMARY:${ev.title}
DESCRIPTION:${(ev.description || '').replace(/\n/g, '\\n')}
LOCATION:${place}
END:VEVENT
END:VCALENDAR`;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ev.title.replace(/[^а-яА-Яa-zA-Z0-9]+/g,'-')}.ics`;
  a.click();
  showToast('Файл календаря скачан');
}

// ===== ADMIN =====
function openAdmin() { switchTab('admin'); renderAdminList(); }

function renderAdminList() {
  const list = document.getElementById('adminEventsList');
  const events = [...EVENTS].sort((a,b) => new Date(b.event_date) - new Date(a.event_date));
  if (events.length === 0) {
    list.innerHTML = '<p class="loading">Нет мероприятий</p>';
    return;
  }
  list.innerHTML = events.map(ev => {
    const d = new Date(ev.event_date);
    const reg = getRegCount(ev.id);
    const cls = eventDateBoxClass(ev.category_slug);
    const style = eventDateBoxStyle(ev.category_slug);
    return `
      <div class="admin-event-row" onclick="openEventForm(${ev.id})">
        <div class="event-date-box ${cls}" style="${style} width:42px; height:42px;">
          <div class="day-big" style="font-size:14px;">${d.getDate()}</div>
          <div class="month-small">${MONTHS_SHORT[d.getMonth()]}</div>
        </div>
        <div style="flex:1; min-width:0;">
          <span class="event-badge ${ev.is_online ? 'online' : ''}">${escapeHtml(categoryLabel(ev.category_slug))}</span>
          <p class="event-title">${escapeHtml(ev.title)}</p>
          <p class="event-info">${ev.is_online ? 'Онлайн' : escapeHtml(ev.locations?.[0]?.name || '')} · ${reg} уч.</p>
        </div>
      </div>
    `;
  }).join('');
}

function openEventForm(eventId) {
  editingEventId = eventId;
  formImageDataUrl = null;
  formImageFile = null;
  formLocations = [];

  const catSelect = document.getElementById('formCategory');
  catSelect.innerHTML = Object.keys(CATEGORIES).map(slug =>
    `<option value="${slug}">${escapeHtml(CATEGORIES[slug].label)}</option>`).join('');

  if (eventId) {
    const ev = EVENTS.find(e => e.id === eventId);
    document.getElementById('adminFormTitle').textContent = 'Редактировать';
    document.getElementById('formTitle').value = ev.title;
    document.getElementById('formDate').value = ev.event_date;
    document.getElementById('formTime').value = ev.start_time?.slice(0,5) || '10:00';
    document.getElementById('formEndTime').value = ev.end_time?.slice(0,5) || '12:00';
    document.getElementById('formDescription').value = ev.description || '';
    document.getElementById('formCategory').value = ev.category_slug || 'congress';
    setEventType(ev.is_online);
    if (ev.is_online) {
      document.getElementById('formSpeaker').value = ev.speaker_name || '';
      document.getElementById('formSpeakerRole').value = ev.speaker_role || '';
      document.getElementById('formZoomUrl').value = ev.zoom_url || '';
    } else {
      document.getElementById('formCapacity').value = ev.capacity || 50;
      formLocations = Array.isArray(ev.locations) ? [...ev.locations] : [];
      if (ev.image_url) {
        formImageDataUrl = ev.image_url;
        const img = document.getElementById('uploadPreview');
        img.src = ev.image_url;
        img.classList.remove('hidden');
        document.getElementById('uploadPlaceholder').classList.add('hidden');
      } else {
        document.getElementById('uploadPreview').classList.add('hidden');
        document.getElementById('uploadPlaceholder').classList.remove('hidden');
      }
    }
  } else {
    document.getElementById('adminFormTitle').textContent = 'Новое мероприятие';
    document.getElementById('formTitle').value = '';
    document.getElementById('formDate').value = '';
    document.getElementById('formTime').value = '10:00';
    document.getElementById('formEndTime').value = '12:00';
    document.getElementById('formDescription').value = '';
    document.getElementById('formCapacity').value = 50;
    document.getElementById('formSpeaker').value = '';
    document.getElementById('formSpeakerRole').value = '';
    document.getElementById('formZoomUrl').value = '';
    document.getElementById('uploadPreview').classList.add('hidden');
    document.getElementById('uploadPlaceholder').classList.remove('hidden');
    setEventType(false);
  }

  renderLocationsList();
  showScreen('admin-form');
}

function editEvent(id) {
  closeEvent();
  switchTab('admin');
  setTimeout(() => openEventForm(id), 50);
}

function setEventType(isOnline) {
  formIsOnline = isOnline;
  document.getElementById('formTypeOffline').classList.toggle('active', !isOnline);
  document.getElementById('formTypeOnline').classList.toggle('active', isOnline);
  document.getElementById('formOfflineFields').classList.toggle('hidden', isOnline);
  document.getElementById('formOnlineFields').classList.toggle('hidden', !isOnline);

  if (isOnline) {
    document.getElementById('formCategory').value = 'webinar';
  }
}

function renderLocationsList() {
  const list = document.getElementById('locationsList');
  if (formLocations.length === 0) formLocations.push({ name: '', mapUrl: '' });
  list.innerHTML = formLocations.map((loc, idx) => `
    <div class="location-input-row">
      <div class="loc-fields">
        <input placeholder="Название места" value="${escapeHtml(loc.name || '')}" oninput="formLocations[${idx}].name = this.value">
        <input placeholder="https://yandex.ru/maps/..." value="${escapeHtml(loc.mapUrl || '')}" oninput="formLocations[${idx}].mapUrl = this.value">
      </div>
      ${formLocations.length > 1 ? `
        <button class="remove-loc" onclick="removeLocationField(${idx})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      ` : ''}
    </div>
  `).join('');
}

function addLocationField() { formLocations.push({ name: '', mapUrl: '' }); renderLocationsList(); }
function removeLocationField(idx) { formLocations.splice(idx, 1); renderLocationsList(); }

function closeAdminForm() { switchTab('admin'); }

async function saveAdminEvent() {
  const title = document.getElementById('formTitle').value.trim();
  const date = document.getElementById('formDate').value;
  if (!title || !date) { showError('Заполни название и дату'); return; }

  const saveBtn = document.querySelector('#screen-admin-form .btn-primary');
  saveBtn.disabled = true;
  document.getElementById('saveBtnText').textContent = 'Сохранение...';

  let imageUrl = formImageDataUrl;
  if (formImageFile) {
    document.getElementById('saveBtnText').textContent = 'Загрузка картинки...';
    const ext = formImageFile.name.split('.').pop() || 'jpg';
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(fileName, formImageFile);
    if (upErr) {
      showError('Не удалось загрузить картинку: ' + upErr.message);
      saveBtn.disabled = false;
      document.getElementById('saveBtnText').textContent = 'Сохранить';
      return;
    }
    const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
    imageUrl = urlData.publicUrl;
  }

  const data = {
    title,
    event_date: date,
    start_time: document.getElementById('formTime').value || null,
    end_time: document.getElementById('formEndTime').value || null,
    description: document.getElementById('formDescription').value.trim(),
    category_slug: document.getElementById('formCategory').value,
    is_online: formIsOnline
  };

  if (formIsOnline) {
    data.speaker_name = document.getElementById('formSpeaker').value.trim();
    data.speaker_role = document.getElementById('formSpeakerRole').value.trim();
    data.zoom_url = document.getElementById('formZoomUrl').value.trim();
    data.locations = [];
    data.capacity = null;
    data.image_url = null;
  } else {
    data.capacity = parseInt(document.getElementById('formCapacity').value, 10) || 50;
    data.locations = formLocations.filter(l => l.name && l.name.trim());
    data.image_url = imageUrl;
    data.speaker_name = null;
    data.speaker_role = null;
    data.zoom_url = null;
  }

  let result;
  if (editingEventId) result = await db.from('events').update(data).eq('id', editingEventId);
  else result = await db.from('events').insert(data);

  saveBtn.disabled = false;
  document.getElementById('saveBtnText').textContent = 'Сохранить';

  if (result.error) { showError('Не удалось сохранить: ' + result.error.message); return; }

  showToast('Мероприятие сохранено');
  await loadEvents();
  renderCalendar();
  renderEventsList();
  renderEventsCards();
  renderWebinars();
  renderAdminList();
  switchTab('admin');
}

// ===== CATEGORIES EDITOR =====
function openCategoriesEditor() { switchTab('categories'); renderCategoriesList(); }

function renderCategoriesList() {
  const list = document.getElementById('categoriesList');
  const items = Object.keys(CATEGORIES).map(slug => ({ slug, ...CATEGORIES[slug] }))
    .sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
  list.innerHTML = items.map(c => `
    <div class="cat-row">
      <div class="cat-color-dot" style="background:${c.color};"></div>
      <div class="cat-info">
        <p class="cat-label-name">${escapeHtml(c.label)}</p>
        <p class="cat-slug">${escapeHtml(c.slug)}</p>
      </div>
      <div class="cat-actions">
        <button onclick="openCategoryForm('${c.slug}')" title="Изменить">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="delete" onclick="deleteCategory('${c.slug}')" title="Удалить">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function openCategoryForm(slug) {
  editingCatId = slug;
  if (slug) {
    const c = CATEGORIES[slug];
    document.getElementById('catModalTitle').textContent = 'Редактировать';
    document.getElementById('catName').value = c.label;
    document.getElementById('catSlug').value = slug;
    document.getElementById('catSlug').disabled = true;
    document.getElementById('catColor').value = c.color;
  } else {
    document.getElementById('catModalTitle').textContent = 'Новая категория';
    document.getElementById('catName').value = '';
    document.getElementById('catSlug').value = '';
    document.getElementById('catSlug').disabled = false;
    document.getElementById('catColor').value = '#005EF2';
  }
  document.getElementById('catModal').classList.add('active');
}

function closeCatModal() { document.getElementById('catModal').classList.remove('active'); }

async function saveCategory() {
  const label = document.getElementById('catName').value.trim();
  const slug = document.getElementById('catSlug').value.trim();
  const color = document.getElementById('catColor').value;

  if (!label || !slug) { showError('Заполни название и slug'); return; }

  let result;
  if (editingCatId) {
    result = await db.from('categories').update({ label, color }).eq('slug', editingCatId);
  } else {
    const maxOrder = Math.max(0, ...Object.values(CATEGORIES).map(c => c.sort_order || 0));
    result = await db.from('categories').insert({ slug, label, color, sort_order: maxOrder + 1 });
  }

  if (result.error) { showError('Не удалось сохранить: ' + result.error.message); return; }

  showToast('Категория сохранена');
  closeCatModal();
  await loadCategories();
  renderCategoriesList();
  renderEventsList();
  renderEventsCards();
  renderCalendar();
}

async function deleteCategory(slug) {
  const ok = await showConfirm('Удалить категорию? Мероприятия с ней останутся, но без категории.');
  if (!ok) return;
  const { error } = await db.from('categories').delete().eq('slug', slug);
  if (error) { showError('Не удалось: ' + error.message); return; }
  showToast('Удалено');
  await loadCategories();
  renderCategoriesList();
}

// ===== TABS =====
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  const hideTabbar = (name === 'event' || name === 'admin' || name === 'admin-form' || name === 'categories');
  document.getElementById('tabbar').style.display = hideTabbar ? 'none' : 'grid';
  window.scrollTo(0, 0);
}

function switchTab(tab) {
  if (tab !== 'admin' && tab !== 'admin-form' && tab !== 'categories') {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  }
  showScreen(tab);
  if (tab === 'admin') renderAdminList();
}

function changeMonth(delta) {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth()+delta, 1);
  selectedDate = null;
  renderCalendar();
  renderEventsList();
}

function openEventById(id) {
  const ev = EVENTS.find(e => e.id === id);
  if (ev) openEvent(ev);
}

// ===== LISTENERS =====
function setupEventListeners() {
  document.getElementById('regModal').addEventListener('click', (e) => {
    if (e.target.id === 'regModal') closeModal();
  });
  document.getElementById('catModal').addEventListener('click', (e) => {
    if (e.target.id === 'catModal') closeCatModal();
  });

  document.getElementById('formImageFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showError('Картинка слишком большая. Максимум 5 МБ'); return; }
    formImageFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      formImageDataUrl = ev.target.result;
      const img = document.getElementById('uploadPreview');
      img.src = formImageDataUrl;
      img.classList.remove('hidden');
      document.getElementById('uploadPlaceholder').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  });
}

// ===== START =====
init();
