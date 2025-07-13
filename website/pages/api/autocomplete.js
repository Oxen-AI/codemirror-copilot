import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OXEN_API_KEY,
  baseURL: "https://hub.oxen.ai/api",
});

async function completionOpenAI(prefix, suffix, lastEdit, model="baseten:dgonz-flexible-coffee-harrier", language, lastPatch) {
  let patchInfo = "";
  if (lastPatch) {
    patchInfo = `
${lastPatch.contextBefore ? `${lastPatch.contextBefore.join('\n')}` : ''}
- ${lastPatch.original}
+ ${lastPatch.modified}
${lastPatch.contextAfter ? `${lastPatch.contextAfter.join('\n')}` : ''}
`;
  }

  const prompt = `You are a code completion assistant and your task is to analyze user edits and then rewrite the marked region, taking into account the cursor location.

Last Edit:
${patchInfo}

Context:
<|editable_region_start|>
${prefix}<|user_cursor_is_here|>
${suffix}
<|editable_region_end|>
`
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

  // Extract the code from <|editable_region_start|> to <|editable_region_end|>
  const code = prediction.match(/<\|editable_region_start\|>(.*?)<\|editable_region_end\|>/s)[1];
  return code;
}

export default async function handler(req, res) {
  const { prefix, suffix, lastEdit, model, language, lastPatch } = req.body;
  console.log("prefix", prefix)
  console.log("suffix", suffix)
  console.log("model", model)
  console.log("language", language)
  console.log("lastPatch", lastPatch)
  const prediction = await completionOpenAI(prefix, suffix, lastEdit, model, language, lastPatch);
  res.status(200).json({ prediction })
}
