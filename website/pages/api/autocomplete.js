import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OXEN_API_KEY,
  baseURL: "https://hub.oxen.ai/api",
});

async function completionOpenAI(prefix, suffix, lastPrediction, model="baseten:dgonz-flexible-coffee-harrier", language, lastPatch) {
  let prompt = `You are a code completion assistant and your task is to analyze user edits and then rewrite the marked region, taking into account the cursor location.

Last Edit:
${lastPatch ? `${lastPatch.contextBefore ? lastPatch.contextBefore.map(line => `   ${line}`).join('\n') + '\n' : ''}   ${lastPatch.original}
   ${lastPatch.modified}
${lastPatch.contextAfter ? '\n' + lastPatch.contextAfter.map(line => `   ${line}`).join('\n') : ''}` : ''}

Context:
<|editable_region_start|>
${prefix}<|user_cursor_is_here|>${suffix}
<|editable_region_end|>
`;

  const chatCompletion = await openai.chat.completions.create({
    messages: [
      { 
        role: "user", 
        content: prompt
      },
    ],
    model,
  });

  console.log("\n======prompt==========")
  console.log(prompt)
  console.log("\n=======end prompt=========")

  console.log("\n=======completion=========")
  console.log(chatCompletion.output.content[0].text)
  console.log("\n=======end completion=========")


  const prediction = chatCompletion.output.content[0].text;

  // Remove special tokens <|editable_region_start|>, <|user_cursor_is_here|>, <|editable_region_end|> and any trailing newlines
  const code = prediction.replace(/<\|editable_region_start\|>\n?|<\|user_cursor_is_here\|>\n?|<\|editable_region_end\|>\n?/g, '');
  return { prediction: code, prompt };
}

export default async function handler(req, res) {
  const { prefix, suffix, lastPrediction, model, language, lastPatch } = req.body;
  console.log("prefix", prefix)
  console.log("suffix", suffix)
  console.log("model", model)
  console.log("language", language)
  console.log("lastPrediction", lastPrediction)
  console.log("lastPatch", lastPatch)
  const { prediction, prompt } = await completionOpenAI(prefix, suffix, lastPrediction, model, language, lastPatch);
  res.status(200).json({ prediction, prompt })
}
