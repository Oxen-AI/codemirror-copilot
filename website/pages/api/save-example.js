import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, response, accepted } = req.body;

    if (!prompt || !response || typeof accepted !== 'boolean') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const example = {
      prompt,
      response,
      accepted,
      timestamp: new Date().toISOString()
    };

    const exampleLine = JSON.stringify(example) + '\n';
    const filePath = path.join(process.cwd(), 'examples.jsonl');

    // Append to the file (create if it doesn't exist)
    fs.appendFileSync(filePath, exampleLine);

    console.log(`Saved example: accepted=${accepted}`);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving example:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}