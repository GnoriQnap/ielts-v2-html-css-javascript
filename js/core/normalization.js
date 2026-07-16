export function normalizeWordKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

export function normalizeCategoryName(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}
