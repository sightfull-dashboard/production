import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const downloadCSV = (data: any[], filename: string) => {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header] ?? '';
        const escaped = ('' + value).replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(',')
    )
  ];

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToPDF = (title: string, headers: string[], rows: any[][], filename: string) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  doc.setFontSize(18);
  doc.text(title, 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 30);

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 35,
    theme: 'grid',
    styles: {
      fontSize: 7,
      cellPadding: 3,
      lineColor: [203, 213, 225], // Slate 300
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [255, 255, 255], // White
      textColor: [30, 41, 59], // Slate 800
      fontStyle: 'bold',
      lineWidth: 0.1,
      lineColor: [203, 213, 225], // Slate 300
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251], // Slate 50
    },
    margin: { top: 35 },
  });

  doc.save(filename);
};
