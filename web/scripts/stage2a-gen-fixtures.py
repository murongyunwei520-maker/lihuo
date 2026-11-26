from pathlib import Path
from xml.sax.saxutils import escape
import zipfile

root = Path(__file__).parent / "fixtures"
root.mkdir(exist_ok=True)
text = (root / "雾港夜航.txt").read_text(encoding="utf-8")
(root / "雾港夜航-gb18030.txt").write_bytes(text.encode("gb18030"))
(root / "空文件.txt").write_bytes(b"")
(root / "损坏的文档.pdf").write_bytes(b"not a real pdf")
(root / "损坏的文档.docx").write_bytes(b"PK\\x03\\x04broken")

paragraphs = [line for line in text.splitlines() if line.strip()]
document = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    "<w:body>"
    + "".join(f'<w:p><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>' for line in paragraphs)
    + "</w:body></w:document>"
)
content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)
rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)
with zipfile.ZipFile(root / "雾港夜航.docx", "w", zipfile.ZIP_DEFLATED) as docx:
    docx.writestr("[Content_Types].xml", content_types)
    docx.writestr("_rels/.rels", rels)
    docx.writestr("word/document.xml", document)

html_lines = "".join(f"<p>{escape(line)}</p>" for line in paragraphs)
(root / "雾港夜航.html").write_text(
    '<!doctype html><html><head><meta charset="utf-8"><style>'
    '@page{size:A4;margin:18mm}body{font-family:"Microsoft YaHei","SimSun",serif;font-size:12pt;line-height:1.75}'
    "p{margin:0 0 6pt}h1{font-size:18pt}</style></head><body>"
    + html_lines
    + "</body></html>",
    encoding="utf-8",
)

with open(root / "超大文件.txt", "wb") as large:
    large.truncate(21 * 1024 * 1024)

print("fixtures:", root)
for path in sorted(root.iterdir()):
    print(path.name, path.stat().st_size)
