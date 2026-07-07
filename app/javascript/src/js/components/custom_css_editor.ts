import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
} from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";

// Insert four literal spaces on Tab so indentation is always 4-space,
// regardless of the CSS language mode's smart-indent defaults.
// This keymap is placed before defaultKeymap to take priority over insertTab.
const tabInsertsFourSpaces = keymap.of([
  {
    key: "Tab",
    run (view) {
      view.dispatch(view.state.replaceSelection("    "));
      return true;
    },
  },
]);

// Stop keydown/keyup from bubbling to document so e621ng's W/S page-scroll
// hotkeys do not fire while the user types inside the editor.
const suppressHotkeys = EditorView.domEventHandlers({
  keydown (event) { event.stopPropagation(); },
  keyup (event) { event.stopPropagation(); },
});

// Focus the editor on any mousedown inside the visible editor area, including
// empty space below the last line of code. Without this, clicks in the blank
// area below existing lines do not move focus into CodeMirror.
const focusEditorOnBackgroundClick = EditorView.domEventHandlers({
  mousedown (event, view) {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    if (view.dom.contains(target)) {
      view.focus();
    }
    return false;
  },
});

// Light editor theme — styled to match a standard textarea (light background,
// dark text). Syntax token colors come from defaultHighlightStyle, which is
// calibrated for light backgrounds.
const lightEditorTheme = EditorView.theme({
  "&": {
    fontSize: "1rem",
    backgroundColor: "#fafafa",
    color: "#1f1f1f",
  },
  ".cm-scroller": {
    fontFamily: "monospace",
  },
  ".cm-content": {
    caretColor: "#333",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#333",
  },
  ".cm-selectionBackground": {
    backgroundColor: "#add6ff",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "#add6ff",
  },
  ".cm-gutters": {
    backgroundColor: "#f3f3f3",
    color: "#747474",
    border: "none",
    borderRight: "1px solid #ddd",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e8e8e8",
  },
  ".cm-activeLine": {
    backgroundColor: "#f0f0f0",
  },
  "&.cm-focused": { outline: "none" },
});

function buildEditor (textarea: HTMLTextAreaElement): EditorView {
  const view = new EditorView({
    doc: textarea.value,
    extensions: [
      tabInsertsFourSpaces,
      suppressHotkeys,
      focusEditorOnBackgroundClick,
      lightEditorTheme,
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      highlightActiveLine(),
      drawSelection(),
      dropCursor(),
      bracketMatching(),
      indentOnInput(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxHighlighting(defaultHighlightStyle),
      css(),
      EditorView.lineWrapping,
    ],
  });

  textarea.insertAdjacentElement("beforebegin", view.dom);
  textarea.style.display = "none";

  // Sync editor content back into the hidden textarea before the form submits.
  // capture: true ensures this runs before Rails UJS serialises the form.
  const form = textarea.closest("form");
  form?.addEventListener("submit", () => {
    textarea.value = view.state.doc.toString();
  }, { capture: true });

  return view;
}

export function initCustomCSSEditor (): void {
  const textarea = document.getElementById("user_custom_style") as HTMLTextAreaElement | null;
  if (!textarea) return;

  const entry = textarea.closest("tab-entry");
  if (!entry) return;

  let view: EditorView | null = null;

  // Defer editor creation/re-measurement one animation frame after the
  // .active class is added so the browser has recalculated layout and
  // CodeMirror can measure its container correctly.
  function onVisible () {
    window.requestAnimationFrame(() => {
      // Guard: user may have switched away during the frame delay
      if (!entry!.classList.contains("active")) return;

      if (!view) {
        view = buildEditor(textarea!);
      } else {
        // Re-measure after being hidden and shown again (tab switch)
        view.requestMeasure();
      }
    });
  }

  // Watch for the customization tab-entry gaining the .active class
  const obs = new MutationObserver(() => {
    if (entry!.classList.contains("active")) onVisible();
  });
  obs.observe(entry, { attributes: true, attributeFilter: ["class"] });

  // Initialize immediately if the Advanced tab is already active on page load
  if (entry.classList.contains("active")) onVisible();
}
