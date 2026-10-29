import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCVText,extractCVText,extractCVFields,interpretDocument } from '../src/cv.js';
import { config } from '../src/config.js';
import { pdfBuffer,docxBuffer } from '../src/documents.js';

const cv = [
 'Jane Candidate', 'Title: Software developer', 'Location: Nairobi, Kenya',
 'Phone: +254 712 345 678', 'Professional Summary', 'Developer building accessible services.',
 'Technical Skills: TypeScript, PostgreSQL', 'Work Experience',
 'Engineer at Example Ltd | 2021-2024', 'Built an application tracking service.',
 'Education', 'BSc Computer Science, Example University, 2020',
 'Certifications', 'Cloud practitioner, 2023', 'Languages', 'English, Kiswahili',
 'References', 'Available on request.'
].join('\n');

test('CV sections map to factual fields without inferring preferences or account identity',()=>{
 const {fields}=extractCVFields(cv);
 assert.equal(fields.headline,'Software developer');
 assert.equal(fields.location,'Nairobi, Kenya');
 assert.equal(fields.phone,'+254 712 345 678');
 assert.equal(fields.skills,'TypeScript, PostgreSQL');
 assert.equal(fields.summary,'Developer building accessible services.');
 assert.match(fields.experience!,/2021-2024/);
 assert.match(fields.education!,/BSc Computer Science/);
 assert.match(fields.education!,/Cloud practitioner/);
 assert.equal(fields.languages,'English, Kiswahili');
 assert.ok(!JSON.stringify(fields).includes('Available on request'));
 assert.ok(!Object.hasOwn(fields,'roles'));
 assert.ok(!Object.hasOwn(fields,'email'));
});
test('PDF CV extraction reads a real PDF without damaging the original buffer',async()=>{
 const buffer=await pdfBuffer(cv);const original=Buffer.from(buffer);
 const text=await extractCVText(buffer,'application/pdf');
 assert.match(text,/TypeScript/);
 assert.match(extractCVFields(text).fields.experience!,/Example Ltd/);
 assert.deepEqual(buffer,original);
});
test('DOCX CV extraction reads real Word paragraphs',async()=>{
 const buffer=await docxBuffer(cv);
 const text=await extractCVText(buffer,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 assert.equal(extractCVFields(text).fields.location,'Nairobi, Kenya');
 assert.match(extractCVFields(text).fields.education!,/Example University/);
});
test('damaged files and empty or excessive extracted text return useful errors',async()=>{
 await assert.rejects(()=>extractCVText(Buffer.from('%PDF-broken'),'application/pdf'),/could not be read/);
 await assert.rejects(()=>extractCVText(Buffer.from('PKbroken'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),/could not be read/);
 await assert.rejects(()=>extractCVText(Buffer.from('text'),'text/plain'),/PDF or DOCX/);
 assert.throws(()=>cleanCVText(' \n '),/Scanned CVs need OCR/);
 assert.throws(()=>cleanCVText('x'.repeat(60001)),/too much text/);
});
test('unrecognized layouts retain raw text for manual review and warn about bounded fields',()=>{
 assert.deepEqual(extractCVFields('Jane Candidate\nA nonstandard CV layout').fields,{});
 assert.match(extractCVFields('Jane Candidate\nA nonstandard CV layout').warnings[0],/No standard CV sections/);
 const {fields,warnings}=extractCVFields('Skills\n'+'a'.repeat(5001));
 assert.equal(fields.skills!.length,5000);assert.match(warnings[0],/shortened/);
});

test('AI document interpretation rejects invented qualifications and falls back to local certificate text',async()=>{
 const saved={provider:config.aiProvider,key:config.aiKey,model:config.aiModel};const originalFetch=globalThis.fetch;
 Object.assign(config,{aiProvider:'ollama',aiKey:'',aiModel:'test'});
 const text='Certificate of Completion\nInfection Prevention\nExample Institute\n2025';
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{field:'education',excerpts:['Doctor of Medicine from Harvard']}]})}}]}));
  const rejected=await interpretDocument(text,'CERTIFICATE');
  assert.equal(rejected.fields.education,text);assert.ok(!JSON.stringify(rejected.fields).includes('Harvard'));
  assert.ok(rejected.warnings.some(warning=>warning.includes('unsupported facts')));
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{field:'education',excerpts:['Infection Prevention','Example Institute','2025']},{field:'experience',excerpts:['Infection Prevention']}]})}}]}));
  const accepted=await interpretDocument(text,'CERTIFICATE');
  assert.match(accepted.fields.education!,/Infection Prevention/);assert.equal(accepted.fields.experience,undefined);
 }finally{globalThis.fetch=originalFetch;Object.assign(config,{aiProvider:saved.provider,aiKey:saved.key,aiModel:saved.model});}
});
