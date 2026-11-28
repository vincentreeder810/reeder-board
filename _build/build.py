import json, re, html, pathlib, sys
import hashlib as _hl
_ROOT_FOR_V = __import__("pathlib").Path(__import__("sys").argv[1] if len(__import__("sys").argv) > 1 else ".")
ASSET_V = {k: _hl.md5((_ROOT_FOR_V / p).read_bytes()).hexdigest()[:8] for k, p in {"css": "assets/css/style.css", "js": "assets/js/main.js", "p3d": "assets/js/produkt3d.js"}.items()}

SRC = pathlib.Path(__file__).parent
OUT = pathlib.Path(sys.argv[1])
DOMAIN = "https://www.reeder-tech.de"
EMAIL = "kontakt@reeder-tech.de"

MARK = '''<svg viewBox="16.5 9 72 72" aria-hidden="true"><defs><linearGradient id="rm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f7cff"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><path d="M52 10C66 30 75 54 78 80H52Z" fill="url(#rm)"/><path d="M45 28C37 44 30 62 27 80H45Z" fill="currentColor"/></svg>'''

# Menü: fünf Punkte oben, darunter klappen die Unterseiten und Abschnitte auf. Jede Seite ist mit höchstens zwei Klicks erreichbar.
# (Schlüssel der Seite, Beschriftung, weitere Seiten, bei denen der Punkt als aktiv gilt, Unterpunkte)
NAV = [
    ("leistungen", "Software", "", [("leistungen.html", "Überblick"), ("leistungen.html#websites", "Websites & Web-Apps"), ("leistungen.html#apps", "Mobile Apps"),
        ("leistungen.html#telefon", "KI-Telefonassistent"), ("leistungen.html#ki", "KI & Automatisierung"), ("leistungen.html#praxis", "Praxis- & Patientensysteme"),
        ("leistungen.html#beratung", "Beratung & Konzept"), ("leistungen.html#anpassung", "Bestehende Software anpassen")]),
    ("hardware", "Hardware", "", [("hardware.html", "Überblick"), ("hardware.html#schritte", "So läuft es ab"), ("produkte.html#hardware", "Hardware-Produkte")]),
    ("produkte", "Produkte", "", [("produkte.html#software", "Software-Produkte"), ("produkte.html#hardware", "Hardware-Produkte")]),
    ("beispiele", "Beispiele", "", [("beispiele.html", "Überblick"), ("beispiele.html#websites", "Websites"), ("beispiele.html#shops", "Online-Shops"), ("beispiele.html#plattformen", "Plattformen & Portale"), ("beispiele.html#software", "Software für Betriebe"), ("beispiele.html#apps", "Apps"), ("beispiele.html#ki", "KI")]),
    ("modelle", "Preise", "", [("modelle.html#baukasten", "Preis-Baukasten"), ("modelle.html#neu", "Bezahlmodelle"), ("modelle.html#wege", "Andere Wege")]),
    ("arbeitsweise", "So arbeiten wir", "ablauf projekte", [("arbeitsweise.html", "Arbeitsweise & KI"), ("ablauf.html", "Ablauf & FAQ"), ("projekte.html", "Projekte")]),
]
CHEV = '<svg class="nav__chev" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

