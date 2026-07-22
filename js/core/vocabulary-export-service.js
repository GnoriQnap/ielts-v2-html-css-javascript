import { validateVocabularyData } from "./vocabulary-validator.js";

export function buildVocabularyExport(repository, options = {}) {
  const { validator = validateVocabularyData } = options;
  if (!repository || typeof repository.getCurrentVocabulary !== "function") {
    throw new TypeError("必须提供有效的 vocabulary repository。");
  }

  const vocabulary = repository.getCurrentVocabulary();
  const validation = validator(vocabulary);
  if (!validation?.isValid) {
    throw new RangeError("当前词库数据不合法，无法导出。");
  }

  return clonePlain(vocabulary);
}

export function createVocabularyExportFilename(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("导出日期必须是有效日期。");
  }
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `ielts-vocabulary-${year}-${month}-${day}.json`;
}

export function downloadVocabularyExport(repository, options = {}) {
  const {
    date = new Date(),
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    BlobCtor = globalThis.Blob,
    validator = validateVocabularyData
  } = options;
  if (!documentRef?.createElement || !documentRef?.body?.append) {
    throw new TypeError("当前环境不支持文件下载。");
  }
  if (!urlApi?.createObjectURL || !urlApi?.revokeObjectURL || typeof BlobCtor !== "function") {
    throw new TypeError("当前环境不支持文件下载。");
  }

  const data = buildVocabularyExport(repository, { validator });
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const filename = createVocabularyExportFilename(date);
  const blob = new BlobCtor([json], { type: "application/json;charset=utf-8" });
  const objectUrl = urlApi.createObjectURL(blob);

  try {
    const link = documentRef.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    documentRef.body.append(link);
    link.click();
    link.remove();
  } finally {
    urlApi.revokeObjectURL(objectUrl);
  }

  return { data, filename, json };
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
