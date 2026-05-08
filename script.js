// ===== Telegram Web App =====
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ===== Supabase =====
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Пользователь =====
const tgUser = tg.initDataUnsafe?.user;
const USER_ID = tgUser?.id?.toString() || 'guest_' + Date.now();
const USER_NAME = tgUser
  ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim()
  : 'Гость';
const USER_USERNAME = tgUser?.username || null;

// ===== Состояние =====
let events = [];
let currentDate = new Date();
let selectedDate = null;
let isAdmin = false;
let currentEvent = null;
let editingEventId = null;

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_GENITIVE = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

// ===== ИНИЦИАЛИЗАЦИЯ =====
async function init() {
  await checkAdmin();
  await loadEvents();
  renderCalendar();
  renderEventsList();
  setupEventListeners();
}

async function checkAdmin() {
  const { data, error } = await db
    .from('admins')
    .select('user_id')
    .eq('user_id', USER_ID)
    .maybeSingle();

  if (data) {
    isAdmin = true;
    document.getElementById('admin-btn').classList.remove('hidden');
  }
}

async function loadEvents() {
  const { data, error } = await db
    .from('events')
    .select('*')
    .order('date', { ascending: true });

  if (error) {
    console.error('Ошибка загрузки:', error);
    showError('Не удалось загрузить мероприятия');
    return;
  }
  events = data || [];
}

// ===== УТИЛИТЫ =====
function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function formatHumanDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function getEventsForDate(dateStr) {
  return events.filter(e => e.date === dateStr);
}

function showError(msg) {
  tg.showAlert ? tg.showAlert(msg) : alert(msg);
}

function showConfirm(msg) {
  return new Promise(resolve => {
    if (tg.showConfirm) {
      tg.showConfirm(msg, resolve);
    } else {
      resolve(confirm(msg));
    }
  });
}

