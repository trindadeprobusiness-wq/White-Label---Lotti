import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  PageNumber,
  Header,
  Footer,
  convertInchesToTwip,
  ImageRun,
  HorizontalPositionAlign,
  VerticalPositionAlign,
} from "docx";
import { saveAs } from "file-saver";

interface ContractDocxOptions {
  clienteNome: string;
  tipoContrato: string;
  marcaDaguaBase64?: string;
}

export async function generateContractDocx(
  contratoTexto: string,
  options: ContractDocxOptions
): Promise<void> {
  const { clienteNome, tipoContrato, marcaDaguaBase64 } = options;
  
  // Parse contract text into sections
  const paragraphs = parseContractText(contratoTexto);

  // Create watermark header if provided
  const headerChildren: Paragraph[] = [];
  
  if (marcaDaguaBase64) {
    try {
      const imageBuffer = base64ToUint8Array(marcaDaguaBase64);
      
      headerChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: imageBuffer,
              transformation: {
                width: 300,
                height: 150,
              },
              floating: {
                horizontalPosition: {
                  align: HorizontalPositionAlign.CENTER,
                },
                verticalPosition: {
                  align: VerticalPositionAlign.CENTER,
                },
                behindDocument: true,
              },
              type: "png",
            }),
          ],
        })
      );
    } catch (error) {
      console.error("Error adding watermark image to DOCX:", error);
    }
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: {
            font: "Times New Roman",
            size: 24, // 12pt = 24 half-points
          },
          paragraph: {
            spacing: {
              line: 360, // 1.5 line spacing
              after: 200,
            },
          },
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          run: {
            bold: true,
            size: 28, // 14pt
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: {
              after: 400,
            },
          },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          run: {
            bold: true,
            size: 24,
          },
          paragraph: {
            spacing: {
              before: 400,
              after: 200,
            },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.98), // ~2.5cm
              bottom: convertInchesToTwip(0.98),
              left: convertInchesToTwip(1.18), // ~3cm
              right: convertInchesToTwip(0.98),
            },
          },
        },
        headers: {
          default: new Header({
            children: headerChildren,
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                    font: "Times New Roman",
                    size: 20,
                  }),
                ],
              }),
            ],
          }),
        },
        children: paragraphs,
      },
    ],
  });

  // Generate blob and download
  const blob = await Packer.toBlob(doc);
  
  // Format filename
  const dataAtual = new Date().toISOString().split("T")[0];
  const nomeFormatado = clienteNome.replace(/\s+/g, "_").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const tipoFormatado = tipoContrato.replace(/\s+/g, "_");
  const fileName = `Contrato_${tipoFormatado}_${nomeFormatado}_${dataAtual}.docx`;
  
  saveAs(blob, fileName);
}

function parseContractText(text: string): Paragraph[] {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];
  
  let isFirstLine = true;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines but add spacing
    if (!trimmedLine) {
      paragraphs.push(new Paragraph({ children: [] }));
      continue;
    }
    
    // Detect title (first non-empty line or lines with "CONTRATO DE")
    if (isFirstLine || trimmedLine.toUpperCase().startsWith("CONTRATO DE")) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine.toUpperCase(),
              bold: true,
              font: "Times New Roman",
              size: 28,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        })
      );
      isFirstLine = false;
      continue;
    }
    
    // Detect clause headers (CLÁUSULA, PRIMEIRA, etc.)
    if (
      /^CLÁUSULA\s/i.test(trimmedLine) ||
      /^(PRIMEIRA|SEGUNDA|TERCEIRA|QUARTA|QUINTA|SEXTA|SÉTIMA|OITAVA|NONA|DÉCIMA)/i.test(trimmedLine) ||
      /^(DAS PARTES|DO OBJETO|DO PRAZO|DO VALOR|DA RESCISÃO|DO FORO|DISPOSIÇÕES)/i.test(trimmedLine)
    ) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine.toUpperCase(),
              bold: true,
              font: "Times New Roman",
              size: 24,
            }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      continue;
    }
    
    // Detect section headers (all caps lines)
    if (trimmedLine === trimmedLine.toUpperCase() && trimmedLine.length > 5 && !trimmedLine.includes("R$")) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine,
              bold: true,
              font: "Times New Roman",
              size: 24,
            }),
          ],
          spacing: { before: 300, after: 200 },
        })
      );
      continue;
    }
    
    // Detect signature lines
    if (trimmedLine.startsWith("_") || trimmedLine.includes("________________")) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "_".repeat(50),
              font: "Times New Roman",
              size: 24,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 600, after: 100 },
        })
      );
      continue;
    }
    
    // Detect party identification under signature (names in bold)
    if (
      /^(LOCADOR|LOCATÁRIO|VENDEDOR|COMPRADOR|CONTRATANTE|CONTRATADO|CORRETOR|TESTEMUNHA)/i.test(trimmedLine) ||
      /^(Nome:|CPF:|CRECI:)/i.test(trimmedLine)
    ) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine,
              bold: /^(LOCADOR|LOCATÁRIO|VENDEDOR|COMPRADOR|CONTRATANTE|CONTRATADO|CORRETOR|TESTEMUNHA)/i.test(trimmedLine),
              font: "Times New Roman",
              size: 24,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        })
      );
      continue;
    }
    
    // Regular paragraph - justified text
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: trimmedLine,
            font: "Times New Roman",
            size: 24,
          }),
        ],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 200 },
      })
    );
    
    isFirstLine = false;
  }
  
  return paragraphs;
}

// Helper function to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const base64Data = base64.includes(",") ? base64.split(",")[1] : base64;
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
