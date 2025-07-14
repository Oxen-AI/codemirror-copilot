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
 * Simple diff calculation to highlight changes
 
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
 * Calculate the specific ranges where changes occur between old and new text
 */
function calculateChangeRanges(oldText: string, newText: string): Array<{ from: number; to: number; text: string }> {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const ranges: Array<{ from: number; to: number; text: string }> = [];
  
  let currentPos = 0;
  
  // Process existing lines (up to the length of old text)
  for (let i = 0; i < oldLines.length; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i] || '';
    
    if (oldLine !== newLine) {
      // Calculate the position where this line starts
      const lineStart = currentPos;
      const lineEnd = lineStart + oldLine.length;
      
      if (newLine) {
        // Add ghost text for the new line
        ranges.push({
          from: lineStart,
          to: lineEnd,
          text: newLine
        });
      }
    }
    
    // Move to next line position (account for the newline character)
    currentPos += oldLine.length;
    if (i < oldLines.length - 1) {
      currentPos += 1; // +1 for newline character
    }
  }
  
  // Handle additional lines in new text beyond the old text
  if (newLines.length > oldLines.length) {
    // Calculate the position at the end of the old text
    const endOfOldText = currentPos;
    
    // Get all the additional lines from new text
    const additionalLines = newLines.slice(oldLines.length);
    const additionalText = additionalLines.join('\n');
    
    if (additionalText) {
      // Add one large completion block for all additional content
      ranges.push({
        from: endOfOldText,
        to: endOfOldText,
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
        suggestion.from,
        suggestion.to,
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
        suggestion.from,
        suggestion.to,
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

  const changeRanges = calculateChangeRanges(suggestion.oldText, suggestion.newText);
  
  console.log("=====change ranges======")
  for (const range of changeRanges) {
    console.log(range)
  }
  console.log("=====end change ranges======")

  const decorations = [];
  const docLength = view.state.doc.length;
  let lastRangeEnd = 0;

  // Create all decorations and sort them by position
  for (const range of changeRanges) {
    // Validate that the range is within document bounds
    const from = Math.max(0, Math.min(range.from, docLength));
    const to = Math.max(from, Math.min(range.to, docLength));
    
    if (from < to) {
      // Track the end of the last range for placing the accept indicator
      lastRangeEnd = Math.max(lastRangeEnd, to);
      
      // Add ghost text decoration
      const ghostWidget = Decoration.replace({
        widget: new GhostTextWidget(range.text, suggestion),
        inclusiveStart: false,
        inclusiveEnd: false
      });
      decorations.push(ghostWidget.range(from, to));
    }
  }

  // Add accept/reject button at the end of the last range
  if (lastRangeEnd > 0) {
    const acceptWidget = Decoration.widget({
      widget: new AcceptIndicatorWidget(suggestion),
      side: 1  // 1 means after the position
    });
    decorations.push(acceptWidget.range(lastRangeEnd));
  }

  // Sort decorations by their from position to ensure they're in order
  decorations.sort((a, b) => {
    const aFrom = a.from;
    const bFrom = b.from;
    return aFrom - bFrom;
  });
  
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
 * Renders the suggestion inline
 * with the rest of the code in the editor.
 */

/*
class InlineSuggestionWidget extends WidgetType {
  suggestion: DiffSuggestion;

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
    
    const diff = calculateDiff(this.suggestion.oldText, this.suggestion.newText);
    
    // Add a header to indicate this is a suggestion
    const header = document.createElement("div");
    header.style.cssText = "font-size: 0.8em; color: #007acc; margin-bottom: 4px; font-weight: 500;";
    header.textContent = "💡 AI Suggestion";
    container.appendChild(header);
    
    if (diff.removed) {
      const removedSpan = document.createElement("div");
      removedSpan.style.cssText = "color: #d73a49; margin-bottom: 4px; font-family: monospace; white-space: pre;";
      removedSpan.textContent = diff.removed;
      container.appendChild(removedSpan);
    }
    
    if (diff.added) {
      const addedSpan = document.createElement("div");
      addedSpan.style.cssText = "color: #28a745; font-family: monospace; white-space: pre;";
      addedSpan.textContent = diff.added;
      container.appendChild(addedSpan);
    }
    
    // Add a hint about how to accept
    const hint = document.createElement("div");
    hint.style.cssText = "font-size: 0.75em; color: #666; margin-top: 4px; font-style: italic;";
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
      ...insertDiffText(
        view.state,
        suggestion.newText,
        suggestion.from,
        suggestion.to,
      ),
    });
    return true;
  }
}
*/

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
            suggestion.from,
            suggestion.to,
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
  from: number,
  to: number,
): TransactionSpec {
  // Replace the entire document
  if (true) {
    // Replace the entire document, ensuring no extra newlines
    const cleanText = text.trim();
    return {
      changes: { from: 0, to: state.doc.length, insert: cleanText },
      selection: EditorSelection.cursor(cleanText.length),
      userEvent: "input.complete",
    };
  }
  
  // Original behavior for partial replacement
  return {
    ...state.changeByRange((range) => {
      if (range == state.selection.main)
        return {
          changes: { from: from, to: to, insert: text },
          range: EditorSelection.cursor(from + text.length),
        };
      const len = to - from;
      if (
        !range.empty ||
        (len &&
          state.sliceDoc(range.from - len, range.from) !=
            state.sliceDoc(from, to))
      )
        return { range };
      return {
        changes: { from: range.from - len, to: range.from, insert: text },
        range: EditorSelection.cursor(range.from - len + text.length),
      };
    }),
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
