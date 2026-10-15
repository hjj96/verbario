// Keycap labels for KeyboardEvent.code values (layout independent: ЙЦУКЕН shows the Latin cap of the same
// physical key) and the mouse buttons Input binds as Mouse0 / Mouse2.
const NAMES = {
  Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Shift П', Escape: 'Esc', Backspace: '⌫', Enter: 'Enter',
  NumpadEnter: 'Num Enter', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp',
  PageDown: 'PgDn', Tab: 'Tab', Mouse0: 'ЛКМ', Mouse2: 'ПКМ', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Backslash: '\\', IntlBackslash: '\\', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
};
const NUM = { Add: '+', Subtract: '−', Multiply: '×', Divide: '/', Decimal: '.' };

export function keyLabel(code) {
  if (!code) return '—';
  if (code in NAMES) return NAMES[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `Num${m[1]}`;
  if ((m = /^Numpad(.+)$/.exec(code))) return `Num ${NUM[m[1]] || m[1]}`;
  return code.replace(/[<>&"]/g, '');
}
