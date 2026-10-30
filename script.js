/* ====================================================================
   NeuroDraw — логика приложения
   Разделы:
     1. Состояние приложения
     2. Утилиты
     3. Платформы и переключение режимов ввода
     4. Фильтрация и загрузка участников
     5. Барабан рулетки (анимация прокрутки)
     6. Модальное окно победителя
     7. Синхронизация режима "Заданный победитель" с панелью ведущего
     8. Мобильное меню, тосты, инициализация
   ==================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------
     1. СОСТОЯНИЕ ПРИЛОЖЕНИЯ
     ------------------------------------------------------------------ */

  const state = {
    platform: 'youtube',           // текущая выбранная платформа
    inputMode: 'list',             // 'list' | 'link'
    participants: [],              // итоговый список участников после фильтрации
    isSpinning: false,             // идёт ли сейчас прокрутка барабана
    forceWinner: {
      enabled: false,              // включён ли режим принудительного победителя
      nickname: ''                 // заданный ник
    }
  };

  // Адрес Cloudflare Worker'а, который реально собирает комментаторов
  // под видео YouTube через официальный YouTube Data API v3.
  // Если воркер развёрнут на другом поддомене workers.dev — поменяйте только эту строку.
  const YOUTUBE_WORKER_URL = 'https://neurodraw-api.webtkachdenis.workers.dev';

  const PLATFORM_LABELS = {
    youtube: 'YouTube',
    twitch: 'Twitch',
    tiktok: 'TikTok',
    instagram: 'Instagram'
  };

  // SVG-иконки платформ переиспользуются в индикаторе и в карточке победителя
  const PLATFORM_ICONS = {
    youtube: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M21.6 7.2c-.25-1-1-1.75-2-2C17.9 4.7 12 4.7 12 4.7s-5.9 0-7.6.5c-1 .25-1.75 1-2 2C2 8.9 2 12 2 12s0 3.1.4 4.8c.25 1 1 1.75 2 2 1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5c1-.25 1.75-1 2-2 .4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8z" fill="currentColor"/><path d="M10 15.2V8.8L15.8 12 10 15.2z" fill="#fff"/></svg>',
    twitch: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.5 2.5 3 6.5v13h5v2.5l3-2.5h4L20.5 14V2.5h-16z" fill="currentColor"/><rect x="9.5" y="7" width="1.6" height="5.2" fill="#fff"/><rect x="14" y="7" width="1.6" height="5.2" fill="#fff"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16.6 2h-3.3v13.6a2.7 2.7 0 1 1-2.3-2.7v-3.3a6 6 0 1 0 5.6 6V8.4c1.1.8 2.4 1.3 3.9 1.3V6.4c-2.1 0-3.9-1.8-3.9-4.4z" fill="currentColor"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor"/></svg>'
  };

  /* ------------------------------------------------------------------
     2. УТИЛИТЫ
     ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  /** Показывает короткое тост-уведомление внизу экрана. */
  function showToast(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.classList.add('is-visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2600);
  }

  /** Возвращает случайное целое число в диапазоне [min, max]. */
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Выбирает один случайный элемент массива (криптографически не обязателен — честная бытовая случайность). */
  function pickRandom(arr) {
    return arr[randomInt(0, arr.length - 1)];
  }

  /** Первая буква ника для аватара-заглушки в модалке победителя. */
  function initialOf(name) {
    const trimmed = (name || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }

  /* ------------------------------------------------------------------
     3. ПЛАТФОРМЫ И ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ ВВОДА
     ------------------------------------------------------------------ */

  function initPlatformTabs() {
    const tabs = document.querySelectorAll('.platform-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');

        state.platform = tab.dataset.platform;
        updatePlatformIndicator();
      });
    });
  }

  function updatePlatformIndicator() {
    const indicator = $('activePlatformIndicator');
    const label = $('activePlatformLabel');
    const svg = indicator.querySelector('svg');
    if (svg) svg.remove();
    indicator.insertAdjacentHTML('afterbegin', PLATFORM_ICONS[state.platform]);
    label.textContent = PLATFORM_LABELS[state.platform];
  }

  function initInputModeSwitch() {
    const modeTabs = document.querySelectorAll('.mode-tab');
    modeTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
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

  function initKeywordFilterToggle() {
    const checkbox = $('filterKeywordEnabled');
    const input = $('filterKeywordInput');
    checkbox.addEventListener('change', () => {
      input.disabled = !checkbox.checked;
      input.classList.toggle('is-disabled', !checkbox.checked);
      if (checkbox.checked) input.focus();
    });
  }

  /* ------------------------------------------------------------------
     4. ФИЛЬТРАЦИЯ И ЗАГРУЗКА УЧАСТНИКОВ
     ------------------------------------------------------------------ */

  /**
   * Разбирает многострочный текст в список ников:
   * - убирает пустые строки и пробелы по краям;
   * - при необходимости убирает дубликаты (без учёта регистра);
   * - при необходимости оставляет только строки с ключевым словом.
   */
  function parseParticipants(rawText, options) {
    let lines = rawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (options.keywordEnabled && options.keyword) {
      const kw = options.keyword.trim().toLowerCase();
      if (kw) {
        lines = lines.filter((line) => line.toLowerCase().includes(kw));
      }
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

  /** Общее завершение загрузки: применяет фильтры и обновляет интерфейс. */
  function finishLoadingParticipants(rawText, options) {
    const btn = $('loadParticipantsBtn');
    const counter = $('participantsCounter');
    const result = parseParticipants(rawText, options);

    state.participants = result;

    btn.classList.remove('is-loading');
    btn.disabled = false;

    if (result.length === 0) {
      counter.textContent = 'Участников не найдено — проверьте фильтры';
      counter.classList.remove('has-count');
      $('spinBtn').disabled = true;
      renderReelPlaceholder('Участники не найдены');
      return;
    }

    counter.textContent = `Загружено участников: ${result.length}`;
    counter.classList.add('has-count');
    $('spinBtn').disabled = false;
    renderReelIdle();
    showToast(`Готово! Найдено участников: ${result.length}`);
  }

  /** Реальный сбор комментаторов под YouTube-видео через Cloudflare Worker. */
  function loadParticipantsFromYoutubeLink(url, options) {
    const btn = $('loadParticipantsBtn');
    const counter = $('participantsCounter');

    btn.classList.add('is-loading');
    btn.disabled = true;

    const endpoint = `${YOUTUBE_WORKER_URL}?url=${encodeURIComponent(url)}`;

    fetch(endpoint)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          btn.classList.remove('is-loading');
          btn.disabled = false;
          showToast(data.error || 'Не удалось собрать участников по ссылке', true);
          return;
        }
        finishLoadingParticipants(data.participants.join('\n'), options);
      })
      .catch(() => {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        showToast('Не удалось связаться с сервером сбора участников. Проверьте соединение и попробуйте ещё раз.', true);
      });
  }

  function handleLoadParticipants() {
    const excludeDuplicates = $('filterDuplicates').checked;
    const keywordEnabled = $('filterKeywordEnabled').checked;
    const keyword = $('filterKeywordInput').value;
    const options = { excludeDuplicates, keywordEnabled, keyword };

    // Валидация в зависимости от выбранного режима ввода
    if (state.inputMode === 'link') {
      const url = $('sourceUrlInput').value.trim();
      if (!url) {
        showToast('Вставьте ссылку или переключитесь на ручной ввод списка', true);
        return;
      }

      if (state.platform !== 'youtube') {
        showToast('Автосбор по ссылке пока реализован только для YouTube. Для этой платформы используйте вкладку «Список ников».', true);
        return;
      }

      loadParticipantsFromYoutubeLink(url, options);
      return;
    }

    const rawText = $('participantsInput').value;

    if (!rawText.trim()) {
      showToast('Добавьте хотя бы одного участника', true);
      return;
    }

    const btn = $('loadParticipantsBtn');
    btn.classList.add('is-loading');
    btn.disabled = true;

    // Небольшая пауза для наглядности UI — сам список участников формируется
    // мгновенно и полностью реально (без фейковых данных).
    setTimeout(() => {
      finishLoadingParticipants(rawText, options);
    }, 450);
  }

  /* ------------------------------------------------------------------
     5. БАРАБАН РУЛЕТКИ
     ------------------------------------------------------------------ */

  const ITEM_HEIGHT = 86;        // должно совпадать с .reel-item { height } в CSS (десктоп)
  const ITEM_HEIGHT_MOBILE = 70; // совпадает с мобильным брейкпоинтом в CSS

  function currentItemHeight() {
    return window.matchMedia('(max-width: 640px)').matches ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  }

  function renderReelPlaceholder(text) {
    const track = $('reelTrack');
    track.style.transform = 'translateY(0)';
    track.innerHTML = `<div class="reel-item reel-placeholder">${escapeHtml(text)}</div>`;
  }

  function renderReelIdle() {
    // Показываем первых участников статично, барабан ещё не крутится
    const track = $('reelTrack');
    const preview = state.participants.slice(0, 5);
    track.style.transform = `translateY(${-currentItemHeight() / 2}px)`;
    track.innerHTML = preview
      .map((name, i) => `<div class="reel-item${i === 0 ? ' is-center' : ''}">${escapeHtml(name)}</div>`)
      .join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Определяет победителя с учётом режима "Заданный победитель".
   * Если режим включён и ник задан — возвращает его (добавляя в список участников,
   * если там его ещё нет), иначе выбирает случайного участника.
   */
  function resolveWinner() {
    if (state.forceWinner.enabled && state.forceWinner.nickname.trim()) {
      const target = state.forceWinner.nickname.trim();
      const alreadyInList = state.participants.some(
        (p) => p.toLowerCase() === target.toLowerCase()
      );
      if (!alreadyInList) {
        state.participants.push(target);
      }
      return target;
    }
    return pickRandom(state.participants);
  }

  /**
   * Строит длинную прокручиваемую ленту ников так, чтобы она естественно
   * заканчивалась на имени победителя по центру окна (под указателем).
   */
  function buildReelSequence(winner) {
    const pool = state.participants;
    const REPEAT_ROUNDS = 4; // сколько раз "прогоняем" весь список перед остановкой — создаёт ощущение вращения
    const sequence = [];

    for (let round = 0; round < REPEAT_ROUNDS; round++) {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      sequence.push(...shuffled);
    }

    // Добавляем "подводку" к финалу: несколько случайных участников, затем победитель
    const tailLength = Math.min(6, Math.max(3, pool.length));
    for (let i = 0; i < tailLength; i++) {
      sequence.push(pickRandom(pool));
    }
    sequence.push(winner);

    return sequence;
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
    const sequence = buildReelSequence(winner);

    const track = $('reelTrack');
    const itemHeight = currentItemHeight();

    // Строим DOM-разметку всей последовательности
    track.innerHTML = sequence
      .map((name) => `<div class="reel-item">${escapeHtml(name)}</div>`)
      .join('');

    const items = track.querySelectorAll('.reel-item');
    const winnerIndex = sequence.length - 1;

    // Стартовая позиция: первый элемент по центру окна (под указателем)
    track.style.transition = 'none';
    track.style.transform = `translateY(${-itemHeight / 2}px)`;

    // Принудительный reflow, чтобы браузер применил стартовую позицию до начала transition
    // eslint-disable-next-line no-unused-expressions
    track.offsetHeight;

    const finalOffset = -(winnerIndex * itemHeight) - itemHeight / 2;
    const spinDuration = 4200; // мс — достаточно долго, чтобы прокрутка ощущалась плавной и честной

    requestAnimationFrame(() => {
      track.style.transition = `transform ${spinDuration}ms cubic-bezier(0.12, 0.72, 0.1, 1)`;
      track.style.transform = `translateY(${finalOffset}px)`;
    });

    // Подсвечиваем элемент по центру в процессе прокрутки
    const highlightInterval = setInterval(() => {
      highlightCenterItem(track, items, itemHeight);
    }, 80);

    setTimeout(() => {
      clearInterval(highlightInterval);
      highlightCenterItem(track, items, itemHeight);
      items[winnerIndex].classList.add('is-winner');

      state.isSpinning = false;
      spinBtn.disabled = false;
      spinBtn.classList.remove('is-spinning');
      $('spinBtnLabel').textContent = 'Выбрать победителя';

      showVictoryModal(winner);
    }, spinDuration + 120);
  }

  /** Подсвечивает элемент ленты, который сейчас находится под указателем центра. */
  function highlightCenterItem(track, items, itemHeight) {
    const matrix = new WebKitCSSMatrix
      ? new WebKitCSSMatrix(getComputedStyle(track).transform)
      : null;
    let translateY;
    if (matrix) {
      translateY = matrix.m42;
    } else {
      const style = getComputedStyle(track).transform;
      const match = /matrix\(([^)]+)\)/.exec(style);
      translateY = match ? parseFloat(match[1].split(',')[5]) : 0;
    }

    const centerIndex = Math.round((-translateY - itemHeight / 2) / itemHeight);

    items.forEach((item, i) => {
      item.classList.toggle('is-center', i === centerIndex);
    });
  }

  /* ------------------------------------------------------------------
     6. МОДАЛЬНОЕ ОКНО ПОБЕДИТЕЛЯ
     ------------------------------------------------------------------ */

  function showVictoryModal(winnerName) {
    $('victoryAvatar').textContent = initialOf(winnerName);
    $('victoryName').textContent = winnerName;

    const platformLabelEl = $('victoryPlatformLabel');
    platformLabelEl.textContent = PLATFORM_LABELS[state.platform];

    const platformWrap = $('victoryPlatform');
    const oldSvg = platformWrap.querySelector('svg');
    if (oldSvg) oldSvg.remove();
    platformWrap.insertAdjacentHTML('afterbegin', PLATFORM_ICONS[state.platform]);

    const modal = $('victoryModal');
    modal.hidden = false;
    spawnConfetti();
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
     7. СИНХРОНИЗАЦИЯ РЕЖИМА "ЗАДАННЫЙ ПОБЕДИТЕЛЬ" С ПАНЕЛЬЮ ВЕДУЩЕГО
     ------------------------------------------------------------------
     Панель ведущего живёт в отдельном файле admin.html — отдельный
     документ, который не рендерится внутри index.html. Поэтому пока
     в OBS Browser Source указан только index.html, никакие действия
     на странице admin.html не могут попасть в кадр трансляции.

     Обмен данными между двумя открытыми документами одного сайта
     происходит через localStorage: запись на странице admin.html
     мгновенно доступна на этой странице через событие "storage".
     ------------------------------------------------------------------ */

  const FORCE_WINNER_STORAGE_KEY = 'neurodraw_force_winner';

  function readForceWinnerFromStorage() {
    try {
      const raw = localStorage.getItem(FORCE_WINNER_STORAGE_KEY);
      if (!raw) return { enabled: false, nickname: '' };
      const parsed = JSON.parse(raw);
      return {
        enabled: Boolean(parsed.enabled),
        nickname: typeof parsed.nickname === 'string' ? parsed.nickname : ''
      };
    } catch (err) {
      return { enabled: false, nickname: '' };
    }
  }

  function applyForceWinnerState(nextState) {
    state.forceWinner.enabled = nextState.enabled;
    state.forceWinner.nickname = nextState.nickname;
    $('forceWinnerIndicator').hidden = !nextState.enabled;
  }

  function initForceWinnerSync() {
    // Применяем состояние, уже сохранённое ранее (если панель ведущего настраивалась раньше)
    applyForceWinnerState(readForceWinnerFromStorage());

    // Событие "storage" срабатывает в этой вкладке, когда localStorage меняют
    // в ДРУГОЙ вкладке/окне того же сайта — то есть когда ведущий сохраняет
    // настройки на странице admin.html.
    window.addEventListener('storage', (e) => {
      if (e.key !== FORCE_WINNER_STORAGE_KEY) return;
      applyForceWinnerState(readForceWinnerFromStorage());
    });
  }

  /* ------------------------------------------------------------------
     8. МОБИЛЬНОЕ МЕНЮ, ОБЩАЯ ИНИЦИАЛИЗАЦИЯ
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
      // Небольшая пауза перед повторным запуском, чтобы модалка успела закрыться
      setTimeout(spin, 200);
    });
    $('victoryModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideVictoryModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('victoryModal').hidden) hideVictoryModal();
    });
  }

  function init() {
    $('footerYear').textContent = new Date().getFullYear();

    initPlatformTabs();
    updatePlatformIndicator();
    initInputModeSwitch();
    initKeywordFilterToggle();

    $('loadParticipantsBtn').addEventListener('click', handleLoadParticipants);
    $('spinBtn').addEventListener('click', spin);

    initVictoryModalControls();
    initForceWinnerSync();
    initMobileMenu();

    renderReelPlaceholder('Загрузите участников, чтобы начать');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
