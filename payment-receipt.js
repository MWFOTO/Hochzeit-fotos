const PDFDocument = require('pdfkit');

const euro = cents => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
const berlinDate = value => value
  ? new Date(value).toLocaleString('de-DE', {dateStyle:'long',timeStyle:'short',timeZone:'Europe/Berlin'})
  : 'nicht verfügbar';

function createPaymentReceipt({invoice, isTestMode=false}) {
  if (!invoice || invoice.status !== 'paid' || Number(invoice.amount_remaining) !== 0) {
    throw new Error('Eine Zahlungsbestätigung kann nur für eine vollständig bezahlte Rechnung erstellt werden.');
  }

  const pdf = new PDFDocument({size:'A4', margin:54, info:{Title:`Zahlungsbestätigung ${invoice.number || ''}`,Author:'FinalSnap'}});
  const chunks=[];
  pdf.on('data',chunk=>chunks.push(chunk));
  const output=new Promise((resolve,reject)=>{
    pdf.on('end',()=>resolve(Buffer.concat(chunks)));
    pdf.on('error',reject);
  });

  const left=54, right=541, width=right-left;
  const lines=invoice.lines?.data||[];
  const description=lines.map(line=>line.description).filter(Boolean).join(', ')||'FinalSnap Fotoalbum';
  const taxCents=Number(invoice.tax??invoice.total_tax_amounts?.reduce((sum,item)=>sum+Number(item.amount||0),0)??0);
  const totalCents=Number(invoice.total??invoice.amount_paid);
  const netCents=Number(invoice.total_excluding_tax??(totalCents-taxCents));
  const buyerAddress=invoice.customer_address||{};
  const buyerLines=[invoice.customer_name, buyerAddress.line1, buyerAddress.line2,
    [buyerAddress.postal_code,buyerAddress.city].filter(Boolean).join(' '),
    buyerAddress.country==='DE'?'Deutschland':buyerAddress.country, invoice.customer_email]
    .filter(Boolean);

  pdf.fillColor('#172b48').font('Helvetica-Bold').fontSize(12).text('FinalSnap',left,48);
  pdf.fillColor('#596b85').font('Helvetica').fontSize(9).text('Matthias Wendland Fotografie · Einzelunternehmen',left,66);
  pdf.text('Kupferweg 10 · 33334 Gütersloh · Deutschland',left,79);
  pdf.text('info@finalsnap.de',left,92);
  pdf.moveTo(left,115).lineTo(right,115).lineWidth(1).strokeColor('#dbe3ed').stroke();

  pdf.fillColor('#172b48').font('Helvetica-Bold').fontSize(25).text('Zahlungsbestätigung',left,139,{width});
  if(isTestMode){
    pdf.roundedRect(left,181,width,37,6).fill('#fff4ce');
    pdf.fillColor('#704c00').font('Helvetica-Bold').fontSize(10).text('TESTBETRIEB · Es wurde kein echtes Geld eingezogen.',left+12,194,{width:width-24});
  }
  const statusY=isTestMode?237:197;
  pdf.fillColor('#24805a').font('Helvetica-Bold').fontSize(14).text(`Zahlung am ${berlinDate(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at*1000 : invoice.created*1000)} erfolgreich eingegangen.`,left,statusY,{width});

  const detailsY=statusY+42;
  const col=left+254;
  pdf.fillColor('#596b85').font('Helvetica').fontSize(10).text('RECHNUNGSNUMMER',left,detailsY);
  pdf.fillColor('#182b48').font('Helvetica-Bold').fontSize(12).text(invoice.number||'siehe beigefügte Rechnung',left,detailsY+16,{width:220});
  pdf.fillColor('#596b85').font('Helvetica').fontSize(10).text('ZAHLUNGSSTATUS',col,detailsY);
  pdf.fillColor('#182b48').font('Helvetica-Bold').fontSize(12).text('Vollständig bezahlt',col,detailsY+16);

  const buyerY=detailsY+60;
  pdf.fillColor('#172b48').font('Helvetica-Bold').fontSize(12).text('Rechnungsempfänger',left,buyerY);
  pdf.fillColor('#34445c').font('Helvetica').fontSize(10).text(buyerLines.join('\n')||'Nicht angegeben',left,buyerY+19,{width:220,lineGap:3});

  const itemY=buyerY+Math.max(112, buyerLines.length*15+38);
  pdf.moveTo(left,itemY).lineTo(right,itemY).lineWidth(1).strokeColor('#172b48').stroke();
  pdf.fillColor('#596b85').font('Helvetica-Bold').fontSize(9).text('LEISTUNG',left,itemY+12);
  pdf.text('BETRAG',right-100,itemY+12,{width:100,align:'right'});
  pdf.fillColor('#182b48').font('Helvetica').fontSize(11).text(description,left,itemY+34,{width:width-120});
  pdf.text(euro(totalCents),right-100,itemY+34,{width:100,align:'right'});
  pdf.moveTo(left,itemY+63).lineTo(right,itemY+63).lineWidth(.7).strokeColor('#dbe3ed').stroke();

  const summaryY=itemY+82;
  const row=(label,value,y,bold=false)=>{
    pdf.fillColor('#34445c').font(bold?'Helvetica-Bold':'Helvetica').fontSize(10).text(label,left+210,y,{width:230});
    pdf.fillColor('#182b48').font(bold?'Helvetica-Bold':'Helvetica').fontSize(10).text(euro(value),right-100,y,{width:100,align:'right'});
    pdf.moveTo(left+210,y+17).lineTo(right,y+17).lineWidth(.5).strokeColor('#e2e8f0').stroke();
  };
  row('Nettobetrag',netCents,summaryY);
  row('Enthaltene Umsatzsteuer',taxCents,summaryY+23);
  row('Gesamtbetrag · bezahlt',totalCents,summaryY+46,true);

  const noteY=summaryY+104;
  pdf.fillColor('#596b85').font('Helvetica').fontSize(9).text(
    `Diese Bestätigung dokumentiert den Zahlungseingang zur Rechnung ${invoice.number||''}. Die separate Stripe-PDF-Rechnung bleibt das Rechnungsdokument.`,
    left,noteY,{width,lineGap:3}
  );
  pdf.fillColor('#596b85').font('Helvetica').fontSize(8).text('FinalSnap · Matthias Wendland Fotografie · info@finalsnap.de',left,760,{width,align:'center'});
  pdf.end();
  return output;
}

module.exports={createPaymentReceipt};
