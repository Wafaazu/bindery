# Bindery — PDF to EPUB

Converts text-based PDFs (books, reports, documents) into clean EPUBs with
proper chapter structure. Runs as a Vercel serverless function — no server
to manage, free to host.

## Deploy to Vercel (one-time setup)

**1. Push to GitHub**

Create a new repo on GitHub and push this folder to it:

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/bindery.git
git push -u origin main
```

**2. Deploy on Vercel**

- Go to [vercel.com](https://vercel.com) and sign in with GitHub
- Click **Add New → Project**
- Import your `bindery` repo
- Leave all settings as-is (Vercel auto-detects the config from `vercel.json`)
- Click **Deploy**

That's it — Vercel gives you a public URL like `https://bindery-xyz.vercel.app`.

**Future updates:** just `git push` and Vercel redeploys automatically.

## Run locally (optional)

```bash
npm install
npm install -g vercel   # one-time
vercel dev
```

Then open `http://localhost:3000`.

## Limits

Vercel's free tier has a **10 second function timeout** and responses capped
at roughly **5MB**. This means:

- PDFs up to ~5MB work fine for most text documents
- Very large PDFs (100+ pages dense text) may time out — split them first
- Scanned/image-only PDFs are rejected with a clear error (no OCR support)

## Project structure

```
api/convert.js    — Serverless function: parses upload, runs conversion, returns EPUB binary
converter.js      — Core engine: PDF text extraction, paragraph merging, chapter detection, EPUB build
public/index.html — Frontend: drag-and-drop UI, sends request, triggers browser download
vercel.json       — Routes config
```
