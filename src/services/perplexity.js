/**
 * Perplexity API service for extracting infrastructure from transcripts
 */
const infraTemplate = require('../config/infra-template');
const { TRANSCRIPT_MAX_LENGTH, LLM_MAX_TOKENS } = require('../config/constants');
const { ANALYSIS_SYSTEM_MESSAGE, buildAnalysisPrompt } = require('../config/llm-prompts');

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

class PerplexityService {
  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY;
  }

  /**
   * Normalize owner names - handles common transcription variations
   */
  normalizeOwner(owner) {
    if (!owner) return 'Unknown';
    const normalized = owner.trim();
    // Steven/Steve → Stephen (user's actual name)
    if (/^steven$/i.test(normalized)) return 'Stephen';
    if (/^steve$/i.test(normalized)) return 'Stephen';
    return normalized;
  }

  /**
   * Clean up Mermaid code - fix common LLM generation issues
   */
  cleanMermaidCode(code) {
    if (!code) return code;
    // Remove invalid ::: class syntax (e.g., servers:::onprem → servers)
    let cleaned = code.replace(/(\w+):::\w+/g, '$1');
    // Also clean up any leftover double colons that shouldn't be there
    cleaned = cleaned.replace(/(\w+)::([\w]+)(?!\[)/g, '$1_$2');
    return cleaned;
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

    const truncatedTranscript = transcript.substring(0, TRANSCRIPT_MAX_LENGTH);
    const prompt = buildAnalysisPrompt(categories, truncatedTranscript);

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
            content: ANALYSIS_SYSTEM_MESSAGE
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: LLM_MAX_TOKENS
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
        // Clean up invalid Mermaid syntax
        result.mermaidCode = this.cleanMermaidCode(result.mermaidCode);
      }

      // Ensure required fields
      result.callType = result.callType || 'non-technical';
      result.summary = result.summary || 'No summary available';
      result.actionItems = result.actionItems || [];

      // Normalize owner names in action items (Steven/Steve → Stephen)
      if (result.actionItems && result.actionItems.length > 0) {
        result.actionItems = result.actionItems.map(item => ({
          ...item,
          owner: this.normalizeOwner(item.owner)
        }));
      }

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
