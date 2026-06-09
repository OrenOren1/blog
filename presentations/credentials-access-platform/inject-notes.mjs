#!/usr/bin/env node
// Inject a small set of speaker notes (Hebrew, RTL-wrapped). Removes any
// existing `<!-- ... -->` block at the end of each slide body first, then
// injects the configured note for the chosen slides only. All other slides
// are left empty so the author can fill them in.

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLIDES = resolve(HERE, "slides.md");
const BACKUP = resolve(HERE, "slides.md.pre-notes.bak");

// Hebrew speaker notes for every slide. RTL wrapper so English tech
// terms (RDS, Atlas, Okta, ADR-008, D-1) render LTR within the Hebrew
// block via Unicode bidi.
const NOTES = {
  1: `<div dir="rtl">

פתיחה. הדק הולך מהבעיה דרך הארכיטקטורה אל ההחלטות הפתוחות. קהל: פלטפורמה,
אבטחה, SRE. יעד היישור — מודל ארבעת המקרים לבני אדם, Workload OIDC לשירותים,
ושלוש שכבות IaC (ADR-008). ~25 דק' + שאלות.

</div>`,
  2: `<div dir="rtl">

לפתוח עם דחיפות. סוד SCRAM משותף לכל workload ולכל אדם הוא הסיכון המוביל —
לפטופ on-call שנפרץ + סוד K8s ישן = כתיבה מתמשכת על כל הדאטה. מספרים להזכיר:
27 K8s Secrets בגילאים 87–291 ימים, 16 ORG_OWNERs באטלס, 18 חשבונות לא
פעילים מעל 12 חודש. הוק: "עומד להכפיל את עצמו" — prod-eu עולה והחוב גדל
לפי region × DB.

</div>`,
  3: `<div dir="rtl">

חמישה עקרונות נעולים — להציג כקווי שופט, לא העדפות. לעצור על "split
source-of-truth" — Okta הוא הסמכות לבני אדם, IaC הוא הסמכות לשירותים. זו
ההפנמה הקשה ביותר. "Three-layer IaC" זה ADR-008: Pulumi לאתחול (Tier 1)
+ Crossplane בסיס מנהל ב-platform-tools (Tier 2a) + Crossplane self-service
לכל אזור (Tier 2b).

</div>`,
  4: `<div dir="rtl">

הפלטפורמה היא קופסה שחורה — כל מה שמסביב הוא או actor (שירותים / מהנדסים
/ מנהלים) או תלות קשה (Okta, PagerDuty, Twingate, ה-DBs). הגבול המרכזי —
בני אדם לעולם לא מקלידים סיסמת DB, שירותים לעולם לא שומרים סיסמה. לחזק:
התלויות משרתות רק את מסלול בני האדם — שירותים עוקפים את Okta / PD /
Twingate לחלוטין דרך Workload OIDC.

</div>`,
  5: `<div dir="rtl">

מעבר view. ה-Functional view עונה על "מה המערכת עושה" — אחריות, לא מוצרים.
~10 שניות; השקף הבא הוא העיקרון.

</div>`,
  6: `<div dir="rtl">

עשרה אלמנטים, כל אחד אחריות. הזוג Eligibility Manager + Trust-Binding
Manager הוא מימוש ה-split-SoT. Service Role Reconciler + Workload
Identity Verifier מטפלים במסלול השירותים. Identity Federator + JIT Role
Materializer נושאים את מסלול בני האדם — מנגנון ה-JIT עדיין פתוח (D-1).
Audit Aggregator → Access Review Aggregator סוגרים את לולאת הביקורת.

</div>`,
  7: `<div dir="rtl">

שישה כרטיסים — האחריות שתמיד פעילה. האלמנט "open per D-1" הוא JIT Role
Materializer; המימוש שלו (Path A: בנייה מעל Okta API · Path B: ספק חיצוני
· Path C: היברידי) הוא החתיכה הארכיטקטונית היחידה שעוד לא הוחלטה ב-ADR-007.

</div>`,
  8: `<div dir="rtl">

תבנית R&W ל-Functional view — להציג את שלוש הפרספקטיבות שחשובות לבעלי
עניין שונים. אבטחה שואלת על blast radius. אבולוציה שואלת על עלות שינוי
כשנכנס DB חדש. שימושיות שואלת מי-לומד-מה. להשאיר את השקף הזה דחוס; הוא
מכין את ה-views שיבואו.

</div>`,
  9: `<div dir="rtl">

המסגור החשוב ביותר בדק כולו. שני מסלולי זהות נפרדים: בני אדם דרך SAML
backbone של Okta (3 וריאציות — standing RO מ-group attr · JIT Platform
ל-RW + on-call admin · break-glass ל-admin / ORG_OWNER ישירות) ושירותים
דרך Workload OIDC (אין סוד משותף, אין Okta, אין Twingate). לחזק: שירותים
לעולם לא נוגעים ב-Okta.

</div>`,
  10: `<div dir="rtl">

לעבור על הרצף: K8s ServiceAccount → EKS OIDC → AWS IAM trust → DB. TTL
של 15 דקות, חידוש אוטומטי בצד ה-pod. אין אדם, אין Okta, אין Twingate
במסלול החם. RDS משתמש ב-IRSA + IAM DB auth; Atlas משתמש ב-Workload OIDC
ישירות. זה מחזור החיים של ה-credential ב-steady state עבור שירותים.

</div>`,
  11: `<div dir="rtl">

המקרה היחיד עם שער אישור אנושי. מפתח מבקש דרך הפלטפורמה (פקודת Slack /
טופס web), מאשר (עמית או ראש צוות) מאשר, חברות זמנית ב-Okta group נכתבת
ל-TTL חסום, federation מטמיע את ה-role החדש. תתי-וריאציות תלויות ב-D-1
(טיימר Path A, ספק וכו').

</div>`,
  12: `<div dir="rtl">

ה-on-call מקבל הרשאת admin אוטומטית — בלי כרטיס, בלי מאשר. מנוי PagerDuty
דוחף את חברות ה-Okta group הזמנית. ה-latency תלוי-טריגר: שעתית בתת-וריאציה
של GHA-cron; שניות בתת-וריאציה של PD webhook → Lambda או Slack command.
המשתמש חייב להתחבר מחדש ל-DB כדי לקלוט את group attribute החדש.

</div>`,
  13: `<div dir="rtl">

מעבר view. Information view = ישויות והכללים שמגנים עליהן. השקף הבא הוא
מודל הישויות + invariants.

</div>`,
  14: `<div dir="rtl">

ארבע ישויות ליבה. להדגיש את ארבעת ה-invariants — אין standing RW/admin
לבני אדם (הכל חסום בזמן), אין סיסמאות DB שמורות לשירותים, כל DB role
מגושם נובע מ-Gate או Binding (מקור), Trust Binding write = grant
(עוגן ביקורת). שמירת ביקורת 18 חודשים; Audit Event הוא append-only.

</div>`,
  15: `<div dir="rtl">

ה-mermaid עוקב אחר כל מסלול גישה. שני backbones לאימות, שלוש וריאציות
לבני אדם, מסלול אחד לשירותים. "R&D group → SAML attr" זה standing-RO
(אין JIT). JIT Platform מודגש — שם יושבים ה-TTL והאישור. Break-glass
גם מודגש — עוקף JIT ומפעיל page בכל שימוש.

</div>`,
  16: `<div dir="rtl">

מעבר view. Deployment view = איפה האלמנטים רצים בפועל. הבא: פרספקטיבות
R&W על ה-deployment, ואז המפה הרב-אזורית.

</div>`,
  17: `<div dir="rtl">

שלוש פרספקטיבות בעלי עניין על ה-deployment. SRE / on-call: איפה זה רץ,
מי מקבל page. אבטחה: גבולות אמון בין clusters (בעיקר בידוד prod-us מול
prod-eu). פלטפורמה: בעלות תפעולית על מישור המנהל מול המישורים האזוריים.

</div>`,
  18: `<div dir="rtl">

מפת ה-deployment. cluster platform-tools (eu-central-1) מחזיק את מישור
המנהל — Eligibility Manager, PD-Sync, Audit Aggregator, וגם בקרי Tier
2a (בסיס מנהל חוצה-אזורים). prod-us ו-prod-eu מחזיקים בקרי Tier 2b
משלהם (self-service מוגבל-אזור). Blast radius: בקרי prod-us לא יכולים
להגיע ל-prod-eu — region-bounded בעיצוב. כל hop של אדם ל-DB עובר
דרך Twingate.

</div>`,
  19: `<div dir="rtl">

מעבר view. Development view = איך ה-IaC + הבקרים מאורגנים בקוד. הבא:
פרספקטיבות R&W, ואז ההשוואה המנוקדת בין Pulumi ל-Crossplane.

</div>`,
  20: `<div dir="rtl">

שלוש פרספקטיבות על development. צוותי שירות: איך אני מוסיף DB role לשירות
שלי היום (תשובה: PR אחד ל-chart המעטפת). צוות פלטפורמה: איך אני שומר
על עקביות לרוחב 5 מערכות upstream. אופרטורים: איפה אני מסתכל כש-CRD
נתקע. מכין את הסיבה למה Crossplane מנצח ב-Tier 2.

</div>`,
  21: `<div dir="rtl">

ההשוואה המנוקדת — Pulumi 17/40, Crossplane 39/40. השוויון היחיד הוא
ב-State management (היסטוריה מפורשת של Pulumi מול etcd חי של Crossplane).
שורה קריטית: Infra↔code alignment — Pulumi צריך שני PRs במאגרים נפרדים
ופריסה תלוית-סדר; Crossplane שולח role + binding CRD אטומית עם helm
release של השירות. Pulumi נשאר ל-Tier 1 (VPCs, EKS, חשבונות AWS);
Crossplane בבעלות מ-Tier 2 והלאה.

</div>`,
  22: `<div dir="rtl">

helm chart מעטפת אחד, sub-charts מקובעים (Crossplane 1.18, Atlas Operator
2.5). שש תיקיות templates/, אחת לכל מערכת יעד — crossplane, iam-ic,
mongodb, rds, okta, observe. צוותי שירות תורמים דרך PR;
access-matrix.md הוא צומת הביקורת הקריא לאדם שמחבר את הכל.

</div>`,
  23: `<div dir="rtl">

chart helm אחד, שני backends להתיישבות. Crossplane מטפל ב-AWS / Okta /
PagerDuty / PostgreSQL (4 providers, 4 APIs upstream). MongoDB Atlas
Operator מטפל ב-Atlas (3 CRDs, API upstream אחד). ה-chart מנתב כל תיקיית
templates/{system}/ ל-backend המתאים — PR אחד מוסיף role לרוחב כל 5
מערכות ה-upstream באופן עקבי.

</div>`,
  24: `<div dir="rtl">

G-4 זה פער ייחוס הביקורת — רגע ה-"pasha_boss ב-03:17" שלא ניתן לענות
עליו היום. Audit Event הוא הנושא; invariant של append-only. יעד שמירה
של 18 חודשים (מינימום SOC 2 + lookback לתקריות תוך-שנתיות). יעד כיסוי:
100% מחיבורי ה-DB ניתנים לייחוס זהותי. פעילות reconciler (Crossplane +
Atlas Op) מוזרמת לאותו צינור ביקורת.

</div>`,
  25: `<div dir="rtl">

חלק סיום. החלטות = מה נעול ומה עוד פתוח. השקף הבא הוא תקציר ה-takeaway.

</div>`,
  26: `<div dir="rtl">

שלוש עמודות. נעול — Group→Role (group של Okta → roles מוגבלים ב-IAM
ובאטלס, לא per-user) · Break-Glass (admin + ORG_OWNER → 2–3 אנשים,
תקרה של שעה) · Okta+JIT = SoT (standing דרך Okta, מוגבל-זמן דרך JIT,
לא DB-as-truth). פתוח — D-1 JIT Path (A בנייה מותאמת מעל Okta · B ספק
כמו Britive · C היברידי) — לבחור ב-ADR review הבא. D-2 Vendor — נכנס
לפעולה רק אם D-1 → Path B. IaC *לא* פתוח — ADR-008 נועל את מבנה השכבות
של Pulumi + Crossplane.

</div>`,
  27: `<div dir="rtl">

סיכום. שלוש בקשות מהקהל: פידבק על מודל ארבעת המקרים (הליבה הרעיונית),
העדפה ל-Path A / B / C עבור D-1 (ההחלטה הפתוחה), וכל תרחיש blast-radius
שפספסתי בניתוח אזורי האמון. פרטי קשר על המסך — Slack, LinkedIn, GitHub.

</div>`,
};

