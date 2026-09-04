// Pure text -> reading-time estimate logic, ported 1:1 from the extension's
// src/content/readingTime.js. Nothing here touches `document` or `window`
// state beyond exposing the namespace, same as the original ran under plain
// Node without a browser.

const DEFAULT_WORDS_PER_MINUTE = 225;
const MIN_WORDS_FOR_ESTIMATE = 120; // skip the badge on short pages/snippets

function countWords(text) {
  if (!text) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function estimateReadingMinutes(text, wordsPerMinute = DEFAULT_WORDS_PER_MINUTE) {
  const words = countWords(text);
  const minutes = Math.max(1, Math.round(words / wordsPerMinute));
  return { words, minutes };
}

function shouldShowBadge(wordCount) {
  return wordCount >= MIN_WORDS_FOR_ESTIMATE;
}

function formatReadingTimeLabel(minutes) {
  return `${minutes} min read`;
}

window.FGReadingTime = {
  DEFAULT_WORDS_PER_MINUTE,
  MIN_WORDS_FOR_ESTIMATE,
  countWords,
  estimateReadingMinutes,
  shouldShowBadge,
  formatReadingTimeLabel,
};
