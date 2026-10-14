// Person records for the cabin, the radio and the logbook (DESIGN §3.5 pickup, §7.7 «Манифест»):
//   { name, first, surname, gender, age, child, occupation, condition, warmthAtLift, minutesInWater,
//     tags, quote, injured, type, tag, label, pet }
// Names come from the mission's own manifest (def.people) when it has one, so the logbook and the
// cabin agree; otherwise a seeded fallback with grammatically correct surnames (Иванов / Иванова).
import { createRng } from '../../core/math.js';

const FIRST_M = ['Андрей', 'Алексей', 'Сергей', 'Дмитрий', 'Михаил', 'Николай', 'Павел', 'Игорь', 'Виктор', 'Олег', 'Юрий', 'Степан', 'Фёдор', 'Григорий', 'Роман', 'Евгений', 'Василий', 'Егор', 'Пётр', 'Борис', 'Матвей', 'Илья'];
const FIRST_F = ['Мария', 'Анна', 'Ольга', 'Елена', 'Наталья', 'Татьяна', 'Ирина', 'Светлана', 'Дарья', 'Ксения', 'Вера', 'Галина', 'Алёна', 'Полина', 'Софья', 'Юлия', 'Надежда', 'Зоя', 'Варвара'];
const CHILD_M = ['Миша', 'Ваня', 'Тёма', 'Сёма', 'Лёва', 'Петя'];
const CHILD_F = ['Маша', 'Аня', 'Соня', 'Варя', 'Даша', 'Катя'];
const SURNAMES = ['Иванов', 'Смирнов', 'Кузнецов', 'Соколов', 'Лебедев', 'Морозов', 'Волков', 'Павлов', 'Семёнов', 'Голубев', 'Богданов', 'Воробьёв', 'Фёдоров', 'Беляев', 'Комаров', 'Орлов', 'Макаров', 'Ковалёв', 'Ильин', 'Гусев', 'Титов', 'Баранов', 'Сорокин', 'Захаров', 'Медведев', 'Ершов', 'Никитин', 'Соболев', 'Рябов', 'Крылов', 'Бобров', 'Громов', 'Хабаров', 'Поморцев', 'Шубин', 'Нечаев', 'Корельский', 'Мезенцев', 'Двинской', 'Шергин', 'Чупров', 'Белых', 'Седых', 'Шевчук'];

export function feminize(s) {
  if (/(ов|ев|ёв|ин|ын)$/.test(s)) return s + 'а';
  if (/ский$/.test(s)) return s.replace(/ский$/, 'ская');
  if (/цкий$/.test(s)) return s.replace(/цкий$/, 'цкая');
  if (/ской$/.test(s)) return s.replace(/ской$/, 'ская');
  return s; // Белых, Седых, Шевчук — unchanged
}

// Occupations by group type: [masculine, feminine | null (men only), weight]
const JOBS = {
  swimmer: [['рыбак', 'рыбачка', 3], ['турист', 'туристка', 2], ['матрос', null, 2], ['яхтсмен', 'яхтсменка', 1.5], ['кок с сухогруза', 'кок с сухогруза', 0.6]],
  raft: [['пассажир', 'пассажирка', 3], ['рыбак', 'рыбачка', 2], ['матрос', null, 2], ['моторист', null, 1], ['буфетчик', 'буфетчица', 0.8]],
  hull: [['рыбак', 'рыбачка', 4], ['капитан мотодоры', null, 0.8], ['моторист', null, 1.2], ['яхтсмен', 'яхтсменка', 1]],
  container: [['матрос «Полярного ветра»', null, 3], ['боцман', null, 1], ['кок с сухогруза', 'кок с сухогруза', 1], ['электромеханик', null, 1]],
  injured: [['тралмейстер', null, 1], ['матрос', null, 2], ['рыбак', 'рыбачка', 2], ['пассажир', 'пассажирка', 1]],
  deck: [['помощник бурильщика', null, 2], ['электрик', null, 1.5], ['оператор по добыче', 'оператор по добыче', 1.5], ['повар буровой', 'повар буровой', 1], ['вахтовик', null, 1.5]],
  wreck: [['пассажир', 'пассажирка', 4], ['студент', 'студентка', 1.5], ['пенсионер', 'пенсионерка', 1.5], ['матрос «Северянки»', null, 1], ['учитель из Териберки', 'учительница из Териберки', 0.8]],
  plane: [['доктор', 'доктор', 1], ['почтальон', 'почтальон', 1], ['ветеринар', 'ветеринар', 1], ['пассажир', 'пассажирка', 2]],
};

function pickJob(rng, list, gender) {
  const ok = list.filter((j) => (gender === 'm' ? j[0] : j[1]));
  let sum = 0;
  for (const j of ok) sum += j[2];
  let r = rng.next() * sum;
  for (const j of ok) if ((r -= j[2]) <= 0) return j;
  return ok[ok.length - 1];
}

