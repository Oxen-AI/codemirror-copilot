import { inlineSuggestion, type DiffSuggestion } from "./inline-suggestion";
import type { EditorState } from "@codemirror/state";
// import { Text } from "@codemirror/state";

/**
 * Represents a diff/patch in the format shown in the example
 */
export interface Patch {
  /**
   * The line number where the change occurred (1-indexed)
   */
  line: number;
  /**
   * The original line content (with - prefix)
   */
  original: string;
  /**
   * The new line content (with + prefix)
   */
  modified: string;
  /**
   * Optional context lines before the change
   */
  contextBefore?: string[];
  /**
   * Optional context lines after the change
   */
  contextAfter?: string[];
  /**
   * The diff string
   */
  diffString?: string;
}

/**
 * Should fetch autosuggestions from your AI
 * of choice. If there are no suggestions,
 * you should return an empty string.
 * The patch parameter contains information about the last edit.
 */
export type SuggestionRequestCallback = (
  prefix: string,
  suffix: string,
  patch?: Patch,
) => Promise<string>;

const localSuggestionsCache: { [key: string]: DiffSuggestion } = {};

// Track the last prediction for diff calculation
let lastPrediction: string | null = null;

/**
 * Wraps a user-provided fetch method so that users
 * don't have to interact directly with the EditorState
 * object, and connects it to the local result cache.
 */
function wrapUserFetcher(onSuggestionRequest: SuggestionRequestCallback) {
  return async function fetchSuggestion(state: EditorState) {
    const { from, to } = state.selection.ranges[0];
    const text = state.doc.toString();
    const prefix = text.slice(0, to);
    const suffix = text.slice(from);

    // If we have a local suggestion cache, use it
    const key = `${prefix}<:|:>${suffix}`;
    const localSuggestion = localSuggestionsCache[key];
    if (localSuggestion) {
      return localSuggestion;
    }

    // Calculate diff from last prediction if available
    let patch: Patch | undefined;
    if (lastPrediction) {
      patch = calculateDetailedPatch(lastPrediction, text);
    }

    console.log("=====patch======")
    console.log(patch)
    console.log("=====end patch======")

    const prediction = await onSuggestionRequest(prefix, suffix, patch);
    
    // Store the current prediction for next diff calculation
    lastPrediction = prediction.trim();
    
    // Create a diff suggestion
    const diffSuggestion: DiffSuggestion = {
      oldText: text,
      newText: prediction.trim(), // Ensure clean text without extra newlines
      from: from,
      to: to,
    };
    
    localSuggestionsCache[key] = diffSuggestion;
    return diffSuggestion;
  };
}

/**
 * Calculate a detailed patch with line numbers and context
 */
function calculateDetailedPatch(lastPrediction: string, currentText: string): Patch | undefined {
  const lastLines = lastPrediction.split('\n');
  const currentLines = currentText.split('\n');
  
  // Find the first line that differs
  let firstDiffLine = -1;
  const maxLines = Math.max(lastLines.length, currentLines.length);
  
  for (let i = 0; i < maxLines; i++) {
    const lastLine = lastLines[i] || '';
    const currentLine = currentLines[i] || '';
    
    if (lastLine !== currentLine) {
      firstDiffLine = i + 1; // 1-indexed line number
      break;
    }
  }
  
  if (firstDiffLine === -1) {
    return undefined; // No differences found
  }
  
  // Get context lines (2 lines before and after)
  const contextBefore = lastLines.slice(Math.max(0, firstDiffLine - 3), firstDiffLine - 1);
  const contextAfter = lastLines.slice(firstDiffLine, Math.min(lastLines.length, firstDiffLine + 2));
  
  // Get the original and modified lines
  const originalLine = lastLines[firstDiffLine - 1] || '';
  const modifiedLine = currentLines[firstDiffLine - 1] || '';
  
  return {
    line: firstDiffLine,
    original: `- ${originalLine}`,
    modified: `+ ${modifiedLine}`,
    contextBefore: contextBefore.length > 0 ? contextBefore : undefined,
    contextAfter: contextAfter.length > 0 ? contextAfter : undefined,
    diffString: `- ${originalLine}\n+ ${modifiedLine}`
  };
}

/**
 * Configure the UI, state, and keymap to power
 * auto suggestions, with an abstracted
 * fetch method.
 */
export const inlineCopilot = (
  onSuggestionRequest: SuggestionRequestCallback,
  delay = 1000,
  acceptOnClick = true,
) => {
  return inlineSuggestion({
    fetchFn: wrapUserFetcher(onSuggestionRequest),
    delay,
    acceptOnClick,
  });
};

export const clearLocalCache = () => {
  Object.keys(localSuggestionsCache).forEach((key) => {
    delete localSuggestionsCache[key];
  });
  // Also clear the tracking variable
  lastPrediction = null;
};
