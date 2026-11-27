// The tab model, tuning presets and plain-text rendering.
//
// A song's tab looks like this (strings are always highest-pitched first, as on the page):
//   { strings: 6, tuning: ['E','B','G','D','A','E'],
//     bars: [ { columns: [ { above: 'PM', notes: ['', '', '', '', '', '0'] }, … ] }, … ] }
// Each note is a short text token, just as you'd write it in text tab: "5", "5h7", "7b9", "x", "<12>".

export const DEFAULT_COLUMNS = 8;

export const TUNING_PRESETS = {
  6: [
    { name: 'Standard', notes: ['E', 'B', 'G', 'D', 'A', 'E'] },
    { name: 'Drop D', notes: ['E', 'B', 'G', 'D', 'A', 'D'] },
    { name: 'E♭ standard', notes: ['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb'] },
    { name: 'D standard', notes: ['D', 'A', 'F', 'C', 'G', 'D'] },
    { name: 'Drop C', notes: ['D', 'A', 'F', 'C', 'G', 'C'] },
    { name: 'DADGAD', notes: ['D', 'A', 'G', 'D', 'A', 'D'] },
    { name: 'Open G', notes: ['D', 'B', 'G', 'D', 'G', 'D'] },
    { name: 'Open D', notes: ['D', 'A', 'F#', 'D', 'A', 'D'] },
    { name: 'Open E', notes: ['E', 'B', 'G#', 'E', 'B', 'E'] }
  ],
  7: [
    { name: 'Standard', notes: ['E', 'B', 'G', 'D', 'A', 'E', 'B'] },
    { name: 'Drop A', notes: ['E', 'B', 'G', 'D', 'A', 'E', 'A'] },
    { name: 'A standard', notes: ['D', 'A', 'F', 'C', 'G', 'D', 'A'] },
    { name: 'B♭ standard', notes: ['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb'] }
  ]
};

// The annotations available from the toolbar. `insert` is appended to the current note.
export const TECHNIQUES = [
  { id: 'h', label: 'h', title: 'Hammer-on (e.g. 5h7)', insert: 'h' },
  { id: 'p', label: 'p', title: 'Pull-off (e.g. 7p5)', insert: 'p' },
  { id: 'slide-up', label: '/', title: 'Slide up (e.g. 5/7)', insert: '/' },
  { id: 'slide-down', label: '\\', title: 'Slide down (e.g. 7\\5)', insert: '\\' },
  { id: 'b', label: 'b', title: 'Bend (e.g. 7b9)', insert: 'b' },
  { id: 'r', label: 'r', title: 'Release (e.g. 7b9r7)', insert: 'r' },
  { id: 'vibrato', label: '~', title: 'Vibrato (e.g. 7~)', insert: '~' },
  { id: 'tap', label: 't', title: 'Tapped note (e.g. t12)', prefix: 't' },
  { id: 'mute', label: 'x', title: 'Muted / dead note', replace: 'x' },
  { id: 'harmonic', label: '<>', title: 'Natural harmonic (e.g. <12>)', wrap: ['<', '>'] }
];

export function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
}

export function blankColumn(strings) {
  return { above: '', notes: Array(strings).fill('') };
}

export function blankBar(strings, columns = DEFAULT_COLUMNS) {
  return { columns: Array.from({ length: columns }, () => blankColumn(strings)) };
}

export function newSong() {
  return {
    name: 'Untitled song',
    date: today(),
    notes: '',
    strings: 6,
    tuning: [...TUNING_PRESETS[6][0].notes],
    bars: Array.from({ length: 4 }, () => blankBar(6))
  };
}

// Make sure a song's tab is well-formed: used on songs from an image import, and on
// anything loaded from GitHub (where a file could have been edited by hand).
export function sanitiseTab(input = {}) {
  const strings = Number(input.strings) === 7 ? 7 : 6;
  const clean = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

  const tuning = Array.from({ length: strings }, (_, i) => {
    const note = Array.isArray(input.tuning) ? clean(input.tuning[i], 4).trim() : '';
    return note || TUNING_PRESETS[strings][0].notes[i];
  });

  const bars = (Array.isArray(input.bars) ? input.bars : []).map((bar) => {
    const columns = (Array.isArray(bar?.columns) ? bar.columns.slice(0, 64) : []).map((column) => ({
      above: clean(column?.above, 32),
      notes: Array.from({ length: strings }, (_, i) =>
        Array.isArray(column?.notes) ? clean(column.notes[i], 16).replace(/\s+/g, '') : ''
      )
    }));
    if (!columns.length) columns.push(blankColumn(strings));
    return { columns };
  });
  if (!bars.length) bars.push(blankBar(strings));

  return { strings, tuning, bars };
}

