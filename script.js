/* ====================================================================
   NeuroDraw — логика приложения
   Разделы:
     1. Состояние приложения
     2. Утилиты
     3. Платформы, режимы ввода, общий розыгрыш по нескольким платформам
     4. Фильтрация и загрузка участников (список)
     5. YouTube — реальный сбор комментаторов (Cloudflare Worker)
     6. Twitch — реальный сбор из чата во время эфира (анонимный IRC)
     7. Telegram — реальный сбор из чата группы (Worker + вебхук + KV)
     8. Барабан рулетки (анимация прокрутки, настраиваемое время)
     9. Модальное окно победителя (кликабельный ник)
     10. Режим "Заданный победитель" (Shift + F8 → отдельная admin.html)
     11. Мобильное меню, общая инициализация
   ==================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------
     1. СОСТОЯНИЕ ПРИЛОЖЕНИЯ
     ------------------------------------------------------------------ */

  const state = {
    platform: 'youtube',           // текущая выбранная платформа (для одиночного режима)
    inputMode: 'list',             // 'list' | 'link'
    combinedMode: false,           // общий розыгрыш сразу среди нескольких платформ
    participants: [],              // [{ name, url, platform }]
    isSpinning: false,
    wheelRotation: 0,
    forceWinner: { enabled: false, nickname: '' }
  };

  // Адрес Cloudflare Worker'а — реальный бэкенд для YouTube и Telegram.
  const API_BASE_URL = 'https://neurodraw-api.webtkachdenis.workers.dev';
  const TELEGRAM_POLL_INTERVAL_MS = 2000;

  const PLATFORM_LABELS = {
    youtube: 'YouTube',
    twitch: 'Twitch',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    telegram: 'Telegram'
  };

  const PLATFORM_ICONS = {
    youtube: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M21.6 7.2c-.25-1-1-1.75-2-2C17.9 4.7 12 4.7 12 4.7s-5.9 0-7.6.5c-1 .25-1.75 1-2 2C2 8.9 2 12 2 12s0 3.1.4 4.8c.25 1 1 1.75 2 2 1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5c1-.25 1.75-1 2-2 .4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8z" fill="currentColor"/><path d="M10 15.2V8.8L15.8 12 10 15.2z" fill="#fff"/></svg>',
    twitch: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.5 2.5 3 6.5v13h5v2.5l3-2.5h4L20.5 14V2.5h-16z" fill="currentColor"/><rect x="9.5" y="7" width="1.6" height="5.2" fill="#fff"/><rect x="14" y="7" width="1.6" height="5.2" fill="#fff"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16.6 2h-3.3v13.6a2.7 2.7 0 1 1-2.3-2.7v-3.3a6 6 0 1 0 5.6 6V8.4c1.1.8 2.4 1.3 3.9 1.3V6.4c-2.1 0-3.9-1.8-3.9-4.4z" fill="currentColor"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2.5 11.3 20.8 4c.9-.35 1.7.2 1.4 1.55l-2.95 13.9c-.2.95-.8 1.2-1.6.75l-4.4-3.25-2.15 2.05c-.25.25-.45.45-.9.45l.3-4.5L18.5 7.3c.35-.3-.1-.5-.5-.2L8.3 13.15l-4.35-1.35c-.95-.3-.95-.95.2-1.5z" fill="currentColor"/></svg>'
  };

  /* ------------------------------------------------------------------
     2. УТИЛИТЫ
     ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  function showToast(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.classList.add('is-visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickRandom(arr) {
    return arr[randomInt(0, arr.length - 1)];
  }

  function initialOf(name) {
    const trimmed = (name || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ------------------------------------------------------------------
     2b. ЗВУК — настоящий синтез через Web Audio API, без внешних
     аудиофайлов (не требует хостинга/лицензий). Переключатель и выбор
     пользователя сохраняются в localStorage.
     ------------------------------------------------------------------ */

  let audioCtx = null;
  let soundMuted = localStorage.getItem('neurodraw_sound_muted') === '1';

  function getAudioCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playTone(freq, startOffset, duration, type, peakGain) {
    if (soundMuted) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peakGain ?? 0.18, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function playStopTick() {
    playTone(440, 0, 0.12, 'triangle', 0.15);
  }

  function playWinnerChime() {
    playTone(523.25, 0, 0.18, 'sine', 0.2);   // C5
    playTone(659.25, 0.12, 0.18, 'sine', 0.2); // E5
    playTone(783.99, 0.24, 0.32, 'sine', 0.22); // G5
  }

  function updateSoundToggleUI() {
    const btn = $('soundToggleBtn');
    btn.setAttribute('aria-pressed', String(!soundMuted));
    btn.setAttribute('aria-label', soundMuted ? 'Включить звук' : 'Выключить звук');
    btn.classList.toggle('is-muted', soundMuted);
  }

  function initSoundToggle() {
    updateSoundToggleUI();
    $('soundToggleBtn').addEventListener('click', () => {
      soundMuted = !soundMuted;
      localStorage.setItem('neurodraw_sound_muted', soundMuted ? '1' : '0');
      updateSoundToggleUI();
      if (!soundMuted) getAudioCtx(); // разблокируем контекст по пользовательскому жесту
    });
  }

  /* ------------------------------------------------------------------
     3. ПЛАТФОРМЫ, РЕЖИМЫ ВВОДА, ОБЩИЙ РОЗЫГРЫШ
     ------------------------------------------------------------------ */

  function initPlatformTabs() {
    const tabs = document.querySelectorAll('.platform-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        // Переключение платформы на середине активного сбора — отменяем его без применения
        if (twitchSocket) cancelTwitchCollection();
        if (telegramChatId) cancelTelegramCollection();

        tabs.forEach((t) => {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');

        state.platform = tab.dataset.platform;
        updatePlatformIndicator();
        updateLinkModeHint();
      });
    });
  }

  function setPlatformColorClass(el, platform) {
    Object.keys(PLATFORM_LABELS).forEach((pf) => el.classList.remove(`is-${pf}`));
    el.classList.add(`is-${platform}`);
  }

  function updatePlatformIndicator() {
    const indicator = $('activePlatformIndicator');
    const label = $('activePlatformLabel');
    const svg = indicator.querySelector('svg');
    if (svg) svg.remove();
    indicator.insertAdjacentHTML('afterbegin', PLATFORM_ICONS[state.platform]);
    label.textContent = PLATFORM_LABELS[state.platform];
    setPlatformColorClass(indicator, state.platform);
  }

  function initInputModeSwitch() {
    const modeTabs = document.querySelectorAll('.mode-tab');
    modeTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (twitchSocket) cancelTwitchCollection();
        if (telegramChatId) cancelTelegramCollection();

        modeTabs.forEach((t) => {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');

        state.inputMode = tab.dataset.mode;
        $('modeList').classList.toggle('is-hidden', state.inputMode !== 'list');
        $('modeLink').classList.toggle('is-hidden', state.inputMode !== 'link');
      });
    });
  }

  function updateLinkModeHint() {
    const label = $('sourceUrlLabel');
    const input = $('sourceUrlInput');
    const note = $('sourceUrlNote');
    const btnLabel = $('loadParticipantsBtn').querySelector('.btn-load-label');

    if (state.platform === 'youtube') {
      label.textContent = 'Ссылка на видео, пост или стрим';
      input.type = 'url';
      input.placeholder = 'https://www.youtube.com/watch?v=...';
      note.textContent = 'Автосбор реально работает: подставляются настоящие авторы комментариев под указанным видео.';
      btnLabel.textContent = 'Загрузить участников';
    } else if (state.platform === 'twitch') {
      label.textContent = 'Имя канала Twitch или ссылка на стрим';
      input.type = 'text';
      input.placeholder = 'twitch.tv/канал или просто имя канала';
      note.textContent = 'Канал должен быть в эфире. Нажмите «Начать сбор из чата» — сайт анонимно подключится к чату '
        + 'и будет собирать ники написавших, пока вы не нажмёте «Остановить и применить».';
      btnLabel.textContent = 'Начать сбор из чата';
    } else if (state.platform === 'telegram') {
      label.textContent = 'Юзернейм, ссылка или ID группы Telegram';
      input.type = 'text';
      input.placeholder = '@group или t.me/group';
      note.textContent = 'Бот должен быть добавлен в группу. Нажмите «Начать сбор» — бот будет слушать сообщения '
        + 'и собирать ники написавших, пока вы не нажмёте «Остановить и применить».';
      btnLabel.textContent = 'Начать сбор из группы';
    } else {
      label.textContent = 'Ссылка на видео, пост или стрим';
      input.type = 'url';
      input.placeholder = 'https://...';
      note.textContent = 'Для этой платформы автосбор по ссылке пока не реализован — вставьте участников вручную '
        + 'во вкладке «Список ников».';
      btnLabel.textContent = 'Загрузить участников';
    }
  }

  function initCombinedModeToggle() {
    $('combinedModeToggle').addEventListener('change', (e) => {
      state.combinedMode = e.target.checked;
      $('combinedBreakdown').hidden = !state.combinedMode || state.participants.length === 0;
      if (!state.combinedMode) {
        // Выключили общий режим — очищаем смешанный пул, чтобы не разыгрывать случайно несколько платформ сразу
        state.participants = [];
        renderWheelPlaceholder('Загрузите участников, чтобы начать');
        $('participantsCounter').textContent = 'Участников не загружено';
        $('participantsCounter').classList.remove('has-count');
        $('spinBtn').disabled = true;
        updateParticipantsTools();
      }
      renderCombinedBreakdown();
    });
  }

  function renderCombinedBreakdown() {
    const el = $('combinedBreakdown');
    if (!state.combinedMode || state.participants.length === 0) {
      el.hidden = true;
      return;
    }
    const counts = {};
    state.participants.forEach((p) => {
      counts[p.platform] = (counts[p.platform] || 0) + 1;
    });
    el.innerHTML = Object.keys(counts)
      .map((pf) => `<span class="combined-badge">${PLATFORM_LABELS[pf] || pf}: ${counts[pf]}</span>`)
      .join('') + `<span class="combined-badge">Всего: ${state.participants.length}</span>`;
    el.hidden = false;
  }

  function initKeywordFilterToggle() {
    const checkbox = $('filterKeywordEnabled');
    const input = $('filterKeywordInput');
    checkbox.addEventListener('change', () => {
      input.disabled = !checkbox.checked;
      input.classList.toggle('is-disabled', !checkbox.checked);
      if (checkbox.checked) input.focus();
    });
  }

  function currentFilterOptions() {
    return {
      excludeDuplicates: $('filterDuplicates').checked,
      keywordEnabled: $('filterKeywordEnabled').checked,
      keyword: $('filterKeywordInput').value
    };
  }

  /* ------------------------------------------------------------------
     4. ЗАГРУЗКА УЧАСТНИКОВ — РУЧНОЙ СПИСОК
     ------------------------------------------------------------------ */

  function parseParticipantNames(rawText, options) {
    let lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    if (options.keywordEnabled && options.keyword) {
      const kw = options.keyword.trim().toLowerCase();
      if (kw) lines = lines.filter((l) => l.toLowerCase().includes(kw));
    }

    if (options.excludeDuplicates) {
      const seen = new Set();
      const unique = [];
      for (const line of lines) {
        const key = line.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(line);
        }
      }
      lines = unique;
    }

    return lines;
  }

  /**
   * Применяет итог загрузки (ручной список или автосбор) к общему состоянию:
   * в обычном режиме — заменяет пул; во "общем розыгрыше" — добавляет к нему,
   * исключая повторы одного и того же ника с одной и той же платформы.
   */
  function applyLoadedParticipants(items) {
    const btn = $('loadParticipantsBtn');
    const counter = $('participantsCounter');

    btn.classList.remove('is-loading');
    btn.disabled = false;

    if (items.length === 0 && !state.combinedMode) {
      counter.textContent = 'Участников не найдено — проверьте фильтры';
      counter.classList.remove('has-count');
      $('spinBtn').disabled = true;
      renderWheelPlaceholder('Участники не найдены');
      updateParticipantsTools();
      return;
    }

    if (state.combinedMode) {
      const existingKeys = new Set(state.participants.map((p) => `${p.platform}:${p.name.toLowerCase()}`));
      const added = items.filter((p) => !existingKeys.has(`${p.platform}:${p.name.toLowerCase()}`));
      state.participants = state.participants.concat(added);
      showToast(`Добавлено с ${PLATFORM_LABELS[state.platform]}: ${added.length} (всего в пуле: ${state.participants.length})`);
    } else {
      state.participants = items;
      showToast(`Готово! Найдено участников: ${items.length}`);
    }

    renderCombinedBreakdown();

    if (state.participants.length === 0) {
      counter.textContent = 'Участников не загружено';
      counter.classList.remove('has-count');
      $('spinBtn').disabled = true;
      renderWheelPlaceholder('Загрузите участников, чтобы начать');
      updateParticipantsTools();
      return;
    }

    counter.textContent = `Загружено участников: ${state.participants.length}`;
    counter.classList.add('has-count');
    $('spinBtn').disabled = false;
    renderWheelIdle();
    updateParticipantsTools();
  }

  /* ------------------------------------------------------------------
     ПРЕДПРОСМОТР СПИСКА УЧАСТНИКОВ + ЭКСПОРТ CSV
     ------------------------------------------------------------------ */

  function updateParticipantsTools() {
    $('participantsTools').hidden = state.participants.length === 0;
    if (state.participants.length === 0) {
      $('participantsPreview').hidden = true;
      $('togglePreviewBtn').textContent = 'Показать список участников';
      $('togglePreviewBtn').setAttribute('aria-expanded', 'false');
    } else if (!$('participantsPreview').hidden) {
      renderParticipantsPreview();
    }
  }

  function renderParticipantsPreview() {
    const list = $('participantsPreview');
    list.innerHTML = state.participants
      .map((p) => `<li>${escapeHtml(p.name)}${state.combinedMode ? ` · ${escapeHtml(PLATFORM_LABELS[p.platform] || p.platform)}` : ''}</li>`)
      .join('');
  }

  function initParticipantsTools() {
    $('togglePreviewBtn').addEventListener('click', () => {
      const preview = $('participantsPreview');
      const isHidden = preview.hidden;
      preview.hidden = !isHidden;
      $('togglePreviewBtn').setAttribute('aria-expanded', String(isHidden));
      $('togglePreviewBtn').textContent = isHidden ? 'Скрыть список участников' : 'Показать список участников';
      if (isHidden) renderParticipantsPreview();
    });

    $('exportParticipantsBtn').addEventListener('click', () => {
      downloadCsv('neurodraw-participants.csv', ['Имя', 'Платформа', 'Ссылка'],
        state.participants.map((p) => [p.name, PLATFORM_LABELS[p.platform] || p.platform, p.url || '']));
    });
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function downloadCsv(filename, headers, rows) {
    const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(';'));
    const csv = '\uFEFF' + lines.join('\r\n'); // BOM — чтобы Excel корректно показал кириллицу
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleManualListLoad() {
    const btn = $('loadParticipantsBtn');
    const rawText = $('participantsInput').value;

    if (!rawText.trim()) {
      showToast('Добавьте хотя бы одного участника', true);
      return;
    }

    btn.classList.add('is-loading');
    btn.disabled = true;

    setTimeout(() => {
      const names = parseParticipantNames(rawText, currentFilterOptions());
      // Ручной список: у нас нет настоящей ссылки на профиль — честно не делаем её кликабельной
      const items = names.map((name) => ({ name, url: null, platform: state.platform }));
      applyLoadedParticipants(items);
    }, 350);
  }

  /* ------------------------------------------------------------------
     5. YOUTUBE — реальный сбор комментаторов через Cloudflare Worker
     ------------------------------------------------------------------ */

  function loadParticipantsFromYoutubeLink(url) {
    const btn = $('loadParticipantsBtn');
    btn.classList.add('is-loading');
    btn.disabled = true;

    fetch(`${API_BASE_URL}/youtube?url=${encodeURIComponent(url)}`)
      .then((res) => res.json())
      .then((data) => {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        if (!data.success) {
          showToast(data.error || 'Не удалось собрать участников по ссылке', true);
          return;
        }
        const items = data.participants.map((p) => ({
          name: typeof p === 'string' ? p : p.name,
          url: typeof p === 'string' ? null : (p.url || null),
          platform: 'youtube'
        }));
        applyLoadedParticipants(items);
      })
      .catch(() => {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        showToast('Не удалось связаться с сервером сбора участников. Проверьте соединение и попробуйте ещё раз.', true);
      });
  }

  /* ------------------------------------------------------------------
     6. TWITCH — сбор ников прямо из чата во время эфира.
     Анонимное read-only подключение к Twitch IRC (логин вида
     justinfanXXXXX) — официально поддерживаемый Twitch способ читать
     публичный чат без OAuth. Никаких списков заранее, только реально
     написавшие.
     ------------------------------------------------------------------ */

  const TWITCH_WS_URL = 'wss://irc-ws.chat.twitch.tv:443';
  const TWITCH_MAX_COLLECT_MS = 15 * 60 * 1000;

  let twitchSocket = null;
  let twitchCollected = null; // Map<логин, displayName>
  let twitchAutoStopTimer = null;

  function extractTwitchChannel(raw) {
    const value = raw.trim();
    if (!value) return null;
    if (/^[a-zA-Z0-9_]{3,25}$/.test(value)) return value.toLowerCase();
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      const host = url.hostname.replace(/^www\./, '');
      if (host === 'twitch.tv' || host === 'm.twitch.tv') {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length) return parts[0].toLowerCase();
      }
    } catch { /* не ссылка */ }
    return null;
  }

  function stopTwitchCollection() {
    if (twitchAutoStopTimer) {
      clearTimeout(twitchAutoStopTimer);
      twitchAutoStopTimer = null;
    }
    if (twitchSocket) {
      const socket = twitchSocket;
      twitchSocket = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    }
  }

  function resetLoadButton(defaultLabel) {
    const btn = $('loadParticipantsBtn');
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.querySelector('.btn-load-label').textContent = defaultLabel;
  }

  function cancelTwitchCollection() {
    stopTwitchCollection();
    twitchCollected = null;
    resetLoadButton('Начать сбор из чата');
    const counter = $('participantsCounter');
    counter.textContent = state.participants.length
      ? `Загружено участников: ${state.participants.length}`
      : 'Участников не загружено';
  }

  function finishTwitchCollection() {
    const channel = twitchCollected;
    stopTwitchCollection();
    const names = channel ? Array.from(channel.entries()) : [];
    twitchCollected = null;
    resetLoadButton('Начать сбор из чата');

    if (names.length === 0) {
      showToast('За время сбора в чате не появилось ни одного сообщения', true);
      return;
    }
    const items = names.map(([login, displayName]) => ({
      name: displayName,
      url: `https://www.twitch.tv/${login}`,
      platform: 'twitch'
    }));
    applyLoadedParticipants(items);
  }

  function startTwitchCollection(channel) {
    const btn = $('loadParticipantsBtn');
    const counter = $('participantsCounter');
    twitchCollected = new Map();

    const socket = new WebSocket(TWITCH_WS_URL);
    twitchSocket = socket;

    socket.onopen = () => {
      const anonNick = `justinfan${Math.floor(10000 + Math.random() * 80000)}`;
      socket.send('PASS SCHMOOPIIE');
      socket.send(`NICK ${anonNick}`);
      socket.send('CAP REQ :twitch.tv/tags');
      socket.send(`JOIN #${channel}`);
    };

    socket.onmessage = (event) => {
      if (twitchSocket !== socket) return;
      const lines = String(event.data).split('\r\n').filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('PING')) { socket.send('PONG :tmi.twitch.tv'); continue; }
        if (!line.includes('PRIVMSG')) continue;

        let tagsPart = '';
        let rest = line;
        if (line.startsWith('@')) {
          const spaceIdx = line.indexOf(' ');
          tagsPart = line.slice(1, spaceIdx);
          rest = line.slice(spaceIdx + 1);
        }
        const prefixMatch = rest.match(/^:([^!]+)!/);
        if (!prefixMatch) continue;
        const loginName = prefixMatch[1].toLowerCase();

        let displayName = loginName;
        if (tagsPart) {
          const dnMatch = tagsPart.match(/display-name=([^;]*)/);
          if (dnMatch && dnMatch[1]) displayName = dnMatch[1];
        }

        if (!twitchCollected.has(loginName)) {
          twitchCollected.set(loginName, displayName);
          counter.textContent = `Собираю из чата: ${twitchCollected.size} чел. — нажмите «Остановить и применить», когда будете готовы`;
          counter.classList.add('has-count');
        }
      }
    };

    socket.onerror = () => {
      if (twitchSocket !== socket) return;
      showToast('Не удалось подключиться к чату Twitch. Проверьте имя канала и подключение к интернету.', true);
      finishTwitchCollection();
    };

    socket.onclose = () => {
      if (twitchSocket !== socket) return;
      finishTwitchCollection();
    };

    btn.classList.add('is-loading');
    btn.disabled = false;
    btn.querySelector('.btn-load-label').textContent = 'Остановить и применить';
    counter.textContent = 'Подключаюсь к чату…';
    counter.classList.add('has-count');

    twitchAutoStopTimer = setTimeout(() => {
      showToast('Сбор остановлен автоматически по таймеру (15 минут), список применён', false);
      finishTwitchCollection();
    }, TWITCH_MAX_COLLECT_MS);
  }

  /* ------------------------------------------------------------------
     7. TELEGRAM — сбор ников из чата группы через Cloudflare Worker
     (вебхук + KV), опрос статуса поллингом, т.к. WebSocket к Telegram
     из браузера невозможен.
     ------------------------------------------------------------------ */

  let telegramChatId = null;
  let telegramPollTimer = null;

  function extractTelegramChat(raw) {
    const value = raw.trim();
    if (!value) return null;
    if (/^-?\d+$/.test(value)) return value;
    if (value.startsWith('@')) return value;
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      const host = url.hostname.replace(/^www\./, '');
      if (host === 't.me' || host === 'telegram.me') {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length) return `@${parts[0]}`;
      }
    } catch { /* не ссылка */ }
    if (/^[a-zA-Z0-9_]{5,32}$/.test(value)) return `@${value}`;
    return null;
  }

  function stopTelegramPolling() {
    if (telegramPollTimer) {
      clearInterval(telegramPollTimer);
      telegramPollTimer = null;
    }
  }

  function cancelTelegramCollection() {
    stopTelegramPolling();
    const chatId = telegramChatId;
    telegramChatId = null;
    resetLoadButton('Начать сбор из группы');
    const counter = $('participantsCounter');
    counter.textContent = state.participants.length
      ? `Загружено участников: ${state.participants.length}`
      : 'Участников не загружено';

    if (chatId) {
      fetch(`${API_BASE_URL}/telegram/collect/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId })
      }).catch(() => {});
    }
  }

  function pollTelegramStatus(chatId) {
    const counter = $('participantsCounter');
    telegramPollTimer = setInterval(() => {
      fetch(`${API_BASE_URL}/telegram/collect/status?chatId=${encodeURIComponent(chatId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (!data.success) return;
          counter.textContent = `Собираю из группы: ${data.count} чел. — нажмите «Остановить и применить», когда будете готовы`;
          counter.classList.add('has-count');
        })
        .catch(() => {});
    }, TELEGRAM_POLL_INTERVAL_MS);
  }

  function finishTelegramCollection() {
    const btn = $('loadParticipantsBtn');
    const chatId = telegramChatId;
    stopTelegramPolling();
    telegramChatId = null;
    btn.disabled = true;

    fetch(`${API_BASE_URL}/telegram/collect/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId })
    })
      .then((res) => res.json())
      .then((data) => {
        resetLoadButton('Начать сбор из группы');
        if (!data.success) {
          showToast(data.error || 'Участников собрать не удалось', true);
          return;
        }
        const items = data.participants.map((p) => ({
          name: p,
          url: p.startsWith('@') ? `https://t.me/${p.slice(1)}` : null,
          platform: 'telegram'
        }));
        applyLoadedParticipants(items);
      })
      .catch(() => {
        resetLoadButton('Начать сбор из группы');
        showToast('Не удалось связаться с сервером сбора участников', true);
      });
  }

  function startTelegramCollection(chatInput) {
    const btn = $('loadParticipantsBtn');
    btn.disabled = true;

    fetch(`${API_BASE_URL}/telegram/resolve?chat=${encodeURIComponent(chatInput)}`)
      .then((res) => res.json())
      .then((resolveData) => {
        if (!resolveData.success) {
          btn.disabled = false;
          showToast(resolveData.error || 'Не удалось найти группу', true);
          return;
        }
        return fetch(`${API_BASE_URL}/telegram/collect/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: resolveData.chatId })
        })
          .then((res) => res.json())
          .then((startData) => {
            btn.disabled = false;
            if (!startData.success) {
              showToast(startData.error || 'Не удалось начать сбор', true);
              return;
            }
            telegramChatId = resolveData.chatId;
            btn.classList.add('is-loading');
            btn.querySelector('.btn-load-label').textContent = 'Остановить и применить';

            const counter = $('participantsCounter');
            counter.textContent = `Собираю из группы «${resolveData.title}»: 0 чел.`;
            counter.classList.add('has-count');

            pollTelegramStatus(resolveData.chatId);
          });
      })
      .catch(() => {
        btn.disabled = false;
        showToast('Не удалось связаться с сервером сбора участников', true);
      });
  }

  /* ------------------------------------------------------------------
     ОБЩИЙ ОБРАБОТЧИК КНОПКИ «Загрузить участников / Начать сбор»
     ------------------------------------------------------------------ */

  function handleLoadParticipants() {
    if (state.inputMode === 'link') {
      if (state.platform === 'twitch') {
        if (twitchSocket) { finishTwitchCollection(); return; }
        const channel = extractTwitchChannel($('sourceUrlInput').value);
        if (!channel) { showToast('Введите имя канала Twitch или ссылку вида twitch.tv/канал', true); return; }
        startTwitchCollection(channel);
        return;
      }

      if (state.platform === 'telegram') {
        if (telegramChatId) { finishTelegramCollection(); return; }
        const chatInput = extractTelegramChat($('sourceUrlInput').value);
        if (!chatInput) { showToast('Введите юзернейм (@группа), ссылку t.me/группа или числовой ID', true); return; }
        startTelegramCollection(chatInput);
        return;
      }

      const url = $('sourceUrlInput').value.trim();
      if (!url) { showToast('Вставьте ссылку или переключитесь на ручной ввод списка', true); return; }

      if (state.platform !== 'youtube') {
        showToast('Автосбор по ссылке реализован для YouTube, Twitch (чат в эфире) и Telegram (чат группы). Для этой платформы используйте вкладку «Список ников».', true);
        return;
      }
      loadParticipantsFromYoutubeLink(url);
      return;
    }

    handleManualListLoad();
  }

  /* ------------------------------------------------------------------
     8. КОЛЕСО РОЗЫГРЫША

     Честно о ключевом ограничении: нарисовать 1000+ читаемых секторов
     на одном колесе физически невозможно ни в одном инструменте —
     буквы сольются в кашу. Поэтому на колесе показывается не более
     WHEEL_MAX_SEGMENTS секторов. Если участников меньше или равно
     этому числу — показаны ВСЕ, по одному сектору на каждого. Если
     больше — победитель (выбранный по-настоящему случайно из ВСЕГО
     пула участников, не только из видимых секторов) гарантированно
     входит в отображаемый набор, а остальные сектора — честная
     случайная выборка реальных участников из того же пула. Никаких
     придуманных имён на колесе никогда не бывает.
     ------------------------------------------------------------------ */

  const WHEEL_MAX_SEGMENTS = 24;
  const WHEEL_COLORS = ['#F43F5E', '#7C3AED', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899', '#6366F1', '#14B8A6'];
  const WHEEL_RADIUS = 150;
  const WHEEL_CX = 160;
  const WHEEL_CY = 160;

  function polarToCartesian(cx, cy, r, angleDeg) {
    const a = ((angleDeg - 90) * Math.PI) / 180; // 0° = верх (12 часов)
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function describeSlicePath(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
    return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
  }

  function truncateLabel(name) {
    return name.length > 14 ? `${name.slice(0, 13)}…` : name;
  }

  function renderWheelPlaceholder(text) {
    $('wheelPlaceholderText').textContent = text;
    $('wheelPlaceholderText').hidden = false;
    $('wheelWrap').style.visibility = 'hidden';
    const svg = $('wheelSvg');
    svg.innerHTML = '';
    svg.style.transform = 'rotate(0deg)';
  }

  /** Выбирает реальный набор участников для показа на колесе (см. пояснение выше класса). */
  function buildWheelSegments(winner) {
    const pool = state.participants;
    if (pool.length <= WHEEL_MAX_SEGMENTS) {
      const segments = [...pool].sort(() => Math.random() - 0.5);
      return { segments, winnerIndex: segments.indexOf(winner) };
    }
    const others = pool.filter((p) => p !== winner);
    const sampleSize = WHEEL_MAX_SEGMENTS - 1;
    const sampled = [...others].sort(() => Math.random() - 0.5).slice(0, sampleSize);
    const segments = [...sampled, winner].sort(() => Math.random() - 0.5);
    return { segments, winnerIndex: segments.indexOf(winner) };
  }

  function renderWheel(segments, highlightIndex) {
    const svg = $('wheelSvg');
    const anglePer = 360 / segments.length;
    svg.innerHTML = segments
      .map((p, i) => {
        const startAngle = i * anglePer;
        const endAngle = startAngle + anglePer;
        const midAngle = startAngle + anglePer / 2;
        const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
        const labelPos = polarToCartesian(WHEEL_CX, WHEEL_CY, WHEEL_RADIUS * 0.62, midAngle);
        const textRotation = midAngle > 90 && midAngle < 270 ? midAngle + 180 : midAngle;
        const isWinnerSlice = i === highlightIndex;
        return `
          <path d="${describeSlicePath(WHEEL_CX, WHEEL_CY, WHEEL_RADIUS, startAngle, endAngle)}"
                fill="${color}" stroke="#ffffff" stroke-width="2"
                class="${isWinnerSlice ? 'is-winner-slice' : ''}"></path>
          <text class="wheel-segment-label" x="${labelPos.x.toFixed(2)}" y="${labelPos.y.toFixed(2)}"
                text-anchor="middle" dominant-baseline="middle"
                transform="rotate(${textRotation.toFixed(2)} ${labelPos.x.toFixed(2)} ${labelPos.y.toFixed(2)})">${escapeHtml(truncateLabel(p.name))}</text>
        `;
      })
      .join('');
  }

  function renderWheelIdle() {
    $('wheelPlaceholderText').hidden = true;
    $('wheelWrap').style.visibility = 'visible';
    const { segments } = buildWheelSegments(state.participants[0]);
    renderWheel(segments, -1);
  }

  function resolveWinner() {
    if (state.forceWinner.enabled && state.forceWinner.nickname.trim()) {
      const target = state.forceWinner.nickname.trim();
      const already = state.participants.find((p) => p.name.toLowerCase() === target.toLowerCase());
      if (already) return already;
      const forced = { name: target, url: null, platform: state.platform };
      state.participants.push(forced);
      return forced;
    }
    return pickRandom(state.participants);
  }

  function currentSpinDurationMs() {
    const seconds = parseInt($('spinDurationInput').value, 10) || 5;
    return Math.max(1, seconds) * 1000;
  }

  function spin() {
    if (state.isSpinning) return;
    if (state.participants.length === 0) {
      showToast('Сначала загрузите участников', true);
      return;
    }

    state.isSpinning = true;
    const spinBtn = $('spinBtn');
    spinBtn.disabled = true;
    spinBtn.classList.add('is-spinning');
    $('spinBtnLabel').textContent = 'Крутится…';

    const winner = resolveWinner();
    const { segments, winnerIndex } = buildWheelSegments(winner);
    const anglePer = 360 / segments.length;

    const svg = $('wheelSvg');
    renderWheel(segments, -1);
    svg.classList.add('is-spinning');

    const spinDuration = currentSpinDurationMs();
    const spinSeconds = spinDuration / 1000;
    // Больше оборотов для долгих прокруток, чтобы не выглядело вяло; разумный потолок
    const revolutions = Math.min(400, Math.max(6, Math.round(spinSeconds / 2)));

    const targetCenterAngle = winnerIndex * anglePer + anglePer / 2;
    const finalMod = (360 - targetCenterAngle + 360) % 360;
    const baseFloor = Math.floor(state.wheelRotation / 360) * 360;
    let finalRotation = baseFloor + revolutions * 360 + finalMod;
    if (finalRotation <= state.wheelRotation) finalRotation += 360;

    svg.style.transition = `transform ${spinDuration}ms cubic-bezier(0.14, 0.7, 0.12, 1)`;
    requestAnimationFrame(() => {
      svg.style.transform = `rotate(${finalRotation}deg)`;
    });

    setTimeout(() => {
      state.wheelRotation = finalRotation;
      renderWheel(segments, winnerIndex);
      playStopTick();
      svg.classList.remove('is-spinning');

      // Драматичное "оседание": небольшой перелёт дальше точки остановки и мягкий отскок назад
      const overshootDeg = 6;
      svg.style.transition = 'transform 140ms ease-in';
      svg.style.transform = `rotate(${finalRotation + overshootDeg}deg)`;
      setTimeout(() => {
        svg.style.transition = 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)';
        svg.style.transform = `rotate(${finalRotation}deg)`;
      }, 140);

      spinBtn.disabled = false;
      spinBtn.classList.remove('is-spinning');
      $('spinBtnLabel').textContent = 'Выбрать победителя';

      state.isSpinning = false;
      setTimeout(() => showVictoryModal(winner), 480);
    }, spinDuration + 60);
  }

  /* ------------------------------------------------------------------
     9. МОДАЛЬНОЕ ОКНО ПОБЕДИТЕЛЯ
     ------------------------------------------------------------------ */

  function showVictoryModal(winner) {
    $('victoryAvatar').textContent = initialOf(winner.name);

    const nameLink = $('victoryName');
    nameLink.textContent = winner.name;
    if (winner.url) {
      nameLink.href = winner.url;
      nameLink.classList.remove('is-not-clickable');
      nameLink.removeAttribute('aria-disabled');
    } else {
      nameLink.href = '#';
      nameLink.setAttribute('aria-disabled', 'true');
      nameLink.addEventListener('click', (e) => e.preventDefault(), { once: true });
    }

    const platform = winner.platform || state.platform;
    $('victoryPlatformLabel').textContent = PLATFORM_LABELS[platform] || platform;
    const platformWrap = $('victoryPlatform');
    setPlatformColorClass(platformWrap, platform);
    const oldSvg = platformWrap.querySelector('svg');
    if (oldSvg) oldSvg.remove();
    platformWrap.insertAdjacentHTML('afterbegin', PLATFORM_ICONS[platform] || '');

    $('victoryModal').hidden = false;
    spawnConfetti();
    playWinnerChime();
    saveWinnerToHistory(winner);
  }

  /* ------------------------------------------------------------------
     ИСТОРИЯ ПОБЕДИТЕЛЕЙ — хранится в localStorage этого браузера,
     без срока жизни (пока сам не очистишь в admin.html). Читается
     и экспортируется в CSV из admin.html, т.к. это панель ведущего.
     ------------------------------------------------------------------ */

  const WINNER_HISTORY_KEY = 'neurodraw_winner_history';
  const WINNER_HISTORY_MAX = 200;

  function saveWinnerToHistory(winner) {
    try {
      const raw = localStorage.getItem(WINNER_HISTORY_KEY);
      const history = raw ? JSON.parse(raw) : [];
      history.unshift({
        name: winner.name,
        platform: winner.platform || state.platform,
        url: winner.url || null,
        at: new Date().toISOString()
      });
      localStorage.setItem(WINNER_HISTORY_KEY, JSON.stringify(history.slice(0, WINNER_HISTORY_MAX)));
    } catch { /* localStorage недоступен/переполнен — история не критична для работы сайта */ }
  }

  function hideVictoryModal() {
    $('victoryModal').hidden = true;
    $('modalConfetti').innerHTML = '';
  }

  function spawnConfetti() {
    const container = $('modalConfetti');
    container.innerHTML = '';
    const colors = ['#4F46E5', '#7C3AED', '#22D3EE', '#059669', '#F59E0B'];
    for (let i = 0; i < 28; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[randomInt(0, colors.length - 1)];
      piece.style.animationDuration = `${1.4 + Math.random() * 1.2}s`;
      piece.style.animationDelay = `${Math.random() * 0.3}s`;
      container.appendChild(piece);
    }
  }

  /* ------------------------------------------------------------------
     10. РЕЖИМ "ЗАДАННЫЙ ПОБЕДИТЕЛЬ" — Shift + F8 → admin.html

     Честно о надёжности (без имитации): веб-страница не может скрыть
     себя от произвольного "захвата экрана" — у браузера нет сведений
     о том, что кто-то считывает его пиксели извне. Поэтому вместо
     попытки угадать, что мы внутри OBS (например, по user-agent — OBS
     Browser Source по умолчанию НЕ добавляет туда ничего отличимого
     от обычного Chrome, так что такая проверка не работает), админка
     вынесена в отдельный документ admin.html. OBS Browser Source
     рендерит только тот документ, что указан в источнике — если там
     указан index.html, то содержимое admin.html физически не может
     туда попасть, независимо от того, открыт он или нет.
     ------------------------------------------------------------------ */

  function openAdminWindow() {
    window.open('admin.html', 'neurodraw-admin', 'width=480,height=720,noopener,noreferrer');
  }

  function readForceWinnerFromStorage() {
    try {
      const raw = localStorage.getItem('neurodraw_force_winner');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.forceWinner.enabled = Boolean(parsed.enabled);
      state.forceWinner.nickname = typeof parsed.nickname === 'string' ? parsed.nickname : '';
      $('forceWinnerIndicator').hidden = !state.forceWinner.enabled;
    } catch { /* игнорируем битое значение */ }
  }

  function initForceWinnerSync() {
    readForceWinnerFromStorage();
    // admin.html пишет в localStorage — событие 'storage' прилетает во все ДРУГИЕ
    // открытые документы того же источника (ровно наш случай: index.html + admin.html).
    window.addEventListener('storage', (e) => {
      if (e.key === 'neurodraw_force_winner') readForceWinnerFromStorage();
    });

    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.key === 'F8') {
        e.preventDefault();
        openAdminWindow();
      }
      if (e.key === 'Escape' && !$('victoryModal').hidden) hideVictoryModal();
    });
  }

  /* ------------------------------------------------------------------
     11. МОБИЛЬНОЕ МЕНЮ, ОБЩАЯ ИНИЦИАЛИЗАЦИЯ
     ------------------------------------------------------------------ */

  function initMobileMenu() {
    const toggle = $('mobileMenuToggle');
    const menu = $('mobileMenu');
    toggle.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  function initVictoryModalControls() {
    $('victoryCloseBtn').addEventListener('click', hideVictoryModal);
    $('victoryOkBtn').addEventListener('click', hideVictoryModal);
    $('victorySpinAgainBtn').addEventListener('click', () => {
      hideVictoryModal();
      setTimeout(spin, 200);
    });
    $('victoryModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideVictoryModal();
    });
  }

  function initSpinDurationControl() {
    // Поле свободное: подстраховываемся только от пустого/отрицательного/нечислового ввода
    const input = $('spinDurationInput');
    input.addEventListener('change', () => {
      const n = parseInt(input.value, 10);
      if (!n || n < 1) input.value = '5';
    });
  }

  function init() {
    $('footerYear').textContent = new Date().getFullYear();

    initPlatformTabs();
    updatePlatformIndicator();
    updateLinkModeHint();
    initInputModeSwitch();
    initKeywordFilterToggle();
    initCombinedModeToggle();
    initSpinDurationControl();
    initParticipantsTools();
    initSoundToggle();

    $('loadParticipantsBtn').addEventListener('click', handleLoadParticipants);
    $('spinBtn').addEventListener('click', spin);

    initVictoryModalControls();
    initForceWinnerSync();
    initMobileMenu();

    renderWheelPlaceholder('Загрузите участников, чтобы начать');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
