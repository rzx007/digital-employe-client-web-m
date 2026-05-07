import cssIcon from "@/assets/files/css.png"
import docIcon from "@/assets/files/doc.png"
import docxIcon from "@/assets/files/docx.png"
import htmlIcon from "@/assets/files/html.png"
import mdIcon from "@/assets/files/md.png"
import pdfIcon from "@/assets/files/pdf.png"
import plainIcon from "@/assets/files/plain_dark.png"
import svgIcon from "@/assets/files/svg.png"
import txtIcon from "@/assets/files/txt.png"
import xlsIcon from "@/assets/files/xls.png"
import xlsxIcon from "@/assets/files/xlsx.png"

export const EXTENSION_ICONS: Record<string, string> = {
  css: cssIcon,
  doc: docIcon,
  docx: docxIcon,
  html: htmlIcon,
  htm: htmlIcon,
  md: mdIcon,
  pdf: pdfIcon,
  svg: svgIcon,
  text: txtIcon,
  txt: txtIcon,
  xls: xlsIcon,
  xlsx: xlsxIcon,
}

export function getFileIcon(filename: string): string {
  const ext = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : ""
  return ext ? EXTENSION_ICONS[ext] ?? plainIcon : plainIcon
}
