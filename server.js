const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { jsPDF } = require('jspdf');  // Import jsPDF for PDF generation
const bwipjs = require('bwip-js');   // Import bwip-js for generating barcodes
const PDFDocument = require('pdf-lib').PDFDocument; // For reading and embedding the uploaded PDF
const { MongoClient } = require('mongodb'); // Import MongoDB Client

let contentCounter = 1;  // Start content counter at 1 to generate XXXXX numbers

const app = express();
const port = 3000;

app.use(cors());
app.use(fileUpload());  // Enable file upload middleware

// Correct MongoDB connection URI (Remove the duplicate declaration)
const uri = "mongodb+srv://kyle-user:2tNgwToQfrU7p9AR@cluster0.jwpbm.mongodb.net/?retryWrites=true&w=majority";

// MongoDB client and database instance
let db;

// Connect to MongoDB
MongoClient.connect(uri)
  .then(client => {
    console.log('Connected to Database');
    db = client.db('barcode-pdf-db'); // Your database name

    // Start the server after MongoDB connection
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  })
  .catch(error => {
    console.error('MongoDB Connection Error:', error);
    process.exit(1); // Exit process if connection fails
  });

// Function to save barcode data to MongoDB
async function saveBarcodeData(contentId, pdfFilePath) {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const collection = db.collection('barcodes');
  const data = {
    contentId: contentId,
    filePath: pdfFilePath,
    timestamp: new Date()
  };

  await collection.insertOne(data);
  console.log('Barcode data saved:', data);
}

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// POST route to handle file uploads, validation, and PDF generation
app.post('/upload', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  const pdfFile = req.files.pdfFile;

  // Validate file type and size
  if (pdfFile.mimetype !== 'application/pdf') {
    return res.status(400).send('Only PDF files are allowed.');
  }

  const maxSize = 5 * 1024 * 1024; // 5MB limit
  if (pdfFile.size > maxSize) {
    return res.status(400).send('File size exceeds the 5MB limit.');
  }

  const uploadPath = path.join(__dirname, 'uploads', pdfFile.name);

  // Move the file to the uploads directory
  pdfFile.mv(uploadPath, async (err) => {
    if (err) {
      return res.status(500).send('Error moving the file.');
    }

    try {
      const generatedPdfPath = await generatePDFWithContentAndBarcode(uploadPath);
      console.log(`PDF generated successfully: ${generatedPdfPath}`);

      // Save barcode data to MongoDB
      await saveBarcodeData(`CXM-${contentCounter - 1}`, generatedPdfPath);

      // Send the download link to the client
      res.json({
        message: 'File uploaded and PDF generated successfully',
        downloadUrl: `/uploads/${path.basename(generatedPdfPath)}`
      });

      // Remove the raw PDF after processing
      fs.unlink(uploadPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Error deleting the raw PDF file:', unlinkErr);
        }
      });
    } catch (error) {
      console.error('Error generating PDF:', error.message);
      res.status(500).send('Error generating PDF.');
    }
  });
});

// Function to generate PDF with barcode and content overlay
async function generatePDFWithContentAndBarcode(uploadedPdfPath) {
  const uploadedPdfBytes = fs.readFileSync(uploadedPdfPath);
  const uploadedPdfDoc = await PDFDocument.load(uploadedPdfBytes);

  const newPdfDoc = await PDFDocument.create();
  const uploadedPages = await newPdfDoc.copyPages(uploadedPdfDoc, uploadedPdfDoc.getPageIndices());

  const barcodeList = [];

  for (let i = 0; i < uploadedPages.length; i++) {
    const page = uploadedPages[i];
    const newPage = newPdfDoc.addPage(page);

    // Generate unique barcode: CXM-MMDDYY-XXXXX
    const today = new Date();
    const dateCode = `${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}${String(today.getFullYear()).slice(-2)}`;
    const contentId = `CXM-${dateCode}-${String(contentCounter).padStart(5, '0')}`;
    contentCounter++;

    const barcodeBuffer = await generateBarcode(contentId);
    const barcodeImage = await newPdfDoc.embedPng(barcodeBuffer);

    // Draw the barcode and content info on the new page
    newPage.drawImage(barcodeImage, { x: 20, y: newPage.getHeight() - 80, width: 100, height: 50 });
    newPage.drawText(`Barcode: ${contentId}`, { x: 20, y: newPage.getHeight() - 90, size: 12 });
    newPage.drawText(`Date: ${today.toLocaleDateString('en-US')}`, { x: 20, y: newPage.getHeight() - 110, size: 12 });

    barcodeList.push(contentId);
  }

  // Create a summary page
  const summaryPage = newPdfDoc.addPage();
  summaryPage.drawText('Summary Table', { x: 50, y: summaryPage.getHeight() - 50, size: 16 });
  let yOffset = summaryPage.getHeight() - 80;

  for (const barcode of barcodeList) {
    summaryPage.drawText(barcode, { x: 50, y: yOffset, size: 12 });
    summaryPage.drawText('_____________', { x: 250, y: yOffset, size: 12 });
    summaryPage.drawText('_____________', { x: 400, y: yOffset, size: 12 });
    yOffset -= 20;
  }

  const outputPdfPath = path.join(__dirname, 'uploads', `generated_${contentCounter - 1}.pdf`);
  const outputPdfBytes = await newPdfDoc.save();
  fs.writeFileSync(outputPdfPath, outputPdfBytes);

  return outputPdfPath;
}

// Function to generate barcode using bwip-js
async function generateBarcode(contentId) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',
      text: contentId,
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: 'center'
    }, (err, png) => {
      if (err) {
        reject(err);
      } else {
        resolve(png);
      }
    });
  });
}
