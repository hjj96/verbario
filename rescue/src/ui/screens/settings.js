// НАСТРОЙКИ (DESIGN §7.6, §7.8): every key of core/settings.js on one paper form (`mayday.settings.v1`),
// grouped ГРАФИКА · ЗВУК · УПРАВЛЕНИЕ · ДОСТУПНОСТЬ. ↑↓ choose, ←→ change, Enter toggles / cycles,
// the mouse clicks ‹ › or the bar. The focused row explains itself on the bottom line.
// «Сбросить прогресс» asks for confirmation (mission.resetProgress()).
import { el } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { NBSP } from '../common/fmt.js';
import { Screen } from './screen.js';

const ON_OFF = [
  [true, 'Вкл'],
  [false, 'Выкл'],
];

// type: 'choice' (values), 'toggle', 'slider' (min, max, step, pct)
const SECTIONS = [
  {
    title: 'ГРАФИКА',
    rows: [
      { key: 'quality', label: 'Качество', type: 'choice', values: [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']], help: 'Сетка океана, тени, bloom, частицы. «Низкое» — для слабых и встроенных видеокарт.' },
      { key: 'showFps', label: 'Счётчик FPS', type: 'toggle', help: 'Частота кадров в правом нижнем углу.' },
    ],
  },
  {
    title: 'ЗВУК',
    rows: [
      { key: 'masterVolume', label: 'Общая', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Общая громкость.' },
      { key: 'musicVolume', label: 'Музыка', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Генеративная музыка — растёт вместе со штормом.' },
      { key: 'sfxVolume', label: 'Эффекты', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Ротор, турбина, лебёдка, удары.' },
      { key: 'radioVolume', label: 'Радио', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Эфир: Берег, экипаж, пострадавшие.' },
      { key: 'envVolume', label: 'Погода и море', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Ветер, дождь, волны, гром.' },
      { key: 'uiVolume', label: 'Интерфейс', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Щелчки меню, телетайп, штамп.' },
      { key: 'alarms', label: 'Звуковые предупреждения', type: 'toggle', help: 'Сигналы малой высоты, топлива, корпуса. Визуальные плашки остаются всегда.' },
    ],
  },
  {
    title: 'УПРАВЛЕНИЕ',
    rows: [
      { key: 'assist', label: 'Стабилизация', type: 'choice', values: [['full', 'Полная'], ['standard', 'Стандарт'], ['off', 'Нет']], help: 'Что делает машина, когда вы отпускаете клавиши: «Полная» держит точку, «Стандарт» гасит 70 % сноса, «Нет» — всё сами.' },
      { key: 'difficulty', label: 'Сложность', type: 'choice', values: [['cadet', 'Курсант'], ['pilot', 'Пилот'], ['ace', 'Ас']], help: 'Курсант: тепло ×1,5, урон ×0,6, очки ×0,8. Ас: тепло ×0,8, урон ×1,3, очки ×1,3. Применяется со следующего вылета.' },
      { key: 'invertLift', label: 'Инверсия высоты', type: 'toggle', help: 'Поменять местами клавиши набора и снижения.' },
      { key: 'vibration', label: 'Вибрация', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Отдача геймпада при ударах, порывах и грозе.' },
    ],
  },
  {
    title: 'ДОСТУПНОСТЬ',
    rows: [
      { key: 'reduceFlashes', label: 'Меньше вспышек', type: 'toggle', help: 'Мягкие вспышки молний без повторов, стробы тише и реже, мигание HUD заменено «дыханием».' },
      { key: 'screenShake', label: 'Тряска экрана', type: 'slider', min: 0, max: 1, step: 0.1, help: 'Умножает всю тряску камеры: гром, порывы, удары.' },
      { key: 'colorblindMarkers', label: 'Метки для дальтоников', type: 'toggle', help: 'Палитра высокой различимости: люди, площадки и опасности. Формы ◆ ○H ▲ остаются всегда.' },
      { key: 'subtitles', label: 'Субтитры', type: 'toggle', help: 'Радиопереговоры текстом.' },
      { key: 'reduceMotion', label: 'Меньше движения', type: 'toggle', help: 'Без развёртки радара, въезда сообщений, глитчей и капель на объективе; переходы — простым затуханием.' },
      { key: 'textScale', label: 'Размер текста', type: 'choice', values: [[1, '100 %'], [1.25, '125 %'], [1.5, '150 %']], help: 'Субтитры, подсказки, меню и сообщения.' },
      { key: 'hudScale', label: 'Масштаб HUD', type: 'slider', min: 0.8, max: 1.3, step: 0.05, help: 'Размер приборов в полёте: кольцо, радар, шкалы.' },
      { key: 'seenFlashWarning', label: 'Предупреждение при запуске', type: 'toggle', invert: true, help: 'Снова показать предупреждение о вспышках при следующем запуске.' },
    ],
  },
];

export class SettingsScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-settings');
    const sheet = el('div.set-sheet.paper', { parent: this.node });
    const head = el('div.set-head', { parent: sheet });
    el('h2.set-title', { text: 'НАСТРОЙКИ', parent: head });
    el('div.set-form', { text: 'БЛАНК № 7 · ХРАНИТСЯ В ЭТОМ БРАУЗЕРЕ', parent: head });
    this.body = el('div.set-body', { parent: sheet });
    this.help = el('div.set-help', { parent: sheet });
    const foot = el('div.set-foot', { parent: sheet });
    this.rows = [];
    const items = [];
    for (const sec of SECTIONS) {
      el('div.set-sec', { text: sec.title, parent: this.body });
      for (const r of sec.rows) {
        const row = this._row(r);
        this.rows.push(row);
        items.push(row.item);
      }
    }
    this.bReset = el('div.btn.btn-ghost.set-reset', { text: 'СБРОСИТЬ ПРОГРЕСС', parent: foot, attrs: { role: 'button' } });
    this.bDone = el('div.btn.btn-primary', { text: 'ГОТОВО', parent: foot, attrs: { role: 'button' } });
    items.push({
      el: this.bReset,
      help: 'Медали, звания, рекорды «Смены» и выученные подсказки. Настройки останутся.',
      onActivate: () =>
        this.hud.go('confirm', {
          title: 'СБРОСИТЬ ПРОГРЕСС?',
          text: 'Все медали, звание, «Спасено за карьеру» и таблица «Смены» будут стёрты. Это нельзя отменить.',
          yes: 'СТЕРЕТЬ',
          onYes: () => {
            try {
              this.ctx.mission?.resetProgress?.();
            } catch (err) {
              console.error('[hud] resetProgress failed', err);
            }
            this.hud.toast?.('ПРОГРЕСС СБРОШЕН', '', { kind: 'info' });
          },
        }),
    });
    items.push({ el: this.bDone, help: '', onActivate: () => this._close() });
    this.menu = new Menu(hud, { name: 'settings', onBack: () => this._close(), onFocus: (it) => (this.help.textContent = it?.help || '') });
    this.menu.setItems(items);
  }

  _close() {
    this.hud.back();
  }

  _row(r) {
    const s = this.ctx.settings;
    const node = el('div.set-row', { parent: this.body, attrs: { role: 'group' } });
    el('span.set-label', { text: r.label, parent: node });
    const ctl = el('span.set-ctl', { parent: node });
    const prev = el('span.set-arrow', { text: '‹', parent: ctl });
    const val = el('span.set-val', { parent: ctl });
    const next = el('span.set-arrow', { text: '›', parent: ctl });
    let bar = null;
    if (r.type === 'slider') {
      bar = el('span.set-bar', { parent: ctl });
      ctl.insertBefore(bar, val);
      for (let i = 0; i < 10; i++) el('i', { parent: bar });
    }
    const get = () => {
      const v = s?.get(r.key);
      return r.invert ? !v : v;
    };
    const put = (v) => {
      s?.set(r.key, r.invert ? !v : v);
      paint();
    };
    const paint = () => {
      const v = get();
      if (r.type === 'toggle') {
        val.textContent = v ? 'Вкл' : 'Выкл';
        node.classList.toggle('off', !v);
      } else if (r.type === 'choice') {
        const f = r.values.find((x) => x[0] === v) || r.values.find((x) => Math.abs(Number(x[0]) - Number(v)) < 1e-6);
        val.textContent = f ? f[1] : String(v);
      } else {
        const t = (Number(v) - r.min) / (r.max - r.min);
        val.textContent = r.key === 'hudScale' ? `${Math.round(Number(v) * 100)}${NBSP}%` : `${Math.round(Number(v) * 100)}${NBSP}%`;
        const n = Math.round(Math.max(0, Math.min(1, t)) * 10);
        [...bar.children].forEach((c, i) => c.classList.toggle('on', i < n));
      }
    };
    const step = (dir) => {
      const v = get();
      if (r.type === 'toggle') put(!v);
      else if (r.type === 'choice') {
        let i = r.values.findIndex((x) => x[0] === v || Math.abs(Number(x[0]) - Number(v)) < 1e-6);
        if (i < 0) i = 0;
        i = (i + dir + r.values.length) % r.values.length;
        put(r.values[i][0]);
      } else {
        const nv = Math.round(Math.max(r.min, Math.min(r.max, Number(v) + dir * r.step)) * 100) / 100;
        put(nv);
      }
    };
    prev.addEventListener('click', (e) => {
      e.stopPropagation();
      step(-1);
      this.hud.emit('ui:hover', { menu: 'settings', adjust: -1 });
    });
    next.addEventListener('click', (e) => {
      e.stopPropagation();
      step(1);
      this.hud.emit('ui:hover', { menu: 'settings', adjust: 1 });
    });
    if (bar) {
      bar.addEventListener('click', (e) => {
        e.stopPropagation();
        const rc = bar.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width));
        put(Math.round((r.min + t * (r.max - r.min)) / r.step) * r.step);
        this.hud.emit('ui:hover', { menu: 'settings' });
      });
    }
    paint();
    const item = {
      el: node,
      help: r.help,
      onLeft: () => step(-1),
      onRight: () => step(1),
      onActivate: () => (r.type === 'slider' ? null : step(1)),
    };
    return { r, node, paint, item };
  }

  show(opts) {
    super.show(opts);
    for (const row of this.rows) row.paint();
    if (!opts?.returning) this.menu.focus(0, true);
    this.help.textContent = this.menu.current?.help || '';
    this.node.classList.toggle('over-play', this.ctx.mode === 'paused');
  }

  onSettings() {
    if (this.visible) for (const row of this.rows) row.paint();
  }
}
