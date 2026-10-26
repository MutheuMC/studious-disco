import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun } from 'docx';
export async function pdfBuffer(content:string):Promise<Buffer>{return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({margin:55,size:'A4'});const chunks:Buffer[]=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.font('Helvetica').fontSize(11).text(content,{lineGap:4});doc.end();
});}
export async function docxBuffer(content:string){return Packer.toBuffer(new Document({sections:[{children:content.split('\n').map(line=>new Paragraph({children:[new TextRun(line)],spacing:{after:120}}))}]}));}
