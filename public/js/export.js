// Export a song as a .txt file or a PDF.
//
// PDFs are made with jsPDF, loaded from cdnjs only when you first export one.
// It's the one third-party library in the app: browsers have no built-in way
// to create a PDF file directly (short of the print dialog).

import { songToText, songToSystems, songHeader } from './tab.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

function fileName(song, extension) {
  const slug = song.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'tab'}.${extension}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportText(song) {
  download(new Blob([songToText(song)], { type: 'text/plain;charset=utf-8' }), fileName(song, 'txt'));
}

let jsPdfPromise = null;

function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSPDF_URL;
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = () => {
      jsPdfPromise = null;
      reject(new Error('Could not load the PDF library. Check your connection and try again.'));
    };
    document.head.append(script);
  });
  return jsPdfPromise;
}

// jsPDF's built-in fonts only cover Latin-1, so swap the few characters we use that fall outside it.
function pdfSafe(text) {
  return text.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
}

export async function exportPdf(song) {
  const JsPdf = await loadJsPdf();
  const doc = new JsPdf({ unit: 'pt', format: 'a4' });

  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tabSize = 9.5;
  const lineHeight = tabSize * 1.2;
  // Courier is 0.6em wide, which tells us how many characters fit across the page.
  const charsPerLine = Math.floor((pageWidth - margin * 2) / (tabSize * 0.6));

  let y = margin;

  const ensureSpace = (height) => {
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const [title, ...details] = songHeader(song).map(pdfSafe);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.splitTextToSize(title, pageWidth - margin * 2).forEach((line) => {
    doc.text(line, margin, y + 20);
    y += 24;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  y += 6;
  details.forEach((line) => {
    doc.text(line, margin, y + 10);
    y += 14;
  });

  if (song.notes.trim()) {
    y += 8;
    doc.splitTextToSize(pdfSafe(song.notes.trim()), pageWidth - margin * 2).forEach((line) => {
      ensureSpace(14);
      doc.text(line, margin, y + 10);
      y += 14;
    });
  }

  y += 18;
  doc.setFont('courier', 'normal');
  doc.setFontSize(tabSize);

  songToSystems(song, charsPerLine).forEach((lines) => {
    // Keep each row of bars together on one page.
    ensureSpace(lines.length * lineHeight);
    lines.forEach((line) => {
      doc.text(pdfSafe(line), margin, y + tabSize);
      y += lineHeight;
    });
    y += lineHeight * 1.5;
  });

  doc.save(fileName(song, 'pdf'));
}
