import { vocabularyData } from "./vocabulary.js";
import { vocabularyDetails } from "./vocabulary-details.js";

export const defaultVocabularyData = {
  ...vocabularyData,
  word_details: vocabularyDetails
};
