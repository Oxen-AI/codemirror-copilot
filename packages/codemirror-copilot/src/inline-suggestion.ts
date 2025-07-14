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
  from: number;
  to: number;
}

/**
 * Current state of the autosuggestion
 */
const InlineSuggestionState = StateField.define<{ suggestion: null | DiffSuggestion }>({
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
 * Calculate the specific ranges where changes occur between old and new text
 */
function calculateChangeRanges(oldText: string, newText: string, docLength: number): Array<{ from: number; to: number; text: string }> {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const ranges: Array<{ from: number; to: number; text: string }> = [];
  
  let currentPos = 0;
  
  // Process lines that exist in both old and new text
  const minLines = Math.min(oldLines.length, newLines.length);
  for (let i = 0; i < minLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    
    if (oldLine !== newLine) {
      const lineStart = currentPos;
      const lineEnd = lineStart + oldLine.length;
      
      ranges.push({
        from: lineStart,
        to: lineEnd,
        text: newLine
      });
    }
    
    currentPos += oldLine.length + 1; // +1 for newline character
  }
  
  // Handle additional lines in new text beyond the old text
  if (newLines.length > oldLines.length) {
    const additionalLines = newLines.slice(oldLines.length);
    const additionalText = additionalLines.join('\n');
    
    // If the current position is beyond document length, place at end
    if (currentPos >= docLength) {
      ranges.push({
        from: docLength,
        to: docLength + additionalText.length,
        text: additionalText
      });
    } else {
      // Place at current position
      ranges.push({
        from: currentPos,
        to: currentPos + additionalText.length,
        text: additionalText
      });
    }
  }
  
  return ranges;
}

/**
 * Widget for displaying ghost text inline
 */
class GhostTextWidget extends WidgetType {
  text: string;
  suggestion: DiffSuggestion;
  
  constructor(text: string, suggestion: DiffSuggestion) {
    super();
    this.text = text;
    this.suggestion = suggestion;
  }
  
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.style.cssText = `
      color: #007acc;
      opacity: 0.6;
      font-style: italic;
      background: rgba(0, 122, 204, 0.1);
      border-radius: 2px;
      padding: 1px 2px;
      cursor: pointer;
    `;
    span.textContent = this.text;
    span.onclick = (e) => this.accept(e, view);
    return span;
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
      ...insertDiffText(
        view.state,
        suggestion.newText,
      ),
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
      ...insertDiffText(
        view.state,
        suggestion.newText,
      ),
    });
    return true;
  }
  
  reject(e: MouseEvent, view: EditorView) {
    e.stopPropagation();
    e.preventDefault();

    // Clear the suggestion
    view.dispatch({
      effects: InlineSuggestionEffect.of({ suggestion: null, doc: view.state.doc }),
    });
    return true;
  }
}

/**
 * Rendered by `renderInlineSuggestionPlugin`,
 * this creates multiple decoration widgets for the ranges
 * where changes occur in the document.
 */
function inlineSuggestionDecoration(suggestion: DiffSuggestion, view: EditorView) {
  console.log("=====suggestion oldText======")
  console.log(suggestion.oldText)
  console.log("=====end suggestion oldText======")
  console.log("=====suggestion newText======")
  console.log(suggestion.newText)
  console.log("=====end suggestion newText======\n\n")

  const changeRanges = calculateChangeRanges(suggestion.oldText, suggestion.newText, view.state.doc.length);
  
  console.log("=====change ranges======")
  for (const range of changeRanges) {
    // print range.from and range.to and range.text in a single line
    console.log(`from: ${range.from}, to: ${range.to}, text: ${range.text}`)
  }
  console.log("=====end change ranges======")

  const decorations = [];
  // const docLength = view.state.doc.length;
  let lastRangeEnd = 0;

  // Create all decorations and sort them by position
  for (const range of changeRanges) {
    // Validate that the range is within document bounds
    const from = range.from; // Math.max(0, Math.min(range.from, docLength));
    const to = range.to; // Math.max(from, Math.min(range.to, docLength));
    
    console.log(`Processing range: from=${from}, to=${to}, text="${range.text}"`);
    
    if (from < to) {
      // Track the end of the last range for placing the accept indicator
      lastRangeEnd = Math.max(lastRangeEnd, to);
      console.log(`Updated lastRangeEnd to: ${lastRangeEnd}`);
      
      // Add ghost text decoration
      const ghostWidget = Decoration.replace({
        widget: new GhostTextWidget(range.text, suggestion),
        inclusiveStart: false,
        inclusiveEnd: false
      });
      decorations.push(ghostWidget.range(from, to));
    }
  }

  console.log("=====lastRangeEnd======")
  console.log(lastRangeEnd)
  console.log("=====end lastRangeEnd======")

  // Add accept/reject button at the end of the last range
  console.log(`Adding AcceptIndicatorWidget at position: ${lastRangeEnd}`);
  
  // Place the widget after the last ghost text range
  let widgetPosition = lastRangeEnd;
  if (lastRangeEnd > 0) {
    widgetPosition = lastRangeEnd;
    console.log(`Final widget position: ${widgetPosition} (doc length: ${view.state.doc.length})`);
    const acceptWidget = Decoration.widget({
      widget: new AcceptIndicatorWidget(suggestion),
      side: 1  // 1 means after the position
    });
    decorations.push(acceptWidget.range(widgetPosition));
  }

  // Sort decorations by their from position to ensure they're in order
  decorations.sort((a, b) => {
    const aFrom = a.from;
    const bFrom = b.from;
    return aFrom - bFrom;
  });
  
  console.log("Final sorted decorations:");
  for (const decoration of decorations) {
    console.log(`Decoration: from=${decoration.from}, to=${decoration.to}`);
  }
  
  return Decoration.set(decorations);
}

export const suggestionConfigFacet = Facet.define<
  { acceptOnClick: boolean; fetchFn: InlineFetchFn; onEdit?: (oldDoc: string, newDoc: string, from: number, to: number, insert: string) => void },
  { acceptOnClick: boolean; fetchFn: InlineFetchFn | undefined; onEdit?: (oldDoc: string, newDoc: string, from: number, to: number, insert: string) => void }
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
      
      this.decorations = inlineSuggestionDecoration(
        suggestion,
        update.view,
      );
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
          ...insertDiffText(
            view.state,
            suggestion.newText,
          ),
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
          effects: InlineSuggestionEffect.of({ suggestion: null, doc: view.state.doc }),
        });
        return true;
      },
    },
  ]),
);

function insertDiffText(
  state: EditorState,
  text: string,
): TransactionSpec {
  // Replace the entire document, ensuring no extra newlines
  const cleanText = text.trim();
  return {
    changes: { from: 0, to: state.doc.length, insert: cleanText },
    selection: EditorSelection.cursor(cleanText.length),
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
    insert: string
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
