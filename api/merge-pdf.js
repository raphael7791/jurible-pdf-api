const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { matiere, fiches, copyrightPdf } = req.body;

    if (!fiches || !fiches.length) {
      return res.status(400).json({ error: 'Aucune fiche fournie' });
    }

    // Charger la police Poppins
    let poppinsBytes;
    try {
      const fontPath = path.join(process.cwd(), 'fonts', 'Poppins-SemiBold.ttf');
      poppinsBytes = fs.readFileSync(fontPath);
    } catch (e) {
      poppinsBytes = null;
    }

    // ===== ÉTAPE 1: Fusionner copyright + toutes les fiches =====
    const mergedDoc = await PDFDocument.create();
    mergedDoc.registerFontkit(fontkit);

    // Ajouter la page copyright
    if (copyrightPdf) {
      const copyrightDoc = await PDFDocument.load(Buffer.from(copyrightPdf, 'base64'));
      const copyrightPages = await mergedDoc.copyPages(copyrightDoc, copyrightDoc.getPageIndices());
      copyrightPages.forEach(p => mergedDoc.addPage(p));
    }

    // Placeholder pour le sommaire (on l'ajoutera après)
    // On note la page de début de chaque fiche
    const ficheStartPages = [];
    const sommairePagesCount = Math.ceil(fiches.length / 25); // estimation: 25 fiches par page de sommaire
    
    // Ajouter des pages vides pour le sommaire (on les remplira après)
    const sommaireStartPage = mergedDoc.getPageCount();
    for (let i = 0; i < sommairePagesCount; i++) {
      mergedDoc.addPage([595.28, 841.89]); // A4
    }

    // Ajouter chaque fiche
    for (let i = 0; i < fiches.length; i++) {
      const ficheData = fiches[i];
      const ficheDoc = await PDFDocument.load(Buffer.from(ficheData.pdf, 'base64'));
      const startPage = mergedDoc.getPageCount();
      ficheStartPages.push({
        titre: ficheData.titre,
        theme: ficheData.theme,
        page: startPage + 1 // numéro de page (1-indexed)
      });
      const pages = await mergedDoc.copyPages(ficheDoc, ficheDoc.getPageIndices());
      pages.forEach(p => mergedDoc.addPage(p));
    }

    // ===== ÉTAPE 2: Remplir le sommaire =====
    const totalPages = mergedDoc.getPageCount();
    
    // Charger la police
    let font;
    try {
      if (poppinsBytes) {
        font = await mergedDoc.embedFont(poppinsBytes);
      } else {
        throw new Error('fallback');
      }
    } catch (e) {
      font = await mergedDoc.embedFont(StandardFonts.HelveticaBold);
    }

    // Dessiner le sommaire
    const sommairePages = [];
    for (let i = 0; i < sommairePagesCount; i++) {
      sommairePages.push(mergedDoc.getPage(sommaireStartPage + i));
    }

    let currentSommairePage = 0;
    let yPos = 750;
    const pageWidth = 595.28;
    const marginLeft = 60;
    const marginRight = 60;
    const usableWidth = pageWidth - marginLeft - marginRight;

    // Titre du sommaire
    const titleText = 'SOMMAIRE';
    const titleWidth = font.widthOfTextAtSize(titleText, 22);
    sommairePages[0].drawText(titleText, {
      x: (pageWidth - titleWidth) / 2,
      y: yPos,
      size: 22,
      font: font,
      color: rgb(0.1, 0.1, 0.1)
    });
    yPos -= 15;

    // Ligne sous le titre
    sommairePages[0].drawLine({
      start: { x: marginLeft, y: yPos },
      end: { x: pageWidth - marginRight, y: yPos },
      thickness: 1.5,
      color: rgb(0.1, 0.1, 0.1)
    });
    yPos -= 35;

    let currentTheme = '';

    for (let i = 0; i < ficheStartPages.length; i++) {
      const fiche = ficheStartPages[i];
      const sp = sommairePages[currentSommairePage];

      // Nouveau thème
      if (fiche.theme && fiche.theme !== currentTheme) {
        currentTheme = fiche.theme;
        if (yPos < 80) {
          currentSommairePage++;
          if (currentSommairePage >= sommairePages.length) break;
          yPos = 780;
        }
        
        sommairePages[currentSommairePage].drawText(currentTheme, {
          x: marginLeft,
          y: yPos,
          size: 12,
          font: font,
          color: rgb(0, 0.56, 0.32) // vert #009051
        });
        yPos -= 8;
        sommairePages[currentSommairePage].drawLine({
          start: { x: marginLeft, y: yPos },
          end: { x: pageWidth - marginRight, y: yPos },
          thickness: 0.5,
          color: rgb(0, 0.56, 0.32)
        });
        yPos -= 20;
      }

      if (yPos < 80) {
        currentSommairePage++;
        if (currentSommairePage >= sommairePages.length) break;
        yPos = 780;
      }

      // Titre de la fiche + numéro de page avec pointillés
      const ficheTitle = fiche.titre.length > 65 
        ? fiche.titre.substring(0, 62) + '...' 
        : fiche.titre;
      const pageNum = String(fiche.page);
      const titleW = font.widthOfTextAtSize(ficheTitle, 10);
      const pageNumW = font.widthOfTextAtSize(pageNum, 10);
      const dotsWidth = usableWidth - titleW - pageNumW - 10;
      const dotChar = '.';
      const dotW = font.widthOfTextAtSize(dotChar, 10);
      const numDots = Math.max(0, Math.floor(dotsWidth / dotW));
      const dots = dotChar.repeat(numDots);

      sommairePages[currentSommairePage].drawText(ficheTitle, {
        x: marginLeft,
        y: yPos,
        size: 10,
        font: font,
        color: rgb(0.1, 0.1, 0.1)
      });

      sommairePages[currentSommairePage].drawText(dots, {
        x: marginLeft + titleW + 5,
        y: yPos,
        size: 10,
        font: font,
        color: rgb(0.7, 0.7, 0.7)
      });

      sommairePages[currentSommairePage].drawText(pageNum, {
        x: pageWidth - marginRight - pageNumW,
        y: yPos,
        size: 10,
        font: font,
        color: rgb(0.1, 0.1, 0.1)
      });

      yPos -= 22;
    }

    // ===== ÉTAPE 3: Header et Footer sur chaque page =====
    const headerText = `Fiches de révision • ${matiere || 'Matière'}`;
    const year = new Date().getFullYear();
    const footerBase = `© ${year} • Jurible.com – Toute reproduction, même partielle, est interdite`;

    const allPages = mergedDoc.getPages();
    for (let i = 0; i < allPages.length; i++) {
      const page = allPages[i];
      const { width, height } = page.getSize();

      // Skip la page copyright (page 0)
      if (i === 0 && copyrightPdf) continue;

      // Header (centré, italique-like via la police)
      const headerW = font.widthOfTextAtSize(headerText, 8);
      page.drawText(headerText, {
        x: (width - headerW) / 2,
        y: height - 30,
        size: 8,
        font: font,
        color: rgb(0.5, 0.5, 0.5)
      });

      // Ligne fine sous le header
      page.drawLine({
        start: { x: 50, y: height - 38 },
        end: { x: width - 50, y: height - 38 },
        thickness: 0.3,
        color: rgb(0.8, 0.8, 0.8)
      });

      // Footer
      const pageNumText = `${footerBase} • ${i + 1} sur ${totalPages}`;
      const footerW = font.widthOfTextAtSize(pageNumText, 7);
      
      // Ligne fine au-dessus du footer
      page.drawLine({
        start: { x: 50, y: 35 },
        end: { x: width - 50, y: 35 },
        thickness: 0.3,
        color: rgb(0.8, 0.8, 0.8)
      });

      page.drawText(pageNumText, {
        x: (width - footerW) / 2,
        y: 22,
        size: 7,
        font: font,
        color: rgb(0.5, 0.5, 0.5)
      });
    }

    // ===== ÉTAPE 4: Générer le PDF final =====
    const pdfBytes = await mergedDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    return res.status(200).json({
      success: true,
      pdf: pdfBase64,
      totalPages: totalPages,
      fichesCount: fiches.length
    });

  } catch (error) {
    console.error('Erreur merge-pdf:', error);
    return res.status(500).json({ 
      error: 'Erreur lors de la fusion', 
      details: error.message 
    });
  }
};