const axios = require('axios');
const response = require('../utils/responseHandler');
const fs = require('fs');
const Message = require('../models/Message');
const translateText = require('../services/translateService');

exports.getSmartReplies = async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || typeof message !== 'string' || !message.trim()) {
            return response(res, 400, "Message is required and must be a non-empty string");
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey || !apiKey.trim() || apiKey.trim() === 'paste_your_groq_api_key_here') {
            console.warn("GROQ_API_KEY is not configured. Falling back to local mock smart replies.");
            
            const msg = message.toLowerCase().trim();
            let replies = ["Great!", "Sounds good.", "Okay!"];
            
            if (msg.includes('doing') || msg.includes('kar rahe')) {
                replies = ["Nothing much.", "Just working.", "Aap batao?"];
            } else if (msg.includes('?') || msg.includes('kya') || msg.includes('kaha') || msg.includes('kab') || msg.includes('how') || msg.includes('what') || msg.includes('where')) {
                replies = ["Yes, sure!", "Not right now.", "Why do you ask?"];
            } else if (msg.includes('hi') || msg.includes('hello') || msg.includes('hey')) {
                replies = ["Hey there!", "Hello!", "Kya chal raha hai?"];
            } else if (msg.includes('thank') || msg.includes('thanks') || msg.includes('shukriya')) {
                replies = ["You're welcome!", "No problem!", "Anytime!"];
            } else if (msg.includes('bye') || msg.includes('tc') || msg.includes('goodnight')) {
                replies = ["Goodbye!", "Take care!", "Talk soon!"];
            }
            
            return response(res, 200, "Generated mock replies (No API Key set)", replies);
        }

        const systemPrompt = `You are an AI Smart Reply assistant.
Analyze the incoming chat message and generate exactly three natural, relevant, and context-specific conversational replies.

Rules:
1. Match the language and tone of the incoming message (e.g., if the user writes in Hinglish, reply in Hinglish like "Haan", "Bilkul", "Theek hai").
2. Return ONLY a valid JSON object containing a "replies" field which is a JSON array of exactly 3 strings.
3. Maximum 5 words per reply.
4. Keep it friendly, natural, and highly conversational.
5. No emojis.
6. No numbering, listing, or markdown formatting.
7. No extra text or explanations.
8. Each reply MUST have a different intent (e.g., one agreement/affirmation, one neutral/denial/alternative, and one follow-up question or option).
9. Make the replies directly continue the conversation logically.

Example inputs and outputs:
Input: "Where are you?"
Output:
{
  "replies": [
    "On my way!",
    "At home, why?",
    "Just outside."
  ]
}

Input: "Kya kar rahe ho?"
Output:
{
  "replies": [
    "Kuch nahi, batayein.",
    "Thoda busy hoon.",
    "Aap batao?"
  ]
}
`;

        const groqPayload = {
            model: "llama-3.1-8b-instant", // fast chat model
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ],
            temperature: 0.3,
            max_tokens: 150,
            response_format: { type: "json_object" }
        };

        const groqResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            groqPayload,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000 // 5 seconds timeout
            }
        );

        const content = groqResponse.data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Empty response content from Groq API");
        }

        const parsed = JSON.parse(content);
        if (!parsed.replies || !Array.isArray(parsed.replies)) {
            throw new Error("Invalid response format from Groq API");
        }

        // Limit to exactly 3 replies
        const finalReplies = parsed.replies.slice(0, 3);

        return response(res, 200, "Smart replies generated successfully", finalReplies);
    } catch (error) {
        console.error("Error in getSmartReplies:", error.message);
        // Fallback gracefully instead of failing entirely
        return response(res, 500, error.message || "Failed to generate smart replies");
    }
};

