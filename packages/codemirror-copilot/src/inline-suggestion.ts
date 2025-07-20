import {
  ViewPlugin,
  DecorationSet,
  EditorView,
  ViewUpdate,
  Decoration,
  WidgetType,
  keymap,
} from "@codemirror/view";
import {
  StateEffect,
  Text,
  Facet,
  Prec,
  StateField,
  EditorState,
  EditorSelection,
  TransactionSpec,
} from "@codemirror/state";
import { debouncePromise } from "./lib/utils";
import * as Diff from "diff";

/**
 * The inner method to fetch suggestions: this is
 * abstracted by `inlineCopilot`.
 */
type InlineFetchFn = (state: EditorState) => Promise<DiffSuggestion>;

/**
 * Represents a diff suggestion with old and new text
 */
export interface DiffSuggestion {
  oldText: string;
  newText: string;
  prefix: string;
  suffix: string;
  from: number;
  to: number;
  ghostText?: string; // The actual text shown as ghost text to the user
}

/**
 * Current state of the autosuggestion
 */
const InlineSuggestionState = StateField.define<{
  suggestion: null | DiffSuggestion;
}>({
  create() {
    return { suggestion: null };
  },
  update(previousValue, tr) {
    const inlineSuggestion = tr.effects.find((e) =>
      e.is(InlineSuggestionEffect),
    );
    if (tr.state.doc) {
      if (inlineSuggestion && tr.state.doc == inlineSuggestion.value.doc) {
        // There is a new selection that has been set via an effect,
        // and it applies to the current document.
        return { suggestion: inlineSuggestion.value.suggestion };
      } else if (!tr.docChanged && !tr.selection) {
        // This transaction is irrelevant to the document state
        // and could be generate by another plugin, so keep
        // the previous value.
        return previousValue;
      }
    }
    return { suggestion: null };
  },
});

const InlineSuggestionEffect = StateEffect.define<{
  suggestion: DiffSuggestion | null;
  doc: Text;
}>();

/**
 * Represents a piece of diff text with type information
 */
interface DiffPart {
  text: string;
  type: 'added' | 'removed' | 'unchanged';
}

/**
 * Widget for displaying ghost text inline with diff information
 */
class GhostTextWidget extends WidgetType {
  diffParts: DiffPart[];
  suggestion: DiffSuggestion;

  constructor(diffParts: DiffPart[], suggestion: DiffSuggestion) {
    super();
    this.diffParts = diffParts;
    this.suggestion = suggestion;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("span");
    container.className = "cm-ghost-text-container";
    container.style.cssText = `
      cursor: pointer;
      display: inline;
    `;
    
    // Create spans for each diff part
    this.diffParts.forEach((part) => {
      if (part.type === 'unchanged') return; // Skip unchanged parts
      
      const span = document.createElement("span");
      span.className = `cm-ghost-text cm-ghost-${part.type}`;
      
      if (part.type === 'added') {
        span.style.cssText = `
          color: #22863a;
          opacity: 0.7;
          font-style: italic;
          background: rgba(34, 134, 58, 0.1);
          border-radius: 2px;
          padding: 1px 2px;
          margin-right: 1px;
        `;
      } else if (part.type === 'removed') {
        span.style.cssText = `
          color: #d73a49;
          opacity: 0.7;
          font-style: italic;
          background: rgba(215, 58, 73, 0.1);
          border-radius: 2px;
          padding: 1px 2px;
          margin-right: 1px;
          text-decoration: line-through;
        `;
      }
      
      span.textContent = part.text;
      container.appendChild(span);
    });
    
    container.onclick = (e) => this.accept(e, view);
    return container;
  }

  accept(e: MouseEvent, view: EditorView) {
    const config = view.state.facet(suggestionConfigFacet);
    if (!config.acceptOnClick) return;

    e.stopPropagation();
    e.preventDefault();

    const suggestion = view.state.field(InlineSuggestionState)?.suggestion;

    // If there is no suggestion, do nothing and let the default keymap handle it
    if (!suggestion) {
      return false;
    }

    view.dispatch({
      ...insertDiffText(view.state, suggestion.newText, suggestion),
    });
    return true;
  }
}

