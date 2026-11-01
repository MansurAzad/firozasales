import type { Report } from './reports';
import { currentLocalAccount } from './offline';

export async function createExcelFile(report: Report, filename: string): Promise<File> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = 'FIROZA ENTERPRISE';
  const sheet = workbook.addWorksheet('Report');
  sheet.addRow(['FIROZA ENTERPRISE']);
  sheet.addRow([report.title]);
  const account = await currentLocalAccount();
  sheet.addRow(account?.entries.length ? ['PROVISIONAL / অনলাইনে যাচাই বাকি — Local entries included'] : []);
  sheet.addRow(report.columns);
  report.rows.forEach(row => sheet.addRow(row));
  if ('totals' in report && Array.isArray(report.totals)) {
    sheet.addRow([]);
    report.totals.forEach(total => sheet.addRow(total));
  }
  sheet.views = [{state:'frozen', ySplit:4}];
  sheet.autoFilter = {from:{row:4,column:1},to:{row:4,column:report.columns.length}};
  sheet.columns.forEach((column,index) => { column.width = index===0?38:24; });
  sheet.getRow(4).font = {bold:true};
  sheet.eachRow((row, index) => { if(index>4) row.eachCell(cell=> { if(typeof cell.value==='number') cell.numFmt='#,##0.00'; }); });
  const bytes=await workbook.xlsx.writeBuffer();
  return new File([new Uint8Array(bytes)],`${filename}.xlsx`,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function downloadFile(blob: Blob, name:string) {
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function createPdfFile(element: HTMLElement, filename:string): Promise<File> {
  await document.fonts.ready;
  const [{default:html2canvas},{jsPDF}]=await Promise.all([import('html2canvas-pro'),import('jspdf')]);
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const pages=Array.from(element.querySelectorAll<HTMLElement>('.paper-page'));
  if(!pages.length) throw new Error('No document pages');
  for(let i=0;i<pages.length;i++) {
    const page=pages[i]; if(!page)continue;
    const canvas=await html2canvas(page,{scale:1.5,useCORS:true,logging:false,windowWidth:1100});
    if(i)pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg',0.95),'JPEG',0,0,210,297);
  }
  return new File([pdf.output('blob')],`${filename}.pdf`,{type:'application/pdf'});
}
export async function exportExcel(report: Report, filename: string) {
  const file=await createExcelFile(report,filename);
  downloadFile(file,file.name);
}
export async function exportPdf(element: HTMLElement, filename: string) {
  const file=await createPdfFile(element,filename);
  downloadFile(file,file.name);
}