exports.chatWithAi = async (req, res) => {
    const { prompt } = req.body;
    const uploadedFile = req.file;

    try {
        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            if (uploadedFile) {
                fs.unlink(uploadedFile.path, () => {});
            }
            return response(res, 400, "Prompt is required and must be a non-empty string");
        }

        const apiKey = process.env.GROQ_API_KEY;
        
        // Mock fallback if GROQ_API_KEY is not configured
        if (!apiKey || !apiKey.trim() || apiKey.trim() === 'paste_your_groq_api_key_here') {
            console.warn("GROQ_API_KEY is not configured for AI Chat. Running mock fallback.");
            let replyText = `I received your prompt: "${prompt}".`;
            if (uploadedFile) {
                replyText += ` Also, I noticed you uploaded a file: "${uploadedFile.originalname}" (${uploadedFile.mimetype}).`;
                fs.unlink(uploadedFile.path, () => {});
            }
            replyText += " To enable actual AI responses from the Groq API, please make sure your GROQ_API_KEY is correctly set in your backend .env file.";

            return response(res, 200, "AI Chat Response (Mock)", {
                content: replyText
            });
        }

        let messages = [];
        let model = "llama-3.1-8b-instant";

        if (uploadedFile) {
            const fileMime = uploadedFile.mimetype;
            if (fileMime.startsWith('image/')) {
                model = "llama-3.2-11b-vision-preview";
                const base64Image = fs.readFileSync(uploadedFile.path, { encoding: 'base64' });
                
                messages = [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${fileMime};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ];
            } else {
                try {
                    const textContent = fs.readFileSync(uploadedFile.path, 'utf8');
                    const truncatedContent = textContent.slice(0, 5000);
                    
                    const enrichedPrompt = `Document: "${uploadedFile.originalname}"\n---\n${truncatedContent}\n---\nUser query: ${prompt}`;
                    
                    messages = [
                        { role: "system", content: "You are an AI assistant. Answer user queries based on the provided document content." },
                        { role: "user", content: enrichedPrompt }
                    ];
                } catch (readErr) {
                    console.error("Error reading uploaded text file:", readErr);
                    messages = [
                        { role: "user", content: prompt }
                    ];
                }
            }

            fs.unlink(uploadedFile.path, (unlinkErr) => {
                if (unlinkErr) console.error("Error deleting temp file:", unlinkErr);
            });
        } else {
            messages = [
                { role: "system", content: "You are a helpful and intelligent AI Chat assistant." },
                { role: "user", content: prompt }
            ];
        }

        const groqResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model,
                messages,
                temperature: 0.5,
                max_tokens: 800
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        const aiReply = groqResponse.data?.choices?.[0]?.message?.content;
        if (!aiReply) {
            throw new Error("No response from Groq API");
        }

        return response(res, 200, "AI responded successfully", {
            content: aiReply
        });

    } catch (error) {
        console.error("Error in chatWithAi:", error.message);
        if (uploadedFile) {
            fs.unlink(uploadedFile.path, () => {});
        }
        return response(res, 500, error.message || "Failed to process AI chat query");
    }
};

