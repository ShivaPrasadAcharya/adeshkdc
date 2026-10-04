"use strict";
// Shared parsing rules from the existing Input/Output converter.
const cleanText = value => String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
const toAsciiDigits = value => String(value || "").replace(/[०-९]/g, digit => String("०१२३४५६७८९".indexOf(digit)));
const toNepaliDigits = value => String(value || "").replace(/\d/g, digit => "०१२३४५६७८९"[Number(digit)]);
function splitCourtOrderText(source) {
  const text = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const ending = /^[^\n]*(?:इति|ईति)\s*(?:संवत्?|सम्वत्?|संम्वत्?|सम्बत्?)[^\n]*$/gim;
  const parts = [];
  let cursor = 0;
  let match;
  while ((match = ending.exec(text))) {
    const end = match.index + match[0].length;
    const part = text.slice(cursor, end).trim();
    if (part) parts.push(part);
    cursor = end;
  }
  const remainder = text.slice(cursor).trim();
  if (remainder) {
    if (parts.length) parts[parts.length - 1] += "\n" + remainder;
    else parts.push(remainder);
  }
  return parts;
}

function orderDataCanonicalNumber(value) {
  return toNepaliDigits(String(value || "").replace(/\s*[-–—]\s*/g, "-").trim().toUpperCase());
}

function extractOrderNumbers(text) {
  const header = String(text || "").split(/\r?\n/).slice(0, 45).join("\n");
  const pattern = /(^|[^\w०-९])([०-९0-9]{2,4}\s*[-–—]\s*[A-Za-z०-९0-9]+\s*[-–—]\s*[०-९0-9]+)/gi;
  const values = [];
  let match;
  while ((match = pattern.exec(header))) {
    const value = orderDataCanonicalNumber(match[2]);
    if (!values.includes(value)) values.push(value);
  }
  return {
    petitionNumber: values.find((value) => value.includes("FN")) || "",
    caseNumber: values.find((value) => !value.includes("FN")) || ""
  };
}

function extractOrderDate(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dateLine = [...lines].reverse().find((line) => /(?:इति|ईति)\s*(?:संवत्?|सम्वत्?|संम्वत्?|सम्बत्?)/i.test(line)) || "";
  const numeric = dateLine.match(/([०-९0-9]{4})\s*[।./-]\s*([०-९0-9]{1,2})\s*[।./-]\s*([०-९0-9]{1,2})/);
  if (numeric) {
    return [numeric[1], numeric[2], numeric[3]].map((part, index) => {
      const ascii = toAsciiDigits(part);
      return toNepaliDigits(index ? ascii.padStart(2, "0") : ascii);
    }).join("।");
  }
  const months = {
    "बैशाख":"01", "वैशाख":"01", "जेठ":"02", "जेष्ठ":"02", "असार":"03", "आषाढ":"03",
    "श्रावण":"04", "साउन":"04", "भदौ":"05", "भाद्र":"05", "असोज":"06", "आश्विन":"06",
    "कार्तिक":"07", "कात्तिक":"07", "मंसिर":"08", "मङ्सिर":"08", "पुष":"09", "पौष":"09",
    "माघ":"10", "फागुन":"11", "फाल्गुन":"11", "फाल्गुण":"11", "चैत":"12", "चैत्र":"12"
  };
  const year = toAsciiDigits(dateLine).match(/(\d{4})\s*साल/);
  const monthName = Object.keys(months).find((name) => dateLine.includes(name));
  if (!year || !monthName) return "";
  const afterMonth = toAsciiDigits(dateLine.slice(dateLine.indexOf(monthName) + monthName.length));
  const day = afterMonth.match(/(?:महिना\s*)?(\d{1,2})\s*गते/);
  return day ? `${toNepaliDigits(year[1])}।${toNepaliDigits(months[monthName])}।${toNepaliDigits(day[1].padStart(2, "0"))}` : "";
}

function cleanOrderParty(line, role) {
  return String(line || "")
    .replace(new RegExp(role + "\\s*$"), "")
    .replace(/[.·_\-–—]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[ .·_\-–—]+|[ .·_\-–—]+$/g, "");
}

