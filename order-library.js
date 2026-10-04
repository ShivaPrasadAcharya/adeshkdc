(async function () {
  "use strict";

  let data = window.KDC_ORDER_DATA || { orders: [] };
  if (/^https?:$/.test(location.protocol)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(new URL("order-index.json", location.href), { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Order index unavailable");
      const index = await response.json();
      if (!Array.isArray(index.orders) || !index.orders.every(order => order && order.id && order.category && order.file && typeof order.content === "string")) {
        throw new Error("Invalid order index");
      }
      data = index;
      window.KDC_ORDER_DATA = index;
    } catch (error) {
      // The original embedded files remain available offline or during a failed refresh.
    } finally {
      clearTimeout(timeout);
    }
  }
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const ALL_CATEGORIES = "__all_categories__";
  const parentSelect = document.getElementById("orderCategorySelect");
  const parentInput = document.getElementById("orderCategoryInput");
  const parentSuggestions = document.getElementById("orderCategorySuggestions");
  const childSelect = document.getElementById("orderSubcategorySelect");
  const searchForm = document.getElementById("orderSearchForm");
  const searchInput = document.getElementById("orderSearchInput");
  const normalizerToggle = document.getElementById("orderNormalizer");
  const smartToggle = document.getElementById("orderSmartSearch");
  const highlightToggle = document.getElementById("orderHighlight");
  const searchHistoryHost = document.getElementById("orderSearchHistory");
  const searchHistoryList = document.getElementById("orderSearchHistoryList");
  const tablesHost = document.getElementById("orderTables");
  const tableTemplate = document.getElementById("orderTableTemplate");
  const selectedScopeText = document.getElementById("selectedScopeText");
  const tableHeading = document.getElementById("orderTableHeading");
  const resultCount = document.getElementById("orderResultCount");
  const categoryCount = document.getElementById("summaryCategoryCount");
  const fileCount = document.getElementById("summaryFileCount");
  const searchMode = document.getElementById("summarySearchMode");
  const searchStatus = document.getElementById("orderSearchStatus");
  const smartResultPanel = document.getElementById("smartResultPanel");
  const smartResultList = document.getElementById("smartResultList");
  const smartResultCount = document.getElementById("smartResultCount");
  const modal = document.getElementById("orderModal");
  const modalTitle = document.getElementById("orderModalTitle");
  const modalContent = document.getElementById("orderModalContent");
  const modalDownload = document.getElementById("orderModalDownload");
  const modalCopy = document.getElementById("orderModalCopy");
  const modalClose = document.getElementById("orderModalClose");
  const modalDismiss = document.getElementById("orderModalDismiss");
  const hoverPreview = document.getElementById("orderHoverPreview");
  const nepaliSerials = ["क", "ख", "ग", "घ", "ङ", "च", "छ", "ज", "झ", "ञ", "ट", "ठ", "ड", "ढ", "ण"];
  const fullTextCache = new Map(orders.map((order) => [order.id, String(order.content || "")]));
  const params = new URLSearchParams(location.search);
  let activeOrder = null;
  let renderVersion = 0;
  let inputTimer = 0;
  let categoryInputTimer = 0;
  let modalDownloadUrl = "";
  const recentSearches = [];

  const indexStatus = document.getElementById("orderIndexStatus");
  if (indexStatus) {
    indexStatus.textContent = data.generatedAt
      ? "सूची अद्यावधिक: " + new Date(data.generatedAt).toLocaleString("ne-NP", { timeZone: "Asia/Kathmandu", dateStyle: "medium", timeStyle: "short" })
      : "सुरक्षित अभिलेखबाट आदेश लोड भयो।";
  }

  function categoryLabel(category) {
    const order = orders.find(order => order.category === category);
    return order && order.categoryNepali || String(category || "").split("_")[0];
  }

  if (!parentSelect || !childSelect || !searchForm || !tablesHost || !tableTemplate) return;

  function nepaliNumber(value) {
    return String(value).replace(/\d/g, (digit) => "०१२३४५६७८९"[Number(digit)]);
  }

  function fallbackNormalize(value, spaceAgnostic) {
    const maps = [
      { "ी": "ि", "ू": "ु", "ृ": "ि", "ऋ": "रि" },
      { "श": "स", "ष": "स" },
      { "ङ": "न", "ण": "न", "ञ": "न", "ं": "न्" },
      { "व": "ब" },
      { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" },
    ];
    let output = "";
    for (const character of Array.from(String(value || "").normalize("NFC").replace(/[\u200b-\u200d\ufeff]/g, ""))) {
      let mapped = character;
      for (const map of maps) {
        if (Object.prototype.hasOwnProperty.call(map, mapped)) {
          mapped = map[mapped];
          break;
        }
      }
      output += mapped;
    }
    return output.replace(/\s+/g, spaceAgnostic ? "" : " ").trim();
  }

  function normalize(value, useNormalizer, spaceAgnostic) {
    let output = String(value || "").normalize("NFC").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "");
    if (useNormalizer) {
      const engineNormalizer = window.NepaliProofreaderEngine && window.NepaliProofreaderEngine.normalizer;
      output = engineNormalizer && typeof engineNormalizer.normalize === "function"
        ? engineNormalizer.normalize(output, Boolean(spaceAgnostic))
        : fallbackNormalize(output, Boolean(spaceAgnostic));
    }
    output = output.replace(/[^\p{L}\p{M}\p{N}]+/gu, spaceAgnostic ? "" : " ");
    return output.replace(/\s+/g, spaceAgnostic ? "" : " ").trim();
  }

  function categories() {
    return Array.from(new Set(orders.map((order) => order.category).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, "ne"));
  }

  function categoryMatches(category, query) {
    const tokens = normalize(query, true, false).split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const source = normalize(category, true, false);
    const joined = normalize(category, true, true);
    return tokens.every((token) => source.includes(token) || joined.includes(token));
  }

  function ordersForCategory(category) {
    const base = category === ALL_CATEGORIES ? orders.slice() : orders.filter((order) => order.category === category);
    const query = parentInput ? parentInput.value.trim() : "";
    return query ? base.filter((order) => categoryMatches(order.category, query)) : base;
  }

  function orderMetadata(order) {
    return [
      order.file,
      order.originalFile,
      order.category,
      order.petitionNumber,
      order.caseNumber,
      order.orderDate,
      order.petitionSubject,
      order.caseName,
      order.subject,
      order.petitioner,
      order.respondent,
      order.judge,
      order.summary,
      Array.isArray(order.searchAliases) ? order.searchAliases.join(" ") : order.searchAliases,
    ].filter(Boolean).join(" ");
  }

  function orderFullText(order) {
    return fullTextCache.get(order.id) || order.content || "";
  }

  function encodedFilePath(path) {
    return String(path || "").split("/").map((segment) => encodeURIComponent(segment)).join("/");
  }

  function queryTokens(query, useNormalizer) {
    return normalize(query, useNormalizer, false).split(/\s+/).filter(Boolean);
  }

  function matchesQuery(order, query, useNormalizer, smartSearch) {
    if (!query.trim()) return true;
    const source = smartSearch ? orderFullText(order) : orderMetadata(order);
    const normalizedSource = normalize(source, useNormalizer, false);
    const joinedSource = normalize(source, useNormalizer, true);
    const tokens = queryTokens(query, useNormalizer);
    if (!tokens.length) return true;
    return tokens.every((token) => normalizedSource.includes(token) || joinedSource.includes(token));
  }

  async function loadTextFiles(candidateOrders) {
    if (typeof fetch !== "function") return;
    await Promise.all(candidateOrders.map(async (order) => {
      if (order.content || !order.path || order.__textFileLoaded) return;
      order.__textFileLoaded = true;
      try {
        const response = await fetch(new URL(encodedFilePath(order.path), location.href), { cache: "no-store" });
        if (!response.ok) return;
        const text = await response.text();
        if (text.trim()) fullTextCache.set(order.id, text);
      } catch (error) {
        // file:// वा offline अवस्थामा category data JS भित्रको exact TXT content fallback हुन्छ।
      }
    }));
  }

  function mergeRanges(ranges, maxRanges) {
    const sorted = ranges
      .filter((range) => range && range.end > range.start)
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const range of sorted) {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ start: range.start, end: range.end });
      if (merged.length >= maxRanges) break;
    }
    return merged;
  }

  function findSearchRanges(text, query, useNormalizer, maxRanges) {
    const source = String(text || "");
    const needle = String(query || "").trim();
    if (!source || !needle) return [];
    const ranges = [];
    const lowerSource = source.toLocaleLowerCase();
    const lowerNeedle = needle.toLocaleLowerCase();
    let position = lowerSource.indexOf(lowerNeedle);
    while (position >= 0 && ranges.length < maxRanges) {
      ranges.push({ start: position, end: position + needle.length });
      position = lowerSource.indexOf(lowerNeedle, position + Math.max(1, needle.length));
    }
    if (ranges.length) return mergeRanges(ranges, maxRanges);

    const tokens = queryTokens(query, useNormalizer);
    if (!tokens.length) return [];
    const wordPattern = /[\p{L}\p{M}\p{N}]+/gu;
    let match;
    while ((match = wordPattern.exec(source)) && ranges.length < maxRanges) {
      const normalizedWord = normalize(match[0], useNormalizer, false);
      if (tokens.some((token) => normalizedWord.includes(token) || token.includes(normalizedWord))) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
      }
    }
    return mergeRanges(ranges, maxRanges);
  }

  function appendHighlightedText(target, text, query, useNormalizer, enabled) {
    const value = String(text == null ? "" : text);
    if (!enabled || !query.trim()) {
      target.appendChild(document.createTextNode(value));
      return;
    }
    const ranges = findSearchRanges(value, query, useNormalizer, 120);
    if (!ranges.length) {
      target.appendChild(document.createTextNode(value));
      return;
    }
    let cursor = 0;
    ranges.forEach((range) => {
      if (range.start > cursor) target.appendChild(document.createTextNode(value.slice(cursor, range.start)));
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = value.slice(range.start, range.end);
      target.appendChild(mark);
      cursor = range.end;
    });
    if (cursor < value.length) target.appendChild(document.createTextNode(value.slice(cursor)));
  }

  function setSearchText(target, value, query, useNormalizer, highlight) {
    target.replaceChildren();
    appendHighlightedText(target, value || "—", query, useNormalizer, highlight);
  }

  function renderSearchHistory() {
    if (!searchHistoryHost || !searchHistoryList) return;
    searchHistoryList.replaceChildren();
    recentSearches.forEach((query) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "order-search-history-item";
      item.textContent = query;
      item.title = "फेरि खोज्नुहोस्: " + query;
      item.setAttribute("data-search-history", query);
      searchHistoryList.appendChild(item);
    });
    searchHistoryHost.hidden = recentSearches.length === 0;
  }

  function rememberSearch(query) {
    const value = String(query || "").trim();
    if (!value) return;
    const duplicateIndex = recentSearches.findIndex((item) => item === value);
    if (duplicateIndex >= 0) recentSearches.splice(duplicateIndex, 1);
    recentSearches.unshift(value);
    recentSearches.splice(3);
    renderSearchHistory();
  }

  function setUrlState() {
    const url = new URL(window.location.href);
    if (parentSelect.value && parentSelect.value !== ALL_CATEGORIES) url.searchParams.set("category", parentSelect.value);
    else url.searchParams.delete("category");
    if (parentInput && parentInput.value.trim()) url.searchParams.set("category_filter", parentInput.value.trim());
    else url.searchParams.delete("category_filter");
    if (childSelect.value) url.searchParams.set("file", childSelect.value);
    else url.searchParams.delete("file");
    if (searchInput.value.trim()) url.searchParams.set("search", searchInput.value.trim());
    else url.searchParams.delete("search");
    url.searchParams.set("normalizer", normalizerToggle.checked ? "1" : "0");
    url.searchParams.set("smart", smartToggle.checked ? "1" : "0");
    url.searchParams.set("highlight", highlightToggle.checked ? "1" : "0");
    history.replaceState(null, "", url);
  }

  function populateParents(requestedCategory) {
    const availableCategories = categories();
    const query = parentInput ? parentInput.value.trim() : "";
    const matchedCategories = availableCategories.filter((category) => categoryMatches(category, query));
    const current = requestedCategory || parentSelect.value || params.get("category") || "";
    const allLabel = query
      ? "All matched CATEGORY — " + nepaliNumber(matchedCategories.length) + " प्रकार"
      : "All CATEGORY — सबै आदेशका प्रकार";
    parentSelect.replaceChildren(new Option(allLabel, ALL_CATEGORIES));
    matchedCategories.forEach((category) => parentSelect.add(new Option(categoryLabel(category), category)));
    if (parentSuggestions) {
      parentSuggestions.replaceChildren(...availableCategories.map((category) => new Option(category, category)));
    }
    parentSelect.disabled = !orders.length;
    parentSelect.value = matchedCategories.includes(current) ? current : ALL_CATEGORIES;
  }

  function subcategoryLabel(order) {
    const sequence = String(order.file || "").match(/_(\d+)\.txt$/i) || String(order.id || "").match(/-(\d+)$/);
    return categoryLabel(order.category) + " · " + (sequence ? sequence[1] : order.sourceIndex || "1");
  }

  function populateChildren(requestedFile) {
    const categoryOrders = ordersForCategory(parentSelect.value);
    const allLabel = parentSelect.value === ALL_CATEGORIES
      ? "ALL — सबै sub category"
      : "ALL — यस प्रकारका सबै आदेश";
    childSelect.replaceChildren(new Option(allLabel, ""));
    categoryOrders.forEach((order) => {
      const label = subcategoryLabel(order);
      childSelect.add(new Option(label, order.file));
    });
    childSelect.disabled = !categoryOrders.length;
    childSelect.value = categoryOrders.some((order) => order.file === requestedFile) ? requestedFile : "";
  }

  function button(label, className, attributes) {
    const element = document.createElement(attributes && attributes.href ? "a" : "button");
    element.className = className;
    element.textContent = label;
    if (element.tagName === "BUTTON") element.type = "button";
    Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function appendPrimaryAndBracket(cell, primary, bracketLabel, bracketValue, query, useNormalizer, highlight) {
    const main = String(primary || "").trim();
    const secondary = String(bracketValue || "").trim();
    if (main) appendHighlightedText(cell, main, query, useNormalizer, highlight);
    if (secondary) {
      const detail = document.createElement("span");
      detail.className = main ? "bracketed-detail" : "single-detail";
      appendHighlightedText(detail, main ? "(" + bracketLabel + secondary + ")" : secondary, query, useNormalizer, highlight);
      cell.appendChild(detail);
    }
    if (!main && !secondary) cell.textContent = "—";
  }

  function combinedBlock(cell, label) {
    const block = document.createElement("div");
    block.className = "combined-field";
    const heading = document.createElement("span");
    heading.className = "combined-field-label";
    heading.textContent = label;
    const content = document.createElement("div");
    content.className = "combined-field-content";
    block.append(heading, content);
    cell.appendChild(block);
    return content;
  }

  function compactPreview(order) {
    let text = String(order.bodyPreview || "").replace(/\s+/g, " ").trim();
    if (!text) {
      const lines = orderFullText(order).split(/\r?\n/).map((line) => line.trim());
      let end = lines.length;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (/^[इई]ति\s+(?:संवत|संम्वत|सम्वत|सम्बत)/i.test(lines[index])) end = index;
        if (index > lines.length / 2 && /^(?:जिल्ला\s+)?न्यायाधीश$/.test(lines[index])) {
          end = Math.min(end, index);
          break;
        }
      }
      const issuePositions = [];
      lines.slice(0, Math.min(end, 48)).forEach((line, index) => {
        if (/^(?:(?:निवेदन(?:को)?\s+)?विषय|मुद्दा|मूदा)\s*[:ः\-–—]/.test(line)) issuePositions.push(index);
      });
      let start = issuePositions.length ? issuePositions[issuePositions.length - 1] + 1 : 0;
      if (!issuePositions.length) {
        const marker = lines.slice(0, Math.min(end, 48)).findIndex((line) =>
          line.length >= 35 && /^(यसमा|प्रस्तुत|उपरोक्त|निवेदन|वादी|प्रतिवादी|मिसिल|यस अदालत)/.test(line));
        if (marker >= 0) start = marker;
      }
      text = lines.slice(start, end).join(" ").replace(/\s+/g, " ").trim();
    }
    const excerpt = text.length > 700 ? text.slice(0, 700).trim() + "…" : text;
    return "मुख्य आदेशको पाठ:\n\n" + (excerpt || "मुख्य आदेशको पाठ उपलब्ध छैन।");
  }

  function rowFor(order, index, query, useNormalizer, highlight) {
    const row = document.createElement("tr");
    row.setAttribute("data-order-id", order.id);
    const cells = Array.from({ length: 6 }, () => document.createElement("td"));
    cells[0].textContent = nepaliSerials[index] || nepaliNumber(index + 1);

    const numberField = combinedBlock(cells[1], "FN निवेदन नं. / मुद्दा नं.");
    if (order.petitionNumber) appendPrimaryAndBracket(numberField, order.petitionNumber, "मुद्दा नं. ", order.caseNumber, query, useNormalizer, highlight);
    else appendPrimaryAndBracket(numberField, "", "", order.caseNumber, query, useNormalizer, highlight);

    const caseName = order.caseName || (!order.petitionSubject ? order.subject : "");
    const petitionSubject = order.petitionSubject || (caseName ? "" : order.subject);
    const subjectField = combinedBlock(cells[1], "विषय / मुद्दाको नाम");
    if (petitionSubject && caseName && petitionSubject !== caseName) {
      appendPrimaryAndBracket(subjectField, petitionSubject, "मुद्दा: ", caseName, query, useNormalizer, highlight);
    } else {
      appendPrimaryAndBracket(subjectField, "", "", petitionSubject || caseName || order.subject, query, useNormalizer, highlight);
    }

    const dateField = combinedBlock(cells[2], "आदेश मिति");
    setSearchText(dateField, order.orderDate || "—", query, useNormalizer, highlight);
    const judgeDisplay = order.judgeName
      ? order.judgeName + (order.court ? " (" + order.court + ")" : "")
      : order.judge;
    const judgeField = combinedBlock(cells[2], "इजलास/न्यायाधीश");
    setSearchText(judgeField, judgeDisplay || "—", query, useNormalizer, highlight);

    const petitioner = document.createElement("div");
    petitioner.className = "party-name petitioner-name";
    appendHighlightedText(petitioner, order.petitioner || "—", query, useNormalizer, highlight);
    const versus = document.createElement("strong");
    versus.className = "party-versus";
    versus.textContent = "विरुद्ध";
    const respondent = document.createElement("div");
    respondent.className = "party-name respondent-name";
    appendHighlightedText(respondent, order.respondent || "—", query, useNormalizer, highlight);
    cells[3].append(petitioner, versus, respondent);

    setSearchText(cells[4], order.summary || "—", query, useNormalizer, highlight);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const view = button("आदेश हेर्नुहोस्", "view-order", {
      "data-order-id": order.id,
      "aria-describedby": "orderHoverPreview",
    });
    const download = button("डाउनलोड गर्नुहोस्", "download-order", {
      "data-download-order-id": order.id,
    });
    const fileNote = document.createElement("span");
    fileNote.className = "file-name-note";
    fileNote.title = order.file;
    appendHighlightedText(fileNote, order.file, query, useNormalizer, highlight);
    actions.append(view, download, fileNote);
    cells[5].appendChild(actions);
    cells.forEach((cell) => row.appendChild(cell));
    return row;
  }

  function emptyRow(message) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = message;
    row.appendChild(cell);
    return row;
  }

  function categorySection(category, categoryOrders, query, useNormalizer, highlight) {
    const fragment = tableTemplate.content.cloneNode(true);
    const section = fragment.querySelector(".order-category-block");
    const title = fragment.querySelector(".order-category-title");
    const body = fragment.querySelector(".order-rows");
    appendHighlightedText(title, categoryLabel(category), query, useNormalizer, highlight);
    section.setAttribute("data-category", category);
    if (categoryOrders.length) {
      categoryOrders.forEach((order, index) => body.appendChild(rowFor(order, index, query, useNormalizer, highlight)));
    } else {
      body.appendChild(emptyRow("यस समूहमा खोजसँग मिल्ने आदेश भेटिएन।"));
    }
    return fragment;
  }

  function groupedOrders(visibleOrders, requestedCategory) {
    const groups = new Map();
    if (requestedCategory !== ALL_CATEGORIES) groups.set(requestedCategory, []);
    visibleOrders.forEach((order) => {
      if (!groups.has(order.category)) groups.set(order.category, []);
      groups.get(order.category).push(order);
    });
    return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0], "ne"));
  }

  function snippetFor(content, range) {
    const before = 95;
    const after = 145;
    const start = Math.max(0, range.start - before);
    const end = Math.min(content.length, range.end + after);
    return {
      text: (start > 0 ? "…" : "") + content.slice(start, end).replace(/\s+/g, " ").trim() + (end < content.length ? "…" : ""),
      start: start,
    };
  }

  function renderSmartResults(visibleOrders, query, useNormalizer, highlight, smartSearch) {
    smartResultList.replaceChildren();
    if (!smartSearch || !query) {
      smartResultPanel.hidden = true;
      smartResultCount.textContent = "";
      return;
    }

    let contextCount = 0;
    visibleOrders.forEach((order) => {
      const content = orderFullText(order);
      let ranges = findSearchRanges(content, query, useNormalizer, 3);
      if (!ranges.length && content) ranges = [{ start: 0, end: Math.min(content.length, 1) }];
      ranges.forEach((range) => {
        const context = snippetFor(content, range);
        const link = document.createElement("button");
        link.type = "button";
        link.className = "smart-result-link";
        link.setAttribute("data-order-id", order.id);
        link.setAttribute("data-search-result", "true");
        const meta = document.createElement("span");
        meta.className = "smart-result-meta";
        meta.textContent = order.file;
        const snippet = document.createElement("span");
        snippet.className = "smart-result-context";
        appendHighlightedText(snippet, context.text, query, useNormalizer, highlight);
        link.append(meta, snippet);
        smartResultList.appendChild(link);
        contextCount += 1;
      });
    });
    smartResultCount.textContent = nepaliNumber(contextCount) + " प्रसङ्ग · " + nepaliNumber(visibleOrders.length) + " आदेश";
    smartResultPanel.hidden = false;
  }

  function allCategoryEmptyState() {
    const empty = document.createElement("div");
    empty.className = "all-category-empty";
    empty.textContent = "छानिएको खोजसँग मिल्ने आदेश भेटिएन।";
    return empty;
  }

  async function render() {
    const currentVersion = ++renderVersion;
    const category = parentSelect.value || ALL_CATEGORIES;
    const requestedFile = childSelect.value;
    const query = searchInput.value.trim();
    const useNormalizer = normalizerToggle.checked;
    const smartSearch = smartToggle.checked;
    const highlight = highlightToggle.checked;
    const candidates = ordersForCategory(category).filter((order) => !requestedFile || order.file === requestedFile);
    if (smartSearch && query) await loadTextFiles(candidates);
    if (currentVersion !== renderVersion) return;

    const visible = candidates.filter((order) => matchesQuery(order, query, useNormalizer, smartSearch));
    const groups = groupedOrders(visible, category);
    tablesHost.replaceChildren();
    if (!groups.length && category === ALL_CATEGORIES) {
      tablesHost.appendChild(allCategoryEmptyState());
    } else {
      groups.forEach(([group, groupOrders]) => {
        tablesHost.appendChild(categorySection(group, groupOrders, query, useNormalizer, highlight));
      });
    }
    renderSmartResults(visible, query, useNormalizer, highlight, smartSearch);

    const visibleCategoryCount = new Set(visible.map((order) => order.category)).size;
    const categoryFilter = parentInput ? parentInput.value.trim() : "";
    const scopeLabel = category === ALL_CATEGORIES
      ? (categoryFilter ? "Matched CATEGORY — “" + categoryFilter + "”" : "All CATEGORY — सबै आदेशका प्रकार")
      : categoryLabel(category);
    const childLabel = requestedFile ? requestedFile.replace(/\.txt$/i, "") : "";
    selectedScopeText.textContent = childLabel ? scopeLabel + " / " + childLabel : scopeLabel;
    tableHeading.textContent = scopeLabel;
    resultCount.textContent = nepaliNumber(visible.length);
    categoryCount.textContent = nepaliNumber(visibleCategoryCount);
    fileCount.textContent = nepaliNumber(candidates.length);
    searchMode.textContent = (useNormalizer ? "Normalizer" : "Exact") + (smartSearch ? " + Smart TXT" : "") + (highlight ? " + Highlight" : "");
    searchStatus.textContent = query
      ? "“" + query + "” का लागि " + nepaliNumber(visible.length) + " नतिजा" + (smartSearch ? " — TXT content भित्र मात्र खोजियो।" : " — metadata मा खोजियो।")
      : "";
    setUrlState();
  }

  function renderModalContent(order) {
    const query = searchInput.value.trim();
    modalContent.replaceChildren();
    appendHighlightedText(modalContent, orderFullText(order), query, normalizerToggle.checked, highlightToggle.checked);
    if (highlightToggle.checked && query) {
      requestAnimationFrame(() => {
        const firstMatch = modalContent.querySelector("mark.search-highlight");
        if (firstMatch) firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }

  function openOrder(id) {
    activeOrder = orders.find((order) => order.id === id) || null;
    if (!activeOrder) return;
    modalTitle.textContent = activeOrder.file.replace(/\.txt$/i, "");
    renderModalContent(activeOrder);
    if (modalDownloadUrl) URL.revokeObjectURL(modalDownloadUrl);
    modalDownloadUrl = URL.createObjectURL(new Blob([orderFullText(activeOrder)], { type: "text/plain;charset=utf-8" }));
    modalDownload.href = modalDownloadUrl;
    modalDownload.download = activeOrder.file;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modalClose.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    activeOrder = null;
    if (modalDownloadUrl) {
      URL.revokeObjectURL(modalDownloadUrl);
      modalDownloadUrl = "";
    }
  }

  function downloadEmbeddedOrder(id) {
    const order = orders.find((item) => item.id === id);
    if (!order) return;
    const url = URL.createObjectURL(new Blob([orderFullText(order)], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = order.file || "order.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function copyOrder() {
    if (!activeOrder) return;
    try {
      await navigator.clipboard.writeText(orderFullText(activeOrder));
      modalCopy.textContent = "Copy भयो ✓";
      setTimeout(() => { modalCopy.textContent = "आदेश Copy गर्नुहोस्"; }, 1400);
    } catch (error) {
      modalCopy.textContent = "Copy हुन सकेन";
    }
  }

  function hideHoverPreview() {
    if (hoverPreview) hoverPreview.hidden = true;
  }

  function showHoverPreview(trigger) {
    if (!hoverPreview || !trigger) return;
    const order = orders.find((item) => item.id === trigger.getAttribute("data-order-id"));
    if (!order) return;
    hoverPreview.textContent = compactPreview(order);
    hoverPreview.hidden = false;
    if (typeof trigger.getBoundingClientRect !== "function") return;
    requestAnimationFrame(() => {
      const rect = trigger.getBoundingClientRect();
      const margin = 10;
      const width = hoverPreview.offsetWidth || 360;
      const height = hoverPreview.offsetHeight || 180;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
      const top = rect.top - height - 8 >= margin ? rect.top - height - 8 : Math.min(viewportHeight - height - margin, rect.bottom + 8);
      hoverPreview.style.left = left + "px";
      hoverPreview.style.top = Math.max(margin, top) + "px";
    });
  }

  function scheduleRender() {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(render, 90);
  }

  searchInput.value = params.get("search") || "";
  normalizerToggle.checked = params.get("normalizer") !== "0";
  smartToggle.checked = params.get("smart") === "1";
  highlightToggle.checked = params.get("highlight") !== "0";
  if (parentInput) parentInput.value = params.get("category_filter") || "";
  populateParents(params.get("category") || "");
  populateChildren(params.get("file") || "");
  render();

  parentSelect.addEventListener("change", () => {
    if (parentInput) parentInput.value = parentSelect.value === ALL_CATEGORIES ? "" : categoryLabel(parentSelect.value);
    populateParents(parentSelect.value);
    populateChildren("");
    render();
  });
  if (parentInput) {
    parentInput.addEventListener("input", () => {
      clearTimeout(categoryInputTimer);
      categoryInputTimer = setTimeout(() => {
        populateParents("");
        populateChildren("");
        render();
      }, 90);
    });
  }
  childSelect.addEventListener("change", render);
  normalizerToggle.addEventListener("change", render);
  smartToggle.addEventListener("change", render);
  highlightToggle.addEventListener("change", render);
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    rememberSearch(searchInput.value);
    render();
  });
  if (searchHistoryList) {
    searchHistoryList.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-search-history]");
      if (!trigger) return;
      searchInput.value = trigger.getAttribute("data-search-history") || "";
      rememberSearch(searchInput.value);
      render();
      searchInput.focus();
    });
  }
  searchInput.addEventListener("input", scheduleRender);
  tablesHost.addEventListener("click", (event) => {
    const trigger = event.target.closest(".view-order[data-order-id]");
    if (trigger) {
      openOrder(trigger.getAttribute("data-order-id"));
      return;
    }
    const embeddedDownload = event.target.closest(".download-order[data-download-order-id]");
    if (embeddedDownload) downloadEmbeddedOrder(embeddedDownload.getAttribute("data-download-order-id"));
  });
  tablesHost.addEventListener("mouseover", (event) => {
    const trigger = event.target.closest(".view-order[data-order-id]");
    if (trigger) showHoverPreview(trigger);
  });
  tablesHost.addEventListener("mouseout", (event) => {
    if (event.target.closest(".view-order[data-order-id]")) hideHoverPreview();
  });
  tablesHost.addEventListener("focusin", (event) => {
    const trigger = event.target.closest(".view-order[data-order-id]");
    if (trigger) showHoverPreview(trigger);
  });
  tablesHost.addEventListener("focusout", hideHoverPreview);
  smartResultList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-search-result][data-order-id]");
    if (trigger) openOrder(trigger.getAttribute("data-order-id"));
  });
  modalClose.addEventListener("click", closeModal);
  modalDismiss.addEventListener("click", closeModal);
  modalCopy.addEventListener("click", copyOrder);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener("scroll", hideHoverPreview, true);
  window.addEventListener("resize", hideHoverPreview);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });
})();
