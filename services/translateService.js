const axios = require('axios');

/**
 * Translates a text string from sourceLanguage to targetLanguage using the Groq API.
 * @param {string} text The text to translate.
 * @param {string} sourceLanguage The language of the text.
 * @param {string} targetLanguage The language to translate into.
 * @returns {Promise<string>} The translated text.
 */
const translateText = async (text, sourceLanguage, targetLanguage) => {
    if (!text || !text.trim()) return '';
    
    // Normalise to avoid unnecessary API requests
    const sourceClean = (sourceLanguage || 'English').trim();
    const targetClean = (targetLanguage || 'English').trim();

    if (sourceClean.toLowerCase() === targetClean.toLowerCase()) {
        return text;
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey || !apiKey.trim() || apiKey.trim() === 'paste_your_groq_api_key_here') {
        console.warn("GROQ_API_KEY is not configured for Translator. Running mock fallback.");
        return `[Mock Translated to ${targetClean}]: ${text}`;
    }

    try {
        const systemPrompt = `You are a professional translator.

Rules:
- Translate naturally.
- Preserve the original meaning and tone.
- Do not add explanations.
- Do not summarize.
- Return only the translated text.
- Preserve emojis, URLs, names, numbers, code snippets, email addresses, phone numbers, and formatting.`;

        const userPrompt = `Translate this text from ${sourceClean} to ${targetClean}:\n\n${text}`;

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 1000
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            }
        );

        const translated = response.data?.choices?.[0]?.message?.content;
        if (!translated) {
            throw new Error("No response from Groq API");
        }

        return translated.trim();
    } catch (error) {
        console.error("Error in translateText service:", error.message);
        // Fail gracefully by returning the original text as requested
        return text;
    }
};

module.exports = translateText;