function extractOrderParties(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 45);
  let petitioner = "";
  let respondent = "";
  for (const line of lines) {
    for (const role of ["निवेदक", "वादी", "पुनरावेदक"]) {
      if (!petitioner && new RegExp(role + "\\s*$").test(line)) petitioner = cleanOrderParty(line, role);
    }
    for (const role of ["विपक्षी", "प्रतिवादी", "प्रत्यर्थी"]) {
      if (!respondent && new RegExp(role + "\\s*$").test(line)) respondent = cleanOrderParty(line, role);
    }
  }
  if (!respondent) {
    const fallback = String(text || "").match(/प्रतिवादी\s+([^।,\n]{2,80}?)(?:लाई|ले|को|उपर|विरुद्ध)/);
    if (fallback) respondent = cleanText(fallback[1]);
  }
  return { petitioner, respondent };
}

function extractOrderSubjects(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 48);
  let petitionSubject = "";
  let caseName = "";
  const numberOnly = /^[०-९0-9]{2,4}\s*[-–—]\s*[A-Za-z०-९0-9]+\s*[-–—]\s*[०-९0-9]+$/i;
  lines.forEach((line) => {
    const petition = line.match(/^(?:निवेदन(?:को)?\s+)?विषय\s*[:ः\-–—]+\s*(.+)$/);
    const caseMatch = line.match(/^(?:मुद्दा|मूदा)\s*[:ः\-–—]+\s*(.+)$/);
    if (petition && !petitionSubject) petitionSubject = cleanText(petition[1]).replace(/[।.]+$/, "");
    if (caseMatch && !caseName) {
      const value = cleanText(caseMatch[1]).replace(/[।.]+$/, "");
      if (value && !numberOnly.test(value)) caseName = value;
    }
  });
  return { petitionSubject, caseName };
}

function extractOrderHeader(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const courtLine = lines.slice(0, 20).find((line) => line.includes("अदालत")) || "काठमाडौं जिल्ला अदालत";
  const court = /जिल्ला अदालत/.test(courtLine) && /काठमाडौं|काठमाण्ड|काठमाडौँ/.test(courtLine)
    ? "काठमाडौं जिल्ला अदालत"
    : cleanText(courtLine);
  const judgeLine = lines.slice(0, 28).find((line) => line.includes("न्यायाधीश")) || "";
  const named = judgeLine.match(/श्री\s+(.+)$/);
  const stripped = cleanText(judgeLine.replace(/^(?:माननीय\s+)?(?:(?:जिल्ला|उच्च|मुख्य)\s+)?न्यायाधीश\s*/, ""));
  const judgeName = named ? "श्री " + cleanText(named[1]) : (stripped ? "श्री " + stripped.replace(/^श्री\s+/, "") : "");
  return { court, judgeName, judge: judgeName ? `${judgeName} (${court})` : `(${court})` };
}

