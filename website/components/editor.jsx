import dynamic from "next/dynamic";
import { python } from "@codemirror/lang-python";
import { dracula } from "@uiw/codemirror-theme-dracula";

import { inlineCopilot, clearLocalCache, calculateDiff } from "../dist";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

// Dynamically import CodeMirror to avoid SSR issues
const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[300px] bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center">
      <div className="text-gray-500 dark:text-gray-400">Loading editor...</div>
    </div>
  ),
});

// const DEFAULTCODE = `def add(num1, num2):
//   return`;

const DEFAULTCODE = `import pandas as pd
file_path = "data.parq"
df = pd.read`;

function CodeEditor() {
  const [model, setModel] = useState("baseten:dgonz-flexible-coffee-harrier");
  const [acceptOnClick, setAcceptOnClick] = useState(true);
  const [lastPrediction, setLastPrediction] = useState(DEFAULTCODE);
  const [lastPatch, setLastPatch] = useState(null);
  
  return (
    <>
      <Select
        value={model}
        onValueChange={(value) => {
          setModel(value);
          clearLocalCache();
        }}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="baseten:dgonz-flexible-coffee-harrier">
            Baseten:dgonz-flexible-coffee-harrier
          </SelectItem>
          <SelectItem value="gpt-3.5-turbo-1106">
            GPT 3.5 Turbo <Badge variant="secondary">recommended</Badge>
          </SelectItem>
          <SelectItem value="codellama-34b-instruct">
            Code Llama 34B Instruct <Badge variant="secondary">great</Badge>
          </SelectItem>
          <SelectItem value="codellama-70b-instruct">
            Code Llama 70B Instruct <Badge variant="secondary">buggy</Badge>
          </SelectItem>
          <SelectItem value="gpt-4-1106-preview">
            GPT-4 Turbo <Badge variant="destructive">expensive</Badge>
          </SelectItem>
        </SelectContent>
      </Select>
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
              setLastPatch(patch);
              return prediction;
            },
            500,
            acceptOnClick,
          ),
        ]}
      />
      <div className="pt-2">
        <label className="flex items-center gap-2">
          <input
            checked={acceptOnClick}
            onChange={(e) => {
              setAcceptOnClick(e.target.checked);
            }}
            type="checkbox"
            name="click"
          />
          Clickable suggestions
        </label>
      </div>
      
      {lastPrediction && (
        <div className="mt-4 pt-4 p-3 bg-gray-800 rounded border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Last Prediction:</h3>
          <pre className="text-xs font-mono">
            {lastPrediction}
          </pre>
        </div>
      )}
      
      {lastPatch && (
        <div className="mt-4 pt-4 p-3 bg-gray-800 rounded border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Last Patch:</h3>
          <pre className="text-xs font-mono">
            {JSON.stringify(lastPatch, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}

export default CodeEditor;

