import { inlineSuggestion, type DiffSuggestion } from "./inline-suggestion";
import type { EditorState } from "@codemirror/state";

/**
 * Callback for when a prediction is made
 */
export type PredictionCallback = (prediction: string, prompt: string) => void;

/**
 * Internal function to make HTTP request to the autocomplete API
 */
async function fetchPrediction(
  prefix: string,
  suffix: string,
  model: string,
  apiEndpoint: string,
): Promise<{ prediction: string; prompt: string }> {
  const response = await fetch(apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix,
      suffix,
      model,
      lastEdit: prefix + suffix,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

/**
 * Wraps the internal fetch method to work with the inline suggestion system
 */
function wrapInternalFetcher(
  model: string,
  apiEndpoint: string,
  onPrediction?: PredictionCallback,
) {
  return async function fetchSuggestion(state: EditorState) {
    const { from, to } = state.selection.ranges[0];
    const text = state.doc.toString();
    const prefix = text.slice(0, to);
    const suffix = text.slice(from);

    // Insert a <|user_cursor_is_here|> marker at the cursor position
    const oldText = text.slice(0, from) + "<|user_cursor_is_here|>" + text.slice(from);

    try {
      const { prediction, prompt } = await fetchPrediction(
        prefix,
        suffix,
        model,
        apiEndpoint,
      );

      // Call the prediction callback if provided
      if (onPrediction) {
        onPrediction(prediction, prompt);
      }

      // Remove special tokens and clean up the prediction
      const cleanPrediction = prediction.replace(
        /<\|editable_region_start\|>\n?|<\|editable_region_end\|>\n?/g,
        "",
      );

      // Create a diff suggestion
      const diffSuggestion: DiffSuggestion = {
        oldText: oldText,
        newText: cleanPrediction.trim(),
        from: from,
        to: to,
        prefix: prefix,
        suffix: suffix,
      };

      return diffSuggestion;
    } catch (error) {
      console.error("Error fetching prediction:", error);
      // Return empty suggestion on error
      return {
        oldText: text,
        newText: text,
        from: from,
        to: to,
        prefix: prefix,
        suffix: suffix,
      };
    }
  };
}

/**
 * Configure the UI, state, and keymap to power
 * auto suggestions with a simplified API that only requires
 * the model name and API endpoint.
 */
export const inlineCopilot = (
  model: string,
  apiEndpoint: string = "/api/autocomplete",
  onPrediction?: PredictionCallback,
  delay: number = 500,
) => {
  return inlineSuggestion({
    fetchFn: wrapInternalFetcher(model, apiEndpoint, onPrediction),
    delay,
  });
};