/**
 * Small widget to indicate that a suggestion can be accepted
 */
class AcceptIndicatorWidget extends WidgetType {
  suggestion: DiffSuggestion;

  constructor(suggestion: DiffSuggestion) {
    super();
    this.suggestion = suggestion;
  }

  toDOM(view: EditorView) {
    console.log("AcceptIndicatorWidget.toDOM called");
    const container = document.createElement("div");
    container.style.cssText = `
      display: inline-flex;
      gap: 8px;
      align-items: center;
    `;

    // Accept button
    const acceptSpan = document.createElement("span");
    acceptSpan.className = "cm-accept-indicator";
    acceptSpan.style.cssText = `
      color: #007acc;
      opacity: 0.8;
      font-size: 0.8em;
      cursor: pointer;
      padding: 1px 4px;
      background: rgba(0, 122, 204, 0.1);
      border-radius: 3px;
      border: 1px solid rgba(0, 122, 204, 0.3);
      margin-left: 8px;
    `;
    acceptSpan.textContent = "💡 Accept [Tab]";
    acceptSpan.onclick = (e) => this.accept(e, view);
    container.appendChild(acceptSpan);

    // Reject button
    const rejectSpan = document.createElement("span");
    rejectSpan.className = "cm-reject-indicator";
    rejectSpan.style.cssText = `
      color: #d73a49;
      opacity: 0.8;
      font-size: 0.8em;
      cursor: pointer;
      padding: 1px 4px;
      background: rgba(215, 58, 73, 0.1);
      border-radius: 3px;
      border: 1px solid rgba(215, 58, 73, 0.3);
    `;
    rejectSpan.textContent = "❌ Reject [Esc]";
    rejectSpan.onclick = (e) => this.reject(e, view);
    container.appendChild(rejectSpan);

    return container;
  }

  accept(e: MouseEvent, view: EditorView) {
    const config = view.state.facet(suggestionConfigFacet);
    if (!config.acceptOnClick) return;

    e.stopPropagation();
    e.preventDefault();

    const suggestion = view.state.field(InlineSuggestionState)?.suggestion;

    // If there is no suggestion, do nothing and let the default keymap handle it
    if (!suggestion) {
      return false;
    }

    view.dispatch({
      ...insertDiffText(view.state, suggestion.newText, suggestion),
    });
    return true;
  }

  reject(e: MouseEvent, view: EditorView) {
    e.stopPropagation();
    e.preventDefault();

    // Clear the suggestion
    view.dispatch({
      effects: InlineSuggestionEffect.of({
        suggestion: null,
        doc: view.state.doc,
      }),
    });
    return true;
  }
}

/**
 * Rendered by `renderInlineSuggestionPlugin`,
 * this creates multiple decoration widgets for the ranges
 * where changes occur in the document.
 */