function extractOrderBody(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim());
  let end = lines.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/(?:इति|ईति)\s*(?:संवत्?|सम्वत्?|संम्वत्?|सम्बत्?)/i.test(lines[index])) end = index;
    if (index > lines.length / 2 && /^(?:जिल्ला\s+)?न्यायाधीश$/.test(lines[index])) {
      end = Math.min(end, index);
      break;
    }
  }
  const issuePositions = [];
  lines.slice(0, Math.min(end, 50)).forEach((line, index) => {
    if (/^(?:(?:निवेदन(?:को)?\s+)?विषय|मुद्दा|मूदा)\s*[:ः\-–—]/.test(line)) issuePositions.push(index);
  });
  let start = issuePositions.length ? issuePositions[issuePositions.length - 1] + 1 : 0;
  if (!issuePositions.length) {
    const marker = lines.slice(0, Math.min(end, 50)).findIndex((line) =>
      line.length >= 25 && /^(यसमा|प्रस्तुत|उपरोक्त|निवेदन|वादी|प्रतिवादी|मिसिल|यस अदालत)/.test(line));
    if (marker >= 0) start = marker;
  }
  return lines.slice(start, end).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function inferOrderCategory(text, body) {
  const source = `${body}\n${text}`;
  const rules = [
    ["पाँचप्रतिशतधरौटीसमायोजन", "panchpratishatdharautisamayojan", /(?:पाँच|५)\s*प्रतिशत.*धरौटी.*समायोजन/i],
    ["पाँचप्रतिशतकैदीपुर्जीसंशोधन", "panchpratishatkaidipurjisanshodhan", /(?:पाँच|५)\s*प्रतिशत.*कैदी\s*पुर्जी|कैदी\s*पुर्जी.*संशोधन/i],
    ["पाँचप्रतिशतजरिवाना", "panchpratishatjaribana", /(?:पाँच|५)\s*प्रतिशत.*जरि[बव]ाना/i],
    ["अदालतीशुल्कसुविधा", "adalatishulkasubidha", /अदालती?\s*शुल्क.*सुविधा|अदालती?\s*शुल्क.*पछि\s*बुझाउन/i],
    ["अल्पकालीनआदेशनिरन्तरतानदिने", "alpakalinaadeshnirantaratanadine", /अल्पकालीन.*निरन्तरता.*नदिने|निरन्तरता\s*दिन.*नमिल/i],
    ["अल्पकालीनअन्तरिमआदेश", "alpakalinantarimaadesh", /अल्पकालीन\s+अन्तरिम\s+आदेश/i],
    ["अंशियारबुझ्ने", "anshiyarbujhne", /अंशियार.*(?:बुझ|खुलाउन|म्याद\s*जारी|प्रतिवादी\s*कायम)/i],
    ["अन्तरिमआदेशअस्वीकार", "antarimaadeshaswikar", /अन्तरिम\s+आदेश.*(?:जारी|दिन).*नमिल|अन्तरिम\s+आदेश.*अस्वीकार/i],
    ["अन्तरिमआदेशछलफल", "antarimaadeshchhalphal", /अन्तरिम.*छलफल|छलफल.*पेशी|दुवै\s*पक्ष.*छलफल/i],
    ["विदेशीप्रतिवादीपत्रिकाम्याद", "bideshiprativadipatrikamyad", /विदेशी.*प्रतिवादी.*पत्रिका/i],
    ["बिगोबापतकैद", "bigobapatkaid", /बिगो.*बापत.*कैद/i],
    ["व्यवसायअवरोधरोक", "byabasayaawarodharok", /व्यवसाय.*(?:नरोक|अवरोध)/i],
    ["कलडिटेलविवरण", "calldetailbibaran", /कल\s*डिटेल|call\s*detail/i],
    ["दफा१५५कैदसुविधा", "dapha155kaidsubidha", /दफा\s*(?:१५५|155).*सुविधा|दफा\s*(?:१५५|155).*कैद/i],
    ["दशीफिर्ताअस्वीकार", "dashiphirtaaswikar", /दशी.*फिर्ता.*(?:नदिने|अस्वीकार)/i],
    ["धरौटीफिर्ता", "dharautiphirta", /धरौटी.*फिर्ता/i],
    ["गैरकानूनीपक्राउरोक", "gairkanunipakraurok", /गैरकानूनी.*पक्राउ|पक्राउ.*(?:नगर्न|नरोक)/i],
    ["हालसाविकनिर्णयफाइल", "halsabiknirnayfile", /हाल\s*साविक.*निर्णय/i],
    ["कागजप्रमाणीकरण", "kagajpramanikaran", /कागज.*प्रमाणीकरण|प्रमाणीकरण.*कागज/i],
    ["कैदपूर्वसुनुवाइम्याद", "kaidapurwasunuwaimyad", /कैद.*पूर्व.*सुनुवाइ/i],
    ["कालोसूचीआदेशअस्वीकार", "kalosuchiaadeshaswikar", /कालो\s*सूची.*(?:नराख|अस्वीकार)/i],
    ["कम्पनीविवरण", "kampanibibaran", /कम्पनी.*विवरण/i],
    ["कारणदेखाउ", "karandekhau", /कारण\s*देखाउ/i],
    ["लगाउमुद्दा", "lagaumudda", /लगाउ.*मुद्दा/i],
    ["मेलमिलाप", "melmilap", /मेलमिलाप/i],
    ["मुद्दास्थानान्तरण", "muddasthanantaran", /मुद्दा.*स्थानान्तरण/i],
    ["मुल्तवीजगाउने", "multabijagaune", /मुल्तवी.*जगा/i],
    ["म्यादबदर", "myadbadar", /म्याद.*बदर|बदर.*म्याद/i],
    ["नाबालकभेटघाट", "nabalakbhetghat", /नाबालक.*भेटघाट/i],
    ["नापीविवरण", "napibibaran", /नापी.*विवरण/i],
    ["नापनक्सा", "napnaksa", /नाप\s*नक्सा/i],
    ["निर्माणरोक", "nirmanrok", /निर्माण.*(?:रोक|नगर्न)/i],
    ["पत्रिकाम्याद", "patrikamyad", /पत्रिका.*म्याद/i],
    ["पेशीजानकारी", "peshijanakari", /पेशी.*जानकारी/i],
    ["पेशीस्थगित", "peshisthagit", /पेशी.*स्थगित/i],
    ["पुनरावेदनजानकारी", "punarabedanjanakari", /पुनरावेदन.*जानकारी/i],
    ["पूर्वआदेशकार्यान्वयन", "purwaaadeshkaryanwayan", /पूर्व.*आदेश.*कार्यान्वयन/i],
    ["रोक्काफुकुवा", "rokkaphukuwa", /रोक्का.*फुकुवा/i],
    ["सक्कलचेकपेश", "sakkalchekpesh", /सक्कल.*चेक.*पेश/i],
    ["सक्कलकागजपेश", "sakkalkagajpesh", /सक्कल.*कागज.*पेश/i],
    ["सक्कलमिसिलझिकाउने", "sakkalmisiljhikaune", /सक्कल.*मिसिल.*झिका/i],
    ["साक्षीबकपत्र", "sakshibakpatra", /साक्षी.*बकपत्र|बकपत्र.*साक्षी/i],
    ["सम्बन्धितइजलासपेश", "sambandhitijalasapesh", /सम्बन्धित.*इजलास.*पेश/i],
    ["सम्झौतासाक्षीबयान", "samjhautasakshibayan", /सम्झौता.*साक्षी.*बयान/i],
    ["थमाउनेम्याद", "thamaunemyad", /थमाउने.*म्याद|म्याद.*थमाइ/i],
    ["निषेधाज्ञाआदेश", "nishedhagyadesh", /निषेधाज्ञा.*(?:जारी|आदेश)/i]
  ];
  const found = rules.find((rule) => rule[2].test(source));
  return found ? { nepali: found[0], english: found[1] } : { nepali: "अन्य", english: "anya" };
}

