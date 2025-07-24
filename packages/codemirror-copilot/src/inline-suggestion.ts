import {
  ViewPlugin,
  EditorView,
  ViewUpdate,
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
export interface DiffSuggestion {
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

  return {
    added: added.join("\n"),
    removed: removed.join("\n"),
  };
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
    overlay: HTMLElement | null = null;
    
    constructor() {
      this.overlay = null;
    }
    
    update(update: ViewUpdate) {
      const suggestion = update.state.field(InlineSuggestionState)?.suggestion;
      
      if (!suggestion) {
        this.hideOverlay();
        return;
      }

      // Defer positioning to avoid "Reading the editor layout isn't allowed during an update" error
      setTimeout(() => {
        this.showOverlay(suggestion, update.view);
      }, 0);
    }
    
    hideOverlay() {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
    }
    
    showOverlay(suggestion: DiffSuggestion, view: EditorView) {
      this.hideOverlay();
      
      // Create the suggestion content
      const diff = calculateDiff(suggestion.oldText, suggestion.newText);
      
      // Check if there are any actual changes in the diff
      if (!diff.added && !diff.removed) {
        // No changes detected, don't show the overlay
        return;
      }
      
      // Create overlay element
      this.overlay = document.createElement("div");
      this.overlay.className = "cm-floating-suggestion-overlay";
      this.overlay.style.cssText = `
        position: fixed;
        z-index: 9999;
        opacity: 0.95;
        background: white;
        border-radius: 8px;
        padding: 12px 16px;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 0.9em;
        border: 1px solid #e1e4e8;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        max-width: 400px;
        min-width: 200px;
        overflow-x: auto;
        pointer-events: auto;
        transform: translateY(-50%);
        white-space: nowrap;
      `;
      
      // Add header
      const header = document.createElement("div");
      header.style.cssText =
        "font-size: 0.8em; color: #007acc; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;";
      header.textContent = "💡 Tab Tab Suggestion";
      this.overlay.appendChild(header);
      
      // Add diff content
      if (diff.removed) {
        const removedSpan = document.createElement("div");
        removedSpan.style.cssText =
          "color: #d73a49; margin-bottom: 6px; font-family: monospace; white-space: pre; background: rgba(215, 58, 73, 0.1); padding: 4px 6px; border-radius: 4px; border-left: 3px solid #d73a49;";
        removedSpan.textContent = diff.removed;
        this.overlay.appendChild(removedSpan);
      }
      
      if (diff.added) {
        const addedSpan = document.createElement("div");
        addedSpan.style.cssText =
          "color: #28a745; font-family: monospace; white-space: pre; background: rgba(40, 167, 69, 0.1); padding: 4px 6px; border-radius: 4px; border-left: 3px solid #28a745;";
        addedSpan.textContent = diff.added;
        this.overlay.appendChild(addedSpan);
      }
      
      // Add hint
      const hint = document.createElement("div");
      hint.style.cssText =
        "font-size: 0.75em; color: #666; margin-top: 8px; font-style: italic; border-top: 1px solid #e1e4e8; padding-top: 6px;";
      hint.textContent = "Click to accept • Tab to accept • Esc to dismiss";
      this.overlay.appendChild(hint);
      
      // Add click handler
      this.overlay.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const config = view.state.facet(suggestionConfigFacet);
        if (config.acceptOnClick) {
          view.dispatch({
            ...insertDiffText(view.state, suggestion.newText),
          });
        }
      };
      
      // Position the overlay near the cursor
      this.positionOverlay(view);
      
      // Add to document body to ensure it floats above everything
      document.body.appendChild(this.overlay);
    }
    
    positionOverlay(view: EditorView) {
      if (!this.overlay) return;
      
      const cursorPos = view.state.selection.main.head;
      const coords = view.coordsAtPos(cursorPos);
      
      if (coords) {
        // Use coordinates directly for fixed positioning
        const relativeCoords = {
          left: coords.left,
          right: coords.right,
          top: coords.top,
          bottom: coords.bottom
        };
        
        // Position to the right of the cursor
        this.overlay.style.left = `${relativeCoords.right + 10}px`;
        this.overlay.style.top = `${relativeCoords.top}px`;
        
        // Ensure the overlay doesn't go off-screen
        setTimeout(() => {
          if (!this.overlay) return;
          const overlayRect = this.overlay.getBoundingClientRect();
          
          // Check if overlay would go off the right edge
          if (overlayRect.right > window.innerWidth - 20) {
            this.overlay.style.left = `${relativeCoords.left - overlayRect.width - 10}px`;
          }
          
          // Check if overlay would go off the bottom edge
          if (overlayRect.bottom > window.innerHeight - 20) {
            this.overlay.style.top = `${relativeCoords.top - overlayRect.height - 10}px`;
          }
        }, 0);
      }
    }
    
    destroy() {
      this.hideOverlay();
    }
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
