(function (root) {
  "use strict";

  // Comparison/proofreading rules adapted for the cause-list workflow from:
  // https://github.com/shivaprasadacharya/nepalitextproofreader
  const THRESHOLD = 9;
  const WORD = /^[\p{L}\p{M}\p{N}]+$/u;
  const DIGIT = /[0-9०-९]/;
  let sequence = 0;

  const LABELS = {
    WORD_ADDITION: "शब्द(हरू) थपिएको",
    WORD_DELETION: "शब्द(हरू) हटाइएको",
    WORD_SUBSTITUTION: "मिल्दोजुल्दो शब्द प्रतिस्थापन",
    WORDS_MODIFIED: "शब्द(हरू) परिमार्जन",
    MINOR_SPELLING: "हिज्जे परिवर्तन",
    VOWEL_LENGTH: "ह्रस्व–दीर्घ परिवर्तन",
    NORMALIZER_CHANGE: "नेपाली normalizer परिवर्तन",
    WORD_FUSION: "शब्द जोडिएको",
    WORD_DISSOCIATION: "शब्द छुट्टिएको",
    PUNCTUATION_ADD: "विरामचिह्न थपिएको",
    PUNCTUATION_DELETE: "विरामचिह्न हटाइएको",
    PUNCTUATION_REPLACE: "विरामचिह्न परिवर्तन",
    SENTENCE_ADDITION: "वाक्य/हरफ थपिएको",
    SENTENCE_DELETION: "वाक्य/हरफ हटाइएको",
    SENTENCE_MODIFICATION: "वाक्य/हरफ परिमार्जन",
    SENTENCE_MERGE: "वाक्य जोडिएको",
    SENTENCE_SPLIT: "वाक्य छुट्टिएको",
    PARAGRAPH_MERGE: "अनुच्छेद जोडिएको",
    PARAGRAPH_SPLIT: "अनुच्छेद छुट्टिएको",
  };

  function norm(value) {
    return String(value == null ? "" : value).normalize("NFC");
  }
  function compact(value) {
    return norm(value).replace(/\s+/g, " ").trim();
  }
  function lexical(value) {
    return norm(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
      .trim();
  }
  function joined(value) {
    return lexical(value).replace(/\s+/g, "");
  }
  function isWord(value) {
    return WORD.test(value);
  }
  function isPunctuation(value) {
    return Boolean(value) && !isWord(value) && !/\s/u.test(value);
  }

  const normalizer = {
    vowelMap: { "ी": "ि", "ू": "ु", "ृ": "ि", ऋ: "रि" },
    sibilantMap: { श: "स", ष: "स" },
    nasalMap: { ङ: "न", ण: "न", ञ: "न", "ं": "न्" },
    vaBaMap: { व: "ब" },
    numberMap: {
      "०": "0",
      "१": "1",
      "२": "2",
      "३": "3",
      "४": "4",
      "५": "5",
      "६": "6",
      "७": "7",
      "८": "8",
      "९": "9",
    },
    normalize(value, spaceAgnostic) {
      const maps = [
        this.vowelMap,
        this.sibilantMap,
        this.nasalMap,
        this.vaBaMap,
        this.numberMap,
      ];
      let output = "";
      for (const character of Array.from(
        norm(value).replace(/[\u200B-\u200D\uFEFF]/g, ""),
      )) {
        let mapped = character;
        for (const map of maps)
          if (Object.prototype.hasOwnProperty.call(map, mapped)) {
            mapped = map[mapped];
            break;
          }
        output += mapped;
      }
      return output
        .replace(/\s+/g, spaceAgnostic ? "" : " ")
        .trim();
    },
  };

  function smartLexical(value) {
    return normalizer
      .normalize(value, false)
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
      .trim();
  }
  function smartJoined(value) {
    return smartLexical(value).replace(/\s+/g, "");
  }
  function normalizerEquivalent(original, latest) {
    return (
      normalizer.normalize(original, true) ===
      normalizer.normalize(latest, true)
    );
  }
  function normalizerFlags(originalText, latestText) {
    const flags = [];
    const original = Array.from(
      norm(originalText)
        .replace(/\s+/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, ""),
    );
    const latest = Array.from(
      norm(latestText)
        .replace(/\s+/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, ""),
    );
    function pairExplained(map) {
      for (let index = 0; index < Math.max(original.length, latest.length); index += 1) {
        const before = original[index] || "";
        const after = latest[index] || "";
        if (
          before !== after &&
          (map[before] || before) === (map[after] || after)
        )
          return true;
      }
      return false;
    }
    if (
      pairExplained(normalizer.vowelMap) ||
      (originalText.includes("ऋ") && latestText.includes("रि")) ||
      (latestText.includes("ऋ") && originalText.includes("रि"))
    )
      flags.push("रि/री/ऋ वा ह्रस्व–दीर्घ");
    if (pairExplained(normalizer.sibilantMap)) flags.push("श/ष/स");
    if (pairExplained(normalizer.nasalMap)) flags.push("नासिक्य वर्ण");
    if (pairExplained(normalizer.vaBaMap)) flags.push("व/ब");
    if (pairExplained(normalizer.numberMap)) flags.push("अङ्क रूप");
    if (/[\u200B-\u200D\uFEFF]/.test(originalText + latestText))
      flags.push("अदृश्य Unicode");
    return flags;
  }

  function dice(original, latest) {
    const left = smartJoined(original);
    const right = smartJoined(latest);
    if (left === right) return 1;
    if (!left || !right) return 0;
    if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
    const pairs = new Map();
    let match = 0;
    for (let index = 0; index < left.length - 1; index += 1) {
      const pair = left.slice(index, index + 2);
      pairs.set(pair, (pairs.get(pair) || 0) + 1);
    }
    for (let index = 0; index < right.length - 1; index += 1) {
      const pair = right.slice(index, index + 2);
      const count = pairs.get(pair) || 0;
      if (count) {
        match += 1;
        pairs.set(pair, count - 1);
      }
    }
    return (2 * match) / (left.length - 1 + (right.length - 1));
  }
  function jaccard(original, latest) {
    const left = new Set(smartLexical(original).split(/\s+/).filter(Boolean));
    const right = new Set(smartLexical(latest).split(/\s+/).filter(Boolean));
    if (!left.size && !right.size) return 1;
    let matches = 0;
    left.forEach((word) => {
      if (right.has(word)) matches += 1;
    });
    return matches / Math.max(1, new Set([...left, ...right]).size);
  }
  function similarity(original, latest) {
    if (compact(original) === compact(latest)) return 1;
    if (
      normalizer.normalize(original, false) ===
      normalizer.normalize(latest, false)
    )
      return 0.985;
    if (smartJoined(original) && smartJoined(original) === smartJoined(latest))
      return 0.965;
    const left = smartJoined(original);
    const right = smartJoined(latest);
    const lengthRatio =
      Math.min(left.length, right.length) /
      Math.max(1, Math.max(left.length, right.length));
    return Math.min(
      1,
      0.64 * dice(original, latest) +
        0.26 * jaccard(original, latest) +
        0.1 * lengthRatio,
    );
  }

  function splitSentences(text) {
    const output = [];
    const source = norm(text);
    const closing = /[”’"'\)\]】]/;
    let start = 0;
    let index = 0;
    while (index < source.length) {
      const character = source[index];
      const before = source[index - 1] || "";
      const after = source[index + 1] || "";
      const date = character === "।" && DIGIT.test(before) && DIGIT.test(after);
      const terminal =
        (character === "।" && !date) ||
        character === "?" ||
        character === "!" ||
        character === "॥";
      if (!terminal) {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (
        end < source.length &&
        (/[।॥?!]/.test(source[end]) || closing.test(source[end]))
      )
        end += 1;
      while (end < source.length && /[ \t]/.test(source[end])) end += 1;
      const sentence = source.slice(start, end);
      if (sentence.trim()) output.push(sentence);
      start = end;
      index = end;
    }
    const tail = source.slice(start);
    if (tail.trim()) output.push(tail);
    return output;
  }

  function lineUnits(value) {
    const source = norm(value).replace(/\r\n?/g, "\n");
    const units = source.match(/[^\n]*(?:\n|$)/g) || [];
    return units.filter(Boolean);
  }
  function comparisonUnits(value, forcedMode) {
    const source = norm(value).replace(/\r\n?/g, "\n");
    const mode = forcedMode || (source.includes("\n") ? "line" : "sentence");
    const list = mode === "line" ? lineUnits(source) : splitSentences(source);
    const usable = list.length ? list : source ? [source] : [];
    return usable.map((text, index) => ({ index, text }));
  }

  function greedyAlign(original, latest) {
    const output = [];
    let originalIndex = 0;
    let latestIndex = 0;
    while (originalIndex < original.length || latestIndex < latest.length) {
      if (originalIndex >= original.length) {
        output.push({ type: "add", old: [], latest: [latest[latestIndex++]] });
        continue;
      }
      if (latestIndex >= latest.length) {
        output.push({ type: "delete", old: [original[originalIndex++]], latest: [] });
        continue;
      }
      const one = similarity(
        original[originalIndex].text,
        latest[latestIndex].text,
      );
      const merge =
        originalIndex + 1 < original.length
          ? similarity(
              original[originalIndex].text + " " + original[originalIndex + 1].text,
              latest[latestIndex].text,
            )
          : 0;
      const split =
        latestIndex + 1 < latest.length
          ? similarity(
              original[originalIndex].text,
              latest[latestIndex].text + " " + latest[latestIndex + 1].text,
            )
          : 0;
      if (merge > 0.64 && merge > one + 0.08) {
        output.push({
          type: "merge",
          old: [original[originalIndex], original[originalIndex + 1]],
          latest: [latest[latestIndex]],
          mappingConfidence: merge,
        });
        originalIndex += 2;
        latestIndex += 1;
      } else if (split > 0.64 && split > one + 0.08) {
        output.push({
          type: "split",
          old: [original[originalIndex]],
          latest: [latest[latestIndex], latest[latestIndex + 1]],
          mappingConfidence: split,
        });
        originalIndex += 1;
        latestIndex += 2;
      } else if (one > 0.2) {
        output.push({
          type: "match",
          old: [original[originalIndex++]],
          latest: [latest[latestIndex++]],
          mappingConfidence: one,
        });
      } else {
        const nextOriginal =
          originalIndex + 1 < original.length
            ? similarity(original[originalIndex + 1].text, latest[latestIndex].text)
            : 0;
        const nextLatest =
          latestIndex + 1 < latest.length
            ? similarity(original[originalIndex].text, latest[latestIndex + 1].text)
            : 0;
        if (nextOriginal > nextLatest && nextOriginal > 0.42)
          output.push({ type: "delete", old: [original[originalIndex++]], latest: [] });
        else if (nextLatest > 0.42)
          output.push({ type: "add", old: [], latest: [latest[latestIndex++]] });
        else {
          output.push({ type: "delete", old: [original[originalIndex++]], latest: [] });
          output.push({ type: "add", old: [], latest: [latest[latestIndex++] ] });
        }
      }
    }
    return output;
  }

  function alignUnits(original, latest) {
    const rows = original.length;
    const columns = latest.length;
    if (rows * columns > 220000) return greedyAlign(original, latest);
    const costs = Array.from(
      { length: rows + 1 },
      () => new Float32Array(columns + 1),
    );
    const traces = Array.from(
      { length: rows + 1 },
      () => new Uint8Array(columns + 1),
    );
    for (let row = 1; row <= rows; row += 1) {
      costs[row][0] = row;
      traces[row][0] = 2;
    }
    for (let column = 1; column <= columns; column += 1) {
      costs[0][column] = column;
      traces[0][column] = 3;
    }
    for (let row = 1; row <= rows; row += 1)
      for (let column = 1; column <= columns; column += 1) {
        const match = similarity(
          original[row - 1].text,
          latest[column - 1].text,
        );
        const penalty = match < 0.18 ? 1.25 : match < 0.28 ? 0.24 : 0;
        let best = costs[row - 1][column - 1] + 1 - match + penalty;
        let trace = 1;
        const deletion = costs[row - 1][column] + 1;
        if (deletion < best) {
          best = deletion;
          trace = 2;
        }
        const insertion = costs[row][column - 1] + 1;
        if (insertion < best) {
          best = insertion;
          trace = 3;
        }
        if (row >= 2) {
          const confidence = similarity(
            original[row - 2].text + " " + original[row - 1].text,
            latest[column - 1].text,
          );
          const merge = costs[row - 2][column - 1] + 1 - confidence + 0.18;
          if (merge < best) {
            best = merge;
            trace = 4;
          }
        }
        if (column >= 2) {
          const confidence = similarity(
            original[row - 1].text,
            latest[column - 2].text + " " + latest[column - 1].text,
          );
          const split = costs[row - 1][column - 2] + 1 - confidence + 0.18;
          if (split < best) {
            best = split;
            trace = 5;
          }
        }
        costs[row][column] = best;
        traces[row][column] = trace;
      }
    const output = [];
    let row = rows;
    let column = columns;
    while (row || column) {
      const trace = traces[row][column];
      if (trace === 1) {
        output.push({
          type: "match",
          old: [original[row - 1]],
          latest: [latest[column - 1]],
          mappingConfidence: similarity(
            original[row - 1].text,
            latest[column - 1].text,
          ),
        });
        row -= 1;
        column -= 1;
      } else if (trace === 2) {
        output.push({ type: "delete", old: [original[row - 1]], latest: [] });
        row -= 1;
      } else if (trace === 3) {
        output.push({ type: "add", old: [], latest: [latest[column - 1]] });
        column -= 1;
      } else if (trace === 4) {
        const confidence = similarity(
          original[row - 2].text + " " + original[row - 1].text,
          latest[column - 1].text,
        );
        output.push({
          type: "merge",
          old: [original[row - 2], original[row - 1]],
          latest: [latest[column - 1]],
          mappingConfidence: confidence,
        });
        row -= 2;
        column -= 1;
      } else if (trace === 5) {
        const confidence = similarity(
          original[row - 1].text,
          latest[column - 2].text + " " + latest[column - 1].text,
        );
        output.push({
          type: "split",
          old: [original[row - 1]],
          latest: [latest[column - 2], latest[column - 1]],
          mappingConfidence: confidence,
        });
        row -= 1;
        column -= 2;
      } else if (row) {
        output.push({ type: "delete", old: [original[--row]], latest: [] });
      } else {
        output.push({ type: "add", old: [], latest: [latest[--column]] });
      }
    }
    return output.reverse();
  }

  function tokenize(text) {
    const output = [];
    const expression = /[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}\s]/gu;
    let match;
    let last = 0;
    while ((match = expression.exec(text))) {
      output.push({ text: match[0], pre: text.slice(last, match.index) });
      last = expression.lastIndex;
    }
    output.tail = text.slice(last);
    return output;
  }
  function greedyTokenDiff(original, latest) {
    const operations = [];
    let originalIndex = 0;
    let latestIndex = 0;
    while (originalIndex < original.length || latestIndex < latest.length) {
      if (originalIndex >= original.length) {
        operations.push({ kind: "insert", latest: latest[latestIndex++] });
        continue;
      }
      if (latestIndex >= latest.length) {
        operations.push({ kind: "delete", original: original[originalIndex++] });
        continue;
      }
      if (norm(original[originalIndex].text) === norm(latest[latestIndex].text)) {
        operations.push({
          kind: "equal",
          original: original[originalIndex++],
          latest: latest[latestIndex++],
        });
        continue;
      }
      operations.push({ kind: "delete", original: original[originalIndex++] });
      operations.push({ kind: "insert", latest: latest[latestIndex++] });
    }
    return operations;
  }
  function tokenDiff(originalText, latestText) {
    const original = tokenize(originalText);
    const latest = tokenize(latestText);
    const rows = original.length;
    const columns = latest.length;
    if (rows * columns > 160000)
      return {
        operations: greedyTokenDiff(original, latest),
        latestTokens: latest,
      };
    const matrix = Array.from(
      { length: rows + 1 },
      () => new Uint16Array(columns + 1),
    );
    for (let row = rows - 1; row >= 0; row -= 1)
      for (let column = columns - 1; column >= 0; column -= 1)
        matrix[row][column] =
          norm(original[row].text) === norm(latest[column].text)
            ? matrix[row + 1][column + 1] + 1
            : Math.max(matrix[row + 1][column], matrix[row][column + 1]);
    const operations = [];
    let row = 0;
    let column = 0;
    while (row < rows && column < columns) {
      if (norm(original[row].text) === norm(latest[column].text)) {
        operations.push({
          kind: "equal",
          original: original[row++],
          latest: latest[column++],
        });
      } else if (matrix[row + 1][column] >= matrix[row][column + 1]) {
        operations.push({ kind: "delete", original: original[row++] });
      } else {
        operations.push({ kind: "insert", latest: latest[column++] });
      }
    }
    while (row < rows)
      operations.push({ kind: "delete", original: original[row++] });
    while (column < columns)
      operations.push({ kind: "insert", latest: latest[column++] });
    return { operations, latestTokens: latest };
  }

  function levenshtein(original, latest) {
    const left = Array.from(norm(original));
    const right = Array.from(norm(latest));
    let previous = new Uint16Array(right.length + 1);
    let current = new Uint16Array(right.length + 1);
    for (let column = 0; column <= right.length; column += 1)
      previous[column] = column;
    for (let row = 1; row <= left.length; row += 1) {
      current[0] = row;
      for (let column = 1; column <= right.length; column += 1)
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] +
            (left[row - 1] === right[column - 1] ? 0 : 1),
        );
      const swap = previous;
      previous = current;
      current = swap;
    }
    return previous[right.length];
  }
  function vowelForm(value) {
    return norm(value)
      .replace(/[इई]/g, "इ")
      .replace(/[उऊ]/g, "उ")
      .replace(/[िी]/g, "ि")
      .replace(/[ुू]/g, "ु")
      .replace(/ँ/g, "ं");
  }
  function textOf(tokens) {
    const punctuation =
      tokens.length && tokens.every((token) => isPunctuation(token.text));
    return tokens
      .map((token) => token.text)
      .join(punctuation ? "" : " ")
      .trim();
  }
  const SYNONYMS = [
    ["तर", "किन्तु", "परन्तु"],
    ["प्राप्त", "हासिल"],
    ["रकम", "धनराशि"],
    ["निवेदन", "दरखास्त"],
    ["उल्लेख", "जिक्र"],
    ["हटाइयो", "निकालियो"],
    ["पठाइयो", "प्रेषित"],
    ["फैसला", "निर्णय"],
  ];
  function areSynonyms(original, latest) {
    const left = compact(original);
    const right = compact(latest);
    return SYNONYMS.some(
      (set) => set.includes(left) && set.includes(right),
    );
  }
  function classify(deleted, inserted) {
    const originalText = textOf(deleted);
    const latestText = textOf(inserted);
    const originalPunctuation =
      deleted.length && deleted.every((token) => isPunctuation(token.text));
    const latestPunctuation =
      inserted.length && inserted.every((token) => isPunctuation(token.text));
    if (
      (originalPunctuation || !deleted.length) &&
      (latestPunctuation || !inserted.length) &&
      (originalPunctuation || latestPunctuation)
    ) {
      const type =
        deleted.length && inserted.length
          ? "PUNCTUATION_REPLACE"
          : deleted.length
            ? "PUNCTUATION_DELETE"
            : "PUNCTUATION_ADD";
      return { type, types: [type], kind: "punctuation", substantive: false };
    }
    const originalWords = deleted.filter((token) => isWord(token.text)).length;
    const latestWords = inserted.filter((token) => isWord(token.text)).length;
    if (
      deleted.length &&
      inserted.length &&
      normalizerEquivalent(originalText, latestText)
    ) {
      const types = [];
      if (originalWords > latestWords) types.push("WORD_FUSION");
      else if (latestWords > originalWords) types.push("WORD_DISSOCIATION");
      const flags = normalizerFlags(originalText, latestText);
      if (joined(originalText) !== joined(latestText) || flags.length)
        types.push("NORMALIZER_CHANGE");
      if (!types.length) types.push("MINOR_SPELLING");
      return {
        type: types[0],
        types,
        kind: "minor",
        substantive: false,
        normalizerFlags: flags,
      };
    }
    if (
      deleted.length &&
      inserted.length &&
      joined(originalText) === joined(latestText) &&
      compact(originalText) !== compact(latestText)
    ) {
      const type =
        originalWords > latestWords ? "WORD_FUSION" : "WORD_DISSOCIATION";
      return { type, types: [type], kind: "minor", substantive: false };
    }
    if (
      deleted.length === 1 &&
      inserted.length === 1 &&
      isWord(deleted[0].text) &&
      isWord(inserted[0].text)
    ) {
      if (vowelForm(originalText) === vowelForm(latestText))
        return {
          type: "VOWEL_LENGTH",
          types: ["VOWEL_LENGTH"],
          kind: "minor",
          substantive: false,
        };
      const distance = levenshtein(originalText, latestText);
      const ratio =
        distance /
        Math.max(
          1,
          Math.max(Array.from(originalText).length, Array.from(latestText).length),
        );
      if (ratio <= 0.22)
        return {
          type: "MINOR_SPELLING",
          types: ["MINOR_SPELLING"],
          kind: "minor",
          substantive: false,
          editSimilarity: 1 - ratio,
        };
      if (ratio <= 0.46 || areSynonyms(originalText, latestText))
        return {
          type: "WORD_SUBSTITUTION",
          types: ["WORD_SUBSTITUTION"],
          kind: "substantive",
          substantive: true,
          semanticBasis: areSynonyms(originalText, latestText)
            ? "स्थानीय synonym lexicon"
            : "रूपगत समानता",
          editSimilarity: 1 - ratio,
        };
      return {
        type: "WORDS_MODIFIED",
        types: ["WORDS_MODIFIED"],
        kind: "substantive",
        substantive: true,
        editSimilarity: 1 - ratio,
      };
    }
    if (
      !deleted.some((token) => isWord(token.text)) &&
      inserted.some((token) => isWord(token.text))
    )
      return {
        type: "WORD_ADDITION",
        types: ["WORD_ADDITION"],
        kind: "substantive",
        substantive: true,
      };
    if (
      deleted.some((token) => isWord(token.text)) &&
      !inserted.some((token) => isWord(token.text))
    )
      return {
        type: "WORD_DELETION",
        types: ["WORD_DELETION"],
        kind: "deletion",
        substantive: true,
      };
    return {
      type: "WORDS_MODIFIED",
      types: ["WORDS_MODIFIED"],
      kind: "substantive",
      substantive: true,
    };
  }

  function nextId() {
    sequence += 1;
    return "proof-change-" + String(sequence).padStart(4, "0");
  }
  function createEvent(classification, originalText, latestText, context) {
    return {
      id: nextId(),
      type: classification.type,
      label: LABELS[classification.type] || classification.type,
      kind: classification.kind,
      oldText: compact(originalText),
      newText: compact(latestText),
      changeTypes: classification.types || [classification.type],
      flags: classification.normalizerFlags || [],
      semanticBasis: classification.semanticBasis || null,
      editSimilarity: classification.editSimilarity,
      countedAsSubstantive: Boolean(classification.substantive),
      mappingConfidence:
        context && context.mappingConfidence != null
          ? context.mappingConfidence
          : null,
      unitIndex: context && context.unitIndex != null ? context.unitIndex : 0,
      mode: (context && context.mode) || "sentence",
    };
  }
  function eventBlocks(operations, context) {
    const output = [];
    let pending = null;
    function flush() {
      if (!pending) return;
      pending.classification = classify(pending.deleted, pending.inserted);
      pending.event = createEvent(
        pending.classification,
        textOf(pending.deleted),
        textOf(pending.inserted),
        context,
      );
      output.push(pending);
      pending = null;
    }
    operations.forEach((operation) => {
      if (operation.kind === "equal") {
        flush();
        output.push({ equal: operation });
      } else {
        if (!pending) pending = { deleted: [], inserted: [] };
        if (operation.kind === "delete")
          pending.deleted.push(operation.original);
        else pending.inserted.push(operation.latest);
      }
    });
    flush();
    return output;
  }
  function analyzePair(originalText, latestText, context) {
    const diff = tokenDiff(originalText, latestText);
    const blocks = eventBlocks(diff.operations, context || {});
    const rawEvents = blocks.filter((block) => block.event).map((block) => block.event);
    let regions = 0;
    let inChange = false;
    blocks.forEach((block) => {
      if (block.equal) {
        if (isWord(block.equal.latest.text)) inChange = false;
      } else if (block.classification.substantive && !inChange) {
        regions += 1;
        inChange = true;
      }
    });
    const heavy = regions > THRESHOLD;
    const events = heavy
      ? [
          {
            id: nextId(),
            type: "SENTENCE_MODIFICATION",
            label: LABELS.SENTENCE_MODIFICATION,
            kind: "modification",
            oldText: compact(originalText),
            newText: compact(latestText),
            changeTypes: ["SENTENCE_MODIFICATION"],
            flags: [],
            countedAsSubstantive: true,
            mappingConfidence:
              context && context.mappingConfidence != null
                ? context.mappingConfidence
                : null,
            unitIndex: context && context.unitIndex != null ? context.unitIndex : 0,
            mode: (context && context.mode) || "sentence",
            regions,
            components: rawEvents,
          },
          ...rawEvents.filter((event) => !event.countedAsSubstantive),
        ]
      : rawEvents;
    return {
      blocks,
      events,
      regions,
      heavy,
      latestTail: diff.latestTokens.tail || "",
    };
  }

  function compareUnits(originalText, latestText, forcedMode) {
    const mode =
      forcedMode ||
      (String(originalText || "").includes("\n") ||
      String(latestText || "").includes("\n")
        ? "line"
        : "sentence");
    const original = comparisonUnits(originalText, mode);
    const latest = comparisonUnits(latestText, mode);
    const alignments = alignUnits(original, latest);
    const events = [];
    alignments.forEach((alignment) => {
      const originalCombined = alignment.old.map((unit) => unit.text).join(" ");
      const latestCombined = alignment.latest.map((unit) => unit.text).join(" ");
      const unitIndex = alignment.latest[0]
        ? alignment.latest[0].index
        : alignment.old[0]
          ? alignment.old[0].index
          : 0;
      if (alignment.type === "match") {
        if (compact(originalCombined) !== compact(latestCombined)) {
          alignment.analysis = analyzePair(originalCombined, latestCombined, {
            mode,
            unitIndex,
            mappingConfidence: alignment.mappingConfidence,
          });
          events.push(...alignment.analysis.events);
        }
      } else if (alignment.type === "merge" || alignment.type === "split") {
        alignment.analysis = analyzePair(originalCombined, latestCombined, {
          mode,
          unitIndex,
          mappingConfidence: alignment.mappingConfidence,
        });
        const type =
          alignment.type === "merge" ? "SENTENCE_MERGE" : "SENTENCE_SPLIT";
        events.push({
          id: nextId(),
          type,
          label: LABELS[type],
          kind: "minor",
          oldText: compact(originalCombined),
          newText: compact(latestCombined),
          changeTypes: [type],
          flags: [],
          countedAsSubstantive: false,
          mappingConfidence: alignment.mappingConfidence,
          unitIndex,
          mode,
        });
        events.push(...alignment.analysis.events);
      } else {
        const type =
          alignment.type === "add" ? "SENTENCE_ADDITION" : "SENTENCE_DELETION";
        events.push({
          id: nextId(),
          type,
          label: LABELS[type],
          kind: alignment.type === "delete" ? "deletion" : "substantive",
          oldText: compact(originalCombined),
          newText: compact(latestCombined),
          changeTypes: [type],
          flags: [],
          countedAsSubstantive: true,
          mappingConfidence: 1,
          unitIndex,
          mode,
        });
      }
    });
    return { mode, original, latest, alignments, events };
  }

  function eventReason(event) {
    if (!event) return "";
    if (String(event.type).startsWith("PUNCTUATION"))
      return "विरामचिह्न मात्र परिवर्तन भएको छ। यो substantive/threshold count मा जोडिएको छैन।";
    if (event.type === "NORMALIZER_CHANGE" || (event.flags || []).length)
      return (
        "Nepali normalizer अनुसार " +
        (event.flags || []).join(", ") +
        " परिवर्तन भेटियो। यसलाई सूक्ष्म परिवर्तनका रूपमा राखिएको छ।"
      );
    if (
      ["MINOR_SPELLING", "VOWEL_LENGTH", "WORD_FUSION", "WORD_DISSOCIATION"].includes(
        event.type,
      )
    )
      return "सूक्ष्म हिज्जे वा शब्द-संरचना परिवर्तन भएकाले sentence threshold मा गणना गरिएको छैन।";
    if (event.type === "WORD_ADDITION")
      return "मूल पाठमा नभएको शब्द वा शब्दसमूह latest पाठमा थपिएको छ।";
    if (event.type === "WORD_DELETION")
      return "मूल पाठको शब्द वा शब्दसमूह latest पाठमा हटाइएको छ।";
    if (event.type === "WORD_SUBSTITUTION")
      return (
        "रूपगत समानता" +
        (event.semanticBasis ? " वा " + event.semanticBasis : "") +
        " का आधारमा शब्द प्रतिस्थापन देखिन्छ।"
      );
    if (event.type === "WORDS_MODIFIED")
      return "एक वा बढी शब्दमा पर्याप्त रूपगत परिवर्तन भेटिएको छ।";
    if (event.type === "SENTENCE_MODIFICATION")
      return (
        String(event.regions || 0) +
        " छुट्टाछुट्टै substantive change-region भएकाले पूरै वाक्य fallback गरिएको छ।"
      );
    if (event.type === "SENTENCE_MERGE")
      return "नजिकका वाक्य/हरफ latest पाठमा जोडिएका छन्।";
    if (event.type === "SENTENCE_SPLIT")
      return "एउटै वाक्य/हरफ latest पाठमा छुट्टिएको छ।";
    if (event.type === "SENTENCE_ADDITION")
      return "Stable anchors बीच नयाँ वाक्य वा हरफ थपिएको छ।";
    if (event.type === "SENTENCE_DELETION")
      return "मूल वाक्य वा हरफ latest पाठमा छैन।";
    return event.countedAsSubstantive
      ? "यो परिवर्तन substantive count मा समावेश छ।"
      : "यो परिवर्तन मूल गणनामा समावेश छैन।";
  }
  function confidenceText(value) {
    if (value == null) return "संरचनात्मक mapping";
    const percent = Math.round(value * 100);
    return (
      percent +
      "% · " +
      (percent >= 85 ? "उच्च" : percent >= 60 ? "मध्यम" : "जाँच आवश्यक")
    );
  }

  function proofreadingSuggestions(text) {
    const output = [];
    const seen = new Set();
    const source = norm(text);
    function add(type, found, replacement, why, index, severity) {
      const key = type + "|" + found + "|" + replacement + "|" + index;
      if (seen.has(key) || output.length >= 60) return;
      seen.add(key);
      output.push({
        id: "proof-suggestion-" + String(output.length + 1).padStart(3, "0"),
        type: "proof",
        category: "proof",
        label: type,
        oldText: found,
        newText: replacement,
        reason: why,
        index: Math.max(0, index || 0),
        severity: severity || "suggestion",
        countedAsSubstantive: false,
        flags: ["भाषिक/शैलीगत सुझाव"],
      });
    }
    let expression = /([\p{L}\p{M}]+)\s+\1(?=\s|[।॥,;:?!]|$)/giu;
    let match;
    while ((match = expression.exec(source)))
      add(
        "दोहोरिएको शब्द",
        match[0],
        match[1],
        "एउटै शब्द लगातार दोहोरिएको हुन सक्छ।",
        match.index,
        "warning",
      );
    expression = /\s+([।॥,;:?!])/gu;
    while ((match = expression.exec(source)))
      add(
        "Spacing",
        match[0],
        match[1],
        "विरामचिह्नभन्दा अगाडिको खाली स्थान हटाउन सकिन्छ।",
        match.index,
      );
    expression = / {2,}/g;
    while ((match = expression.exec(source)))
      add(
        "Spacing",
        match[0],
        " ",
        "एकभन्दा बढी space लाई एउटामा सीमित गर्न सकिन्छ।",
        match.index,
      );
    expression = /([ऀ-ॿ])\.(?=\s|$)/gu;
    while ((match = expression.exec(source)))
      add(
        "पूर्णविराम",
        match[0],
        match[1] + "।",
        "देवनागरी वाक्यको अन्त्यमा नेपाली पूर्णविराम उपयुक्त हुन सक्छ।",
        match.index,
      );
    expression = /[\u200B-\u200D\uFEFF]/gu;
    while ((match = expression.exec(source)))
      add(
        "अदृश्य Unicode",
        match[0],
        "",
        "अदृश्य Unicode चिन्हले खोज, copy वा comparison प्रभावित गर्न सक्छ।",
        match.index,
        "warning",
      );
    const dictionary = {
      गरि: "गरी",
      चाहि: "चाहिँ",
      हुदैन: "हुँदैन",
      देखिदैन: "देखिँदैन",
      सम्वन्ध: "सम्बन्ध",
      सम्वन्धित: "सम्बन्धित",
    };
    expression = /[\p{L}\p{M}]+/gu;
    while ((match = expression.exec(source)))
      if (dictionary[match[0]])
        add(
          "सम्भावित हिज्जे",
          match[0],
          dictionary[match[0]],
          "सन्दर्भ हेरी मानक रूप विचार गर्नुहोस्।",
          match.index,
          "warning",
        );
    return output;
  }

  const engine = {
    version: "4.0.0-cause-list",
    threshold: THRESHOLD,
    labels: LABELS,
    normalizer,
    splitSentences,
    comparisonUnits,
    alignUnits,
    similarity,
    analyzePair,
    compareUnits,
    proofreadingSuggestions,
    eventReason,
    confidenceText,
  };

  root.NepaliProofreaderEngine = engine;
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
})(typeof globalThis !== "undefined" ? globalThis : window);