function summarizeOrderBody(body) {
  const sentences = String(body || "").split(/(?<=।)|\n+/).map(cleanText).filter(Boolean);
  const commands = /गर्नू|गर्नु|गरिदिएको|ठहर्छ|परेन|मिलेन|जारी|बदर|फिर्ता|राख्न/;
  const candidates = sentences.filter((sentence) => commands.test(sentence));
  let summary = (candidates.length ? candidates.slice(-2) : sentences.slice(-2)).join(" ");
  if (summary.length > 380) summary = summary.slice(-380).replace(/^\S*\s*/, "").replace(/^[ ,।]+/, "");
  return summary;
}

function safeOrderScriptSlug(value) {
  const ascii = String(value || "").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return ascii || "generated_orders";
}

function simpleOrderHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseCourtOrders(source, sourceLabel) {
  const parts = splitCourtOrderText(source);
  if (!parts.length || !parts.every(part => /(?:इति|ईति)\s*(?:संवत्?|सम्वत्?|संम्वत्?|सम्बत्?)/i.test(part))) {
    throw new Error("हरेक आदेशको अन्त्यमा ‘इति संवत’ वा ‘ईति संवत’ भएको UTF-8 TXT राख्नुहोस्।");
  }
  const originalFile = sourceLabel || "uploaded_orders.txt";
  const originalStem = originalFile.replace(/\.[^.]+$/, "") || "uploaded_orders";
const orders = parts.map((content, index) => {
  const numbers = extractOrderNumbers(content);
  const subjects = extractOrderSubjects(content);
  const parties = extractOrderParties(content);
  const header = extractOrderHeader(content);
  const body = extractOrderBody(content);
  const category = inferOrderCategory(content, body);
  const categoryName = `${category.nepali}_${category.english}`;
  const file = `${categoryName}_${originalStem}_${index + 1}.txt`;
  return {
    id: `generated-${category.english}-${index + 1}-${simpleOrderHash(content)}`,
    category: categoryName,
    categoryNepali: category.nepali,
    categoryEnglish: category.english,
    originalFile,
    sourceIndex: index + 1,
    sourceOrderName: file,
    file,
    path: "",
    petitionNumber: numbers.petitionNumber,
    caseNumber: numbers.caseNumber,
    orderDate: extractOrderDate(content),
    petitionSubject: subjects.petitionSubject,
    caseName: subjects.caseName,
    subject: subjects.petitionSubject || subjects.caseName || category.nepali,
    petitioner: parties.petitioner,
    respondent: parties.respondent,
    judgeName: header.judgeName,
    court: header.court,
    judge: header.judge,
    summary: summarizeOrderBody(body),
    bodyPreview: cleanText(body).slice(0, 700),
    searchAliases: [category.nepali, category.english, originalFile],
    content
  };
});  return orders;
}

module.exports = { parseCourtOrders };
