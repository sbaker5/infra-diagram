/**
 * LLM Prompts Configuration
 * Centralized prompt templates for Perplexity API calls
 */

/**
 * System message for transcript analysis
 */
const ANALYSIS_SYSTEM_MESSAGE = 'You are an IT consultant assistant. Analyze meeting transcripts and provide structured summaries, action items, and infrastructure analysis. Always respond with valid JSON only.';

/**
 * Build the analysis prompt for transcript processing
 * @param {string} categories - Infrastructure categories string
 * @param {string} transcript - Truncated transcript text
 * @returns {string}
 */
function buildAnalysisPrompt(categories, transcript) {
  return `You are an IT consultant assistant. Analyze this meeting transcript and provide a structured analysis.

INFRASTRUCTURE CATEGORIES (for technical calls):
${categories}

TRANSCRIPT:
${transcript}

TASK:
1. Classify the call type:
   - TECHNICAL: Discusses IT infrastructure, systems, security with a customer
   - PARTNER: Discussion with a vendor/partner (not a direct customer), covering partnerships, products, triggers, demos
   - NON-TECHNICAL: Sales, general business, administrative calls
2. Extract the customer/company name if mentioned
3. Write a 2-3 sentence summary of the call
4. List action items with who is responsible (Stephen, Customer, Vendor, or Partner)
5. For TECHNICAL calls: identify infrastructure components and gaps, generate a Mermaid flowchart diagram
6. For PARTNER calls: generate a Mermaid mind map showing key concepts, products, triggers, and partnership areas

OUTPUT FORMAT (respond with valid JSON only):
{
  "callType": "technical", "partner", or "non-technical",
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
- For TECHNICAL calls: generate a Mermaid flowchart diagram with max 20-25 nodes
- For PARTNER calls: generate a Mermaid mind map showing partner name at center, connected to products, triggers, partnership areas
  Example partner mind map:
  mindmap
    root((Datto))
      Products
        BCDR
        SaaS Protection
      Triggers
        Q1 Promo
        Renewals
      Actions
        Schedule Demo
        Review Pricing
- Action items should be specific and actionable
- Summary should capture the key points without jargon
- If no clear customer name, set customerName to null
- IMPORTANT: Do NOT use triple-colon syntax (:::) in Mermaid. Use simple node definitions only.

Respond ONLY with the JSON object, no markdown code blocks.`;
}

module.exports = {
  ANALYSIS_SYSTEM_MESSAGE,
  buildAnalysisPrompt
};