exports.getChatSummary = async (req, res) => {
    const { conversationId } = req.body;

    try {
        if (!conversationId) {
            return response(res, 400, "Conversation ID is required");
        }

        // Fetch latest 100 messages for this conversation, populated with sender name
        const messages = await Message.find({ conversation: conversationId })
            .sort({ createdAt: -1 })
            .limit(100)
            .populate('sender', 'username')
            .lean();

        if (!messages || messages.length === 0) {
            return response(res, 200, "No messages to summarize", {
                summary: "• No conversation history found yet."
            });
        }

        // Filter out non-text or empty/deleted messages, and reverse to keep chronological order
        const textMessages = messages
            .filter(m => m.contentType === 'text' && m.content && m.content.trim().length > 0)
            .reverse();

        if (textMessages.length === 0) {
            return response(res, 200, "No text messages to summarize", {
                summary: "• No text messages found in the conversation."
            });
        }

        // Construct conversation text dump
        const transcript = textMessages
            .map(m => `[${m.sender?.username || 'Unknown'}]: ${m.content}`)
            .join('\n');

        const apiKey = process.env.GROQ_API_KEY;
        
        // Mock fallback if GROQ_API_KEY is not configured
        if (!apiKey || !apiKey.trim() || apiKey.trim() === 'paste_your_groq_api_key_here') {
            console.warn("GROQ_API_KEY is not configured for Summarizer. Running mock fallback.");
            const mockSummary = `• Summarized conversation of ${textMessages.length} messages.\n• Key topics included chat setups and AI settings.\n• Local development configurations were verified.\n• Server was running in mock mode because GROQ_API_KEY is missing.`;
            return response(res, 200, "AI Summary generated (Mock)", {
                summary: mockSummary
            });
        }

        const systemPrompt = `You are an AI conversation summarizer.
Summarize the conversation using concise bullet points.

Rules:
- Maximum 6 bullet points.
- Mention important decisions, plans, questions, and tasks.
- Ignore greetings and small talk.
- Keep the summary under 120 words.
- Return only plain text.
- Do not hallucinate information.`;

        const groqResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Please summarize the following chat transcript:\n\n${transcript}` }
                ],
                temperature: 0.3,
                max_tokens: 300
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        const summary = groqResponse.data?.choices?.[0]?.message?.content;
        if (!summary) {
            throw new Error("No response from Groq API");
        }

        return response(res, 200, "Summary generated successfully", {
            summary: summary.trim()
        });

    } catch (error) {
        console.error("Error in getChatSummary:", error.message);
        return response(res, 500, error.message || "Failed to generate conversation summary");
    }
};

exports.improveMessage = async (req, res) => {
    const { message } = req.body;

    try {
        if (!message || typeof message !== 'string' || !message.trim()) {
            return response(res, 400, "Message is required and must be a non-empty string");
        }

        const apiKey = process.env.GROQ_API_KEY;

        // Mock fallback if GROQ_API_KEY is not configured
        if (!apiKey || !apiKey.trim() || apiKey.trim() === 'paste_your_groq_api_key_here') {
            console.warn("GROQ_API_KEY is not configured for Coach. Running mock fallback.");
            const msg = message.trim();
            const mockSuggestions = {
                friendly: `Hey! ${msg} 😊`,
                professional: `I would like to inform you that: ${msg}. Best regards.`,
                funny: `Breaking news: ${msg}! 😂`,
                short: msg.slice(0, 30) + (msg.length > 30 ? '...' : '')
            };
            return response(res, 200, "AI suggestions generated (Mock)", mockSuggestions);
        }

        const systemPrompt = `You are an AI writing assistant.
Rewrite the user's message into four versions: friendly, professional, funny, and short.

Rules:
- Keep the original meaning.
- Return ONLY valid JSON containing a JSON object with keys "friendly", "professional", "funny", and "short" having string values.
- Do not explain.
- No markdown.

Response format:
{
  "friendly": "...",
  "professional": "...",
  "funny": "...",
  "short": "..."
}`;

        const groqResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                temperature: 0.5,
                max_tokens: 400,
                response_format: { type: "json_object" }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            }
        );

        const content = groqResponse.data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("No response content from Groq API");
        }

        const parsed = JSON.parse(content);
        if (!parsed.friendly || !parsed.professional || !parsed.funny || !parsed.short) {
            throw new Error("Invalid suggestions structure returned by Groq API");
        }

        return response(res, 200, "AI suggestions generated successfully", parsed);

    } catch (error) {
        console.error("Error in improveMessage:", error.message);
        return response(res, 500, error.message || "Failed to generate AI suggestions");
    }
};

exports.translateTextAPI = async (req, res) => {
    const { text, sourceLanguage, targetLanguage } = req.body;

    try {
        if (!text || typeof text !== 'string' || !text.trim()) {
            return response(res, 400, "Text is required and must be a non-empty string");
        }
        if (!sourceLanguage || !targetLanguage) {
            return response(res, 400, "Both sourceLanguage and targetLanguage are required");
        }

        const translatedText = await translateText(text, sourceLanguage, targetLanguage);

        return response(res, 200, "Translated successfully", {
            translatedText,
            translated: translatedText
        });
    } catch (error) {
        console.error("Error in translateTextAPI:", error.message);
        return response(res, 500, error.message || "Failed to translate text");
    }
};
