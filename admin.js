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
  }

  document.addEventListener('DOMContentLoaded', init);
})();