def header():
    def oben(k, v, also, sub):
        a = f'<a href="{k}.html" data-nav="{k}" data-also="{also}"' + (' aria-haspopup="true"' if sub else '') + f'>{html.escape(v)}{CHEV if sub else ""}</a>'
        if not sub: return a
        drop = "".join(f'<a href="{h}">{html.escape(t)}</a>' for h, t in sub)
        return f'<div class="nav__item">{a}<div class="nav__drop"><div class="nav__dropin">{drop}</div></div></div>'
    def mobil(i, k, v, also, sub):
        if not sub: return f'<a href="{k}.html" data-nav="{k}" data-also="{also}">{html.escape(v)}<small>0{i+1}</small></a>'
        inner = "".join(f'<a href="{h}">{html.escape(t)}</a>' for h, t in sub)
        return f'<details class="mnav"><summary>{html.escape(v)}<small>0{i+1}</small></summary><div class="mnav__sub">{inner}</div></details>'
    links = "".join(oben(*n) for n in NAV)
    mob = "".join(mobil(i, *n) for i, n in enumerate(NAV))
    return f'''<a class="sr-only" href="#inhalt">Zum Inhalt springen</a>
<header class="nav" id="nav">
  <div class="nav__inner">
    <a href="index.html" class="brand" aria-label="Reeder Software &amp; Hardware – Startseite"><span class="brand__mark">{MARK}</span><span class="brand__name">Reeder<span class="brand__sub">Software &amp; Hardware</span></span></a>
    <nav class="nav__links" aria-label="Hauptnavigation">{links}</nav>
    <a href="termin.html" class="btn btn--small btn--lime nav__cta">Termin buchen <span class="arr">→</span></a>
    <button class="nav__burger" aria-label="Menü öffnen" aria-expanded="false" id="burger"><span></span><span></span></button>
  </div>
  <div class="nav__mobile">{mob}<a href="termin.html" class="btn btn--lime">Kostenloses Erstgespräch buchen <span class="arr">→</span></a><a href="login" class="btn nav__mportal"><span>Zum Kundenportal</span><span class="arr">→</span></a></div>
</header>'''

FOOTER = f'''<footer class="footer">
  <div class="footer__inner">
    <div>
      <a href="index.html" class="brand"><span class="brand__mark">{MARK}</span><span class="brand__name">Reeder<span class="brand__sub">Software &amp; Hardware</span></span></a>
      <p class="footer__small">Software und Hardware aus Deutschland: digitale Lösungen mit KI, physische Produkte vom Konzept bis zum Prototyp – und eigene Produkte für Bildung und Gesellschaft.</p>
    </div>
    <div class="footer__col"><b>Leistungen</b><a href="leistungen.html#websites">Websites &amp; Web-Apps</a><a href="leistungen.html#telefon">KI-Telefonassistent</a><a href="leistungen.html#praxis">Praxissysteme</a><a href="hardware.html">Hardware-Entwicklung</a><a href="produkte.html">Eigene Produkte</a></div>
    <div class="footer__col"><b>Unternehmen</b><a href="beispiele.html">Beispiele</a><a href="modelle.html">Angebote &amp; Preise</a><a href="modelle.html#baukasten">Preis-Baukasten</a><a href="projekte.html">Projekte</a><a href="arbeitsweise.html">Arbeitsweise &amp; KI</a><a href="ablauf.html">Ablauf &amp; FAQ</a><a href="termin.html">Termin buchen</a></div>
    <div class="footer__col"><b>Kontakt</b><a href="mailto:{EMAIL}" class="js-mail">{EMAIL}</a><a href="login">Kundenportal</a><a href="impressum.html">Impressum</a><a href="datenschutz.html">Datenschutz</a></div>
  </div>
  <div class="footer__big" aria-hidden="true">Reeder.</div>
  <p class="footer__copy"><span>© <span data-year>2026</span> Reeder Software GmbH · Reeder Hardware GmbH</span><span>Entwickelt in Deutschland</span></p>
  <p class="footer__firmen">Gemeinsamer Auftritt zweier Unternehmen: Websites, Software und KI-Lösungen erbringt die Reeder Software GmbH, die Entwicklung physischer Produkte die Reeder Hardware GmbH. Ihr Vertragspartner ist jeweils die Gesellschaft, die in Ihrem Angebot genannt ist. Angaben zu beiden Unternehmen stehen im <a href="impressum.html">Impressum</a>.</p>
</footer>'''

MCTA = '<a href="termin.html" class="mcta" id="mcta">Kostenloses Erstgespräch <span class="arr">→</span></a>'

FONTS_BASE = "family=Inter:wght@300;400;500;600;700"

ORG = {
    "@type": "Organization", "@id": DOMAIN + "/#org", "name": "Reeder Software GmbH", "url": DOMAIN + "/",
    "logo": DOMAIN + "/assets/img/favicon.svg", "email": EMAIL,
    "description": "Softwareentwicklung, KI-Integration, Websites, Apps und Praxissoftware aus Deutschland – und Entwicklung physischer Produkte vom Konzept bis zum Prototyp.",
    "knowsAbout": ["Hardware-Entwicklung", "Produktentwicklung", "Softwareentwicklung", "Webentwicklung", "App-Entwicklung", "KI-Integration", "Praxissoftware", "Patientenportal"],
    "areaServed": "DE",
}

