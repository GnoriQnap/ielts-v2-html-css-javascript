export function createDefaultWordDetails() {
  return {
    phonetics: {
      uk: "",
      us: ""
    },
    meanings: [],
    collocations: [],
    examples: [],
    notes: "",
    source: "",
    updatedAt: ""
  };
}

export function normalizeVocabularyDetails(candidate) {
  const source = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate
    : {};
  if (isLegacyVocabularyDetails(source)) {
    return {
      phonetics: {
        uk: typeof source.phonetic === "string" ? source.phonetic : "",
        us: ""
      },
      meanings: typeof source.definition === "string" && source.definition.length > 0
        ? [{ partOfSpeech: "", definitionZh: source.definition }]
        : [],
      collocations: Array.isArray(source.collocations) ? [...source.collocations] : [],
      examples: Array.isArray(source.examples)
        ? source.examples.map((example) => ({ en: example, zh: "" }))
        : [],
      notes: "",
      source: "",
      updatedAt: ""
    };
  }
  const defaults = createDefaultWordDetails();
  return {
    phonetics: {
      uk: typeof source.phonetics?.uk === "string" ? source.phonetics.uk : "",
      us: typeof source.phonetics?.us === "string" ? source.phonetics.us : ""
    },
    meanings: Array.isArray(source.meanings)
      ? source.meanings.map((meaning) => ({
        partOfSpeech: typeof meaning?.partOfSpeech === "string" ? meaning.partOfSpeech : "",
        definitionZh: typeof meaning?.definitionZh === "string" ? meaning.definitionZh : ""
      }))
      : defaults.meanings,
    collocations: Array.isArray(source.collocations)
      ? [...source.collocations]
      : defaults.collocations,
    examples: Array.isArray(source.examples)
      ? source.examples.map((example) => ({
        en: typeof example?.en === "string" ? example.en : "",
        zh: typeof example?.zh === "string" ? example.zh : ""
      }))
      : defaults.examples,
    notes: typeof source.notes === "string" ? source.notes : "",
    source: typeof source.source === "string" ? source.source : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : ""
  };
}

export function validateVocabularyDetails(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) {
    return [{ code: "INVALID_DETAILS", message: "details 必须是对象。" }];
  }
  if (isLegacyVocabularyDetails(candidate)) {
    validateOptionalString(candidate, "phonetic", "details.phonetic", errors);
    validateOptionalString(candidate, "definition", "details.definition", errors);
    validateStringArray(candidate, "collocations", "details.collocations", errors);
    validateStringArray(candidate, "examples", "details.examples", errors);
    return errors;
  }

  if ("phonetics" in candidate) {
    if (!isPlainObject(candidate.phonetics)) {
      errors.push({ code: "INVALID_DETAILS_PHONETICS", message: "details.phonetics 必须是对象。" });
    } else {
      validateOptionalString(candidate.phonetics, "uk", "details.phonetics.uk", errors);
      validateOptionalString(candidate.phonetics, "us", "details.phonetics.us", errors);
    }
  }
  validateObjectArray(candidate, "meanings", "details.meanings", [
    ["partOfSpeech", "details.meanings[].partOfSpeech"],
    ["definitionZh", "details.meanings[].definitionZh"]
  ], errors);
  validateStringArray(candidate, "collocations", "details.collocations", errors);
  validateObjectArray(candidate, "examples", "details.examples", [
    ["en", "details.examples[].en"],
    ["zh", "details.examples[].zh"]
  ], errors);
  validateOptionalString(candidate, "notes", "details.notes", errors);
  validateOptionalString(candidate, "source", "details.source", errors);
  validateOptionalString(candidate, "updatedAt", "details.updatedAt", errors);
  if (
    typeof candidate.updatedAt === "string" &&
    candidate.updatedAt.length > 0 &&
    !isIsoDateTime(candidate.updatedAt)
  ) {
    errors.push({
      code: "INVALID_DETAILS_UPDATED_AT",
      message: "details.updatedAt 必须是 ISO 时间字符串或空字符串。"
    });
  }
  return errors;
}

export function requireVocabularyDetails(candidate) {
  const errors = validateVocabularyDetails(candidate);
  if (errors.length > 0) {
    throw new TypeError(errors[0].message);
  }
  return normalizeVocabularyDetails(candidate);
}

function validateOptionalString(candidate, field, path, errors) {
  if (field in candidate && typeof candidate[field] !== "string") {
    errors.push({ code: "INVALID_DETAILS_STRING", message: `${path} 必须是字符串。` });
  }
}

function validateStringArray(candidate, field, path, errors) {
  if (!(field in candidate)) {
    return;
  }
  if (!Array.isArray(candidate[field])) {
    errors.push({ code: "INVALID_DETAILS_ARRAY", message: `${path} 必须是数组。` });
    return;
  }
  candidate[field].forEach((item, index) => {
    if (typeof item !== "string") {
      errors.push({
        code: "INVALID_DETAILS_ARRAY_ITEM",
        message: `${path}[${index}] 必须是字符串。`
      });
    }
  });
}

function validateObjectArray(candidate, field, path, stringFields, errors) {
  if (!(field in candidate)) {
    return;
  }
  if (!Array.isArray(candidate[field])) {
    errors.push({ code: "INVALID_DETAILS_ARRAY", message: `${path} 必须是数组。` });
    return;
  }
  candidate[field].forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push({
        code: "INVALID_DETAILS_ARRAY_ITEM",
        message: `${path}[${index}] 必须是对象。`
      });
      return;
    }
    for (const [itemField, itemPath] of stringFields) {
      if (itemField in item && typeof item[itemField] !== "string") {
        errors.push({
          code: "INVALID_DETAILS_STRING",
          message: `${itemPath} 必须是字符串。`
        });
      }
    }
  });
}

function isPlainObject(candidate) {
  return Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate));
}

function isLegacyVocabularyDetails(candidate) {
  const hasCanonicalOnlyField = [
    "phonetics",
    "meanings",
    "notes",
    "source",
    "updatedAt"
  ].some((field) => field in candidate);
  return !hasCanonicalOnlyField && (
    "phonetic" in candidate ||
    "definition" in candidate ||
    (Array.isArray(candidate.examples) && candidate.examples.some((item) => typeof item === "string"))
  );
}

function isIsoDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}
