import { vocabularyData } from "./data/vocabulary.js";
import { validateVocabularyData } from "./core/vocabulary-validator.js";

const report = validateVocabularyData(vocabularyData);

renderStatus(report);
renderSummary(report.summary);
renderIssues(report);
renderMultiCategorySample(report);

function renderStatus(currentReport) {
  const badge = document.querySelector("#validation-badge");
  badge.textContent = currentReport.isValid ? "可进入阶段 1" : "存在阻断错误";
  badge.classList.add(currentReport.isValid ? "success" : "error");
}

function renderSummary(summary) {
  const metrics = [
    ["分类", summary.groupCount],
    ["原始词条归属", summary.rawWordCount],
    ["唯一词条", summary.uniqueWordCount],
    ["多分类词", summary.multiCategoryWordCount],
    ["单词最多分类数", summary.maxCategoriesPerWord]
  ];

  const grid = document.querySelector("#summary-grid");
  for (const [label, value] of metrics) {
    const card = document.createElement("article");
    card.className = "metric";
    const number = document.createElement("strong");
    const caption = document.createElement("span");
    number.textContent = String(value);
    caption.textContent = label;
    card.append(number, caption);
    grid.append(card);
  }
}

function renderIssues(currentReport) {
  const issueCount = document.querySelector("#issue-count");
  issueCount.textContent = `${currentReport.errors.length} 个错误，${currentReport.warnings.length} 个警告`;
  const container = document.querySelector("#issues");
  const issues = [
    ...currentReport.errors.map((item) => ({ ...item, severity: "error" })),
    ...currentReport.warnings.map((item) => ({ ...item, severity: "warning" }))
  ];

  if (issues.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "未发现数据问题。";
    container.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "issue-list";
  for (const item of issues) {
    const row = document.createElement("li");
    row.className = `issue ${item.severity}`;
    row.textContent = `${item.severity === "error" ? "错误" : "警告"} · ${item.message}`;
    list.append(row);
  }
  container.append(list);
}

function renderMultiCategorySample(currentReport) {
  const rows = document.querySelector("#multi-word-rows");
  for (const item of currentReport.details.multiCategoryWords.slice(0, 12)) {
    const row = document.createElement("tr");
    const displayCell = document.createElement("td");
    const keyCell = document.createElement("td");
    const groupsCell = document.createElement("td");
    const code = document.createElement("code");
    displayCell.textContent = item.displayText;
    code.textContent = item.wordKey;
    keyCell.append(code);
    groupsCell.textContent = item.groupIds.map((groupId) => {
      const group = currentReport.index.groupById.get(groupId);
      return `${groupId} · ${group?.category ?? "未知分类"}`;
    }).join("；");
    row.append(displayCell, keyCell, groupsCell);
    rows.append(row);
  }
}
