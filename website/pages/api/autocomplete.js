import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OXEN_API_KEY,
  baseURL: "https://hub.oxen.ai/api",
});

function addSpaceToNewlines(str) {
  return str.replace(/^/gm, ' ');
}

async function completionOpenAI(prefix, suffix, lastEdit, model) {
  let prompt = `You are a code completion assistant and your task is to analyze user edits and then rewrite the marked region, taking into account the cursor location. You will be given the last state of the code and the cursor location as <|user_cursor_is_here|>. Predict what the user's next edit will be, given the existing code and the current cursor location.

Respond with just the modified code that compiles and runs and nothing else.

Last Edit:
${addSpaceToNewlines(lastEdit)}

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
  return { prediction, prompt };
}

export default async function handler(req, res) {
  const { prefix, suffix, lastEdit, model } = req.body;
  console.log("prefix", prefix)
  console.log("suffix", suffix)
  console.log("model", model)
  console.log("lastEdit", lastEdit)
  const { prediction, prompt } = await completionOpenAI(prefix, suffix, lastEdit, model);
  res.status(200).json({ prediction, prompt })
}