function inlineSuggestionDecoration(suggestion: DiffSuggestion) {
  console.log("====oldText====");
  console.log(suggestion.oldText);
  console.log("====end oldText====");
  console.log("====newText====");
  console.log(suggestion.newText);
  console.log("====end newText====");

  const cursorMarker = "<|user_cursor_is_here|>";

  if (!suggestion.newText.includes(cursorMarker)) {
    console.log("No cursor marker found, skipping ghost text");
    return Decoration.none;
  }

  // Remove cursor marker from both texts to compute the actual diff
  const oldTextClean = suggestion.oldText.replace(cursorMarker, "");
  const newTextClean = suggestion.newText.replace(cursorMarker, "");
  console.log("====oldTextClean====");
  console.log(oldTextClean);
  console.log("====end oldTextClean====");
  console.log("====newTextClean====");
  console.log(newTextClean);
  console.log("====end newTextClean====");

  // Use diff library to compute precise changes
  const diffs = Diff.diffChars(oldTextClean, newTextClean);
  console.log(`====diffs (${diffs.length})====`);
  
  // Find cursor positions in both old and new text
  const oldCursorPosition = suggestion.oldText.indexOf(cursorMarker);
  const newCursorPosition = suggestion.newText.indexOf(cursorMarker);
  
  console.log(`Old cursor position: ${oldCursorPosition}, New cursor position: ${newCursorPosition}`);
  
  // Track positions in both old and new text as we process diffs
  let diffTextPos = 0;

  // Extract diff parts for ghost text rendering - only changes at cursor position
  const diffParts: DiffPart[] = [];
  let ghostText = "";
  
  for (const part of diffs) {
    console.log("oldCursorPosition", oldCursorPosition, "newCursorPosition", newCursorPosition);
    console.log("diffTextPos", diffTextPos);
    console.log("part", part);
    
    if (diffTextPos >= oldCursorPosition && (diffTextPos + part.value.length) <= newCursorPosition) {
      if (part.added) {
        diffParts.push({ text: part.value, type: 'added' });
      }
      if (part.removed) {
        diffParts.push({ text: part.value, type: 'removed' });
      }
      if (!part.added && !part.removed) {
        diffParts.push({ text: part.value, type: 'unchanged' });
      }
      diffTextPos += part.count;
      ghostText += part.value;
    }
  }
  console.log("====end diffs====");

  console.log(`Computed ghost text using diff: "${ghostText}"`);
  console.log(`Diff parts:`, diffParts);

  // Store the ghost text in the suggestion for use when accepting
  suggestion.ghostText = ghostText;

  // Only show ghost text if there's content to show
  if (diffParts.length === 0) {
    console.log("No ghost text needed - no diff parts to show");
    return Decoration.none;
  }

  // Position ghost text at the current cursor position
  const ghostStartPos = suggestion.to;

  const decorations = [
    Decoration.widget({
      widget: new GhostTextWidget(diffParts, suggestion),
      side: 1, // 1 means after the position
    }).range(ghostStartPos),

    Decoration.widget({
      widget: new AcceptIndicatorWidget(suggestion),
      side: 1, // 1 means after the position
    }).range(ghostStartPos),
  ];

  return Decoration.set(decorations);
}

export const suggestionConfigFacet = Facet.define<
  {
    acceptOnClick: boolean;
    fetchFn: InlineFetchFn;
    onEdit?: (
      oldDoc: string,
      newDoc: string,
      from: number,
      to: number,
      insert: string,
    ) => void;
  },
  {
    acceptOnClick: boolean;
    fetchFn: InlineFetchFn | undefined;
    onEdit?: (
      oldDoc: string,
      newDoc: string,
      from: number,
      to: number,
      insert: string,
    ) => void;
  }
>({
  combine(value) {
    return {
      acceptOnClick: !!value.at(-1)?.acceptOnClick,
      fetchFn: value.at(-1)?.fetchFn,
      onEdit: value.at(-1)?.onEdit,
    };
  },
});

/**
 * Listens to document updates and calls `fetchFn`
 * to fetch auto-suggestions. This relies on
 * `InlineSuggestionState` also being installed
 * in the editor's extensions.
 */
export const fetchSuggestion = ViewPlugin.fromClass(
  class Plugin {
    async update(update: ViewUpdate) {
      const doc = update.state.doc;
      // Only fetch if the document has changed
      if (!update.docChanged) {
        return;
      }

      const isAutocompleted = update.transactions.some((t) =>
        t.isUserEvent("input.complete"),
      );
      if (isAutocompleted) {
        return;
      }

      // Call onEdit callback if provided
      const config = update.view.state.facet(suggestionConfigFacet);
      if (config.onEdit) {
        for (const tr of update.transactions) {
          if (tr.docChanged) {
            const oldDoc = update.startState.doc.toString();
            const newDoc = update.state.doc.toString();

            // Find the changes in the transaction
            tr.changes.iterChanges((fromA, toA, _fromB, _toB, insert) => {
              config.onEdit!(oldDoc, newDoc, fromA, toA, insert.toString());
            });
          }
        }
      }

      if (!config.fetchFn) {
        console.error(
          "Unexpected issue in codemirror-copilot: fetchFn was not configured",
        );
        return;
      }

      const result = await config.fetchFn(update.state);

      // The result is now a DiffSuggestion object
      update.view.dispatch({
        effects: InlineSuggestionEffect.of({ suggestion: result, doc: doc }),
      });
    }
  },
);

