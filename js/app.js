// App shell: routing between the song library and the editor, plus the "New song" dialog.
//   #/            → your songs
//   #/song/<id>   → edit a song

import { api, getConfig, saveConfig, isOwner, validateGitHub } from './store.js';
import { renderEditor } from './editor.js';
import { prepareImage } from './image.js';
import { newSong, tuningLabel } from './tab.js';

const view = document.getElementById('view');
const dialog = document.querySelector('dialog.new-song');
let currentEditor = null;

// `is-owner` shows the editing controls: set when a GitHub token is connected.
function updateOwnerClass() {
  document.body.classList.toggle('is-owner', isOwner());
}

// ——— Routing ——————————————————————————————————————————————————

async function route() {
  updateOwnerClass();
  // Finish saving the song we're leaving, so the song list shows the latest version.
  const leaving = currentEditor;
  currentEditor = null;
  await leaving?.destroy().catch(() => {});

  const match = location.hash.match(/^#\/song\/([\w-]+)/);
  try {
    if (match) await showSong(match[1]);
    else await showLibrary();
  } catch (error) {
    showError(error.message);
  }
  view.focus({ preventScroll: true });
}

function showError(message) {
  const p = document.createElement('p');
  p.className = 'view__error';
  p.textContent = message;
  const back = document.createElement('a');
  back.href = '#/';
  back.textContent = 'Back to your songs';
  view.replaceChildren(p, back);
}

// ——— Library ——————————————————————————————————————————————————

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return dateFormat.format(new Date(year, month - 1, day));
}

async function showLibrary() {
  document.body.className = 'library';
  updateOwnerClass();
  document.title = 'Tablature';

  const songs = await api.listSongs();
  const template = document.getElementById('library-template');
  view.replaceChildren(template.content.cloneNode(true));

  const list = view.querySelector('ol.song-list');
  view.querySelector('div.library__empty').hidden = songs.length > 0;

  list.replaceChildren(
    ...songs.map((song) => {
      const item = document.createElement('li');
      item.className = 'song-list__item';

      const link = document.createElement('a');
      link.className = 'song-list__link';
      link.href = `#/song/${song.id}`;

      const name = document.createElement('span');
      name.className = 'song-list__name';
      name.textContent = song.name;

      const meta = document.createElement('span');
      meta.className = 'song-list__meta';
      meta.textContent = [formatDate(song.date), `${song.strings}-string`, tuningLabel(song)].join(' · ');

      link.append(name, meta);
      item.append(link);
      return item;
    })
  );

  view.querySelector('[data-action="new-song"]').addEventListener('click', openNewSongDialog);
}

// ——— Editor ———————————————————————————————————————————————————

async function showSong(id) {
  document.body.className = 'editor';
  updateOwnerClass();
  view.replaceChildren(Object.assign(document.createElement('p'), { className: 'view__loading', textContent: 'Loading…' }));
  const song = await api.getSong(id);
  currentEditor = renderEditor(view, song, {
    readOnly: !isOwner(),
    onDeleted: () => {
      currentEditor = null;
      location.hash = '#/';
    }
  });
}

// ——— New song dialog ——————————————————————————————————————————

const choices = dialog.querySelector('div.new-song__choices');
const progress = dialog.querySelector('div.new-song__progress');
const preview = dialog.querySelector('img.new-song__preview');
const statusText = dialog.querySelector('p.new-song__status');
const errorText = dialog.querySelector('p.new-song__error');
const cancelButton = dialog.querySelector('button[value="cancel"]');
const fileInput = dialog.querySelector('#tab-photo');
let importing = false;

function resetDialog() {
  choices.hidden = false;
  progress.hidden = true;
  errorText.hidden = true;
  cancelButton.disabled = false;
  fileInput.value = '';
  importing = false;
}

function openNewSongDialog() {
  resetDialog();
  dialog.showModal();
}

function showDialogError(message) {
  errorText.textContent = message;
  errorText.hidden = false;
  choices.hidden = false;
  progress.hidden = true;
  cancelButton.disabled = false;
  importing = false;
}

dialog.addEventListener('cancel', (event) => {
  if (importing) event.preventDefault();
});

dialog.querySelector('[data-action="blank-song"]').addEventListener('click', async () => {
  try {
    const song = await api.createSong(newSong());
    dialog.close();
    location.hash = `#/song/${song.id}`;
  } catch (error) {
    showDialogError(`Couldn’t create the song: ${error.message}`);
  }
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  errorText.hidden = true;
  let image;
  try {
    image = await prepareImage(file);
  } catch (error) {
    showDialogError(error.message);
    return;
  }

  importing = true;
  choices.hidden = true;
  progress.hidden = false;
  cancelButton.disabled = true;
  preview.src = image.previewUrl;
  statusText.textContent = 'Reading your tab… this usually takes under a minute.';

  // Long imports can feel stuck, so reassure after a while.
  const slowTimer = setTimeout(() => {
    statusText.textContent = 'Still reading… longer tabs take a little more time.';
  }, 45000);

  try {
    const song = await api.importImage(image.base64);
    dialog.close();
    location.hash = `#/song/${song.id}`;
  } catch (error) {
    showDialogError(error.message);
  } finally {
    clearTimeout(slowTimer);
    importing = false;
  }
});

// ——— Settings dialog ——————————————————————————————————————————

const settings = document.querySelector('dialog.settings');
const settingsForm = settings.querySelector('form');
const settingsError = settings.querySelector('p.settings__error');
const fields = {
  username: settings.querySelector('#cfg-username'),
  repo: settings.querySelector('#cfg-repo'),
  token: settings.querySelector('#cfg-token'),
  anthropicKey: settings.querySelector('#cfg-anthropic')
};

// On GitHub Pages the address tells us the likely username and repository.
function guessRepo() {
  const match = location.hostname.match(/^([\w-]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return match ? { username: match[1], repo: repo || `${match[1]}.github.io` } : {};
}

document.querySelector('[data-action="open-settings"]').addEventListener('click', () => {
  const config = { ...guessRepo(), ...getConfig() };
  Object.entries(fields).forEach(([key, input]) => {
    input.value = config[key] || '';
  });
  settingsError.hidden = true;
  settings.showModal();
});

settingsForm.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();

  const config = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
  const saveButton = event.submitter;

  if (config.username || config.repo || config.token) {
    if (!config.username || !config.repo || !config.token) {
      settingsError.textContent = 'Please fill in your GitHub username, repository and token.';
      settingsError.hidden = false;
      return;
    }
    saveButton.disabled = true;
    try {
      await validateGitHub(config.username, config.repo, config.token);
    } catch (error) {
      settingsError.textContent = error.message;
      settingsError.hidden = false;
      return;
    } finally {
      saveButton.disabled = false;
    }
  }

  saveConfig(config);
  settings.close();
  route();
});

settings.querySelector('[data-action="disconnect"]').addEventListener('click', () => {
  if (!confirm('Remove your GitHub token and Anthropic key from this browser?')) return;
  saveConfig({});
  settings.close();
  route();
});

// ——— Start ————————————————————————————————————————————————————

window.addEventListener('hashchange', route);
route();
