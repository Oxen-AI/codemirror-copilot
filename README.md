# Oxen.ai's codemirror-copilot

This code was forked from [codemirror-copilot](https://github.com/asadm/codemirror-copilot/tree/main) and modified to use our fine-tuned llm.

Demo: https://x.com/gregschoeninger/status/1944590627829911821

## Usage

```javascript
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { inlineCopilot } from "codemirror-copilot";

function CodeEditor() {
  return (
    <CodeMirror
      value=""
      height="300px"
      extensions={[
          python(),
          inlineCopilot(
          async (prefix, suffix, patch) => {
            const res = await fetch("/api/autocomplete", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prefix,
                suffix,
                language: "python",
                model,
                lastPrediction: lastPrediction,
                lastPatch: patch,
              }),
            });

            const { prediction } = await res.json();
            setLastPrediction(prediction);
            return prediction;
          },
          500,
          acceptOnClick,
        ),
      ]}
    />
  );
}
```

## Local Development

In one terminal, build the library itself by running:

```bash
cd packages/codemirror-copilot
npm install
npm run dev
```

In another terminal, run the demo website:

```bash
cd website
npm install
npm run dev
```

## Acknowledgements

This code is based on [codemirror-copilot](https://github.com/asadm/codemirror-copilot/tree/main) by Asad Memon.

