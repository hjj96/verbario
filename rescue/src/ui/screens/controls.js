// УПРАВЛЕНИЕ (DESIGN §3.2): the controls card — keyboard + mouse and gamepad columns with keycaps,
// built from core/input.js BINDINGS (keys by event.code, so ЙЦУКЕН works; Ctrl is never used).
import { el } from '../common/dom.js';
import { Menu } from '../common/nav.js';
import { keycap } from '../common/icons.js';
import { BINDINGS } from '../../core/input.js';
import { Screen } from './screen.js';

const CODE = {
  Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: '', Escape: 'Esc', Backspace: '⌫', Enter: 'Enter', NumpadEnter: '',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn', Tab: 'Tab',
  Mouse0: 'ЛКМ', Mouse2: 'ПКМ', Backquote: '`',
};
const keyName = (code) => {
  if (code in CODE) return CODE[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return '';
  return code;
};
const caps = (codes) => codes.map(keyName).filter(Boolean).map(keycap).join('');

// [label, keyboard keys (codes or HTML), gamepad]
const ROWS = () => {
  const B = BINDINGS.buttons;
  const A = BINDINGS.axes;
  return [
    ['Полёт (по экрану, север вверху)', caps(['KeyW', 'KeyA', 'KeyS', 'KeyD']) + ' / ' + caps(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']), 'левый стик'],
    ['Набор высоты (держать)', caps(A.lift[1]), 'RT'],
    ['Снижение (держать)', caps(A.lift[0]), 'LT'],
    ['Высота 15 / 40 / 90 м', caps(['Digit1', 'Digit2', 'Digit3']), 'D-pad ↑ / ↓'],
    ['Цель высоты ±5 м', 'колесо мыши', '—'],
    ['Лебёдка (держать)', caps(B.winch), 'A'],
    ['Форсаж (держать)', caps(['ShiftLeft']), 'LB'],
    ['Прожектор вкл/выкл · наводится курсором', caps(B.searchlight), 'X · правый стик'],
    ['Фальшфейер к курсору', caps(B.flare), 'B'],
    ['Сбросить плот', caps(B.raftDrop), 'D-pad →'],
    ['Громкоговоритель', caps(B.horn), 'Y'],
    ['Карта (держать)', caps(B.map), 'View'],
    ['Зум камеры', caps(B.zoom), 'RB'],
    ['Пауза', caps(B.pause), 'Start'],
  ];
};

export class ControlsScreen extends Screen {
  constructor(hud) {
    super(hud, 'scr-controls');
    const sheet = el('div.ctl-sheet.paper', { parent: this.node });
    const head = el('div.set-head', { parent: sheet });
    el('h2.set-title', { text: 'УПРАВЛЕНИЕ', parent: head });
    el('div.set-form', { text: 'ИНСТРУКЦИЯ ЭКИПАЖУ «ЧАЙКИ-07»', parent: head });
    const tbl = el('div.ctl-table', { parent: sheet });
    el('div.ctl-row.ctl-th', { parent: tbl, html: '<span>действие</span><span>клавиатура и мышь</span><span>геймпад</span>' });
    for (const [label, kb, pad] of ROWS()) el('div.ctl-row', { parent: tbl, html: `<span>${label}</span><span>${kb}</span><span class="pad">${pad}</span>` });
    el('div.ctl-notes', {
      parent: sheet,
      html:
        '<p>Нос смотрит на курсор, пока двигается мышь или горит прожектор, иначе — по курсу. Выпущенный трос включает точный режим: машина слушается вдвое мягче.</p>' +
        '<p>Висите в зелёной полосе «ЛЕБ.» (12–25 м), держите корзину в пунктирном круге — кольцо захвата заполнится само. Ниже 12 м поток от винта сдувает пловцов.</p>' +
        '<p>Клавиши привязаны к физическим кнопкам — работает и русская раскладка. Ctrl не используется.</p>',
    });
    const foot = el('div.set-foot', { parent: sheet });
    this.bDone = el('div.btn.btn-primary', { text: 'ПОНЯТНО', parent: foot, attrs: { role: 'button' } });
    this.menu = new Menu(hud, { name: 'controls', onBack: () => this.hud.back() });
    this.menu.setItems([{ el: this.bDone, onActivate: () => this.hud.back() }]);
  }
}
