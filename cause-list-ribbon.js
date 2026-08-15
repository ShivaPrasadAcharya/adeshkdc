(function () {
  "use strict";
  if (window.CauseListPersistentRibbon) return;
  const CACHE_KEY = "cause-list-auto-files-v1";
  const FALLBACK_FILES = ["index20830212.html", "index20830415.html"];
  const MONTH_NAMES = [
    "वैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
    "कात्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत",
  ];
  function nepali(value) {
    return String(value).replace(/\d/g, (digit) => "०१२३४५६७८९"[Number(digit)]);
  }
  function parsePage(value) {
    let name = String(value || "").split(/[?#]/)[0].split(/[\\/]/).pop() || "";
    try { name = decodeURIComponent(name); } catch (error) {}
    const match = name.match(/^index(\d{8})\.html?$/i);
    if (!match) return null;
    const key = match[1], month = Number(key.slice(4, 6)), day = Number(key.slice(6));
    if (month < 1 || month > 12 || day < 1 || day > 32) return null;
    return {
      key: key,
      month: key.slice(0, 6),
      href: "index" + key + ".html",
      label: nepali(key.slice(0, 4) + "।" + key.slice(4, 6) + "।" + key.slice(6)),
    };
  }
  function cachedFiles() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }
  async function manifestFiles() {
    if (!/^https?:$/.test(location.protocol)) return [];
    try {
      const url = new URL("cause-list-files.js", new URL(".", location.href));
      url.searchParams.set("v", String(Date.now()));
      const response = await fetch(url, { cache: "no-store" });
      const value = await response.json();
      return response.ok && Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }
  function uniquePages(values) {
    const pages = new Map();
    values.forEach((value) => {
      const page = parsePage(value && value.href ? value.href : value);
      if (page) pages.set(page.key, page);
    });
    return Array.from(pages.values()).sort((a, b) => a.key.localeCompare(b.key));
  }
  function monthLabel(key) {
    const number = Number(key.slice(4, 6));
    return nepali(key.slice(0, 4) + "।" + key.slice(4, 6)) +
      (MONTH_NAMES[number - 1] ? " — " + MONTH_NAMES[number - 1] : "");
  }
  function createRibbon() {
    if (document.querySelector(".page-ribbon,#causePersistentRibbon")) return null;
    const nav = document.createElement("nav");
    nav.id = "causePersistentRibbon";
    nav.className = "cpr-ribbon";
    nav.setAttribute("aria-label", "स्थायी पेशी सूची खोज तथा navigation");
    nav.innerHTML =
      '<div class="cpr-inner"><form class="cpr-search" role="search">' +
      '<input type="search" name="search" autocomplete="off" placeholder="नाम, मुद्दा नं., पक्ष वा विषय खोज्नुहोस्…" aria-label="सबै पेशी सूचीमा खोज्नुहोस्">' +
      '<span class="cpr-options"><label class="cpr-check" title="Nepali spelling variants मिलाएर खोज्छ"><input type="checkbox" name="normalizer" checked><span>Normalizer</span></label>' +
      '<label class="cpr-check" title="Attachment content मा smart search"><input type="checkbox" name="smart"><span>Smart</span></label></span>' +
      '<button type="submit">खोज्नुहोस्</button></form>' +
      '<div class="cpr-nav"><label for="cprMonth">महिना</label><select id="cprMonth"><option value="">खोजिँदैछ…</option></select>' +
      '<label for="cprDate">मिति</label><select id="cprDate" disabled><option value="">पहिला महिना रोज्नुहोस्</option></select></div>' +
      '<a class="cpr-link" href="index.html" title="मुख्य पृष्ठ">⌂ Main</a>' +
      '<a class="cpr-link" href="README.html" title="प्रयोग विधि">ⓘ Help</a>' +
      '<span class="cpr-current" aria-label="हालको पृष्ठ"></span></div>';
    document.body.insertBefore(nav, document.body.firstChild);
    return nav;
  }
  function initializeRibbon(nav, pages) {
    if (!nav) return;
    const form = nav.querySelector(".cpr-search"),
      search = form.querySelector('input[type="search"]'),
      normalizer = form.querySelector('[name="normalizer"]'),
      smart = form.querySelector('[name="smart"]'),
      monthSelect = nav.querySelector("#cprMonth"),
      dateSelect = nav.querySelector("#cprDate"),
      current = parsePage(location.pathname),
      params = new URLSearchParams(location.search);
    search.value = params.get("search") || "";
    normalizer.checked = params.get("normalizer") !== "0";
    smart.checked = params.get("smart") === "1";
    nav.querySelector(".cpr-current").textContent = current ? current.label : document.title;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = search.value.trim();
      if (!query) { search.focus(); return; }
      const target = new URL("index.html", new URL(".", location.href));
      target.searchParams.set("search", query);
      target.searchParams.set("normalizer", normalizer.checked ? "1" : "0");
      target.searchParams.set("smart", smart.checked ? "1" : "0");
      location.href = target.href;
    });
    const months = Array.from(new Set(pages.map((page) => page.month))).sort();
    monthSelect.replaceChildren(new Option("महिना रोज्नुहोस्", ""));
    months.forEach((month) => monthSelect.add(new Option(monthLabel(month), month)));
    monthSelect.disabled = !months.length;
    function updateDates() {
      const month = monthSelect.value;
      dateSelect.replaceChildren(new Option(month ? "मिति रोज्नुहोस्" : "पहिला महिना रोज्नुहोस्", ""));
      if (month) {
        const monthPages = pages.filter((page) => page.month === month);
        const fileList = monthPages.map((page) => page.href).join(",");
        dateSelect.add(new Option("ALL — सबै मिति", "month.html?month=" + month + "&files=" + encodeURIComponent(fileList)));
        monthPages.forEach((page) => dateSelect.add(new Option(page.label, page.href)));
      }
      dateSelect.disabled = !month;
    }
    monthSelect.addEventListener("change", updateDates);
    dateSelect.addEventListener("change", () => {
      if (dateSelect.value) location.href = dateSelect.value;
    });
    const requestedMonth = current ? current.month : String(params.get("month") || "");
    if (months.includes(requestedMonth)) {
      monthSelect.value = requestedMonth;
      updateDates();
      if (current) dateSelect.value = current.href;
    }
  }
  async function init() {
    const nav = createRibbon();
    if (!nav) return;
    const pages = uniquePages([...FALLBACK_FILES, ...cachedFiles(), ...await manifestFiles()]);
    initializeRibbon(nav, pages);
  }
  window.CauseListPersistentRibbon = { init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
