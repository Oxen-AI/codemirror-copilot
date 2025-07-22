import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { dracula } from "@uiw/codemirror-theme-dracula";

import { inlineCopilot, clearLocalCache, getLastEditPatch } from "../dist";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

// const DEFAULTCODE = `def add(num1, num2):
//   return`;

const DEFAULTCODE = `import pandas as pd

# read csv file
df = pd.read_csv("data.csv")`;


function CodeEditor() {
  
  const [lastPrediction, setLastPrediction] = useState("");
  return (
    <>
      <CodeMirror
        style={{
          fontSize: "17px",
          width: "100%",
          borderRadius: "5px",
          overflow: "hidden",
          marginTop: "1rem",
        }}
        value={DEFAULTCODE}
        height="300px"
        width="100%"
        basicSetup={{
          autocompletion: false,
          lineNumbers: true,
        }}
        theme={dracula}
        extensions={[
          python(),
          inlineCopilot(
            async (prefix, suffix) => {
              const res = await fetch("/api/autocomplete", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  prefix,
                  suffix,
                  model: "oxen:ox-wonderful-pink-swordtail",
                }),
              });

              const { prediction } = await res.json();
              setLastPrediction(prediction);
              return prediction;
            },
            500,
          ),
        ]}
      />
      
      {lastPrediction && (
        <div className="mt-4 pt-4 p-3 bg-gray-800 rounded border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Last Prediction:</h3>
          <div className="text-xs font-mono">
            <pre>{lastPrediction}</pre>
          </div>
        </div>
      )}
    </>
  );
}

export default CodeEditor;

