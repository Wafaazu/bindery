const { convertPdfToEpub } = require('../converter');

// Parse a multipart/form-data request manually (no multer on Vercel)
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) return reject(new Error('No boundary found in content-type'));

        const boundary = Buffer.from('--' + boundaryMatch[1].trim());
        const fields = {};
        let pdfBuffer = null;
        let pdfName = 'upload.pdf';

        // Split on boundary
        const parts = [];
        let start = 0;
        while (start < body.length) {
          const idx = body.indexOf(boundary, start);
          if (idx === -1) break;
          if (start > 0) parts.push(body.slice(start, idx - 2)); // trim trailing \r\n
          start = idx + boundary.length + 2; // skip \r\n after boundary
        }

        for (const part of parts) {
          if (!part || part.length < 4) continue;
          // Find the blank line separating headers from body (\r\n\r\n)
          const sep = part.indexOf('\r\n\r\n');
          if (sep === -1) continue;
          const headerSection = part.slice(0, sep).toString();
          const data = part.slice(sep + 4);

          const dispMatch = headerSection.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
          if (!dispMatch) continue;
          const fieldName = dispMatch[1];

          const fileMatch = headerSection.match(/filename="([^"]+)"/i);
          if (fileMatch) {
            // It's a file upload
            pdfBuffer = data;
            pdfName = fileMatch[1];
          } else {
            fields[fieldName] = data.toString().trim();
          }
        }

        resolve({ fields, pdfBuffer, pdfName });
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  // CORS headers so the frontend can call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields, pdfBuffer, pdfName } = await parseMultipart(req);

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return res.status(400).json({ error: 'No PDF file was uploaded.' });
    }

    const ext = (pdfName || '').split('.').pop().toLowerCase();
    if (ext !== 'pdf') {
      return res.status(400).json({ error: 'Only PDF files are accepted.' });
    }

    const result = await convertPdfToEpub(pdfBuffer, {
      title: fields.title || undefined,
      author: fields.author || undefined,
    });

    const safeName = result.title
      .replace(/[^a-z0-9\-_ ]/gi, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'converted';

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.epub"`);
    res.setHeader('X-Chapter-Count', String(result.chapterCount));
    res.setHeader('X-Title', encodeURIComponent(result.title));
    res.setHeader('X-Author', encodeURIComponent(result.author));
    res.setHeader('X-Size-Bytes', String(result.buffer.length));
    res.status(200).send(result.buffer);

  } catch (err) {
    console.error('Conversion error:', err);
    const message = err.code === 'NO_TEXT'
      ? err.message
      : 'Could not convert this PDF. It may be corrupted, encrypted, or in an unsupported format.';
    res.status(422).json({ error: message });
  }
};
