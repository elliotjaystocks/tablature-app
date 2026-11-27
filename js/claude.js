// Reads a photo of handwritten tab with Claude.
//
// There's no server in this app, so the browser calls the Anthropic API directly with
// your own API key (stored in this browser only, from Settings). That's what the
// "dangerous direct browser access" header acknowledges: anyone with access to this
// browser could find the key, so give it a monthly spend limit in the Anthropic Console.

const MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = `You transcribe photos of handwritten guitar tablature into structured data.

How the data is laid out:
- A song is a list of bars (measures). Bar lines in the photo ("|") separate bars. If the writer used no bar lines, split the tab into bars where the phrasing or spacing suggests, roughly 4 to 16 columns each.
- Each bar is a list of columns, read left to right. A column is one moment in time: the notes struck together (a chord) share a column; notes played one after another get their own columns.
- Keep the horizontal spacing approximately as written: if there is a clear gap between notes, add an empty column so the rhythm feel is preserved.
- "notes" in each column has exactly one entry per string, ordered from the highest-pitched string (the top line of the tab) to the lowest. Use "" for a string that is not played in that column.
- "above" holds any text written above that column of the staff, such as "PM", "P.M.", "let ring" or a chord name. Use "" when there is none.
- If the photo has several lines (systems) of tab, read them top to bottom and append their bars in order.

How to write each note (one short token, no spaces):
- A fret number: "0", "3", "12".
- Techniques joined to the note they lead from, as in text tab: hammer-on "5h7", pull-off "7p5", slide up "5/7", slide down "7\\5", bend "7b9", bend and release "7b9r7", vibrato "7~", tapped "t12", muted or dead note "x", natural harmonic "<12>".
- When a technique joins two notes that the writer spaced apart, put the whole thing ("5h7") in the column of the first note and leave the second column empty for that string.

Tuning:
- "tuning" lists the open-string note names in the same order as the strings (highest first), e.g. standard 6-string is ["E","B","G","D","A","E"].
- Use the letters written at the start of the staff if present (treat a lowercase "e" as "E"). Otherwise assume standard tuning for the number of strings.
- "stringCount" is the number of lines in the staff: 6 or 7.

Also:
- "title" is the song name if one is written on the page, otherwise "".
- "uncertainties" is a short plain-English note of anything you could not read confidently (for example "Bar 5, B string: could be 8 or 9"), or "" if everything was clear.
Transcribe exactly what is written. Do not correct, simplify or embellish the music.`;

const TAB_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    stringCount: { type: 'integer', enum: [6, 7] },
    tuning: { type: 'array', items: { type: 'string' } },
    bars: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                above: { type: 'string' },
                notes: { type: 'array', items: { type: 'string' } }
              },
              required: ['above', 'notes'],
              additionalProperties: false
            }
          }
        },
        required: ['columns'],
        additionalProperties: false
      }
    },
    uncertainties: { type: 'string' }
  },
  required: ['title', 'stringCount', 'tuning', 'bars', 'uncertainties'],
  additionalProperties: false
};

export async function transcribeImage(apiKey, base64, mediaType) {
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // If Claude's safety classifiers ever decline, retry on Anthropic's recommended fallback model.
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 32000,
        fallbacks: 'default',
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: TAB_SCHEMA }
        },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: 'Transcribe the guitar tab in this photo.' }
            ]
          }
        ]
      })
    });
  } catch {
    throw new Error('Couldn’t reach Claude. Check your connection and try again.');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) throw new Error('Your Anthropic API key wasn’t accepted. Check it in Settings.');
    if (response.status === 429 || response.status === 529) {
      throw new Error('Claude is busy right now. Please try again in a minute.');
    }
    throw new Error(data.error?.message || `Claude couldn’t read this image (${response.status}).`);
  }

  if (data.stop_reason === 'refusal') throw new Error('Claude declined to read this image. Try a different photo.');
  if (data.stop_reason === 'max_tokens') {
    throw new Error('This tab is too long to read in one go. Try photographing it in smaller sections.');
  }

  const text = data.content?.find((block) => block.type === 'text')?.text;
  if (!text) throw new Error('Claude didn’t return any tab for this image.');
  return JSON.parse(text);
}
