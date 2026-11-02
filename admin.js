/* ====================================================================
   NeuroDraw — Панель ведущего (admin.html)
   Работает как ОТДЕЛЬНЫЙ документ от index.html. Это сделано намеренно:
   OBS Browser Source рендерит именно тот документ, который указан
   в источнике (index.html), и не отображает содержимое других вкладок
   или окон браузера. Поэтому пока в OBS добавлен только index.html,
   эта страница физически не может попасть в трансляцию — вне
   зависимости от того, открыта она или закрыта, свёрнута или видна.

   Передача настройки "заданный победитель" в index.html происходит
   через localStorage: оба документа открыты на одном и том же сайте
   (одном origin), поэтому запись в localStorage на этой странице
   мгновенно доступна странице index.html через событие "storage".
   ==================================================================== */

(() => {
  'use strict';

  const STORAGE_KEY = 'neurodraw_force_winner';

  const $ = (id) => document.getElementById(id);

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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

  function writeState(nextState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }

  function showStatus(message) {
    const el = $('adminStatus');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => {
      el.classList.remove('is-visible');
    }, 3200);
  }

  /* ------------------------------------------------------------------
     История победителей — пишется со страницы index.html в тот момент,
     когда там реально выбирается победитель; здесь только читаем,
     показываем и даём экспортировать/очистить.
     ------------------------------------------------------------------ */

  const HISTORY_KEY = 'neurodraw_winner_history';

  const PLATFORM_LABELS = {
    youtube: 'YouTube', twitch: 'Twitch', tiktok: 'TikTok', instagram: 'Instagram', telegram: 'Telegram'
  };

  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function formatHistoryDate(iso) {
    try {
      return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderHistory() {
    const history = readHistory();
    const list = $('adminHistoryList');
    const empty = $('adminHistoryEmpty');

    if (history.length === 0) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }

    empty.style.display = 'none';
    list.innerHTML = history
      .map((entry) => `<li><strong>${escapeHtml(entry.name)}</strong> — ${escapeHtml(PLATFORM_LABELS[entry.platform] || entry.platform)} · ${escapeHtml(formatHistoryDate(entry.at))}</li>`)
      .join('');
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function downloadHistoryCsv() {
    const history = readHistory();
    const rows = [['Имя', 'Платформа', 'Ссылка', 'Дата и время'], ...history.map((e) => [
      e.name, PLATFORM_LABELS[e.platform] || e.platform, e.url || '', formatHistoryDate(e.at)
    ])];
    const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'neurodraw-winner-history.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function init() {
    const toggle = $('forceWinnerToggle');
    const input = $('forceWinnerInput');
    const saveBtn = $('adminSaveBtn');

    const current = readState();
    toggle.checked = current.enabled;
    input.value = current.nickname;
    input.disabled = !current.enabled;

    toggle.addEventListener('change', () => {
      input.disabled = !toggle.checked;
      if (toggle.checked) input.focus();
    });

    saveBtn.addEventListener('click', () => {
      const enabled = toggle.checked;
      const nickname = input.value.trim();

      if (enabled && !nickname) {
        showStatus('Введите никнейм или выключите режим.');
        input.focus();
        return;
      }

      writeState({ enabled, nickname });
      showStatus(
        enabled
          ? `Применено: следующим победителем будет «${nickname}».`
          : 'Режим заданного победителя выключен.'
      );
    });

    renderHistory();
    $('adminHistoryExportBtn').addEventListener('click', downloadHistoryCsv);
    $('adminHistoryClearBtn').addEventListener('click', () => {
      if (!confirm('Удалить всю историю победителей без возможности восстановить?')) return;
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
      showStatus('История победителей очищена.');
    });

    // Если index.html дописывает историю, пока эта страница открыта в другой вкладке/окне
    window.addEventListener('storage', (e) => {
      if (e.key === HISTORY_KEY) renderHistory();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