// ===== КАЛЕНДАРЬ =====
function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  document.getElementById('month-title').textContent = `${MONTHS[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startWeekday = firstDay.getDay() - 1;
  if (startWeekday < 0) startWeekday = 6;

  const daysInMonth = lastDay.getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // Прошлый месяц
  for (let i = startWeekday - 1; i >= 0; i--) {
    grid.appendChild(createDayCell(daysInPrevMonth - i, true, new Date(year, month - 1, daysInPrevMonth - i)));
  }

  // Текущий месяц
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const cell = createDayCell(day, false, date);
    if (isSameDay(date, today)) cell.classList.add('today');

    const dateKey = formatDateKey(date);
    if (getEventsForDate(dateKey).length > 0) {
      cell.classList.add('has-event');
      const dot = document.createElement('div');
      dot.className = 'event-dot';
      cell.appendChild(dot);
    }

    if (selectedDate && isSameDay(date, selectedDate)) cell.classList.add('selected');
    grid.appendChild(cell);
  }

  // Следующий месяц (добиваем сетку)
  const totalCells = startWeekday + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let day = 1; day <= remaining; day++) {
    grid.appendChild(createDayCell(day, true, new Date(year, month + 1, day)));
  }
}

function createDayCell(dayNum, isOtherMonth, date) {
  const cell = document.createElement('div');
  cell.className = 'day-cell';
  if (isOtherMonth) cell.classList.add('other-month');

  const numSpan = document.createElement('span');
  numSpan.textContent = dayNum;
  cell.appendChild(numSpan);

  cell.addEventListener('click', () => {
    if (isOtherMonth) {
      currentDate = new Date(date.getFullYear(), date.getMonth(), 1);
      selectedDate = date;
    } else {
      selectedDate = (selectedDate && isSameDay(selectedDate, date)) ? null : date;
    }
    renderCalendar();
    renderEventsList();
  });
  return cell;
}

// ===== СПИСОК МЕРОПРИЯТИЙ =====
function renderEventsList() {
  const list = document.getElementById('events-list');
  const title = document.getElementById('list-title');
  list.innerHTML = '';

  let filtered;
  if (selectedDate) {
    filtered = getEventsForDate(formatDateKey(selectedDate));
    title.textContent = `Мероприятия ${formatHumanDate(formatDateKey(selectedDate))}`;
  } else {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    filtered = events.filter(e => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    title.textContent = `Мероприятия в ${MONTHS_GENITIVE[month]}`;
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">Мероприятий пока нет</div>';
    return;
  }

  filtered.forEach(event => {
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `
      <img class="event-thumb" src="${event.image || ''}" alt="" onerror="this.style.display='none'">
      <div class="event-meta">
        <div class="event-meta-title">${escapeHtml(event.title)}</div>
        <div class="event-meta-date">${formatHumanDate(event.date)}</div>
      </div>
    `;
    item.addEventListener('click', () => showEventCard(event));
    list.appendChild(item);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ===== КАРТОЧКА СОБЫТИЯ =====
async function showEventCard(event) {
  currentEvent = event;
  document.getElementById('event-image').src = event.image || '';
  document.getElementById('event-title').textContent = event.title;
  document.getElementById('event-date').textContent = formatHumanDate(event.date);
  document.getElementById('event-description').textContent = event.description || '';

  document.getElementById('calendar-view').classList.add('hidden');
  document.getElementById('event-card').classList.remove('hidden');
  window.scrollTo(0, 0);

  tg.BackButton.show();
  tg.BackButton.onClick(hideEventCard);

  // Показываем админ-блок
  if (isAdmin) {
    document.getElementById('admin-stats').classList.remove('hidden');
  } else {
    document.getElementById('admin-stats').classList.add('hidden');
  }

  await refreshEventCard();
}

async function refreshEventCard() {
  if (!currentEvent) return;
  await Promise.all([
    loadParticipants(currentEvent.id),
    loadComments(currentEvent.id),
    updateRegistrationButton(currentEvent.id),
  ]);
}

function hideEventCard() {
  document.getElementById('event-card').classList.add('hidden');
  document.getElementById('calendar-view').classList.remove('hidden');
  tg.BackButton.hide();
  tg.BackButton.offClick(hideEventCard);
  currentEvent = null;
}

document.getElementById('back-btn').addEventListener('click', hideEventCard);

// ===== РЕГИСТРАЦИЯ =====
async function updateRegistrationButton(eventId) {
  const btn = document.getElementById('register-btn');

  const { data: myReg } = await db
    .from('registrations')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', USER_ID)
    .maybeSingle();

  if (myReg) {
    btn.textContent = 'Отменить регистрацию';
    btn.classList.add('cancelled');
    btn.onclick = () => unregister(eventId);
  } else {
    btn.textContent = 'Буду участвовать';
    btn.classList.remove('cancelled');
    btn.onclick = () => register(eventId);
  }
}

async function register(eventId) {
  const { error } = await db
    .from('registrations')
    .insert({
      event_id: eventId,
      user_id: USER_ID,
      user_name: USER_NAME,
      user_username: USER_USERNAME,
    });

  if (error) {
    showError('Не удалось зарегистрироваться');
    return;
  }
  tg.HapticFeedback?.notificationOccurred('success');
  await refreshEventCard();
}

async function unregister(eventId) {
  const ok = await showConfirm('Точно отменить регистрацию?');
  if (!ok) return;

  const { error } = await db
    .from('registrations')
    .delete()
    .eq('event_id', eventId)
    .eq('user_id', USER_ID);

  if (error) {
    showError('Не удалось отменить регистрацию');
    return;
  }
  tg.HapticFeedback?.notificationOccurred('success');
  await refreshEventCard();
}

async function loadParticipants(eventId) {
  const { data, error } = await db
    .from('registrations')
    .select('user_name, user_username')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  const list = document.getElementById('participants-list');
  const counter = document.getElementById('participants-count');

  if (error || !data) {
    list.innerHTML = '<div class="empty-state">Не удалось загрузить</div>';
    return;
  }

  counter.textContent = `(${data.length})`;
  document.getElementById('stat-count').textContent = data.length;

  if (data.length === 0) {
    list.innerHTML = '<div class="empty-state">Пока никто не зарегистрировался</div>';
    return;
  }

  list.innerHTML = '';
  data.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'participant-chip';
    const display = p.user_username
      ? `@${p.user_username}`
      : (p.user_name || 'Гость');
    chip.textContent = display;
    list.appendChild(chip);
  });
}

// ===== КОММЕНТАРИИ =====
async function loadComments(eventId) {
  const { data, error } = await db
    .from('comments')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });

  const list = document.getElementById('comments-list');
  if (error || !data) {
    list.innerHTML = '<div class="empty-state">Не удалось загрузить</div>';
    return;
  }

  if (data.length === 0) {
    list.innerHTML = '<div class="empty-state">Пока нет комментариев</div>';
    return;
  }

  list.innerHTML = '';
  data.forEach(c => {
    const div = document.createElement('div');
    div.className = 'comment';
    div.innerHTML = `
      <div class="comment-author">${escapeHtml(c.user_name || 'Гость')}</div>
      <p class="comment-text">${escapeHtml(c.text)}</p>
      <div class="comment-time">${formatTime(c.created_at)}</div>
    `;
    list.appendChild(div);
  });
}

document.getElementById('comment-submit').addEventListener('click', async () => {
  if (!currentEvent) return;
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;

  const { error } = await db
    .from('comments')
    .insert({
      event_id: currentEvent.id,
      user_id: USER_ID,
      user_name: USER_NAME,
      text: text,
    });

  if (error) {
    showError('Не удалось отправить комментарий');
    return;
  }
  input.value = '';
  await loadComments(currentEvent.id);
});

// ===== НАВИГАЦИЯ ПО МЕСЯЦАМ =====
document.getElementById('prev-month').addEventListener('click', () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  selectedDate = null;
  renderCalendar();
  renderEventsList();
});

document.getElementById('next-month').addEventListener('click', () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  selectedDate = null;
  renderCalendar();
  renderEventsList();
});

// ===== АДМИНКА =====
function setupEventListeners() {
  document.getElementById('admin-btn').addEventListener('click', showAdminView);
  document.getElementById('admin-back-btn').addEventListener('click', hideAdminView);
  document.getElementById('add-event-btn').addEventListener('click', () => showEventForm(null));
  document.getElementById('form-back-btn').addEventListener('click', hideEventForm);
  document.getElementById('save-event-btn').addEventListener('click', saveEvent);
  document.getElementById('edit-event-btn').addEventListener('click', () => {
    if (currentEvent) {
      hideEventCard();
      showEventForm(currentEvent);
    }
  });
  document.getElementById('delete-event-btn').addEventListener('click', deleteCurrentEvent);
}

async function showAdminView() {
  document.getElementById('calendar-view').classList.add('hidden');
  document.getElementById('admin-view').classList.remove('hidden');
  tg.BackButton.show();
  tg.BackButton.onClick(hideAdminView);
  await renderAdminList();
}

function hideAdminView() {
  document.getElementById('admin-view').classList.add('hidden');
  document.getElementById('calendar-view').classList.remove('hidden');
  tg.BackButton.hide();
  tg.BackButton.offClick(hideAdminView);
}

async function renderAdminList() {
  // Получаем счётчики регистраций для каждого события
  const { data: regs } = await db
    .from('registrations')
    .select('event_id');

  const counts = {};
  (regs || []).forEach(r => {
    counts[r.event_id] = (counts[r.event_id] || 0) + 1;
  });

  const list = document.getElementById('admin-events-list');
  list.innerHTML = '';

  if (events.length === 0) {
    list.innerHTML = '<div class="empty-state">Мероприятий пока нет</div>';
    return;
  }

  events.forEach(event => {
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `
      <img class="event-thumb" src="${event.image || ''}" alt="" onerror="this.style.display='none'">
      <div class="event-meta">
        <div class="event-meta-title">${escapeHtml(event.title)}</div>
        <div class="event-meta-date">${formatHumanDate(event.date)}</div>
        <div class="reg-count">👥 ${counts[event.id] || 0} участников</div>
      </div>
    `;
    item.addEventListener('click', () => {
      hideAdminView();
      showEventCard(event);
    });
    list.appendChild(item);
  });
}

// ===== ФОРМА СОЗДАНИЯ/РЕДАКТИРОВАНИЯ =====
function showEventForm(event) {
  editingEventId = event?.id || null;
  document.getElementById('form-title').textContent = event ? 'Редактировать' : 'Новое мероприятие';
  document.getElementById('input-title').value = event?.title || '';
  document.getElementById('input-date').value = event?.date || '';
  document.getElementById('input-image').value = event?.image || '';
  document.getElementById('input-description').value = event?.description || '';

  document.getElementById('calendar-view').classList.add('hidden');
  document.getElementById('admin-view').classList.add('hidden');
  document.getElementById('event-form-view').classList.remove('hidden');
  tg.BackButton.show();
  tg.BackButton.onClick(hideEventForm);
}

function hideEventForm() {
  document.getElementById('event-form-view').classList.add('hidden');
  document.getElementById('admin-view').classList.remove('hidden');
  tg.BackButton.offClick(hideEventForm);
  tg.BackButton.onClick(hideAdminView);
  editingEventId = null;
}

async function saveEvent() {
  const data = {
    title: document.getElementById('input-title').value.trim(),
    date: document.getElementById('input-date').value,
    image: document.getElementById('input-image').value.trim(),
    description: document.getElementById('input-description').value.trim(),
  };

  if (!data.title || !data.date) {
    showError('Укажи название и дату');
    return;
  }

  let result;
  if (editingEventId) {
    result = await db.from('events').update(data).eq('id', editingEventId);
  } else {
    result = await db.from('events').insert(data);
  }

  if (result.error) {
    showError('Не удалось сохранить: ' + result.error.message);
    return;
  }

  await loadEvents();
  hideEventForm();
  await renderAdminList();
  renderCalendar();
  renderEventsList();
}

async function deleteCurrentEvent() {
  if (!currentEvent) return;
  const ok = await showConfirm('Удалить это мероприятие? Все регистрации и комментарии тоже удалятся.');
  if (!ok) return;

  const { error } = await db
    .from('events')
    .delete()
    .eq('id', currentEvent.id);

  if (error) {
    showError('Не удалось удалить');
    return;
  }
  await loadEvents();
  hideEventCard();
  renderCalendar();
  renderEventsList();
}

// ===== СТАРТ =====
init();
