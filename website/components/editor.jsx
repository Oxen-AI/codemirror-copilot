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
df = pd.read_
`;

// const DEFAULTCODE = `import pandas as pd
// file_path = "data.parquet"
// df = pd.read_parquet(file_path)

// # save to csv`;

function CodeEditor() {
  const [model, setModel] = useState("baseten:dgonz-flexible-coffee-harrier");
  const [acceptOnClick, setAcceptOnClick] = useState(true);
  const [lastPrediction, setLastPrediction] = useState(DEFAULTCODE);
  const [lastCode, setLastCode] = useState(DEFAULTCODE);
  const [lastPrompt, setLastPrompt] = useState("");
  const [saveMessage, setSaveMessage] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  const saveExample = async (status) => {
    if (!lastPrompt || !lastPrediction) return;
    
    setSaveMessage(null);
    setSaveStatus(null);
    
    try {
      const response = await fetch("/api/save-example", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: lastPrompt,
          response: lastPrediction,
          accepted: status,
        }),
      });

      if (response.ok) {
        setSaveStatus("success");
        const statusMessages = {
          "accepted": "accepted",
          "rejected": "rejected", 
          "needs_edit": "marked for editing"
        };
        setSaveMessage(`Example ${statusMessages[status]} and saved successfully!`);
      } else {
        const errorData = await response.json();
        setSaveStatus("error");
        setSaveMessage(`Error: ${errorData.error || "Failed to save example"}`);
      }
    } catch (error) {
      console.error("Error saving example:", error);
      setSaveStatus("error");
      setSaveMessage("Network error: Could not save example");
    }

    // Clear message after 3 seconds
    setTimeout(() => {
      setSaveMessage(null);
      setSaveStatus(null);
    }, 3000);
  };
  
  return (
    <>
      <Select
        value={model}
        onValueChange={(value) => {
          setModel(value);
          clearLocalCache();
        }}
      >
        <SelectTrigger className="w-[280px]">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="baseten:dgonz-flexible-coffee-harrier">
            Fine-Tuned Llama 3.2-1B-Instruct
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

              const { prediction, prompt } = await res.json();

              // Remove special tokens <|editable_region_start|>, <|user_cursor_is_here|>, <|editable_region_end|> and any trailing newlines
              const code = prediction.replace(/<\|editable_region_start\|>\n?|<\|user_cursor_is_here\|>\n?|<\|editable_region_end\|>\n?/g, '');

              setLastCode(code);
              setLastPrediction(prediction);
              setLastPrompt(prompt);
              return code;
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
      
      {lastPrompt && (
        <div className="mt-4 pt-4 p-3 bg-gray-800 rounded border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Last Prompt:</h3>
          <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap mb-4">
            {lastPrompt}
          </pre>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Last Prediction:</h3>
          <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">
            {lastPrediction}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => saveExample("accepted")}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded border border-green-500"
            >
              ✓ Good Example
            </button>
            <button
              onClick={() => saveExample("rejected")}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded border border-red-500"
            >
              ✗ Bad Example
            </button>
            <button
              onClick={() => saveExample("needs_edit")}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded border border-orange-500"
            >
              ✏️ Edit Me
            </button>
          </div>
          {saveMessage && (
            <div className={`mt-2 p-2 rounded text-sm ${
              saveStatus === "success" 
                ? "bg-green-800 text-green-200 border border-green-600" 
                : "bg-red-800 text-red-200 border border-red-600"
            }`}>
              {saveMessage}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default CodeEditor;

