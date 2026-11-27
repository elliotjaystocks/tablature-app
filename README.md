# Tablature

A small web app for writing guitar tab. Start a song from scratch, or upload a photo of handwritten tab and have Claude convert it into tab you can edit. Songs export as PDF or `.txt`.

There’s no server and nothing to install. The app is hosted free on GitHub Pages, and your songs are saved as files in this repository through the GitHub API, so every save is a commit and each song has a full history.

## What it does

- **Songs** have a name, a date (filled in automatically, but editable), notes, 6 or 7 strings, and a tuning: pick a preset, or change any string individually.
- **The editor** is a grid of bars and columns. Type fret numbers straight into the staff; arrow keys move between strings and columns, and Enter moves to the next column (or starts a new bar at the end of the song).
- **Annotations** are written as they would be in text tab, either typed or added from the toolbar: hammer-on `5h7`, pull-off `7p5`, slides `5/7` and `7\5`, bend `7b9`, release `7b9r7`, vibrato `7~`, tapping `t12`, muted note `x`, natural harmonic `<12>`, and **PM** (or any other text, like “let ring”) above the staff. Anything the app doesn’t recognise is underlined in orange, which makes import misreads easy to spot.
- **Bars and columns** can be added and removed from the toolbar.
- **Photo import** sends the image to Claude (`claude-opus-5-5`), which returns structured tab. The photo is kept with the song so you can compare it while correcting, and anything Claude wasn’t sure about is added to the song’s notes.
- **Export** to `.txt` (classic monospaced tab, wrapped at 80 characters) or PDF (A4, rows of bars never split across pages).

## Where things are stored

```
songs/index.json         the song list
songs/<id>.json          one file per song, including its tab
songs/images/<id>.jpg    photos that songs were imported from
```

The `songs/` folder is created the first time you save a song.

Anyone who visits the site can read and export your songs. Editing only appears once a GitHub token is connected in **Settings**, and the token and your Anthropic API key are stored only in your browser.

## Setting it up

### 1. Put the app on GitHub

1. Create a new repository on GitHub (for example `tablature`). Leave it **Public**, which free GitHub Pages needs.
2. Push this folder to it. With GitHub Desktop, that’s **File → Add Local Repository**, then **Publish repository**.

### 2. Turn on GitHub Pages

1. On GitHub, go to the repository’s **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**, then `main` and `/ (root)`, and **Save**.
3. After a minute or two you’ll have a URL like `https://your-username.github.io/tablature/`.

### 3. Create a GitHub token

1. Go to [GitHub → Settings → Developer settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).
2. Name it `Tablature` and set an expiry (a year is convenient).
3. Under **Repository access**, choose **Only select repositories** and pick this repo.
4. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**.
5. Generate the token and copy it straight away, because GitHub won’t show it again.

### 4. Get an Anthropic API key (for photo import)

1. Create a key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. Set a **monthly spend limit** for it under **Settings → Limits**. The key lives in your browser, so a limit is a sensible safety net.

### 5. Connect the app

Open your GitHub Pages URL, click **Settings**, and enter your username, repository name, token and API key. The username and repository are filled in for you from the address.

On another device, just open the same URL and enter the same details.

## Running it locally

There’s no build step: serve the folder with any static server, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Once connected in Settings, it reads and writes the same GitHub repository as the live site.

## Costs

GitHub Pages and the GitHub API are free. Each photo import is a single Claude request, typically about a cent or two for a page of tab, depending on its length.

## Things worth knowing

- Saving happens automatically a couple of seconds after you stop typing. If you try to close the tab before a save finishes, the browser asks you to wait.
- If the same song is open on two devices, the most recent save wins. Earlier versions are always in the repository’s commit history.
- Visitors see changes once GitHub Pages republishes, usually within a minute or two.
- iPhone photos in HEIC format only open in browsers that support them (Safari does). Elsewhere, export the photo as JPEG first.
- The tab is free text in each cell, so you can write things the toolbar doesn’t cover. They’ll just be underlined in orange.
