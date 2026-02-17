const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { fiches, copyright, coverture, matiere } = req.body;

    // --- Police Poppins ---
    const fontBytes = fs.readFileSync(path.join(__dirname, '..', 'fonts', 'Poppins-SemiBold.ttf'));
    const finalDoc = await PDFDocument.create();
    finalDoc.registerFontkit(fontkit);
    const poppins = await finalDoc.embedFont(fontBytes);

    // --- Couleurs ---
    const VERT       = rgb(0.04, 0.60, 0.47);
    const NOIR       = rgb(0.10, 0.10, 0.10);
    const GRIS       = rgb(0.29, 0.29, 0.29);
    const GRIS_CLAIR = rgb(0.85, 0.85, 0.85);
    const BLANC      = rgb(1, 1, 1);

    // =============================================
    // 1. COUVERTURE
    // =============================================
    console.log('Couverture reçue :', coverture ? coverture.length : 'null');
    if (coverture && coverture.length > 0) {
      const imgBytes = Buffer.from(coverture, 'base64');
      const isPng = imgBytes[0] === 0x89 && imgBytes[1] === 0x50;
      const img = isPng ? await finalDoc.embedPng(imgBytes) : await finalDoc.embedJpg(imgBytes);
      const p = finalDoc.addPage([595.28, 841.89]);
      p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }

    // =============================================
    // 2. COPYRIGHT
    // =============================================
    if (copyright) {
      const cpDoc = await PDFDocument.load(Buffer.from(copyright, 'base64'));
      const pages = await finalDoc.copyPages(cpDoc, cpDoc.getPageIndices());
      pages.forEach(p => finalDoc.addPage(p));
    }

    // =============================================
    // 3. SOMMAIRE (page vide pour l'instant)
    // =============================================
    const sommaireIdx = finalDoc.getPageCount();
    const sommairePage = finalDoc.addPage([595.28, 841.89]);

    // =============================================
    // 4. FICHES
    // =============================================
    const ficheStartPages = [];
    for (const fiche of fiches) {
      ficheStartPages.push(finalDoc.getPageCount() + 1);
      const ficheDoc = await PDFDocument.load(Buffer.from(fiche.pdf, 'base64'));
      const pages = await finalDoc.copyPages(ficheDoc, ficheDoc.getPageIndices());
      pages.forEach(p => finalDoc.addPage(p));
    }

    // =============================================
    // 5. HEADER / FOOTER sur les pages des fiches
    // =============================================
    const totalPages = finalDoc.getPageCount();
    const premiereFiche = sommaireIdx + 1;

    for (let i = premiereFiche; i < totalPages; i++) {
      const page = finalDoc.getPage(i);
      const { width, height } = page.getSize();
      const pageNum = i + 1;

      // Header vert
      page.drawRectangle({ x: 0, y: height - 36, width, height: 36, color: VERT });
      page.drawText('Jurible — ' + matiere, {
        x: 20, y: height - 24, size: 9, font: poppins, color: BLANC,
      });

      // Titre fiche centré dans le header
      const ficheIdx = ficheStartPages.findIndex((_, idx) => {
        const debut = ficheStartPages[idx];
        const fin = idx + 1 < ficheStartPages.length ? ficheStartPages[idx + 1] : totalPages + 1;
        return pageNum >= debut && pageNum < fin;
      });
      if (ficheIdx >= 0) {
        const t = fiches[ficheIdx].titre;
        page.drawText(t, {
          x: width / 2 - poppins.widthOfTextAtSize(t, 9) / 2,
          y: height - 24, size: 9, font: poppins, color: BLANC,
        });
      }

      // Footer
      page.drawLine({
        start: { x: 20, y: 20 }, end: { x: width - 20, y: 20 },
        thickness: 0.5, color: GRIS_CLAIR,
      });
      const numStr = String(pageNum);
      page.drawText(numStr, {
        x: width - 20 - poppins.widthOfTextAtSize(numStr, 8),
        y: 7, size: 8, font: poppins, color: GRIS,
      });
    }

    // =============================================
    // 6. REMPLISSAGE DU SOMMAIRE
    // =============================================
    {
      const { width, height } = sommairePage.getSize();
      const M = 50;

      // Titre "Sommaire" en gris foncé
      sommairePage.drawText('Sommaire', {
        x: M, y: height - 80,
        size: 24, font: poppins, color: GRIS,
      });

      let themeActuel = null;
      let y = height - 130;
      const LINE_H = 22;
      const THEME_H = 30;

      fiches.forEach((fiche, idx) => {
        if (fiche.theme !== themeActuel) {
          themeActuel = fiche.theme;
          if (y < 100) return;
          // Thème en gris foncé
          sommairePage.drawText(themeActuel || '', {
            x: M, y, size: 11, font: poppins, color: GRIS,
          });
          y -= THEME_H;
        }

        if (y < 60) return;

        const titre = fiche.titre || '';
        const titreCourt = titre.length > 65 ? titre.substring(0, 62) + '…' : titre;

        // Titre fiche en gris foncé
        sommairePage.drawText(titreCourt, {
          x: M + 12, y, size: 9.5, font: poppins, color: GRIS,
        });

        // Pointillés + numéro de page
        const numPage = String(ficheStartPages[idx]);
        const numW   = poppins.widthOfTextAtSize(numPage, 9.5);
        const titreW = poppins.widthOfTextAtSize(titreCourt, 9.5);
        const dotZone = width - M - numW - (M + 12 + titreW) - 10;
        if (dotZone > 0) {
          const dotStr = ' . '.repeat(Math.floor(dotZone / poppins.widthOfTextAtSize(' . ', 9.5)));
          sommairePage.drawText(dotStr, {
            x: M + 12 + titreW + 4, y, size: 9.5, font: poppins, color: GRIS_CLAIR,
          });
        }
        sommairePage.drawText(numPage, {
          x: width - M - numW, y, size: 9.5, font: poppins, color: GRIS,
        });

        y -= LINE_H;
      });
    }

    // =============================================
    // 7. EXPORT
    // =============================================
    const pdfBytes = await finalDoc.save();
    res.status(200).json({ pdf: Buffer.from(pdfBytes).toString('base64') });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};