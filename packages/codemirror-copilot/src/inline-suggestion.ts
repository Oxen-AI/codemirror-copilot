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
import { diffLines } from "diff";

/**
 * The inner method to fetch suggestions: this is
 * abstracted by `inlineCopilot`.
 */
type InlineFetchFn = (state: EditorState) => Promise<DiffSuggestion>;

/**
 * Represents a diff suggestion with old and new text
 */
interface DiffSuggestion {
  oldText: string;
  newText: string;
  from: number;
  to: number;
  replaceEntireDocument?: boolean; // New flag to indicate full document replacement
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
 * Calculate diff using the diff library to highlight changes
 */
function calculateDiff(
  oldText: string,
  newText: string,
): { added: string; removed: string } {
  // Strip cursor marker from newText for diff display
  const cleanNewText = newText.replace(/<\|user_cursor_is_here\|>/g, "");
  
  // Use the diff library to calculate line-based differences
  const diffResult = diffLines(oldText, cleanNewText, {
    newlineIsToken: true,
    ignoreWhitespace: false,
  });

  const added: string[] = [];
  const removed: string[] = [];

  diffResult.forEach((part) => {
    if (part.added) {
      // Show added lines with green color
      const lines = part.value.split('\n').filter(line => line.length > 0);
      lines.forEach(line => added.push(`+ ${line}`));
    } else if (part.removed) {
      // Show removed lines with red color
      const lines = part.value.split('\n').filter(line => line.length > 0);
      lines.forEach(line => removed.push(`- ${line}`));
    }
  });

  // If no changes, show a simple replacement message
  if (added.length === 0 && removed.length === 0) {
    return {
      added: `→ ${cleanNewText.trim()}`,
      removed: "",
    };
  }

  return {
    added: added.join("\n"),
    removed: removed.join("\n"),
  };
}

/**
 * Rendered by `renderInlineSuggestionPlugin`,
 * this creates possibly multiple lines of ghostly
 * text to show what would be inserted if you accept
 * the AI suggestion.
 */
function inlineSuggestionDecoration(suggestion: DiffSuggestion, state: EditorState) {
  const widgets = [];

  // Create decoration for the diff display
  const w = Decoration.widget({
    widget: new InlineSuggestionWidget(suggestion),
    side: -1, // Place before the line content
  });

  // Get the current cursor position
  const cursorPos = state.selection.main.head;
  
  // Find the start of the line containing the cursor
  const line = state.doc.lineAt(cursorPos);
  const lineStart = line.from;
  
  // Position the widget at the start of the current line
  widgets.push(w.range(lineStart));

  return Decoration.set(widgets);
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
 * Renders the suggestion inline
 * with the rest of the code in the editor.
 */
class InlineSuggestionWidget extends WidgetType {
  suggestion: DiffSuggestion;

  /**
   * Create a new suggestion widget.
   */
  constructor(suggestion: DiffSuggestion) {
    super();
    this.suggestion = suggestion;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-inline-suggestion";
    container.style.cssText = `
      opacity: 0.8;
      background: rgba(0, 0, 0, 0.08);
      border-radius: 6px;
      padding: 8px 12px;
      margin: 4px 0;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 0.9em;
      border-left: 4px solid #007acc;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      max-width: 100%;
      overflow-x: auto;
    `;

    const diff = calculateDiff(
      this.suggestion.oldText,
      this.suggestion.newText,
    );

    // Add a header to indicate this is a suggestion
    const header = document.createElement("div");
    header.style.cssText =
      "font-size: 0.8em; color: #007acc; margin-bottom: 4px; font-weight: 500;";
    header.textContent = "💡 AI Suggestion";
    container.appendChild(header);

    if (diff.removed) {
      const removedSpan = document.createElement("div");
      removedSpan.style.cssText =
        "color: #d73a49; margin-bottom: 4px; font-family: monospace; white-space: pre;";
      removedSpan.textContent = diff.removed;
      container.appendChild(removedSpan);
    }

    if (diff.added) {
      const addedSpan = document.createElement("div");
      addedSpan.style.cssText =
        "color: #28a745; font-family: monospace; white-space: pre;";
      addedSpan.textContent = diff.added;
      container.appendChild(addedSpan);
    }

    // Add a hint about how to accept
    const hint = document.createElement("div");
    hint.style.cssText =
      "font-size: 0.75em; color: #666; margin-top: 4px; font-style: italic;";
    hint.textContent = "Click to accept • Tab to accept • Esc to dismiss";
    container.appendChild(hint);

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
      ...insertDiffText(view.state, suggestion.newText),
    });
    return true;
  }
}

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

      this.decorations = inlineSuggestionDecoration(suggestion, update.state);
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
          ...insertDiffText(view.state, suggestion.newText),
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

function insertDiffText(state: EditorState, text: string): TransactionSpec {
  // Handle cursor positioning with marker
  const cursorMarker = "<|user_cursor_is_here|>";
  const cursorIndex = text.indexOf(cursorMarker);
  
  // Remove the cursor marker from the text
  const cleanText = text.replace(cursorMarker, "").trim();
  
  // Calculate cursor position
  let cursorPosition: number;
  if (cursorIndex !== -1) {
    // If marker was found, position cursor at that location (accounting for removed marker)
    cursorPosition = cursorIndex;
  } else {
    // If no marker, position cursor at the end
    cursorPosition = cleanText.length;
  }
  
  return {
    changes: { from: 0, to: state.doc.length, insert: cleanText },
    selection: EditorSelection.cursor(cursorPosition),
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
