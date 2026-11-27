// The song editor: song details, tuning, and the tab grid itself.

import { api } from './store.js';
import { exportText, exportPdf } from './export.js';
import {
  TUNING_PRESETS,
  TECHNIQUES,
  blankBar,
  blankColumn,
  presetFor,
  setStringCount,
  lowestStringHasNotes
} from './tab.js';

// Each save is a commit to GitHub, so wait for a pause in typing before saving.
const SAVE_DELAY = 2500;
const RETRY_DELAY = 5000;
const ABOVE = -1; // row index for the annotation row above the staff

// A loose check for tokens we recognise, so typos (or misreads from an import) stand out.
const NOTE_PATTERN = /^(?:t?\d{1,2}|x|<\d{1,2}>)(?:[hp/\\]\d{1,2}|b\d{1,2}(?:r\d{1,2})?|~)*~?$/;

export function renderEditor(root, song, { onDeleted, readOnly = false }) {
  const template = document.getElementById('editor-template');
  root.replaceChildren(template.content.cloneNode(true));

  const $ = (selector) => root.querySelector(selector);
  const sheet = $('section.tab-sheet');
  const statusEl = $('span.save-status');

  // Where the cursor is: which bar, column and row (string index, or ABOVE).
  let focus = { bar: 0, col: 0, row: 0 };

  // ——— Saving ————————————————————————————————————————————————

  let saveTimer = null;
  let saving = false;
  let dirty = false;

  function setStatus(text, state = '') {
    statusEl.textContent = text;
    statusEl.dataset.state = state;
  }

  function changed() {
    if (readOnly) return;
    dirty = true;
    setStatus('Unsaved changes', 'pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
  }

  async function save() {
    if (saving) {
      saveTimer = setTimeout(save, SAVE_DELAY);
      return;
    }
    if (!dirty) return;
    saving = true;
    dirty = false;
    setStatus('Saving…', 'pending');
    try {
      await api.saveSong(song);
      if (!dirty) setStatus('Saved', 'saved');
    } catch (error) {
      dirty = true;
      setStatus(`Couldn’t save (${error.message}). Retrying…`, 'error');
      saveTimer = setTimeout(save, RETRY_DELAY);
    } finally {
      saving = false;
    }
  }

  // Called when leaving the editor, so the last keystrokes aren't lost.
  async function flush() {
    clearTimeout(saveTimer);
    while (saving) await new Promise((resolve) => setTimeout(resolve, 100));
    if (dirty) await save();
  }

  // A save is several requests to GitHub, which can't finish once the tab has closed,
  // so ask before closing with changes still unsaved.
  function warnIfUnsaved(event) {
    if (dirty || saving) event.preventDefault();
  }

  window.addEventListener('beforeunload', warnIfUnsaved);
  setStatus(readOnly ? '' : 'Saved', readOnly ? '' : 'saved');

  // ——— Song details ————————————————————————————————————————————

  const nameInput = $('#song-name');
  const dateInput = $('#song-date');
  const stringsSelect = $('#song-strings');
  const tuningSelect = $('#song-tuning');
  const notesInput = $('#song-notes');

  nameInput.value = song.name;
  dateInput.value = song.date;
  notesInput.value = song.notes;
  stringsSelect.value = String(song.strings);

  nameInput.addEventListener('input', () => {
    song.name = nameInput.value;
    document.title = `${song.name || 'Untitled song'} – Tablature`;
    changed();
  });
  dateInput.addEventListener('change', () => {
    if (dateInput.value) {
      song.date = dateInput.value;
      changed();
    }
  });
  notesInput.addEventListener('input', () => {
    song.notes = notesInput.value;
    changed();
  });

  stringsSelect.addEventListener('change', () => {
    const strings = Number(stringsSelect.value);
    if (strings === 6 && lowestStringHasNotes(song)) {
      const ok = confirm('Switching to 6 strings will remove the notes on the low 7th string. Continue?');
      if (!ok) {
        stringsSelect.value = '7';
        return;
      }
    }
    setStringCount(song, strings);
    focus.row = Math.min(focus.row, strings - 1);
    renderTuning();
    renderSheet();
    changed();
  });

  function renderTuning() {
    const preset = presetFor(song.strings, song.tuning);
    tuningSelect.replaceChildren(
      ...TUNING_PRESETS[song.strings].map((p) => new Option(p.name, p.name, false, p === preset))
    );
    if (!preset) tuningSelect.append(new Option('Custom', '', true, true));

    // Inputs are shown low to high (how guitarists usually say a tuning), but stored high to low.
    const container = $('div.tuning__strings');
    container.replaceChildren(
      ...song.tuning
        .map((note, index) => {
          const number = index + 1;
          const input = document.createElement('input');
          input.className = 'tuning__string';
          input.type = 'text';
          input.value = note;
          input.maxLength = 3;
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.setAttribute('aria-label', `String ${number}${number === 1 ? ' (highest)' : ''} tuning`);
          input.addEventListener('input', () => {
            song.tuning[index] = input.value.trim();
            refreshTuningPreset();
            updateLabels();
            changed();
          });
          input.addEventListener('blur', () => {
            if (!input.value.trim()) {
              input.value = song.tuning[index] = 'E';
              updateLabels();
              changed();
            }
          });
          return input;
        })
        .reverse()
    );
  }

  function refreshTuningPreset() {
    const preset = presetFor(song.strings, song.tuning);
    tuningSelect.querySelector('option[value=""]')?.remove();
    if (preset) tuningSelect.value = preset.name;
    else tuningSelect.append(new Option('Custom', '', true, true));
  }

  tuningSelect.addEventListener('change', () => {
    const preset = TUNING_PRESETS[song.strings].find((p) => p.name === tuningSelect.value);
    if (!preset) return;
    song.tuning = [...preset.notes];
    renderTuning();
    updateLabels();
    changed();
  });

  // ——— Original photo ——————————————————————————————————————————

  if (song.hasImage) {
    const source = $('details.song__source');
    source.hidden = false;
    source.addEventListener(
      'toggle',
      async () => {
        try {
          source.querySelector('img').src = await api.imageUrl(song.id);
        } catch (error) {
          source.querySelector('img').alt = `Couldn’t load the photo: ${error.message}`;
        }
      },
      { once: true }
    );
  }

  // ——— The tab grid ————————————————————————————————————————————

  function cellInput(barIndex, colIndex, row, value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.bar = barIndex;
    input.dataset.col = colIndex;
    input.dataset.row = row;
    input.setAttribute('autocapitalize', 'off');
    if (row === ABOVE) {
      input.className = 'bar__above';
      input.maxLength = 32;
      input.setAttribute('aria-label', `Bar ${barIndex + 1}, column ${colIndex + 1}, annotation above the staff`);
    } else {
      input.className = 'bar__cell';
      input.maxLength = 16;
      input.inputMode = 'text';
      input.setAttribute('aria-label', `Bar ${barIndex + 1}, column ${colIndex + 1}, ${stringName(row)} string`);
    }
    decorate(input);
    return input;
  }

  function stringName(row) {
    return `${song.tuning[row]} (${row + 1})`;
  }

  function decorate(input) {
    const value = input.value;
    input.classList.toggle('has-value', value !== '');
    if (input.classList.contains('bar__cell')) {
      input.classList.toggle('is-unusual', value !== '' && !NOTE_PATTERN.test(value));
    }
  }

  function renderBar(bar, barIndex) {
    const barEl = document.createElement('div');
    barEl.className = 'bar';
    barEl.dataset.bar = barIndex;

    const number = document.createElement('span');
    number.className = 'bar__number';
    number.textContent = barIndex + 1;

    const grid = document.createElement('div');
    grid.className = 'bar__grid';
    grid.style.setProperty('--columns', bar.columns.length);

    // Annotation row: blank corner, then one input per column.
    grid.append(number);
    bar.columns.forEach((column, c) => grid.append(cellInput(barIndex, c, ABOVE, column.above)));

    for (let s = 0; s < song.strings; s += 1) {
      const label = document.createElement('span');
      label.className = 'bar__label';
      label.dataset.row = s;
      label.textContent = song.tuning[s];
      label.setAttribute('aria-hidden', 'true');
      grid.append(label);
      bar.columns.forEach((column, c) => {
        const input = cellInput(barIndex, c, s, column.notes[s]);
        if (c === 0) input.classList.add('is-first');
        if (c === bar.columns.length - 1) input.classList.add('is-last');
        grid.append(input);
      });
    }

    barEl.append(grid);
    return barEl;
  }

  function renderSheet() {
    sheet.style.setProperty('--strings', song.strings);
    sheet.replaceChildren(...song.bars.map(renderBar));
    highlightColumn();
  }

  function updateLabels() {
    sheet.querySelectorAll('span.bar__label').forEach((label) => {
      label.textContent = song.tuning[Number(label.dataset.row)];
    });
  }

  function inputAt({ bar, col, row }) {
    return sheet.querySelector(`input[data-bar="${bar}"][data-col="${col}"][data-row="${row}"]`);
  }

  function focusCell(position, { select = true } = {}) {
    const input = inputAt(position);
    if (!input) return;
    focus = { ...position };
    input.focus();
    if (select) input.select();
  }

  function highlightColumn() {
    sheet.querySelectorAll('.is-current-column').forEach((el) => el.classList.remove('is-current-column'));
    sheet
      .querySelectorAll(`input[data-bar="${focus.bar}"][data-col="${focus.col}"]`)
      .forEach((el) => el.classList.add('is-current-column'));
    sheet.querySelectorAll('div.bar.is-current').forEach((el) => el.classList.remove('is-current'));
    sheet.querySelector(`div.bar[data-bar="${focus.bar}"]`)?.classList.add('is-current');
  }

  // Step one column left or right, carrying on into the neighbouring bar.
  function step({ bar, col, row }, direction) {
    let nextCol = col + direction;
    let nextBar = bar;
    if (nextCol < 0) {
      if (bar === 0) return null;
      nextBar = bar - 1;
      nextCol = song.bars[nextBar].columns.length - 1;
    } else if (nextCol >= song.bars[bar].columns.length) {
      if (bar === song.bars.length - 1) return null;
      nextBar = bar + 1;
      nextCol = 0;
    }
    return { bar: nextBar, col: nextCol, row };
  }

  sheet.addEventListener('focusin', (event) => {
    const input = event.target.closest('input');
    if (!input) return;
    focus = { bar: Number(input.dataset.bar), col: Number(input.dataset.col), row: Number(input.dataset.row) };
    highlightColumn();
  });

  sheet.addEventListener('input', (event) => {
    const input = event.target;
    const { bar, col, row } = input.dataset;
    const column = song.bars[bar].columns[col];
    if (Number(row) === ABOVE) {
      column.above = input.value;
    } else {
      // Notes never contain spaces; strip them so pasted text stays tidy.
      if (/\s/.test(input.value)) input.value = input.value.replace(/\s+/g, '');
      column.notes[row] = input.value;
    }
    decorate(input);
    changed();
  });

  sheet.addEventListener('keydown', (event) => {
    const input = event.target.closest('input');
    if (!input || event.metaKey || event.ctrlKey || event.altKey) return;

    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const allSelected = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    let target = null;

    switch (event.key) {
      case 'ArrowUp':
        if (focus.row > ABOVE) target = { ...focus, row: focus.row - 1 };
        break;
      case 'ArrowDown':
        if (focus.row < song.strings - 1) target = { ...focus, row: focus.row + 1 };
        break;
      case 'ArrowLeft':
        if (atStart || allSelected) target = step(focus, -1);
        break;
      case 'ArrowRight':
        if (atEnd || allSelected) target = step(focus, 1);
        break;
      case 'Enter':
        target = step(focus, 1);
        if (!target && !readOnly) {
          // Enter at the very end of the song starts a new bar.
          song.bars.push(blankBar(song.strings));
          renderSheet();
          changed();
          target = { bar: song.bars.length - 1, col: 0, row: focus.row };
        }
        break;
      default:
        return;
    }

    if (target || event.key === 'Enter') event.preventDefault();
    if (target) focusCell(target);
  });

  // ——— Toolbar ——————————————————————————————————————————————————

  const techniqueGroup = $('div.toolbar__group[aria-label="Techniques"]');

  TECHNIQUES.forEach((technique) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--small button--technique';
    button.textContent = technique.label;
    button.title = technique.title;
    button.setAttribute('aria-label', technique.title);
    button.dataset.technique = technique.id;
    techniqueGroup.append(button);
  });

  const pmButton = document.createElement('button');
  pmButton.type = 'button';
  pmButton.className = 'button button--small button--technique';
  pmButton.textContent = 'PM';
  pmButton.title = 'Palm mute: toggles “PM” above the selected column';
  pmButton.dataset.action = 'palm-mute';
  techniqueGroup.append(pmButton);

  // Keep focus in the tab when clicking toolbar buttons.
  $('div.toolbar').addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });

  function applyTechnique(technique) {
    if (focus.row === ABOVE) focus.row = 0;
    const input = inputAt(focus);
    if (!input) return;
    let value = input.value;

    if (technique.insert) value += technique.insert;
    if (technique.prefix) value = value.startsWith(technique.prefix) ? value.slice(1) : technique.prefix + value;
    if (technique.replace) value = value === technique.replace ? '' : technique.replace;
    if (technique.wrap) {
      const [open, close] = technique.wrap;
      value = value.startsWith(open) && value.endsWith(close) ? value.slice(1, -1) : open + value + close;
    }

    input.value = value;
    song.bars[focus.bar].columns[focus.col].notes[focus.row] = value;
    decorate(input);
    changed();
    input.focus();
    input.setSelectionRange(value.length, value.length);
  }

  function clampFocus() {
    focus.bar = Math.min(focus.bar, song.bars.length - 1);
    focus.col = Math.min(focus.col, song.bars[focus.bar].columns.length - 1);
  }

  const actions = {
    'palm-mute'() {
      const column = song.bars[focus.bar].columns[focus.col];
      column.above = column.above === 'PM' ? '' : 'PM';
      const above = inputAt({ ...focus, row: ABOVE });
      above.value = column.above;
      decorate(above);
      changed();
      inputAt(focus)?.focus();
    },
    'insert-column'() {
      song.bars[focus.bar].columns.splice(focus.col + 1, 0, blankColumn(song.strings));
      renderSheet();
      changed();
      focusCell({ ...focus, col: focus.col + 1 });
    },
    'delete-column'() {
      const bar = song.bars[focus.bar];
      if (bar.columns.length === 1) {
        bar.columns[0] = blankColumn(song.strings);
      } else {
        bar.columns.splice(focus.col, 1);
      }
      clampFocus();
      renderSheet();
      changed();
      focusCell(focus);
    },
    'add-bar'() {
      song.bars.splice(focus.bar + 1, 0, blankBar(song.strings));
      renderSheet();
      changed();
      focusCell({ bar: focus.bar + 1, col: 0, row: Math.max(0, focus.row) });
    },
    'append-bar'() {
      song.bars.push(blankBar(song.strings));
      renderSheet();
      changed();
      focusCell({ bar: song.bars.length - 1, col: 0, row: 0 });
    },
    'remove-bar'() {
      const bar = song.bars[focus.bar];
      const hasNotes = bar.columns.some((column) => column.above || column.notes.some(Boolean));
      if (hasNotes && !confirm(`Remove bar ${focus.bar + 1} and the notes in it?`)) return;
      if (song.bars.length === 1) {
        song.bars[0] = blankBar(song.strings);
      } else {
        song.bars.splice(focus.bar, 1);
      }
      focus.col = 0;
      clampFocus();
      renderSheet();
      changed();
      focusCell(focus);
    },
    'export-txt'() {
      exportText(song);
    },
    async 'export-pdf'(button) {
      button.disabled = true;
      try {
        await exportPdf(song);
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    },
    async 'delete-song'() {
      if (!confirm(`Delete “${song.name}”? This can’t be undone.`)) return;
      clearTimeout(saveTimer);
      dirty = false;
      try {
        await api.deleteSong(song);
        onDeleted();
      } catch (error) {
        alert(`Couldn’t delete the song: ${error.message}`);
      }
    }
  };

  // Listen on the article (not `root`, which outlives this editor) so listeners go when it does.
  root.querySelector('article.song').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.technique) {
      applyTechnique(TECHNIQUES.find((t) => t.id === button.dataset.technique));
    } else if (actions[button.dataset.action]) {
      actions[button.dataset.action](button);
    }
  });

  // ——— Go ———————————————————————————————————————————————————————

  document.title = `${song.name} – Tablature`;
  renderTuning();
  renderSheet();

  // Visitors (no GitHub token) can read and export, but not edit.
  if (readOnly) {
    root.querySelectorAll('article.song input, article.song textarea').forEach((el) => {
      el.readOnly = true;
    });
    root.querySelectorAll('article.song select').forEach((el) => {
      el.disabled = true;
    });
  }

  return {
    destroy() {
      window.removeEventListener('beforeunload', warnIfUnsaved);
      return flush();
    }
  };
}
