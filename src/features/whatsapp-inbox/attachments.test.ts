import {describe,expect,it} from 'vitest';
import {validateAttachment} from './attachments';

describe('anexos do WhatsApp',()=>{
 it('aceita contrato PDF com ate 100 MB',()=>{
  expect(validateAttachment({name:'Contrato final.pdf',type:'application/pdf',size:80*1024*1024})).toEqual({kind:'document',mime:'application/pdf'});
 });
 it('bloqueia executaveis e scripts mesmo com tipo generico',()=>{
  for(const name of ['contrato.exe','arquivo.bat','atalho.cmd','rotina.ps1','nota.pdf.exe']) expect(()=>validateAttachment({name,type:'application/octet-stream',size:1024})).toThrow('unsupported_file');
 });
 it('recusa arquivo acima de 100 MB',()=>{
  expect(()=>validateAttachment({name:'contrato.pdf',type:'application/pdf',size:100*1024*1024+1})).toThrow('file_too_large');
 });
});
