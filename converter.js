const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const epub = require('epub-gen-memory').default;

async function extractPdfText(pdfBuffer) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  let fullText = '';

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    const physicalLines = [];
    let lastY = null;
    let lineBuffer = [];

    const pushLine = () => {
      physicalLines.push({ text: lineBuffer.join(''), y: lastY });
      lineBuffer = [];
    };

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && lineBuffer.length) {
        pushLine();
      }
      lineBuffer.push(item.str);
      lastY = y;
      if (item.hasEOL) pushLine();
    }
    if (lineBuffer.length) pushLine();

    // Compute median line gap to detect paragraph breaks
    const gaps = [];
    for (let i = 1; i < physicalLines.length; i++) {
      const a = physicalLines[i - 1], b = physicalLines[i];
      if (a.y != null && b.y != null && a.text.trim() && b.text.trim()) {
        gaps.push(Math.abs(a.y - b.y));
      }
    }
    gaps.sort((x, y) => x - y);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
    const paraThreshold = medianGap * 1.6 + 2;

    let pageOut = [];
    let prevY = null;
    for (const line of physicalLines) {
      const trimmed = line.text.trim();
      if (!trimmed) { pageOut.push(''); prevY = line.y; continue; }
      const gap = prevY != null && line.y != null ? Math.abs(line.y - prevY) : 0;
      if (prevY !== null && gap > paraThreshold) pageOut.push('');
      pageOut.push(trimmed);
      prevY = line.y;
    }

    fullText += pageOut.join('\n') + '\n\n';
  }

  let info = {};
  try {
    const meta = await doc.getMetadata();
    info = meta?.info || {};
  } catch (_) {}

  return { text: fullText, info, numPages: doc.numPages };
}

function isPlaceholder(v) {
  if (!v) return true;
  const s = String(v).trim().toLowerCase();
  return ['', '(anonymous)', '(unspecified)', 'unknown', 'untitled'].includes(s);
}

function looksLikeHeading(line) {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;

  const explicit = [
    /^chapter\s+[\divxlcdm]+/i, /^part\s+[\divxlcdm]+/i,
    /^section\s+\d+/i, /^\d+\.\s+[A-Z]/, /^\d+\s+[A-Z][a-z]/,
    /^appendix\s+[a-z\d]/i,
    /^(prologue|epilogue|introduction|conclusion|preface|foreword|acknowledg(e)?ments?)$/i,
  ];
  if (explicit.some(r => r.test(t))) return true;
  if (/[.,;:]$/.test(t)) return false;

  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase() && words.length <= 10) return true;

  const capCount = words.filter(w => /^[A-Z0-9]/.test(w)).length;
  if (words.length >= 2 && words.length <= 8 && capCount / words.length >= 0.7) return true;

  return false;
}

function splitIntoChapters(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd());
  const cleaned = lines.filter(l => !/^\d{1,4}$/.test(l.trim()) && !/^page\s+\d+/i.test(l.trim()));

  const chapters = [];
  let current = { title: 'Start', paragraphs: [] };
  let para = [];
  let foundHeading = false;

  const flush = () => {
    const text = para.join(' ').trim();
    if (text) current.paragraphs.push(text);
    para = [];
  };

  for (const line of cleaned) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (looksLikeHeading(t)) {
      flush();
      if (current.paragraphs.length > 0 || foundHeading) {
        chapters.push(current);
        current = { title: t, paragraphs: [] };
      } else {
        current.title = t;
      }
      foundHeading = true;
      continue;
    }
    para.push(t);
  }
  flush();
  if (current.paragraphs.length > 0 || chapters.length === 0) chapters.push(current);
  if (chapters.length === 1 && chapters[0].paragraphs.length === 0) {
    chapters[0].paragraphs = [rawText.trim()];
  }
  return chapters;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function convertPdfToEpub(pdfBuffer, meta = {}) {
  const { text: rawText, info } = await extractPdfText(pdfBuffer);

  if (!rawText.trim()) {
    const err = new Error('No extractable text found. This PDF may be scanned or image-only, which is not supported.');
    err.code = 'NO_TEXT';
    throw err;
  }

  const chapters = splitIntoChapters(rawText);
  const epubChapters = chapters.map((ch, i) => ({
    title: ch.title || `Chapter ${i + 1}`,
    content: ch.paragraphs.map(p => `<p>${esc(p)}</p>`).join('\n') || '<p></p>',
  }));

  const title  = meta.title  || (!isPlaceholder(info?.Title)  ? info.Title  : null) || 'Converted Document';
  const author = meta.author || (!isPlaceholder(info?.Author) ? info.Author : null) || 'Unknown Author';

  const epubBuffer = await epub({ title, author, lang: 'en', tocTitle: 'Table of Contents' }, epubChapters);

  return { buffer: epubBuffer, chapterCount: epubChapters.length, title, author };
}

module.exports = { convertPdfToEpub };
