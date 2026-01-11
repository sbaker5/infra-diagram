/**
 * Perplexity API service for extracting infrastructure from transcripts
 */
const infraTemplate = require('../config/infra-template');

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

class PerplexityService {
  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Analyze a transcript - classify call type, extract summary, action items, and infrastructure
   */
  async analyzeTranscript(transcript, sessionTitle = 'Meeting') {
    if (!this.isConfigured()) {
      throw new Error('Perplexity API key not configured');
    }

    const categories = infraTemplate.categories.map(c =>
      `- ${c.name}: ${c.components.join(', ')}`
    ).join('\n');

    const prompt = `You are an IT consultant assistant. Analyze this meeting transcript and provide a structured analysis.

INFRASTRUCTURE CATEGORIES (for technical calls):
${categories}

TRANSCRIPT:
${transcript.substring(0, 15000)}

TASK:
1. Determine if this is a TECHNICAL call (discusses IT infrastructure, systems, security) or NON-TECHNICAL (sales, general business, administrative)
2. Extract the customer/company name if mentioned
3. Write a 2-3 sentence summary of the call
4. List action items with who is responsible (Stephen, Customer, or Vendor)
5. For TECHNICAL calls only: identify infrastructure components and gaps, generate a Mermaid diagram

OUTPUT FORMAT (respond with valid JSON only):
{
  "callType": "technical" or "non-technical",
  "customerName": "company name if mentioned, otherwise null",
  "summary": "2-3 sentence summary of the call covering key discussion points",
  "actionItems": [
    {"owner": "Stephen", "item": "Send quote for firewall upgrade"},
    {"owner": "Customer", "item": "Provide network diagram"},
    {"owner": "Vendor", "item": "Schedule demo for next week"}
  ],
  "components": [
    {"category": "Network", "name": "Firewall", "vendor": "Palo Alto", "notes": "needs upgrade"}
  ],
  "gaps": [
    {"category": "Security", "component": "MFA", "reason": "not implemented for remote access"}
  ],
  "mermaidCode": "flowchart TB\\n    subgraph Network\\n        FW[Firewall - Palo Alto]\\n    end"
}

RULES:
- For NON-TECHNICAL calls: set components, gaps, and mermaidCode to null
- For TECHNICAL calls: generate the Mermaid diagram with max 20-25 nodes
- Action items should be specific and actionable
- Summary should capture the key points without jargon
- If no clear customer name, set customerName to null

Respond ONLY with the JSON object, no markdown code blocks.`;

    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are an IT consultant assistant. Analyze meeting transcripts and provide structured summaries, action items, and infrastructure analysis. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Perplexity API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No response from Perplexity API');
    }

    // Parse the JSON response
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const result = JSON.parse(jsonStr);

      // Unescape mermaid code if present
      if (result.mermaidCode) {
        result.mermaidCode = result.mermaidCode
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"');
      }

      // Ensure required fields
      result.callType = result.callType || 'non-technical';
      result.summary = result.summary || 'No summary available';
      result.actionItems = result.actionItems || [];

      return result;
    } catch (parseError) {
      console.error('Failed to parse Perplexity response:', content);
      throw new Error(`Failed to parse LLM response: ${parseError.message}`);
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async extractInfrastructure(transcript, customerName = 'Unknown Customer') {
    const result = await this.analyzeTranscript(transcript);
    if (!result.customerName) {
      result.customerName = customerName;
    }
    return result;
  }

  /**
   * Simple test to verify API key works
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, error: 'API key not configured' };
    }

    try {
      const response = await fetch(PERPLEXITY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'sonar',
          messages: [
            { role: 'user', content: 'Say "OK" if you can hear me.' }
          ],
          max_tokens: 10
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `API error: ${response.status}` };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new PerplexityService();
