const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
require('dotenv').config();

async function generatePDF() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const problems = await db.collection('problems').find({}).toArray();
  console.log(`Fetched ${problems.length} problem statements from DB.`);

  // Sort by sno numerically
  problems.sort((a, b) => {
    const numA = parseInt(a.sno) || 0;
    const numB = parseInt(b.sno) || 0;
    return numA - numB;
  });

  const outputPath = path.join(__dirname, '../frontend/public/CodeSprint_2026_Problem_Statements.pdf');
  console.log(`Writing PDF to ${outputPath}...`);

  const doc = new PDFDocument({
    margin: 40,
    size: 'A4',
    bufferPages: true
  });

  const writeStream = fs.createWriteStream(outputPath);
  doc.pipe(writeStream);

  // Colors
  const purplePrimary = '#4c1d95';
  const purpleDark = '#2e1065';
  const textDark = '#1e293b';
  const textMuted = '#64748b';
  const borderLight = '#cbd5e1';
  const bgLight = '#f8fafc';

  let isFirstPage = true;

  // Render Header Function
  const renderHeader = () => {
    doc.rect(40, 30, 515, 60).fill(purpleDark);
    
    doc.fillColor('#ffffff')
       .fontSize(16)
       .font('Helvetica-Bold')
       .text('CODESPRINT 2026', 50, 40, { align: 'center' });
    
    doc.fontSize(10)
       .font('Helvetica')
       .text('NATIONAL LEVEL HACKATHON & PROTOTYPE SPRINT', 50, 60, { align: 'center' });

    doc.fontSize(8)
       .text('Audisankara Deemed to be University • Gudur, AP', 50, 74, { align: 'center' });

    doc.moveDown(2);
  };

  // Cover / Header on First Page
  renderHeader();

  doc.y = 100;

  doc.fillColor(purpleDark)
     .fontSize(14)
     .font('Helvetica-Bold')
     .text('OFFICIAL HACKATHON PROBLEM STATEMENTS CATALOG', { align: 'center' });

  doc.moveDown(0.3);
  doc.fillColor(textMuted)
     .fontSize(9)
     .font('Helvetica')
     .text(`Total Problem Statements: ${problems.length} | Official Reference Document`, { align: 'center' });

  doc.moveDown(1);
  doc.strokeColor(purplePrimary).lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(1);

  // Loop through problem statements
  problems.forEach((p, idx) => {
    // Check page space
    if (doc.y > 700) {
      doc.addPage();
      renderHeader();
      doc.y = 100;
    }

    const startY = doc.y;

    // Card background box
    doc.rect(40, startY, 515, 1).fill('transparent'); // marker

    // S.No & Title Header Line
    doc.fillColor(purplePrimary)
       .fontSize(11)
       .font('Helvetica-Bold')
       .text(`PROBLEM STATEMENT #${p.sno || (idx + 1)}: ${p.title || 'Untitled Problem'}`, 45, startY + 5, { width: 505 });

    doc.moveDown(0.2);

    // Domain / Industry badge
    doc.fillColor('#047857')
       .fontSize(8)
       .font('Helvetica-Bold')
       .text(`INDUSTRY DOMAIN: ${(p.industry || 'General').toUpperCase()}`, 45, doc.y);

    doc.moveDown(0.4);

    // Description Content
    doc.fillColor(textDark)
       .fontSize(9)
       .font('Helvetica')
       .text(p.description || p.title || 'No description available.', 45, doc.y, {
         width: 505,
         align: 'justify',
         lineGap: 2
       });

    doc.moveDown(0.8);

    // Subtle divider line
    doc.strokeColor(borderLight).lineWidth(0.5).moveTo(45, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.8);
  });

  // Footer Signatures section
  if (doc.y > 680) {
    doc.addPage();
    renderHeader();
    doc.y = 100;
  }

  doc.moveDown(2);
  doc.strokeColor(purpleDark).lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(1);

  doc.fillColor(purpleDark)
     .fontSize(10)
     .font('Helvetica-Bold')
     .text('CodeSprint 2026 Organizing Committee', 40, doc.y);

  doc.fillColor(textMuted)
     .fontSize(8)
     .font('Helvetica')
     .text('Audisankara Deemed to be University, Gudur, Andhra Pradesh', 40, doc.y + 12);

  const sigY = doc.y + 10;

  // Faculty Coordinator signature line
  doc.strokeColor(textMuted).lineWidth(0.5).moveTo(300, sigY).lineTo(410, sigY).stroke();
  doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold').text('Dr. N. Penchalaiah', 300, sigY + 4);
  doc.fillColor(textMuted).fontSize(7).font('Helvetica').text('Faculty Coordinator', 300, sigY + 16);

  // Dean SET signature line
  doc.strokeColor(textMuted).lineWidth(0.5).moveTo(430, sigY).lineTo(540, sigY).stroke();
  doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold').text('Dr. K. Dhanumjaya', 430, sigY + 4);
  doc.fillColor(textMuted).fontSize(7).font('Helvetica').text('Dean, SET', 430, sigY + 16);

  // Add Page Numbers
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(textMuted)
       .fontSize(8)
       .font('Helvetica')
       .text(`CodeSprint 2026 • Official Problem Statements • Page ${i + 1} of ${pages.count}`, 40, 800, {
         align: 'center',
         width: 515
       });
  }

  doc.end();

  writeStream.on('finish', () => {
    console.log('Successfully generated CodeSprint_2026_Problem_Statements.pdf');
    mongoose.disconnect();
  });
}

generatePDF().catch(err => {
  console.error('Error generating PDF:', err);
  mongoose.disconnect();
});
