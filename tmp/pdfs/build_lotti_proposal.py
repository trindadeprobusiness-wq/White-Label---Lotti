from pathlib import Path
import re, html, shutil
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Flowable, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path('C:/Users/Gabri/n8n-agent-lotti')
OUT=Path('output/pdf/Agente_Lotti_Proposta.pdf')
OUT.parent.mkdir(parents=True,exist_ok=True)
for name, file in [('Lotti','arial.ttf'),('LottiBold','arialbd.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
pdfmetrics.registerFontFamily('Lotti',normal='Lotti',bold='LottiBold',italic='Lotti',boldItalic='LottiBold')
GREEN=colors.HexColor('#08775B'); INK=colors.HexColor('#182D29'); MUTED=colors.HexColor('#5C6F69'); LIGHT=colors.HexColor('#EDF6F2')
styles={
'body':ParagraphStyle('body',fontName='Lotti',fontSize=9.8,leading=13.2,textColor=INK,spaceAfter=7),
'h1':ParagraphStyle('h1',fontName='LottiBold',fontSize=34,leading=38,textColor=GREEN,spaceAfter=11),
'h2':ParagraphStyle('h2',fontName='LottiBold',fontSize=21,leading=25,textColor=INK,spaceAfter=12),
'h3':ParagraphStyle('h3',fontName='LottiBold',fontSize=12,leading=16,textColor=GREEN,spaceBefore=7,spaceAfter=7),
'cell':ParagraphStyle('cell',fontName='Lotti',fontSize=9.1,leading=12,textColor=INK,wordWrap='CJK'),
'th':ParagraphStyle('th',fontName='LottiBold',fontSize=9.1,leading=12,textColor=colors.white),
'bullet':ParagraphStyle('bullet',fontName='Lotti',fontSize=9.8,leading=13.2,textColor=INK,leftIndent=10,firstLineIndent=-8,spaceAfter=6),
}
def fmt(t):
    t=html.escape(t)
    t=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',t)
    t=re.sub(r'`([^`]+)`',r'<font color="#08775B">\1</font>',t)
    return t

class Diagram(Flowable):
    def __init__(self): super().__init__();self.width=499;self.height=169
    def draw(self):
        c=self.canv
        boxes=[('01','WhatsApp','Entrada pela Evolution API'),('02','n8n + Supabase','Identifica e registra'),('03','Plano','Verifica a elegibilidade'),('04','Qualificação','Descobre e orienta'),('05','Qualificado','Avisa o corretor na Lotti'),('06','Corretor','Assume; agente pausa')]
        for i,(n,title,sub) in enumerate(boxes):
            row=i//3; col=i%3; x=col*169; y=103-row*70
            c.setFillColor(LIGHT);c.roundRect(x,y,159,58,7,fill=1,stroke=0)
            c.setFillColor(GREEN);c.setFont('LottiBold',9);c.drawString(x+10,y+42,n)
            c.setFillColor(INK);c.setFont('LottiBold',11);c.drawString(x+29,y+41,title)
            c.setFont('Lotti',8.5);c.drawString(x+10,y+19,sub)
            if col<2:
                c.setStrokeColor(GREEN);c.line(x+160,y+30,x+168,y+30)
        c.setFont('Lotti',9);c.setFillColor(MUTED)
        c.drawString(0,9,'Sem franquia: atendimento humano. O lead permanece registrado.')

def footer(c,doc):
    w,h=doc.pagesize
    c.setFillColor(GREEN);c.rect(0,h-8,w,8,fill=1,stroke=0)
    c.setFont('LottiBold',9);c.setFillColor(GREEN);c.drawString(48,h-34,'LOTTI / AGENTE DE PRÉ-QUALIFICAÇÃO')
    c.setFont('Lotti',8);c.setFillColor(MUTED);c.drawRightString(w-48,h-34,'PROPOSTA 1.2')
    c.setStrokeColor(colors.HexColor('#D5E3DC'));c.line(48,42,w-48,42)
    c.setFont('Lotti',8);c.drawString(48,28,'11.09.2026  |  Planejamento. Nenhuma automação ativada.')
    c.drawRightString(w-48,28,str(doc.page))

def parse(page):
    lines=page.strip().splitlines(); items=[];i=0
    while i<len(lines):
        t=lines[i].strip()
        if not t:i+=1;continue
        if t.startswith('```'):
            i+=1
            while i<len(lines) and not lines[i].startswith('```'):i+=1
            items.append(Diagram());i+=1;continue
        if t.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                row=[v.strip() for v in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[-: ]+',v) for v in row):rows.append(row)
                i+=1
            nc=len(rows[0]);widths=[142,357] if nc==2 else [112,146,241]
            data=[[Paragraph(fmt(v),styles['th' if ri==0 else 'cell']) for v in row]for ri,row in enumerate(rows)]
            tab=Table(data,colWidths=widths,hAlign='LEFT',repeatRows=1)
            tab.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),GREEN),('ROWBACKGROUNDS',(0,1),(-1,-1),[LIGHT,colors.white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,-1),(-1,-1),.5,colors.HexColor('#D5E3DC'))]))
            items.extend([tab,Spacer(1,10)]);continue
        style='body'
        if t.startswith('### '):style='h3';t=t[4:]
        elif t.startswith('## '):style='h2';t=t[3:]
        elif t.startswith('# '):style='h1';t=t[2:]
        elif t.startswith('- '):style='bullet';t='• '+t[2:]
        elif re.match(r'^\d+\. ',t):style='bullet'
        items.append(Paragraph(fmt(t),styles[style]));i+=1
    return items

pages=(ROOT/'docs/AGENTE_LOTTI_PROPOSTA.md').read_text(encoding='utf-8').split('<!-- PAGE -->')
story=[]
for i,p in enumerate(pages):
    if i:story.append(PageBreak())
    story.extend(parse(p))
doc=SimpleDocTemplate(str(OUT),pagesize=(595.28,841.89),rightMargin=48,leftMargin=48,topMargin=58,bottomMargin=56,title='Agente Lotti - Proposta de pré-qualificação',author='Lotti',pageCompression=1)
doc.build(story,onFirstPage=footer,onLaterPages=footer)
shutil.copyfile(OUT,ROOT/'docs/Agente_Lotti_Proposta.pdf')
from pypdf import PdfReader
r=PdfReader(OUT)
print('PDF pages:',len(r.pages))
for i,p in enumerate(r.pages):
    txt=p.extract_text(); print(i+1,len(txt),'chars',txt[:80].replace('\n',' / '))
