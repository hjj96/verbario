// Radio line catalogue (DESIGN §5): 61 lines + a few contextual variants, by id.
//
//   s   speaker   'dispatch'|'pilot'|'winchman'|'survivor'|'ship'|'coastguard' (CONTRACT)
//   n   caption   (HUD subtitle header); defaults per speaker below
//   ch  channel   'ext' (КАН 16) | 'ics' (СПУ) | 'handheld' (РАЦИЯ); defaults per speaker below
//   p   priority  3 critical (interrupts 1) · 2 gameplay · 1 flavour (only after 12 s of silence)
//   t   text      Russian; {placeholders} are filled by radio.line(id, vars) — see radio/words.js
//   v   voice     audio-only hint: 'rescuer' (Костя), 'f' (woman), 'child', 'm' — picks f0 for the babble
//   cd  cooldown  seconds before the same id may play again (default 300, DESIGN §5 «не повторяется 300 с»;
//                 shorter for gameplay confirmations that are the point of the exchange)
//   age max queue age in seconds before a waiting line is dropped as stale
//   fx  'megaphone' — the audio engine plays it through the loudspeaker chain instead of the radio
//
// Lines the mission director says itself through radio.say() with the same ids (s_vhf, s_ferry, c_help,
// c_light, sh_cargo, d_cat, d_eye, d_clear, w_gulls, p_rocket, d_call-N) are de-duplicated by id.

export const SPEAKER_DEFAULTS = {
  dispatch: { n: 'БЕРЕГ', ch: 'ext' },
  pilot: { n: 'ВТОРОЙ ПИЛОТ', ch: 'ics' },
  winchman: { n: 'БОРТОПЕРАТОР', ch: 'ics' },
  rescuer: { n: 'СПАСАТЕЛЬ', ch: 'ics' },
  survivor: { n: 'ПОСТРАДАВШИЙ', ch: 'handheld' },
  ship: { n: 'АРКТУР', ch: 'ext' },
  coastguard: { n: 'СТОРОЖ-7', ch: 'ext' },
};

