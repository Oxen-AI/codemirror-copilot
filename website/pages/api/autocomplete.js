import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OXEN_API_KEY,
  baseURL: "https://hub.oxen.ai/api",
});

async function completionOpenAI(prefix, suffix, model) {

  const prompt = `You are a code completion assistant and your task is to analyze user edits and then rewrite the marked region, taking into account the cursor location.

<|editable_region_start|>
${prefix}<|user_cursor_is_here|>${suffix}
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
  const match = prediction.match(/<\|editable_region_start\|>(.*?)<\|editable_region_end\|>/s);
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
