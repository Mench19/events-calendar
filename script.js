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
const WEEKDAYS_LOWER = ['вс','пн','вт','ср','чт','пт','сб'];

// ===== State =====
let CATEGORIES = {};
let EVENTS = [];
let MY_REGISTRATIONS = []; // [{event_id, selected_days}]
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
let formIsMultiday = false;
let formDays = [];
let formExpandedDays = new Set();
let showPastInCalendarList = false;
let showPastInEvents = false;
let showPastInOnline = false;
let showPastDaysInEvent = false;

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

// ===== Многодневные хелперы =====
function isMultiday(ev) {
  return Array.isArray(ev.days) && ev.days.length >= 2;
}

function getEventDays(ev) {
  if (!isMultiday(ev)) {
    return [{
      date: ev.event_date,
      start_time: ev.start_time,
      end_time: ev.end_time,
      description: '',
      locations: ev.locations || [],
      _idx: 0
    }];
  }
  return ev.days
    .map((d, i) => ({ ...d, _idx: i }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function getEventStartDate(ev) {
  return getEventDays(ev)[0]?.date || ev.event_date;
}

function getEventEndDate(ev) {
  const days = getEventDays(ev);
  return days[days.length - 1]?.date || ev.event_date;
}

function getEventEndDateTime(ev) {
  const days = getEventDays(ev);
  const last = days[days.length - 1];
  const endStr = last?.end_time || '23:59';
  return new Date(`${last?.date || ev.event_date}T${endStr}:00`);
}

function getEventStartDateTime(ev) {
  const days = getEventDays(ev);
  const first = days[0];
  const startStr = first?.start_time || '00:00';
  return new Date(`${first?.date || ev.event_date}T${startStr}:00`);
}

function isPast(ev) {
  return getEventEndDateTime(ev) < new Date();
}

function isOngoing(ev) {
  const now = new Date();
  return now >= getEventStartDateTime(ev) && now <= getEventEndDateTime(ev);
}

function getDayStatus(day) {
  if (!day.date) return 'future';
  const now = new Date();
  const dayStart = new Date(`${day.date}T${day.start_time || '00:00'}:00`);
  const dayEnd = new Date(`${day.date}T${day.end_time || '23:59'}:00`);
  if (dayEnd < now) return 'past';
  if (dayStart <= now && now <= dayEnd) return 'ongoing';
  const todayKey = fmtDateKey(new Date());
  if (day.date === todayKey) return 'today';
  return 'future';
}

function getEventStatus(ev) {
  if (isPast(ev)) return 'past';
  if (isOngoing(ev)) return 'ongoing';
  const todayKey = fmtDateKey(new Date());
  const days = getEventDays(ev);
  if (days.some(d => d.date === todayKey)) return 'today';
  return 'future';
}

function eventCoversDate(ev, dateKey) {
  return getEventDays(ev).some(d => d.date === dateKey);
}

function eventsOn(dateKey) {
  return EVENTS.filter(e => eventCoversDate(e, dateKey));
}

function isPastDay(d) {
  const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59);
  return endOfDay < new Date() && !isToday(d);
}

function dateToHuman(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

function eventDateRangeText(ev) {
  const days = getEventDays(ev);
  if (days.length === 1) {
    const d = new Date(days[0].date);
    return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  }
  const first = new Date(days[0].date);
  const last = new Date(days[days.length-1].date);
  if (first.getMonth() === last.getMonth()) {
    return `${first.getDate()} — ${last.getDate()} ${MONTHS_GEN[first.getMonth()]}`;
  }
  return `${first.getDate()} ${MONTHS_GEN[first.getMonth()]} — ${last.getDate()} ${MONTHS_GEN[last.getMonth()]}`;
}

function eventDateRangeWithCount(ev) {
  const days = getEventDays(ev);
  if (days.length === 1) {
    const d = new Date(days[0].date);
    const wd = WEEKDAYS_SHORT[d.getDay()];
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${wd}`;
  }
  return `${eventDateRangeText(ev)} · ${days.length} ${dayWord(days.length)}`;
}

function dayWord(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

function participantWord(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'участник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'участника';
  return 'участников';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
function getInitials(name) {
  return name.split(' ').filter(Boolean).slice(0,2).map(s => s[0]?.toUpperCase() || '').join('') || '?';
}
function getRegCount(eventId) {
  const ev = EVENTS.find(e => e.id === eventId);
  if (!ev) return 0;
  return (ev._regCount || 0) + (ev.external_count || 0);
}
// ===== ЛИМИТ МЕСТ =====
// Возвращает true если у события есть числовой лимит и он заполнен
function isEventFull(ev) {
  if (!ev || !ev.capacity) return false;
  return getRegCount(ev.id) >= ev.capacity;
}
// Универсальный статус регистрации (на будущее расширяем под "регистрация закрыта")
// Возвращает: 'past' | 'full' | 'open'
function getRegistrationState(ev) {
  if (isPast(ev)) return 'past';
  if (isEventFull(ev)) return 'full';
  return 'open';
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

function isRegistered(eventId) {
  return MY_REGISTRATIONS.some(r => r.event_id === eventId);
}
function getMyRegistration(eventId) {
  return MY_REGISTRATIONS.find(r => r.event_id === eventId);
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
  EVENTS.sort((a, b) => getEventStartDate(a).localeCompare(getEventStartDate(b)));
  const { data: regs } = await db.from('registrations').select('event_id');
  const counts = {};
  (regs || []).forEach(r => { counts[r.event_id] = (counts[r.event_id] || 0) + 1; });
  EVENTS.forEach(e => { e._regCount = counts[e.id] || 0; });
}

async function loadMyRegistrations() {
  const { data } = await db.from('registrations').select('event_id, selected_days').eq('user_id', USER_ID);
  MY_REGISTRATIONS = (data || []);
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

function statusBadgeHtml(ev) {
  const status = getEventStatus(ev);
  if (status === 'ongoing') {
    if (isMultiday(ev)) {
      const days = getEventDays(ev);
      const todayKey = fmtDateKey(new Date());
      const idx = days.findIndex(d => d.date === todayKey);
      const num = idx >= 0 ? idx + 1 : 1;
      return `<span class="status-badge ongoing"><span class="pulse-dot"></span>ДЕНЬ ${num} ИДЁТ</span>`;
    }
    return `<span class="status-badge ongoing"><span class="pulse-dot"></span>ИДЁТ СЕЙЧАС</span>`;
  }
  if (status === 'today') {
    return `<span class="status-badge today">СЕГОДНЯ</span>`;
  }
  return '';
}

function statusBadgeSmallHtml(ev) {
  const status = getEventStatus(ev);
  if (status === 'ongoing') {
    return `<span class="status-badge-sm ongoing"><span class="pulse-dot-sm"></span>ИДЁТ</span>`;
  }
  if (status === 'today') {
    return `<span class="status-badge-sm today">СЕГОДНЯ</span>`;
  }
  return '';
}

function renderEventRow(ev) {
  const startDate = getEventStartDate(ev);
  const d = new Date(startDate);
  const past = isPast(ev);
  const cls = eventDateBoxClass(ev.category_slug);
  const style = eventDateBoxStyle(ev.category_slug);
  const days = getEventDays(ev);
  const firstDay = days[0];
  const place = (firstDay?.locations?.[0]?.name) || (ev.locations?.[0]?.name) || (ev.is_online ? 'Zoom' : '');
  const timeStr = firstDay?.start_time?.slice(0,5) || '';

  let infoText = '';
  if (isMultiday(ev)) {
    infoText = `${days.length} ${dayWord(days.length)} · ${escapeHtml(place)}${ev.capacity ? ` · ${getRegCount(ev.id)} уч.` : ''}`;
  } else {
    infoText = `${timeStr} · ${escapeHtml(place)}${ev.capacity ? ` · ${getRegCount(ev.id)} уч.` : ''}`;
  }

  const row = document.createElement('div');
  row.className = 'event-row' + (past ? ' past' : '');
  row.innerHTML = `
    <div class="event-date-box ${cls}" style="${style}">
      <div class="day-big">${d.getDate()}</div>
      <div class="month-small">${MONTHS_SHORT[d.getMonth()]}</div>
    </div>
    <div class="event-meta">
      <div class="event-meta-top">
        <span class="event-badge ${ev.is_online ? 'online' : ''}">${escapeHtml(categoryLabel(ev.category_slug))}</span>
        ${statusBadgeSmallHtml(ev)}
      </div>
      <p class="event-title">${escapeHtml(ev.title)}</p>
      <p class="event-info">${infoText}</p>
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
    return getEventDays(e).some(d => {
      const dt = new Date(d.date);
      return dt.getFullYear()===y && dt.getMonth()===m;
    });
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
  const days = getEventDays(ev);
  const startDate = getEventStartDate(ev);
  const d = new Date(startDate);
  const wd = WEEKDAYS_SHORT[d.getDay()];
  const past = isPast(ev);
  const status = getEventStatus(ev);

  let dateStr;
  if (isMultiday(ev)) {
    dateStr = eventDateRangeWithCount(ev);
  } else {
    const time = days[0]?.start_time?.slice(0,5) || '';
    dateStr = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${wd} · ${time}`;
  }

  const placeStr = (days[0]?.locations?.[0]?.name) || (ev.locations?.[0]?.name) || '';
  const totalReg = getRegCount(ev.id);

  let topBadge = '';
  if (past) {
    topBadge = `<span class="event-card-corner-badge past">Завершено</span>`;
  } else if (status === 'ongoing') {
    if (isMultiday(ev)) {
      const todayKey = fmtDateKey(new Date());
      const idx = days.findIndex(dd => dd.date === todayKey);
      const num = idx >= 0 ? idx + 1 : 1;
      topBadge = `<span class="event-card-corner-badge ongoing"><span class="pulse-dot"></span>ДЕНЬ ${num} ИДЁТ</span>`;
    } else {
      topBadge = `<span class="event-card-corner-badge ongoing"><span class="pulse-dot"></span>ИДЁТ СЕЙЧАС</span>`;
    }
  } else if (status === 'today') {
    topBadge = `<span class="event-card-corner-badge today">СЕГОДНЯ</span>`;
  }

  return `
    <div class="event-card-large ${past ? 'past' : ''}" onclick="openEventById(${ev.id})">
      <div class="event-card-poster">
        <span class="event-card-poster-badge">${escapeHtml(categoryLabel(ev.category_slug))}</span>
        ${topBadge}
        ${ev.seats_limited && !past ? `<span class="event-card-seats-badge"><span class="badge-seats-limited">Мест ограничено</span></span>` : ''}
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
  const startDate = getEventStartDate(w);
  const d = new Date(startDate);
  const time = getEventDays(w)[0]?.start_time?.slice(0,5) || '';
  const past = isPast(w);
  const status = getEventStatus(w);
  let badge = '';
  if (past) badge = ' · ЗАВЕРШЁН';
  else if (status === 'ongoing') badge = ' · ИДЁТ СЕЙЧАС';
  else if (status === 'today') badge = ' · СЕГОДНЯ';
  return `
    <div class="webinar-row ${past ? 'past' : ''}" onclick="openEventById(${w.id})">
      <div class="webinar-thumb">${getInitials(w.speaker_name || '?')}</div>
      <div style="flex:1; min-width:0;">
        <span class="webinar-time">${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${time}${badge}</span>
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
  const past = isPast(ev);
  const days = getEventDays(ev);
  const multi = isMultiday(ev);

  let html = '';

  if (ev.is_online) {
    const d = new Date(getEventStartDate(ev));
    const wd = WEEKDAYS_SHORT[d.getDay()];
    const time = days[0]?.start_time?.slice(0,5) || '';
    const dateLine = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()} · ${wd}${time?` · ${time}`:''}`;

    html = `
      <div class="event-hero online">
        <button class="back-btn" onclick="closeEvent()">‹ Назад</button>
        ${statusBadgeHtml(ev) ? `<div class="event-hero-status">${statusBadgeHtml(ev)}</div>` : ''}
        <span class="cat-pill">Онлайн · ${escapeHtml(categoryLabel(ev.category_slug))}</span>
        <div>
          <p class="event-date-line">${dateLine}</p>
          <p class="event-title-big">${escapeHtml(ev.title)}</p>
        </div>
      </div>
      <div class="card-body">

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
    const userIsRegistered = isRegistered(ev.id);
    const heroStyle = ev.image_url
      ? `background-image: url('${escapeHtml(ev.image_url)}');`
      : '';
    const heroClass = ev.image_url ? 'has-image' : '';
    const dateLine = eventDateRangeWithCount(ev).toUpperCase();

    html = `
      <div class="event-hero ${heroClass}" style="${heroStyle}">
        <button class="back-btn" onclick="closeEvent()">‹ Назад</button>
        ${statusBadgeHtml(ev) ? `<div class="event-hero-status">${statusBadgeHtml(ev)}</div>` : ''}
        ${ev.seats_limited ? `<div class="event-hero-seats-badge"><span class="badge-seats-limited">Мест ограничено</span></div>` : ''}
        <span class="cat-pill">${escapeHtml(categoryLabel(ev.category_slug))}</span>
        <div>
          <p class="event-date-line">${dateLine}</p>
          <p class="event-title-big">${escapeHtml(ev.title)}</p>
        </div>
      </div>
      <div class="card-body">
        ${ev.description ? `<p class="event-description">${escapeHtml(ev.description)}</p>` : ''}

        ${multi ? renderDaysProgram(ev) : `
          <div class="info-tiles">
            <div class="info-tile">
              <p class="tile-label">Дата · Время</p>
              <p class="tile-value">${dateToHuman(getEventStartDate(ev))}</p>
              <p class="tile-value" style="color:#888; font-weight:500; margin-top:2px;">${days[0]?.start_time?.slice(0,5) || ''}${days[0]?.end_time?' — '+days[0].end_time.slice(0,5):''}</p>
            </div>
            <div class="info-tile">
              <p class="tile-label">Участников</p>
              <p class="tile-value accent">${totalReg}${ev.capacity ? ' / '+ev.capacity : ''}</p>
            </div>
          </div>

          ${(days[0]?.locations?.length || ev.locations?.length) ? `
            <p class="section-label" style="margin-top:18px;">Место${(days[0]?.locations?.length || ev.locations?.length) > 1 ? ' · ' + (days[0]?.locations?.length || ev.locations?.length) : ''}</p>
            ${(days[0]?.locations || ev.locations).map(loc => loc.name ? `
              <a href="${escapeHtml(loc.mapUrl || '#')}" target="_blank" class="location-link">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span class="location-name">${escapeHtml(loc.name)}</span>
                ${loc.mapUrl ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` : ''}
              </a>
            ` : '').join('')}
          ` : ''}
        `}

        ${ev.capacity ? `
          <div class="seats-counter ${isEventFull(ev) ? 'is-full' : ''}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Занято ${totalReg} из ${ev.capacity}</span>
          </div>
        ` : ''}

        ${past ? `
          <div style="display:flex; align-items:center; gap:8px; padding:12px 14px; background:#f1efe8; border-radius:10px; margin-top:16px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#888;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style="font-size:13px; color:#555; font-weight:500;">Мероприятие завершено${userIsRegistered ? ' · Вы участвовали' : ''}</span>
          </div>
        ` : `
          ${userIsRegistered ? `
            <button class="btn-primary" onclick="cancelRegistration()" style="margin-top:16px;">
              Отменить регистрацию
            </button>
          ` : (isEventFull(ev) ? `
            <button class="btn-primary is-disabled" disabled style="margin-top:16px;">
              Мест нет
            </button>
          ` : `
            <button class="btn-primary" onclick="openModal()" style="margin-top:16px;">
              Участвовать
            </button>
          `)}
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

function renderDaysProgram(ev) {
  const days = getEventDays(ev);
  const past = isPast(ev);
  const totalReg = getRegCount(ev.id);

  const pastDays = [];
  const currentDays = [];
  const futureDays = [];
  days.forEach((d, i) => {
    const st = getDayStatus(d);
    if (st === 'past') pastDays.push({ ...d, _origIdx: i, _status: st });
    else if (st === 'ongoing' || st === 'today') currentDays.push({ ...d, _origIdx: i, _status: st });
    else futureDays.push({ ...d, _origIdx: i, _status: st });
  });

  if (past) {
    return `
      <div class="info-tiles" style="margin-bottom: 16px;">
        <div class="info-tile">
          <p class="tile-label">Длительность</p>
          <p class="tile-value">${days.length} ${dayWord(days.length)}</p>
          <p class="tile-value" style="color:#888; font-weight:500; margin-top:2px;">${eventDateRangeText(ev)}</p>
        </div>
        <div class="info-tile">
          <p class="tile-label">Участников</p>
          <p class="tile-value accent">${totalReg}${ev.capacity ? ' / '+ev.capacity : ''}</p>
        </div>
      </div>
      <p class="section-label" style="margin-top:18px;">Программа · все дни</p>
      <div class="days-archive">
        ${days.map((d, i) => dayBlockHtml(d, i, 'past', false)).join('')}
      </div>
    `;
  }

  let html = `
    <div class="info-tiles" style="margin-bottom: 16px;">
      <div class="info-tile">
        <p class="tile-label">Длительность</p>
        <p class="tile-value">${days.length} ${dayWord(days.length)}</p>
        <p class="tile-value" style="color:#888; font-weight:500; margin-top:2px;">${eventDateRangeText(ev)}</p>
      </div>
      <div class="info-tile">
        <p class="tile-label">Участников</p>
        <p class="tile-value accent">${totalReg}${ev.capacity ? ' / '+ev.capacity : ''}</p>
      </div>
    </div>
  `;

  if (currentDays.length > 0) {
    html += `<p class="section-label" style="margin-top:18px;">Сейчас</p>`;
    currentDays.forEach(d => {
      html += dayBlockHtml(d, d._origIdx, d._status, true);
    });
  }

  if (futureDays.length > 0) {
    const label = currentDays.length > 0 ? 'Дальше' : 'Программа по дням';
    html += `<p class="section-label" style="margin-top:18px;">${label}</p>`;
    futureDays.forEach(d => {
      html += dayBlockHtml(d, d._origIdx, 'future', false);
    });
  }

  if (pastDays.length > 0) {
    html += `
      <button class="past-days-toggle" onclick="showPastDaysInEvent=!showPastDaysInEvent; openEvent(currentEvent);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="${showPastDaysInEvent ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/>
        </svg>
        ${showPastDaysInEvent ? 'Скрыть прошедшие дни' : 'Прошедшие дни'} · ${pastDays.length}
      </button>
    `;
    if (showPastDaysInEvent) {
      html += `<div class="days-archive">`;
      pastDays.forEach(d => {
        html += dayBlockHtml(d, d._origIdx, 'past', false);
      });
      html += `</div>`;
    }
  }

  return html;
}

function dayBlockHtml(day, idx, status, highlight) {
  const dateObj = day.date ? new Date(day.date) : null;
  const wd = dateObj ? WEEKDAYS_LOWER[dateObj.getDay()] : '';
  const dateStr = dateObj ? `${dateObj.getDate()} ${MONTHS_GEN[dateObj.getMonth()]}` : '';
  const timeStr = `${day.start_time?.slice(0,5) || ''}${day.end_time?'–'+day.end_time.slice(0,5):''}`;
  const locations = day.locations || [];

  let badges = `<span class="day-num-badge">ДЕНЬ ${idx + 1}</span>`;
  if (status === 'ongoing') {
    badges += `<span class="day-status-badge ongoing"><span class="pulse-dot"></span>СЕЙЧАС</span>`;
  } else if (status === 'today') {
    badges += `<span class="day-status-badge today">СЕГОДНЯ</span>`;
  }

  return `
    <div class="day-block ${status} ${highlight ? 'highlight' : ''}">
      <div class="day-block-head">
        <div class="day-block-badges">${badges}</div>
        <div class="day-block-date">${dateStr}${wd?' · '+wd:''}${timeStr?' · '+timeStr:''}</div>
      </div>
      ${day.description ? `<p class="day-block-desc">${escapeHtml(day.description)}</p>` : ''}
      ${locations.length > 0 ? `
        <div class="day-block-locations">
          ${locations.map(loc => loc.name ? `
            <a href="${escapeHtml(loc.mapUrl || '#')}" target="_blank" class="location-link compact">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span class="location-name">${escapeHtml(loc.name)}</span>
              ${loc.mapUrl ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` : ''}
            </a>
          ` : '').join('')}
        </div>
      ` : ''}
    </div>
  `;
}

async function loadParticipants(eventId) {
  const { data, error } = await db.from('registrations')
    .select('full_name, company_name, telegram_username, telegram_photo_url, selected_days')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  const list = document.getElementById('participantsList');
  if (!list) return;
  if (error || !data) { list.innerHTML = '<p class="loading">Не удалось загрузить</p>'; return; }
  if (data.length === 0) { list.innerHTML = '<p class="loading">Пока никто не зарегистрировался</p>'; return; }

  const ev = currentEvent;
  const multi = isMultiday(ev);

  if (multi) {
    const days = getEventDays(ev);
    let html = '';
    days.forEach((day, dayIdx) => {
      const participants = data.filter(p => {
        const sel = p.selected_days;
        if (!Array.isArray(sel) || sel.length === 0) return true;
        return sel.includes(dayIdx);
      });
      const dateObj = new Date(day.date);
      const dateStr = `${dateObj.getDate()} ${MONTHS_GEN[dateObj.getMonth()]}`;
      html += `<div class="participants-day-group">
        <p class="participants-day-label">ДЕНЬ ${dayIdx + 1} · ${dateStr} · ${participants.length} ${participantWord(participants.length)}</p>`;
      if (participants.length === 0) {
        html += `<p class="loading" style="text-align:left; padding:8px 0;">Нет зарегистрированных</p>`;
      } else {
        html += participants.slice(0, 50).map(p => participantRowHtml(p)).join('');
      }
      html += `</div>`;
    });
    list.innerHTML = html;
    return;
  }

  list.innerHTML = data.slice(0, 50).map(p => participantRowHtml(p)).join('');
}

function participantRowHtml(p) {
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

  const daysContainer = document.getElementById('regModalDays');
  if (isMultiday(currentEvent)) {
    const days = getEventDays(currentEvent);
    let daysHtml = '<p class="field-label" style="margin-top:8px;">На какие дни идёшь?</p>';
    days.forEach((day, idx) => {
      const dt = new Date(day.date);
      const wd = WEEKDAYS_LOWER[dt.getDay()];
      const dayPast = getDayStatus(day) === 'past';
      const dateStr = `${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]} · ${wd}${day.start_time?' · '+day.start_time.slice(0,5):''}`;
      daysHtml += `
        <label class="day-checkbox-row ${dayPast ? 'past' : ''}">
          <input type="checkbox" name="regDay" value="${idx}" ${dayPast ? 'disabled' : 'checked'}>
          <span class="day-checkbox-label">
            <span class="day-checkbox-num">ДЕНЬ ${idx + 1}</span>
            <span class="day-checkbox-date">${dateStr}</span>
            ${day.description ? `<span class="day-checkbox-desc">${escapeHtml(day.description)}</span>` : ''}
          </span>
        </label>
      `;
    });
    daysContainer.innerHTML = daysHtml;
    daysContainer.style.display = 'block';
  } else {
    daysContainer.innerHTML = '';
    daysContainer.style.display = 'none';
  }

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

  // Защита от гонки: между открытием модалки и подтверждением кто-то мог занять последнее место
  if (isEventFull(currentEvent)) {
    showError('К сожалению, мест больше нет');
    closeModal();
    await loadEvents();
    await openEvent(EVENTS.find(e => e.id === currentEvent.id));
    return;
  }

  let selectedDays = null;
  if (isMultiday(currentEvent)) {
    const checkboxes = document.querySelectorAll('input[name="regDay"]:checked');
    selectedDays = Array.from(checkboxes).map(c => parseInt(c.value, 10));
    if (selectedDays.length === 0) {
      showError('Выбери хотя бы один день');
      return;
    }
  }

  const { error } = await db.from('registrations').insert({
    event_id: currentEvent.id,
    user_id: USER_ID,
    full_name: fio,
    company_name: comp,
    telegram_username: USER_USERNAME,
    telegram_photo_url: USER_PHOTO,
    selected_days: selectedDays
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
  const startDate = getEventStartDate(ev);
  const d = new Date(startDate);
  const past = isPast(ev);
  const cls = eventDateBoxClass(ev.category_slug);
  const style = eventDateBoxStyle(ev.category_slug);
  const days = getEventDays(ev);
  const place = (days[0]?.locations?.[0]?.name) || (ev.locations?.[0]?.name) || (ev.is_online ? 'Zoom' : '');
  const time = days[0]?.start_time?.slice(0,5) || '';
  const infoText = isMultiday(ev) ? `${escapeHtml(place)} · ${days.length} ${dayWord(days.length)}` : `${escapeHtml(place)} · ${time}`;

  return `
    <div class="event-row ${past ? 'past' : ''}">
      <div class="event-date-box ${cls}" style="${style}" onclick="openEventById(${ev.id})">
        <div class="day-big">${d.getDate()}</div>
        <div class="month-small">${MONTHS_SHORT[d.getMonth()]}</div>
      </div>
      <div class="event-meta" onclick="openEventById(${ev.id})">
        <div class="event-meta-top">
          <p class="event-title" style="margin:0;">${escapeHtml(ev.title)}</p>
          ${statusBadgeSmallHtml(ev)}
        </div>
        <p class="event-info">${infoText}</p>
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

  const myEventIds = MY_REGISTRATIONS.map(r => r.event_id);
  const myEvs = EVENTS.filter(e => myEventIds.includes(e.id));
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
  const days = getEventDays(ev);
  const fmt = (d) => d.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';

  let vevents = '';
  days.forEach((day, idx) => {
    const start = new Date(`${day.date}T${day.start_time || '10:00'}`);
    const end = day.end_time
      ? new Date(`${day.date}T${day.end_time}`)
      : new Date(start.getTime() + 60*60*1000);
    const place = (day.locations || []).map(l => l.name).filter(Boolean).join('; ')
      || (ev.locations || []).map(l => l.name).filter(Boolean).join('; ')
      || (ev.is_online ? ev.zoom_url || '' : '');
    const summary = days.length > 1 ? `${ev.title} (День ${idx+1})` : ev.title;
    const desc = (day.description || ev.description || '').replace(/\n/g, '\\n');
    vevents += `BEGIN:VEVENT
UID:izhs-${ev.id}-${idx}@federationigs.ru
DTSTAMP:${fmt(new Date())}
DTSTART:${fmt(start)}
DTEND:${fmt(end)}
SUMMARY:${summary}
DESCRIPTION:${desc}
LOCATION:${place}
END:VEVENT
`;
  });

  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Federation IZHS//Calendar//RU
${vevents}END:VCALENDAR`;

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
  const events = [...EVENTS].sort((a,b) => getEventStartDate(b).localeCompare(getEventStartDate(a)));
  if (events.length === 0) {
    list.innerHTML = '<p class="loading">Нет мероприятий</p>';
    return;
  }
  list.innerHTML = events.map(ev => {
    const startDate = getEventStartDate(ev);
    const d = new Date(startDate);
    const reg = getRegCount(ev.id);
    const cls = eventDateBoxClass(ev.category_slug);
    const style = eventDateBoxStyle(ev.category_slug);
    const days = getEventDays(ev);
    const place = (days[0]?.locations?.[0]?.name) || (ev.locations?.[0]?.name) || '';
    const placeStr = ev.is_online ? 'Онлайн' : escapeHtml(place);
    const multiInfo = isMultiday(ev) ? ` · ${days.length} ${dayWord(days.length)}` : '';
    return `
      <div class="admin-event-row" onclick="openEventForm(${ev.id})">
        <div class="event-date-box ${cls}" style="${style} width:42px; height:42px;">
          <div class="day-big" style="font-size:14px;">${d.getDate()}</div>
          <div class="month-small">${MONTHS_SHORT[d.getMonth()]}</div>
        </div>
        <div style="flex:1; min-width:0;">
          <span class="event-badge ${ev.is_online ? 'online' : ''}">${escapeHtml(categoryLabel(ev.category_slug))}</span>
          <p class="event-title">${escapeHtml(ev.title)}</p>
          <p class="event-info">${placeStr}${multiInfo} · ${reg} уч.</p>
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
  formIsMultiday = false;
  formDays = [];
  formExpandedDays = new Set();

  const catSelect = document.getElementById('formCategory');
  catSelect.innerHTML = Object.keys(CATEGORIES).map(slug =>
    `<option value="${slug}">${escapeHtml(CATEGORIES[slug].label)}</option>`).join('');

  if (eventId) {
    const ev = EVENTS.find(e => e.id === eventId);
    document.getElementById('adminFormTitle').textContent = 'Редактировать';
    document.getElementById('formTitle').value = ev.title;
    document.getElementById('formDate').value = ev.event_date || '';
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
      document.getElementById('formExternalCount').value = ev.external_count || 0;
      document.getElementById('formSeatsLimited').checked = !!ev.seats_limited;
      document.getElementById('formHasCapacity').checked = !!ev.capacity;
      formLocations = Array.isArray(ev.locations) ? [...ev.locations] : [];

      if (Array.isArray(ev.days) && ev.days.length >= 2) {
        formIsMultiday = true;
        formDays = ev.days.map(d => ({
          date: d.date || '',
          start_time: d.start_time || '10:00',
          end_time: d.end_time || '18:00',
          description: d.description || '',
          locations: Array.isArray(d.locations) ? [...d.locations] : []
        }));
        formDays.forEach((_, i) => { if (i < 5) formExpandedDays.add(i); });
      } else {
        formIsMultiday = false;
        formDays = [];
      }

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
    document.getElementById('formExternalCount').value = 0;
    document.getElementById('formSeatsLimited').checked = false;
    document.getElementById('formHasCapacity').checked = false;
    document.getElementById('formSpeaker').value = '';
    document.getElementById('formSpeakerRole').value = '';
    document.getElementById('formZoomUrl').value = '';
    document.getElementById('uploadPreview').classList.add('hidden');
    document.getElementById('uploadPlaceholder').classList.remove('hidden');
    setEventType(false);
  }

  document.getElementById('formMultidayCheck').checked = formIsMultiday;
  applyMultidayState();
  toggleCapacityFields();
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

// ===== Многодневная форма =====
function toggleMultiday() {
  formIsMultiday = document.getElementById('formMultidayCheck').checked;
  if (formIsMultiday && formDays.length === 0) {
    const baseDate = document.getElementById('formDate').value || '';
    const baseStart = document.getElementById('formTime').value || '10:00';
    const baseEnd = document.getElementById('formEndTime').value || '18:00';
    formDays = [
      { date: baseDate, start_time: baseStart, end_time: baseEnd, description: '', locations: [] },
      { date: addDays(baseDate, 1), start_time: baseStart, end_time: baseEnd, description: '', locations: [] }
    ];
    formExpandedDays = new Set([0, 1]);
  }
  applyMultidayState();
}

// ===== Галочка "Указать лимит мест" =====
function toggleCapacityFields() {
  const checked = document.getElementById('formHasCapacity').checked;
  document.getElementById('capacityFields').classList.toggle('hidden', !checked);
}

function applyMultidayState() {
  const isMulti = formIsMultiday;
  document.getElementById('formSingleDayFields').classList.toggle('hidden', isMulti);
  document.getElementById('formMultidayBlock').classList.toggle('hidden', !isMulti);
  document.getElementById('formSingleLocations').classList.toggle('hidden', isMulti);
  if (isMulti) renderMultidayBlock();
}

function addDays(dateStr, n) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return fmtDateKey(d);
}

function changeDayCount(delta) {
  let target = formDays.length + delta;
  if (target < 2) target = 2;
  if (target > 40) target = 40;
  if (target === formDays.length) return;

  if (target > formDays.length) {
    while (formDays.length < target) {
      const last = formDays[formDays.length - 1];
      const nextDate = last?.date ? addDays(last.date, 1) : '';
      formDays.push({
        date: nextDate,
        start_time: last?.start_time || '10:00',
        end_time: last?.end_time || '18:00',
        description: '',
        locations: []
      });
      if (formDays.length <= 5) formExpandedDays.add(formDays.length - 1);
    }
  } else {
    formDays = formDays.slice(0, target);
    formExpandedDays = new Set([...formExpandedDays].filter(i => i < target));
  }
  renderMultidayBlock();
}

function setDayCount(value) {
  const target = Math.max(2, Math.min(40, parseInt(value, 10) || 2));
  if (target === formDays.length) return;

  if (target > formDays.length) {
    while (formDays.length < target) {
      const last = formDays[formDays.length - 1];
      const nextDate = last?.date ? addDays(last.date, 1) : '';
      formDays.push({
        date: nextDate,
        start_time: last?.start_time || '10:00',
        end_time: last?.end_time || '18:00',
        description: '',
        locations: []
      });
      if (formDays.length <= 5) formExpandedDays.add(formDays.length - 1);
    }
  } else {
    formDays = formDays.slice(0, target);
    formExpandedDays = new Set([...formExpandedDays].filter(i => i < target));
  }
  renderMultidayBlock();
}

function toggleDayBlockExpand(idx) {
  if (formExpandedDays.has(idx)) formExpandedDays.delete(idx);
  else formExpandedDays.add(idx);
  renderMultidayBlock();
}

function toggleAllDaysExpand() {
  const allExpanded = formDays.every((_, i) => formExpandedDays.has(i));
  if (allExpanded) {
    formExpandedDays.clear();
  } else {
    formDays.forEach((_, i) => formExpandedDays.add(i));
  }
  renderMultidayBlock();
}

function renderMultidayBlock() {
  const block = document.getElementById('formMultidayBlock');
  const cnt = formDays.length;

  let daysHtml = '';
  formDays.forEach((day, idx) => {
    const expanded = formExpandedDays.has(idx);
    const dt = day.date ? new Date(day.date) : null;
    const wd = dt ? WEEKDAYS_LOWER[dt.getDay()] : '';
    const summary = dt
      ? `${dt.getDate()}.${String(dt.getMonth()+1).padStart(2,'0')} · ${wd} · ${day.start_time?.slice(0,5)||''}–${day.end_time?.slice(0,5)||''}`
      : 'Дата не указана';

    daysHtml += `
      <div class="form-day-block ${expanded ? 'expanded' : ''}">
        <div class="form-day-head" onclick="toggleDayBlockExpand(${idx})">
          <div class="form-day-head-left">
            <span class="day-num-badge">ДЕНЬ ${idx + 1}</span>
            <span class="form-day-summary">${summary}</span>
          </div>
          <span class="form-day-chevron">${expanded ? '▴' : '▾'}</span>
        </div>
        ${expanded ? `
          <div class="form-day-body">
            <div style="display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 6px;">
              <label class="field">
                <span class="field-label">Дата</span>
                <input class="field-input" type="date" value="${escapeHtml(day.date || '')}" oninput="formDays[${idx}].date = this.value;">
                <input type="hidden" data-day-summary="${idx}">
              </label>
              <label class="field">
                <span class="field-label">Начало</span>
                <input class="field-input" type="time" value="${escapeHtml(day.start_time || '10:00')}" oninput="formDays[${idx}].start_time = this.value;">
              </label>
              <label class="field">
                <span class="field-label">Конец</span>
                <input class="field-input" type="time" value="${escapeHtml(day.end_time || '18:00')}" oninput="formDays[${idx}].end_time = this.value;">
              </label>
            </div>
            <label class="field">
              <span class="field-label">Описание (необязательно)</span>
              <textarea class="field-input" rows="2" oninput="formDays[${idx}].description = this.value" style="resize: vertical;">${escapeHtml(day.description || '')}</textarea>
            </label>
            <label class="field">
              <span class="field-label">Места проведения (необязательно)</span>
              <div id="dayLocations_${idx}">${renderDayLocations(idx)}</div>
              <button class="btn-secondary" onclick="addDayLocation(${idx})" style="margin-top: 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Добавить место
              </button>
            </label>
          </div>
        ` : ''}
      </div>
    `;
  });

  const allExpanded = formDays.every((_, i) => formExpandedDays.has(i));

  block.innerHTML = `
    <div class="multiday-header">
      <span class="field-label">Количество дней</span>
      <div class="day-counter">
        <button class="day-counter-btn" onclick="changeDayCount(-1)" ${cnt <= 2 ? 'disabled' : ''}>−</button>
        <input class="day-counter-input" type="number" min="2" max="40" value="${cnt}" onchange="setDayCount(this.value)">
        <button class="day-counter-btn" onclick="changeDayCount(1)" ${cnt >= 40 ? 'disabled' : ''}>+</button>
      </div>
      <span class="day-counter-hint">от 2 до 40</span>
    </div>

    <div class="multiday-section-head">
      <span class="multiday-section-title">СОБЫТИЕ ПО ДНЯМ · ${cnt}</span>
      <button class="multiday-toggle-all" onclick="toggleAllDaysExpand()">${allExpanded ? 'Свернуть всё' : 'Развернуть всё'}</button>
    </div>

    <div class="form-days-list">
      ${daysHtml}
    </div>
  `;
}

function renderDayLocations(dayIdx) {
  const day = formDays[dayIdx];
  if (!day.locations || day.locations.length === 0) {
    day.locations = [{ name: '', mapUrl: '' }];
  }
  return day.locations.map((loc, locIdx) => `
    <div class="location-input-row">
      <div class="loc-fields">
        <input placeholder="Название места" value="${escapeHtml(loc.name || '')}" oninput="formDays[${dayIdx}].locations[${locIdx}].name = this.value">
        <input placeholder="https://yandex.ru/maps/..." value="${escapeHtml(loc.mapUrl || '')}" oninput="formDays[${dayIdx}].locations[${locIdx}].mapUrl = this.value">
      </div>
      ${day.locations.length > 1 ? `
        <button class="remove-loc" onclick="removeDayLocation(${dayIdx}, ${locIdx})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      ` : ''}
    </div>
  `).join('');
}

function addDayLocation(dayIdx) {
  if (!formDays[dayIdx].locations) formDays[dayIdx].locations = [];
  formDays[dayIdx].locations.push({ name: '', mapUrl: '' });
  document.getElementById(`dayLocations_${dayIdx}`).innerHTML = renderDayLocations(dayIdx);
}

function removeDayLocation(dayIdx, locIdx) {
  formDays[dayIdx].locations.splice(locIdx, 1);
  document.getElementById(`dayLocations_${dayIdx}`).innerHTML = renderDayLocations(dayIdx);
}

function closeAdminForm() { switchTab('admin'); }

async function saveAdminEvent() {
  const title = document.getElementById('formTitle').value.trim();
  if (!title) { showError('Заполни название'); return; }

  if (!formIsMultiday || formIsOnline) {
    const date = document.getElementById('formDate').value;
    if (!date) { showError('Заполни дату'); return; }
  } else {
    if (formDays.length < 2) { showError('Минимум 2 дня для многодневки'); return; }
    for (let i = 0; i < formDays.length; i++) {
      if (!formDays[i].date) { showError(`Заполни дату Дня ${i+1}`); return; }
    }
  }

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
    description: document.getElementById('formDescription').value.trim(),
    category_slug: document.getElementById('formCategory').value,
    is_online: formIsOnline
  };

  if (formIsOnline) {
    data.event_date = document.getElementById('formDate').value;
    data.start_time = document.getElementById('formTime').value || null;
    data.end_time = document.getElementById('formEndTime').value || null;
    data.speaker_name = document.getElementById('formSpeaker').value.trim();
    data.speaker_role = document.getElementById('formSpeakerRole').value.trim();
    data.zoom_url = document.getElementById('formZoomUrl').value.trim();
    data.locations = [];
    data.capacity = null;
    data.external_count = 0;
    data.seats_limited = false;
    data.image_url = null;
    data.days = null;
  } else {
    // Плашка "места ограничены" — независимая галочка
    data.seats_limited = document.getElementById('formSeatsLimited').checked;
    // Числовой лимит — только если включена вторая галочка
    if (document.getElementById('formHasCapacity').checked) {
      data.capacity = parseInt(document.getElementById('formCapacity').value, 10) || 50;
      data.external_count = parseInt(document.getElementById('formExternalCount').value, 10) || 0;
    } else {
      data.capacity = null;
      data.external_count = 0;
    }
    data.image_url = imageUrl;
    data.speaker_name = null;
    data.speaker_role = null;
    data.zoom_url = null;

    if (formIsMultiday) {
      const cleanDays = formDays.map(d => ({
        date: d.date,
        start_time: d.start_time || null,
        end_time: d.end_time || null,
        description: (d.description || '').trim(),
        locations: (d.locations || []).filter(l => l.name && l.name.trim())
      }));
      cleanDays.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      data.days = cleanDays;
      data.event_date = cleanDays[0]?.date;
      data.start_time = cleanDays[0]?.start_time;
      data.end_time = cleanDays[cleanDays.length-1]?.end_time;
      data.locations = [];
    } else {
      data.event_date = document.getElementById('formDate').value;
      data.start_time = document.getElementById('formTime').value || null;
      data.end_time = document.getElementById('formEndTime').value || null;
      data.locations = formLocations.filter(l => l.name && l.name.trim());
      data.days = null;
    }
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

// Перерисовка статусов «ИДЁТ СЕЙЧАС / СЕГОДНЯ» каждые 60 секунд
setInterval(() => {
  if (currentTab === 'calendar') { renderCalendar(); renderEventsList(); }
  else if (currentTab === 'events') renderEventsCards();
  else if (currentTab === 'online') renderWebinars();
  else if (currentTab === 'profile') renderProfile();
}, 60000);