export const LINES = {
  // ---- «Берег» (Марина), КАН 16 -------------------------------------------------------------------
  d_start: { s: 'dispatch', p: 2, t: 'Чайка ноль-седьмой, Берег. Сработал аварийный буй, квадрат {square}. В воде предположительно {count}. Работайте.' },
  d_datum: { s: 'dispatch', p: 2, t: 'Последний контакт — {dir}, {dist}. Район поиска обозначила.' },
  d_call: { s: 'dispatch', p: 2, cd: 1, t: 'Чайка, Берег. Новый вызов: {what}, квадрат {square}, {count}.' },
  d_front: { s: 'dispatch', p: 2, cd: 200, t: 'Всем бортам в районе: давление падает, ветер {dir}, порывы до {gust}.' },
  d_spout: { s: 'dispatch', p: 3, cd: 900, t: 'Чайка, метео сообщает: над морем формируются смерчи. Ближе трёхсот метров не подходить.' },
  d_rogue: { s: 'dispatch', p: 3, cd: 40, age: 6, t: 'Чайка, {dir} идёт аномальная волна. Наберите высоту, быстро!' },
  d_night: { s: 'dispatch', p: 2, cd: 900, t: 'Чайка, стемнело. Работайте прожектором, ищите по светоотражающим полосам.' },
  d_bingo: { s: 'dispatch', p: 3, cd: 240, t: 'Чайка, у вас бинго по топливу. Немедленно на заправку, это приказ.' },
  d_outside: { s: 'dispatch', p: 2, cd: 120, t: 'Чайка, вы вне района поиска. Возвращайтесь.' },
  d_lost: { s: 'dispatch', p: 2, cd: 20, t: 'Чайка, Берег… Сигнал из квадрата {square} пропал. Работаем дальше.' },
  d_eye: { s: 'dispatch', p: 3, t: 'Чайка, вы в глазе. У вас минута, не больше. Потом ветер развернётся.' },
  d_clear: { s: 'dispatch', p: 1, age: 60, t: 'Фронт уходит на восток. Над вашим районом прояснение.' },
  d_refuel: { s: 'dispatch', p: 1, cd: 150, age: 30, t: 'Принято, Чайка. Заправляйтесь.' },
  d_cat: { s: 'dispatch', p: 1, age: 60, t: 'Чайка, повторите, сколько на борту. …Четверо и кот? Принято, кот засчитан.' },
  d_success: { s: 'dispatch', p: 3, cd: 30, age: 30, t: 'Чайка, Берег. Все найдены. Хорошая работа. Возвращайтесь — чайник уже кипит.' },
  d_fail: { s: 'dispatch', p: 3, cd: 30, age: 30, t: 'Чайка, Берег. Поиск передаём катерам. Возвращайтесь.' },
  d_crash: { s: 'dispatch', p: 3, cd: 30, age: 30, t: 'Чайка ноль-седьмой, Берег, ответьте… Чайка, приём…' },

  // ---- второй пилот Гордеев, СПУ --------------------------------------------------------------------
  p_spot: { s: 'pilot', p: 2, cd: 15, age: 8, t: 'Вижу человека! Оранжевый жилет, на {clock}, метров {dist}!' },
  p_spot_raft: { s: 'pilot', p: 2, cd: 15, age: 8, t: 'Плот! На {clock}, людей {count}.' },
  p_rocket: { s: 'pilot', p: 2, cd: 25, age: 4, t: 'Ракета! Красная, на {clock}!' },
  p_whistle: { s: 'pilot', p: 2, cd: 600, age: 6, t: 'Тихо… Слышишь? Свистят. Где-то {dir}.' },
  p_gust: { s: 'pilot', p: 1, cd: 90, age: 2.5, t: 'Порыв! Держи, держи…' },
  p_spout_near: { s: 'pilot', p: 3, cd: 45, age: 4, t: 'Командир, смерч {side}! Не лезь — затянет вместе с нами.' },
  p_green: { s: 'pilot', p: 2, cd: 900, t: 'Небо позеленело. Это плохо, командир. Это очень плохо.' },
  p_stelmo: { s: 'pilot', p: 3, cd: 30, age: 1.5, t: 'Огни на лопастях! Сейчас ударит — уходи!' },
  p_near_miss: { s: 'pilot', p: 2, cd: 60, age: 4, t: 'Рядом шарахнуло. Приборы живы?' },
  p_emp: { s: 'pilot', p: 3, cd: 30, age: 4, t: 'Приборы моргнули… РЛС перезагружается.' },
  p_bingo: { s: 'pilot', p: 3, cd: 240, t: 'Командир, топлива только на возврат.' },
  p_damage: { s: 'pilot', p: 2, cd: 600, t: 'Вибрация на хвостовом… Держимся.' },
  p_hull_crit: { s: 'pilot', p: 3, cd: 600, t: 'Машина не вытянет ещё один такой удар.' },
  p_deck: { s: 'pilot', p: 2, cd: 120, age: 10, t: 'Палуба гуляет. Лови момент, когда выровняется.' },
  // variants for the other group types (same moment as p_spot / p_spot_raft)
  p_spot_hull: { s: 'pilot', p: 2, cd: 15, age: 8, t: 'Лодка вверх дном! На {clock}, на киле {count}.' },
  p_spot_group: { s: 'pilot', p: 2, cd: 15, age: 8, t: 'Вижу людей! {what}, на {clock}, метров {dist}.' },
  p_thunder: { s: 'pilot', p: 1, cd: 300, age: 3, t: '{count}… {km} до грозы.' },

  // ---- бортоператор Семёныч, СПУ ---------------------------------------------------------------------
  w_ready: { s: 'winchman', p: 1, age: 45, t: 'Чай в термосе, трос смазан, Костя трезвый. Можно лететь.' },
  w_hover: { s: 'winchman', p: 2, cd: 45, age: 3, t: 'Висим. Трос пошёл…' },
  w_patter: { s: 'winchman', p: 2, cd: 0, age: 0.6, t: '{text}' },
  w_water: { s: 'winchman', p: 2, cd: 20, age: 2, t: 'Корзина в воде.' },
  w_in: { s: 'winchman', p: 2, cd: 8, age: 3, t: 'Человек в корзине. Подъём!' },
  w_aboard: { s: 'winchman', p: 2, cd: 25, age: 4, t: 'Человек на борту.' },
  w_low: { s: 'winchman', p: 3, cd: 30, age: 3, t: 'Выше держи! Ты его потоком сдуваешь!' },
  w_swing: { s: 'winchman', p: 2, cd: 40, age: 2, t: 'Раскачка! Не дёргай машину!' },
  w_slip: { s: 'winchman', p: 3, cd: 10, age: 3, t: 'Сорвался! Опускаю ещё раз.' },
  w_snag: { s: 'winchman', p: 3, cd: 10, age: 3, t: 'Трос захлестнуло волной! Освобождаю…' },
  w_full: { s: 'winchman', p: 2, cd: 90, age: 4, t: 'Всё, кабина полная, как маршрутка в час пик.' },
  w_raft: { s: 'winchman', p: 2, cd: 30, age: 3, t: 'Плот пошёл! Пусть гребут к нему.' },
  w_horn: { s: 'winchman', p: 2, cd: 5, age: 1.5, fx: 'megaphone', t: 'Внимание! Оставайтесь на месте! Мы вас видим!' },
  w_gulls: { s: 'winchman', p: 1, cd: 600, age: 40, t: 'Чайки снялись все разом. Не к добру.' },
  w_land: { s: 'winchman', p: 1, age: 25, t: 'Сели. Командир, с тебя пирожки за тот порыв.' },
  w_borsch: { s: 'winchman', p: 1, cd: 600, age: 20, t: 'Вот вернёмся — борща. И спать. Именно в таком порядке.' },

  // ---- спасатель Костя, СПУ ---------------------------------------------------------------------------
  k_injured: { s: 'winchman', n: 'СПАСАТЕЛЬ', v: 'rescuer', p: 2, cd: 60, age: 6, t: 'Сильное переохлаждение, пульс слабый. Давай быстрее.' },
  k_calm: { s: 'winchman', n: 'СПАСАТЕЛЬ', v: 'rescuer', p: 2, cd: 90, age: 4, t: 'Тихо, тихо, не хватайся за меня… Вот так. Держу.' },
  k_sun: { s: 'winchman', n: 'СПАСАТЕЛЬ', v: 'rescuer', p: 1, cd: 600, age: 60, t: 'Солнце! Я уж думал, его отменили.' },
  k_idle: { s: 'winchman', n: 'СПАСАТЕЛЬ', v: 'rescuer', p: 1, cd: 600, age: 20, t: 'Вода плюс восемь. Напоминаю: я на это не подписывался. А, нет, подписывался.' },

  // ---- пострадавшие, ручная рация -------------------------------------------------------------------------
  s_shout: { s: 'survivor', p: 1, cd: 90, age: 6, t: 'Сюда! Мы здесь! Сюда!' },
  s_vhf: { s: 'survivor', p: 2, t: '…кто-нибудь слышит… плот… нас четверо… видим огни…' },
  s_ferry: { s: 'survivor', p: 2, t: 'Нас ещё восемь на корме! Быстрее, крен растёт!' },
  s_thanks: { s: 'survivor', n: 'ПОСТРАДАВШАЯ', ch: 'ics', v: 'f', p: 1, cd: 600, age: 40, t: 'Спасибо… Я уже перестала чувствовать пальцы.' },
  s_child: { s: 'survivor', n: 'РЕБЁНОК', ch: 'ics', v: 'child', p: 1, cd: 900, age: 40, t: 'А можно я потом покручу этот… пропеллер?' },
  s_dog: { s: 'survivor', n: 'РЫБАК', v: 'm', p: 1, cd: 900, age: 20, t: 'Сначала собаку! Без Бобика никуда не полечу!' },

  // ---- суда и берег ---------------------------------------------------------------------------------------
  sh_deck: { s: 'ship', n: 'АРКТУР', p: 2, cd: 120, age: 10, t: 'Чайка, «Арктур». Палуба свободна, ветер на палубе {wind}, качка {pitch}.' },
  sh_cargo: { s: 'ship', n: 'ПОЛЯРНЫЙ ВЕТЕР', p: 2, t: 'Чайка, сухогруз «Полярный ветер». У нас смыло контейнеры, на одном люди.' },
  c_help: { s: 'coastguard', n: 'СТОРОЖ-7', p: 2, t: 'Берег, Сторож-7. Плот у нас, двоих забираем сами. Вертолёт — на остальных.' },
  c_light: { s: 'coastguard', n: 'МАЯК «СКАЛИСТЫЙ»', p: 2, t: 'Чайка, Скалистый. Даю ревун каждые тридцать секунд — идите на звук.' },
};

