import { inlineSuggestion } from "./inline-suggestion";
import type { EditorState } from "@codemirror/state";
import { Text } from "@codemirror/state";

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
}

/**
 * Represents a diff suggestion with old and new text
 */
export interface DiffSuggestion {
  oldText: string;
  newText: string;
  from: number;
  to: number;
  replaceEntireDocument?: boolean; // Add this property
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
 * Tracks the last edit as a patch
 */
let lastEditPatch: Patch | undefined;

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

    const prediction = await onSuggestionRequest(prefix, suffix, lastEditPatch);
    
    // Create a diff suggestion
    const diffSuggestion: DiffSuggestion = {
      oldText: text,
      newText: prediction.trim(), // Ensure clean text without extra newlines
      from: from,
      to: to,
      replaceEntireDocument: true, // Replace the entire document
    };
    
    localSuggestionsCache[key] = diffSuggestion;
    return diffSuggestion;
  };
}

/**
 * Updates the last edit patch based on the transaction
 */
export function updateLastEditPatch(
  oldDoc: string,
  newDoc: string,
  from: number,
  _to: number,
  _insert: string
): Patch | undefined {
  // If no change, return undefined
  if (oldDoc === newDoc) {
    return undefined;
  }

  // Use CodeMirror's Text object to properly calculate line numbers
  const oldText = Text.of(oldDoc.split('\n'));
  const lineNumber = oldText.lineAt(from).number + 1; // Convert to 1-indexed

  // Extract the original and modified lines
  const originalLines = oldDoc.split('\n');
  const modifiedLines = newDoc.split('\n');
  
  // Find the line that changed
  const originalLine = originalLines[lineNumber - 1] || '';
  const modifiedLine = modifiedLines[lineNumber - 1] || '';

  // Create context lines (2 lines before and after)
  const contextBefore = originalLines.slice(Math.max(0, lineNumber - 3), lineNumber - 1);
  const contextAfter = originalLines.slice(lineNumber, Math.min(originalLines.length, lineNumber + 2));

  return {
    line: lineNumber,
    original: originalLine,
    modified: modifiedLine,
    contextBefore,
    contextAfter,
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
    onEdit: (oldDoc: string, newDoc: string, from: number, to: number, insert: string) => {
      lastEditPatch = updateLastEditPatch(oldDoc, newDoc, from, to, insert);
    },
  });
};

export const clearLocalCache = () => {
  Object.keys(localSuggestionsCache).forEach((key) => {
    delete localSuggestionsCache[key];
  });
};

/**
 * Get the last edit patch
 */
export const getLastEditPatch = (): Patch | undefined => {
  return lastEditPatch;
};

/**
 * Clear the last edit patch
 */
export const clearLastEditPatch = () => {
  lastEditPatch = undefined;
};
