# Tablature

A small web app for writing guitar tab. Start a song from scratch, or upload a photo of handwritten tab and have Claude convert it into tab you can edit. Songs sync across your devices and export as PDF or `.txt`.

## What it does

- **Songs** have a name, a date (filled in automatically, but editable), notes, 6 or 7 strings, and a tuning: pick a preset, or change any string individually.
- **The editor** is a grid of bars and columns. Type fret numbers straight into the staff; arrow keys move between strings and columns, and Enter moves to the next column (or starts a new bar at the end of the song).
- **Annotations** are written as they would be in text tab, either typed or added from the toolbar: hammer-on `5h7`, pull-off `7p5`, slides `5/7` and `7\5`, bend `7b9`, release `7b9r7`, vibrato `7~`, tapping `t12`, muted note `x`, natural harmonic `<12>`, and **PM** (or any other text, like “let ring”) above the staff. Anything the app doesn’t recognise is underlined in orange, which makes import misreads easy to spot.
- **Bars and columns** can be added and removed from the toolbar.
- **Photo import** sends the image to Claude (`claude-opus-5-5`), which returns structured tab. The photo is kept with the song so you can compare it while correcting, and anything Claude wasn’t sure about is added to the song’s notes.
- **Export** to `.txt` (classic monospaced tab, wrapped at 80 characters) or PDF (A4, rows of bars never split across pages).

## How it’s built

| Part | Choice |
| --- | --- |
| Front end | Plain HTML, CSS and JavaScript modules in `public/`, with no framework and no build step |
| API | Cloudflare Pages Functions in `functions/api/` |
| Database | Cloudflare D1 (SQLite). Each song is one row, and the tab itself is stored as JSON. |
| Photo storage | Cloudflare R2 |
| Sign-in | Cloudflare Access (one-time code by email), verified on every API request |
| Handwriting | Anthropic API, via the official `@anthropic-ai/sdk` |

There are two third-party dependencies, plus web fonts:

- **jsPDF** is loaded from cdnjs only when you export a PDF, because browsers can’t create a PDF file directly.
- **The Anthropic SDK** runs on the server.
- **Fonts:** Bricolage Grotesque and Recursive, currently loaded from Google Fonts. You may want to self-host them.

## Setting it up

You’ll need [Node.js](https://nodejs.org/) (version 20 or later), a free Cloudflare account and an Anthropic API key.

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Log in to Cloudflare:

   ```bash
   npx wrangler login
   ```

3. Create the database, then paste the `database_id` it prints into `wrangler.toml`:

   ```bash
   npx wrangler d1 create tablature
   ```

4. Create the bucket for photos:

   ```bash
   npx wrangler r2 bucket create tablature-images
   ```

5. Create the database table:

   ```bash
   npm run db:migrate
   ```

6. Deploy. The first deploy creates the Pages project:

   ```bash
   npm run deploy
   ```

7. Add your Anthropic API key as a secret, then deploy once more so it takes effect:

   ```bash
   npx wrangler pages secret put ANTHROPIC_API_KEY
   ```

8. **Turn on sign-in** with Cloudflare Access:
   - In the Cloudflare dashboard, go to **Zero Trust → Access → Applications → Add an application → Self-hosted**.
   - Add your app’s domain (for example `tablature.pages.dev`) and also `*.tablature.pages.dev`, so preview deployments are covered too.
   - Add a policy that allows your own email address. The default login method, a one-time PIN sent by email, works well.
   - Copy the application’s **Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.toml`, and your team domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`. Then deploy again.

   Until both values are set, the API refuses every request, so the app is never accidentally left open.

## Running it locally

```bash
cp .dev.vars.example .dev.vars
```

Put your API key and email address in `.dev.vars`, then run:

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Open http://localhost:8788. On `localhost` only, `DEV_USER_EMAIL` stands in for Cloudflare Access.

## Costs

At personal scale, Cloudflare Pages, D1, R2 and Access (up to 50 users) all fit within their free tiers. Each photo import is a single Claude request: typically about a cent or two for a page of tab, depending on its length.

## Things worth knowing

- Saving is automatic, shortly after each change. If the same song is open on two devices, the most recent save wins.
- iPhone photos in HEIC format only open in browsers that support it (Safari does). Elsewhere, export the photo as JPEG first.
- The tab is free text in each cell, so you can write things the toolbar doesn’t cover. They’ll just be underlined in orange.