// Seeded fallback manifest for a group (when the def carries no people).
export function makeFallbackPeople(seed, type, count) {
  const rng = createRng((seed >>> 0) * 2654435761 + 977);
  const jobs = JOBS[type] || JOBS.swimmer;
  const out = [];
  for (let i = 0; i < count; i++) {
    let gender = rng.next() < 0.3 ? 'f' : 'm';
    let job = pickJob(rng, jobs, gender);
    if (!job) {
      gender = gender === 'm' ? 'f' : 'm';
      job = pickJob(rng, jobs, gender);
    }
    const child = type === 'wreck' && rng.next() < 0.12;
    const age = child ? rng.int(7, 12) : rng.int(19, 66);
    const first = child ? rng.pick(gender === 'f' ? CHILD_F : CHILD_M) : rng.pick(gender === 'f' ? FIRST_F : FIRST_M);
    const base = rng.pick(SURNAMES);
    const surname = gender === 'f' ? feminize(base) : base;
    out.push({ name: `${first} ${surname}`, first, surname, gender, age, child, occupation: child ? (gender === 'f' ? 'школьница' : 'школьник') : gender === 'f' ? job[1] : job[0] });
  }
  return out;
}

export function guessGender(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (/(а|я)$/.test(first) && !/^(Илья|Никита|Савва|Лука|Фома|Кузьма|Миша|Ваня|Тёма|Сёма|Лёва|Костя|Петя|Саша)$/.test(first)) return 'f';
  return 'm';
}

// Condition at lift (warmth 0..1). The heli's default record says «стабилен»; we are more precise.
export function conditionFor(warmth, injured) {
  if (injured) return warmth < 0.35 ? 'травма, переохлаждение' : 'травма';
  if (warmth < 0.15) return 'сильное переохлаждение, без сознания';
  if (warmth < 0.3) return 'сильное переохлаждение';
  if (warmth < 0.6) return 'переохлаждение';
  return 'стабильное';
}

// Logbook quotes chosen by tags (most specific first). [tags, masculine, feminine?]
const QUOTES = [
  [['any'], 'Я видел, как вы развернулись над нами. Этот звук я не забуду.', 'Я видела, как вы развернулись над нами. Этот звук я не забуду.'],
  [['any'], 'Сначала услышал вас, потом поверил.', 'Сначала услышала вас, потом поверила.'],
  [['any'], 'Корзина пришла прямо в руки. Как будто так и надо.'],
  [['night'], 'Сначала был только ваш свет. Он шёл по воде, как будто искал меня лично.'],
  [['night'], 'Полоска на жилете вспыхнула — и вы сразу развернулись. Я это видел.', 'Полоска на жилете вспыхнула — и вы сразу развернулись. Я это видела.'],
  [['storm'], 'Волна накрыла, я досчитал до семи и вынырнул. А потом — вы.', 'Волна накрыла, я досчитала до семи и вынырнула. А потом — вы.'],
  [['fog'], 'Мы слышали вас минут десять, прежде чем увидели. Кричали в молоко.'],
  [['long', 'cold'], 'Пальцы перестали слушаться. Я держался зубами за свисток.', 'Пальцы перестали слушаться. Я держалась зубами за свисток.'],
  [['raft'], 'В плоту мы рассказывали анекдоты. Плохие. Смеялись всё равно.'],
  [['raft'], 'Лампа на тенте мигает раз в секунду. Я считал вспышки, чтобы не уснуть.', 'Лампа на тенте мигает раз в секунду. Я считала вспышки, чтобы не уснуть.'],
  [['hull'], 'Держались за киль втроём. Он скользкий, как совесть.'],
  [['deck'], 'Снизу казалось, что вы висите на нитке. А вы висели как вкопанные.'],
  [['wreck'], 'Крен рос, а мы держались за флагшток и друг за друга.'],
  [['container'], 'Контейнер — плохой плот. Но лучше, чем никакой.'],
  [['child'], 'А можно я потом покручу этот… пропеллер?'],
  [['injured'], 'Помню только корзину и чьи-то руки. Спасибо этим рукам.'],
  [['flower'], 'Мы держались за руки кругом. Так теплее и не страшно.'],
  [['pet'], 'Он сам залез ко мне под куртку. Умный зверь.'],
];

export function quoteFor(rng, gender, tags, used) {
  const f = gender === 'f';
  for (const tag of tags) {
    const pool = QUOTES.filter((q) => q[0].includes(tag) && !used.has(q[1]));
    if (pool.length && (tag === 'any' || rng.next() < 0.7)) {
      const q = rng.pick(pool);
      used.add(q[1]);
      return f && q[2] ? q[2] : q[1];
    }
  }
  const q = rng.pick(QUOTES.filter((x) => x[0].includes('any')));
  return f && q[2] ? q[2] : q[1];
}
