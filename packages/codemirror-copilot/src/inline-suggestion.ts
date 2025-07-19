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
  prefix: string;
  suffix: string;
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
 
function calculateChangeRanges(oldText: string, newText: string): Array<{ from: number; to: number; text: string }> {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  // Remove empty string at the end if present (happens when text ends with newline)
  if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') {
    oldLines.pop();
  }
  if (newLines.length > 0 && newLines[newLines.length - 1] === '') {
    newLines.pop();
  }
  console.log("oldLines", oldLines);
  console.log("newLines", newLines);
  const ranges: Array<{ from: number; to: number; text: string }> = [];
  
  let currentPos = 0;
  
  // Process lines that exist in both old and new text
  const minLines = Math.min(oldLines.length, newLines.length);
  console.log("minLines", minLines);
  console.log("oldLines", oldLines.length);
  console.log("newLines", newLines.length);

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
    
    // For additional lines, we should place them at the end of the current document
    // since the old text represents the current document state
    const insertPosition = oldText.length;
    
    ranges.push({
      from: insertPosition,
      to: insertPosition + additionalText.length,
      text: additionalText
    });
  }
  
  return ranges;
}
*/

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
function inlineSuggestionDecoration(suggestion: DiffSuggestion, _: EditorView) {
  console.log("=====suggestion oldText======")
  console.log(suggestion.oldText)
  console.log("=====end suggestion oldText======")
  console.log("=====suggestion newText======")
  console.log(suggestion.newText)
  console.log("=====end suggestion newText======")
  console.log("=====prefix======")
  console.log(suggestion.prefix)
  console.log("=====suffix======")
  console.log(suggestion.suffix)
  console.log("=====end prefix/suffix======\n\n")

  // Find the cursor position based on prefix length
  const cursorPos = suggestion.prefix.length;
  
  // Calculate what text should appear after the cursor
  const oldAfterCursor = suggestion.oldText.slice(cursorPos);
  const newAfterCursor = suggestion.newText.slice(cursorPos);
  
  console.log("=====cursor analysis======")
  console.log(`cursorPos: ${cursorPos}`)
  console.log(`oldAfterCursor: "${oldAfterCursor}"`)
  console.log(`newAfterCursor: "${newAfterCursor}"`)
  console.log("=====end cursor analysis======")

  const decorations = [];
  
  // Only show ghost text if there's new content after the cursor that differs from old content
  if (newAfterCursor !== oldAfterCursor && newAfterCursor.length > 0) {
    // The cursor is at the end of the prefix, which maps to suggestion.to in the document
    // since the prefix represents the content that's already been typed
    const ghostStartPos = suggestion.to;
    
    // For new content after cursor, we use a widget decoration (insertion, not replacement)
    // since we're adding new content beyond the existing text
    console.log(`Ghost text positioning: start=${ghostStartPos}`);
    console.log(`Ghost text content: "${newAfterCursor}"`);
    console.log(`Suggestion range: ${suggestion.from} to ${suggestion.to}`);
    
    // Create ghost text decoration as a widget (insertion) at the cursor position
    const ghostWidget = Decoration.widget({
      widget: new GhostTextWidget(newAfterCursor, suggestion),
      side: 1  // 1 means after the position
    });
    decorations.push(ghostWidget.range(ghostStartPos));
    
    // Add accept/reject button after the ghost text
    const acceptWidget = Decoration.widget({
      widget: new AcceptIndicatorWidget(suggestion),
      side: 1  // 1 means after the position
    });
    decorations.push(acceptWidget.range(ghostStartPos));
  } else {
    console.log("No ghost text needed - content after cursor is same or new content is empty");
  }
  
  console.log("Final decorations:");
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
