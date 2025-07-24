import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OXEN_API_KEY,
  baseURL: "https://hub.oxen.ai/api",
});

async function completionOpenAI(prefix, suffix, model) {

  const prompt = `You are a code completion assistant and your task is to analyze user edits and then rewrite the marked region, taking into account the cursor location. The user intent will sometimes be explicitly given below, in which case you must follow this intent. If it is not present, you must infer the intent before implementing the change.

<|INTENT|>
<|EDIT_START|>
${prefix}<|user_cursor_is_here|>${suffix}
<|EDIT_END|>
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

  // Extract the code from <|EDIT_START|> to <|EDIT_END|>
  const match = prediction.match(/<\|EDIT_START\|>(.*?)<\|EDIT_END\|>/s);
  if (!match) {
    console.error("Failed to extract code from prediction:", prediction);
    return prediction;
  }
  var code = match[1];
  return code;
}

export default async function handler(req, res) {
  const { prefix, suffix, model } = req.body;
  console.log("model", model)
  const prediction = await completionOpenAI(prefix, suffix, model);
  res.status(200).json({ prediction })
}
