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

    const prediction = await onSuggestionRequest(prefix, suffix);
    
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
 * Simple diff calculation to highlight changes (copied from inline-suggestion.ts)
 
function calculateDiff(oldText: string, newText: string): { added: string; removed: string } {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  const added: string[] = [];
  const removed: string[] = [];
  
  const maxLines = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      if (oldLine) {
        // Show removed line with red color
        removed.push(`- ${oldLine}`);
      }
      if (newLine) {
        // Show added line with green color
        added.push(`+ ${newLine}`);
      }
    }
  }
  
  // If no changes, show a simple replacement message
  if (added.length === 0 && removed.length === 0) {
    return {
      added: `→ ${newText.trim()}`,
      removed: ''
    };
  }
  
  return {
    added: added.join('\n'),
    removed: removed.join('\n')
  };
}
*/

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
};