function parseSlides(text) {
  const lines = text.split("\n");
  const slides = [];
  let i = 0;
  while (i < lines.length && lines[i].trim() !== "---") i++;
  while (i < lines.length) {
    if (lines[i].trim() !== "---") break;
    const fmStart = i + 1;
    let j = fmStart;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j >= lines.length) break;
    const fm = lines.slice(fmStart, j);
    const bodyStart = j + 1;
    let k = bodyStart;
    while (k < lines.length && lines[k].trim() !== "---") k++;
    const body = lines.slice(bodyStart, k);
    slides.push({ fm, body });
    i = k;
  }
  return slides;
}

function stripTrailingNoteBlock(bodyLines) {
  // Remove any trailing `<!-- ... -->` HTML comment block (and the
  // whitespace around it). Operates on the END of the body only — note
  // blocks that aren't at the tail are left intact.
  let i = bodyLines.length - 1;
  while (i >= 0 && bodyLines[i].trim() === "") i--;
  if (i < 0 || bodyLines[i].trim() !== "-->") return bodyLines;
  const endIdx = i;
  // Walk back to the matching `<!--`
  let openIdx = -1;
  for (let j = endIdx - 1; j >= 0; j--) {
    if (bodyLines[j].trim() === "<!--") {
      openIdx = j;
      break;
    }
    // Bail out if we hit any non-comment content line — we don't want to
    // eat anything that isn't a clean trailing comment block.
    if (bodyLines[j].trim() !== "" && !/^<!--/.test(bodyLines[j]) &&
        !/-->/.test(bodyLines[j])) {
      // It's a comment-internal line, keep walking
    }
  }
  if (openIdx === -1) return bodyLines;
  const kept = bodyLines.slice(0, openIdx);
  // Trim trailing empties on what's kept
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  kept.push("");
  return kept;
}

const src = readFileSync(SLIDES, "utf8");
copyFileSync(SLIDES, BACKUP);
console.log(`• backup → ${BACKUP}`);

const slides = parseSlides(src);
console.log(`• parsed ${slides.length} slides`);

let stripped = 0;
let injected = 0;

for (let n = 0; n < slides.length; n++) {
  const slideNo = n + 1;
  const before = slides[n].body.length;
  slides[n].body = stripTrailingNoteBlock(slides[n].body);
  if (slides[n].body.length < before) stripped++;

  const note = NOTES[slideNo];
  if (!note) continue;
  slides[n].body.push("<!--");
  for (const ln of note.split("\n")) slides[n].body.push(ln);
  slides[n].body.push("-->");
  slides[n].body.push("");
  injected++;
}

const out = [];
for (const s of slides) {
  out.push("---");
  out.push(...s.fm);
  out.push("---");
  out.push(...s.body);
}
writeFileSync(SLIDES, out.join("\n"), "utf8");
console.log(`✔ stripped ${stripped} trailing note block(s); injected ${injected} Hebrew note(s)`);