def faq_ld(body):
    qa = re.findall(r"<summary>(.*?)</summary><p>(.*?)</p>", body, re.S)
    return {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": html.unescape(q), "acceptedAnswer": {"@type": "Answer", "text": html.unescape(re.sub("<.*?>", "", a))}} for q, a in qa]}

# Richtwerte für Suchmaschinen (Preise-Seite und Beispiele): Leistung mit Mindestpreis
PREIS_LD = [("Website erstellen lassen", "Firmen-Website, individuell gestaltet und für Google optimiert", 1500),
            ("Online-Shop erstellen lassen", "Online-Shop von Grund auf, ohne Shopify oder externe Dienstleister", 3000),
            ("Web-App entwickeln lassen", "Plattformen und Portale, z. B. Buchungsplattform oder Kundenportal", 3000),
            ("Software für Betriebe entwickeln lassen", "Branchensoftware wie Patienten- oder Auftragsverwaltung", 5000)]
def preis_ld():
    return {"@type": "OfferCatalog", "name": "Richtwerte für Websites, Online-Shops, Web-Apps und Software", "itemListElement": [
        {"@type": "Offer", "itemOffered": {"@type": "Service", "name": n, "description": d, "provider": {"@id": DOMAIN + "/#org"}, "areaServed": "DE"},
         "priceSpecification": {"@type": "PriceSpecification", "minPrice": p, "priceCurrency": "EUR", "valueAddedTaxIncluded": False}} for n, d, p in PREIS_LD]}

def crumbs(name, path):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Start", "item": DOMAIN + "/"},
        {"@type": "ListItem", "position": 2, "name": name, "item": DOMAIN + "/" + path}]}

APPS = [("Perspektive", "LifestyleApplication", "App, die verstehen lässt, warum Menschen zu ihren Positionen kommen – mit Persönlichkeitstest und Rhetorik-Training."),
        ("Lernpass", "EducationalApplication", "Lern-App, bei der die KI Fragen stellt statt Antworten vorzugeben – für iPhone, iPad, Android und Web."),
        ("BusinessCat", "BusinessApplication", "Web-App für KI-geführte Unternehmensgründung in Phasen – mit Experten-Matching und Investorenzugang."),
        ("Covered", "LifestyleApplication", "Persönliches Team aus KI-Agenten, das selbstständig handelt – ruft an, bucht Termine, stimmt sich mit anderen ab (in Entwicklung).")]

SERVICES = ["Software- & KI-Beratung", "Anpassung bestehender Software", "Websites & Web-Apps", "KI-Telefonassistent", "KI-Integration", "Praxis- & Patientensysteme", "Mobile Apps", "Automatisierung", "Konzept & kostenloser Prototyp", "Marktrecherche & rechtliche Vorprüfung"]

HW_SERVICES = ["Machbarkeit & Varianten", "Entwicklungskonzept mit 3D-Modell", "Prototypenbau"]