export function presetFor(strings, tuning) {
  return TUNING_PRESETS[strings].find((preset) => preset.notes.join() === tuning.join()) || null;
}

// Switching between 6 and 7 strings adds or removes the lowest string.
export function setStringCount(song, strings) {
  if (strings === song.strings) return;

  if (strings === 7) {
    const preset = presetFor(6, song.tuning);
    const sevenStringMatch = preset && TUNING_PRESETS[7].find((p) => p.name === preset.name);
    song.tuning = sevenStringMatch ? [...sevenStringMatch.notes] : [...song.tuning, 'B'];
    song.bars.forEach((bar) => bar.columns.forEach((column) => column.notes.push('')));
  } else {
    song.tuning = song.tuning.slice(0, 6);
    song.bars.forEach((bar) => bar.columns.forEach((column) => column.notes.splice(6)));
  }

  song.strings = strings;
}

export function lowestStringHasNotes(song) {
  const last = song.strings - 1;
  return song.bars.some((bar) => bar.columns.some((column) => column.notes[last]));
}

export function tuningLabel(song) {
  const preset = presetFor(song.strings, song.tuning);
  const lowToHigh = [...song.tuning].reverse().join(' ');
  return preset ? `${preset.name} (${lowToHigh})` : lowToHigh;
}

// ——— Plain-text rendering ————————————————————————————————————————————————

function renderBar(bar, strings) {
  const widths = bar.columns.map((column) => Math.max(1, ...column.notes.map((note) => note.length)));

  const stringLines = Array.from({ length: strings }, (_, s) =>
    bar.columns.map((column, c) => '-' + column.notes[s].padEnd(widths[c], '-')).join('') + '-'
  );

  // Text above the staff starts at its column and may run on into the space after it.
  const length = stringLines[0].length;
  const above = Array(length).fill(' ');
  let position = 1;
  bar.columns.forEach((column, c) => {
    [...column.above].forEach((char, i) => {
      if (position + i < length) above[position + i] = char;
    });
    position += widths[c] + 1;
  });

  return { above: above.join(''), lines: stringLines, length };
}

// Returns the tab as "systems" (rows of bars that fit within `width` characters),
// each an array of text lines. Used by both the .txt and PDF exports.
export function songToSystems(song, width = 80) {
  const labelWidth = Math.max(...song.tuning.map((note) => note.length));
  const labels = song.tuning.map((note) => note.padEnd(labelWidth, ' '));
  const rendered = song.bars.map((bar) => renderBar(bar, song.strings));

  const systems = [];
  let current = [];
  let currentLength = labelWidth + 1;

  rendered.forEach((bar) => {
    if (current.length && currentLength + bar.length + 1 > width) {
      systems.push(current);
      current = [];
      currentLength = labelWidth + 1;
    }
    current.push(bar);
    currentLength += bar.length + 1;
  });
  if (current.length) systems.push(current);

  return systems.map((bars) => {
    const aboveLine = ' '.repeat(labelWidth + 1) + bars.map((bar) => bar.above + ' ').join('');
    const lines = labels.map((label, s) => label + '|' + bars.map((bar) => bar.lines[s] + '|').join(''));
    return aboveLine.trim() ? [aboveLine.trimEnd(), ...lines] : lines;
  });
}

export function songHeader(song) {
  return [
    song.name,
    `Date: ${song.date}`,
    `${song.strings}-string, tuning: ${tuningLabel(song)}`
  ];
}

export function songToText(song, width = 80) {
  const parts = [songHeader(song).join('\n')];
  if (song.notes.trim()) parts.push(song.notes.trim());
  songToSystems(song, width).forEach((lines) => parts.push(lines.join('\n')));
  return parts.join('\n\n') + '\n';
}
