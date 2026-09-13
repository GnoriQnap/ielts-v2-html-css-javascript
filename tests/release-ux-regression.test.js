import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../css/base.css", import.meta.url), "utf8");

function sourceBetween(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return appSource.slice(startIndex, endIndex);
}

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
    const [red, green, blue] = channels.map((value) => (
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    ));
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("single questions keep guidance while multiple questions render one friendly badge", () => {
  const renderSource = sourceBetween("function renderActiveQuestion()", "function renderOptions(");
  assert.match(renderSource, /isMultiple \? "多选题" : "请选择对应的语义分类"/);
  assert.match(renderSource, /classList\.toggle\("prompt-multiple", isMultiple\)/);
  assert.equal((htmlSource.match(/id="question-prompt"/g) ?? []).length, 1);
  assert.match(cssSource, /\.prompt\.prompt-multiple\s*\{[\s\S]*background: var\(--color-danger-soft\);[\s\S]*color: var\(--color-danger-text\);/);
});

test("the muted palette separates neutral, brand, success, danger, and warning tokens", () => {
  assert.match(cssSource, /--color-bg: #f8f8f5;/);
  assert.match(cssSource, /--color-surface: #fdfcf8;/);
  assert.match(cssSource, /--color-text: #29332f;/);
  assert.match(cssSource, /--color-primary: #258548;/);
  assert.match(cssSource, /--color-primary-soft: #c3efcf;/);
  assert.match(cssSource, /--color-success: #238552;/);
  assert.match(cssSource, /--color-danger: #d72d4b;/);
  assert.match(cssSource, /--color-danger-answer-soft: #fff0f3;/);
  assert.match(cssSource, /--color-warning: #96703a;/);
  assert.match(cssSource, /\.option-button\.selected\s*\{[\s\S]*var\(--color-primary\)/);
  assert.match(cssSource, /\.option-button\.correct\s*\{[\s\S]*var\(--color-success\)/);
  assert.match(cssSource, /\.option-button\.incorrect\s*\{[\s\S]*background: var\(--color-danger-answer-soft\);[\s\S]*var\(--color-danger\)/);
  assert.match(cssSource, /\.feedback\.validation \{ color: var\(--color-warning-text\); \}/);
  assert.doesNotMatch(cssSource, /linear-gradient/);
});

test("primary, danger, and reading text retain accessible contrast", () => {
  assert.ok(contrastRatio("#fdfcf8", "#258548") >= 4.5);
  assert.ok(contrastRatio("#fdfcf8", "#d72d4b") >= 4.5);
  assert.ok(contrastRatio("#29332f", "#fdfcf8") >= 4.5);
  assert.ok(contrastRatio("#52625a", "#f8f8f5") >= 4.5);
  assert.ok(contrastRatio("#176b36", "#c3efcf") >= 4.5);
});

test("dashboard is rendered from the fixed official system word list", () => {
  const renderSource = sourceBetween("function renderDashboard()", "function openPracticeFromLink(");
  assert.match(appSource, /const systemWordKeyList = \[\.\.\.officialSystemWordKeys\];/);
  assert.match(renderSource, /allWordKeys: systemWordKeyList/);
  assert.match(renderSource, /overallProgressCount\.textContent/);
  assert.match(renderSource, /overallProgressBar\.style\.width/);
});

test("active rounds hide duplicate statistics and retain a low-priority abandon action", () => {
  const roundSource = sourceBetween("function renderRoundControls()", "function handleRoundSizeChange()");
  assert.match(roundSource, /roundSetup\.hidden = Boolean\(currentRound\)/);
  assert.match(roundSource, /roundActive\.hidden = !currentRound/);
  assert.match(roundSource, /roundPanel\.dataset\.activeRound = String\(Boolean\(currentRound\)\)/);
  assert.match(cssSource, /\.round-panel\[data-active-round="true"\] #round-progress \{ display: none; \}/);
  assert.equal((htmlSource.match(/id="abandon-round"/g) ?? []).length, 1);
  assert.match(htmlSource, /id="abandon-round" class="button button-abandon-round"[^>]*>放弃本轮</);
  assert.match(cssSource, /\.round-panel\[data-active-round="true"\]\s*\{[\s\S]*order: 2;[\s\S]*width: 100%;/);
  assert.match(cssSource, /\.round-panel\[data-active-round="true"\] #abandon-round\s*\{[\s\S]*width: 100%;[\s\S]*min-height: 48px;[\s\S]*border-color:/);
  assert.match(appSource, /abandonRound\.addEventListener\("click", openAbandonConfirmation\)/);
});

test("round completion offers next round and a random-practice return", () => {
  assert.match(htmlSource, /id="start-next-round"[^>]*>开始下一轮</);
  assert.match(htmlSource, /id="completion-intensive"[^>]*>返回</);
  assert.doesNotMatch(htmlSource, /id="completion-intensive"[^>]*>待强化专练</);
  const returnSource = sourceBetween("function returnFromCompletion()", "function renderRoundControls()");
  assert.match(returnSource, /mode: PRACTICE_MODES\.RANDOM/);
  assert.match(returnSource, /dismissedCompletionRoundId = appState\.rounds\.lastCompletedSummary\?\.roundId/);
  assert.doesNotMatch(returnSource, /lastCompletedSummary\s*:/);
});

test("intensive empty state is compact and keeps a subtle random-practice hint", () => {
  const emptySource = sourceBetween("function renderEmptyState()", "function startNewRound()");
  assert.match(emptySource, /"暂无待强化词"/);
  assert.match(emptySource, /"答错或主动加入待强化后，可在这里集中练习。"/);
  assert.match(emptySource, /classList\.add\("practice-empty-state"\)/);
  assert.match(cssSource, /\.practice-empty-state \.practice-card \.word\s*\{[\s\S]*font-size: clamp\(25px, 4vw, 32px\)/);
  assert.match(cssSource, /\.practice-empty-state \.practice-card \.empty-state\s*\{[\s\S]*color: var\(--color-primary-text\)/);
});

test("Wordbook hides filters during search and restores them after clearing", () => {
  const renderSource = sourceBetween("function renderWordbook()", "function getWordbookData()");
  const clearSource = sourceBetween("function clearWordbookSearch()", "function handleWordbookFilter(");
  assert.match(renderSource, /wordbookFilters\.hidden = hasSearchQuery/);
  assert.match(renderSource, /filter: hasSearchQuery \? WORDBOOK_FILTERS\.ALL : wordbookFilter/);
  assert.match(renderSource, /const nextStatus = hasSearchQuery\s*\? null/);
  assert.match(clearSource, /wordbookQuery = ""/);
  assert.match(clearSource, /renderWordbook\(\)/);
  assert.match(appSource, /statusBadge\.textContent = statusLabel\(entry\.status\)/);
  assert.doesNotMatch(renderSource, /getWordDetails|vocabularyRepository|validateVocabulary|createVocabularyIndex/);
});