PAGES = [
    dict(file="index.html", page="start", path="",
         title="Reeder Software & Hardware – Software, KI und Produktentwicklung aus Deutschland",
         desc="Websites, Apps, KI-Telefonassistenten und Praxissoftware – und physische Produkte vom technischen Konzept mit 3D-Modell bis zum Prototyp. Jetzt kostenloses Erstgespräch buchen.",
         fraunces=True, ld=lambda b: [ORG, {"@type": "WebSite", "@id": DOMAIN + "/#web", "url": DOMAIN + "/", "name": "Reeder Software & Hardware", "inLanguage": "de-DE", "publisher": {"@id": DOMAIN + "/#org"}}, faq_ld(b)]),
    dict(file="produkte.html", page="produkte", path="produkte.html",
         title="Produkte: Software und Hardware von Reeder | Covered, BusinessCat, Lernpass, Perspektive",
         desc="Unsere eigenen Produkte: Perspektive (Verstehen & Rhetorik), Lernpass (Lernen mit KI), BusinessCat (Gründung mit KI) und Covered (KI-Agenten, die für Sie handeln). Demo buchen, lizenzieren, anpassen.",
         fraunces=True, ld=lambda b: [crumbs("Produkte", "produkte.html"), {"@type": "ItemList", "itemListElement": [
             {"@type": "ListItem", "position": i + 1, "item": {"@type": "SoftwareApplication", "name": n, "applicationCategory": c, "description": d, "operatingSystem": "Web, iOS, Android", "publisher": {"@id": DOMAIN + "/#org"}}} for i, (n, c, d) in enumerate(APPS)]}]),
    dict(file="leistungen.html", page="leistungen", path="leistungen.html",
         title="Leistungen: Webentwicklung, KI-Telefonassistent & Praxissoftware | Reeder Software",
         desc="Websites, Apps, KI-Telefonassistenten, KI-Integration, Patientenverwaltung, Marktrecherche und rechtliche Vorprüfung – mit kostenlosem Prototyp, aus einer Hand.",
         fraunces=False, ld=lambda b: [crumbs("Leistungen", "leistungen.html"), {"@type": "ItemList", "itemListElement": [
             {"@type": "ListItem", "position": i + 1, "item": {"@type": "Service", "name": s, "provider": {"@id": DOMAIN + "/#org"}, "areaServed": "DE"}} for i, s in enumerate(SERVICES)]}]),
    dict(file="hardware.html", page="hardware", path="hardware.html",
         title="Hardware-Entwicklung: vom Konzept mit 3D-Modell zum Prototyp | Reeder Hardware",
         desc="Wir entwickeln physische Produkte: Machbarkeit und Varianten, Entwicklungskonzept mit 3D-Modell, Stückliste und Bauanleitung, auf Wunsch der gebaute Prototyp. Erstgespräch kostenlos.",
         fraunces=False, ld=lambda b: [crumbs("Hardware", "hardware.html"), {"@type": "ItemList", "itemListElement": [
             {"@type": "ListItem", "position": i + 1, "item": {"@type": "Service", "name": s, "provider": {"@id": DOMAIN + "/#org"}, "areaServed": "DE"}} for i, s in enumerate(HW_SERVICES)]}]),
    dict(file="projekte.html", page="projekte", path="projekte.html",
         title="Projekte & Referenzen | Reeder Software GmbH",
         desc="Referenzen der Reeder Software GmbH: Patientenverwaltung für Physiotherapie und Schönheitschirurgie, KI-Telefonassistent, Lern-Apps und mehr.",
         fraunces=True, ld=lambda b: [crumbs("Projekte", "projekte.html")]),
    dict(file="ablauf.html", page="ablauf", path="ablauf.html",
         title="Ablauf & FAQ: So arbeiten wir | Reeder Software GmbH",
         desc="Vom kostenlosen Erstgespräch über Konzept und kostenlosen Prototyp bis zur Einrichtung: So läuft ein Softwareprojekt mit Reeder Software. Plus Antworten auf häufige Fragen.",
         fraunces=False, ld=lambda b: [crumbs("Ablauf & FAQ", "ablauf.html"), faq_ld(b)]),
    dict(file="beispiele.html", page="beispiele", path="beispiele.html",
         title="Beispiele: Website, Online-Shop & Software erstellen lassen | Reeder Software",
         desc="Beispiele zum Durchklicken: Firmen-Websites, Online-Shops ohne Shopify, Buchungsplattformen, Kundenportale, Patienten- und Auftragsverwaltung – mit Vorteilen und Richtwerten ab 1.500 €.",
         fraunces=False, ld=lambda b: [crumbs("Beispiele", "beispiele.html"), preis_ld(), faq_ld(b)]),
    dict(file="modelle.html", page="modelle", path="modelle.html",
         title="Preise: Was kostet eine Website, ein Online-Shop oder Software? | Reeder Software",
         desc="Website ab 1.500 €, Online-Shop ab 3.000 €, Web-App ab 3.000 €, Software ab 5.000 € – Richtwerte im interaktiven Preis-Baukasten, für Google optimiert. Dazu Festpreis, Betreuung oder Signature.",
         fraunces=False, ld=lambda b: [crumbs("Angebote & Preise", "modelle.html"), preis_ld(), faq_ld(b)]),
    dict(file="arbeitsweise.html", page="arbeitsweise", path="arbeitsweise.html",
         title="So entstehen unsere Produkte: Softwareentwicklung mit KI | Reeder Software",
         desc="Wir programmieren mit KI – und zeigen offen, wie. Warum es auf die Menschen ankommt, die die KI führen, und was Sie davon haben: schnellere Prototypen, faire Preise, geprüfte Qualität.",
         fraunces=False, ld=lambda b: [crumbs("Arbeitsweise", "arbeitsweise.html"), faq_ld(b)]),
    dict(file="termin.html", page="termin", path="termin.html",
         title="Termin buchen – kostenloses Erstgespräch | Reeder Software & Hardware",
         desc="Buchen Sie online ein kostenloses Erstgespräch für Software oder Hardware, eine Produktdemo oder eine Beratung – oder beschreiben Sie Ihr Projekt. Antwort innerhalb eines Werktags.",
         fraunces=False, ld=lambda b: [crumbs("Termin buchen", "termin.html")]),
]

