const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { jsPDF } = require('jspdf');  // Import jsPDF for PDF generation
const bwipjs = require('bwip-js');   // Import bwip-js for generating barcodes
const PDFDocument = require('pdf-lib').PDFDocument; // For reading and embedding the uploaded PDF

let contentCounter = 1;  // Start content counter at 1 to generate XXXXX numbers

const app = express();
const port = 3000;

app.use(cors());
app.use(fileUpload());  // Enable file upload middleware

// Serve the uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// POST route for handling file uploads with validation and PDF generation
app.post('/upload', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    console.log("No files were uploaded.");
    return res.status(400).send('No files were uploaded.');
  }

  const pdfFile = req.files.pdfFile;

  // ** File type validation: Only allow PDF files **
  if (pdfFile.mimetype !== 'application/pdf') {
    console.log("Invalid file type. Only PDF files are allowed.");
    return res.status(400).send('Only PDF files are allowed.');
  }

  // ** File size validation: Maximum file size of 5MB **
  const maxSize = 5 * 1024 * 1024; // 5MB in bytes
  if (pdfFile.size > maxSize) {
    console.log("File size exceeds the 5MB limit.");
    return res.status(400).send('File size exceeds the 5MB limit.');
  }

  const uploadPath = path.join(__dirname, 'uploads', pdfFile.name);

  // Move the file to the uploads directory
  pdfFile.mv(uploadPath, async (err) => {
    if (err) {
      console.error("Error moving the file:", err);
      return res.status(500).send('Error moving the file.');
    }

    console.log(`Success: File uploaded successfully: ${pdfFile.name}`);

    // Generate a PDF with content and barcode after uploading the file
    try {
      const generatedPdfPath = await generatePDFWithContentAndBarcode(uploadPath);
      console.log(`Success: PDF generated successfully: ${generatedPdfPath}`);

      // Send a confirmation message to the client with the download link
      res.json({
        message: 'File uploaded and PDF generated successfully',
        downloadUrl: `/uploads/${path.basename(generatedPdfPath)}`
      });
    } catch (error) {
      console.error("Error generating PDF:", error.message);
      res.status(500).send('Error generating PDF: ' + error.message);
    }

    // Remove the raw PDF file after processing
    fs.unlink(uploadPath, (err) => {
      if (err) {
        console.error("Error deleting the raw PDF file:", err);
      } else {
        console.log(`Raw PDF file deleted: ${uploadPath}`);
      }
    });
  });
});

// Function to generate the PDF with barcode and content overlay
async function generatePDFWithContentAndBarcode(uploadedPdfPath) {
  // Load the uploaded PDF using pdf-lib
  const uploadedPdfBytes = fs.readFileSync(uploadedPdfPath);
  const uploadedPdfDoc = await PDFDocument.load(uploadedPdfBytes);
  
  // Create a new PDFDocument using pdf-lib to modify the uploaded PDF
  const newPdfDoc = await PDFDocument.create();

  const barcodeList = [];  // To store barcode names for the summary table

  // Copy all the pages from the uploaded PDF into the new PDF
  const uploadedPages = await newPdfDoc.copyPages(uploadedPdfDoc, uploadedPdfDoc.getPageIndices());

  // Loop through each page and overlay a unique barcode and date
  for (let i = 0; i < uploadedPages.length; i++) {
    const page = uploadedPages[i];
    const newPage = newPdfDoc.addPage(page);  // Add the original page to the new PDF

    // Generate a unique barcode code for each page: CXM-MMDDYY-XXXXX
    const today = new Date();
    const dateCode = `${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}${String(today.getFullYear()).slice(-2)}`;
    const contentId = `CXM-${dateCode}-${String(contentCounter).padStart(5, '0')}`;
    contentCounter++;  // Increment the content number

    // Generate the barcode
    const barcodeBuffer = await generateBarcode(contentId);
    const barcodeImage = await newPdfDoc.embedPng(barcodeBuffer); // Embed the barcode image

    // Draw the barcode and barcode code on the upper left of the page
    newPage.drawImage(barcodeImage, {
      x: 20,  // Align to the upper left
      y: newPage.getHeight() - 80,  // Top of the page
      width: 100,
      height: 50,
    });

    // Draw the barcode code (CXM-DATE-XXXXX)
    newPage.drawText(`Barcode: ${contentId}`, {
      x: 20,  // Align to the upper left
      y: newPage.getHeight() - 90,
      size: 12,
    });

    // Draw the date below the barcode
    newPage.drawText(`Date: ${today.toLocaleDateString('en-US')}`, {
      x: 20,  // Align to the upper left
      y: newPage.getHeight() - 110,
      size: 12,
    });

    // Add the barcode name to the list for the summary table
    barcodeList.push(contentId);
  }

  // Create the summary table at the end of the PDF
  const summaryPage = newPdfDoc.addPage();
  summaryPage.drawText('Summary Table', { x: 50, y: summaryPage.getHeight() - 50, size: 16 });

  // Define table columns: Barcode Name, Completed, Posted
  let yOffset = summaryPage.getHeight() - 80;
  summaryPage.drawText('Barcode Name', { x: 50, y: yOffset, size: 12 });
  summaryPage.drawText('Completed', { x: 250, y: yOffset, size: 12 });
  summaryPage.drawText('Posted', { x: 400, y: yOffset, size: 12 });

  yOffset -= 20;  // Move down for the next row

  // Loop through barcodeList and add to the table
  for (const barcode of barcodeList) {
    summaryPage.drawText(barcode, { x: 50, y: yOffset, size: 12 });
    summaryPage.drawText('_____________', { x: 250, y: yOffset, size: 12 });  // Completed (blank)
    summaryPage.drawText('_____________', { x: 400, y: yOffset, size: 12 });  // Posted (blank)
    yOffset -= 20;
  }

  // Save the final combined PDF (uploaded PDF pages + overlay + summary)
  const outputFileName = `generated_${contentCounter - 1}.pdf`;  // Use the last content counter value for the file name
  const outputPdfPath = path.join(__dirname, 'uploads', outputFileName);
  const outputPdfBytes = await newPdfDoc.save();
  fs.writeFileSync(outputPdfPath, outputPdfBytes);  // Write the combined PDF to a file

  return outputPdfPath;  // Return the path of the generated PDF
}

// Function to generate a barcode using bwip-js
async function generateBarcode(contentId) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',   // Barcode type
      text: contentId,   // The content ID to encode in the barcode
      scale: 3,          // 3x scaling factor
      height: 10,        // Bar height, in millimeters
      includetext: true, // Show human-readable text
      textxalign: 'center', // Align text to the center
    }, function (err, png) {
      if (err) {
        reject(err);
      } else {
        resolve(png);
      }
    });
  });
}

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