const renderInlineSuggestionPlugin = ViewPlugin.fromClass(
  class Plugin {
    decorations: DecorationSet;
    constructor() {
      // Empty decorations
      this.decorations = Decoration.none;
    }
    update(update: ViewUpdate) {
      const suggestion = update.state.field(InlineSuggestionState)?.suggestion;
      if (!suggestion) {
        this.decorations = Decoration.none;
        return;
      }

      this.decorations = inlineSuggestionDecoration(suggestion);
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

/**
 * Attaches a keybinding on `Tab` that accepts
 * the suggestion if there is one.
 */
const inlineSuggestionKeymap = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (view) => {
        const suggestion = view.state.field(InlineSuggestionState)?.suggestion;

        // If there is no suggestion, do nothing and let the default keymap handle it
        if (!suggestion) {
          return false;
        }

        view.dispatch({
          ...insertDiffText(view.state, suggestion.newText, suggestion),
        });
        return true;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        const suggestion = view.state.field(InlineSuggestionState)?.suggestion;

        // If there is no suggestion, do nothing
        if (!suggestion) {
          return false;
        }

        // Clear the suggestion
        view.dispatch({
          effects: InlineSuggestionEffect.of({
            suggestion: null,
            doc: view.state.doc,
          }),
        });
        return true;
      },
    },
  ]),
);

function insertDiffText(
  state: EditorState,
  newText: string,
  suggestion?: DiffSuggestion,
): TransactionSpec {
  const cursorMarker = "<|user_cursor_is_here|>";
  const cursorMarkerWithNewline = "<|user_cursor_is_here|>\n";

  if (!suggestion?.ghostText || !newText.includes(cursorMarker)) {
    // Fallback to original behavior
    const cleanText = newText.replace(cursorMarkerWithNewline, "").replace(cursorMarker, "").trim();
    return {
      changes: { from: 0, to: state.doc.length, insert: cleanText },
      selection: EditorSelection.cursor(cleanText.length),
      userEvent: "input.complete",
    };
  }

  // Insert the ghost text at the current cursor position
  const insertText = suggestion.ghostText;
  const insertPosition = suggestion.to;

  // Calculate final cursor position relative to where we're inserting
  const finalCursorPosition = insertPosition + insertText.length;

  console.log(`Insert text: "${insertText}"`);
  console.log(`Final cursor position: ${finalCursorPosition}`);

  return {
    changes: { from: insertPosition, to: insertPosition, insert: insertText },
    selection: EditorSelection.cursor(finalCursorPosition),
    userEvent: "input.complete",
  };
}

/**
 * Options to configure the AI suggestion UI.
 */
type InlineSuggestionOptions = {
  fetchFn: InlineFetchFn;
  /**
   * Delay after typing to query the API. A shorter
   * delay will query more often, and cost more.
   */
  delay?: number;

  /**
   * Whether clicking the suggestion will
   * automatically accept it.
   */
  acceptOnClick?: boolean;

  /**
   * Callback called when an edit occurs, for tracking patches
   */
  onEdit?: (
    oldDoc: string,
    newDoc: string,
    from: number,
    to: number,
    insert: string,
  ) => void;
};

/**
 * Configure the UI, state, and keymap to power
 * auto suggestions.
 */
export function inlineSuggestion(options: InlineSuggestionOptions) {
  const { delay = 500, acceptOnClick = true, onEdit } = options;
  const fetchFn = debouncePromise(options.fetchFn, delay);
  return [
    suggestionConfigFacet.of({ acceptOnClick, fetchFn, onEdit }),
    InlineSuggestionState,
    fetchSuggestion,
    renderInlineSuggestionPlugin,
    inlineSuggestionKeymap,
  ];
}
