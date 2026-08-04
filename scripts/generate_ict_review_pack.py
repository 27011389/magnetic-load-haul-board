from pathlib import Path
from io import BytesIO
from zipfile import ZipFile

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"
ASSETS = ROOT / "docs" / "manual-assets"
LOGO = ROOT / "public" / "ConsminLogo.png"
REFERENCE_DOCX = Path(r"C:\Users\mark.pepere\Downloads\Lightning and Storm Events Procedure_V2.docx")
OUTPUT.mkdir(parents=True, exist_ok=True)

RED = colors.HexColor("#C8102E")
DARK = colors.HexColor("#252525")
MID = colors.HexColor("#606060")
LIGHT_RED = colors.HexColor("#F7E8EA")
LIGHT_GREY = colors.HexColor("#F2F2F2")
LINE = colors.HexColor("#C9C9C9")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="PackTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=27, textColor=DARK, spaceAfter=14))
styles.add(ParagraphStyle(name="PackSubtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=11, leading=16, textColor=MID, spaceAfter=12))
styles.add(ParagraphStyle(name="PackH1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=RED, spaceBefore=8, spaceAfter=8, keepWithNext=True))
styles.add(ParagraphStyle(name="PackH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=DARK, spaceBefore=7, spaceAfter=5, keepWithNext=True))
styles.add(ParagraphStyle(name="PackBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5, leading=14, textColor=DARK, spaceAfter=6))
styles.add(ParagraphStyle(name="PackSmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=8, leading=11, textColor=MID, spaceAfter=3))
styles.add(ParagraphStyle(name="PackCaption", parent=styles["BodyText"], fontName="Helvetica-Oblique", fontSize=8, leading=11, textColor=MID, alignment=TA_CENTER, spaceBefore=3, spaceAfter=9))
styles.add(ParagraphStyle(name="PackCell", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=11, textColor=DARK))
styles.add(ParagraphStyle(name="PackCellHead", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=colors.white))


def template_image(member):
    with ZipFile(REFERENCE_DOCX) as package:
        return ImageReader(BytesIO(package.read(member)))


STANDARD_LOGO = template_image("word/media/image3.png")
STANDARD_FIRST_BANNER = template_image("word/media/image4.jpg")


def short_document_title(canvas):
    title = getattr(canvas._doc.info, "title", "") or ""
    if "Screenshot" in title:
        return "Application Screenshots"
    if "Checklist" in title:
        return "ICT Security Assessment Checklist"
    return "Technical and Security Overview"


def draw_page_chrome(canvas, pagesize, page_number, page_count):
    width, height = pagesize
    canvas.saveState()
    canvas.resetTransforms()

    title = short_document_title(canvas)
    if page_number == 1:
        canvas.drawImage(STANDARD_FIRST_BANNER, 0, height - 22 * mm, width=width, height=22 * mm, preserveAspectRatio=False, mask="auto")
        canvas.setFillColor(DARK)
        canvas.setFont("Helvetica-Bold", 8.5)
        canvas.drawRightString(width - 15 * mm, height - 26 * mm, "Mining Operations")
        canvas.setFont("Helvetica-Bold", 9.5)
        canvas.drawRightString(width - 15 * mm, height - 31 * mm, title)
    else:
        canvas.drawImage(STANDARD_LOGO, 15 * mm, height - 16 * mm, width=37 * mm, height=11 * mm, preserveAspectRatio=True, mask="auto")
        canvas.setFillColor(DARK)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawRightString(width - 15 * mm, height - 9 * mm, "Mining Operations")
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawRightString(width - 15 * mm, height - 14 * mm, title)
        canvas.setStrokeColor(LINE)
        canvas.line(15 * mm, height - 18 * mm, width - 15 * mm, height - 18 * mm)

    left = 15 * mm
    right = width - 15 * mm
    table_bottom = 3.5 * mm
    value_line = 8 * mm
    table_top = 13 * mm
    canvas.setFillColor(RED)
    canvas.setFont("Helvetica", 6.5)
    canvas.drawCentredString(width / 2, 16.5 * mm, "UNCONTROLLED once printed. Please refer to BMS for latest version.")

    raw_widths = [28, 16, 20, 46, 46, 24]
    scale = (right - left) / sum(raw_widths)
    widths = [value * scale for value in raw_widths]
    xs = [left]
    for column_width in widths:
        xs.append(xs[-1] + column_width)
    canvas.setStrokeColor(colors.HexColor("#777777"))
    canvas.setLineWidth(0.35)
    for x in xs:
        canvas.line(x, table_bottom, x, table_top)
    for y in (table_bottom, value_line, table_top):
        canvas.line(left, y, right, y)

    labels = ("Document Number", "Revision", "Date", "Authored / Updated by", "Approved by", "Page")
    values = ("TBC", "Draft 1", "Aug-26", "Mark Pepere", "Pending", f"{page_number} of {page_count}")
    for index, (label, value) in enumerate(zip(labels, values)):
        centre = (xs[index] + xs[index + 1]) / 2
        canvas.setFillColor(DARK)
        canvas.setFont("Helvetica-Bold", 5.8)
        canvas.drawCentredString(centre, 9.7 * mm, label)
        canvas.setFont("Helvetica", 6.2)
        canvas.drawCentredString(centre, 5.3 * mm, value)
    canvas.restoreState()


class ChromeCanvas(Canvas):
    def __init__(self, *args, **kwargs):
        Canvas.__init__(self, *args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        page_count = len(self._saved_page_states)
        for page_number, state in enumerate(self._saved_page_states, 1):
            self.__dict__.update(state)
            draw_page_chrome(self, self._pagesize, page_number, page_count)
            Canvas.showPage(self)
        Canvas.save(self)


def bullet(text):
    return Paragraph(f"&#8226;&nbsp;&nbsp;{text}", styles["PackBody"])


def numbered(items):
    result = []
    for index, item in enumerate(items, 1):
        result.append(Paragraph(f"{index}.&nbsp;&nbsp;{item}", styles["PackBody"]))
    return result


def red_table(rows, widths):
    prepared = []
    for row_index, row in enumerate(rows):
        style = styles["PackCellHead"] if row_index == 0 else styles["PackCell"]
        prepared.append([Paragraph(str(value), style) for value in row])
    table = Table(prepared, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), RED),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("BACKGROUND", (0, 1), (0, -1), LIGHT_RED),
    ]))
    return table


def build_network_diagram():
    path = OUTPUT / "Load_Haul_Shiftboard_Network_Flow.png"
    image = Image.new("RGB", (1800, 1000), "white")
    draw = ImageDraw.Draw(image)
    try:
        title_font = ImageFont.truetype("arialbd.ttf", 46)
        node_font = ImageFont.truetype("arialbd.ttf", 25)
        detail_font = ImageFont.truetype("arial.ttf", 21)
    except OSError:
        title_font = node_font = detail_font = ImageFont.load_default()

    draw.rectangle((0, 0, 1800, 90), fill="#C8102E")
    draw.text((70, 22), "Proposed Load and Haul Shiftboard Network Flow", fill="white", font=title_font)

    def box(bounds, heading, detail, fill="#F7E8EA", outline="#C8102E"):
        draw.rounded_rectangle(bounds, radius=18, fill=fill, outline=outline, width=4)
        x1, y1, x2, y2 = bounds
        draw.text(((x1 + x2) / 2, y1 + 28), heading, fill="#252525", font=node_font, anchor="ma")
        draw.multiline_text(((x1 + x2) / 2, y1 + 78), detail, fill="#505050", font=detail_font, anchor="ma", align="center", spacing=8)

    client_boxes = [
        (70, 150, 390, 320, "Control", "Authorised editing\nand handover"),
        (510, 150, 830, 320, "Mine 2", "Operational viewing\nand verification"),
        (950, 150, 1270, 320, "Mine 3", "Operational viewing\nand verification"),
        (1390, 150, 1710, 320, "Other approved screens", "TV or supervisor\nbrowser access"),
    ]
    for x1, y1, x2, y2, heading, detail in client_boxes:
        box((x1, y1, x2, y2), heading, detail)

    box((565, 430, 1235, 590), "Company internal network", "Approved devices and restricted access paths", fill="#F2F2F2", outline="#777777")
    box((565, 690, 1235, 910), "Approved host", "Node.js application | TCP port or HTTPS proxy\nWorker API | Local D1-compatible database", fill="#F7E8EA")

    for cx in (230, 670, 1110, 1550):
        draw.line((cx, 320, 900, 430), fill="#555555", width=5)
    draw.line((900, 590, 900, 690), fill="#555555", width=6)
    draw.polygon([(900, 690), (886, 665), (914, 665)], fill="#555555")
    draw.text((940, 625), "Restricted internal access", fill="#505050", font=detail_font)
    draw.text((70, 955), "No separate database port | No internet exposure proposed | Authentication and HTTPS subject to ICT assessment", fill="#505050", font=detail_font)
    image.save(path, quality=95)
    return path


def build_technical_overview(network_path):
    path = OUTPUT / "Load_Haul_Shiftboard_Technical_Security_Overview.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=17 * mm, leftMargin=17 * mm, topMargin=35 * mm, bottomMargin=24 * mm, title="Load and Haul Shiftboard Technical and Security Overview", author="ConsMin Operations")
    story = [
        Spacer(1, 8 * mm),
        Paragraph("Load and Haul Shiftboard", styles["PackTitle"]),
        Paragraph("Technical and Security Overview for ICT Assessment", styles["PackSubtitle"]),
        red_table([
            ["Item", "Detail"],
            ["Purpose", "Provide technical evidence for ICT to assess whether the application is safe to run"],
            ["ICT involvement", "Security and vulnerability review only; no transfer of maintenance or support ownership"],
            ["Proposed users", "Control, Mine 2, Mine 3, and approved operational displays"],
            ["Repository", "Private source repository containing employee names and operational information"],
        ], [40 * mm, 132 * mm]),
        Paragraph("1. Application purpose", styles["PackH1"]),
        Paragraph("The application recreates the existing Load and Haul whiteboard in a browser. Approved locations can view the same live board. Control can update operational allocations without personnel travelling between physical boards.", styles["PackBody"]),
        Paragraph("2. Technology stack", styles["PackH1"]),
        red_table([
            ["Component", "Purpose"],
            ["React", "Interactive board and drag-and-drop user interface"],
            ["TypeScript", "Frontend, backend API, and shared data types"],
            ["Vite and Vinext", "Application development and production build tooling"],
            ["Worker API", "Validated board load and save requests"],
            ["Wrangler and Miniflare", "Local Worker-compatible runtime and database environment"],
            ["D1-compatible SQLite", "Board state, magnet positions, links, notes, and shift details"],
            ["Node.js 22 LTS", "Host runtime"],
            ["GitHub", "Private source control and version history"],
        ], [43 * mm, 129 * mm]),
        PageBreak(),
        Paragraph("3. Proposed network and data flow", styles["PackH1"]),
        RLImage(str(network_path), width=172 * mm, height=95.5 * mm),
        Paragraph("The database remains behind the application API and does not expose a separate network port.", styles["PackCaption"]),
        Paragraph("4. Current security characteristics", styles["PackH1"]),
        *[bullet(item) for item in [
            "Exact dependency versions locked by package-lock.json and installed with npm ci",
            "Private npm package configuration",
            "Backend validation before board data is written",
            "No Wenco, SQL Server, email, Active Directory, or company credentials stored by the application",
            "No external cloud connection required during normal proposed onsite operation",
            "Local operational data stored on the approved host",
        ]],
        Paragraph("5. Known limitations requiring assessment", styles["PackH1"]),
        *[bullet(item) for item in [
            "No application-level authentication in the current build",
            "No HTTPS in the direct local-host arrangement",
            "No enforced editor and viewer roles",
            "Last-write-wins saving when multiple users edit simultaneously",
            "No server-side audit history beyond the latest update metadata",
            "Employee names and operational information require controlled access",
        ]],
        PageBreak(),
        Spacer(1, 8 * mm),
        Paragraph("6. Proposed risk controls", styles["PackH1"]),
        *numbered([
            "Use an approved host under company antivirus, EDR, and patching controls",
            "Restrict network access to approved devices or network ranges",
            "Prevent internet exposure",
            "Run the service under a restricted non-administrator identity",
            "Use HTTPS and approved authentication if ICT requires them",
            "Back up and test restoration of the local board data",
            "Maintain supported Node.js and dependency versions",
            "Record the application owner, support arrangement, and approval conditions",
        ]),
        Paragraph("7. Ownership boundary", styles["PackH1"]),
        Paragraph("ICT is being asked to review the design, assess vulnerabilities, and advise whether the application is safe to run. Approval does not transfer application ownership, maintenance, deployment, monitoring, backup, or user-support responsibility to ICT.", styles["PackBody"]),
    ]
    doc.build(story, canvasmaker=ChromeCanvas)
    return path


def build_screenshot_sheet():
    path = OUTPUT / "Load_Haul_Shiftboard_Application_Screenshots.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=landscape(A4), rightMargin=14 * mm, leftMargin=14 * mm, topMargin=35 * mm, bottomMargin=24 * mm, title="Load and Haul Shiftboard Application Screenshots", author="ConsMin Operations")
    width, _ = landscape(A4)
    usable = width - 28 * mm
    story = [Spacer(1, 4 * mm)]
    figures = [
        ("board-overview.png", "Full board overview", "Day-shift example showing work sections, fleet, operators, and shared board layout"),
        ("quick-controls.png", "Control and quick actions", "Search, crew allocation, personnel clearing, fleet cleanup, section controls, and shift totals"),
        ("park-up-lanes.png", "Park-up and status lanes", "Go line, shut pad, workshop, standby, and long-term park-up areas"),
        ("auxiliary-fleet.png", "Auxiliary fleet", "Representative equipment available for board allocation and reset actions"),
    ]
    for index, (filename, title, caption) in enumerate(figures):
        source = ASSETS / filename
        with Image.open(source) as im:
            ratio = im.height / im.width
        image_width = min(usable, 240 * mm)
        image_height = min(image_width * ratio, 105 * mm)
        image_width = image_height / ratio
        block = [Paragraph(title, styles["PackH1"]), RLImage(str(source), width=image_width, height=image_height), Paragraph(caption, styles["PackCaption"])]
        story.append(KeepTogether(block))
        if index < len(figures) - 1:
            story.append(PageBreak())
    doc.build(story, canvasmaker=ChromeCanvas)
    return path


def build_checklist():
    path = OUTPUT / "Load_Haul_Shiftboard_ICT_Security_Assessment_Checklist.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=16 * mm, leftMargin=16 * mm, topMargin=35 * mm, bottomMargin=24 * mm, title="Load and Haul Shiftboard ICT Security Assessment Checklist", author="ConsMin Operations")
    rows = [["Check", "Assessment area", "ICT finding or condition"]]
    areas = [
        "Source code and dependency vulnerabilities",
        "Repository privacy and personal-information handling",
        "Approved host configuration and hardening",
        "Network exposure and firewall scope",
        "Authentication requirement",
        "HTTPS and certificate requirement",
        "API input validation and database access",
        "Editor and viewer permission requirements",
        "Logging, monitoring, and incident response",
        "Backup, restoration, and data retention",
        "Node.js and dependency update expectations",
        "Approval conditions and residual risks",
    ]
    rows.extend([["[  ]", area, ""] for area in areas])
    checklist = red_table(rows, [14 * mm, 70 * mm, 88 * mm])
    checklist.setStyle(TableStyle([("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GREY]), ("ALIGN", (0, 1), (0, -1), "CENTER")]))
    decision = red_table([
        ["Decision", "Selection / details"],
        ["Assessment outcome", "[  ] Approved   [  ] Approved with conditions   [  ] Not approved"],
        ["Required actions", ""],
        ["Reviewer", ""],
        ["Date", ""],
    ], [47 * mm, 125 * mm])
    story = [
        Spacer(1, 5 * mm),
        Paragraph("ICT Security Assessment Checklist", styles["PackTitle"]),
        Paragraph("Use this checklist to record the security and vulnerability assessment. Completion does not transfer application ownership or maintenance responsibility to ICT.", styles["PackSubtitle"]),
        checklist,
        Spacer(1, 8 * mm),
        decision,
    ]
    doc.build(story, canvasmaker=ChromeCanvas)
    return path


if __name__ == "__main__":
    network = build_network_diagram()
    outputs = [
        network,
        build_technical_overview(network),
        build_screenshot_sheet(),
        build_checklist(),
    ]
    for output in outputs:
        print(output)