// The 61 ids of the DESIGN §5 table (the rest of LINES are contextual variants).
export const DESIGN_IDS = [
  'd_start', 'd_datum', 'd_call', 'd_front', 'd_spout', 'd_rogue', 'd_night', 'd_bingo', 'd_outside', 'd_lost', 'd_eye',
  'd_clear', 'd_refuel', 'd_cat', 'd_success', 'd_fail', 'd_crash',
  'p_spot', 'p_spot_raft', 'p_rocket', 'p_whistle', 'p_gust', 'p_spout_near', 'p_green', 'p_stelmo', 'p_near_miss',
  'p_emp', 'p_bingo', 'p_damage', 'p_hull_crit', 'p_deck',
  'w_ready', 'w_hover', 'w_patter', 'w_water', 'w_in', 'w_aboard', 'w_low', 'w_swing', 'w_slip', 'w_snag', 'w_full',
  'w_raft', 'w_horn', 'w_gulls', 'w_land', 'w_borsch',
  'k_injured', 'k_calm', 'k_sun', 'k_idle',
  's_shout', 's_vhf', 's_ferry', 's_thanks', 's_child', 's_dog',
  'sh_deck', 'sh_cargo', 'c_help', 'c_light',
];

// Base voice per speaker id (audio picks f0 from it; DESIGN §6.4).
export function voiceOf(speaker, entry) {
  if (entry && entry.v) return entry.v === 'rescuer' ? 'rescuer' : entry.v;
  return speaker;
}