def head(p, robots="index, follow"):
    fonts = FONTS_BASE + ("&family=Fraunces:opsz,wght@9..144,500;9..144,600" if p.get("fraunces") else "")
    url = DOMAIN + "/" + p["path"]
    ld = ""
    if p.get("ld"):
        ld = '\n<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@graph": p["ld"](p["body"])}, ensure_ascii=False) + "</script>"
    return f'''<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(p["title"])}</title>
<meta name="description" content="{html.escape(p["desc"])}">
<meta name="robots" content="{robots}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_DE">
<meta property="og:site_name" content="Reeder Software &amp; Hardware">
<meta property="og:title" content="{html.escape(p["title"])}">
<meta property="og:description" content="{html.escape(p["desc"])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{DOMAIN}/assets/img/og-image.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#000000">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="icon" href="assets/img/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="preload" href="assets/fonts/Inter_400Regular.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="assets/css/style.css?v={ASSET_V["css"]}">{ld}
</head>'''

def page(p, robots="index, follow"):
    mcta = "" if p["page"] in ("termin", "legal") else MCTA
    return f'''{head(p, robots)}
<body data-page="{p["page"]}" data-p3d="{ASSET_V["p3d"]}">
{header()}
<main id="inhalt">
{p["body"]}
</main>
{FOOTER}
{mcta}
<a href="login" class="fab" id="fab" aria-label="Kundenportal – Anmeldung für Kunden" title="Kundenportal"><span class="fab__ico"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></svg></span><span class="fab__txt">Kundenportal</span></a>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="assets/js/main.js?v={ASSET_V["js"]}"></script>
</body>
</html>
'''

for p in PAGES:
    p["body"] = (SRC / p["file"].replace(".html", ".body.html")).read_text(encoding="utf-8").strip()
    (OUT / p["file"]).write_text(page(p), encoding="utf-8")
    print("wrote", p["file"])

# Rechtliche Seiten: Inhalt übernehmen, neue Hülle
for f, t in [("impressum.html", "Impressum"), ("datenschutz.html", "Datenschutz")]:
    old = (OUT / f).read_text(encoding="utf-8")
    m = re.search(r'<div class="legal">(.*?)</div>\s*</main>', old, re.S)
    body = '<div class="dark" style="height:68px;position:absolute;inset:0 0 auto"></div>\n<div class="legal">' + m.group(1).strip() + "</div>"
    p = dict(file=f, page="legal", path=f, title=f"{t} | Reeder Software GmbH", desc=f"{t} der Reeder Software GmbH.", body=body)
    (OUT / f).write_text(page(p, robots="noindex, follow"), encoding="utf-8")
    print("wrote", f)

# sitemap & robots
urls = "".join(f"  <url><loc>{DOMAIN}/{p['path']}</loc><changefreq>monthly</changefreq><priority>{'1.0' if not p['path'] else '0.8'}</priority></url>\n" for p in PAGES)
(OUT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n', encoding="utf-8")
(OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {DOMAIN}/sitemap.xml\n", encoding="utf-8")
print("wrote sitemap.xml, robots.txt")
